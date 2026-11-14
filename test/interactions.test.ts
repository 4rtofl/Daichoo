import { beforeEach, describe, expect, it } from "vitest";
import { handleInteractionRequest } from "../src/interactions/handler.ts";
import { parseEntries } from "../src/ledger/entries.ts";
import { parseSettings } from "../src/ledger/settings.ts";
import {
	CHANNEL_ID,
	commandInteraction,
	createContext,
	createFakeFetch,
	createSigner,
	DEBTOR,
	FakeDiscord,
	FakeGitHub,
	GUILD_ID,
	PAYER,
	snowflakeAt,
	testEnv,
} from "./helpers.ts";

let signer: Awaited<ReturnType<typeof createSigner>>;
let github: FakeGitHub;
let discord: FakeDiscord;

beforeEach(async () => {
	signer ??= await createSigner();
	github = new FakeGitHub();
	discord = new FakeDiscord();
});

/** 署名したリクエストをWorkerに渡し、返事と、waitUntilの処理が終わった後の状態を返す */
async function send(interaction: unknown) {
	const { fetch, requests } = createFakeFetch(github, discord);
	const { ctx, finish } = createContext();
	const response = await handleInteractionRequest(
		await signer.request(interaction),
		testEnv(signer.publicKeyHex),
		ctx,
		fetch,
	);
	await finish();
	const body = response.headers
		.get("Content-Type")
		?.includes("application/json")
		? await response.json()
		: await response.text();
	return { status: response.status, body, requests };
}

function ogori(amount: number, memo?: string, overrides = {}) {
	return commandInteraction(
		"ogori",
		[
			{ type: 6, name: "user", value: DEBTOR.id },
			{ type: 4, name: "amount", value: amount },
			...(memo === undefined
				? []
				: [{ type: 3 as const, name: "memo", value: memo }]),
		],
		{
			resolved: {
				users: {
					[DEBTOR.id]: {
						...DEBTOR,
						discriminator: "0",
						global_name: "びー",
						avatar: null,
					},
				},
			},
			...overrides,
		},
	);
}

describe("署名とPING", () => {
	it("署名が正しくなければ401を返す", async () => {
		const request = await signer.request({ type: 1 });
		const tampered = new Request(request, { body: '{"type":2}' });
		const { ctx } = createContext();
		const response = await handleInteractionRequest(
			tampered,
			testEnv(signer.publicKeyHex),
			ctx,
			async () => new Response(),
		);
		expect(response.status).toBe(401);
	});

	it("PINGにはPONGを返す", async () => {
		const { status, body } = await send({ type: 1 });
		expect(status).toBe(200);
		expect(body).toEqual({ type: 1 });
	});
});

describe("/ogori", () => {
	it("台帳のその月のファイルに1行足し、チャンネルの全員に見える返事をする", async () => {
		const { body } = await send(ogori(1200, "ラーメン\n大盛り"));

		// 先に保留の返事を返す(全員に見える)
		expect(body).toEqual({ type: 5 });
		// 日本時間 2026-11-13 22:38:58 の記録なので、11月のファイルに書く
		const entries = parseEntries(github.content("ledger/2026-11.tsv") ?? "");
		expect(entries).toEqual([
			{
				id: snowflakeAt("2026-11-13T13:38:58Z"),
				recordedAt: "2026-11-13T22:38:58+09:00",
				payerId: PAYER.id,
				payerName: "ama",
				debtorId: DEBTOR.id,
				debtorName: "びー",
				amount: 1200,
				memo: "ラーメン 大盛り",
			},
		]);
		expect(github.commits[0]?.message.split("\n")[0]).toBe(
			"おごり: ama → びー 1,200円(ラーメン 大盛り)",
		);
		expect(discord.edits).toEqual([
			{
				content: `<@${PAYER.id}> が <@${DEBTOR.id}> に **1,200円** おごりました(ラーメン 大盛り)。台帳に記録しました。`,
				allowed_mentions: { parse: [] },
			},
		]);
	});

	it("日本時間で月が変わったら、次の月のファイルに書く", async () => {
		await send(
			ogori(500, undefined, { id: snowflakeAt("2026-11-30T15:00:00Z") }),
		);
		expect(github.content("ledger/2026-12.tsv")).toContain("\t500\t");
	});

	it("書き込みがぶつかっても、読み直して記録する", async () => {
		github.setFile(
			"ledger/2026-11.tsv",
			"id\trecorded_at\tpayer_id\tpayer_name\tdebtor_id\tdebtor_name\tamount\tmemo\n1\tt\t333\tc\t444\td\t100\t\n",
		);
		github.conflictsToInject = 1;
		await send(ogori(300));
		const entries = parseEntries(github.content("ledger/2026-11.tsv") ?? "");
		expect(entries.map((e) => e.amount)).toEqual([100, 300]);
		expect(discord.edits[0]?.content).toMatch(/台帳に記録しました/);
	});

	it("同じコマンドが二重に届いても、1回だけ記録する", async () => {
		await send(ogori(300));
		await send(ogori(300));
		expect(
			parseEntries(github.content("ledger/2026-11.tsv") ?? ""),
		).toHaveLength(1);
		expect(github.commits).toHaveLength(1);
	});

	it("GitHubに書けなかったら、そう伝える", async () => {
		github.failing = true;
		await send(ogori(300));
		expect(discord.edits[0]?.content).toMatch(/記録できませんでした/);
	});

	it("台帳の形が崩れていたら、直す場所を伝える", async () => {
		github.setFile("ledger/2026-11.tsv", "id\tamount\n1\t100\n");
		await send(ogori(300));
		expect(discord.edits[0]?.content).toMatch(
			/ledger\/2026-11.tsv の書き方が正しくない.*debtor_id/,
		);
		expect(github.commits).toHaveLength(0);
	});

	it("自分へのおごりは記録しない", async () => {
		const interaction = ogori(300);
		interaction.data.options[0] = { type: 6, name: "user", value: PAYER.id };
		const { body, requests } = await send(interaction);
		expect(body).toMatchObject({
			type: 4,
			data: { content: "自分へのおごりは記録できません。", flags: 64 },
		});
		expect(requests).toHaveLength(0);
	});

	it("Botへのおごりは記録しない", async () => {
		const interaction = ogori(300);
		const user = interaction.data.resolved?.users?.[DEBTOR.id];
		if (user) {
			user.bot = true;
		}
		const { body, requests } = await send(interaction);
		expect(body).toMatchObject({ data: { flags: 64 } });
		expect(requests).toHaveLength(0);
	});

	it("ほかのサーバーからは受け付けない", async () => {
		const { body, requests } = await send(
			ogori(300, undefined, { guildId: "123" }),
		);
		expect(body).toMatchObject({
			data: { content: "このサーバーでは使えません。", flags: 64 },
		});
		expect(requests).toHaveLength(0);
	});
});

describe("/channel", () => {
	function channelCommand() {
		return commandInteraction(
			"channel",
			[{ type: 7, name: "channel", value: CHANNEL_ID }],
			{
				resolved: {
					channels: {
						[CHANNEL_ID]: {
							id: CHANNEL_ID,
							name: "精算",
							type: 0,
							permissions: "0",
						},
					},
				},
			},
		);
	}

	it("送り先のチャンネルにお知らせを送ってから、設定に保存する", async () => {
		const { body } = await send(channelCommand());

		// 本人にだけ見える保留の返事
		expect(body).toEqual({ type: 5, data: { flags: 64 } });
		expect(discord.messages).toHaveLength(1);
		expect(discord.messages[0]?.channelId).toBe(CHANNEL_ID);
		expect(parseSettings(github.content("ledger/settings.json") ?? "")).toEqual(
			{ settlementChannel: { id: CHANNEL_ID, name: "精算" } },
		);
		expect(github.commits[0]?.message.split("\n")[0]).toBe(
			"設定: 精算の結果の送り先を #精算 にする",
		);
		expect(discord.edits[0]?.content).toBe(
			`毎月の精算の結果を、<#${CHANNEL_ID}> に送るように設定しました。`,
		);
	});

	it("Botがそのチャンネルに送れなければ、保存しない", async () => {
		discord.createStatus = 403;
		await send(channelCommand());
		expect(github.content("ledger/settings.json")).toBeUndefined();
		expect(discord.edits[0]?.content).toMatch(/権限があるか確かめてください/);
	});

	it("埋め込みが外れた(埋め込みリンクの権限がない)ら、お知らせを消して保存しない", async () => {
		discord.stripEmbeds = true;
		await send(channelCommand());
		expect(discord.deleted).toHaveLength(1);
		expect(github.content("ledger/settings.json")).toBeUndefined();
		expect(discord.edits[0]?.content).toMatch(/権限があるか確かめてください/);
	});

	it("保存できなかったら、送ったお知らせを消す", async () => {
		github.failing = true;
		await send(channelCommand());
		expect(discord.deleted).toHaveLength(1);
		expect(discord.edits[0]?.content).toMatch(/設定を保存できませんでした/);
	});

	it("ほかのサーバーからは受け付けない", async () => {
		const interaction = channelCommand();
		interaction.guild_id = "123";
		const { body } = await send(interaction);
		expect(body).toMatchObject({ data: { flags: 64 } });
		expect(discord.messages).toHaveLength(0);
	});
});

describe("そのほか", () => {
	it("知らないコマンドには、本人にだけ見える返事をする", async () => {
		const { body } = await send(commandInteraction("unknown", []));
		expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
	});

	it("サーバーのIDの設定は、環境変数のもの", () => {
		expect(testEnv("x").DISCORD_GUILD_ID).toBe(GUILD_ID);
	});
});

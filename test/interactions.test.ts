import type { GuildMemberFlags } from "discord-api-types/v10";
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
				split: 1,
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

describe("/warikan", () => {
	const SEA = { id: "333333333333333333", username: "sea" };
	const BOT = { id: "444444444444444444", username: "bot" };

	function resolvedUser(
		user: { id: string; username: string },
		globalName: string | null,
		bot = false,
	) {
		return {
			...user,
			discriminator: "0",
			global_name: globalName,
			avatar: null,
			...(bot ? { bot } : {}),
		};
	}

	/** usersは、user1, user2, … の順に選んだ人 */
	function warikan(amount: number, users: string[], memo?: string) {
		return commandInteraction(
			"warikan",
			[
				{ type: 4, name: "amount", value: amount },
				...users.map((id, index) => ({
					type: 6 as const,
					name: `user${index + 1}`,
					value: id,
				})),
				...(memo === undefined
					? []
					: [{ type: 3 as const, name: "memo", value: memo }]),
			],
			{
				resolved: {
					users: {
						[PAYER.id]: resolvedUser(PAYER, null),
						[DEBTOR.id]: resolvedUser(DEBTOR, "びー"),
						[SEA.id]: resolvedUser(SEA, "しー"),
						[BOT.id]: resolvedUser(BOT, null, true),
					},
					members: {
						[SEA.id]: {
							nick: "しーちゃん",
							roles: [],
							joined_at: "2026-01-01T00:00:00Z",
							flags: 0 as GuildMemberFlags,
							permissions: "0",
						},
					},
				},
			},
		);
	}

	it("払った人も含めた人数で、相手ごとに1行ずつ記録し、全員に見える返事をする", async () => {
		const { body } = await send(warikan(3000, [DEBTOR.id, SEA.id], "焼肉"));

		expect(body).toEqual({ type: 5 });
		const id = snowflakeAt("2026-11-13T13:38:58Z");
		const base = {
			id,
			recordedAt: "2026-11-13T22:38:58+09:00",
			payerId: PAYER.id,
			payerName: "ama",
			amount: 3000,
			split: 3,
			memo: "焼肉",
		};
		expect(parseEntries(github.content("ledger/2026-11.tsv") ?? "")).toEqual([
			{ ...base, debtorId: DEBTOR.id, debtorName: "びー" },
			{ ...base, debtorId: SEA.id, debtorName: "しーちゃん" },
		]);
		expect(github.commits).toHaveLength(1);
		expect(github.commits[0]?.message).toBe(
			[
				"割り勘: ama → びー, しーちゃん 3,000円を3人で(焼肉)",
				"",
				`payer: ${PAYER.id}`,
				`debtors: ${DEBTOR.id}, ${SEA.id}`,
				`interaction: ${id}`,
			].join("\n"),
		);
		expect(discord.edits).toEqual([
			{
				content: `<@${PAYER.id}> が <@${DEBTOR.id}>、<@${SEA.id}> と **3,000円** を3人で割り勘しました(焼肉)。1人あたり1,000円です。台帳に記録しました。`,
				allowed_mentions: { parse: [] },
			},
		]);
	});

	it("割り切れないときは、返事では1人分を丸めて伝え、台帳には割る前の金額を書く", async () => {
		await send(warikan(10000, [DEBTOR.id, SEA.id]));
		expect(
			parseEntries(github.content("ledger/2026-11.tsv") ?? "").map((e) => [
				e.amount,
				e.split,
			]),
		).toEqual([
			[10000, 3],
			[10000, 3],
		]);
		expect(discord.edits[0]?.content).toContain(
			"1人あたり約3,333円です(1円未満の端数は、月末の精算でまとめて丸めます)。",
		);
	});

	it("同じ人を2回選んだり、自分を選んだりしても、1人として数える", async () => {
		await send(warikan(1000, [DEBTOR.id, PAYER.id, DEBTOR.id]));
		const entries = parseEntries(github.content("ledger/2026-11.tsv") ?? "");
		expect(entries.map((e) => [e.debtorId, e.split])).toEqual([[DEBTOR.id, 2]]);
		expect(discord.edits[0]?.content).toContain(
			"を2人で割り勘しました。1人あたり500円です。",
		);
	});

	it("split の列がない今の台帳に、列を足して記録する。今ある行はそのまま読める", async () => {
		const current =
			"id\trecorded_at\tpayer_id\tpayer_name\tdebtor_id\tdebtor_name\tamount\tmemo\n" +
			`1\tt\t${DEBTOR.id}\tbee\t${PAYER.id}\tama\t1000\tこの世\n`;
		github.setFile("ledger/2026-11.tsv", current);
		await send(warikan(3000, [DEBTOR.id, SEA.id]));
		const text = github.content("ledger/2026-11.tsv") ?? "";
		expect(text.split("\n").slice(0, 2)).toEqual([
			"id\trecorded_at\tpayer_id\tpayer_name\tdebtor_id\tdebtor_name\tamount\tsplit\tmemo",
			`1\tt\t${DEBTOR.id}\tbee\t${PAYER.id}\tama\t1000\t\tこの世`,
		]);
		expect(parseEntries(text).map((e) => [e.amount, e.split])).toEqual([
			[1000, 1],
			[3000, 3],
			[3000, 3],
		]);
	});

	it("同じコマンドが二重に届いても、1回だけ記録する", async () => {
		await send(warikan(3000, [DEBTOR.id, SEA.id]));
		await send(warikan(3000, [DEBTOR.id, SEA.id]));
		expect(
			parseEntries(github.content("ledger/2026-11.tsv") ?? ""),
		).toHaveLength(2);
		expect(github.commits).toHaveLength(1);
	});

	it("書き込みがぶつかっても、読み直して記録する", async () => {
		github.conflictsToInject = 1;
		await send(warikan(3000, [DEBTOR.id]));
		expect(
			parseEntries(github.content("ledger/2026-11.tsv") ?? ""),
		).toHaveLength(1);
		expect(discord.edits[0]?.content).toMatch(/台帳に記録しました/);
	});

	it("台帳の形が崩れていたら、直す場所を伝える", async () => {
		github.setFile("ledger/2026-11.tsv", "id\tamount\n1\t100\n");
		await send(warikan(3000, [DEBTOR.id]));
		expect(discord.edits[0]?.content).toMatch(
			/ledger\/2026-11.tsv の書き方が正しくない.*debtor_id.*\/warikan/,
		);
		expect(github.commits).toHaveLength(0);
	});

	it("GitHubに書けなかったら、そう伝える", async () => {
		github.failing = true;
		await send(warikan(3000, [DEBTOR.id]));
		expect(discord.edits[0]?.content).toMatch(
			/記録できませんでした。.*\/warikan/,
		);
	});

	it("自分しか選んでいなければ、記録しない", async () => {
		const { body, requests } = await send(warikan(3000, [PAYER.id]));
		expect(body).toMatchObject({
			type: 4,
			data: {
				content:
					"自分のほかに、割り勘した相手を1人以上選んでください。自分は選ばなくても人数に入ります。",
				flags: 64,
			},
		});
		expect(requests).toHaveLength(0);
	});

	it("Botを選んでいたら、記録しない", async () => {
		const { body, requests } = await send(warikan(3000, [DEBTOR.id, BOT.id]));
		expect(body).toMatchObject({
			data: { content: "Botとは割り勘できません。", flags: 64 },
		});
		expect(requests).toHaveLength(0);
	});

	it("金額が範囲の外なら、記録しない", async () => {
		const { body, requests } = await send(warikan(0, [DEBTOR.id]));
		expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
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

describe("/seisan", () => {
	const HEADER =
		"id\trecorded_at\tpayer_id\tpayer_name\tdebtor_id\tdebtor_name\tamount\tmemo\n";

	function seisan(month?: string) {
		return commandInteraction(
			"seisan",
			month === undefined ? [] : [{ type: 3, name: "month", value: month }],
		);
	}

	it("今月の台帳から精算し、本人にだけ見える埋め込みで返す", async () => {
		github.setFile(
			"ledger/2026-11.tsv",
			`${HEADER}1\tt\t${PAYER.id}\ta\t${DEBTOR.id}\tb\t1500\t\n`,
		);
		const { body } = await send(seisan());

		expect(body).toEqual({ type: 5, data: { flags: 64 } });
		const embed = discord.edits[0]?.embeds?.[0];
		expect(embed?.title).toBe("2026年11月の精算(途中)");
		expect(embed?.url).toBe(
			"https://github.com/example/ledger/blob/main/ledger/2026-11.tsv",
		);
		expect(embed?.description).toBe(
			"今日までの記録で精算すると、次のとおりです。月末までの記録で変わります。",
		);
		expect(embed?.fields).toEqual([
			{ name: "b", value: "a へ 1,500円", inline: false },
			{ name: "a", value: "支払いなし", inline: false },
		]);
		expect(github.commits).toHaveLength(0);
	});

	it("月を指定すると、その月の精算を出す。終わった月には「途中」を付けない", async () => {
		await send(seisan("2026-10"));
		const embed = discord.edits[0]?.embeds?.[0];
		expect(embed?.title).toBe("2026年10月の精算");
		expect(embed?.description).toBe("この月の記録はありません。");
	});

	it("まだ始まっていない月は、台帳を読まずに断る", async () => {
		const { body, requests } = await send(seisan("2026-12"));
		expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
		expect(requests).toHaveLength(0);
	});

	it("台帳の形が崩れていたら、直す場所を伝える", async () => {
		github.setFile("ledger/2026-11.tsv", "id\tamount\n1\t100\n");
		await send(seisan());
		expect(discord.edits[0]?.content).toMatch(
			/ledger\/2026-11.tsv の書き方が正しくない.*debtor_id/,
		);
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

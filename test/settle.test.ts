import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settle } from "../scripts/settle-lib.ts";
import {
	CHANNEL_ID,
	createFakeFetch,
	DEBTOR,
	FakeDiscord,
	FakeGitHub,
	PAYER,
} from "./helpers.ts";

const HEADER =
	"id\trecorded_at\tpayer_id\tpayer_name\tdebtor_id\tdebtor_name\tamount\tmemo";

let rootDir: string;
let discord: FakeDiscord;
let logs: string[];

beforeEach(() => {
	rootDir = mkdtempSync(join(tmpdir(), "daichoo-settle-"));
	mkdirSync(join(rootDir, "ledger"));
	discord = new FakeDiscord();
	logs = [];
});

afterEach(() => {
	rmSync(rootDir, { recursive: true, force: true });
});

function writeLedger(name: string, content: string) {
	writeFileSync(join(rootDir, "ledger", name), content);
}

function writeChannel() {
	writeLedger(
		"settings.json",
		JSON.stringify({ settlementChannel: { id: CHANNEL_ID, name: "精算" } }),
	);
}

/** 最初に送ったメッセージの埋め込み */
function firstEmbed() {
	const embeds = discord.messages[0]?.body.embeds as
		| { description?: string; url?: string }[]
		| undefined;
	return embeds?.[0];
}

function run(options: { month?: string; dryRun?: boolean; now?: Date } = {}) {
	const { fetch } = createFakeFetch(new FakeGitHub(), discord);
	return settle({
		rootDir,
		month: options.month,
		dryRun: options.dryRun ?? false,
		botToken: "bot-token",
		blobBaseUrl: "https://github.com/o/r/blob/abc",
		now: options.now ?? new Date("2026-11-01T00:17:00Z"),
		fetch,
		log: (message) => logs.push(message),
	});
}

describe("settle", () => {
	it("前の月の台帳を精算して、設定したチャンネルに送る", async () => {
		writeChannel();
		writeLedger(
			"2026-10.tsv",
			`${HEADER}\n1\tt\t${PAYER.id}\tama\t${DEBTOR.id}\tbee\t1200\t\n2\tt\t${DEBTOR.id}\tbee\t${PAYER.id}\tama\t200\t\n`,
		);
		// 11月の記録は、10月の精算に入らない
		writeLedger(
			"2026-11.tsv",
			`${HEADER}\n3\tt\t${PAYER.id}\tama\t${DEBTOR.id}\tbee\t999\t\n`,
		);

		const result = await run();

		expect(result.month).toBe("2026-10");
		expect(discord.messages).toHaveLength(1);
		expect(discord.messages[0]?.channelId).toBe(CHANNEL_ID);
		const embed = firstEmbed();
		expect(embed?.description).toContain(
			`<@${DEBTOR.id}> から <@${PAYER.id}> へ **1,000円**`,
		);
		expect(embed?.url).toBe(
			"https://github.com/o/r/blob/abc/ledger/2026-10.tsv",
		);
	});

	it("日本時間の1日なら、UTCではまだ前の月の日でも、前の月を精算する", async () => {
		writeChannel();
		// UTCでは10月31日の15時半だが、日本時間では11月1日の0時半
		const result = await run({ now: new Date("2026-10-31T15:30:00Z") });
		expect(result.month).toBe("2026-10");
	});

	it("記録のない月は、記録がないと送る", async () => {
		writeChannel();
		await run({ month: "2026-09" });
		const embed = firstEmbed();
		expect(embed?.description).toBe("この月の記録はありません。");
	});

	it("送り先が設定されていなければ、エラーにする", async () => {
		await expect(run()).rejects.toThrowError(/\/channel/);
		expect(discord.messages).toHaveLength(0);
	});

	it("dry runでは送らず、内容をログに出す", async () => {
		writeLedger(
			"2026-10.tsv",
			`${HEADER}\n1\tt\t${PAYER.id}\ta\t${DEBTOR.id}\tb\t500\t\n`,
		);
		const result = await run({ dryRun: true });
		expect(discord.messages).toHaveLength(0);
		expect(result.messages).toHaveLength(1);
		expect(logs.join("\n")).toContain("送り先: 未設定");
	});

	it("台帳の形が崩れていたら、ファイル名と行番号を付けてエラーにする", async () => {
		writeChannel();
		writeLedger(
			"2026-10.tsv",
			`${HEADER}\n1\tt\t${PAYER.id}\ta\t${DEBTOR.id}\tb\tabc\t\n`,
		);
		await expect(run()).rejects.toThrowError(
			/^ledger\/2026-10.tsv: 2行目: amount/,
		);
	});

	it("月の指定が正しくなければ、エラーにする", async () => {
		await expect(run({ month: "2026/10" })).rejects.toThrowError(/2026-10/);
	});
});

import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../src/ledger/entries.ts";
import { buildSettlementMessages } from "../src/ledger/report.ts";
import type { Transfer } from "../src/ledger/settlement.ts";

const now = new Date("2026-11-01T00:17:00Z");

const AMA = { id: "111", name: "あま" };
const BEE = { id: "222", name: "びー" };
const SEA = { id: "333", name: "しー" };

let nextId = 1;
function entry(
	payer: { id: string; name: string },
	debtor: { id: string; name: string },
	amount: number,
): LedgerEntry {
	return {
		id: String(nextId++),
		recordedAt: "",
		payerId: payer.id,
		payerName: payer.name,
		debtorId: debtor.id,
		debtorName: debtor.name,
		amount,
		memo: "",
	};
}

function transfer(
	from: { id: string },
	to: { id: string },
	amount: number,
): Transfer {
	return { fromId: from.id, toId: to.id, amount };
}

function build(entries: LedgerEntry[], transfers: Transfer[]) {
	return buildSettlementMessages(
		{ month: "2026-10", entries, transfers },
		{ now },
	);
}

describe("buildSettlementMessages", () => {
	it("記録に出てくる人ごとにFieldを作り、支払う額の多い人から並べる", () => {
		const messages = buildSettlementMessages(
			{
				month: "2026-10",
				entries: [
					entry(AMA, BEE, 1000),
					entry(AMA, SEA, 500),
					entry(BEE, SEA, 300),
				],
				transfers: [transfer(SEA, AMA, 800), transfer(BEE, AMA, 700)],
			},
			{
				now,
				ledgerFileUrl: "https://github.com/o/r/blob/abc/ledger/2026-10.tsv",
			},
		);
		expect(messages).toEqual([
			{
				embeds: [
					{
						title: "2026年10月の精算",
						url: "https://github.com/o/r/blob/abc/ledger/2026-10.tsv",
						fields: [
							{ name: "しー", value: "あま へ 800円", inline: false },
							{ name: "びー", value: "あま へ 700円", inline: false },
							{ name: "あま", value: "支払いなし", inline: false },
						],
						color: 0x2f855a,
						footer: { text: "記録 3件、合計 1,800円" },
						timestamp: "2026-11-01T00:17:00.000Z",
					},
				],
				allowed_mentions: { parse: [] },
			},
		]);
	});

	it("1人が複数の人に払うときは、1つのFieldに、額の多い順に並べる", () => {
		const [message] = build(
			[entry(BEE, AMA, 300), entry(SEA, AMA, 500)],
			[transfer(AMA, SEA, 500), transfer(AMA, BEE, 300)],
		);
		expect(message?.embeds?.[0]?.fields?.[0]).toEqual({
			name: "あま",
			value: "しー へ 500円\nびー へ 300円",
			inline: false,
		});
	});

	it("貸し借りが釣り合っていても、全員のFieldを「支払いなし」で出す", () => {
		const [message] = build([entry(BEE, AMA, 1000), entry(AMA, BEE, 1000)], []);
		const embed = message?.embeds?.[0];
		expect(embed?.description).toBeUndefined();
		expect(embed?.fields).toEqual([
			{ name: "あま", value: "支払いなし", inline: false },
			{ name: "びー", value: "支払いなし", inline: false },
		]);
	});

	it("名前は、その人の一番新しい記録の表示名を使い、名前がなければIDを出す", () => {
		const [message] = build(
			[
				entry({ id: AMA.id, name: "あま(旧)" }, { id: BEE.id, name: "" }, 100),
				entry(AMA, { id: BEE.id, name: "" }, 100),
			],
			[transfer(BEE, AMA, 200)],
		);
		expect(message?.embeds?.[0]?.fields).toEqual([
			{ name: BEE.id, value: "あま へ 200円", inline: false },
			{ name: "あま", value: "支払いなし", inline: false },
		]);
	});

	it("値に書く名前の書式の記号は、そのまま表示されるようにする", () => {
		const star = { id: "444", name: "*ほし_*<@1>" };
		const [message] = build(
			[entry(star, AMA, 100)],
			[transfer(AMA, star, 100)],
		);
		expect(message?.embeds?.[0]?.fields?.[0]?.value).toBe(
			"\\*ほし\\_\\*\\<@1> へ 100円",
		);
		// タイトルでは書式が効かないので、そのまま書く
		expect(message?.embeds?.[0]?.fields?.[1]?.name).toBe("*ほし_*<@1>");
	});

	it("記録がない月は、そう伝える", () => {
		const [message] = buildSettlementMessages(
			{ month: "2026-10", entries: [], transfers: [] },
			{ now },
		);
		expect(message?.embeds?.[0]?.description).toBe(
			"この月の記録はありません。",
		);
		expect(message?.embeds?.[0]?.fields).toBeUndefined();
		expect(message?.embeds?.[0]?.url).toBeUndefined();
	});

	it("人が多くてFieldが25個を超えるときは、メッセージを分ける", () => {
		const receiver = { id: "999", name: "うけとり" };
		const people = Array.from({ length: 60 }, (_, i) => ({
			id: String(1000 + i),
			name: `ひと${i}`,
		}));
		const messages = build(
			people.map((person) => entry(receiver, person, 100)),
			people.map((person) => transfer(person, receiver, 100)),
		);

		expect(messages.length).toBeGreaterThan(1);
		expect(messages[1]?.embeds?.[0]?.title).toBe("2026年10月の精算(続き)");
		const names: string[] = [];
		for (const message of messages) {
			const embed = message.embeds?.[0];
			const fields = embed?.fields ?? [];
			expect(fields.length).toBeLessThanOrEqual(25);
			const size =
				(embed?.title?.length ?? 0) +
				(embed?.footer?.text.length ?? 0) +
				fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
			expect(size).toBeLessThanOrEqual(6000);
			names.push(...fields.map((f) => f.name));
		}
		// 全員が1回ずつ載っている
		expect(names.sort()).toEqual(
			[...people.map((p) => p.name), receiver.name].sort(),
		);
	});

	it("終わっていない月は、タイトルに「(途中)」を付け、最初の埋め込みだけに前置きを書く", () => {
		const receiver = { id: "999", name: "うけとり" };
		const people = Array.from({ length: 30 }, (_, i) => ({
			id: String(1000 + i),
			name: `ひと${i}`,
		}));
		const messages = buildSettlementMessages(
			{
				month: "2026-11",
				entries: people.map((person) => entry(receiver, person, 100)),
				transfers: people.map((person) => transfer(person, receiver, 100)),
			},
			{ now, inProgress: true },
		);
		expect(messages.map((m) => m.embeds?.[0]?.title)).toEqual([
			"2026年11月の精算(途中)",
			"2026年11月の精算(続き)(途中)",
		]);
		expect(messages[0]?.embeds?.[0]?.description).toBe(
			"今日までの記録で精算すると、次のとおりです。月末までの記録で変わります。",
		);
		expect(messages[1]?.embeds?.[0]?.description).toBeUndefined();
	});

	it("1人の支払いが1つのFieldに収まらないときは、Fieldを分ける", () => {
		const receivers = Array.from({ length: 80 }, (_, i) => ({
			id: String(1000 + i),
			name: `とても長い名前の受け取る人その${i}`,
		}));
		const [message] = build(
			receivers.map((receiver) => entry(receiver, AMA, 1000)),
			receivers.map((receiver) => transfer(AMA, receiver, 1000)),
		);

		const fields = (message?.embeds?.[0]?.fields ?? []).filter((f) =>
			f.name.startsWith("あま"),
		);
		expect(fields.length).toBeGreaterThan(1);
		expect(fields[0]?.name).toBe("あま");
		expect(fields[1]?.name).toBe("あま(続き)");
		for (const field of fields) {
			expect(field.value.length).toBeLessThanOrEqual(1024);
		}
		const lines = fields.flatMap((f) => f.value.split("\n"));
		expect(lines).toHaveLength(80);
	});
});

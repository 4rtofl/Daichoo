import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../src/ledger/entries.ts";
import { buildSettlementMessages } from "../src/ledger/report.ts";

const now = new Date("2026-11-01T00:17:00Z");

function entry(amount: number): LedgerEntry {
	return {
		id: "1",
		recordedAt: "",
		payerId: "111",
		payerName: "",
		debtorId: "222",
		debtorName: "",
		amount,
		memo: "",
	};
}

describe("buildSettlementMessages", () => {
	it("支払いの一覧を、1通の埋め込みにする", () => {
		const messages = buildSettlementMessages(
			{
				month: "2026-10",
				entries: [entry(1200), entry(800)],
				transfers: [{ fromId: "222", toId: "111", amount: 2000 }],
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
						description: [
							"次のとおり支払ってください。",
							"",
							"<@222> から <@111> へ **2,000円**",
							"",
							"支払いの回数が少なくなるように、貸し借りをまとめています。",
						].join("\n"),
						color: 0x2f855a,
						footer: { text: "記録 2件、合計 2,000円" },
						timestamp: "2026-11-01T00:17:00.000Z",
					},
				],
				allowed_mentions: { parse: [] },
			},
		]);
	});

	it("記録がない月は、そう伝える", () => {
		const [message] = buildSettlementMessages(
			{ month: "2026-10", entries: [], transfers: [] },
			{ now },
		);
		expect(message?.embeds?.[0]?.description).toBe(
			"この月の記録はありません。",
		);
		expect(message?.embeds?.[0]?.url).toBeUndefined();
	});

	it("貸し借りが釣り合っていたら、支払いがないと伝える", () => {
		const [message] = buildSettlementMessages(
			{ month: "2026-10", entries: [entry(500), entry(500)], transfers: [] },
			{ now },
		);
		expect(message?.embeds?.[0]?.description).toMatch(/支払いはありません/);
	});

	it("長すぎるときは、行の途中で切らずにメッセージを分ける", () => {
		const transfers = Array.from({ length: 150 }, (_, i) => ({
			fromId: String(100000000000000000n + BigInt(i)),
			toId: "111111111111111111",
			amount: 1000 + i,
		}));
		const messages = buildSettlementMessages(
			{ month: "2026-10", entries: [entry(1)], transfers },
			{ now },
		);
		expect(messages.length).toBeGreaterThan(1);
		const descriptions = messages.map((m) => m.embeds?.[0]?.description ?? "");
		for (const description of descriptions) {
			expect(description.length).toBeLessThanOrEqual(4096);
		}
		expect(messages[1]?.embeds?.[0]?.title).toBe("2026年10月の精算(続き)");
		// すべての支払いが、どこかに1回ずつ載っている
		const lines = descriptions.join("\n").split("\n");
		for (const transfer of transfers) {
			expect(
				lines.filter((line) => line.startsWith(`<@${transfer.fromId}>`)),
			).toHaveLength(1);
		}
	});
});

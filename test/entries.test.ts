import { describe, expect, it } from "vitest";
import {
	appendEntry,
	type LedgerEntry,
	LedgerFormatError,
	ledgerPath,
	parseEntries,
} from "../src/ledger/entries.ts";

/** 値を並べて、TSVの1行にする(テストの期待値を読みやすく書くため) */
function row(...values: (string | number)[]): string {
	return values.join("\t");
}

const HEADER = row(
	"id",
	"recorded_at",
	"payer_id",
	"payer_name",
	"debtor_id",
	"debtor_name",
	"amount",
	"memo",
);

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
	return {
		id: "1001",
		recordedAt: "2026-11-13T22:38:58+09:00",
		payerId: "111",
		payerName: "あま",
		debtorId: "222",
		debtorName: "びー",
		amount: 1200,
		memo: "ラーメン",
		...overrides,
	};
}

describe("ledgerPath", () => {
	it("月ごとのTSVのパス", () => {
		expect(ledgerPath("2026-11")).toBe("ledger/2026-11.tsv");
	});
});

describe("appendEntry", () => {
	it("ファイルがなければ、見出しの行から作る", () => {
		expect(appendEntry(null, entry())).toBe(
			`${HEADER}\n${row("1001", "2026-11-13T22:38:58+09:00", "111", "あま", "222", "びー", 1200, "ラーメン")}\n`,
		);
	});

	it("今の中身の末尾に1行足す。最後に改行がなくても行が混ざらない", () => {
		const first = appendEntry(null, entry()) ?? "";
		const appended = appendEntry(
			first.trimEnd(),
			entry({ id: "1002", memo: "コーヒー, ケーキ" }),
		);
		expect(appended?.split("\n")).toEqual([
			HEADER,
			row(
				"1001",
				"2026-11-13T22:38:58+09:00",
				"111",
				"あま",
				"222",
				"びー",
				1200,
				"ラーメン",
			),
			row(
				"1002",
				"2026-11-13T22:38:58+09:00",
				"111",
				"あま",
				"222",
				"びー",
				1200,
				"コーヒー, ケーキ",
			),
			"",
		]);
	});

	it("表示名にタブや改行があっても、行や列が崩れない", () => {
		const text = appendEntry(null, entry({ payerName: "あ\tま\nさん" }));
		expect(parseEntries(text ?? "")).toEqual([
			entry({ payerName: "あ ま さん" }),
		]);
	});

	it("同じIDの記録がすでにあれば、足さない", () => {
		const first = appendEntry(null, entry());
		expect(appendEntry(first, entry())).toBeNull();
	});

	it("見出しの並びが手で変えられていても、その並びに合わせて書く", () => {
		const current = `${row("amount", "payer_id", "debtor_id", "id", "note")}\n${row(500, "111", "222", "1000", "手で足した")}\n`;
		const appended = appendEntry(current, entry());
		expect(appended).toBe(`${current}${row(1200, "111", "222", "1001", "")}\n`);
		expect(parseEntries(appended ?? "").map((e) => e.amount)).toEqual([
			500, 1200,
		]);
	});

	it("今ある行に正しくないものがあれば、足さずに行番号を付けてエラーにする", () => {
		const current = `${HEADER}\n${row(1, "t", 111, "a", 222, "b", 100, "")}\n${row(2, "t", 111, "a", 222, "b", "abc", "")}\n`;
		expect(() => appendEntry(current, entry())).toThrowError(/^3行目: amount/);
	});

	it("正しくない記録は書かない", () => {
		expect(() => appendEntry(null, entry({ amount: 0 }))).toThrowError(
			LedgerFormatError,
		);
		expect(() => appendEntry(null, entry({ debtorId: "111" }))).toThrowError(
			LedgerFormatError,
		);
	});
});

describe("parseEntries", () => {
	it("書いた記録を読み戻せる", () => {
		const text = appendEntry(
			appendEntry(null, entry()),
			entry({ id: "1002", memo: "" }),
		);
		expect(parseEntries(text ?? "")).toEqual([
			entry(),
			entry({ id: "1002", memo: "" }),
		]);
	});

	it("空のファイルは、記録なしとして読む", () => {
		expect(parseEntries("")).toEqual([]);
		expect(parseEntries(`${HEADER}\n`)).toEqual([]);
	});

	it("金額が正しくない行は、行番号を付けてエラーにする", () => {
		const text = `${HEADER}\n${row(1, "t", 111, "a", 222, "b", 100, "")}\n${row(2, "t", 111, "a", 222, "b", 1.5, "")}\n`;
		expect(() => parseEntries(text)).toThrowError(/^3行目: amount/);
	});

	it("精算に欠かせない列がなければエラーにする", () => {
		expect(() =>
			parseEntries(`${row("id", "payer_id", "amount")}\n`),
		).toThrowError(/debtor_id/);
	});

	it("カンマ区切りのまま書かれていたら、見出しが読めないのでエラーにする", () => {
		expect(() =>
			parseEntries("id,payer_id,debtor_id,amount\n1,111,222,100\n"),
		).toThrowError(LedgerFormatError);
	});
});

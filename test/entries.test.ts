import { describe, expect, it } from "vitest";
import {
	appendEntries,
	appendEntry,
	type LedgerEntry,
	LedgerFormatError,
	ledgerPath,
	parseEntries,
	summarizeRecords,
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
	"split",
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
		split: 1,
		memo: "ラーメン",
		...overrides,
	};
}

/** 割り勘を足す前の形の見出し(split の列がない)。ledger/2026-11.tsv はこの形で書かれている */
const OLD_HEADER = row(
	"id",
	"recorded_at",
	"payer_id",
	"payer_name",
	"debtor_id",
	"debtor_name",
	"amount",
	"memo",
);

/** あまが3,000円を、あま・びー・しーの3人で割り勘した記録(2行) */
function warikanEntries(): LedgerEntry[] {
	return [
		entry({ id: "2001", amount: 3000, split: 3, memo: "焼肉" }),
		entry({
			id: "2001",
			debtorId: "333",
			debtorName: "しー",
			amount: 3000,
			split: 3,
			memo: "焼肉",
		}),
	];
}

describe("ledgerPath", () => {
	it("月ごとのTSVのパス", () => {
		expect(ledgerPath("2026-11")).toBe("ledger/2026-11.tsv");
	});
});

describe("appendEntry", () => {
	it("ファイルがなければ、見出しの行から作る", () => {
		expect(appendEntry(null, entry())).toBe(
			`${HEADER}\n${row("1001", "2026-11-13T22:38:58+09:00", "111", "あま", "222", "びー", 1200, 1, "ラーメン")}\n`,
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
				1,
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
				1,
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

describe("appendEntries(割り勘)", () => {
	it("割り勘は、相手ごとの行を、同じidと、割る前の金額と人数で書く", () => {
		expect(appendEntries(null, warikanEntries())).toBe(
			[
				HEADER,
				row(
					"2001",
					"2026-11-13T22:38:58+09:00",
					"111",
					"あま",
					"222",
					"びー",
					3000,
					3,
					"焼肉",
				),
				row(
					"2001",
					"2026-11-13T22:38:58+09:00",
					"111",
					"あま",
					"333",
					"しー",
					3000,
					3,
					"焼肉",
				),
				"",
			].join("\n"),
		);
	});

	it("同じidの割り勘がすでにあれば、どの行も足さない", () => {
		const first = appendEntries(null, warikanEntries());
		expect(appendEntries(first, warikanEntries())).toBeNull();
	});

	it("split の列がない台帳に割り勘を足すと、amount の後ろに列を足し、今ある行はそのまま1として読める", () => {
		const current = `${OLD_HEADER}\n${row(1, "t", 111, "あま", 222, "びー", 1000, "この世")}\n${row(2, "t", 222, "びー", 111, "あま", 100, "")}\n`;
		const appended = appendEntries(current, warikanEntries()) ?? "";
		expect(appended.split("\n")).toEqual([
			HEADER,
			row(1, "t", 111, "あま", 222, "びー", 1000, "", "この世"),
			row(2, "t", 222, "びー", 111, "あま", 100, "", ""),
			row(
				"2001",
				"2026-11-13T22:38:58+09:00",
				"111",
				"あま",
				"222",
				"びー",
				3000,
				3,
				"焼肉",
			),
			row(
				"2001",
				"2026-11-13T22:38:58+09:00",
				"111",
				"あま",
				"333",
				"しー",
				3000,
				3,
				"焼肉",
			),
			"",
		]);
		expect(parseEntries(appended).map((e) => [e.amount, e.split])).toEqual([
			[1000, 1],
			[100, 1],
			[3000, 3],
			[3000, 3],
		]);
	});

	it("split の列がない台帳でも、/ogori の記録なら列を足さない", () => {
		const current = `${OLD_HEADER}\n${row(1, "t", 111, "あま", 222, "びー", 1000, "")}\n`;
		expect(appendEntry(current, entry())).toBe(
			`${current}${row("1001", "2026-11-13T22:38:58+09:00", "111", "あま", "222", "びー", 1200, "ラーメン")}\n`,
		);
	});

	it("列を足すときも、CRLFの改行と先頭のBOMはそのまま残す", () => {
		const current = `\uFEFF${OLD_HEADER}\r\n${row(1, "t", 111, "a", 222, "b", 100, "")}\r\n`;
		const appended = appendEntries(current, warikanEntries()) ?? "";
		expect(appended.startsWith(`\uFEFF${HEADER}\r\n`)).toBe(true);
		expect(appended).toContain(
			`${row(1, "t", 111, "a", 222, "b", 100, "", "")}\r\n`,
		);
		expect(parseEntries(appended)).toHaveLength(3);
	});

	it("人数が正しくない記録は書かない", () => {
		expect(() => appendEntry(null, entry({ split: 0 }))).toThrowError(
			LedgerFormatError,
		);
		expect(() => appendEntry(null, entry({ split: 1.5 }))).toThrowError(
			LedgerFormatError,
		);
	});
});

describe("parseEntries", () => {
	it("今の台帳(ledger/2026-11.tsv)の形の行は、split が1として読める", () => {
		const text = `${OLD_HEADER}\n${row("1571109735795654676", "2026-11-14T19:29:10+09:00", "1148088717907595324", ".4rna", "687896063545180253", "231kari", 1000, "この世")}\n${row("1571148181138571344", "2026-11-14T22:01:56+09:00", "687896063545180253", "231kari", "1148088717907595324", ".4rna", 100, "")}\n`;
		expect(parseEntries(text)).toEqual([
			{
				id: "1571109735795654676",
				recordedAt: "2026-11-14T19:29:10+09:00",
				payerId: "1148088717907595324",
				payerName: ".4rna",
				debtorId: "687896063545180253",
				debtorName: "231kari",
				amount: 1000,
				split: 1,
				memo: "この世",
			},
			{
				id: "1571148181138571344",
				recordedAt: "2026-11-14T22:01:56+09:00",
				payerId: "687896063545180253",
				payerName: "231kari",
				debtorId: "1148088717907595324",
				debtorName: ".4rna",
				amount: 100,
				split: 1,
				memo: "",
			},
		]);
	});

	it("割り勘の行を読み戻せる", () => {
		const text = appendEntries(appendEntry(null, entry()), warikanEntries());
		expect(parseEntries(text ?? "")).toEqual([entry(), ...warikanEntries()]);
	});

	it("split の値が空の行は1、正しくない行はエラーにする", () => {
		const ok = `${HEADER}\n${row(1, "t", 111, "a", 222, "b", 100, "", "")}\n`;
		expect(parseEntries(ok)[0]?.split).toBe(1);
		const ng = `${HEADER}\n${row(1, "t", 111, "a", 222, "b", 100, "", "")}\n${row(2, "t", 111, "a", 222, "b", 100, "0", "")}\n`;
		expect(() => parseEntries(ng)).toThrowError(/^3行目: split/);
	});

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

describe("summarizeRecords", () => {
	it("割り勘の行は同じidで1件と数え、金額は割る前の金額を1回だけ足す", () => {
		expect(
			summarizeRecords([entry(), ...warikanEntries(), entry({ id: "1002" })]),
		).toEqual({ count: 3, total: 1200 + 3000 + 1200 });
		expect(summarizeRecords([])).toEqual({ count: 0, total: 0 });
	});
});

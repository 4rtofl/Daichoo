import { describe, expect, it } from "vitest";
import { formatTsvRow, insertColumn, parseTsv } from "../src/ledger/tsv.ts";

describe("formatTsvRow", () => {
	it("タブで区切る。カンマやダブルクォートはそのまま書く", () => {
		expect(formatTsvRow(["a", "b,c", 'say "hi"', ""])).toBe(
			'a\tb,c\tsay "hi"\t',
		);
	});

	it("値の中のタブと改行は、空白に置き換える", () => {
		expect(formatTsvRow(["x\ty", "改行\r\nあり", "a\n\nb"])).toBe(
			"x y\t改行 あり\ta b",
		);
	});
});

describe("parseTsv", () => {
	it("書いた行を、そのまま読み戻せる", () => {
		const values = ["1", "ラーメン, 餃子", 'たこ"焼き"', ""];
		expect(parseTsv(`${formatTsvRow(values)}\n`)).toEqual([
			{ line: 1, values },
		]);
	});

	it("CRLF、先頭のBOM、空の行、最後の改行がないファイルも読める", () => {
		expect(parseTsv("﻿a\tb\r\n\r\n1\t2\r\n3\t4")).toEqual([
			{ line: 1, values: ["a", "b"] },
			{ line: 3, values: ["1", "2"] },
			{ line: 4, values: ["3", "4"] },
		]);
	});

	it("空のファイルは、行なしとして読む", () => {
		expect(parseTsv("")).toEqual([]);
		expect(parseTsv("\n\n")).toEqual([]);
	});
});

describe("insertColumn", () => {
	it("見出しに列を足し、ほかの行には同じ位置に空の値を足す", () => {
		expect(insertColumn("a\tb\tc\n1\t2\t3\n", 2, "x")).toBe(
			"a\tb\tx\tc\n1\t2\t\t3\n",
		);
	});

	it("値が足りない行と空の行は変えない", () => {
		expect(insertColumn("a\tb\tc\n1\t2\n\n4\t5\t6", 2, "x")).toBe(
			"a\tb\tx\tc\n1\t2\n\n4\t5\t\t6",
		);
	});

	it("値が多い行も、足す位置より後ろの値をずらす", () => {
		expect(insertColumn("a\tb\n1\t2\t9\n", 1, "x")).toBe(
			"a\tx\tb\n1\t\t2\t9\n",
		);
	});

	it("改行の種類と先頭のBOMを残す", () => {
		expect(insertColumn("\uFEFFa\tb\r\n1\t2\r\n", 1, "x")).toBe(
			"\uFEFFa\tx\tb\r\n1\t\t2\r\n",
		);
	});
});

/*
 * TSV(タブ区切り)の読み書き。台帳はGitHubの画面で表として読めるよう、TSVで持つ。
 * TSVには値を囲む書き方がないので、値にタブと改行は入れられない。書くときは空白に置き換える。
 * GitHubの画面で手で直された場合にも読めるよう、CRLFの改行と、先頭のBOMも受け付ける。
 */

const BOM = "\uFEFF";

/** TSVの1行。lineは、ファイルでのその行の行番号(1から数える) */
export interface TsvRow {
	line: number;
	values: string[];
}

/** 1行分の値を、TSVの1行にする。値の中のタブと改行は、空白に置き換える */
export function formatTsvRow(values: readonly string[]): string {
	return values.map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t");
}

/** TSVの文字列を、行ごとの値の配列にする。空の行は飛ばす */
export function parseTsv(text: string): TsvRow[] {
	const body = text.startsWith(BOM) ? text.slice(1) : text;
	return body
		.split(/\r\n|\n|\r/)
		.flatMap((line, index) =>
			line.trim() === "" ? [] : [{ line: index + 1, values: line.split("\t") }],
		);
}

/**
 * TSVの見出しの行のindex番目に列nameを足し、2行目からの行には、同じ位置に空の値を足す。
 * 行の値がindex個以下の行は、その列がもともと空として読まれるので、変えない。
 * 改行の種類、空の行、先頭のBOMは、そのまま残す。
 */
export function insertColumn(
	text: string,
	index: number,
	name: string,
): string {
	let isHeader = true;
	// 分けた結果は、偶数番目が行、奇数番目が改行になる
	return text
		.split(/(\r\n|\n|\r)/)
		.map((part, i) => {
			if (i % 2 === 1 || part.trim() === "") {
				return part;
			}
			const bom = isHeader && part.startsWith(BOM) ? BOM : "";
			const values = part.slice(bom.length).split("\t");
			const value = isHeader ? name : "";
			isHeader = false;
			if (values.length <= index && value === "") {
				return part;
			}
			values.splice(index, 0, value);
			return bom + values.join("\t");
		})
		.join("");
}

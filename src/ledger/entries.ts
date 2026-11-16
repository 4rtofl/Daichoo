import { formatTsvRow, insertColumn, parseTsv, type TsvRow } from "./tsv.ts";

/*
 * 台帳の記録。月ごとのTSV(ledger/2026-11.tsv)に、おごられた人1人を1行として書く。
 * /ogori は1回が1行になる。/warikan は、払った人以外の1人ずつを1行にし、同じ割り勘の行には同じidを書く。
 * 月は、記録した時刻の日本時間で決める。
 */

/** 台帳を置くフォルダ(リポジトリのルートからのパス) */
export const LEDGER_DIR = "ledger";

/** 金額の上限(円)。桁を打ち間違えたときに、そのまま記録しないため */
export const MAX_AMOUNT = 1_000_000;

/** 割り勘の人数(split)の上限。台帳を手で直したときの打ち間違いを見つけるため */
export const MAX_SPLIT = 100;

/** 台帳の1行の記録 */
export interface LedgerEntry {
	/** 記録したInteraction(コマンドの実行)のID。同じ記録を二重に書かないための目印にもする */
	id: string;
	/** 記録した時刻(日本時間のISO 8601) */
	recordedAt: string;
	/** おごった人のDiscordのユーザーID */
	payerId: string;
	/** おごった人の表示名(記録した時点のもの。GitHubで台帳を読む人のために書く) */
	payerName: string;
	/** おごられた人のDiscordのユーザーID */
	debtorId: string;
	/** おごられた人の表示名(記録した時点のもの) */
	debtorName: string;
	/** 金額(円)。割り勘では、割る前の金額 */
	amount: number;
	/**
	 * 割った人数。おごられた人の分は amount ÷ split 円になる。
	 * /ogori の記録は1。台帳に split の列がない、または空なら1として読む
	 */
	split: number;
	/** 何をおごったか。なければ空 */
	memo: string;
}

/** TSVの列。1行目に、この名前を見出しとして書く */
const COLUMNS = {
	id: "id",
	recordedAt: "recorded_at",
	payerId: "payer_id",
	payerName: "payer_name",
	debtorId: "debtor_id",
	debtorName: "debtor_name",
	amount: "amount",
	split: "split",
	memo: "memo",
} as const satisfies Record<keyof LedgerEntry, string>;

type ColumnKey = keyof typeof COLUMNS;

const COLUMN_KEYS = Object.keys(COLUMNS) as ColumnKey[];

/** 精算に欠かせない列。memoなどは、手で列を消されても読めるようにしておく */
const REQUIRED_COLUMNS: readonly ColumnKey[] = [
	"id",
	"payerId",
	"debtorId",
	"amount",
];

/**
 * 記録の件数と、金額の合計。割り勘は複数の行になるが、同じIDの行をまとめて1件と数え、
 * 金額は割る前の金額(実行したときに入れた金額)を1回だけ足す。
 */
export function summarizeRecords(entries: readonly LedgerEntry[]): {
	count: number;
	total: number;
} {
	const amounts = new Map<string, number>();
	for (const entry of entries) {
		if (!amounts.has(entry.id)) {
			amounts.set(entry.id, entry.amount);
		}
	}
	let total = 0;
	for (const amount of amounts.values()) {
		total += amount;
	}
	return { count: amounts.size, total };
}

/** その月の台帳のファイルのパス */
export function ledgerPath(month: string): string {
	return `${LEDGER_DIR}/${month}.tsv`;
}

/** 台帳のTSVを読む。中身が正しくない行があれば、行番号を付けてエラーにする */
export function parseEntries(text: string): LedgerEntry[] {
	const [header, ...rows] = parseTsv(text);
	if (!header) {
		return [];
	}
	return readRows(readHeader(header.values), rows);
}

function readRows(
	columns: Map<ColumnKey, number>,
	rows: readonly TsvRow[],
): LedgerEntry[] {
	return rows.map((row) => {
		const value = (key: ColumnKey) => {
			const index = columns.get(key);
			return index === undefined ? "" : (row.values[index] ?? "").trim();
		};
		const entry: LedgerEntry = {
			id: value("id"),
			recordedAt: value("recordedAt"),
			payerId: value("payerId"),
			payerName: value("payerName"),
			debtorId: value("debtorId"),
			debtorName: value("debtorName"),
			amount: Number(value("amount")),
			split: value("split") === "" ? 1 : Number(value("split")),
			memo: value("memo"),
		};
		const problem = validateEntry(entry);
		if (problem) {
			throw new LedgerFormatError(`${row.line}行目: ${problem}`);
		}
		return entry;
	});
}

/** 台帳のTSVの末尾に、記録を1行足す(appendEntries を1行で使う) */
export function appendEntry(
	current: string | null,
	entry: LedgerEntry,
): string | null {
	return appendEntries(current, [entry]);
}

/**
 * 台帳のTSVの末尾に、記録を足した文字列を返す。ファイルがまだなければ、見出しの行から作る。
 * 足す記録と同じIDの記録がすでにあれば、足さずにnullを返す(書き込みをやり直したときに、二重に記録しないため)。
 * 割り勘の記録は複数の行になるが、同じIDなので、まとめて足すか、まとめて足さないかのどちらかになる。
 * 見出しの列の並びが手で変えられていても、その並びに合わせて書く。
 * 見出しに split の列がない台帳(割り勘を足す前の形)に割り勘を足すときは、amount の後ろに split の列を足す。
 * 今ある行の split は空になり、1として読まれる。
 * 今ある行に正しくないものがあれば、足さずにエラーにする。そのままでは月末の精算が失敗するので、
 * 記録した人に、直す行をすぐ伝えるため。
 */
export function appendEntries(
	current: string | null,
	entries: readonly LedgerEntry[],
): string | null {
	for (const entry of entries) {
		const problem = validateEntry(entry);
		if (problem) {
			throw new LedgerFormatError(problem);
		}
	}
	const rows = (order: readonly (ColumnKey | null)[]) =>
		entries.map((entry) => `${formatEntryRow(entry, order)}\n`).join("");
	if (current === null || current.trim() === "") {
		return `${formatTsvRow(COLUMN_KEYS.map((key) => COLUMNS[key]))}\n${rows(COLUMN_KEYS)}`;
	}

	const [header, ...existingRows] = parseTsv(current);
	if (!header) {
		throw new LedgerFormatError("台帳に見出しの行がありません");
	}
	const columns = readHeader(header.values);
	const existing = readRows(columns, existingRows);
	const ids = new Set(entries.map((entry) => entry.id));
	if (existing.some((e) => ids.has(e.id))) {
		return null;
	}

	let text = current;
	let headerValues = header.values;
	const amountIndex = columns.get("amount");
	if (
		!columns.has("split") &&
		amountIndex !== undefined &&
		entries.some((entry) => entry.split !== 1)
	) {
		text = insertColumn(text, amountIndex + 1, COLUMNS.split);
		headerValues = parseTsv(text)[0]?.values ?? [];
	}
	// 見出しの並びに合わせる。台帳で使っていない列(人が足した列)は空にする
	const order = headerValues.map(
		(name) => COLUMN_KEYS.find((key) => COLUMNS[key] === name.trim()) ?? null,
	);
	const separator = text.endsWith("\n") ? "" : "\n";
	return `${text}${separator}${rows(order)}`;
}

function formatEntryRow(
	entry: LedgerEntry,
	order: readonly (ColumnKey | null)[],
): string {
	return formatTsvRow(
		order.map((key) => (key === null ? "" : String(entry[key]))),
	);
}

/** 見出しの行から、列ごとの位置を調べる。精算に欠かせない列がなければエラーにする */
function readHeader(names: readonly string[]): Map<ColumnKey, number> {
	const columns = new Map<ColumnKey, number>();
	names.forEach((name, index) => {
		const key = COLUMN_KEYS.find((k) => COLUMNS[k] === name.trim());
		if (key && !columns.has(key)) {
			columns.set(key, index);
		}
	});
	const missing = REQUIRED_COLUMNS.filter((key) => !columns.has(key));
	if (missing.length > 0) {
		throw new LedgerFormatError(
			`1行目: 見出しに ${missing.map((key) => COLUMNS[key]).join(", ")} の列がありません`,
		);
	}
	return columns;
}

/** 記録の中身が正しいかを確かめる。正しくなければ、その理由を返す */
function validateEntry(entry: LedgerEntry): string | null {
	if (entry.id === "") {
		return "id が空です";
	}
	if (!/^\d+$/.test(entry.payerId) || !/^\d+$/.test(entry.debtorId)) {
		return "payer_id と debtor_id には、DiscordのユーザーIDを書いてください";
	}
	if (entry.payerId === entry.debtorId) {
		return "payer_id と debtor_id が同じです";
	}
	if (
		!Number.isSafeInteger(entry.amount) ||
		entry.amount < 1 ||
		entry.amount > MAX_AMOUNT
	) {
		return `amount は1から${MAX_AMOUNT}までの整数にしてください`;
	}
	if (
		!Number.isSafeInteger(entry.split) ||
		entry.split < 1 ||
		entry.split > MAX_SPLIT
	) {
		return `split は1から${MAX_SPLIT}までの整数にしてください(空なら1として読みます)`;
	}
	return null;
}

/** 台帳の中身が正しくない */
export class LedgerFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LedgerFormatError";
	}
}

/*
 * 日時の扱い。台帳は日本時間で月を区切る。
 * 日本には夏時間がないので、UTCとの差は常に9時間として計算する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** DiscordのID(snowflake)の時刻の起点(2015-01-01T00:00:00Z) */
const DISCORD_EPOCH_MS = 1420070400000n;

/** 「2026-11」の形の月 */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** DiscordのIDから、IDが作られた時刻を取り出す。InteractionのIDなら、コマンドが実行された時刻になる */
export function snowflakeToDate(id: string): Date {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS));
}

/** 日本時間での年と月を「2026-11」の形で返す */
export function monthOf(date: Date): string {
	const jst = new Date(date.getTime() + JST_OFFSET_MS);
	return formatMonth(jst.getUTCFullYear(), jst.getUTCMonth() + 1);
}

/** 「2026-11」の形になっているか */
export function isMonth(text: string): boolean {
	return MONTH_PATTERN.test(text);
}

/** 前の月。「2026-01」なら「2025-12」 */
export function previousMonth(month: string): string {
	const { year, monthNumber } = parseMonth(month);
	return monthNumber === 1
		? formatMonth(year - 1, 12)
		: formatMonth(year, monthNumber - 1);
}

/** Discordに表示する月の書き方。「2026-11」なら「2026年11月」 */
export function monthLabel(month: string): string {
	const { year, monthNumber } = parseMonth(month);
	return `${year}年${monthNumber}月`;
}

/** 日本時間のISO 8601の形で書く(例: 2026-11-13T22:38:58+09:00) */
export function formatJst(date: Date): string {
	const jst = new Date(date.getTime() + JST_OFFSET_MS);
	return jst.toISOString().replace(/\.\d{3}Z$/, "+09:00");
}

function parseMonth(month: string): { year: number; monthNumber: number } {
	const match = MONTH_PATTERN.exec(month);
	if (!match) {
		throw new Error(`月は「2026-11」の形で指定してください: ${month}`);
	}
	return { year: Number(match[1]), monthNumber: Number(match[2]) };
}

function formatMonth(year: number, monthNumber: number): string {
	return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

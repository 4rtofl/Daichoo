import type {
	APIEmbed,
	APIEmbedField,
	RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { SETTLEMENT_TEXTS } from "../texts.ts";
import { type LedgerEntry, summarizeRecords } from "./entries.ts";
import { compareIds, type Transfer } from "./settlement.ts";

/*
 * 精算の結果を、Discordに送るメッセージ(埋め込み)にする。
 * 記録に出てくる人ごとに1つのFieldを作り、その人の支払いを並べる。支払いのない人も「支払いなし」として載せる。
 * Fieldのタイトルではメンションが表示されないので、名前は台帳に記録された表示名で書く。
 */

/** 埋め込みの色(緑)。/channel のお知らせも同じ色にする */
export const EMBED_COLOR = 0x2f855a;

/** 1つの埋め込みに入れられるFieldの数(Discordの上限) */
const MAX_FIELDS = 25;

/** Fieldの値の長さの上限(Discordの上限)。超える人は、Fieldを分ける */
const FIELD_VALUE_LIMIT = 1024;

/**
 * 1つの埋め込みの文字数の上限。Discordの上限(6000文字)より少し短くしておき、
 * 超えるときは、メッセージを分けて送る
 */
const EMBED_LIMIT = 5500;

/** 表示名の長さの上限。台帳を手で直して長い名前が入っても、Discordの上限を超えないようにする */
const NAME_LIMIT = 100;

export interface SettlementReport {
	/** 精算した月(「2026-10」の形) */
	month: string;
	entries: readonly LedgerEntry[];
	transfers: readonly Transfer[];
}

export interface ReportOptions {
	/** 台帳のファイルのURL。あれば、埋め込みのタイトルをそのURLへのリンクにする */
	ledgerFileUrl?: string;
	/** 埋め込みに表示する時刻 */
	now: Date;
	/** trueなら、まだ終わっていない月として、タイトルに「(途中)」を付け、Fieldの上に前置きを書く(/seisan で今月を見たとき) */
	inProgress?: boolean;
}

/** 精算の結果を、送るメッセージの一覧にする。ふつうは1通で、人が多すぎるときだけ分ける */
export function buildSettlementMessages(
	report: SettlementReport,
	options: ReportOptions,
): RESTPostAPIChannelMessageJSONBody[] {
	const { count, total } = summarizeRecords(report.entries);
	const footer = { text: SETTLEMENT_TEXTS.footer(count, total) };
	const suffix = options.inProgress ? SETTLEMENT_TEXTS.inProgressSuffix : "";
	// 終わっていない月は、最初の埋め込みのFieldの上に、前置きを書く
	const intro = options.inProgress
		? SETTLEMENT_TEXTS.inProgressIntro
		: undefined;
	// どの埋め込みにも入りうる、タイトル、前置き、フッターの分の文字数
	const reserved =
		SETTLEMENT_TEXTS.continuedTitle(report.month).length +
		suffix.length +
		(intro?.length ?? 0) +
		footer.text.length;

	const bodies: Pick<APIEmbed, "description" | "fields">[] =
		report.entries.length === 0
			? [{ description: SETTLEMENT_TEXTS.noEntries }]
			: groupFields(buildFields(report), reserved).map((fields, index) => ({
					...(index === 0 && intro ? { description: intro } : {}),
					fields,
				}));

	return bodies.map((body, index) => {
		const embed: APIEmbed = {
			title:
				(index === 0
					? SETTLEMENT_TEXTS.title(report.month)
					: SETTLEMENT_TEXTS.continuedTitle(report.month)) + suffix,
			...body,
			color: EMBED_COLOR,
			footer,
			timestamp: options.now.toISOString(),
		};
		if (index === 0 && options.ledgerFileUrl) {
			embed.url = options.ledgerFileUrl;
		}
		// 埋め込みの中のメンションは通知されないが、念のため、誰にも通知しないと明示する
		return { embeds: [embed], allowed_mentions: { parse: [] } };
	});
}

/**
 * 記録に出てくる人ごとに、支払いを並べたFieldを作る。
 * 支払う額の多い人から並べ、支払いのない人は最後に、名前の順で並べる。
 */
function buildFields(report: SettlementReport): APIEmbedField[] {
	const names = latestNames(report.entries);
	const nameOf = (id: string) => truncate(names.get(id) || id, NAME_LIMIT);
	const byName = (a: string, b: string) =>
		nameOf(a).localeCompare(nameOf(b), "ja") || compareIds(a, b);

	const transfersByPayer = new Map<string, Transfer[]>();
	for (const entry of report.entries) {
		transfersByPayer.set(entry.payerId, []);
		transfersByPayer.set(entry.debtorId, []);
	}
	for (const transfer of report.transfers) {
		transfersByPayer.get(transfer.fromId)?.push(transfer);
	}
	const totalOf = (id: string) =>
		(transfersByPayer.get(id) ?? []).reduce((sum, t) => sum + t.amount, 0);

	const people = [...transfersByPayer.keys()].sort(
		(a, b) => totalOf(b) - totalOf(a) || byName(a, b),
	);
	return people.flatMap((id) => {
		const transfers = [...(transfersByPayer.get(id) ?? [])].sort(
			(a, b) => b.amount - a.amount || byName(a.toId, b.toId),
		);
		const lines =
			transfers.length === 0
				? [SETTLEMENT_TEXTS.noPayment]
				: transfers.map((t) =>
						SETTLEMENT_TEXTS.transfer(escapeMarkdown(nameOf(t.toId)), t.amount),
					);
		return splitLines(lines, FIELD_VALUE_LIMIT).map((value, index) => ({
			name:
				index === 0 ? nameOf(id) : SETTLEMENT_TEXTS.continuedField(nameOf(id)),
			value,
			inline: false,
		}));
	});
}

/** 人ごとの表示名。台帳の後ろの行(新しい記録)の名前を使う。名前が空の行は使わない */
function latestNames(entries: readonly LedgerEntry[]): Map<string, string> {
	const names = new Map<string, string>();
	for (const entry of entries) {
		if (entry.payerName) {
			names.set(entry.payerId, entry.payerName);
		}
		if (entry.debtorName) {
			names.set(entry.debtorId, entry.debtorName);
		}
	}
	return names;
}

/** Fieldを、Discordの上限に収まるように、埋め込みごとのまとまりに分ける */
function groupFields(
	fields: readonly APIEmbedField[],
	reserved: number,
): APIEmbedField[][] {
	const groups: APIEmbedField[][] = [];
	let current: APIEmbedField[] = [];
	let size = reserved;
	for (const field of fields) {
		const fieldSize = field.name.length + field.value.length;
		if (
			current.length > 0 &&
			(current.length >= MAX_FIELDS || size + fieldSize > EMBED_LIMIT)
		) {
			groups.push(current);
			current = [];
			size = reserved;
		}
		current.push(field);
		size += fieldSize;
	}
	if (current.length > 0) {
		groups.push(current);
	}
	return groups;
}

/** 行を、1つあたりlimit文字以内のまとまりに分ける。行の途中では分けない */
function splitLines(lines: readonly string[], limit: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const line of lines) {
		const next = current === "" ? line : `${current}\n${line}`;
		if (next.length > limit && current !== "") {
			chunks.push(current);
			current = line;
		} else {
			current = next;
		}
	}
	if (current !== "") {
		chunks.push(current);
	}
	return chunks;
}

/**
 * 名前に含まれるDiscordの書式の記号(太字、斜体、リンク、メンションなど)を、そのまま表示されるようにする。
 * Fieldの値では書式が効くので、名前を値に書くときに使う
 */
function escapeMarkdown(text: string): string {
	return text.replace(/[\\*_~`|[\]<]/g, "\\$&");
}

function truncate(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

import type {
	APIEmbed,
	RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { SETTLEMENT_TEXTS } from "../texts.ts";
import type { LedgerEntry } from "./entries.ts";
import type { Transfer } from "./settlement.ts";

/*
 * 精算の結果を、Discordに送るメッセージ(埋め込み)にする。
 */

/** 埋め込みの色(緑)。/channel のお知らせも同じ色にする */
export const EMBED_COLOR = 0x2f855a;

/**
 * 埋め込みの説明文の長さの上限。Discordの上限(4096文字)より少し短くしておき、
 * 超えるときは、メッセージを分けて送る
 */
const DESCRIPTION_LIMIT = 3800;

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
	/** trueなら、まだ終わっていない月として、タイトルと前置きを変える(/seisan で今月を見たとき) */
	inProgress?: boolean;
}

/** 精算の結果を、送るメッセージの一覧にする。ふつうは1通で、長すぎるときだけ分ける */
export function buildSettlementMessages(
	report: SettlementReport,
	options: ReportOptions,
): RESTPostAPIChannelMessageJSONBody[] {
	const total = report.entries.reduce((sum, entry) => sum + entry.amount, 0);
	const footer = {
		text: SETTLEMENT_TEXTS.footer(report.entries.length, total),
	};

	let lines: string[];
	if (report.entries.length === 0) {
		lines = [SETTLEMENT_TEXTS.noEntries];
	} else if (report.transfers.length === 0) {
		lines = [SETTLEMENT_TEXTS.balanced];
	} else {
		lines = [
			options.inProgress
				? SETTLEMENT_TEXTS.inProgressIntro
				: SETTLEMENT_TEXTS.intro,
			"",
			...report.transfers.map((transfer) =>
				SETTLEMENT_TEXTS.transfer(
					transfer.fromId,
					transfer.toId,
					transfer.amount,
				),
			),
			"",
			SETTLEMENT_TEXTS.note,
		];
	}

	const suffix = options.inProgress ? SETTLEMENT_TEXTS.inProgressSuffix : "";
	return splitLines(lines, DESCRIPTION_LIMIT).map((description, index) => {
		const embed: APIEmbed = {
			title:
				(index === 0
					? SETTLEMENT_TEXTS.title(report.month)
					: SETTLEMENT_TEXTS.continuedTitle(report.month)) + suffix,
			description,
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

/** 行を、1つあたりlimit文字以内のまとまりに分ける。行の途中では分けない */
function splitLines(lines: readonly string[], limit: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const line of lines) {
		const next = current === "" ? line : `${current}\n${line}`;
		if (next.length > limit && current !== "") {
			chunks.push(current.trim());
			current = line;
		} else {
			current = next;
		}
	}
	if (current.trim() !== "") {
		chunks.push(current.trim());
	}
	return chunks;
}

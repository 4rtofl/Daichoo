import type { APIInteractionResponse } from "discord-api-types/v10";
import {
	type LedgerEntry,
	LedgerFormatError,
	ledgerPath,
	parseEntries,
} from "../ledger/entries.ts";
import { buildSettlementMessages } from "../ledger/report.ts";
import { computeBalances, computeTransfers } from "../ledger/settlement.ts";
import { SEISAN_TEXTS } from "../texts.ts";
import { isMonth, monthOf, snowflakeToDate } from "../time.ts";
import { SEISAN } from "./commands.ts";
import {
	type CommandContext,
	ephemeral,
	findOption,
	respondLater,
} from "./context.ts";

/**
 * /seisan: 台帳から、その月の精算の結果を、毎月1日に送るものと同じ形で作り、実行した本人にだけ見せる。
 * 月を省略すると今月(日本時間)。今月は、タイトルに「(途中)」を付ける。
 */
export function handleSeisan(context: CommandContext): APIInteractionResponse {
	const { interaction, github } = context;
	const now = snowflakeToDate(interaction.id);
	const thisMonth = monthOf(now);
	const option = findOption(interaction, SEISAN.month);
	const month = typeof option === "string" ? option.trim() : thisMonth;
	if (!isMonth(month)) {
		return ephemeral(SEISAN_TEXTS.invalidMonth);
	}
	// 「2026-10」の形どうしなので、文字列の大小が月の前後になる
	if (month > thisMonth) {
		return ephemeral(SEISAN_TEXTS.futureMonth);
	}
	const path = ledgerPath(month);

	return respondLater(
		context,
		{ ephemeral: true },
		async () => {
			const file = await github.getFile(path);
			let entries: LedgerEntry[];
			try {
				entries = file === null ? [] : parseEntries(file.content);
			} catch (error) {
				if (error instanceof LedgerFormatError) {
					return SEISAN_TEXTS.brokenLedger(path, error.message);
				}
				throw error;
			}
			const transfers = computeTransfers(computeBalances(entries));
			const messages = buildSettlementMessages(
				{ month, entries, transfers },
				{
					now,
					inProgress: month === thisMonth,
					ledgerFileUrl: file === null ? undefined : github.fileUrl(path),
				},
			);
			return { embeds: messages.flatMap((message) => message.embeds ?? []) };
		},
		SEISAN_TEXTS.failed,
	);
}

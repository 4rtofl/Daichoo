import type { APIInteractionResponse } from "discord-api-types/v10";
import {
	appendEntry,
	type LedgerEntry,
	LedgerFormatError,
	ledgerPath,
	MAX_AMOUNT,
} from "../ledger/entries.ts";
import { COMMON_TEXTS, formatYen, OGORI_TEXTS } from "../texts.ts";
import { formatJst, monthOf, snowflakeToDate } from "../time.ts";
import { MAX_MEMO_LENGTH, OGORI } from "./commands.ts";
import {
	type CommandContext,
	displayName,
	ephemeral,
	findOption,
	respondLater,
} from "./context.ts";

/**
 * /ogori: 実行した人が、選んだ相手におごったことを、台帳に1行足して記録する。
 * 記録した月(日本時間)のファイルに書く。返事は、チャンネルの全員に見えるようにする。
 */
export function handleOgori(context: CommandContext): APIInteractionResponse {
	const { interaction, github } = context;
	const payer = interaction.member.user;
	const debtorId = findOption(interaction, OGORI.user);
	const amount = findOption(interaction, OGORI.amount);
	const memo = findOption(interaction, OGORI.memo);
	if (typeof debtorId !== "string" || typeof amount !== "number") {
		return ephemeral(COMMON_TEXTS.invalidOptions);
	}
	if (debtorId === payer.id) {
		return ephemeral(OGORI_TEXTS.self);
	}
	const resolved = interaction.data.resolved;
	const debtor = resolved?.users?.[debtorId];
	if (debtor?.bot) {
		return ephemeral(OGORI_TEXTS.bot);
	}
	if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
		return ephemeral(OGORI_TEXTS.invalidAmount(MAX_AMOUNT));
	}

	const recordedAt = snowflakeToDate(interaction.id);
	const entry: LedgerEntry = {
		id: interaction.id,
		recordedAt: formatJst(recordedAt),
		payerId: payer.id,
		payerName: displayName(payer, interaction.member.nick) ?? payer.id,
		debtorId,
		debtorName:
			displayName(debtor, resolved?.members?.[debtorId]?.nick) ?? debtorId,
		amount,
		memo: normalizeMemo(memo),
	};
	const path = ledgerPath(monthOf(recordedAt));

	return respondLater(
		context,
		{ ephemeral: false },
		async () => {
			try {
				// 書き込みをやり直しても、同じIDの記録はappendEntryが二重に足さない
				await github.updateFile(path, commitMessage(entry), (current) =>
					appendEntry(current, entry),
				);
			} catch (error) {
				// 台帳が手で直されて中身が正しくないときは、やり直しても書けないので、直す場所を伝える
				if (error instanceof LedgerFormatError) {
					return OGORI_TEXTS.brokenLedger(path, error.message);
				}
				throw error;
			}
			return OGORI_TEXTS.recorded(entry);
		},
		OGORI_TEXTS.failed,
	);
}

/** メモの改行や連続した空白を1つの空白にまとめる */
function normalizeMemo(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	return value.replace(/\s+/g, " ").trim().slice(0, MAX_MEMO_LENGTH);
}

/** 記録のコミットメッセージ。1行目で中身が分かるようにし、IDは本文に書く */
function commitMessage(entry: LedgerEntry): string {
	const memo = entry.memo ? `(${entry.memo})` : "";
	return [
		`おごり: ${entry.payerName} → ${entry.debtorName} ${formatYen(entry.amount)}${memo}`,
		"",
		`payer: ${entry.payerId}`,
		`debtor: ${entry.debtorId}`,
		`interaction: ${entry.id}`,
	].join("\n");
}

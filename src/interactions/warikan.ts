import type { APIInteractionResponse } from "discord-api-types/v10";
import {
	appendEntries,
	type LedgerEntry,
	LedgerFormatError,
	ledgerPath,
	MAX_AMOUNT,
} from "../ledger/entries.ts";
import { roundHalfEven } from "../ledger/settlement.ts";
import { COMMON_TEXTS, formatYen, WARIKAN_TEXTS } from "../texts.ts";
import { formatJst, monthOf, snowflakeToDate } from "../time.ts";
import { WARIKAN } from "./commands.ts";
import {
	type CommandContext,
	displayName,
	ephemeral,
	findOption,
	normalizeMemo,
	respondLater,
} from "./context.ts";

/**
 * /warikan: 実行した人が払った金額を、実行した人と選んだ相手の人数で割り勘したことを、台帳に記録する。
 * 選んだ相手1人ずつを1行にし、どの行にも、割る前の金額(amount)と人数(split)を書く。
 * 1人分(amount ÷ split)は割り切れなくてもそのまま記録し、月末の精算で端数を足し合わせてから丸める。
 *
 * 同じ人を2回選んだり、自分を選んだりしても、1人として数える(実行した人は、選ばなくても人数に入る)。
 * 返事は、/ogori と同じく、チャンネルの全員に見えるようにする。
 */
export function handleWarikan(context: CommandContext): APIInteractionResponse {
	const { interaction, github } = context;
	const payer = interaction.member.user;
	const amount = findOption(interaction, WARIKAN.amount);
	const memo = normalizeMemo(findOption(interaction, WARIKAN.memo));
	const selected = WARIKAN.users.map((name) => findOption(interaction, name));
	if (
		typeof amount !== "number" ||
		selected.some((id) => id !== undefined && typeof id !== "string")
	) {
		return ephemeral(COMMON_TEXTS.invalidOptions);
	}
	const debtorIds = [
		...new Set(
			selected.filter(
				(id): id is string => typeof id === "string" && id !== payer.id,
			),
		),
	];
	if (debtorIds.length === 0) {
		return ephemeral(WARIKAN_TEXTS.noOthers);
	}
	const resolved = interaction.data.resolved;
	if (debtorIds.some((id) => resolved?.users?.[id]?.bot)) {
		return ephemeral(WARIKAN_TEXTS.bot);
	}
	if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
		return ephemeral(WARIKAN_TEXTS.invalidAmount(MAX_AMOUNT));
	}

	const split = debtorIds.length + 1;
	const recordedAt = snowflakeToDate(interaction.id);
	const base = {
		id: interaction.id,
		recordedAt: formatJst(recordedAt),
		payerId: payer.id,
		payerName: displayName(payer, interaction.member.nick) ?? payer.id,
		amount,
		split,
		memo,
	};
	const entries: LedgerEntry[] = debtorIds.map((debtorId) => ({
		...base,
		debtorId,
		debtorName:
			displayName(
				resolved?.users?.[debtorId],
				resolved?.members?.[debtorId]?.nick,
			) ?? debtorId,
	}));
	const path = ledgerPath(monthOf(recordedAt));

	return respondLater(
		context,
		{ ephemeral: false },
		async () => {
			try {
				// 書き込みをやり直しても、同じIDの記録はappendEntriesが二重に足さない
				await github.updateFile(path, commitMessage(entries), (current) =>
					appendEntries(current, entries),
				);
			} catch (error) {
				// 台帳が手で直されて中身が正しくないときは、やり直しても書けないので、直す場所を伝える
				if (error instanceof LedgerFormatError) {
					return WARIKAN_TEXTS.brokenLedger(path, error.message);
				}
				throw error;
			}
			return WARIKAN_TEXTS.recorded({
				payerId: payer.id,
				debtorIds,
				amount,
				split,
				share: roundHalfEven(BigInt(amount), BigInt(split)),
				exact: amount % split === 0,
				memo,
			});
		},
		WARIKAN_TEXTS.failed,
	);
}

/** 記録のコミットメッセージ。1行目で中身が分かるようにし、IDは本文に書く */
function commitMessage(entries: readonly LedgerEntry[]): string {
	const [first] = entries;
	if (!first) {
		throw new Error("割り勘の記録がありません");
	}
	const memo = first.memo ? `(${first.memo})` : "";
	const debtorNames = entries.map((e) => e.debtorName).join(", ");
	return [
		`割り勘: ${first.payerName} → ${debtorNames} ${formatYen(first.amount)}を${first.split}人で${memo}`,
		"",
		`payer: ${first.payerId}`,
		`debtors: ${entries.map((e) => e.debtorId).join(", ")}`,
		`interaction: ${first.id}`,
	].join("\n");
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { DiscordApi } from "../src/discord/api.ts";
import type { Fetch } from "../src/http.ts";
import {
	ledgerPath,
	parseEntries,
	summarizeRecords,
} from "../src/ledger/entries.ts";
import { buildSettlementMessages } from "../src/ledger/report.ts";
import { parseSettings, SETTINGS_PATH } from "../src/ledger/settings.ts";
import { computeBalances, computeTransfers } from "../src/ledger/settlement.ts";
import { isMonth, monthLabel, monthOf, previousMonth } from "../src/time.ts";

/*
 * 月ごとの精算の中身(scripts/settle.ts から呼ぶ)。テストできるよう、入出力は引数で受け取る。
 */

export interface SettleOptions {
	/** リポジトリのルート(ledger/ があるフォルダ) */
	rootDir: string;
	/** 精算する月(「2026-10」の形)。省略すると、nowの前の月(日本時間) */
	month?: string;
	/** trueなら、Discordには送らず、送る内容をログに出すだけにする */
	dryRun: boolean;
	/** Botのトークン(送るときに要る) */
	botToken?: string;
	/** GitHubでファイルを開くURLの、パスの手前までの部分(例: https://github.com/4rtofl/Daichoo/blob/<コミット>) */
	blobBaseUrl?: string;
	now: Date;
	fetch: Fetch;
	log: (message: string) => void;
}

export interface SettleResult {
	month: string;
	/** 送ったチャンネル。送らなかったらnull */
	channelId: string | null;
	messages: RESTPostAPIChannelMessageJSONBody[];
}

/** 台帳から、その月の支払いの一覧を作り、設定したチャンネルに送る */
export async function settle(options: SettleOptions): Promise<SettleResult> {
	const month = options.month || previousMonth(monthOf(options.now));
	if (!isMonth(month)) {
		throw new SettleError(
			`精算する月は「2026-10」の形で指定してください: ${month}`,
		);
	}

	const path = ledgerPath(month);
	const text = readIfExists(join(options.rootDir, path));
	const entries = text === null ? [] : withPath(path, () => parseEntries(text));
	const transfers = computeTransfers(computeBalances(entries));
	const messages = buildSettlementMessages(
		{ month, entries, transfers },
		{
			now: options.now,
			ledgerFileUrl:
				text !== null && options.blobBaseUrl
					? `${options.blobBaseUrl}/${path}`
					: undefined,
		},
	);

	options.log(
		`${monthLabel(month)}: 記録 ${summarizeRecords(entries).count}件、支払い ${transfers.length}件`,
	);
	for (const transfer of transfers) {
		options.log(
			`  ${transfer.fromId} → ${transfer.toId}: ${transfer.amount}円`,
		);
	}

	const settingsText = readIfExists(join(options.rootDir, SETTINGS_PATH));
	const settings =
		settingsText === null
			? {}
			: withPath(SETTINGS_PATH, () => parseSettings(settingsText));
	const channelId = settings.settlementChannel?.id;

	if (options.dryRun) {
		options.log(`送り先: ${channelId ? `チャンネル ${channelId}` : "未設定"}`);
		options.log(JSON.stringify(messages, null, 2));
		return { month, channelId: null, messages };
	}
	if (!channelId) {
		throw new SettleError(
			"精算の結果を送るチャンネルが、まだ設定されていません。Discordで /channel を実行して設定してください。",
		);
	}
	if (!options.botToken) {
		throw new SettleError(
			"DISCORD_BOT_TOKEN がありません。GitHubのリポジトリのシークレットに設定してください。",
		);
	}

	const discord = new DiscordApi(options.fetch, options.botToken);
	for (const message of messages) {
		await discord.createMessage(channelId, message);
	}
	options.log(`チャンネル ${channelId} に送りました`);
	return { month, channelId, messages };
}

/** 精算を続けられない */
export class SettleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SettleError";
	}
}

function readIfExists(file: string): string | null {
	return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** 読み取りのエラーに、どのファイルかを付ける */
function withPath<T>(path: string, read: () => T): T {
	try {
		return read();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SettleError(`${path}: ${message}`);
	}
}

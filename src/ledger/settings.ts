import { LEDGER_DIR, LedgerFormatError } from "./entries.ts";

/*
 * 台帳の設定(ledger/settings.json)。Discordの /channel で書き換え、月ごとの精算で読む。
 */

export const SETTINGS_PATH = `${LEDGER_DIR}/settings.json`;

export interface LedgerSettings {
	/** 毎月の精算の結果を送るチャンネル。nameは設定した時点の名前で、GitHubで読む人のために書く */
	settlementChannel?: { id: string; name: string };
}

/** 設定のJSONを読む */
export function parseSettings(text: string): LedgerSettings {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new LedgerFormatError(`${SETTINGS_PATH} がJSONとして読めません`);
	}
	if (!isRecord(data)) {
		throw new LedgerFormatError(
			`${SETTINGS_PATH} がJSONのオブジェクトではありません`,
		);
	}
	const channel = data.settlementChannel;
	if (channel === undefined) {
		return {};
	}
	if (
		!isRecord(channel) ||
		typeof channel.id !== "string" ||
		!/^\d+$/.test(channel.id)
	) {
		throw new LedgerFormatError(
			`${SETTINGS_PATH} の settlementChannel.id には、DiscordのチャンネルIDを書いてください`,
		);
	}
	return {
		settlementChannel: {
			id: channel.id,
			name: typeof channel.name === "string" ? channel.name : "",
		},
	};
}

/**
 * 精算の結果の送り先を書き換えた、設定のJSONを返す。設定がまだなければ作る。
 * ほかの項目(人が書き足したものも含む)は、そのまま残す。中身が変わらないならnullを返す。
 */
export function updateSettlementChannel(
	current: string | null,
	channel: { id: string; name: string },
): string | null {
	let data: Record<string, unknown> = {};
	if (current !== null && current.trim() !== "") {
		// 送り先は置き換えるので、今の送り先の書き方が正しくなくてもよい。
		// JSONとして読めないときは、人が書いた中身を消さないよう、書き換えずにエラーにする
		let parsed: unknown;
		try {
			parsed = JSON.parse(current);
		} catch {
			throw new LedgerFormatError(`${SETTINGS_PATH} がJSONとして読めません`);
		}
		if (!isRecord(parsed)) {
			throw new LedgerFormatError(
				`${SETTINGS_PATH} がJSONのオブジェクトではありません`,
			);
		}
		data = parsed;
	}
	const next = `${JSON.stringify({ ...data, settlementChannel: channel }, null, "\t")}\n`;
	return next === current ? null : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

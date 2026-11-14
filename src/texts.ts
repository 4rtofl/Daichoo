import { monthLabel } from "./time.ts";

/*
 * Discordに表示する文言。言い回しを変えるときは、ここを直す。
 */

/** 金額の書き方。1200なら「1,200円」 */
export function formatYen(amount: number): string {
	return `${amount.toLocaleString("ja-JP")}円`;
}

/** スラッシュコマンドの説明(コマンドの名前は src/interactions/commands.ts) */
export const COMMAND_TEXTS = {
	ogori: {
		description: "おごった相手と金額の記録",
		user: "おごった相手",
		amount: "金額(円)",
		memo: "何をおごったか(省略できる)",
	},
	channel: {
		description: "毎月の精算の結果を送るチャンネルの設定(サーバー管理者用)",
		channel: "精算の結果を送るチャンネル",
	},
} as const;

/** /ogori の返事 */
export const OGORI_TEXTS = {
	recorded: (entry: {
		payerId: string;
		debtorId: string;
		amount: number;
		memo: string;
	}) =>
		`<@${entry.payerId}> が <@${entry.debtorId}> に **${formatYen(entry.amount)}** おごりました${entry.memo ? `(${entry.memo})` : ""}。台帳に記録しました。`,
	failed:
		"台帳に記録できませんでした。少し待ってから、もう一度 /ogori を実行してください。",
	brokenLedger: (path: string, detail: string) =>
		`台帳のファイル ${path} の書き方が正しくないため、記録できませんでした(${detail})。GitHubでファイルを直してから、もう一度 /ogori を実行してください。`,
	self: "自分へのおごりは記録できません。",
	bot: "Botへのおごりは記録できません。",
	invalidAmount: (max: number) =>
		`金額は、1円から${formatYen(max)}までの整数で指定してください。`,
} as const;

/** /channel の返事と、送り先のチャンネルへのお知らせ */
export const CHANNEL_TEXTS = {
	saved: (channelId: string) =>
		`毎月の精算の結果を、<#${channelId}> に送るように設定しました。`,
	notWritable: (channelId: string) =>
		`<#${channelId}> にメッセージを送れませんでした。このチャンネルで、Botに「チャンネルを見る」「メッセージを送信」「埋め込みリンク」の権限があるか確かめてください。`,
	failed:
		"設定を保存できませんでした。少し待ってから、もう一度 /channel を実行してください。",
	noticeTitle: "精算の結果の送り先",
	noticeDescription: (userId: string) =>
		`毎月1日に、前の月の精算の結果をこのチャンネルに送ります。\n設定した人: <@${userId}>`,
} as const;

/** どのコマンドにも共通の返事 */
export const COMMON_TEXTS = {
	wrongGuild: "このサーバーでは使えません。",
	unknownCommand: "このコマンドには対応していません。",
	invalidOptions:
		"コマンドの入力を読み取れませんでした。もう一度実行してください。",
	error:
		"うまく処理できませんでした。少し待ってから、もう一度実行してください。",
} as const;

/** 毎月の精算の結果(埋め込み) */
export const SETTLEMENT_TEXTS = {
	title: (month: string) => `${monthLabel(month)}の精算`,
	continuedTitle: (month: string) => `${monthLabel(month)}の精算(続き)`,
	intro: "次のとおり支払ってください。",
	transfer: (fromId: string, toId: string, amount: number) =>
		`<@${fromId}> から <@${toId}> へ **${formatYen(amount)}**`,
	note: "支払いの回数が少なくなるように、貸し借りをまとめています。",
	noEntries: "この月の記録はありません。",
	balanced:
		"おごった額とおごられた額が、全員で釣り合っています。支払いはありません。",
	footer: (entryCount: number, total: number) =>
		`記録 ${entryCount}件、合計 ${formatYen(total)}`,
} as const;

// 月ごとの精算。台帳(ledger/)の前の月の記録から支払いの一覧を作り、/channel で設定したチャンネルに送る。
// 使い方: node scripts/settle.ts [--month 2026-10] [--dry-run]
// GitHub Actions(.github/workflows/settle.yml)が、毎月1日に実行する。依存パッケージは要らない。
//
// 環境変数:
//   DISCORD_BOT_TOKEN  Botのトークン(--dry-run なら要らない)
//   SETTLE_MONTH       --month と同じ(GitHub Actionsの手動実行の入力を渡す)
//   SETTLE_DRY_RUN     "true" なら --dry-run と同じ
//   LEDGER_BLOB_URL    GitHubでファイルを開くURLの、パスの手前まで。埋め込みのタイトルを台帳へのリンクにする

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultFetch } from "../src/http.ts";
import { settle } from "./settle-lib.ts";

const { values } = parseArgs({
	options: {
		month: { type: "string" },
		"dry-run": { type: "boolean", default: false },
	},
	strict: true,
});

const env = process.env;
try {
	await settle({
		rootDir: resolve(import.meta.dirname, ".."),
		month: values.month || env.SETTLE_MONTH || undefined,
		dryRun: values["dry-run"] || env.SETTLE_DRY_RUN === "true",
		botToken: env.DISCORD_BOT_TOKEN || undefined,
		blobBaseUrl: env.LEDGER_BLOB_URL || undefined,
		now: new Date(),
		fetch: defaultFetch,
		log: (message) => console.log(message),
	});
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	// GitHub Actionsでは、実行結果の画面にエラーとして表示する
	console.error(
		env.GITHUB_ACTIONS === "true" ? `::error::${message}` : message,
	);
	process.exitCode = 1;
}

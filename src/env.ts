/** Workerの環境変数とシークレット(wrangler.jsonc の vars と secrets) */
export interface Env {
	/** Developer Portalの Public Key。Interactionの署名を確かめる */
	DISCORD_PUBLIC_KEY: string;
	/** Botのトークン。/channel で、送り先のチャンネルにお知らせを送る */
	DISCORD_BOT_TOKEN: string;
	/** Botを使うDiscordサーバーのID。ほかのサーバーからのコマンドは受け付けない */
	DISCORD_GUILD_ID: string;
	/** 台帳を置くリポジトリ(「所有者/リポジトリ名」) */
	GITHUB_REPOSITORY: string;
	/** 台帳を書き込むブランチ */
	GITHUB_BRANCH: string;
	/** 台帳に書き込むGitHub AppのClient ID。Botは、このAppとしてコミットする */
	GITHUB_APP_CLIENT_ID: string;
	/** GitHub Appの秘密鍵(PEM) */
	GITHUB_APP_PRIVATE_KEY: string;
}

/** Workerの実行コンテキストのうち、使うものだけ。返事を返した後も、終わるまで処理を続けさせる */
export interface WorkerContext {
	waitUntil(promise: Promise<unknown>): void;
}

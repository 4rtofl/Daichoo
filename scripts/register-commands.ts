// Discordに、このBotのスラッシュコマンド(src/interactions/commands.ts)を登録する。
// wrangler.jsonc の DISCORD_GUILD_ID のサーバーのコマンドとして、一覧で丸ごと置き換える。
// 使い方: pnpm register-commands(.env の DISCORD_APPLICATION_ID と DISCORD_BOT_TOKEN を使う)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DiscordApi } from "../src/discord/api.ts";
import { defaultFetch } from "../src/http.ts";
import { COMMANDS } from "../src/interactions/commands.ts";

const applicationId = requireEnv("DISCORD_APPLICATION_ID");
const botToken = requireEnv("DISCORD_BOT_TOKEN");
const guildId = readGuildId();

const discord = new DiscordApi(defaultFetch, botToken);
const registered = await discord.putGuildCommands(
	applicationId,
	guildId,
	COMMANDS,
);
console.log(
	`サーバー ${guildId} に登録しました: ${registered.map((command) => `/${command.name}`).join(", ")}`,
);

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		fail(
			`環境変数 ${name} がありません。.env に書いてください(.env.example を参照)`,
		);
	}
	return value;
}

/** wrangler.jsonc の vars から、サーバーのIDを読む。Workerが受け付けるサーバーと、必ず同じにするため */
function readGuildId(): string {
	const text = readFileSync(
		resolve(import.meta.dirname, "../wrangler.jsonc"),
		"utf8",
	);
	// 行コメント(行の頭が // のもの)だけを取り除いて、JSONとして読む
	const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
		vars?: Record<string, unknown>;
	};
	const value = config.vars?.DISCORD_GUILD_ID;
	if (typeof value !== "string" || !/^\d+$/.test(value)) {
		fail(
			"wrangler.jsonc の vars の DISCORD_GUILD_ID に、サーバーのIDを書いてください",
		);
	}
	return value;
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

import type {
	APIMessage,
	RESTPatchAPIWebhookWithTokenMessageJSONBody,
	RESTPostAPIChannelMessageJSONBody,
	RESTPutAPIApplicationGuildCommandsJSONBody,
	RESTPutAPIApplicationGuildCommandsResult,
} from "discord-api-types/v10";
import { type Fetch, sleep } from "../http.ts";

/*
 * DiscordのREST APIの呼び出し。Botが使うものだけを持つ。
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

/** DiscordのAPIに送るUser-Agent。Botは「DiscordBot (URL, バージョン)」の形にする */
const USER_AGENT = "DiscordBot (https://github.com/4rtofl/Daichoo, 0.1.0)";

/** 利用制限(429)に当たったときに、待ってやり直す回数の上限 */
const MAX_RATE_LIMIT_RETRIES = 3;

/** DiscordのAPIがエラーを返した */
export class DiscordApiError extends Error {
	readonly status: number;
	/** Discordのエラーコード(JSONのcode) */
	readonly code: number | null;

	constructor(status: number, code: number | null, message: string) {
		super(message);
		this.name = "DiscordApiError";
		this.status = status;
		this.code = code;
	}
}

export class DiscordApi {
	private readonly fetch: Fetch;
	private readonly botToken: string | undefined;

	/** botTokenは、Botとして呼ぶAPIに使う。Interactionへの返事だけなら要らない */
	constructor(fetch: Fetch, botToken?: string) {
		this.fetch = fetch;
		this.botToken = botToken;
	}

	/** コマンドへの最初の返事(保留にしたもの)を書き換える。Interactionのトークンで認証する */
	async editOriginalResponse(
		applicationId: string,
		interactionToken: string,
		body: RESTPatchAPIWebhookWithTokenMessageJSONBody,
	): Promise<void> {
		await this.request(
			"edit original response",
			"PATCH",
			`/webhooks/${applicationId}/${interactionToken}/messages/@original`,
			{ body, auth: false },
		);
	}

	/** チャンネルにメッセージを送る */
	async createMessage(
		channelId: string,
		body: RESTPostAPIChannelMessageJSONBody,
	): Promise<APIMessage> {
		return this.request<APIMessage>(
			"create message",
			"POST",
			`/channels/${channelId}/messages`,
			{ body },
		);
	}

	/** チャンネルのメッセージを消す */
	async deleteMessage(channelId: string, messageId: string): Promise<void> {
		await this.request(
			"delete message",
			"DELETE",
			`/channels/${channelId}/messages/${messageId}`,
		);
	}

	/** サーバーのスラッシュコマンドを、渡した一覧で丸ごと置き換える */
	async putGuildCommands(
		applicationId: string,
		guildId: string,
		commands: RESTPutAPIApplicationGuildCommandsJSONBody,
	): Promise<RESTPutAPIApplicationGuildCommandsResult> {
		return this.request<RESTPutAPIApplicationGuildCommandsResult>(
			"put guild commands",
			"PUT",
			`/applications/${applicationId}/guilds/${guildId}/commands`,
			{ body: commands },
		);
	}

	/**
	 * DiscordのAPIを呼ぶ。利用制限(429)に当たったら、指示された時間だけ待ってやり直す。
	 * routeはエラーの説明に使う名前。パスにはInteractionのトークンが入ることがあるので、エラーには含めない。
	 */
	private async request<T>(
		route: string,
		method: string,
		path: string,
		options: { body?: unknown; auth?: boolean } = {},
	): Promise<T> {
		const headers: Record<string, string> = { "User-Agent": USER_AGENT };
		if (options.auth !== false) {
			if (!this.botToken) {
				throw new Error(`${route}: Botのトークンがありません`);
			}
			headers.Authorization = `Bot ${this.botToken}`;
		}
		if (options.body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		for (let attempt = 0; ; attempt++) {
			const response = await this.fetch(`${DISCORD_API_BASE}${path}`, {
				method,
				headers,
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
			});
			if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
				await sleep(await retryAfterMs(response));
				continue;
			}
			if (!response.ok) {
				const text = await response.text();
				let code: number | null = null;
				let message = text.slice(0, 200);
				try {
					const data = JSON.parse(text) as {
						code?: unknown;
						message?: unknown;
					};
					code = typeof data.code === "number" ? data.code : null;
					if (typeof data.message === "string") {
						message = data.message;
					}
				} catch {
					// JSONでなければ、本文をそのまま使う
				}
				throw new DiscordApiError(
					response.status,
					code,
					`Discord API ${route} failed (${response.status}): ${message}`,
				);
			}
			if (response.status === 204) {
				return undefined as T;
			}
			return (await response.json()) as T;
		}
	}
}

/** 429の返事から、待つ時間(ミリ秒)を読む */
async function retryAfterMs(response: Response): Promise<number> {
	try {
		const data = (await response.json()) as { retry_after?: unknown };
		if (typeof data.retry_after === "number") {
			return Math.ceil(data.retry_after * 1000);
		}
	} catch {
		// 本文が読めなければ、ヘッダーを使う
	}
	const header = Number(response.headers.get("Retry-After"));
	return Number.isFinite(header) && header > 0 ? header * 1000 : 1000;
}

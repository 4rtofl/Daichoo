import { generateKeyPairSync } from "node:crypto";
import type {
	APIApplicationCommandInteractionDataBasicOption,
	APIEmbed,
	APIInteractionDataResolved,
} from "discord-api-types/v10";
import type { Env, WorkerContext } from "../src/env.ts";
import { decodeBase64, encodeBase64 } from "../src/github/contents.ts";
import type { Fetch } from "../src/http.ts";

export const GUILD_ID = "900000000000000001";
export const APPLICATION_ID = "900000000000000002";
export const CHANNEL_ID = "900000000000000003";
export const REPOSITORY = "example/ledger";
export const PAYER = { id: "111111111111111111", username: "ama" };
export const DEBTOR = { id: "222222222222222222", username: "bee" };

/** その時刻に作られたことになる、DiscordのID(snowflake) */
export function snowflakeAt(iso: string): string {
	return String((BigInt(Date.parse(iso)) - 1420070400000n) << 22n);
}

/** テスト用のEd25519の鍵を作り、Discordと同じ形で署名したリクエストを作れるようにする */
export async function createSigner() {
	const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
		"sign",
		"verify",
	]);
	if (!("privateKey" in keyPair)) {
		throw new Error("Ed25519の鍵の組を作れませんでした");
	}
	const publicKey = new Uint8Array(
		await crypto.subtle.exportKey("raw", keyPair.publicKey),
	);
	return {
		publicKeyHex: toHex(publicKey),
		async request(body: unknown): Promise<Request> {
			const text = JSON.stringify(body);
			const timestamp = "1763000000";
			const signature = new Uint8Array(
				await crypto.subtle.sign(
					{ name: "Ed25519" },
					keyPair.privateKey,
					new TextEncoder().encode(timestamp + text),
				),
			);
			return new Request("https://daichoo.example/interactions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Signature-Ed25519": toHex(signature),
					"X-Signature-Timestamp": timestamp,
				},
				body: text,
			});
		},
	};
}

function toHex(bytes: Uint8Array): string {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function testEnv(publicKeyHex: string): Env {
	return {
		DISCORD_PUBLIC_KEY: publicKeyHex,
		DISCORD_BOT_TOKEN: "test-bot-token",
		DISCORD_GUILD_ID: GUILD_ID,
		GITHUB_REPOSITORY: REPOSITORY,
		GITHUB_BRANCH: "main",
		GITHUB_APP_CLIENT_ID: TEST_APP_CLIENT_ID,
		GITHUB_APP_PRIVATE_KEY: TEST_APP_KEY.pkcs1,
	};
}

export const TEST_APP_CLIENT_ID = "Iv23test";

/** テスト用のGitHub Appの鍵。GitHubからダウンロードする形(PKCS#1)と、PKCS#8の形のPEM */
export const TEST_APP_KEY = (() => {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	return {
		pkcs1: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
		pkcs8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicKey,
	};
})();

/** waitUntilに渡された処理を集め、テストで終わるまで待てるようにする */
export function createContext() {
	const pending: Promise<unknown>[] = [];
	const ctx: WorkerContext = {
		waitUntil: (promise) => {
			pending.push(promise);
		},
	};
	return { ctx, finish: () => Promise.all(pending) };
}

/** サーバーでのスラッシュコマンドのInteraction */
export function commandInteraction(
	name: string,
	options: APIApplicationCommandInteractionDataBasicOption[],
	overrides: {
		id?: string;
		guildId?: string;
		user?: { id: string; username: string };
		resolved?: APIInteractionDataResolved;
	} = {},
) {
	const user = overrides.user ?? PAYER;
	return {
		type: 2,
		id: overrides.id ?? snowflakeAt("2026-11-13T13:38:58Z"),
		application_id: APPLICATION_ID,
		token: "interaction-token",
		version: 1,
		guild_id: overrides.guildId ?? GUILD_ID,
		channel_id: "900000000000000009",
		member: {
			user: { ...user, discriminator: "0", global_name: null, avatar: null },
			nick: null,
			roles: [],
			permissions: "0",
		},
		data: {
			id: "900000000000000010",
			type: 1,
			name,
			options,
			resolved: overrides.resolved,
		},
	};
}

export interface RecordedRequest {
	method: string;
	url: string;
	body: unknown;
	/** Authorizationヘッダー。なければnull */
	authorization: string | null;
}

/** GitHubのContents APIの偽物。ファイルを覚えておき、SHAが古い書き込みは本物と同じく409にする */
export class FakeGitHub {
	readonly files = new Map<string, { content: string; sha: string }>();
	readonly commits: { path: string; message: string }[] = [];
	/** 次のPUTのうち、この回数だけ、ほかの書き込みとぶつかったことにする */
	conflictsToInject = 0;
	/** trueなら、どのリクエストにも500を返す */
	failing = false;
	/** GitHub Appのインストールの番号と、発行するトークン */
	readonly installationId = 4242;
	readonly installationToken = "ghs_test_installation_token";
	/** falseなら、Appがリポジトリにインストールされていないことにする */
	appInstalled = true;
	private nextSha = 1;

	/** GitHub Appの認証(インストールの確認とトークンの発行)。JWTが付いていなければ401にする */
	private handleApp(request: RecordedRequest): Response | null {
		const installationUrl = `https://api.github.com/repos/${REPOSITORY}/installation`;
		const tokenUrl = `https://api.github.com/app/installations/${this.installationId}/access_tokens`;
		if (request.url !== installationUrl && request.url !== tokenUrl) {
			return null;
		}
		// JWTは「ヘッダー.中身.署名」の3つに分かれている。署名が正しいかは test/github-app.test.ts で確かめる
		if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(request.authorization ?? "")) {
			return Response.json(
				{ message: "A JSON web token could not be decoded" },
				{ status: 401 },
			);
		}
		if (request.url === installationUrl && request.method === "GET") {
			return this.appInstalled
				? Response.json({ id: this.installationId })
				: Response.json({ message: "Not Found" }, { status: 404 });
		}
		if (request.url === tokenUrl && request.method === "POST") {
			return Response.json(
				{
					token: this.installationToken,
					expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
				{ status: 201 },
			);
		}
		return Response.json({ message: "Method Not Allowed" }, { status: 405 });
	}

	setFile(path: string, content: string): void {
		this.files.set(path, { content, sha: `sha${this.nextSha++}` });
	}

	content(path: string): string | undefined {
		return this.files.get(path)?.content;
	}

	handle(request: RecordedRequest): Response | null {
		if (this.failing && request.url.startsWith("https://api.github.com/")) {
			return Response.json({ message: "Server Error" }, { status: 500 });
		}
		const app = this.handleApp(request);
		if (app) {
			return app;
		}
		const prefix = `https://api.github.com/repos/${REPOSITORY}/contents/`;
		if (!request.url.startsWith(prefix)) {
			return null;
		}
		// 本物と同じく、Appのインストールのトークンがないと読み書きさせない
		if (request.authorization !== `Bearer ${this.installationToken}`) {
			return Response.json({ message: "Bad credentials" }, { status: 401 });
		}
		const path = decodeURIComponent(
			request.url.slice(prefix.length).split("?")[0] ?? "",
		);
		const file = this.files.get(path);
		if (request.method === "GET") {
			if (!file) {
				return Response.json({ message: "Not Found" }, { status: 404 });
			}
			// 本物と同じく、60文字ごとに改行を入れたBase64で返す
			const base64 = encodeBase64(file.content).replace(/(.{60})/g, "$1\n");
			return Response.json({
				type: "file",
				encoding: "base64",
				content: base64,
				sha: file.sha,
			});
		}
		if (request.method === "PUT") {
			const body = request.body as {
				message: string;
				content: string;
				sha?: string;
			};
			if (this.conflictsToInject > 0) {
				this.conflictsToInject--;
				return Response.json(
					{ message: `${path} does not match` },
					{ status: 409 },
				);
			}
			if (file && !body.sha) {
				return Response.json(
					{ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' },
					{ status: 422 },
				);
			}
			if (file && body.sha !== file.sha) {
				return Response.json(
					{ message: `${path} does not match ${body.sha}` },
					{ status: 409 },
				);
			}
			this.setFile(path, decodeBase64(body.content));
			this.commits.push({ path, message: body.message });
			return Response.json({ content: {}, commit: {} }, { status: 201 });
		}
		return Response.json({ message: "Method Not Allowed" }, { status: 405 });
	}
}

/** DiscordのREST APIの偽物。送られたメッセージを覚えておく */
export class FakeDiscord {
	readonly edits: { content?: string; embeds?: APIEmbed[] }[] = [];
	readonly messages: { channelId: string; body: Record<string, unknown> }[] =
		[];
	readonly deleted: string[] = [];
	/** チャンネルにメッセージを送ろうとしたときに返すステータス(403なら権限がない) */
	createStatus = 200;
	/** trueなら、送ったメッセージから埋め込みを外す(埋め込みリンクの権限がないとき) */
	stripEmbeds = false;
	private nextId = 1;

	handle(request: RecordedRequest): Response | null {
		const base = "https://discord.com/api/v10";
		if (!request.url.startsWith(base)) {
			return null;
		}
		const path = request.url.slice(base.length);
		if (
			request.method === "PATCH" &&
			path ===
				`/webhooks/${APPLICATION_ID}/interaction-token/messages/@original`
		) {
			this.edits.push(
				request.body as { content?: string; embeds?: APIEmbed[] },
			);
			return Response.json({});
		}
		const messageMatch = /^\/channels\/(\d+)\/messages$/.exec(path);
		if (request.method === "POST" && messageMatch?.[1]) {
			if (this.createStatus !== 200) {
				return Response.json(
					{ message: "Missing Access", code: 50001 },
					{ status: this.createStatus },
				);
			}
			const body = request.body as Record<string, unknown>;
			this.messages.push({ channelId: messageMatch[1], body });
			return Response.json({
				id: `80000000000000000${this.nextId++}`,
				channel_id: messageMatch[1],
				embeds: this.stripEmbeds ? [] : (body.embeds ?? []),
			});
		}
		const deleteMatch = /^\/channels\/\d+\/messages\/(\d+)$/.exec(path);
		if (request.method === "DELETE" && deleteMatch?.[1]) {
			this.deleted.push(deleteMatch[1]);
			return new Response(null, { status: 204 });
		}
		return Response.json({ message: "Unknown" }, { status: 404 });
	}
}

/** 偽のfetch。GitHubとDiscordの偽物に振り分け、届いたリクエストを記録する */
export function createFakeFetch(github: FakeGitHub, discord: FakeDiscord) {
	const requests: RecordedRequest[] = [];
	const fetch: Fetch = async (url, init) => {
		const request: RecordedRequest = {
			method: init?.method ?? "GET",
			url,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			authorization: new Headers(init?.headers).get("Authorization"),
		};
		requests.push(request);
		const response = github.handle(request) ?? discord.handle(request);
		if (!response) {
			throw new Error(`Unexpected request: ${request.method} ${url}`);
		}
		return response;
	};
	return { fetch, requests };
}

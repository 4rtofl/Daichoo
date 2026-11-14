import { verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	createAppJwt,
	GitHubAppAuth,
	importPrivateKey,
	type TokenCache,
} from "../src/github/app-auth.ts";
import {
	createFakeFetch,
	FakeDiscord,
	FakeGitHub,
	REPOSITORY,
	TEST_APP_CLIENT_ID,
	TEST_APP_KEY,
} from "./helpers.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");

function decodePart(part: string | undefined): unknown {
	return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));
}

function setup(now: () => number = () => NOW) {
	const github = new FakeGitHub();
	const { fetch, requests } = createFakeFetch(github, new FakeDiscord());
	const cache: TokenCache = new Map();
	const auth = new GitHubAppAuth(
		{ clientId: TEST_APP_CLIENT_ID, privateKey: TEST_APP_KEY.pkcs1 },
		REPOSITORY,
		fetch,
		{ now, cache },
	);
	return { github, auth, requests };
}

describe("createAppJwt", () => {
	it("Client IDを発行者にして、Appの秘密鍵でRS256の署名をする", async () => {
		const jwt = await createAppJwt(
			{ clientId: TEST_APP_CLIENT_ID, privateKey: TEST_APP_KEY.pkcs1 },
			NOW,
		);
		const [header, payload, signature] = jwt.split(".");
		expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
		// 時計のずれを見込んで60秒前に発行し、10分後に切れる
		const issuedAt = NOW / 1000 - 60;
		expect(decodePart(payload)).toEqual({
			iat: issuedAt,
			exp: issuedAt + 600,
			iss: TEST_APP_CLIENT_ID,
		});
		expect(
			verify(
				"RSA-SHA256",
				Buffer.from(`${header}.${payload}`),
				TEST_APP_KEY.publicKey,
				Buffer.from(signature ?? "", "base64url"),
			),
		).toBe(true);
	});
});

describe("importPrivateKey", () => {
	it("PKCS#8の鍵と、改行を「\\n」と書いた1行の鍵も読める", async () => {
		await expect(importPrivateKey(TEST_APP_KEY.pkcs8)).resolves.toBeDefined();
		await expect(
			importPrivateKey(TEST_APP_KEY.pkcs1.trim().replace(/\n/g, "\\n")),
		).resolves.toBeDefined();
	});

	it("PEMでなければ、秘密鍵を読めないと分かるエラーにする", async () => {
		await expect(importPrivateKey("")).rejects.toThrowError(/秘密鍵/);
		await expect(importPrivateKey("ghp_xxxx")).rejects.toThrowError(/秘密鍵/);
	});
});

describe("GitHubAppAuth", () => {
	it("インストールを調べ、台帳のリポジトリだけに絞ったトークンを発行してもらう", async () => {
		const { auth, github, requests } = setup();

		expect(await auth.token()).toBe(github.installationToken);
		expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			`GET https://api.github.com/repos/${REPOSITORY}/installation`,
			`POST https://api.github.com/app/installations/${github.installationId}/access_tokens`,
		]);
		expect(requests[1]?.body).toEqual({
			repositories: [REPOSITORY.split("/")[1]],
			permissions: { contents: "write" },
		});
		for (const request of requests) {
			expect(request.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
		}
	});

	it("期限まで5分より長く残っていれば同じトークンを使い、近づいたら発行し直す", async () => {
		let now = Date.now();
		const { auth, requests } = setup(() => now);

		await auth.token();
		await auth.token();
		expect(requests).toHaveLength(2);

		// 偽のGitHubは、1時間後に切れるトークンを発行する
		now += 56 * 60 * 1000;
		await auth.token();
		expect(requests).toHaveLength(4);
	});

	it("Appがリポジトリにインストールされていなければ、そう分かるエラーにする", async () => {
		const { auth, github } = setup();
		github.appInstalled = false;
		await expect(auth.token()).rejects.toThrowError(
			/インストールされていません/,
		);
	});

	it("Client IDが設定されていなければ、GitHubに問い合わせずにエラーにする", async () => {
		const github = new FakeGitHub();
		const { fetch, requests } = createFakeFetch(github, new FakeDiscord());
		const auth = new GitHubAppAuth(
			{ clientId: "", privateKey: TEST_APP_KEY.pkcs1 },
			REPOSITORY,
			fetch,
			{ cache: new Map() },
		);
		await expect(auth.token()).rejects.toThrowError(/GITHUB_APP_CLIENT_ID/);
		expect(requests).toHaveLength(0);
	});
});

import { describe, expect, it } from "vitest";
import {
	decodeBase64,
	encodeBase64,
	GitHubApiError,
	GitHubConflictError,
	GitHubContents,
} from "../src/github/contents.ts";
import {
	createFakeFetch,
	FakeDiscord,
	FakeGitHub,
	REPOSITORY,
} from "./helpers.ts";

function setup() {
	const github = new FakeGitHub();
	const { fetch, requests } = createFakeFetch(github, new FakeDiscord());
	const contents = new GitHubContents(
		{ repository: REPOSITORY, branch: "main", token: "t" },
		fetch,
		{ retryDelayMs: 0 },
	);
	return { github, contents, requests };
}

describe("Base64", () => {
	it("日本語を含む文字列を、そのまま戻せる", () => {
		const text = "おごり,1200円\nラーメン🍜\n";
		expect(decodeBase64(encodeBase64(text))).toBe(text);
		expect(decodeBase64(encodeBase64(text).replace(/(.{4})/g, "$1\n"))).toBe(
			text,
		);
	});
});

describe("GitHubContents", () => {
	it("ブランチを指定して読み書きし、トークンを付ける", async () => {
		const { contents, github, requests } = setup();
		await contents.putFile("ledger/a.tsv", "x\n", "message");
		expect(await contents.getFile("ledger/a.tsv")).toEqual({
			content: "x\n",
			sha: github.files.get("ledger/a.tsv")?.sha,
		});
		expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			`PUT https://api.github.com/repos/${REPOSITORY}/contents/ledger/a.tsv`,
			`GET https://api.github.com/repos/${REPOSITORY}/contents/ledger/a.tsv?ref=main`,
		]);
		expect(requests[0]?.body).toMatchObject({ branch: "main" });
	});

	it("ファイルがなければnullを返す", async () => {
		const { contents } = setup();
		expect(await contents.getFile("ledger/none.tsv")).toBeNull();
	});

	it("書き込みがぶつかったら、読み直してやり直す", async () => {
		const { contents, github } = setup();
		github.setFile("f.txt", "a\n");
		github.conflictsToInject = 2;
		const updated = await contents.updateFile("f.txt", "m", (c) => `${c}b\n`);
		expect(updated).toBe(true);
		expect(github.content("f.txt")).toBe("a\nb\n");
		expect(github.commits).toHaveLength(1);
	});

	it("同時にファイルが作られたとき(422)も、読み直してやり直す", async () => {
		const { contents, github } = setup();
		let firstRead = true;
		const updated = await contents.updateFile("new.txt", "m", (current) => {
			if (firstRead) {
				firstRead = false;
				// 読んだ直後に、ほかの書き込みがファイルを作った
				github.setFile("new.txt", "other\n");
			}
			return `${current ?? ""}mine\n`;
		});
		expect(updated).toBe(true);
		expect(github.content("new.txt")).toBe("other\nmine\n");
	});

	it("ぶつかり続けたら、あきらめてエラーにする", async () => {
		const { contents, github } = setup();
		github.conflictsToInject = 100;
		await expect(
			contents.updateFile("f.txt", "m", () => "x"),
		).rejects.toBeInstanceOf(GitHubConflictError);
	});

	it("updateがnullを返したら、書き込まない", async () => {
		const { contents, github } = setup();
		github.setFile("f.txt", "a\n");
		expect(await contents.updateFile("f.txt", "m", () => null)).toBe(false);
		expect(github.commits).toHaveLength(0);
	});

	it("ぶつかったのでないエラーは、やり直さない", async () => {
		const { contents, github, requests } = setup();
		github.failing = true;
		await expect(
			contents.updateFile("f.txt", "m", () => "x"),
		).rejects.toBeInstanceOf(GitHubApiError);
		expect(requests).toHaveLength(1);
	});

	it("リポジトリの書き方が正しくなければ、作るときにエラーにする", () => {
		expect(
			() =>
				new GitHubContents(
					{ repository: "no-slash", branch: "main", token: "t" },
					async () => new Response(),
				),
		).toThrowError(/所有者/);
	});
});

import { defineConfig } from "vitest/config";

// WorkerのコードもWeb標準のAPIしか使わないので、テストはNode.jsで動かす
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
});

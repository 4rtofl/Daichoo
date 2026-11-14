import type { Env, WorkerContext } from "./env.ts";
import { defaultFetch } from "./http.ts";
import { handleInteractionRequest } from "./interactions/handler.ts";

/**
 * Workerのエントリポイント。DiscordのDeveloper Portalの「Interactions Endpoint URL」に、
 * このWorkerの /interactions のURLを設定する。
 */
export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: WorkerContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/interactions" && request.method === "POST") {
			return handleInteractionRequest(request, env, ctx, defaultFetch);
		}
		return new Response("Not Found", { status: 404 });
	},
};

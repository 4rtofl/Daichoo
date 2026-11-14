import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandGuildInteraction,
	APIInteraction,
	APIInteractionResponse,
} from "discord-api-types/v10";
import { DiscordApi } from "../discord/api.ts";
import {
	ApplicationCommandType,
	InteractionResponseType,
	InteractionType,
} from "../discord/constants.ts";
import { verifyDiscordRequest } from "../discord/verify.ts";
import type { Env, WorkerContext } from "../env.ts";
import { GitHubContents } from "../github/contents.ts";
import type { Fetch } from "../http.ts";
import { COMMON_TEXTS } from "../texts.ts";
import { handleChannel } from "./channel.ts";
import { CHANNEL, OGORI, SEISAN } from "./commands.ts";
import { type CommandContext, ephemeral } from "./context.ts";
import { handleOgori } from "./ogori.ts";
import { handleSeisan } from "./seisan.ts";

/**
 * DiscordからのInteractionを受け付ける。署名を確かめてから、種類ごとに振り分ける。
 * https://discord.com/developers/docs/interactions/receiving-and-responding
 */
export async function handleInteractionRequest(
	request: Request,
	env: Env,
	ctx: WorkerContext,
	fetch: Fetch,
): Promise<Response> {
	const body = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
	if (body === null) {
		return new Response("invalid request signature", { status: 401 });
	}
	const interaction = JSON.parse(body) as APIInteraction;
	if (interaction.type === InteractionType.Ping) {
		return Response.json({ type: InteractionResponseType.Pong });
	}
	if (interaction.type === InteractionType.ApplicationCommand) {
		return Response.json(handleCommand(interaction, env, ctx, fetch));
	}
	return new Response("unsupported interaction type", { status: 400 });
}

function handleCommand(
	interaction: APIApplicationCommandInteraction,
	env: Env,
	ctx: WorkerContext,
	fetch: Fetch,
): APIInteractionResponse {
	if (!env.DISCORD_GUILD_ID) {
		console.error("DISCORD_GUILD_ID is not set (wrangler.jsonc vars)");
	}
	// 台帳は1つのサーバーのためのもの。ほかのサーバーやDMからは記録させない
	if (
		!interaction.guild_id ||
		interaction.guild_id !== env.DISCORD_GUILD_ID ||
		!interaction.member
	) {
		return ephemeral(COMMON_TEXTS.wrongGuild);
	}
	if (interaction.data.type !== ApplicationCommandType.ChatInput) {
		return ephemeral(COMMON_TEXTS.unknownCommand);
	}

	try {
		const context: CommandContext = {
			// サーバーでのスラッシュコマンドであることは、すぐ上で確かめた
			interaction:
				interaction as APIChatInputApplicationCommandGuildInteraction,
			ctx,
			github: new GitHubContents(
				{
					repository: env.GITHUB_REPOSITORY,
					branch: env.GITHUB_BRANCH,
					token: env.GITHUB_TOKEN,
				},
				fetch,
			),
			discord: new DiscordApi(fetch, env.DISCORD_BOT_TOKEN),
		};
		switch (interaction.data.name) {
			case OGORI.name:
				return handleOgori(context);
			case CHANNEL.name:
				return handleChannel(context);
			case SEISAN.name:
				return handleSeisan(context);
			default:
				return ephemeral(COMMON_TEXTS.unknownCommand);
		}
	} catch (error) {
		console.error(`/${interaction.data.name} failed:`, error);
		return ephemeral(COMMON_TEXTS.error);
	}
}

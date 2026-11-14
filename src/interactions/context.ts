import type {
	APIApplicationCommandInteractionDataBasicOption,
	APIChatInputApplicationCommandGuildInteraction,
	APIEmbed,
	APIInteractionResponse,
	APIUser,
} from "discord-api-types/v10";
import type { DiscordApi } from "../discord/api.ts";
import { InteractionResponseType, MessageFlags } from "../discord/constants.ts";
import type { WorkerContext } from "../env.ts";
import type { GitHubContents } from "../github/contents.ts";

/** コマンドの処理に渡すもの */
export interface CommandContext {
	interaction: APIChatInputApplicationCommandGuildInteraction;
	ctx: WorkerContext;
	github: GitHubContents;
	discord: DiscordApi;
}

/** 実行した本人にだけ見える返事 */
export function ephemeral(content: string): APIInteractionResponse {
	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			content,
			flags: MessageFlags.Ephemeral,
			allowed_mentions: { parse: [] },
		},
	};
}

/** コマンドのオプションの値を、名前で探す */
export function findOption(
	interaction: APIChatInputApplicationCommandGuildInteraction,
	name: string,
): APIApplicationCommandInteractionDataBasicOption["value"] | undefined {
	const option = interaction.data.options?.find((o) => o.name === name);
	return option && "value" in option ? option.value : undefined;
}

/** Discordでの表示名。サーバーでのニックネーム、表示名、ユーザー名の順に使う */
export function displayName(
	user: APIUser | undefined,
	nick: string | null | undefined,
): string | undefined {
	return nick || user?.global_name || user?.username;
}

/**
 * 時間のかかる処理(GitHubへの書き込みなど)を、保留の返事を返してから続ける。
 * Discordには3秒以内に最初の返事を返す必要があるため。workが返した文(または埋め込み)で、
 * 保留にした返事を書き換える。workが失敗したら、failureの文にする。
 */
export function respondLater(
	context: CommandContext,
	options: { ephemeral: boolean },
	work: () => Promise<string | { embeds: APIEmbed[] }>,
	failure: string,
): APIInteractionResponse {
	const { interaction, ctx, discord } = context;
	const finish = async () => {
		let reply: string | { embeds: APIEmbed[] };
		try {
			reply = await work();
		} catch (error) {
			console.error(
				`/${interaction.data.name} failed (interaction ${interaction.id}):`,
				error,
			);
			reply = failure;
		}
		try {
			await discord.editOriginalResponse(
				interaction.application_id,
				interaction.token,
				{
					...(typeof reply === "string" ? { content: reply } : reply),
					allowed_mentions: { parse: [] },
				},
			);
		} catch (error) {
			console.error(
				`Failed to edit the response (interaction ${interaction.id}):`,
				error,
			);
		}
	};
	ctx.waitUntil(finish());
	return {
		type: InteractionResponseType.DeferredChannelMessageWithSource,
		...(options.ephemeral ? { data: { flags: MessageFlags.Ephemeral } } : {}),
	};
}

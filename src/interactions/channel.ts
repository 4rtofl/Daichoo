import type { APIInteractionResponse, APIMessage } from "discord-api-types/v10";
import { type DiscordApi, DiscordApiError } from "../discord/api.ts";
import { EMBED_COLOR } from "../ledger/report.ts";
import { SETTINGS_PATH, updateSettlementChannel } from "../ledger/settings.ts";
import { CHANNEL_TEXTS, COMMON_TEXTS } from "../texts.ts";
import { CHANNEL } from "./commands.ts";
import {
	type CommandContext,
	displayName,
	ephemeral,
	findOption,
	respondLater,
} from "./context.ts";

/**
 * /channel: 毎月の精算の結果を送るチャンネルを、台帳の設定(ledger/settings.json)に書く。
 * 使えるのは、サーバー管理の権限を持つ人(src/interactions/commands.ts)。
 *
 * 保存する前に、そのチャンネルへお知らせを送ってみる。送れなかったり、埋め込みが付かなかったりしたら
 * (Botに権限がない)、保存しない。月末になってから送れないと分かるのを防ぐため。
 */
export function handleChannel(context: CommandContext): APIInteractionResponse {
	const { interaction, github, discord } = context;
	const channelId = findOption(interaction, CHANNEL.channel);
	if (typeof channelId !== "string") {
		return ephemeral(COMMON_TEXTS.invalidOptions);
	}
	const channelName =
		interaction.data.resolved?.channels?.[channelId]?.name ?? "";
	const user = interaction.member.user;

	return respondLater(
		context,
		{ ephemeral: true },
		async () => {
			let notice: APIMessage;
			try {
				notice = await discord.createMessage(channelId, {
					embeds: [
						{
							title: CHANNEL_TEXTS.noticeTitle,
							description: CHANNEL_TEXTS.noticeDescription(user.id),
							color: EMBED_COLOR,
						},
					],
					allowed_mentions: { parse: [] },
				});
			} catch (error) {
				// 403: 見る権限か送る権限がない。404: Botからチャンネルが見えない
				if (
					error instanceof DiscordApiError &&
					(error.status === 403 || error.status === 404)
				) {
					return CHANNEL_TEXTS.notWritable(channelId);
				}
				throw error;
			}
			// 埋め込みリンクの権限がないと、埋め込みが外れたメッセージになる
			if (notice.embeds.length === 0) {
				await deleteQuietly(discord, channelId, notice.id);
				return CHANNEL_TEXTS.notWritable(channelId);
			}

			const message = [
				`設定: 精算の結果の送り先を #${channelName || channelId} にする`,
				"",
				`channel: ${channelId}`,
				`changed by: ${displayName(user, interaction.member.nick) ?? user.id} (${user.id})`,
			].join("\n");
			try {
				await github.updateFile(SETTINGS_PATH, message, (current) =>
					updateSettlementChannel(current, {
						id: channelId,
						name: channelName,
					}),
				);
			} catch (error) {
				// 保存できなかったので、送り先になったと伝えるお知らせは消す
				await deleteQuietly(discord, channelId, notice.id);
				throw error;
			}
			return CHANNEL_TEXTS.saved(channelId);
		},
		CHANNEL_TEXTS.failed,
	);
}

async function deleteQuietly(
	discord: DiscordApi,
	channelId: string,
	messageId: string,
): Promise<void> {
	try {
		await discord.deleteMessage(channelId, messageId);
	} catch (error) {
		console.error(`Failed to delete the notice ${messageId}:`, error);
	}
}

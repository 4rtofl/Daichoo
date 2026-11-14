import type { RESTPutAPIApplicationGuildCommandsJSONBody } from "discord-api-types/v10";
import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ChannelType,
	PermissionFlags,
} from "../discord/constants.ts";
import { MAX_AMOUNT } from "../ledger/entries.ts";
import { COMMAND_TEXTS } from "../texts.ts";

/** コマンドとオプションの名前。Discordで入力する名前なので、変えると登録し直しが要る */
export const OGORI = {
	name: "ogori",
	user: "user",
	amount: "amount",
	memo: "memo",
} as const;

export const CHANNEL = {
	name: "channel",
	channel: "channel",
} as const;

/** メモの長さの上限 */
export const MAX_MEMO_LENGTH = 100;

/**
 * Discordに登録するコマンド。名前は英語、説明は日本語。
 * 1つのサーバーだけで使うので、サーバーのコマンドとして登録する(pnpm register-commands)。
 */
export const COMMANDS: RESTPutAPIApplicationGuildCommandsJSONBody = [
	{
		type: ApplicationCommandType.ChatInput,
		name: OGORI.name,
		description: COMMAND_TEXTS.ogori.description,
		options: [
			{
				type: ApplicationCommandOptionType.User,
				name: OGORI.user,
				description: COMMAND_TEXTS.ogori.user,
				required: true,
			},
			{
				type: ApplicationCommandOptionType.Integer,
				name: OGORI.amount,
				description: COMMAND_TEXTS.ogori.amount,
				required: true,
				min_value: 1,
				max_value: MAX_AMOUNT,
			},
			{
				type: ApplicationCommandOptionType.String,
				name: OGORI.memo,
				description: COMMAND_TEXTS.ogori.memo,
				required: false,
				max_length: MAX_MEMO_LENGTH,
			},
		],
	},
	{
		type: ApplicationCommandType.ChatInput,
		name: CHANNEL.name,
		description: COMMAND_TEXTS.channel.description,
		// 使えるのは、サーバー管理の権限を持つ人。サーバー設定の「連携サービス」で、使える人を変えられる
		default_member_permissions: String(PermissionFlags.ManageGuild),
		options: [
			{
				type: ApplicationCommandOptionType.Channel,
				name: CHANNEL.channel,
				description: COMMAND_TEXTS.channel.channel,
				required: true,
				channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
			},
		],
	},
];

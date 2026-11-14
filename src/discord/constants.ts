import type {
	ApplicationCommandOptionType as DiscordApplicationCommandOptionType,
	ApplicationCommandType as DiscordApplicationCommandType,
	ChannelType as DiscordChannelType,
	InteractionResponseType as DiscordInteractionResponseType,
	InteractionType as DiscordInteractionType,
	MessageFlags as DiscordMessageFlags,
} from "discord-api-types/v10";

/*
 * Discord APIの定数。
 * discord-api-types は型だけを使い、値はここで持つ。精算のスクリプトは依存パッケージを入れずに
 * Node.jsで直接動かすため、実行時にパッケージを読み込まないようにしている。
 * 各値は discord-api-types の型に当てはめているので、値を間違えると型チェックで気づける。
 */

export const InteractionType = {
	Ping: 1 as DiscordInteractionType.Ping,
	ApplicationCommand: 2 as DiscordInteractionType.ApplicationCommand,
} as const;

export const InteractionResponseType = {
	Pong: 1 as DiscordInteractionResponseType.Pong,
	ChannelMessageWithSource:
		4 as DiscordInteractionResponseType.ChannelMessageWithSource,
	DeferredChannelMessageWithSource:
		5 as DiscordInteractionResponseType.DeferredChannelMessageWithSource,
} as const;

export const ApplicationCommandType = {
	ChatInput: 1 as DiscordApplicationCommandType.ChatInput,
} as const;

export const ApplicationCommandOptionType = {
	String: 3 as DiscordApplicationCommandOptionType.String,
	Integer: 4 as DiscordApplicationCommandOptionType.Integer,
	User: 6 as DiscordApplicationCommandOptionType.User,
	Channel: 7 as DiscordApplicationCommandOptionType.Channel,
} as const;

export const ChannelType = {
	GuildText: 0 as DiscordChannelType.GuildText,
	GuildAnnouncement: 5 as DiscordChannelType.GuildAnnouncement,
} as const;

export const MessageFlags = {
	Ephemeral: 64 as DiscordMessageFlags.Ephemeral,
} as const;

/** 権限のビット。コマンドを使える人の既定(default_member_permissions)に使う */
export const PermissionFlags = {
	ManageGuild: 1n << 5n,
} as const;

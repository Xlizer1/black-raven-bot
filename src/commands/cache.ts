// src/commands/cache.ts

import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

export class CacheCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("cache")
        .setDescription("Manage autocomplete cache")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("clear")
            .setDescription("Clear the autocomplete cache")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription("Show cache status and statistics")
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "clear":
        try {
          MusicService.clearAutocompleteCache();
          logger.info(`Cache cleared by user: ${interaction.user.tag}`);

          return interaction.reply({
            content: "🗑️ Autocomplete cache has been cleared!",
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          logger.error("Error clearing cache:", error);
          return interaction.reply({
            content: "❌ Failed to clear cache!",
            flags: MessageFlags.Ephemeral,
          });
        }

      case "status":
        try {
          const cacheSize = MusicService.getAutocompleteCacheSize();

          return interaction.reply({
            content:
              `📊 **Cache Status**\n` +
              `• Entries: ${cacheSize}/100\n` +
              `• Memory usage: ~${Math.round(cacheSize * 0.5)}KB\n` +
              `• Cache TTL: 5 minutes`,
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          logger.error("Error getting cache status:", error);
          return interaction.reply({
            content: "❌ Failed to get cache status!",
            flags: MessageFlags.Ephemeral,
          });
        }

      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }
}

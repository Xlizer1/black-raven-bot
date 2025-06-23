import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { AutocompleteService } from "../services/AutocompleteService";
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
            .setName("status")
            .setDescription("Show autocomplete cache statistics")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("clear")
            .setDescription("Clear the autocomplete cache")
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const subcommand = interaction.options.getSubcommand();
    const autocompleteService = AutocompleteService.getInstance();

    switch (subcommand) {
      case "status":
        return this.showCacheStatus(interaction, autocompleteService);
      case "clear":
        return this.clearCache(interaction, autocompleteService);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async showCacheStatus(
    interaction: Command.ChatInputCommandInteraction,
    autocompleteService: AutocompleteService
  ) {
    try {
      const stats = autocompleteService.getCacheStats();
      const usagePercentage = Math.round((stats.size / stats.maxSize) * 100);
      const ttlMinutes = Math.round(stats.ttl / (1000 * 60));

      const statusEmoji =
        usagePercentage > 80 ? "🔴" : usagePercentage > 50 ? "🟡" : "🟢";

      return interaction.reply({
        content:
          `${statusEmoji} **Autocomplete Cache Status**\n\n` +
          `📊 **Usage:** ${stats.size}/${stats.maxSize} entries (${usagePercentage}%)\n` +
          `⏱️ **TTL:** ${ttlMinutes} minutes\n` +
          `💾 **Memory:** ~${this.estimateMemoryUsage(stats.size)} KB\n\n` +
          `**Performance:**\n` +
          `• Cache helps reduce YouTube API calls\n` +
          `• Faster autocomplete responses\n` +
          `• Automatic cleanup when full\n\n` +
          `💡 Use \`/cache clear\` to manually clear the cache`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error("Error getting cache status:", error);
      return interaction.reply({
        content: "❌ Failed to get cache status!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async clearCache(
    interaction: Command.ChatInputCommandInteraction,
    autocompleteService: AutocompleteService
  ) {
    try {
      const sizeBefore = autocompleteService.getCacheSize();
      autocompleteService.clearCache();

      logger.info(
        `Autocomplete cache cleared by ${interaction.user.tag} (${interaction.user.id})`
      );

      return interaction.reply({
        content:
          `🗑️ **Cache Cleared Successfully!**\n\n` +
          `📊 **Removed:** ${sizeBefore} cache entries\n` +
          `⚡ **Effect:** Next autocomplete searches will fetch fresh results\n` +
          `🔄 **Auto-rebuild:** Cache will rebuild as users search\n\n` +
          `✅ Autocomplete cache has been reset`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error("Error clearing cache:", error);
      return interaction.reply({
        content: "❌ Failed to clear cache!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private estimateMemoryUsage(cacheSize: number): number {
    // Rough estimate: each cache entry is about 200-300 bytes
    // (query key + results array with names/values)
    return Math.round((cacheSize * 250) / 1024);
  }
}

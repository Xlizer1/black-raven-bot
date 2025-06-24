import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

export class StatusCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("status")
        .setDescription("Show bot status and YouTube connection health")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("music")
            .setDescription("Show music service status")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("reset")
            .setDescription("Reset YouTube connection status")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("test")
            .setDescription("Test YouTube connectivity")
            .addStringOption((option) =>
              option
                .setName("query")
                .setDescription("Search query to test (default: 'test')")
                .setRequired(false)
            )
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "music":
        return this.showMusicStatus(interaction);
      case "reset":
        return this.resetConnection(interaction);
      case "test":
        return this.testConnection(interaction);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async showMusicStatus(
    interaction: Command.ChatInputCommandInteraction
  ) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const serviceStatus = await MusicService.getServiceStatus();
      const botUptime = Math.floor(process.uptime());
      const memoryUsage = Math.round(
        process.memoryUsage().heapUsed / 1024 / 1024
      );

      const embed = new EmbedBuilder()
        .setColor(serviceStatus.fallback.youtubeBlocked ? 0xff0000 : 0x00ff00)
        .setTitle("🎵 Music Service Status")
        .setTimestamp();

      // Bot general status
      embed.addFields({
        name: "🤖 Bot Status",
        value:
          `⏱️ **Uptime:** ${this.formatUptime(botUptime)}\n` +
          `💾 **Memory:** ${memoryUsage}MB\n` +
          `🔗 **Guilds:** ${interaction.client.guilds.cache.size}`,
        inline: true,
      });

      // YouTube status
      const youtubeStatus = serviceStatus.fallback.youtubeBlocked
        ? "🔴 Blocked"
        : "🟢 Available";
      const lastSuccess = new Date(
        serviceStatus.fallback.lastSuccess
      ).toLocaleString();

      embed.addFields({
        name: "📺 YouTube Status",
        value:
          `📊 **Status:** ${youtubeStatus}\n` +
          `❌ **Failures:** ${serviceStatus.fallback.youtubeFailureCount}\n` +
          `✅ **Last Success:** ${lastSuccess}`,
        inline: true,
      });

      // Platform availability
      const platforms = serviceStatus.factory.platforms
        .map(
          (p) =>
            `${this.getPlatformEmoji(p)} ${
              p.charAt(0).toUpperCase() + p.slice(1)
            }`
        )
        .join(", ");

      embed.addFields({
        name: "🎯 Available Platforms",
        value: platforms || "None",
        inline: true,
      });

      // Cache status
      embed.addFields({
        name: "💾 Cache Status",
        value:
          `📦 **Cached Items:** ${serviceStatus.fallback.cacheSize}\n` +
          `🔄 **Fallback Mode:** ${
            serviceStatus.fallback.youtubeBlocked ? "Active" : "Standby"
          }`,
        inline: true,
      });

      // Recommendations
      let recommendations = "";
      if (serviceStatus.fallback.youtubeBlocked) {
        recommendations +=
          "⚠️ YouTube is temporarily blocked due to bot detection\n";
        recommendations += "💡 Try `/status reset` to reset connection\n";
        recommendations += "🕐 Wait 10-15 minutes before heavy usage\n";
      } else if (serviceStatus.fallback.youtubeFailureCount > 0) {
        recommendations += "⚠️ Recent YouTube connection issues detected\n";
        recommendations += "💡 Consider reducing search frequency\n";
      } else {
        recommendations += "✅ All systems operating normally\n";
        recommendations += "🎵 Ready for music playback\n";
      }

      embed.addFields({
        name: "💡 Recommendations",
        value: recommendations,
        inline: false,
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error("Error showing music status:", error);
      return interaction.editReply({
        content: "❌ Failed to get music service status!",
      });
    }
  }

  private async resetConnection(
    interaction: Command.ChatInputCommandInteraction
  ) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Reset YouTube connection status
      MusicService.resetYouTubeConnection();

      // Clear caches
      MusicService.clearAllCaches();

      logger.info(`YouTube connection reset by ${interaction.user.tag}`);

      return interaction.editReply({
        content:
          "✅ **Connection Reset Complete!**\n\n" +
          "🔄 **YouTube status reset**\n" +
          "🗑️ **Caches cleared**\n" +
          "⏱️ **Rate limits reset**\n\n" +
          "💡 Wait a few minutes before testing to avoid triggering bot detection again.",
      });
    } catch (error) {
      logger.error("Error resetting connection:", error);
      return interaction.editReply({
        content: "❌ Failed to reset connection!",
      });
    }
  }

  private async testConnection(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const query = interaction.options.getString("query") || "test";

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const startTime = Date.now();

      try {
        const results = await MusicService.search(query, undefined, {
          limit: 1,
        });
        const endTime = Date.now();
        const duration = endTime - startTime;

        if (results && results.length > 0 && results[0]?.id !== "error") {
          const result = results[0]!;
          return interaction.editReply({
            content:
              "✅ **Connection Test Successful!**\n\n" +
              `🔍 **Query:** "${query}"\n` +
              `📺 **Found:** ${result.title}\n` +
              `⏱️ **Response time:** ${duration}ms\n` +
              `🎯 **Platform:** ${result.platform}\n\n` +
              "🟢 YouTube connection is working properly!",
          });
        } else {
          return interaction.editReply({
            content:
              "⚠️ **Connection Test Failed**\n\n" +
              `🔍 **Query:** "${query}"\n` +
              `❌ **No results found**\n` +
              `⏱️ **Response time:** ${duration}ms\n\n` +
              "🔴 YouTube may be experiencing issues or blocking requests.\n" +
              "💡 Try `/status reset` or wait before testing again.",
          });
        }
      } catch (searchError) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        return interaction.editReply({
          content:
            "❌ **Connection Test Failed**\n\n" +
            `🔍 **Query:** "${query}"\n` +
            `💥 **Error:** Search failed\n` +
            `⏱️ **Response time:** ${duration}ms\n\n` +
            "🔴 YouTube connection is blocked or failing.\n" +
            "💡 Use `/status reset` and wait 10-15 minutes before retrying.",
        });
      }
    } catch (error) {
      logger.error("Error testing connection:", error);
      return interaction.editReply({
        content:
          "❌ **Test Failed**\n\n" +
          "💥 An unexpected error occurred during the connection test.\n" +
          "🔧 Check bot logs for more details.",
      });
    }
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  private getPlatformEmoji(platform: string): string {
    switch (platform.toLowerCase()) {
      case "youtube":
        return "📺";
      case "spotify":
        return "🟢";
      case "soundcloud":
        return "🟠";
      default:
        return "🎵";
    }
  }
}

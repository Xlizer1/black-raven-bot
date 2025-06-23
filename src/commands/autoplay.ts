import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { AutoPlayService } from "../services/AutoPlayService";
import { MusicPlatform } from "../services/providers/IMusicProvider";
import { logger } from "../utils/logger";

export class AutoPlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("autoplay")
        .setDescription("Manage automatic music recommendations")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("enable")
            .setDescription(
              "Enable autoplay to automatically add similar songs"
            )
            .addIntegerOption((option) =>
              option
                .setName("min_queue_size")
                .setDescription(
                  "Minimum songs in queue before adding more (default: 2)"
                )
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
            )
            .addIntegerOption((option) =>
              option
                .setName("max_songs_to_add")
                .setDescription("Maximum songs to add at once (default: 5)")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
            )
            .addStringOption((option) =>
              option
                .setName("platform")
                .setDescription(
                  "Platform to search for recommendations (default: YouTube)"
                )
                .addChoices(
                  { name: "YouTube", value: "youtube" },
                  { name: "Spotify", value: "spotify" }
                )
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("disable").setDescription("Disable autoplay")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription("Show autoplay status and settings")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("settings")
            .setDescription("Update autoplay settings")
            .addIntegerOption((option) =>
              option
                .setName("min_queue_size")
                .setDescription("Minimum songs in queue before adding more")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
            )
            .addIntegerOption((option) =>
              option
                .setName("max_songs_to_add")
                .setDescription("Maximum songs to add at once")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
            )
            .addStringOption((option) =>
              option
                .setName("platform")
                .setDescription("Platform to search for recommendations")
                .addChoices(
                  { name: "YouTube", value: "youtube" },
                  { name: "Spotify", value: "spotify" }
                )
                .setRequired(false)
            )
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "enable":
        return this.enableAutoPlay(interaction);
      case "disable":
        return this.disableAutoPlay(interaction);
      case "status":
        return this.showStatus(interaction);
      case "settings":
        return this.updateSettings(interaction);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async enableAutoPlay(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const queue = MusicQueue.getQueue(interaction.guild!.id);
    const autoPlayService = AutoPlayService.getInstance();

    // Get options
    const minQueueSize = interaction.options.getInteger("min_queue_size") || 2;
    const maxSongsToAdd =
      interaction.options.getInteger("max_songs_to_add") || 5;
    const platformStr = interaction.options.getString("platform") || "youtube";
    const platform = platformStr as MusicPlatform;

    try {
      // Enable autoplay with settings
      autoPlayService.enableAutoPlay(interaction.guild!.id, {
        minQueueSize,
        maxSongsToAdd,
        platform,
      });

      // Also enable it on the queue
      queue.enableAutoPlay();

      logger.info(
        `AutoPlay enabled in guild: ${
          interaction.guild!.id
        } with settings: ${JSON.stringify({
          minQueueSize,
          maxSongsToAdd,
          platform,
        })}`
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ AutoPlay Enabled!")
        .setDescription(
          "The bot will now automatically add similar songs to keep the music going!"
        )
        .addFields(
          {
            name: "⚙️ Settings",
            value:
              `🎵 **Min Queue Size:** ${minQueueSize} song${
                minQueueSize === 1 ? "" : "s"
              }\n` +
              `📈 **Max Songs to Add:** ${maxSongsToAdd} song${
                maxSongsToAdd === 1 ? "" : "s"
              }\n` +
              `🎯 **Platform:** ${
                platform.charAt(0).toUpperCase() + platform.slice(1)
              }`,
            inline: true,
          },
          {
            name: "🎶 How it works",
            value:
              "• Analyzes currently playing songs\n" +
              "• Finds similar artists and genres\n" +
              "• Adds recommendations when queue gets low\n" +
              "• Avoids recently played songs",
            inline: true,
          }
        )
        .addFields({
          name: "💡 Tips",
          value:
            "• AutoPlay works best with music that has clear artist/genre info\n" +
            "• You can adjust settings anytime with `/autoplay settings`\n" +
            "• Use `/autoplay status` to monitor performance",
          inline: false,
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      logger.error("Error enabling autoplay:", error);
      return interaction.reply({
        content: "❌ Failed to enable autoplay!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async disableAutoPlay(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const queue = MusicQueue.getQueue(interaction.guild!.id);
    const autoPlayService = AutoPlayService.getInstance();

    try {
      // Disable autoplay
      autoPlayService.disableAutoPlay(interaction.guild!.id);
      queue.disableAutoPlay();

      logger.info(`AutoPlay disabled in guild: ${interaction.guild!.id}`);

      return interaction.reply({
        content:
          "✅ **AutoPlay Disabled!**\n\n" +
          "🔇 The bot will no longer automatically add songs to the queue\n" +
          "🎵 You can re-enable it anytime with `/autoplay enable`",
      });
    } catch (error) {
      logger.error("Error disabling autoplay:", error);
      return interaction.reply({
        content: "❌ Failed to disable autoplay!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async showStatus(interaction: Command.ChatInputCommandInteraction) {
    const queue = MusicQueue.getQueue(interaction.guild!.id);
    const autoPlayService = AutoPlayService.getInstance();
    const stats = autoPlayService.getStats(interaction.guild!.id);

    const embed = new EmbedBuilder()
      .setColor(stats.enabled ? 0x00ff00 : 0xff0000)
      .setTitle("🤖 AutoPlay Status")
      .setTimestamp();

    if (!stats.enabled) {
      embed.setDescription("🔇 AutoPlay is currently **disabled**");
      embed.addFields({
        name: "💡 Enable AutoPlay",
        value:
          "Use `/autoplay enable` to start automatic music recommendations\n" +
          "The bot will keep your queue filled with similar songs!",
        inline: false,
      });
    } else {
      embed.setDescription("✅ AutoPlay is currently **enabled**");

      if (stats.settings) {
        embed.addFields({
          name: "⚙️ Current Settings",
          value:
            `🎵 **Min Queue Size:** ${stats.settings.minQueueSize}\n` +
            `📈 **Max Songs to Add:** ${stats.settings.maxSongsToAdd}\n` +
            `🎯 **Platform:** ${
              stats.settings.platform.charAt(0).toUpperCase() +
              stats.settings.platform.slice(1)
            }\n` +
            `🎚️ **Similarity Threshold:** ${(
              stats.settings.similarityThreshold * 100
            ).toFixed(0)}%`,
          inline: true,
        });
      }

      embed.addFields({
        name: "📊 Statistics",
        value:
          `🎵 **Songs in History:** ${stats.songsInHistory}\n` +
          `⚙️ **Currently Processing:** ${
            stats.isProcessing ? "Yes" : "No"
          }\n` +
          `📋 **Current Queue Size:** ${queue.size()}`,
        inline: true,
      });

      // Add current song info
      const currentSong = queue.getCurrentSong();
      if (currentSong) {
        embed.addFields({
          name: "🎵 Current Song",
          value:
            `**${currentSong.title}**${
              currentSong.artist ? `\nby ${currentSong.artist}` : ""
            }\n` + `🎯 Platform: ${currentSong.platform}`,
          inline: false,
        });
      }

      embed.addFields({
        name: "💡 Management",
        value:
          "• Use `/autoplay settings` to adjust preferences\n" +
          "• Use `/autoplay disable` to turn off\n" +
          "• AutoPlay works best with songs that have artist info",
        inline: false,
      });
    }

    return interaction.reply({
      embeds: [embed],
    });
  }

  private async updateSettings(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const autoPlayService = AutoPlayService.getInstance();
    const currentStats = autoPlayService.getStats(interaction.guild!.id);

    if (!currentStats.enabled) {
      return interaction.reply({
        content: "❌ AutoPlay is not enabled! Use `/autoplay enable` first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Get new settings
    const minQueueSize = interaction.options.getInteger("min_queue_size");
    const maxSongsToAdd = interaction.options.getInteger("max_songs_to_add");
    const platformStr = interaction.options.getString("platform");

    // Check if any settings were provided
    if (!minQueueSize && !maxSongsToAdd && !platformStr) {
      return interaction.reply({
        content:
          "❌ Please specify at least one setting to update!\n" +
          "Use `/autoplay status` to see current settings.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const updateData: any = {};
      if (minQueueSize !== null) updateData.minQueueSize = minQueueSize;
      if (maxSongsToAdd !== null) updateData.maxSongsToAdd = maxSongsToAdd;
      if (platformStr) updateData.platform = platformStr as MusicPlatform;

      autoPlayService.updateSettings(interaction.guild!.id, updateData);

      logger.info(
        `AutoPlay settings updated in guild: ${
          interaction.guild!.id
        } - ${JSON.stringify(updateData)}`
      );

      let updatesText = "";
      if (minQueueSize !== null) {
        updatesText += `🎵 **Min Queue Size:** ${minQueueSize}\n`;
      }
      if (maxSongsToAdd !== null) {
        updatesText += `📈 **Max Songs to Add:** ${maxSongsToAdd}\n`;
      }
      if (platformStr) {
        updatesText += `🎯 **Platform:** ${
          platformStr.charAt(0).toUpperCase() + platformStr.slice(1)
        }\n`;
      }

      return interaction.reply({
        content:
          "✅ **AutoPlay Settings Updated!**\n\n" +
          updatesText +
          "\n💡 Changes will take effect for future recommendations.",
      });
    } catch (error) {
      logger.error("Error updating autoplay settings:", error);
      return interaction.reply({
        content: "❌ Failed to update autoplay settings!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

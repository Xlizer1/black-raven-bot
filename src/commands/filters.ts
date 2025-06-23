import { Command } from "@sapphire/framework";
import {
  MessageFlags,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import {
  AudioFilterService,
  type AudioFilters,
} from "../services/AudioFilterService";
import { logger } from "../utils/logger";

export class FiltersCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("filters")
        .setDescription("Manage audio filters for music playback")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription("Show available audio filters")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("enable")
            .setDescription("Enable an audio filter")
            .addStringOption((option) =>
              option
                .setName("filter")
                .setDescription("Filter to enable")
                .addChoices(
                  { name: "Bass Boost", value: "bassboost" },
                  { name: "Nightcore", value: "nightcore" },
                  { name: "Vaporwave", value: "vaporwave" },
                  { name: "8D Audio", value: "eightD" },
                  { name: "Karaoke", value: "karaoke" },
                  { name: "Vibrato", value: "vibrato" },
                  { name: "Tremolo", value: "tremolo" },
                  { name: "Surround", value: "surrounding" },
                  { name: "Pulsator", value: "pulsator" },
                  { name: "Sub-bass Boost", value: "subboost" }
                )
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("disable")
            .setDescription("Disable an audio filter")
            .addStringOption((option) =>
              option
                .setName("filter")
                .setDescription("Filter to disable")
                .addChoices(
                  { name: "Bass Boost", value: "bassboost" },
                  { name: "Nightcore", value: "nightcore" },
                  { name: "Vaporwave", value: "vaporwave" },
                  { name: "8D Audio", value: "eightD" },
                  { name: "Karaoke", value: "karaoke" },
                  { name: "Vibrato", value: "vibrato" },
                  { name: "Tremolo", value: "tremolo" },
                  { name: "Surround", value: "surrounding" },
                  { name: "Pulsator", value: "pulsator" },
                  { name: "Sub-bass Boost", value: "subboost" }
                )
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("clear")
            .setDescription("Clear all active audio filters")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription("Show currently active filters")
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

    // Check if FFmpeg is available
    const audioFilterService = AudioFilterService.getInstance();
    const ffmpegAvailable = await audioFilterService.isFFmpegAvailable();

    if (!ffmpegAvailable) {
      return interaction.reply({
        content:
          "❌ **Audio filters are not available!**\n\n" +
          "FFmpeg is required for audio filters but is not installed or not accessible.\n" +
          "Please install FFmpeg to use this feature.",
        flags: MessageFlags.Ephemeral,
      });
    }

    switch (subcommand) {
      case "list":
        return this.listFilters(interaction);
      case "enable":
        return this.enableFilter(interaction);
      case "disable":
        return this.disableFilter(interaction);
      case "clear":
        return this.clearFilters(interaction);
      case "status":
        return this.showStatus(interaction);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async listFilters(interaction: Command.ChatInputCommandInteraction) {
    const audioFilterService = AudioFilterService.getInstance();
    const availableFilters = await audioFilterService.listAvailableFilters();

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎛️ Available Audio Filters")
      .setDescription("Enhance your music experience with these audio filters!")
      .setTimestamp();

    let filtersText = "";
    for (const filter of availableFilters) {
      const description = await audioFilterService.getFilterDescription(filter);
      const emoji = this.getFilterEmoji(filter);
      filtersText += `${emoji} **${this.getFilterDisplayName(
        filter
      )}**\n${description}\n\n`;
    }

    embed.addFields({
      name: "🎵 Filters",
      value: filtersText,
      inline: false,
    });

    embed.addFields({
      name: "💡 Usage",
      value:
        "• Use `/filters enable <filter>` to enable a filter\n" +
        "• Use `/filters disable <filter>` to disable a filter\n" +
        "• Use `/filters status` to see active filters\n" +
        "• Use `/filters clear` to remove all filters",
      inline: false,
    });

    embed.addFields({
      name: "⚠️ Important Notes",
      value:
        "• Filters are applied to new songs in the queue\n" +
        "• Multiple filters can be active simultaneously\n" +
        "• Some filters may affect audio quality\n" +
        "• Requires FFmpeg to be installed",
      inline: false,
    });

    return interaction.reply({
      embeds: [embed],
    });
  }

  private async enableFilter(interaction: Command.ChatInputCommandInteraction) {
    const filterName = interaction.options.getString(
      "filter",
      true
    ) as keyof AudioFilters;
    const queue = MusicQueue.getQueue(interaction.guild!.id);

    try {
      const success = await queue.enableFilter(filterName);

      if (success) {
        const emoji = this.getFilterEmoji(filterName);
        const displayName = this.getFilterDisplayName(filterName);

        logger.info(
          `Enabled audio filter '${filterName}' in guild: ${
            interaction.guild!.id
          }`
        );

        return interaction.reply({
          content:
            `${emoji} **Filter Enabled!**\n\n` +
            `🎛️ **${displayName}** is now active\n` +
            `🎵 This will apply to the next songs in the queue\n\n` +
            `💡 Use \`/filters status\` to see all active filters`,
        });
      } else {
        return interaction.reply({
          content: `❌ Failed to enable the ${filterName} filter!`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Error enabling filter:", error);
      return interaction.reply({
        content: "❌ An error occurred while enabling the filter!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async disableFilter(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const filterName = interaction.options.getString(
      "filter",
      true
    ) as keyof AudioFilters;
    const queue = MusicQueue.getQueue(interaction.guild!.id);

    try {
      const success = await queue.disableFilter(filterName);

      if (success) {
        const emoji = this.getFilterEmoji(filterName);
        const displayName = this.getFilterDisplayName(filterName);

        logger.info(
          `Disabled audio filter '${filterName}' in guild: ${
            interaction.guild!.id
          }`
        );

        return interaction.reply({
          content:
            `✅ **Filter Disabled!**\n\n` +
            `${emoji} **${displayName}** has been turned off\n` +
            `🎵 This will apply to the next songs in the queue\n\n` +
            `💡 Use \`/filters status\` to see remaining active filters`,
        });
      } else {
        return interaction.reply({
          content: `❌ Failed to disable the ${filterName} filter!`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Error disabling filter:", error);
      return interaction.reply({
        content: "❌ An error occurred while disabling the filter!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async clearFilters(interaction: Command.ChatInputCommandInteraction) {
    const queue = MusicQueue.getQueue(interaction.guild!.id);
    const enabledFilters = queue.getEnabledFilters();

    if (enabledFilters.length === 0) {
      return interaction.reply({
        content: "❌ No filters are currently active!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await queue.clearAllFilters();

      logger.info(
        `Cleared all audio filters in guild: ${interaction.guild!.id}`
      );

      return interaction.reply({
        content:
          `🗑️ **All Filters Cleared!**\n\n` +
          `✅ Removed ${enabledFilters.length} active filter${
            enabledFilters.length === 1 ? "" : "s"
          }\n` +
          `🎵 Audio will return to normal for upcoming songs\n\n` +
          `💡 Use \`/filters list\` to see available filters`,
      });
    } catch (error) {
      logger.error("Error clearing filters:", error);
      return interaction.reply({
        content: "❌ An error occurred while clearing filters!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async showStatus(interaction: Command.ChatInputCommandInteraction) {
    const queue = MusicQueue.getQueue(interaction.guild!.id);
    const enabledFilters = queue.getEnabledFilters();

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎛️ Audio Filters Status")
      .setTimestamp();

    if (enabledFilters.length === 0) {
      embed.setDescription("🔇 No audio filters are currently active");
      embed.addFields({
        name: "💡 Get Started",
        value:
          "Use `/filters list` to see available filters\n" +
          "Use `/filters enable <filter>` to activate a filter",
        inline: false,
      });
    } else {
      embed.setDescription(
        `🎛️ **${enabledFilters.length} filter${
          enabledFilters.length === 1 ? "" : "s"
        } currently active**`
      );

      let filtersText = "";
      for (const filter of enabledFilters) {
        const emoji = this.getFilterEmoji(filter);
        const displayName = this.getFilterDisplayName(filter);
        filtersText += `${emoji} **${displayName}**\n`;
      }

      embed.addFields({
        name: "🎵 Active Filters",
        value: filtersText,
        inline: false,
      });

      embed.addFields({
        name: "💡 Management",
        value:
          "Use `/filters disable <filter>` to remove a specific filter\n" +
          "Use `/filters clear` to remove all filters",
        inline: false,
      });
    }

    // Add current song info if available
    const currentSong = queue.getCurrentSong();
    if (currentSong) {
      embed.addFields({
        name: "🎵 Current Song",
        value: `${currentSong.title}${
          enabledFilters.length > 0
            ? "\n🎛️ Filters will apply to next songs"
            : ""
        }`,
        inline: false,
      });
    }

    return interaction.reply({
      embeds: [embed],
    });
  }

  private getFilterEmoji(filter: keyof AudioFilters): string {
    const emojis: Record<keyof AudioFilters, string> = {
      bassboost: "🔊",
      nightcore: "⚡",
      vaporwave: "🌊",
      eightD: "🎧",
      karaoke: "🎤",
      vibrato: "〰️",
      tremolo: "📳",
      surrounding: "🔄",
      pulsator: "💓",
      subboost: "🎵",
    };

    return emojis[filter] || "🎛️";
  }

  private getFilterDisplayName(filter: keyof AudioFilters): string {
    const names: Record<keyof AudioFilters, string> = {
      bassboost: "Bass Boost",
      nightcore: "Nightcore",
      vaporwave: "Vaporwave",
      eightD: "8D Audio",
      karaoke: "Karaoke",
      vibrato: "Vibrato",
      tremolo: "Tremolo",
      surrounding: "Surround Sound",
      pulsator: "Pulsator",
      subboost: "Sub-bass Boost",
    };

    return names[filter] || filter;
  }
}

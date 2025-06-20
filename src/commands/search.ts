import { Command } from "@sapphire/framework";
import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { MusicService } from "../services/MusicService";
import { MusicPlatform } from "../services/providers/IMusicProvider";
import { logger } from "../utils/logger";

export class SearchCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("search")
        .setDescription("Search for songs without immediately playing them")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Song name or search terms")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("platform")
            .setDescription("Platform to search on")
            .addChoices(
              { name: "YouTube", value: "youtube" },
              { name: "Spotify", value: "spotify" }
            )
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("results")
            .setDescription("Number of results to show (1-10)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const query = interaction.options.getString("query", true);
    const platformChoice = interaction.options.getString(
      "platform"
    ) as MusicPlatform;
    const resultCount = interaction.options.getInteger("results") || 5;

    // Detect platform or use user choice
    const detectedPlatform = MusicService.detectPlatform(query);
    const targetPlatform =
      platformChoice || detectedPlatform || MusicPlatform.YOUTUBE;

    if (MusicService.isUrl(query)) {
      return interaction.reply({
        content:
          "❌ This command is for searching, not URLs! Use `/play` for direct URLs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      logger.info(
        `Search request: "${query}" on ${targetPlatform} (${resultCount} results)`
      );

      const searchResults = await MusicService.search(query, targetPlatform, {
        limit: resultCount,
      });

      if (searchResults.length === 0) {
        return interaction.editReply({
          content: `❌ No results found for "${query}" on ${targetPlatform}.\n💡 Try a different search term or platform.`,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x7289da)
        .setTitle(`🔍 Search Results`)
        .setDescription(
          `Found ${searchResults.length} result${
            searchResults.length === 1 ? "" : "s"
          } for **"${query}"**`
        )
        .setTimestamp();

      // Add platform info
      const platformEmoji = this.getPlatformEmoji(targetPlatform);
      embed.addFields({
        name: "🎯 Platform",
        value: `${platformEmoji} ${
          targetPlatform.charAt(0).toUpperCase() + targetPlatform.slice(1)
        }`,
        inline: true,
      });

      // Create results list
      const resultsText = searchResults
        .map((result, index) => {
          const duration = result.duration
            ? MusicService.formatDuration(result.duration)
            : "Unknown";
          const artist = result.artist ? ` - ${result.artist}` : "";
          const platformEmoji = this.getPlatformEmoji(result.platform);

          return `**${index + 1}.** ${platformEmoji} ${
            result.title
          }${artist}\n⏱️ ${duration}`;
        })
        .join("\n\n");

      embed.addFields({
        name: `🎵 Results (${searchResults.length}/${resultCount})`,
        value: resultsText,
        inline: false,
      });

      // Create select menu for choosing songs to play
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("search_select")
        .setPlaceholder("Choose a song to add to queue...")
        .setMinValues(1)
        .setMaxValues(Math.min(searchResults.length, 5)); // Allow multiple selections

      searchResults.forEach((result, index) => {
        const artist = result.artist ? ` - ${result.artist}` : "";
        const duration = result.duration
          ? ` (${MusicService.formatDuration(result.duration)})`
          : "";

        selectMenu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${index + 1}. ${result.title}${artist}`)
            .setDescription(`Platform: ${result.platform}${duration}`)
            .setValue(`search_play_${index}`)
            .setEmoji(this.getPlatformEmoji(result.platform))
        );
      });

      // Create action buttons
      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("search_play_all")
          .setLabel("Add All to Queue")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId("search_shuffle_all")
          .setLabel("Add All & Shuffle")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔀"),
        new ButtonBuilder()
          .setCustomId("search_new")
          .setLabel("New Search")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔍")
      );

      // Store search results for later use (in a real bot, you'd use a database or cache)
      // For now, we'll include them in the custom IDs (not ideal but works for demo)

      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            selectMenu
          ),
          buttonRow,
        ],
      });
    } catch (error) {
      logger.error("Search command error:", error);
      return interaction.editReply({
        content: `❌ An error occurred while searching for "${query}". Please try again.`,
      });
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

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
import { MusicQueue } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";
import { MusicPlatform } from "../services/providers/IMusicProvider";
import { logger } from "../utils/logger";

export class SimilarCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("similar")
        .setDescription(
          "Find similar songs based on current track or a specified song"
        )
        .addStringOption((option) =>
          option
            .setName("song")
            .setDescription(
              "Song to find similar tracks for (if not specified, uses current song)"
            )
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("platform")
            .setDescription("Platform to search on for similar songs")
            .addChoices(
              { name: "YouTube", value: "youtube" },
              { name: "Spotify", value: "spotify" }
            )
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Number of similar songs to find (1-10)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
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

    const songQuery = interaction.options.getString("song");
    const platformChoice = interaction.options.getString(
      "platform"
    ) as MusicPlatform;
    const count = interaction.options.getInteger("count") || 5;
    const queue = MusicQueue.getQueue(interaction.guild.id);
    const currentSong = queue.getCurrentSong();

    let targetSong: { title: string; artist?: string; platform: string };
    let searchBase: string;

    if (songQuery) {
      // User specified a song
      targetSong = {
        title: songQuery,
        artist: undefined,
        platform: "unknown",
      };
      searchBase = songQuery;
    } else if (currentSong) {
      // Use current playing song
      targetSong = {
        title: currentSong.title,
        artist: currentSong.artist,
        platform: currentSong.platform,
      };
      searchBase = currentSong.artist
        ? `${currentSong.artist} ${currentSong.title}`
        : currentSong.title;
    } else {
      return interaction.reply({
        content:
          "❌ No song is currently playing! Specify a song with `/similar <song name>`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetPlatform = platformChoice || MusicPlatform.YOUTUBE;

    await interaction.deferReply();

    try {
      logger.info(
        `Finding similar songs for: "${searchBase}" on ${targetPlatform}`
      );

      // Generate similar song queries
      const similarQueries = this.generateSimilarQueries(targetSong);

      // Search for similar songs
      const similarSongs = await this.searchSimilarSongs(
        similarQueries,
        targetPlatform,
        count
      );

      if (similarSongs.length === 0) {
        const platformEmoji = this.getPlatformEmoji(targetSong.platform);
        return interaction.editReply({
          content:
            `❌ **No similar songs found**\n\n` +
            `${platformEmoji} **${targetSong.title}**\n` +
            `${
              targetSong.artist ? `👤 **Artist:** ${targetSong.artist}\n` : ""
            }` +
            `🔍 **Searched on:** ${targetPlatform}\n\n` +
            `💡 **Try:**\n` +
            `• Using a different platform\n` +
            `• Searching for a more popular song\n` +
            `• Using \`/search\` instead for manual selection`,
        });
      }

      // Create results embed
      const embed = new EmbedBuilder()
        .setColor(0x7289da)
        .setTitle("🎯 Similar Songs")
        .setTimestamp();

      // Add source song info
      const sourcePlatformEmoji = this.getPlatformEmoji(targetSong.platform);
      embed.setDescription(
        `**Based on:** ${sourcePlatformEmoji} ${targetSong.title}${
          targetSong.artist ? ` - ${targetSong.artist}` : ""
        }\n` +
          `**Found ${similarSongs.length} similar song${
            similarSongs.length === 1 ? "" : "s"
          } on ${targetPlatform}**`
      );

      // Create similar songs list
      const songsText = similarSongs
        .map((song, index) => {
          const duration = song.duration
            ? MusicService.formatDuration(song.duration)
            : "Unknown";
          const platformEmoji = this.getPlatformEmoji(song.platform);
          const artist = song.artist ? ` - ${song.artist}` : "";

          return `**${index + 1}.** ${platformEmoji} ${
            song.title
          }${artist}\n⏱️ ${duration}`;
        })
        .join("\n\n");

      embed.addFields({
        name: `🎵 Similar Songs (${similarSongs.length}/${count})`,
        value: songsText,
        inline: false,
      });

      // Add recommendation info
      embed.addFields({
        name: "🤖 How we find similar songs",
        value:
          "• Artist name matching\n" +
          "• Genre-based searches\n" +
          "• Related artist recommendations\n" +
          "• Musical style patterns",
        inline: true,
      });

      // Create select menu for adding songs
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("similar_select")
        .setPlaceholder("Choose songs to add to queue...")
        .setMinValues(1)
        .setMaxValues(Math.min(similarSongs.length, 5));

      similarSongs.forEach((song, index) => {
        const artist = song.artist ? ` - ${song.artist}` : "";
        const duration = song.duration
          ? ` (${MusicService.formatDuration(song.duration)})`
          : "";

        selectMenu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${index + 1}. ${song.title}${artist}`)
            .setDescription(`Platform: ${song.platform}${duration}`)
            .setValue(`similar_play_${index}`)
            .setEmoji(this.getPlatformEmoji(song.platform))
        );
      });

      // Create action buttons
      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("similar_add_all")
          .setLabel("Add All to Queue")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId("similar_radio_mode")
          .setLabel("Start Radio Mode")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📻"),
        new ButtonBuilder()
          .setCustomId("similar_new_search")
          .setLabel("Find More")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄")
      );

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
      logger.error("Similar songs command error:", error);
      return interaction.editReply({
        content:
          `❌ **Error finding similar songs**\n\n` +
          `🎵 **Source:** ${targetSong.title}\n` +
          `🔍 **Platform:** ${targetPlatform}\n\n` +
          `💡 The music discovery service may be temporarily unavailable. Try again later.`,
      });
    }
  }

  private generateSimilarQueries(song: {
    title: string;
    artist?: string;
    platform: string;
  }): string[] {
    const queries: string[] = [];

    if (song.artist) {
      // Search for other songs by the same artist
      queries.push(song.artist);

      // Search for similar artists (this would need a music database/API)
      queries.push(`${song.artist} similar artists`);
      queries.push(`like ${song.artist}`);
    }

    // Extract genre/style keywords from title
    const styleKeywords = this.extractStyleKeywords(song.title);
    queries.push(...styleKeywords);

    // Add some generic music discovery searches
    queries.push(`recommended songs`);
    queries.push(`popular music`);

    return queries.slice(0, 5); // Limit to avoid too many searches
  }

  private extractStyleKeywords(title: string): string[] {
    const keywords: string[] = [];
    const lowerTitle = title.toLowerCase();

    // Musical genres and styles that might be in titles
    const genreKeywords = [
      "rock",
      "pop",
      "jazz",
      "blues",
      "country",
      "folk",
      "electronic",
      "dance",
      "house",
      "techno",
      "ambient",
      "classical",
      "instrumental",
      "acoustic",
      "cover",
      "remix",
      "live",
      "unplugged",
    ];

    for (const genre of genreKeywords) {
      if (lowerTitle.includes(genre)) {
        keywords.push(genre);
        keywords.push(`${genre} music`);
      }
    }

    return keywords;
  }

  private async searchSimilarSongs(
    queries: string[],
    platform: MusicPlatform,
    targetCount: number
  ): Promise<any[]> {
    const allSongs: any[] = [];
    const seenTitles = new Set<string>();

    try {
      for (const query of queries) {
        if (allSongs.length >= targetCount) break;

        try {
          const results = await MusicService.search(query, platform, {
            limit: Math.min(3, targetCount - allSongs.length + 2),
          });

          for (const song of results) {
            if (allSongs.length >= targetCount) break;

            // Avoid duplicates
            const titleKey = song.title.toLowerCase().trim();
            if (!seenTitles.has(titleKey)) {
              seenTitles.add(titleKey);
              allSongs.push(song);
            }
          }
        } catch (error) {
          logger.warn(`Failed to search for query "${query}":`, error);
          continue;
        }
      }

      // Shuffle to provide variety
      this.shuffleArray(allSongs);

      return allSongs.slice(0, targetCount);
    } catch (error) {
      logger.error("Error searching for similar songs:", error);
      return [];
    }
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
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

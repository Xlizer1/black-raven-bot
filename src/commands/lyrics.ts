// src/commands/lyrics.ts

import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class LyricsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("lyrics")
        .setDescription("Fetch lyrics for the current song or a specific song")
        .addStringOption((option) =>
          option
            .setName("song")
            .setDescription(
              "Song to search lyrics for (if not specified, uses current song)"
            )
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
    const queue = MusicQueue.getQueue(interaction.guild.id);
    const currentSong = queue.getCurrentSong();

    let searchQuery: string;
    let songTitle: string;
    let artist: string | undefined;

    if (songQuery) {
      // User specified a song to search for
      searchQuery = songQuery;
      songTitle = songQuery;
      artist = undefined;
    } else if (currentSong) {
      // Use current playing song
      songTitle = currentSong.title;
      artist = currentSong.artist;
      searchQuery = artist ? `${artist} ${songTitle}` : songTitle;
    } else {
      return interaction.reply({
        content:
          "❌ No song is currently playing! Specify a song with `/lyrics <song name>`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      logger.info(`Lyrics request for: "${searchQuery}"`);

      // Search for lyrics using multiple methods
      const lyrics = await this.searchLyrics(searchQuery, songTitle, artist);

      if (!lyrics) {
        const platformEmoji = currentSong
          ? this.getPlatformEmoji(currentSong.platform)
          : "🎵";
        return interaction.editReply({
          content:
            `❌ **No lyrics found**\n\n` +
            `${platformEmoji} **${songTitle}**\n` +
            `${artist ? `👤 **Artist:** ${artist}\n` : ""}` +
            `🔍 **Searched for:** "${searchQuery}"\n\n` +
            `💡 **Try:**\n` +
            `• Check the song/artist spelling\n` +
            `• Use \`/lyrics <artist> - <song>\` format\n` +
            `• Some songs may not have lyrics available`,
        });
      }

      // Create lyrics embed
      const embed = new EmbedBuilder()
        .setColor(0x7289da)
        .setTitle(`🎤 Lyrics`)
        .setTimestamp();

      // Add song info
      const platformEmoji = currentSong
        ? this.getPlatformEmoji(currentSong.platform)
        : "🎵";
      embed.setDescription(
        `${platformEmoji} **${lyrics.title}**${
          lyrics.artist ? `\n👤 **${lyrics.artist}**` : ""
        }`
      );

      // Split lyrics into chunks if too long (Discord embed limit is 4096 characters)
      const maxLength = 4000; // Leave some room for other content

      if (lyrics.lyrics.length <= maxLength) {
        embed.addFields({
          name: "📝 Lyrics",
          value: lyrics.lyrics,
          inline: false,
        });
      } else {
        // Split into multiple fields
        const chunks = this.chunkLyrics(lyrics.lyrics, maxLength);
        chunks.forEach((chunk, index) => {
          embed.addFields({
            name: index === 0 ? "📝 Lyrics" : "📝 Lyrics (continued)",
            value: chunk,
            inline: false,
          });
        });
      }

      // Add source info
      if (lyrics.source) {
        embed.addFields({
          name: "🔗 Source",
          value: lyrics.source,
          inline: true,
        });
      }

      // Add current song context if different from search
      if (currentSong && !songQuery) {
        embed.addFields({
          name: "🎵 Currently Playing",
          value: `${this.getPlatformEmoji(currentSong.platform)} ${
            currentSong.title
          }`,
          inline: true,
        });
      }

      return interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      logger.error("Error fetching lyrics:", error);
      return interaction.editReply({
        content:
          `❌ **Error fetching lyrics**\n\n` +
          `🔍 **Searched for:** "${searchQuery}"\n` +
          `💡 The lyrics service may be temporarily unavailable. Try again later.`,
      });
    }
  }

  private async searchLyrics(
    query: string,
    title: string,
    artist?: string
  ): Promise<{
    title: string;
    artist?: string;
    lyrics: string;
    source?: string;
  } | null> {
    try {
      // Method 1: Try with a simple lyrics API (using Lyrics.ovh as example)
      const lyricsOvhResult = await this.fetchFromLyricsOvh(artist, title);
      if (lyricsOvhResult) {
        return lyricsOvhResult;
      }

      // Method 2: Try with a different approach - search by full query
      const searchResult = await this.fetchBySearch(query);
      if (searchResult) {
        return searchResult;
      }

      return null;
    } catch (error) {
      logger.error("Error in lyrics search:", error);
      return null;
    }
  }

  private async fetchFromLyricsOvh(
    artist?: string,
    title?: string
  ): Promise<{
    title: string;
    artist?: string;
    lyrics: string;
    source: string;
  } | null> {
    try {
      if (!artist || !title) return null;

      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(
        artist
      )}/${encodeURIComponent(title)}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "Discord Music Bot",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { lyrics?: string };

      if (data.lyrics) {
        return {
          title,
          artist,
          lyrics: data.lyrics.trim(),
          source: "Lyrics.ovh",
        };
      }

      return null;
    } catch (error) {
      logger.warn("Lyrics.ovh fetch failed:", error);
      return null;
    }
  }

  private async fetchBySearch(query: string): Promise<{
    title: string;
    artist?: string;
    lyrics: string;
    source: string;
  } | null> {
    try {
      // This is a placeholder for other lyrics APIs
      // You could integrate with:
      // - Genius API (requires API key)
      // - AZLyrics scraping (be careful with rate limits)
      // - Musixmatch API (requires API key)
      // - LyricFind API (requires API key)

      // For now, return null to indicate no additional search methods
      logger.info(
        `No additional lyrics search methods implemented for: ${query}`
      );
      return null;
    } catch (error) {
      logger.warn("Search lyrics fetch failed:", error);
      return null;
    }
  }

  private chunkLyrics(lyrics: string, maxLength: number): string[] {
    const chunks: string[] = [];
    const lines = lyrics.split("\n");
    let currentChunk = "";

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
      }
      currentChunk += line + "\n";
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
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

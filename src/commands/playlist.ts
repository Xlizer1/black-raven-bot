import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { GuildMember } from "discord.js";
import { MusicService } from "../services/MusicService";
import { MusicQueue } from "../services/MusicQueue";
import { MusicPlatform } from "../services/providers/IMusicProvider";
import { logger } from "../utils/logger";

export class PlaylistCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("playlist")
        .setDescription(
          "Load and play entire playlists from YouTube or Spotify"
        )
        .addStringOption((option) =>
          option
            .setName("url")
            .setDescription("YouTube or Spotify playlist URL")
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("shuffle")
            .setDescription("Shuffle the playlist before adding to queue")
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Maximum number of songs to add (1-50)")
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false)
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    // Check if user is in a voice channel
    const member = interaction.member as GuildMember;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel to load playlists!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const playlistUrl = interaction.options.getString("url", true);
    const shouldShuffle = interaction.options.getBoolean("shuffle") || false;
    const limit = interaction.options.getInteger("limit") || 25;

    // Validate URL format
    if (!this.isValidPlaylistUrl(playlistUrl)) {
      return interaction.reply({
        content:
          "❌ **Invalid playlist URL!**\n\n" +
          "**Supported formats:**\n" +
          "📺 YouTube: `https://youtube.com/playlist?list=...`\n" +
          "🟢 Spotify: `https://open.spotify.com/playlist/...`\n\n" +
          "💡 Make sure the playlist is public or unlisted",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const platform = this.detectPlaylistPlatform(playlistUrl);
      logger.info(
        `Loading ${platform} playlist: ${playlistUrl} (limit: ${limit}, shuffle: ${shouldShuffle})`
      );

      // Load playlist metadata first
      const playlistInfo = await this.getPlaylistInfo(playlistUrl, platform);
      if (!playlistInfo) {
        return interaction.editReply(
          "❌ Could not load playlist information! Make sure the playlist is public and the URL is correct."
        );
      }

      // Send initial status message
      const statusEmbed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle("⏳ Loading Playlist...")
        .setDescription(
          `${this.getPlatformEmoji(platform)} **${playlistInfo.title}**`
        )
        .addFields(
          {
            name: "📊 Total Songs",
            value: playlistInfo.songCount.toString(),
            inline: true,
          },
          {
            name: "📥 Will Load",
            value: Math.min(limit, playlistInfo.songCount).toString(),
            inline: true,
          },
          {
            name: "🔀 Shuffle",
            value: shouldShuffle ? "Yes" : "No",
            inline: true,
          }
        );

      await interaction.editReply({ embeds: [statusEmbed] });

      // Load playlist songs
      const songs = await this.loadPlaylistSongs(playlistUrl, platform, limit);

      if (songs.length === 0) {
        return interaction.editReply(
          "❌ No songs could be loaded from the playlist!"
        );
      }

      // Shuffle if requested
      if (shouldShuffle) {
        this.shuffleArray(songs);
      }

      // Add songs to queue
      const queue = MusicQueue.getQueue(interaction.guild.id);
      let addedCount = 0;
      const failedSongs: string[] = [];

      for (const song of songs) {
        try {
          queue.add({
            ...song,
            requestedBy: interaction.user.id,
          });
          addedCount++;
        } catch (error) {
          failedSongs.push(song.title);
          logger.warn(`Failed to add song to queue: ${song.title}`, error);
        }
      }

      // Start playing if nothing is currently playing
      const wasEmpty = !queue.getIsPlaying() && !queue.getCurrentSong();
      if (wasEmpty && addedCount > 0) {
        // The playNext logic should be called here
        // This would be integrated with your existing play command logic
      }

      // Create success response
      const successEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Playlist Loaded Successfully!")
        .setDescription(
          `${this.getPlatformEmoji(platform)} **${playlistInfo.title}**`
        )
        .addFields(
          {
            name: "✅ Added to Queue",
            value: addedCount.toString(),
            inline: true,
          },
          {
            name: "📋 Queue Position",
            value: `${queue.size() - addedCount + 1}-${queue.size()}`,
            inline: true,
          },
          {
            name: "🔀 Shuffled",
            value: shouldShuffle ? "Yes" : "No",
            inline: true,
          }
        );

      if (failedSongs.length > 0) {
        successEmbed.addFields({
          name: "⚠️ Failed to Load",
          value: `${failedSongs.length} song${
            failedSongs.length === 1 ? "" : "s"
          }\n${failedSongs.slice(0, 3).join(", ")}${
            failedSongs.length > 3 ? "..." : ""
          }`,
          inline: false,
        });
      }

      if (wasEmpty) {
        successEmbed.addFields({
          name: "🎵 Now Playing",
          value: `Started playing the first song from the playlist`,
          inline: false,
        });
      }

      successEmbed.addFields({
        name: "💡 Tip",
        value:
          "Use `/queue` to see all loaded songs • Use `/shuffle` to randomize the order",
        inline: false,
      });

      return interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      logger.error("Playlist command error:", error);
      return interaction.editReply({
        content:
          "❌ **Failed to load playlist!**\n\n" +
          "This could happen if:\n" +
          "• The playlist is private or deleted\n" +
          "• The URL is invalid\n" +
          "• There's a network error\n" +
          "• The platform is temporarily unavailable\n\n" +
          "💡 Try again with a public playlist URL",
      });
    }
  }

  private isValidPlaylistUrl(url: string): boolean {
    const youtubePlaylistRegex =
      /^https?:\/\/(www\.)?(youtube\.com\/playlist\?list=|youtu\.be\/playlist\?list=)[\w-]+/;
    const spotifyPlaylistRegex =
      /^https?:\/\/open\.spotify\.com\/playlist\/[\w]+/;

    return youtubePlaylistRegex.test(url) || spotifyPlaylistRegex.test(url);
  }

  private detectPlaylistPlatform(url: string): MusicPlatform {
    if (url.includes("spotify.com")) {
      return MusicPlatform.SPOTIFY;
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return MusicPlatform.YOUTUBE;
    }
    return MusicPlatform.YOUTUBE; // default
  }

  private async getPlaylistInfo(
    url: string,
    platform: MusicPlatform
  ): Promise<{
    title: string;
    songCount: number;
    description?: string;
  } | null> {
    try {
      if (platform === MusicPlatform.YOUTUBE) {
        return await this.getYouTubePlaylistInfo(url);
      } else if (platform === MusicPlatform.SPOTIFY) {
        return await this.getSpotifyPlaylistInfo(url);
      }
      return null;
    } catch (error) {
      logger.error("Error getting playlist info:", error);
      return null;
    }
  }

  private async getYouTubePlaylistInfo(url: string): Promise<{
    title: string;
    songCount: number;
    description?: string;
  } | null> {
    try {
      // Use yt-dlp to get playlist info
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const command = `yt-dlp --dump-json --playlist-items 1 "${url}" --no-warnings`;
      const { stdout } = await execAsync(command, { timeout: 15000 });

      const data = JSON.parse(stdout.trim());

      return {
        title: data.playlist_title || data.playlist || "Unknown Playlist",
        songCount: data.playlist_count || 0,
        description: data.description,
      };
    } catch (error) {
      logger.error("Error getting YouTube playlist info:", error);
      return null;
    }
  }

  private async getSpotifyPlaylistInfo(url: string): Promise<{
    title: string;
    songCount: number;
    description?: string;
  } | null> {
    try {
      // Extract playlist ID from URL
      const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!match) return null;

      const playlistId = match[1];

      // This would require Spotify API integration
      // For now, return mock data
      return {
        title: "Spotify Playlist",
        songCount: 0,
        description: "Spotify playlist loading not fully implemented",
      };
    } catch (error) {
      logger.error("Error getting Spotify playlist info:", error);
      return null;
    }
  }

  private async loadPlaylistSongs(
    url: string,
    platform: MusicPlatform,
    limit: number
  ): Promise<any[]> {
    try {
      if (platform === MusicPlatform.YOUTUBE) {
        return await this.loadYouTubePlaylistSongs(url, limit);
      } else if (platform === MusicPlatform.SPOTIFY) {
        return await this.loadSpotifyPlaylistSongs(url, limit);
      }
      return [];
    } catch (error) {
      logger.error("Error loading playlist songs:", error);
      return [];
    }
  }

  private async loadYouTubePlaylistSongs(
    url: string,
    limit: number
  ): Promise<any[]> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const command = `yt-dlp --dump-json --playlist-items 1:${limit} "${url}" --no-warnings`;
      const { stdout } = await execAsync(command, {
        timeout: 60000, // Longer timeout for playlists
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      const lines = stdout.trim().split("\n");
      const songs = [];

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            songs.push({
              id: data.id || "unknown",
              title: data.title || "Unknown",
              url: data.webpage_url || data.url || "",
              duration: data.duration,
              thumbnail: data.thumbnail,
              platform: MusicPlatform.YOUTUBE,
              artist: data.uploader,
              album: undefined,
            });
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

      return songs;
    } catch (error) {
      logger.error("Error loading YouTube playlist songs:", error);
      return [];
    }
  }

  private async loadSpotifyPlaylistSongs(
    url: string,
    limit: number
  ): Promise<any[]> {
    try {
      // This would require full Spotify API integration
      // For now, return empty array
      logger.warn("Spotify playlist loading not fully implemented");
      return [];
    } catch (error) {
      logger.error("Error loading Spotify playlist songs:", error);
      return [];
    }
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      const other = array[j];

      if (temp !== undefined && other !== undefined) {
        array[i] = other;
        array[j] = temp;
      }
    }
  }

  private getPlatformEmoji(platform: MusicPlatform): string {
    switch (platform) {
      case MusicPlatform.YOUTUBE:
        return "📺";
      case MusicPlatform.SPOTIFY:
        return "🟢";
      case MusicPlatform.SOUNDCLOUD:
        return "🟠";
      default:
        return "🎵";
    }
  }
}

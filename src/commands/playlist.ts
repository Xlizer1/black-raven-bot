import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { GuildMember } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice";
import { MusicService } from "../services/MusicService";
import { MusicQueue } from "../services/MusicQueue";
import { MusicPlatform } from "../services/providers/IMusicProvider";
import { SpotifyProvider } from "../services/providers/SpotifyProvider";
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
          "Load playlists from YouTube (playback) or Spotify (metadata only)"
        )
        .addStringOption((option) =>
          option
            .setName("url")
            .setDescription("YouTube playlist URL or Spotify playlist URL")
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
          "📺 YouTube: `https://youtube.com/playlist?list=...` (for playback)\n" +
          "🟢 Spotify: `https://open.spotify.com/playlist/...` (metadata only)\n\n" +
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

      // Handle Spotify playlists differently - NO PLAYBACK
      if (platform === MusicPlatform.SPOTIFY) {
        return this.handleSpotifyPlaylist(
          interaction,
          playlistUrl,
          limit,
          shouldShuffle
        );
      }

      // Handle YouTube playlists (existing logic)
      return this.handleYouTubePlaylist(
        interaction,
        playlistUrl,
        limit,
        shouldShuffle,
        voiceChannel
      );
    } catch (error) {
      logger.error("Playlist command error:", error);
      return interaction.editReply({
        content:
          "❌ **Failed to load playlist!**\n\n" +
          "This could happen if:\n" +
          "• The playlist is private or deleted\n" +
          "• The URL is invalid\n" +
          "• There was a network error\n" +
          "• The platform is temporarily unavailable\n\n" +
          "💡 Try again with a public playlist URL",
      });
    }
  }

  private async handleSpotifyPlaylist(
    interaction: Command.ChatInputCommandInteraction,
    playlistUrl: string,
    limit: number,
    shouldShuffle: boolean
  ) {
    try {
      const spotifyProvider = new SpotifyProvider();

      // Get playlist info
      const playlistInfo = await spotifyProvider.getPlaylistInfo(playlistUrl);
      if (!playlistInfo) {
        return interaction.editReply(
          "❌ Could not load Spotify playlist information! Make sure the playlist is public and the URL is correct."
        );
      }

      // Get playlist songs (metadata only)
      const songs = await spotifyProvider.loadPlaylistSongs(playlistUrl, limit);
      if (songs.length === 0) {
        return interaction.editReply(
          "❌ No songs could be loaded from the Spotify playlist!"
        );
      }

      // Create metadata display
      const embed = new EmbedBuilder()
        .setColor(0x1db954) // Spotify green
        .setTitle("🟢 Spotify Playlist Loaded (Metadata Only)")
        .setDescription(
          `**${playlistInfo.title}**\n\n` +
            `⚠️ **Spotify doesn't allow direct playback**\n` +
            `📋 **Loaded:** ${songs.length} song${
              songs.length === 1 ? "" : "s"
            } metadata`
        )
        .addFields({
          name: "📊 Playlist Info",
          value:
            `🎵 **Total Songs:** ${playlistInfo.songCount}\n` +
            `📥 **Loaded:** ${songs.length}\n` +
            `🔀 **Shuffled:** ${shouldShuffle ? "Yes" : "No"}`,
          inline: true,
        });

      // Show first few songs
      const songsToShow = songs.slice(0, 10);
      if (shouldShuffle) {
        this.shuffleArray(songsToShow);
      }

      const songsList = songsToShow
        .map((song, index) => {
          const duration = song.duration
            ? this.formatDuration(song.duration)
            : "Unknown";
          return `${index + 1}. **${song.title}** - ${
            song.artist
          } (${duration})`;
        })
        .join("\n");

      embed.addFields({
        name: `🎵 Songs (showing ${songsToShow.length}/${songs.length})`,
        value: songsList,
        inline: false,
      });

      embed.addFields({
        name: "💡 How to Play These Songs",
        value:
          "**Option 1: Search individually**\n" +
          "Use `/play <artist> - <song title>` for each song\n\n" +
          "**Option 2: Manual search**\n" +
          "Use `/search` command to find songs on YouTube\n\n" +
          "**Option 3: Export playlist**\n" +
          "Copy song names and search on YouTube manually\n\n" +
          "🔍 **Example:** `/play ${songs[0]?.artist} ${songs[0]?.title}`",
        inline: false,
      });

      // Generate search suggestions for first few songs
      const searchSuggestions = songs
        .slice(0, 3)
        .map(
          (song, index) =>
            `${index + 1}. \`/play ${song.artist} ${song.title}\``
        )
        .join("\n");

      embed.addFields({
        name: "🚀 Quick Search Commands",
        value: searchSuggestions,
        inline: false,
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error("Spotify playlist error:", error);
      return interaction.editReply({
        content:
          "❌ **Failed to load Spotify playlist!**\n\n" +
          "This could happen if:\n" +
          "• The playlist is private\n" +
          "• Spotify API is temporarily unavailable\n" +
          "• The URL is invalid\n\n" +
          "💡 Make sure the playlist is public and try again",
      });
    }
  }

  private async handleYouTubePlaylist(
    interaction: Command.ChatInputCommandInteraction,
    playlistUrl: string,
    limit: number,
    shouldShuffle: boolean,
    voiceChannel: any
  ) {
    // Load playlist metadata first
    const playlistInfo = await this.getPlaylistInfo(
      playlistUrl,
      MusicPlatform.YOUTUBE
    );
    if (!playlistInfo) {
      return interaction.editReply(
        "❌ Could not load YouTube playlist information! Make sure the playlist is public and the URL is correct."
      );
    }

    // Send initial status message
    const statusEmbed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle("⏳ Loading YouTube Playlist...")
      .setDescription(`📺 **${playlistInfo.title}**`)
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
    const songs = await this.loadYouTubePlaylistSongs(playlistUrl, limit);

    if (songs.length === 0) {
      return interaction.editReply(
        "❌ No songs could be loaded from the YouTube playlist!"
      );
    }

    // Shuffle if requested
    if (shouldShuffle) {
      this.shuffleArray(songs);
    }

    // Add songs to queue
    const queue = MusicQueue.getQueue(interaction.guild!.id);
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
      try {
        await this.startPlayback(queue, voiceChannel, interaction);
      } catch (error) {
        logger.error("Failed to start playback after loading playlist:", error);
      }
    }

    // Create success response
    const successEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("✅ YouTube Playlist Loaded Successfully!")
      .setDescription(`📺 **${playlistInfo.title}**`)
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
  }

  // Helper methods
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

  private async startPlayback(
    queue: MusicQueue,
    voiceChannel: any,
    interaction: any
  ): Promise<void> {
    const currentSong = queue.next();
    if (!currentSong) {
      queue.setPlaying(false);
      return;
    }

    queue.setCurrentSong(currentSong);
    queue.setPlaying(true);

    try {
      logger.info(`Starting playback: ${currentSong.title}`);

      // Get stream info
      const baseStreamInfo = await MusicService.getStreamInfo(currentSong.url);
      if (!baseStreamInfo) {
        logger.error(`Failed to get stream for: ${currentSong.title}`);
        return this.startPlayback(queue, voiceChannel, interaction);
      }

      // Apply filters if any are active
      const filteredStreamUrl = await queue.applyFiltersToStream(
        baseStreamInfo.streamUrl
      );
      const finalStreamUrl = filteredStreamUrl || baseStreamInfo.streamUrl;

      // Join voice channel if not connected
      let connection = queue.getConnection();
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild!.id,
          adapterCreator: interaction.guild!.voiceAdapterCreator as any,
        });
        queue.setConnection(connection);
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      }

      // Create audio resource
      const resource = createAudioResource(finalStreamUrl, {
        inputType: StreamType.Arbitrary,
      });

      // Create player if needed
      let player = queue.getPlayer();
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });
        queue.setPlayer(player);

        // Set up player events
        player.on(AudioPlayerStatus.Idle, () => {
          logger.info("Song finished, playing next");
          this.startPlayback(queue, voiceChannel, interaction);
        });

        player.on("error", (error) => {
          logger.error("Audio player error:", error);
          this.startPlayback(queue, voiceChannel, interaction);
        });

        connection.subscribe(player);
      }

      // Play the audio
      player.play(resource);

      logger.info(`Now playing: ${currentSong.title} from playlist`);
    } catch (error) {
      logger.error("Playback error:", error);
      return this.startPlayback(queue, voiceChannel, interaction);
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

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
}

import { Command } from "@sapphire/framework";
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
import { GuildMember, MessageFlags } from "discord.js";
import { MusicService } from "../services/MusicService";
import { MusicQueue } from "../services/MusicQueue";
import { AutocompleteService } from "../services/AutocompleteService";
import { CommandMiddleware } from "../middleware/CommandMiddleware";
import { logger } from "../utils/logger";
import {
  MusicPlatform,
  type VideoInfo,
} from "../services/providers/IMusicProvider";

export class PlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("play")
        .setDescription("Play music from URLs or search YouTube")
        .addStringOption(
          (option) =>
            option
              .setName("query")
              .setDescription("Song name, YouTube URL, or Spotify URL")
              .setRequired(true)
              .setAutocomplete(true) // Enable autocomplete
        )
    );
  }

  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction
  ) {
    try {
      const focusedValue = interaction.options.getFocused();
      const autocompleteService = AutocompleteService.getInstance();

      const results = await autocompleteService.getAutocompleteResults(
        focusedValue
      );
      return interaction.respond(results);
    } catch (error) {
      logger.error("Autocomplete error:", error);
      // Return empty results on error to avoid breaking the interaction
      return interaction.respond([]);
    }
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    // Apply middleware checks
    const middlewareResult = await CommandMiddleware.checkMusicCommand(
      interaction,
      "play",
      { requireVoiceChannel: true }
    );

    if (!middlewareResult.allowed) {
      return CommandMiddleware.handleMiddlewareResult(
        interaction,
        middlewareResult
      );
    }

    const member = interaction.member as GuildMember;
    const voiceChannel = member?.voice?.channel;

    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const query = interaction.options.getString("query", true);

    logger.info(`[PlayCommand] Received query: ${query}`);

    await interaction.deferReply();

    try {
      const queue = MusicQueue.getQueue(interaction.guild.id);
      let trackInfo: VideoInfo | null = null;

      // Handle autocomplete selection
      if (query.includes("|||")) {
        logger.info(`[PlayCommand] Autocomplete branch entered.`);
        const autocompleteService = AutocompleteService.getInstance();
        const parsed = autocompleteService.parseAutocompleteValue(query);
        logger.info(`[PlayCommand] Autocomplete parsed: ${JSON.stringify(parsed)}`);

        if (parsed) {
          // If it's a direct URL from autocomplete, use it
          if (MusicService.isUrl(parsed.url)) {
            logger.info(`[PlayCommand] Autocomplete: Detected URL: ${parsed.url}`);
            trackInfo = await MusicService.getTrackInfo(parsed.url);
            logger.info(`[PlayCommand] Autocomplete: Track info: ${JSON.stringify(trackInfo)}`);
          } else {
            logger.info(`[PlayCommand] Autocomplete: Searching for title: ${parsed.title}`);
            const searchResults = await MusicService.search(
              parsed.title,
              MusicPlatform.YOUTUBE,
              { limit: 1 }
            );
            logger.info(`[PlayCommand] Autocomplete: Search results: ${JSON.stringify(searchResults)}`);
            trackInfo = searchResults[0] || null;
          }
        } else {
          logger.warn(`[PlayCommand] Autocomplete: Failed to parse value.`);
        }
      }

      // Fallback to normal processing if autocomplete parsing failed
      if (!trackInfo) {
        logger.info(`[PlayCommand] No trackInfo from autocomplete, entering fallback path.`);
        // Check if input is a URL or text search
        if (MusicService.isUrl(query)) {
          logger.info(`[PlayCommand] Query is a URL.`);
          // NEW: Check if it's a playlist URL
          if (this.isPlaylistUrl(query)) {
            logger.info(`[PlayCommand] Detected playlist URL: ${query}`);
            // Handle playlist links directly
            try {
              await interaction.editReply({ content: '⏳ Loading playlist, please wait...' });
              const tracks = await MusicService.loadPlaylistSongs(query, 100);
              logger.info(`[PlayCommand] Loaded ${tracks.length} tracks from playlist.`);
              if (!tracks || tracks.length === 0) {
                logger.warn(`[PlayCommand] Playlist load returned empty or null.`);
                return interaction.editReply({
                  content: '❌ Failed to load playlist or playlist is empty!'
                });
              }
              // Add all tracks to queue
              const queueItems = tracks.map(track => queue.add({
                ...track,
                requestedBy: interaction.user.id,
              }));
              logger.info(`[PlayCommand] Added ${queueItems.length} tracks to queue.`);
              // Start playback if nothing is playing
              if (!queue.getIsPlaying()) {
                logger.info(`[PlayCommand] Queue is not playing, starting playback.`);
                await this.playNext(queue, voiceChannel, interaction);
              } else {
                logger.info(`[PlayCommand] Queue is already playing.`);
              }
              return interaction.editReply({
                content:
                  `➕ **Added ${tracks.length} tracks from playlist to the queue!**\n` +
                  (tracks[0] ? `🎵 **First track:** ${tracks[0].title}\n` : "") +
                  `👤 **Requested by:** <@${interaction.user.id}>\n` +
                  `📋 **Queue:** ${queue.size()} song${queue.size() === 1 ? '' : 's'} total`
              });
            } catch (error) {
              logger.error(`[PlayCommand] Error loading playlist:`, error);
              return interaction.editReply({
                content: '❌ An error occurred while loading the playlist!'
              });
            }
          }

          // Continue with existing single track logic...
          const detectedPlatform = MusicService.detectPlatform(query);
          logger.info(`[PlayCommand] Detected platform: ${detectedPlatform}`);
          if (!detectedPlatform) {
            logger.warn(`[PlayCommand] Unsupported URL: ${query}`);
            return interaction.editReply({
              content:
                "❌ **Unsupported URL!**\n\n" +
                "Supported platforms:\n" +
                "📺 **YouTube**: youtube.com or youtu.be URLs\n" +
                "🟢 **Spotify**: open.spotify.com URLs\n\n" +
                "💡 Make sure you're using a direct link to a song or video",
            });
          }

          logger.info(`[PlayCommand] Processing ${detectedPlatform} URL: ${query}`);
          trackInfo = await MusicService.getTrackInfo(query);
          logger.info(`[PlayCommand] Track info from getTrackInfo: ${JSON.stringify(trackInfo)}`);

          if (!trackInfo) {
            const platformEmoji = this.getPlatformEmoji(detectedPlatform);
            logger.warn(`[PlayCommand] Could not load content for detected platform: ${detectedPlatform}`);
            return interaction.editReply(
              `❌ **Could not load ${detectedPlatform} content!**\n\n` +
                `${platformEmoji} **URL**: ${query}\n\n` +
                "This could happen if:\n" +
                "• The video/track is private or deleted\n" +
                "• The content is region-locked\n" +
                "• The URL is malformed\n" +
                "• The platform is temporarily unavailable\n\n" +
                "💡 Try a different URL or check if the content is accessible"
            );
          }
        } else {
          // Handle text search (YouTube only)
          logger.info(`[PlayCommand] Query is a text search: ${query}`);
          // Search YouTube for the text query
          const searchResults = await MusicService.search(
            query,
            MusicPlatform.YOUTUBE,
            {
              limit: 1,
            }
          );
          logger.info(`[PlayCommand] YouTube search results: ${JSON.stringify(searchResults)}`);

          if (searchResults.length === 0 || !searchResults[0]) {
            logger.warn(`[PlayCommand] No results found on YouTube for: ${query}`);
            return interaction.editReply({
              content:
                `❌ **No results found on YouTube!**\n\n` +
                `🔍 **Searched for**: "${query}"\n\n` +
                "💡 **Try:**\n" +
                "• Different search terms\n" +
                "• More specific song/artist names\n" +
                "• A direct YouTube or Spotify URL instead",
            });
          }

          trackInfo = searchResults[0];
          logger.info(`[PlayCommand] Using first YouTube search result: ${JSON.stringify(trackInfo)}`);
        }
      }

      if (!trackInfo) {
        logger.warn(`[PlayCommand] Failed to get track information!`);
        return interaction.editReply("❌ Failed to get track information!");
      }

      // Show detected song info immediately
      const platformEmoji = this.getPlatformEmoji(trackInfo.platform);
      const artist = trackInfo.artist ? ` - ${trackInfo.artist}` : "";
      const duration = trackInfo.duration
        ? ` (${this.formatDuration(trackInfo.duration)})`
        : "";

      await interaction.editReply({
        content:
          `🎵 **Detected song:**\n\n` +
          `${platformEmoji} **${trackInfo.title}**${artist}${duration}\n` +
          `🎯 **Platform:** ${
            trackInfo.platform.charAt(0).toUpperCase() +
            trackInfo.platform.slice(1)
          }\n\n` +
          `⏳ Processing...`,
      });

      // Add to queue
      const queueItem = queue.add({
        ...trackInfo,
        requestedBy: interaction.user.id,
      });
      logger.info(`[PlayCommand] Added track to queue: ${trackInfo.title}`);

      // If nothing is playing, start playing
      if (!queue.getIsPlaying()) {
        logger.info(`[PlayCommand] Queue is not playing, starting playback.`);
        await this.playNext(queue, voiceChannel, interaction);
      } else {
        logger.info(`[PlayCommand] Queue is already playing.`);
        // Just notify about queue addition
        const position = queue.size();
        const platformEmoji = this.getPlatformEmoji(trackInfo.platform);
        const duration = trackInfo.duration
          ? ` (${this.formatDuration(trackInfo.duration)})`
          : "";
        const artist = trackInfo.artist ? ` - ${trackInfo.artist}` : "";

        logger.info(`[PlayCommand] Track added to queue at position ${position}`);

        return interaction.editReply({
          content:
            `➕ **Added to queue:**\n\n` +
            `${platformEmoji} **${trackInfo.title}**${artist}${duration}\n` +
            `📍 **Position:** ${position}\n` +
            `🎵 **Platform:** ${
              trackInfo.platform.charAt(0).toUpperCase() +
              trackInfo.platform.slice(1)
            }\n` +
            `👤 **Requested by:** <@${interaction.user.id}>\n\n` +
            `📋 **Queue:** ${queue.size()} song${
              queue.size() === 1 ? "" : "s"
            } total`,
        });
      }
    } catch (error) {
      logger.error("Play command error:", error);
      return interaction.editReply(
        "❌ **An error occurred while processing the request!**\n\n" +
          "Please try again, or use a different URL if the problem persists."
      );
    }
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}:${remainingMinutes
        .toString()
        .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
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

  private async playNext(
    queue: MusicQueue,
    voiceChannel: any,
    interaction: any
  ): Promise<void> {
    const currentSong = queue.next(); // FIXED: Remove await since next() returns QueueItem | null, not Promise
    if (!currentSong) {
      queue.setPlaying(false);
      return;
    }

    queue.setCurrentSong(currentSong);
    queue.setPlaying(true);

    try {
      // Get stream info
      const baseStreamInfo = await MusicService.getStreamInfo(currentSong.url);
      if (!baseStreamInfo) {
        logger.error(`Failed to get stream for: ${currentSong.title}`);

        // Inform user about the failure
        await interaction.editReply({
          content:
            `❌ **Failed to play:** ${currentSong.title}\n\n` +
            "This content couldn't be streamed. Trying next song in queue...",
        });

        return this.playNext(queue, voiceChannel, interaction);
      }

      const finalStreamUrl = baseStreamInfo.streamUrl;

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

      // Create audio resource with filtered stream - FIXED: Use finalStreamUrl which is guaranteed to be string
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
          this.playNext(queue, voiceChannel, interaction);
        });

        player.on("error", (error) => {
          logger.error("Audio player error:", error);
          this.playNext(queue, voiceChannel, interaction);
        });

        connection.subscribe(player);
      }

      // Play the audio
      player.play(resource);

      const platformEmoji = this.getPlatformEmoji(currentSong.platform);
      const duration = currentSong.duration
        ? ` (${this.formatDuration(currentSong.duration)})`
        : "";
      const artist = currentSong.artist ? ` - ${currentSong.artist}` : "";

      return interaction.editReply({
        content:
          `${platformEmoji} **Now playing:**\n\n` +
          `🎵 **${currentSong.title}**${artist}${duration}\n` +
          `🎯 **Platform:** ${
            currentSong.platform.charAt(0).toUpperCase() +
            currentSong.platform.slice(1)
          }\n` +
          `👤 **Requested by:** <@${currentSong.requestedBy}>` +
          (queue.size() > 0
            ? `\n\n📋 **Queue:** ${queue.size()} song${
                queue.size() === 1 ? "" : "s"
              } remaining`
            : ""),
      });
    } catch (error) {
      logger.error("Playback error:", error);

      // Inform user about the error
      await interaction.editReply({
        content:
          `❌ **Playback error for:** ${currentSong.title}\n\n` +
          "Trying next song in queue...",
      });

      return this.playNext(queue, voiceChannel, interaction);
    }
  }

  private isPlaylistUrl(url: string): boolean {
    const youtubePlaylistRegex =
      /^https?:\/\/(www\.)?(youtube\.com\/playlist\?list=|youtu\.be\/playlist\?list=)[\w-]+/;
    const spotifyPlaylistRegex =
      /^https?:\/\/open\.spotify\.com\/playlist\/[\w]+/;

    return youtubePlaylistRegex.test(url) || spotifyPlaylistRegex.test(url);
  }

  private getPlaylistPlatform(url: string): string {
    if (url.includes("spotify.com")) {
      return "Spotify";
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return "YouTube";
    }
    return "Unknown";
  }
}

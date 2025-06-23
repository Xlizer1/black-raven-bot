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

    await interaction.deferReply();

    try {
      const queue = MusicQueue.getQueue(interaction.guild.id);
      let trackInfo: VideoInfo | null = null;

      // Handle autocomplete selection
      if (query.includes("|||")) {
        const autocompleteService = AutocompleteService.getInstance();
        const parsed = autocompleteService.parseAutocompleteValue(query);

        if (parsed) {
          // If it's a direct URL from autocomplete, use it
          if (MusicService.isUrl(parsed.url)) {
            trackInfo = await MusicService.getTrackInfo(parsed.url);
          } else {
            // Otherwise search for the specific title
            const searchResults = await MusicService.search(
              parsed.title,
              MusicPlatform.YOUTUBE,
              { limit: 1 }
            );
            trackInfo = searchResults[0] || null;
          }
        }
      }

      // Fallback to normal processing if autocomplete parsing failed
      if (!trackInfo) {
        // Check if input is a URL or text search
        if (MusicService.isUrl(query)) {
          // Handle URL input (existing logic)
          const detectedPlatform = MusicService.detectPlatform(query);
          if (!detectedPlatform) {
            return interaction.editReply({
              content:
                "❌ **Unsupported URL!**\n\n" +
                "Supported platforms:\n" +
                "📺 **YouTube**: youtube.com or youtu.be URLs\n" +
                "🟢 **Spotify**: open.spotify.com URLs\n\n" +
                "💡 Make sure you're using a direct link to a song or video",
            });
          }

          logger.info(`Processing ${detectedPlatform} URL: ${query}`);
          trackInfo = await MusicService.getTrackInfo(query);

          if (!trackInfo) {
            const platformEmoji = this.getPlatformEmoji(detectedPlatform);
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
          logger.info(`Searching YouTube for: "${query}"`);

          // Search YouTube for the text query
          const searchResults = await MusicService.search(
            query,
            MusicPlatform.YOUTUBE,
            {
              limit: 1,
            }
          );

          if (searchResults.length === 0 || !searchResults[0]) {
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
        }
      }

      if (!trackInfo) {
        return interaction.editReply("❌ Failed to get track information!");
      }

      // Show detected song info immediately
      const platformEmoji = this.getPlatformEmoji(trackInfo.platform);
      const artist = trackInfo.artist ? ` - ${trackInfo.artist}` : "";
      const duration = trackInfo.duration
        ? ` (${this.formatDuration(trackInfo.duration)})`
        : "";

      // Check if filters are active
      const activeFilters = queue.getActiveFilters();
      const filterText =
        activeFilters.length > 0
          ? `\n🎛️ **Active filters:** ${activeFilters.join(", ")}`
          : "";

      await interaction.editReply({
        content:
          `🎵 **Detected song:**\n\n` +
          `${platformEmoji} **${trackInfo.title}**${artist}${duration}\n` +
          `🎯 **Platform:** ${
            trackInfo.platform.charAt(0).toUpperCase() +
            trackInfo.platform.slice(1)
          }${filterText}\n\n` +
          `⏳ Processing...`,
      });

      // Add to queue
      const queueItem = queue.add({
        ...trackInfo,
        requestedBy: interaction.user.id,
      });

      // If nothing is playing, start playing
      if (!queue.getIsPlaying()) {
        await this.playNext(queue, voiceChannel, interaction);
      } else {
        // Just notify about queue addition
        const position = queue.size();
        const platformEmoji = this.getPlatformEmoji(trackInfo.platform);
        const duration = trackInfo.duration
          ? ` (${this.formatDuration(trackInfo.duration)})`
          : "";
        const artist = trackInfo.artist ? ` - ${trackInfo.artist}` : "";

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
            } total${filterText}`,
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
    const currentSong = await queue.next(); // Use await since next() now returns a promise
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

      // Apply filters if any are active
      const filteredStreamUrl = await queue.getFilteredStream(
        currentSong,
        baseStreamInfo.streamUrl
      );

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

      // Create audio resource with filtered stream
      const resource = createAudioResource(filteredStreamUrl, {
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

      // Show active filters in now playing message
      const activeFilters = queue.getActiveFilters();
      const filterText =
        activeFilters.length > 0
          ? `\n🎛️ **Filters:** ${activeFilters.join(", ")}`
          : "";

      // Show queue status
      const queueStatus = queue.getStatus();
      const statusText = [];
      if (queueStatus.alwaysOn) statusText.push("🔄 24/7");
      if (queueStatus.autoPlay) statusText.push("🤖 Auto-play");
      const modeText =
        statusText.length > 0 ? `\n⚙️ **Modes:** ${statusText.join(", ")}` : "";

      return interaction.editReply({
        content:
          `${platformEmoji} **Now playing:**\n\n` +
          `🎵 **${currentSong.title}**${artist}${duration}\n` +
          `🎯 **Platform:** ${
            currentSong.platform.charAt(0).toUpperCase() +
            currentSong.platform.slice(1)
          }\n` +
          `👤 **Requested by:** <@${currentSong.requestedBy}>${filterText}${modeText}` +
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
}

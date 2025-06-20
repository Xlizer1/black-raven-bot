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
        .setDescription("Play music from various platforms")
        .addStringOption(
          (option) =>
            option
              .setName("query")
              .setDescription("Song name, YouTube URL, or Spotify URL")
              .setRequired(true)
              .setAutocomplete(true) // Enable autocomplete
        )
        .addStringOption((option) =>
          option
            .setName("platform")
            .setDescription("Choose platform to search on")
            .addChoices(
              { name: "YouTube", value: "youtube" },
              { name: "Spotify", value: "spotify" }
            )
            .setRequired(false)
        )
    );
  }

  // Enhanced Autocomplete handler
  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction
  ) {
    try {
      const focusedOption = interaction.options.getFocused(true);

      // Only provide autocomplete for the query option
      if (focusedOption.name !== "query") {
        return interaction.respond([]);
      }

      const query = focusedOption.value as string;

      // Don't search if query is too short or empty
      if (!query || query.trim().length < 2) {
        return interaction.respond([]);
      }

      const trimmedQuery = query.trim();

      // If it's already a URL, don't provide autocomplete
      if (this.isValidUrl(trimmedQuery)) {
        return interaction.respond([
          {
            name: `🔗 ${
              trimmedQuery.length > 80
                ? trimmedQuery.substring(0, 77) + "..."
                : trimmedQuery
            }`,
            value: trimmedQuery,
          },
        ]);
      }

      // Get platform preference
      const platformChoice = interaction.options.getString(
        "platform"
      ) as MusicPlatform;
      const targetPlatform = platformChoice || MusicPlatform.YOUTUBE;

      // Create a defensive search with multiple fallbacks
      const searchResults = await this.performDefensiveAutocompleteSearch(
        trimmedQuery,
        targetPlatform
      );

      // Convert results to autocomplete choices
      const choices = this.formatAutocompleteChoices(
        searchResults,
        trimmedQuery
      );

      // Always respond, even if empty
      await interaction.respond(choices);
    } catch (error) {
      console.error("Autocomplete error:", error);
      // Emergency fallback - always respond to prevent Discord errors
      try {
        await interaction.respond([
          {
            name: "🔍 Search on YouTube...",
            value: interaction.options.getFocused() || "search",
          },
        ]);
      } catch (responseError) {
        console.error("Failed emergency autocomplete response:", responseError);
      }
    }
  }

  private async performDefensiveAutocompleteSearch(
    query: string,
    platform: MusicPlatform
  ): Promise<VideoInfo[]> {
    try {
      // Primary search attempt
      const results = await Promise.race([
        MusicService.searchForAutocomplete(query, platform, 6),
        new Promise<VideoInfo[]>(
          (resolve) => setTimeout(() => resolve([]), 1200) // 1.2s timeout
        ),
      ]);

      return results || [];
    } catch (error) {
      console.warn(`Primary autocomplete search failed for "${query}":`, error);
      return [];
    }
  }

  private formatAutocompleteChoices(
    results: VideoInfo[],
    originalQuery: string
  ): Array<{ name: string; value: string }> {
    const choices: Array<{ name: string; value: string }> = [];

    // Process results
    for (const result of results.slice(0, 20)) {
      try {
        // Handle suggestion-based results differently
        if (result.url.startsWith("search:")) {
          // This is a suggestion, format it nicely
          let displayName = result.title;

          // Add artist if available
          if (result.artist) {
            displayName = `${result.artist} - ${displayName}`;
          }

          // Add search icon for suggestions
          displayName = `🔍 ${displayName}`;

          // Ensure proper length
          if (displayName.length > 95) {
            displayName = displayName.substring(0, 92) + "...";
          }

          choices.push({
            name: displayName,
            value: result.url, // This will be "search:query"
          });
        } else {
          // This is a real video result, format normally
          let displayName = result.title || "Unknown";

          // Add artist if available and different from title
          if (
            result.artist &&
            result.artist !== result.title &&
            result.artist.length < 40 &&
            !displayName.toLowerCase().includes(result.artist.toLowerCase())
          ) {
            displayName = `${result.artist} - ${displayName}`;
          }

          // Add platform emoji
          const platformEmoji = this.getPlatformEmoji(result.platform);
          displayName = `${platformEmoji} ${displayName}`;

          // Add duration if available and reasonable
          if (
            result.duration &&
            result.duration > 0 &&
            result.duration < 7200
          ) {
            const duration = this.formatDuration(result.duration);
            displayName = `${displayName} (${duration})`;
          }

          // Ensure proper length
          if (displayName.length > 95) {
            displayName = displayName.substring(0, 92) + "...";
          }

          // Use title as value
          let value = result.title || originalQuery;
          if (value.length > 100) {
            value = value.substring(0, 100);
          }

          choices.push({
            name: displayName,
            value: value,
          });
        }
      } catch (error) {
        console.warn("Error formatting autocomplete choice:", error);
        continue;
      }
    }

    // If no results found, provide helpful options
    if (choices.length === 0) {
      const truncatedQuery =
        originalQuery.length > 50
          ? originalQuery.substring(0, 47) + "..."
          : originalQuery;

      choices.push({
        name: `🔍 Search for "${truncatedQuery}"`,
        value: originalQuery,
      });
    }

    return choices.slice(0, 25); // Discord's maximum
  }

  private isValidUrl(input: string): boolean {
    try {
      const url = new URL(input);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
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

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    // Check if user is in a voice channel
    const member = interaction.member as GuildMember;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel to play music!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server!",
        flags: MessageFlags.Ephemeral,
      });
    }

    let query = interaction.options.getString("query", true);
    const platformChoice = interaction.options.getString(
      "platform"
    ) as MusicPlatform;

    await interaction.deferReply();

    try {
      const queue = MusicQueue.getQueue(interaction.guild.id);

      // Handle suggestion-based queries (from autocomplete)
      if (query.startsWith("search:")) {
        query = query.replace("search:", "");
        logger.info(`Processing suggestion-based search: ${query}`);
      }

      // Detect platform or use user choice
      const detectedPlatform = MusicService.detectPlatform(query);
      const targetPlatform =
        platformChoice || detectedPlatform || MusicPlatform.YOUTUBE;

      logger.info(`Processing ${targetPlatform} request: ${query}`);

      // Get track info
      let trackInfo;
      if (MusicService.isUrl(query) && !query.startsWith("search:")) {
        trackInfo = await MusicService.getTrackInfo(query);
      } else {
        // For suggestions or regular text queries, do a proper search
        const searchResults = await MusicService.search(query, targetPlatform, {
          limit: 1,
        });
        trackInfo = searchResults[0] || null;
      }

      if (!trackInfo) {
        return interaction.editReply(
          `❌ Couldn't find "${query}"! Try a different search term.`
        );
      }

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

        return interaction.editReply({
          content:
            `➕ **Added to queue:**\n` +
            `${platformEmoji} **${trackInfo.title}**${duration}\n` +
            `📍 Position: ${position}\n` +
            `🎵 Platform: ${trackInfo.platform}\n` +
            `👤 Requested by: <@${interaction.user.id}>`,
        });
      }
    } catch (error) {
      logger.error("Play command error:", error);
      return interaction.editReply(
        "❌ An error occurred while trying to play the song!"
      );
    }
  }

  private async playNext(
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
      // Get stream info
      const streamInfo = await MusicService.getStreamInfo(currentSong.url);
      if (!streamInfo) {
        logger.error(`Failed to get stream for: ${currentSong.title}`);
        return this.playNext(queue, voiceChannel, interaction);
      }

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
      const resource = createAudioResource(streamInfo.streamUrl, {
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

      return interaction.editReply({
        content:
          `${platformEmoji} **Now playing:**\n` +
          `🎵 **${currentSong.title}**${duration}\n` +
          `👤 Requested by: <@${currentSong.requestedBy}>` +
          (queue.size() > 0
            ? `\n📋 ${queue.size()} song${
                queue.size() === 1 ? "" : "s"
              } in queue`
            : ""),
      });
    } catch (error) {
      logger.error("Playback error:", error);
      return this.playNext(queue, voiceChannel, interaction);
    }
  }
}

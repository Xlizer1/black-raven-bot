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

  // Autocomplete handler
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
      if (!query || query.length < 2) {
        return interaction.respond([]);
      }

      // If it's already a URL, don't provide autocomplete
      if (MusicService.isUrl(query)) {
        return interaction.respond([]);
      }

      // Get platform preference from user's current input
      const platformChoice = interaction.options.getString(
        "platform"
      ) as MusicPlatform;
      const targetPlatform = platformChoice || MusicPlatform.YOUTUBE;

      logger.debug(`Autocomplete search: "${query}" on ${targetPlatform}`);

      // Use fast autocomplete search with timeout protection
      const searchPromise = MusicService.searchForAutocomplete(
        query,
        targetPlatform,
        8
      );
      const timeoutPromise = new Promise<VideoInfo[]>(
        (resolve) => setTimeout(() => resolve([]), 2500) // 2.5 second timeout
      );

      const searchResults = await Promise.race([searchPromise, timeoutPromise]);

      // Convert results to autocomplete choices
      const choices = searchResults.slice(0, 8).map((result) => {
        // Create display name with artist if available
        let displayName = result.title;
        if (result.artist && result.artist !== result.title) {
          displayName = `${result.artist} - ${result.title}`;
        }

        // Ensure the choice doesn't exceed Discord's limits
        if (displayName.length > 95) {
          displayName = displayName.substring(0, 92) + "...";
        }

        // Use URL as value for exact matching, fallback to title
        const value = (result.url || result.title).substring(0, 100);

        return {
          name: displayName,
          value: value,
        };
      });

      await interaction.respond(choices);
    } catch (error) {
      logger.error("Autocomplete search error:", error);
      // Always respond to avoid Discord errors, even if empty
      try {
        await interaction.respond([]);
      } catch (responseError) {
        logger.error("Failed to respond to autocomplete:", responseError);
      }
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

    const query = interaction.options.getString("query", true);
    const platformChoice = interaction.options.getString(
      "platform"
    ) as MusicPlatform;

    await interaction.deferReply();

    try {
      const queue = MusicQueue.getQueue(interaction.guild.id);

      // Detect platform or use user choice
      const detectedPlatform = MusicService.detectPlatform(query);
      const targetPlatform =
        platformChoice || detectedPlatform || MusicPlatform.YOUTUBE;

      logger.info(`Processing ${targetPlatform} request: ${query}`);

      // Get track info
      let trackInfo;
      if (MusicService.isUrl(query)) {
        trackInfo = await MusicService.getTrackInfo(query);
      } else {
        const searchResults = await MusicService.search(query, targetPlatform, {
          limit: 1,
        });
        trackInfo = searchResults[0] || null;
      }

      if (!trackInfo) {
        return interaction.editReply("❌ Couldn't find that song!");
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
        return interaction.editReply({
          content: `➕ Added to queue: **${trackInfo.title}**\n📍 Position: ${position}\n🎵 Platform: ${trackInfo.platform}`,
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
        ? ` (${MusicService.formatDuration(currentSong.duration)})`
        : "";

      return interaction.editReply({
        content: `${platformEmoji} Now playing: **${currentSong.title}**${duration}\n👤 Requested by: <@${currentSong.requestedBy}>`,
      });
    } catch (error) {
      logger.error("Playback error:", error);
      return this.playNext(queue, voiceChannel, interaction);
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

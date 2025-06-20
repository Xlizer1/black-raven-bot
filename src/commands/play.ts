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
import { MusicPlatform } from "../services/providers/IMusicProvider";

export class PlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("play")
        .setDescription("Play music from various platforms")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Song name, YouTube URL, or Spotify URL")
            .setRequired(true)
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

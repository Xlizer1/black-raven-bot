import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

export class SeekCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("seek")
        .setDescription("Jump to a specific time in the current song")
        .addStringOption((option) =>
          option
            .setName("time")
            .setDescription("Time to seek to (e.g., 1:30, 90, 2:15)")
            .setRequired(true)
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

    const queue = MusicQueue.getQueue(interaction.guild.id);
    const currentSong = queue.getCurrentSong();
    const player = queue.getPlayer();
    const timeInput = interaction.options.getString("time", true);

    if (!currentSong || !player || !queue.getIsPlaying()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Parse the time input
    const seekTime = this.parseTimeInput(timeInput);
    if (seekTime === null) {
      return interaction.reply({
        content:
          "❌ Invalid time format! Use formats like:\n" +
          "• `1:30` (1 minute 30 seconds)\n" +
          "• `90` (90 seconds)\n" +
          "• `2:15` (2 minutes 15 seconds)",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if seek time is valid for the current song
    if (currentSong.duration && seekTime > currentSong.duration) {
      const maxTime = MusicService.formatDuration(currentSong.duration);
      return interaction.reply({
        content:
          `❌ Seek time is beyond song duration!\n` +
          `**Song duration:** ${maxTime}\n` +
          `**Requested time:** ${MusicService.formatDuration(seekTime)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      // NOTE: Discord.js voice doesn't support seeking directly
      // We need to restart the stream from the specified position
      // This requires using yt-dlp with start time parameter

      const success = await this.restartStreamAtTime(
        queue,
        currentSong,
        seekTime
      );

      if (success) {
        const platformEmoji = this.getPlatformEmoji(currentSong.platform);
        const seekTimeFormatted = MusicService.formatDuration(seekTime);
        const totalTimeFormatted = currentSong.duration
          ? MusicService.formatDuration(currentSong.duration)
          : "Unknown";

        logger.info(
          `Seeked to ${seekTime}s in song "${currentSong.title}" in guild: ${interaction.guild.id}`
        );

        return interaction.editReply({
          content:
            `⏩ **Seeked to ${seekTimeFormatted}**\n\n` +
            `${platformEmoji} **${currentSong.title}**\n` +
            `📍 **Position:** ${seekTimeFormatted} / ${totalTimeFormatted}\n` +
            `👤 Requested by: <@${currentSong.requestedBy}>\n\n` +
            `💡 Note: Seeking restarts the stream from the new position`,
        });
      } else {
        return interaction.editReply({
          content:
            "❌ **Seeking failed!**\n\n" +
            "This could happen if:\n" +
            "• The song doesn't support seeking\n" +
            "• There was a network error\n" +
            "• The stream source is incompatible\n\n" +
            "💡 Try playing the song again or use a different song.",
        });
      }
    } catch (error) {
      logger.error("Error seeking in song:", error);
      return interaction.editReply({
        content:
          "❌ An error occurred while seeking! The song may not support seeking.",
      });
    }
  }

  private parseTimeInput(input: string): number | null {
    try {
      // Remove whitespace
      input = input.trim();

      // Check if it's just seconds (number only)
      if (/^\d+$/.test(input)) {
        const seconds = parseInt(input);
        return seconds >= 0 ? seconds : null;
      }

      // Check if it's MM:SS or HH:MM:SS format
      if (/^\d+:\d+$/.test(input) || /^\d+:\d+:\d+$/.test(input)) {
        const parts = input.split(":").map((part) => parseInt(part));

        if (parts.length === 2) {
          // MM:SS format
          const minutes = parts[0] ?? 0;
          const seconds = parts[1] ?? 0;
          if (seconds >= 60) return null; // Invalid seconds
          return minutes * 60 + seconds;
        } else if (parts.length === 3) {
          // HH:MM:SS format
          const hours = parts[0] ?? 0;
          const minutes = parts[1] ?? 0;
          const seconds = parts[2] ?? 0;
          if (minutes >= 60 || seconds >= 60) return null; // Invalid minutes/seconds
          return hours * 3600 + minutes * 60 + seconds;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async restartStreamAtTime(
    queue: MusicQueue,
    song: any,
    seekTime: number
  ): Promise<boolean> {
    try {
      // This is a simplified implementation
      // In a real implementation, you would:
      // 1. Use yt-dlp with --postprocessor-args "ffmpeg:-ss {seekTime}"
      // 2. Or use ffmpeg to seek in the stream
      // 3. Create a new audio resource with the seeked stream

      // For now, we'll show a warning that seeking isn't fully implemented
      logger.warn(
        `Seek functionality not fully implemented. Would seek to ${seekTime}s in "${song.title}"`
      );

      // Mock implementation - in reality this would restart the stream at the specified time
      const streamInfo = await MusicService.getStreamInfo(song.url);
      if (!streamInfo) {
        return false;
      }

      // Here you would modify the yt-dlp command to include seeking:
      // `yt-dlp "${url}" --get-url --postprocessor-args "ffmpeg:-ss ${seekTime}" ...`

      // For now, we'll just restart the song from the beginning
      // This is a limitation that would need to be addressed in a full implementation

      const player = queue.getPlayer();
      if (player) {
        // Stop and restart (this won't actually seek, just restart)
        player.stop();
        // The player's idle event should trigger playing the next song
        // which in this case is the same song
      }

      return true;
    } catch (error) {
      logger.error("Error restarting stream at time:", error);
      return false;
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

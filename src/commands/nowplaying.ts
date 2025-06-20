import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { MusicQueue, RepeatMode } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";

export class NowPlayingCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("nowplaying")
        .setDescription("Show detailed information about the current song")
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

    if (!currentSong) {
      return interaction.reply({
        content:
          "❌ Nothing is currently playing! Use `/play` to start some music.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎵 Now Playing")
      .setTimestamp();

    // Song title with platform emoji
    const platformEmoji = this.getPlatformEmoji(currentSong.platform);
    embed.setDescription(`${platformEmoji} **${currentSong.title}**`);

    // Basic song information
    const fields = [];

    if (currentSong.artist) {
      fields.push({
        name: "👤 Artist",
        value: currentSong.artist,
        inline: true,
      });
    }

    if (currentSong.album) {
      fields.push({
        name: "💿 Album",
        value: currentSong.album,
        inline: true,
      });
    }

    if (currentSong.duration) {
      fields.push({
        name: "⏱️ Duration",
        value: MusicService.formatDuration(currentSong.duration),
        inline: true,
      });
    }

    fields.push({
      name: "🎵 Platform",
      value:
        currentSong.platform.charAt(0).toUpperCase() +
        currentSong.platform.slice(1),
      inline: true,
    });

    fields.push({
      name: "👤 Requested by",
      value: `<@${currentSong.requestedBy}>`,
      inline: true,
    });

    // Player status
    if (player) {
      const status = player.state.status;
      fields.push({
        name: "📊 Status",
        value: this.getPlayerStatusText(status),
        inline: true,
      });
    }

    // Queue information
    const queueSize = queue.size();
    if (queueSize > 0) {
      const nextSong = queue.peek();
      fields.push({
        name: "📋 Queue",
        value: `${queueSize} song${queueSize === 1 ? "" : "s"} remaining`,
        inline: true,
      });

      if (nextSong) {
        fields.push({
          name: "⏭️ Up Next",
          value: `${this.getPlatformEmoji(nextSong.platform)} ${
            nextSong.title
          }`,
          inline: true,
        });
      }
    } else {
      fields.push({
        name: "📋 Queue",
        value: "No songs queued",
        inline: true,
      });
    }

    // Repeat mode
    const repeatMode = queue.getRepeatMode();
    fields.push({
      name: "🔁 Repeat",
      value: this.getRepeatModeText(repeatMode),
      inline: true,
    });

    // Volume
    const volume = Math.round(queue.getVolume() * 100);
    fields.push({
      name: "🔊 Volume",
      value: `${volume}%`,
      inline: true,
    });

    // Song URL (if it's a direct link)
    if (
      currentSong.url &&
      (currentSong.url.includes("youtube.com") ||
        currentSong.url.includes("spotify.com"))
    ) {
      fields.push({
        name: "🔗 Source",
        value: `[Open on ${currentSong.platform}](${currentSong.url})`,
        inline: true,
      });
    }

    // Add timestamp info
    const addedAt = currentSong.addedAt;
    if (addedAt) {
      const timeAgo = this.getTimeAgo(addedAt);
      fields.push({
        name: "📅 Added",
        value: timeAgo,
        inline: true,
      });
    }

    embed.addFields(fields);

    // Add thumbnail if available
    if (currentSong.thumbnail) {
      embed.setThumbnail(currentSong.thumbnail);
    }

    // Add progress bar if duration is known
    if (
      currentSong.duration &&
      player &&
      player.state.status === AudioPlayerStatus.Playing
    ) {
      // Note: Discord.js voice doesn't provide playback position
      // This is a placeholder for future implementation
      const progressBar = this.createProgressBar(0, currentSong.duration);
      embed.addFields({
        name: "⏯️ Progress",
        value: progressBar,
        inline: false,
      });
    }

    return interaction.reply({
      embeds: [embed],
    });
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

  private getPlayerStatusText(status: AudioPlayerStatus): string {
    switch (status) {
      case AudioPlayerStatus.Playing:
        return "▶️ Playing";
      case AudioPlayerStatus.Paused:
        return "⏸️ Paused";
      case AudioPlayerStatus.Idle:
        return "⏹️ Idle";
      case AudioPlayerStatus.Buffering:
        return "⏳ Buffering";
      case AudioPlayerStatus.AutoPaused:
        return "⏸️ Auto-Paused";
      default:
        return "❓ Unknown";
    }
  }

  private getRepeatModeText(mode: RepeatMode): string {
    switch (mode) {
      case RepeatMode.OFF:
        return "▶️ Off";
      case RepeatMode.TRACK:
        return "🔂 Track";
      case RepeatMode.QUEUE:
        return "🔁 Queue";
      default:
        return "❓ Unknown";
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
    } else {
      return "Just now";
    }
  }

  private createProgressBar(currentTime: number, totalTime: number): string {
    const barLength = 20;
    const progress = currentTime / totalTime;
    const filledLength = Math.round(progress * barLength);
    const emptyLength = barLength - filledLength;

    const filled = "█".repeat(filledLength);
    const empty = "░".repeat(emptyLength);

    const currentFormatted = MusicService.formatDuration(currentTime);
    const totalFormatted = MusicService.formatDuration(totalTime);

    return `${currentFormatted} \`${filled}${empty}\` ${totalFormatted}`;
  }
}

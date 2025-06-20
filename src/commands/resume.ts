import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class ResumeCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName("resume").setDescription("Resume paused playback")
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
    const player = queue.getPlayer();
    const currentSong = queue.getCurrentSong();

    if (!player || !currentSong) {
      return interaction.reply({
        content: "❌ Nothing is currently loaded to resume!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.state.status === AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "▶️ Playback is already running! Use `/pause` to pause.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.reply({
        content:
          "❌ Playback is not paused! Current status: " +
          this.getStatusEmoji(player.state.status),
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      player.unpause();
      logger.info(`Playback resumed in guild: ${interaction.guild.id}`);

      const platformEmoji = this.getPlatformEmoji(currentSong.platform);
      const queueSize = queue.size();

      let responseContent = `▶️ **Resumed playback**\n\n`;
      responseContent += `${platformEmoji} **${currentSong.title}**\n`;
      responseContent += `👤 Requested by: <@${currentSong.requestedBy}>`;

      if (queueSize > 0) {
        responseContent += `\n\n📋 ${queueSize} song${
          queueSize === 1 ? "" : "s"
        } remaining in queue`;
      }

      responseContent += `\n\n💡 Use \`/pause\` to pause again`;

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error resuming playback:", error);
      return interaction.reply({
        content: "❌ Failed to resume playback!",
        flags: MessageFlags.Ephemeral,
      });
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

  private getStatusEmoji(status: AudioPlayerStatus): string {
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
}

import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class PauseCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName("pause").setDescription("Pause the current song")
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

    if (!player || !queue.getIsPlaying() || !currentSong) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.state.status === AudioPlayerStatus.Paused) {
      return interaction.reply({
        content: "⏸️ Playback is already paused! Use `/resume` to continue.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      player.pause();
      logger.info(`Playback paused in guild: ${interaction.guild.id}`);

      const platformEmoji = this.getPlatformEmoji(currentSong.platform);

      return interaction.reply({
        content:
          `⏸️ **Paused playback**\n\n` +
          `${platformEmoji} **${currentSong.title}**\n` +
          `👤 Requested by: <@${currentSong.requestedBy}>\n\n` +
          `💡 Use \`/resume\` to continue playing`,
      });
    } catch (error) {
      logger.error("Error pausing playback:", error);
      return interaction.reply({
        content: "❌ Failed to pause playback!",
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
}

import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class ClearCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("clear")
        .setDescription("Clear the entire queue without stopping current song")
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
    const queueSize = queue.size();
    const currentSong = queue.getCurrentSong();

    if (queueSize === 0) {
      return interaction.reply({
        content: "❌ The queue is already empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      // Get some song info before clearing for the response
      const clearedSongs = queue
        .getQueue()
        .slice(0, 5)
        .map((song) => song.title);

      queue.clearQueue();

      logger.info(
        `Cleared queue with ${queueSize} songs in guild: ${interaction.guild.id}`
      );

      let responseContent = `🗑️ **Cleared ${queueSize} song${
        queueSize === 1 ? "" : "s"
      } from the queue!**\n\n`;

      if (currentSong) {
        const platformEmoji = this.getPlatformEmoji(currentSong.platform);
        responseContent += `▶️ **Still playing:** ${platformEmoji} ${currentSong.title}\n\n`;
      }

      responseContent += `**Removed songs:**\n`;
      clearedSongs.forEach((title, i) => {
        responseContent += `${i + 1}. ${title}\n`;
      });

      if (queueSize > 5) {
        responseContent += `*...and ${queueSize - 5} more songs*\n`;
      }

      responseContent += `\n💡 Use \`/play\` to add new songs to the queue`;

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error clearing queue:", error);
      return interaction.reply({
        content: "❌ An error occurred while clearing the queue!",
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

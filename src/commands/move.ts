import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class MoveCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("move")
        .setDescription("Move a song to a different position in the queue")
        .addIntegerOption((option) =>
          option
            .setName("from")
            .setDescription(
              "Current position of the song (use /queue to see positions)"
            )
            .setMinValue(1)
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("to")
            .setDescription("New position for the song")
            .setMinValue(1)
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
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    const queueList = queue.getQueue();

    if (queueList.length === 0) {
      return interaction.reply({
        content: "❌ The queue is empty! Use `/play` to add songs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (from > queueList.length || to > queueList.length) {
      return interaction.reply({
        content: `❌ Invalid position! The queue only has ${
          queueList.length
        } song${
          queueList.length === 1 ? "" : "s"
        }.\nUse \`/queue\` to see current positions.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (from === to) {
      return interaction.reply({
        content: "❌ Source and destination positions are the same!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      // Get the song info before moving
      const song = queueList[from - 1];
      if (!song) {
        return interaction.reply({
          content: "❌ Could not find song at that position!",
          flags: MessageFlags.Ephemeral,
        });
      }

      const success = queue.moveInQueue(from - 1, to - 1);

      if (success) {
        logger.info(
          `Moved song "${song.title}" from position ${from} to ${to} in guild: ${interaction.guild.id}`
        );

        const platformEmoji = this.getPlatformEmoji(song.platform);
        const duration = song.duration
          ? ` (${this.formatDuration(song.duration)})`
          : "";

        // Determine direction for visual feedback
        const direction = to > from ? "down" : "up";
        const arrow = to > from ? "⬇️" : "⬆️";

        let responseContent = `📍 **Moved song ${direction}:**\n`;
        responseContent += `${platformEmoji} **${song.title}**${duration}\n`;
        responseContent += `👤 Requested by: <@${song.requestedBy}>\n\n`;
        responseContent += `${arrow} **Position:** ${from} → ${to}\n\n`;

        // Show context around the new position
        const updatedQueue = queue.getQueue();
        const contextStart = Math.max(0, to - 2);
        const contextEnd = Math.min(updatedQueue.length, to + 1);

        responseContent += `**Queue around new position:**\n`;
        for (let i = contextStart; i < contextEnd; i++) {
          const contextSong = updatedQueue[i];
          if (contextSong) {
            const indicator = i === to - 1 ? "→ " : "   ";
            const emoji =
              i === to - 1 ? "🎯" : this.getPlatformEmoji(contextSong.platform);
            responseContent += `${indicator}${i + 1}. ${emoji} ${
              contextSong.title
            }\n`;
          }
        }

        responseContent += `\n💡 Use \`/queue\` to see the full updated queue`;

        return interaction.reply({
          content: responseContent,
        });
      } else {
        return interaction.reply({
          content: "❌ Failed to move song! Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Error moving song in queue:", error);
      return interaction.reply({
        content: "❌ An error occurred while moving the song!",
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

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
}

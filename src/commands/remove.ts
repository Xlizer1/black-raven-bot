import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class RemoveCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("remove")
        .setDescription("Remove a specific song from the queue")
        .addIntegerOption((option) =>
          option
            .setName("position")
            .setDescription(
              "Position of the song to remove (use /queue to see positions)"
            )
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
    const position = interaction.options.getInteger("position", true);
    const queueList = queue.getQueue();

    if (queueList.length === 0) {
      return interaction.reply({
        content: "❌ The queue is empty! Use `/play` to add songs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (position > queueList.length) {
      return interaction.reply({
        content: `❌ Invalid position! The queue only has ${
          queueList.length
        } song${
          queueList.length === 1 ? "" : "s"
        }.\nUse \`/queue\` to see current positions.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const removed = queue.removeFromQueue(position - 1);

      if (removed) {
        logger.info(
          `Removed song "${removed.title}" from position ${position} in guild: ${interaction.guild.id}`
        );

        const platformEmoji = this.getPlatformEmoji(removed.platform);
        const duration = removed.duration
          ? ` (${this.formatDuration(removed.duration)})`
          : "";

        return interaction.reply({
          content:
            `🗑️ **Removed from queue:**\n` +
            `${platformEmoji} **${removed.title}**${duration}\n` +
            `👤 Originally requested by: <@${removed.requestedBy}>\n` +
            `📍 Was at position: ${position}\n\n` +
            `📋 Queue now has ${queue.size()} song${
              queue.size() === 1 ? "" : "s"
            }`,
        });
      } else {
        return interaction.reply({
          content: "❌ Failed to remove song! The position may be invalid.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Error removing song from queue:", error);
      return interaction.reply({
        content: "❌ An error occurred while removing the song!",
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

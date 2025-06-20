import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class ShuffleCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("shuffle")
        .setDescription("Shuffle the current music queue")
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

    if (queueSize === 0) {
      return interaction.reply({
        content: "❌ The queue is empty! Add some songs with `/play` first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (queueSize === 1) {
      return interaction.reply({
        content: "❌ Need at least 2 songs in the queue to shuffle!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      // Get some song titles before shuffling for the response
      const beforeShuffle = queue
        .getQueue()
        .slice(0, 3)
        .map((song) => song.title);

      queue.shuffle();

      // Get some song titles after shuffling
      const afterShuffle = queue
        .getQueue()
        .slice(0, 3)
        .map((song) => song.title);

      logger.info(
        `Shuffled queue with ${queueSize} songs in guild: ${interaction.guild.id}`
      );

      // Create response showing the effect
      let responseContent = `🔀 **Shuffled ${queueSize} songs in the queue!**\n\n`;

      responseContent += `**Before shuffle (first 3):**\n`;
      beforeShuffle.forEach((title, i) => {
        responseContent += `${i + 1}. ${title}\n`;
      });

      responseContent += `\n**After shuffle (first 3):**\n`;
      afterShuffle.forEach((title, i) => {
        responseContent += `${i + 1}. ${title}\n`;
      });

      if (queueSize > 3) {
        responseContent += `\n*...and ${queueSize - 3} more songs*`;
      }

      responseContent += `\n\n💡 Use \`/queue\` to see the full shuffled order`;

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error shuffling queue:", error);
      return interaction.reply({
        content: "❌ An error occurred while shuffling the queue!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

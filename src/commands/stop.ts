import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class StopCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("stop")
        .setDescription("Stop playing music and clear the queue")
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

    if (!queue.getConnection()) {
      return interaction.reply({
        content: "❌ I'm not currently playing any music!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      queue.clear();
      logger.info(`Music stopped in guild: ${interaction.guild.id}`);

      return interaction.reply({
        content: "⏹️ Stopped playing music and cleared the queue!",
      });
    } catch (error) {
      logger.error("Error stopping music:", error);
      return interaction.reply({
        content: "❌ An error occurred while stopping the music!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

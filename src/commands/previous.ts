import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

export class PreviousCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName("previous").setDescription("Go back to the previous song")
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
    const history = queue.getHistory();
    const currentSong = queue.getCurrentSong();

    if (history.length === 0) {
      return interaction.reply({
        content: "❌ No previous songs in history! Play some music first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      // Get the most recent song from history
      const previousSong = history[0];
      if (!previousSong) {
        return interaction.editReply("❌ No previous song available!");
      }

      // Add current song back to the front of queue if there is one
      if (currentSong) {
        // We need to manually add it back to the front
        // This is a limitation of the current queue system
        const queueList = queue.getQueue();
        queueList.unshift(currentSong);
      }

      // Remove the previous song from history and set it as current
      const historyArray = [...history];
      historyArray.shift(); // Remove first item (the one we're going back to)

      // Set the previous song as current
      queue.setCurrentSong(previousSong);

      // Start playing the previous song
      await this.startPlayback(queue, previousSong, interaction);

      const platformEmoji = this.getPlatformEmoji(previousSong.platform);
      const duration = previousSong.duration
        ? ` (${MusicService.formatDuration(previousSong.duration)})`
        : "";

      return interaction.editReply({
        content:
          `⏮️ **Going back to previous song:**\n\n` +
          `${platformEmoji} **${previousSong.title}**${duration}\n` +
          `👤 Originally requested by: <@${previousSong.requestedBy}>\n\n` +
          `📋 History: ${history.length - 1} song${
            history.length - 1 === 1 ? "" : "s"
          } remaining`,
      });
    } catch (error) {
      logger.error("Error playing previous song:", error);
      return interaction.editReply(
        "❌ An error occurred while playing the previous song!"
      );
    }
  }

  private async startPlayback(
    queue: MusicQueue,
    song: any,
    interaction: any
  ): Promise<void> {
    try {
      // Get stream info
      const streamInfo = await MusicService.getStreamInfo(song.url);
      if (!streamInfo) {
        throw new Error(`Failed to get stream for: ${song.title}`);
      }

      const player = queue.getPlayer();
      if (player) {
        // Stop current playback
        player.stop();

        // The player should automatically trigger the next song logic
        // which will pick up our newly set current song
      }
    } catch (error) {
      logger.error("Error starting previous song playback:", error);
      throw error;
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

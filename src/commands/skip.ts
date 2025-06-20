import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class SkipCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("skip")
        .setDescription("Skip the current song or multiple songs")
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Number of songs to skip (default: 1)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
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
    const count = interaction.options.getInteger("count") || 1;

    if (!queue.getIsPlaying() && !queue.getCurrentSong()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const currentSong = queue.getCurrentSong();
    const queueSize = queue.size();
    const availableToSkip = queueSize + (currentSong ? 1 : 0);
    const actualSkipCount = Math.min(count, availableToSkip);

    if (actualSkipCount === 0) {
      return interaction.reply({
        content: "❌ No songs to skip!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      // Get the current song info for response
      const skippedSongs = [];
      if (currentSong) {
        skippedSongs.push(currentSong.title);
      }

      // Skip additional songs from queue if count > 1
      for (let i = 1; i < actualSkipCount && queue.size() > 0; i++) {
        const nextSong = queue.next();
        if (nextSong) {
          skippedSongs.push(nextSong.title);
        }
      }

      // Stop current playback to trigger next song
      const player = queue.getPlayer();
      if (player && currentSong) {
        player.stop();
      }

      logger.info(
        `Skipped ${actualSkipCount} song(s) in guild: ${interaction.guild.id}`
      );

      // Create response message
      let responseContent;
      if (actualSkipCount === 1) {
        responseContent = `⏭️ Skipped: **${currentSong?.title || "Unknown"}**`;
      } else {
        responseContent = `⏭️ Skipped ${actualSkipCount} songs:\n${skippedSongs
          .map((title, i) => `${i + 1}. ${title}`)
          .join("\n")}`;
      }

      // Add info about what's playing next
      const nextSong = queue.getCurrentSong();
      if (nextSong) {
        responseContent += `\n\n▶️ Now playing: **${nextSong.title}**`;
      } else if (queue.size() > 0) {
        responseContent += `\n\n📋 ${queue.size()} song${
          queue.size() > 1 ? "s" : ""
        } remaining in queue`;
      } else {
        responseContent += `\n\n📭 Queue is now empty`;
      }

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error skipping song(s):", error);
      return interaction.reply({
        content: "❌ An error occurred while skipping!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

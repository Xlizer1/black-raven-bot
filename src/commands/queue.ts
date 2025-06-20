// src/commands/queue.ts

import { Command } from "@sapphire/framework";
import {
  EmbedBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";

export class QueueCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("queue")
        .setDescription("Manage the music queue")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("show")
            .setDescription("Display the current queue")
            .addIntegerOption((option) =>
              option
                .setName("page")
                .setDescription("Page number to display")
                .setMinValue(1)
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("skip")
            .setDescription("Skip the current song or multiple songs")
            .addIntegerOption((option) =>
              option
                .setName("count")
                .setDescription("Number of songs to skip")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription("Remove a song from the queue")
            .addIntegerOption((option) =>
              option
                .setName("position")
                .setDescription("Position of the song to remove")
                .setMinValue(1)
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("shuffle")
            .setDescription("Shuffle the current queue")
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("clear").setDescription("Clear the entire queue")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("move")
            .setDescription("Move a song to a different position")
            .addIntegerOption((option) =>
              option
                .setName("from")
                .setDescription("Current position of the song")
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
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "show":
        return this.showQueue(interaction, queue);
      case "skip":
        return this.skipSongs(interaction, queue);
      case "remove":
        return this.removeSong(interaction, queue);
      case "shuffle":
        return this.shuffleQueue(interaction, queue);
      case "clear":
        return this.clearQueue(interaction, queue);
      case "move":
        return this.moveSong(interaction, queue);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async showQueue(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const currentSong = queue.getCurrentSong();
    const queueList = queue.getQueue();
    const page = interaction.options.getInteger("page") || 1;
    const itemsPerPage = 10;

    if (!currentSong && queueList.length === 0) {
      return interaction.reply({
        content: "📭 The queue is empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎵 Music Queue")
      .setTimestamp();

    // Current song
    if (currentSong) {
      const duration = currentSong.duration
        ? MusicService.formatDuration(currentSong.duration)
        : "Unknown";
      embed.addFields({
        name: "🎵 Now Playing",
        value:
          `**${currentSong.title}**\n` +
          `👤 Requested by: <@${currentSong.requestedBy}>\n` +
          `⏱️ Duration: ${duration}`,
        inline: false,
      });
    }

    // Queue
    if (queueList.length > 0) {
      const totalPages = Math.ceil(queueList.length / itemsPerPage);
      const startIndex = (page - 1) * itemsPerPage;
      const endIndex = Math.min(startIndex + itemsPerPage, queueList.length);

      const queueText = queueList
        .slice(startIndex, endIndex)
        .map((song, index) => {
          const position = startIndex + index + 1;
          const duration = song.duration
            ? MusicService.formatDuration(song.duration)
            : "Unknown";
          return (
            `**${position}.** ${song.title}\n` +
            `👤 <@${song.requestedBy}> • ⏱️ ${duration}`
          );
        })
        .join("\n\n");

      embed.addFields({
        name: `📋 Queue (${queueList.length} songs)`,
        value: queueText || "Empty",
        inline: false,
      });

      if (totalPages > 1) {
        embed.setFooter({ text: `Page ${page}/${totalPages}` });
      }
    }

    // Navigation buttons for pagination
    const components = [];
    if (queueList.length > itemsPerPage) {
      const totalPages = Math.ceil(queueList.length / itemsPerPage);
      const row = new ActionRowBuilder<ButtonBuilder>();

      if (page > 1) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`queue_prev_${page - 1}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
        );
      }

      if (page < totalPages) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`queue_next_${page + 1}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
        );
      }

      if (row.components.length > 0) {
        components.push(row);
      }
    }

    return interaction.reply({
      embeds: [embed],
      components,
    });
  }

  private async skipSongs(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const count = interaction.options.getInteger("count") || 1;

    if (!queue.getIsPlaying()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const skipped = Math.min(count, queue.size() + 1); // +1 for current song

    // Skip songs
    for (let i = 1; i < count && queue.size() > 0; i++) {
      queue.next();
    }

    // Stop current playback to trigger next song
    const player = queue.getPlayer();
    if (player) {
      player.stop();
    }

    return interaction.reply({
      content: `⏭️ Skipped ${skipped} song${skipped > 1 ? "s" : ""}!`,
    });
  }

  private async removeSong(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const position = interaction.options.getInteger("position", true);
    const queueList = queue.getQueue();

    if (position > queueList.length) {
      return interaction.reply({
        content: `❌ Invalid position! Queue only has ${queueList.length} songs.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const removed = queue.remove(position - 1);
    if (removed) {
      return interaction.reply({
        content: `🗑️ Removed **${removed.title}** from position ${position}!`,
      });
    } else {
      return interaction.reply({
        content: "❌ Failed to remove song!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async shuffleQueue(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    if (queue.size() === 0) {
      return interaction.reply({
        content: "❌ Queue is empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    queue.shuffle();
    return interaction.reply({
      content: `🔀 Shuffled ${queue.size()} songs in the queue!`,
    });
  }

  private async clearQueue(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    if (queue.size() === 0) {
      return interaction.reply({
        content: "❌ Queue is already empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const count = queue.size();
    queue.getQueue().length = 0; // Clear without stopping current song

    return interaction.reply({
      content: `🗑️ Cleared ${count} songs from the queue!`,
    });
  }

  private async moveSong(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    const queueList = queue.getQueue();

    if (from > queueList.length || to > queueList.length) {
      return interaction.reply({
        content: `❌ Invalid position! Queue only has ${queueList.length} songs.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (from === to) {
      return interaction.reply({
        content: "❌ Source and destination positions are the same!",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Move the song
    const song = queueList.splice(from - 1, 1)[0];
    if (song) {
      queueList.splice(to - 1, 0, song);
      return interaction.reply({
        content: `📍 Moved **${song.title}** from position ${from} to ${to}!`,
      });
    }

    return interaction.reply({
      content: "❌ Failed to move song!",
      flags: MessageFlags.Ephemeral,
    });
  }
}

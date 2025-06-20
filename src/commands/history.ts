// src/commands/history.ts

import { Command } from "@sapphire/framework";
import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import { MusicQueue, type QueueItem } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";

export class HistoryCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("history")
        .setDescription("Show recently played songs")
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Page number to display")
            .setMinValue(1)
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
    const history = queue.getHistory();
    const page = interaction.options.getInteger("page") || 1;
    const itemsPerPage = 10;

    if (history.length === 0) {
      return interaction.reply({
        content:
          "📭 No songs in history yet! Play some music to build up your history.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("📚 Recently Played Songs")
      .setTimestamp();

    const totalPages = Math.ceil(history.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, history.length);

    // Create history list
    const historyText = history
      .slice(startIndex, endIndex)
      .map((song, index) => {
        const position = startIndex + index + 1;
        const duration = song.duration
          ? MusicService.formatDuration(song.duration)
          : "Unknown";
        const platformEmoji = this.getPlatformEmoji(song.platform);
        const timeAgo = this.getTimeAgo(song.addedAt);

        return (
          `**${position}.** ${platformEmoji} ${song.title}\n` +
          `👤 <@${song.requestedBy}> • ⏱️ ${duration} • 📅 ${timeAgo}`
        );
      })
      .join("\n\n");

    embed.addFields({
      name: `🎵 History (${history.length} songs total)`,
      value: historyText,
      inline: false,
    });

    // Add current song info if available
    const currentSong = queue.getCurrentSong();
    if (currentSong) {
      const platformEmoji = this.getPlatformEmoji(currentSong.platform);
      const duration = currentSong.duration
        ? MusicService.formatDuration(currentSong.duration)
        : "Unknown";

      embed.addFields({
        name: "🎵 Currently Playing",
        value: `${platformEmoji} **${currentSong.title}**\n👤 <@${currentSong.requestedBy}> • ⏱️ ${duration}`,
        inline: false,
      });
    }

    // Add statistics
    const uniqueRequesters = new Set(history.map((song) => song.requestedBy))
      .size;
    const totalDuration = history.reduce(
      (total, song) => total + (song.duration || 0),
      0
    );
    const platformCounts = this.getPlatformStats(history);

    embed.addFields({
      name: "📊 Statistics",
      value:
        `🎵 **Total songs:** ${history.length}\n` +
        `👥 **Unique requesters:** ${uniqueRequesters}\n` +
        `⏱️ **Total playtime:** ${MusicService.formatDuration(
          totalDuration
        )}\n` +
        `🎯 **Platforms:** ${platformCounts}`,
      inline: false,
    });

    if (totalPages > 1) {
      embed.setFooter({
        text: `Page ${page}/${totalPages} • Use /history <page> to navigate`,
      });
    }

    // Navigation buttons for pagination
    const components = [];
    if (totalPages > 1) {
      const row = new ActionRowBuilder<ButtonBuilder>();

      if (page > 1) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`history_prev_${page - 1}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("⬅️")
        );
      }

      if (page < totalPages) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`history_next_${page + 1}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("➡️")
        );
      }

      // Add a button to play previous song
      if (history.length > 0) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("play_previous")
            .setLabel("Play Previous")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("⏮️")
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

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ago`;
    } else {
      return "now";
    }
  }

  private getPlatformStats(history: readonly QueueItem[]): string {
    const platformCounts: { [key: string]: number } = {};

    history.forEach((song) => {
      const platform = song.platform.toLowerCase();
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    });

    return Object.entries(platformCounts)
      .map(([platform, count]) => {
        const emoji = this.getPlatformEmoji(platform);
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        return `${emoji} ${name}: ${count}`;
      })
      .join(" • ");
  }
}

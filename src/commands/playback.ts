// src/commands/playback.ts

import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { MusicQueue, RepeatMode } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

export class PlaybackCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("playback")
        .setDescription("Control music playback")
        .addSubcommand((subcommand) =>
          subcommand.setName("pause").setDescription("Pause the current song")
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("resume").setDescription("Resume the paused song")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("volume")
            .setDescription("Set the playback volume")
            .addIntegerOption((option) =>
              option
                .setName("level")
                .setDescription("Volume level (0-100)")
                .setMinValue(0)
                .setMaxValue(100)
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("repeat")
            .setDescription("Toggle repeat mode")
            .addStringOption((option) =>
              option
                .setName("mode")
                .setDescription("Repeat mode")
                .addChoices(
                  { name: "Off", value: "off" },
                  { name: "Track", value: "track" },
                  { name: "Queue", value: "queue" }
                )
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("nowplaying")
            .setDescription("Show information about the current song")
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
      case "pause":
        return this.pausePlayback(interaction, queue);
      case "resume":
        return this.resumePlayback(interaction, queue);
      case "volume":
        return this.setVolume(interaction, queue);
      case "repeat":
        return this.setRepeatMode(interaction, queue);
      case "nowplaying":
        return this.showNowPlaying(interaction, queue);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async pausePlayback(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const player = queue.getPlayer();

    if (!player || !queue.getIsPlaying()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.state.status === AudioPlayerStatus.Paused) {
      return interaction.reply({
        content: "❌ Playback is already paused!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      player.pause();
      logger.info(`Playback paused in guild: ${interaction.guild!.id}`);

      return interaction.reply({
        content: "⏸️ Paused playback!",
      });
    } catch (error) {
      logger.error("Error pausing playback:", error);
      return interaction.reply({
        content: "❌ Failed to pause playback!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async resumePlayback(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const player = queue.getPlayer();

    if (!player || !queue.getIsPlaying()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (player.state.status === AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❌ Playback is already running!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      player.unpause();
      logger.info(`Playback resumed in guild: ${interaction.guild!.id}`);

      return interaction.reply({
        content: "▶️ Resumed playback!",
      });
    } catch (error) {
      logger.error("Error resuming playback:", error);
      return interaction.reply({
        content: "❌ Failed to resume playback!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async setVolume(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const volume = interaction.options.getInteger("level", true);
    const player = queue.getPlayer();

    if (!player) {
      return interaction.reply({
        content: "❌ No audio player active!",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      // Store the volume preference (Discord.js voice doesn't have built-in volume control)
      queue.setVolume(volume / 100);

      return interaction.reply({
        content: `🔊 Volume set to ${volume}%`,
      });
    } catch (error) {
      logger.error("Error setting volume:", error);
      return interaction.reply({
        content:
          "❌ Failed to set volume! Volume control may not be implemented.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async setRepeatMode(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const modeString = interaction.options.getString("mode", true);

    // Convert string to RepeatMode enum
    let mode: RepeatMode;
    switch (modeString) {
      case "off":
        mode = RepeatMode.OFF;
        break;
      case "track":
        mode = RepeatMode.TRACK;
        break;
      case "queue":
        mode = RepeatMode.QUEUE;
        break;
      default:
        return interaction.reply({
          content: "❌ Invalid repeat mode!",
          flags: MessageFlags.Ephemeral,
        });
    }

    try {
      queue.setRepeatMode(mode);

      const modeEmojis = {
        [RepeatMode.OFF]: "🔁",
        [RepeatMode.TRACK]: "🔂",
        [RepeatMode.QUEUE]: "🔁",
      };

      const modeNames = {
        [RepeatMode.OFF]: "Off",
        [RepeatMode.TRACK]: "Track",
        [RepeatMode.QUEUE]: "Queue",
      };

      return interaction.reply({
        content: `${modeEmojis[mode]} Repeat mode set to: **${modeNames[mode]}**`,
      });
    } catch (error) {
      logger.error("Error setting repeat mode:", error);
      return interaction.reply({
        content: "❌ Failed to set repeat mode!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async showNowPlaying(
    interaction: Command.ChatInputCommandInteraction,
    queue: MusicQueue
  ) {
    const currentSong = queue.getCurrentSong();
    const player = queue.getPlayer();

    if (!currentSong || !queue.getIsPlaying()) {
      return interaction.reply({
        content: "❌ Nothing is currently playing!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎵 Now Playing")
      .setDescription(`**${currentSong.title}**`)
      .setTimestamp();

    // Add song details
    const fields = [];

    if (currentSong.artist) {
      fields.push({
        name: "👤 Artist",
        value: currentSong.artist,
        inline: true,
      });
    }

    if (currentSong.duration) {
      fields.push({
        name: "⏱️ Duration",
        value: MusicService.formatDuration(currentSong.duration),
        inline: true,
      });
    }

    fields.push({
      name: "🎵 Platform",
      value:
        currentSong.platform.charAt(0).toUpperCase() +
        currentSong.platform.slice(1),
      inline: true,
    });

    fields.push({
      name: "👤 Requested by",
      value: `<@${currentSong.requestedBy}>`,
      inline: true,
    });

    // Player status
    if (player) {
      const status = player.state.status;
      const statusEmojis = {
        [AudioPlayerStatus.Playing]: "▶️ Playing",
        [AudioPlayerStatus.Paused]: "⏸️ Paused",
        [AudioPlayerStatus.Idle]: "⏹️ Idle",
        [AudioPlayerStatus.Buffering]: "⏳ Buffering",
        [AudioPlayerStatus.AutoPaused]: "⏸️ Auto-Paused",
      };

      fields.push({
        name: "📊 Status",
        value: statusEmojis[status] || "❓ Unknown",
        inline: true,
      });
    }

    // Queue info
    const queueSize = queue.size();
    if (queueSize > 0) {
      fields.push({
        name: "📋 Queue",
        value: `${queueSize} song${queueSize > 1 ? "s" : ""} remaining`,
        inline: true,
      });
    }

    // Repeat mode info
    const repeatMode = queue.getRepeatMode();
    const repeatModeNames = {
      [RepeatMode.OFF]: "Off",
      [RepeatMode.TRACK]: "Track",
      [RepeatMode.QUEUE]: "Queue",
    };

    fields.push({
      name: "🔁 Repeat",
      value: repeatModeNames[repeatMode],
      inline: true,
    });

    embed.addFields(fields);

    // Add thumbnail if available
    if (currentSong.thumbnail) {
      embed.setThumbnail(currentSong.thumbnail);
    }

    return interaction.reply({
      embeds: [embed],
    });
  }
}

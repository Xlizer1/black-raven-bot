import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue, RepeatMode } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class RepeatCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("repeat")
        .setDescription("Toggle repeat mode or show current repeat setting")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Repeat mode to set")
            .addChoices(
              { name: "Off - Play through queue once", value: "off" },
              { name: "Track - Repeat current song", value: "track" },
              { name: "Queue - Repeat entire queue", value: "queue" }
            )
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
    const requestedMode = interaction.options.getString("mode");
    const currentMode = queue.getRepeatMode();

    // If no mode specified, show current repeat mode
    if (!requestedMode) {
      const currentModeInfo = this.getRepeatModeInfo(currentMode);
      const allModes = this.getAllRepeatModes();

      return interaction.reply({
        content:
          `🔁 **Current Repeat Mode:**\n` +
          `${currentModeInfo.emoji} **${currentModeInfo.name}** - ${currentModeInfo.description}\n\n` +
          `**Available modes:**\n${allModes}\n\n` +
          `💡 Use \`/repeat <mode>\` to change the repeat mode`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Convert string to RepeatMode enum
    let newMode: RepeatMode;
    switch (requestedMode) {
      case "off":
        newMode = RepeatMode.OFF;
        break;
      case "track":
        newMode = RepeatMode.TRACK;
        break;
      case "queue":
        newMode = RepeatMode.QUEUE;
        break;
      default:
        return interaction.reply({
          content: "❌ Invalid repeat mode!",
          flags: MessageFlags.Ephemeral,
        });
    }

    // Check if it's the same mode
    if (currentMode === newMode) {
      const modeInfo = this.getRepeatModeInfo(newMode);
      return interaction.reply({
        content: `${modeInfo.emoji} Repeat mode is already set to **${modeInfo.name}**!`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      queue.setRepeatMode(newMode);

      logger.info(
        `Repeat mode changed from ${currentMode} to ${newMode} in guild: ${interaction.guild.id}`
      );

      const oldModeInfo = this.getRepeatModeInfo(currentMode);
      const newModeInfo = this.getRepeatModeInfo(newMode);

      let responseContent = `🔁 **Repeat mode changed!**\n\n`;
      responseContent += `${oldModeInfo.emoji} ~~${oldModeInfo.name}~~ → ${newModeInfo.emoji} **${newModeInfo.name}**\n\n`;
      responseContent += `📝 **${newModeInfo.name}:** ${newModeInfo.description}\n\n`;

      // Add context-specific information
      const currentSong = queue.getCurrentSong();
      const queueSize = queue.size();

      if (newMode === RepeatMode.TRACK && currentSong) {
        responseContent += `🎵 **Current song will repeat:** ${currentSong.title}`;
      } else if (newMode === RepeatMode.QUEUE && queueSize > 0) {
        responseContent += `📋 **Queue will repeat:** ${
          queueSize + (currentSong ? 1 : 0)
        } songs total`;
      } else if (newMode === RepeatMode.OFF) {
        if (queueSize > 0) {
          responseContent += `📋 **Will play:** ${queueSize} more song${
            queueSize === 1 ? "" : "s"
          } then stop`;
        } else if (currentSong) {
          responseContent += `🎵 **Will finish current song then stop**`;
        }
      }

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error setting repeat mode:", error);
      return interaction.reply({
        content: "❌ Failed to set repeat mode!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private getRepeatModeInfo(mode: RepeatMode): {
    emoji: string;
    name: string;
    description: string;
  } {
    switch (mode) {
      case RepeatMode.OFF:
        return {
          emoji: "▶️",
          name: "Off",
          description: "Play through queue once and stop",
        };
      case RepeatMode.TRACK:
        return {
          emoji: "🔂",
          name: "Track",
          description: "Repeat the current song indefinitely",
        };
      case RepeatMode.QUEUE:
        return {
          emoji: "🔁",
          name: "Queue",
          description: "Restart queue from beginning when finished",
        };
      default:
        return {
          emoji: "❓",
          name: "Unknown",
          description: "Unknown repeat mode",
        };
    }
  }

  private getAllRepeatModes(): string {
    const modes = [RepeatMode.OFF, RepeatMode.TRACK, RepeatMode.QUEUE];
    return modes
      .map((mode) => {
        const info = this.getRepeatModeInfo(mode);
        return `${info.emoji} **${info.name}** - ${info.description}`;
      })
      .join("\n");
  }
}

import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { GuildMember } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class TwentyFourSevenCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("24x7")
        .setDescription(
          "Toggle 24/7 mode - bot stays in voice channel permanently"
        )
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Enable or disable 24/7 mode")
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

    // Check if user has permission to use 24/7 mode
    const member = interaction.member as GuildMember;
    if (!member.permissions.has("ManageGuild")) {
      return interaction.reply({
        content: "❌ You need **Manage Server** permission to use 24/7 mode!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const queue = MusicQueue.getQueue(interaction.guild.id);
    const enabled =
      interaction.options.getBoolean("enabled") ?? !queue.get24x7();
    const wasEnabled = queue.get24x7();

    // Check if bot is in a voice channel when enabling
    if (enabled && !queue.getConnection()) {
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          content:
            "❌ **Cannot enable 24/7 mode!**\n\n" +
            "The bot needs to be connected to a voice channel first.\n" +
            "💡 Use `/play` to start music and connect to voice, then enable 24/7 mode.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    try {
      queue.set24x7(enabled);

      logger.info(
        `24/7 mode ${enabled ? "enabled" : "disabled"} in guild: ${
          interaction.guild.id
        } by ${interaction.user.tag}`
      );

      if (enabled && !wasEnabled) {
        return interaction.reply({
          content:
            "🔄 **24/7 Mode Enabled!**\n\n" +
            "✅ **Bot will stay connected permanently**\n" +
            "🎵 **Music will continue playing**\n" +
            "⚡ **No auto-disconnect on idle**\n" +
            "🔧 **Auto-reconnect on disconnection**\n\n" +
            "💡 Use `/24x7 false` to disable 24/7 mode",
        });
      } else if (!enabled && wasEnabled) {
        const currentSong = queue.getCurrentSong();
        const queueSize = queue.size();

        let content = "⏹️ **24/7 Mode Disabled!**\n\n";
        content += "❌ **Bot will auto-disconnect when idle**\n";
        content += "⏱️ **5-minute timeout when no music**\n";

        if (currentSong || queueSize > 0) {
          content += "\n🎵 **Current session continues:**\n";
          if (currentSong) {
            content += `▶️ Playing: ${currentSong.title}\n`;
          }
          if (queueSize > 0) {
            content += `📋 Queue: ${queueSize} song${
              queueSize === 1 ? "" : "s"
            }\n`;
          }
        } else {
          content +=
            "\n⚠️ **Bot will disconnect in 5 minutes** (no active music)";
        }

        content += "\n\n💡 Use `/24x7 true` to re-enable 24/7 mode";

        return interaction.reply({ content });
      } else {
        // No change
        return interaction.reply({
          content: `🔄 24/7 mode is already **${
            enabled ? "enabled" : "disabled"
          }**`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Error toggling 24/7 mode:", error);
      return interaction.reply({
        content: "❌ Failed to toggle 24/7 mode!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

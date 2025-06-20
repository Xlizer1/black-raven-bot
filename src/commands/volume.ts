import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export class VolumeCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("volume")
        .setDescription("Control bot volume or show current volume")
        .addIntegerOption((option) =>
          option
            .setName("level")
            .setDescription("Volume level (0-100)")
            .setMinValue(0)
            .setMaxValue(100)
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
    const requestedVolume = interaction.options.getInteger("level");
    const currentVolume = Math.round(queue.getVolume() * 100);

    // If no volume level specified, show current volume
    if (requestedVolume === null) {
      const volumeBar = this.createVolumeBar(currentVolume);
      const volumeEmoji = this.getVolumeEmoji(currentVolume);

      return interaction.reply({
        content:
          `${volumeEmoji} **Current Volume: ${currentVolume}%**\n\n` +
          `${volumeBar}\n\n` +
          `💡 Use \`/volume <0-100>\` to change the volume`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const player = queue.getPlayer();

    try {
      // Store the volume preference
      queue.setVolume(requestedVolume / 100);

      logger.info(
        `Volume set to ${requestedVolume}% in guild: ${interaction.guild.id}`
      );

      const volumeBar = this.createVolumeBar(requestedVolume);
      const volumeEmoji = this.getVolumeEmoji(requestedVolume);
      const changeEmoji = this.getVolumeChangeEmoji(
        currentVolume,
        requestedVolume
      );

      let responseContent = `${volumeEmoji} **Volume set to ${requestedVolume}%** ${changeEmoji}\n\n`;
      responseContent += `${volumeBar}\n`;

      if (currentVolume !== requestedVolume) {
        responseContent += `\n📊 **Changed:** ${currentVolume}% → ${requestedVolume}%`;
      }

      if (!player) {
        responseContent += `\n\n⚠️ Volume will apply to the next song (no audio currently playing)`;
      } else {
        responseContent += `\n\n💡 **Note:** Discord.js doesn't support real-time volume control.\nThis setting will apply to future songs.`;
      }

      return interaction.reply({
        content: responseContent,
      });
    } catch (error) {
      logger.error("Error setting volume:", error);
      return interaction.reply({
        content: "❌ Failed to set volume!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private createVolumeBar(volume: number): string {
    const barLength = 20;
    const filledLength = Math.round((volume / 100) * barLength);
    const emptyLength = barLength - filledLength;

    const filled = "█".repeat(filledLength);
    const empty = "░".repeat(emptyLength);

    return `\`${filled}${empty}\` ${volume}%`;
  }

  private getVolumeEmoji(volume: number): string {
    if (volume === 0) return "🔇";
    if (volume <= 30) return "🔈";
    if (volume <= 70) return "🔉";
    return "🔊";
  }

  private getVolumeChangeEmoji(oldVolume: number, newVolume: number): string {
    if (newVolume > oldVolume) return "📈";
    if (newVolume < oldVolume) return "📉";
    return "➡️";
  }
}

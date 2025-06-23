// src/commands/dj.ts

import { Command } from "@sapphire/framework";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { GuildMember, Role } from "discord.js";
import { CommandMiddleware } from "../middleware/CommandMiddleware";
import { DJPermissionService } from "../services/DJPermissionService";
import { logger } from "../utils/logger";

interface DJSettings {
  enabled: boolean;
  djRoles: string[]; // Role IDs
  djOnlyCommands: string[];
  allowedChannels: string[]; // Channel IDs where music is allowed
}

class DJManager {
  private static settings = new Map<string, DJSettings>();

  static getSettings(guildId: string): DJSettings {
    return (
      this.settings.get(guildId) || {
        enabled: false,
        djRoles: [],
        djOnlyCommands: [
          "skip",
          "stop",
          "clear",
          "shuffle",
          "filters",
          "24x7",
          "autoplay",
        ],
        allowedChannels: [],
      }
    );
  }

  static saveSettings(guildId: string, settings: DJSettings): void {
    this.settings.set(guildId, settings);
  }

  static isDJ(member: GuildMember, guildId: string): boolean {
    const settings = this.getSettings(guildId);

    if (!settings.enabled) return true; // DJ mode disabled, everyone is DJ

    // Admins are always DJs
    if (member.permissions.has("Administrator")) return true;

    // Check if user has any DJ roles
    return settings.djRoles.some((roleId) => member.roles.cache.has(roleId));
  }

  static requiresDJPermission(command: string, guildId: string): boolean {
    const settings = this.getSettings(guildId);
    return settings.enabled && settings.djOnlyCommands.includes(command);
  }

  static isChannelAllowed(channelId: string, guildId: string): boolean {
    const settings = this.getSettings(guildId);

    // If no channels specified, all channels are allowed
    if (settings.allowedChannels.length === 0) return true;

    return settings.allowedChannels.includes(channelId);
  }
}

export class DJCommand extends Command {
  private djService = DJPermissionService.getInstance();

  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("dj")
        .setDescription("Manage DJ roles and music permissions")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("setup")
            .setDescription("Enable/disable DJ mode")
            .addBooleanOption((option) =>
              option
                .setName("enabled")
                .setDescription("Enable or disable DJ mode")
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("role")
            .setDescription("Manage DJ roles")
            .addStringOption((option) =>
              option
                .setName("action")
                .setDescription("Add or remove DJ role")
                .setRequired(true)
                .addChoices(
                  { name: "Add", value: "add" },
                  { name: "Remove", value: "remove" }
                )
            )
            .addRoleOption((option) =>
              option
                .setName("role")
                .setDescription("Role to add/remove as DJ")
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("channel")
            .setDescription("Manage allowed music channels")
            .addStringOption((option) =>
              option
                .setName("action")
                .setDescription("Add or remove music channel")
                .setRequired(true)
                .addChoices(
                  { name: "Add", value: "add" },
                  { name: "Remove", value: "remove" },
                  { name: "Clear All", value: "clear" }
                )
            )
            .addChannelOption((option) =>
              option
                .setName("channel")
                .setDescription("Channel to add/remove")
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription("Show current DJ settings")
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    // Apply middleware checks for admin commands
    const middlewareResult = await CommandMiddleware.checkAdminCommand(
      interaction,
      "dj"
    );

    if (!middlewareResult.allowed) {
      return CommandMiddleware.handleMiddlewareResult(
        interaction,
        middlewareResult
      );
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "setup":
        return this.setupDJMode(interaction);
      case "role":
        return this.manageDJRole(interaction);
      case "channel":
        return this.manageChannel(interaction);
      case "status":
        return this.showStatus(interaction);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async setupDJMode(interaction: Command.ChatInputCommandInteraction) {
    const enabled = interaction.options.getBoolean("enabled", true);

    this.djService.updateSettings(interaction.guild!.id, { enabled });

    logger.info(
      `DJ mode ${enabled ? "enabled" : "disabled"} in guild: ${
        interaction.guild!.id
      }`
    );

    if (enabled) {
      return interaction.reply({
        content:
          "🎧 **DJ Mode Enabled!**\n\n" +
          "✅ **Music controls are now restricted**\n" +
          "👑 **Only DJs can use advanced commands**\n" +
          "🔒 **Commands like skip, stop, filters are DJ-only**\n\n" +
          "**Next steps:**\n" +
          "1. Add DJ roles: `/dj role add @Role`\n" +
          "2. Set music channels: `/dj channel add #channel`\n" +
          "3. Check settings: `/dj status`\n\n" +
          "💡 Admins are always considered DJs",
      });
    } else {
      return interaction.reply({
        content:
          "🔓 **DJ Mode Disabled!**\n\n" +
          "✅ **All users can control music**\n" +
          "🎵 **No role restrictions**\n" +
          "📺 **Music commands work in any channel**\n\n" +
          "💡 Use `/dj setup true` to re-enable DJ mode",
      });
    }
  }

  private async manageDJRole(interaction: Command.ChatInputCommandInteraction) {
    const action = interaction.options.getString("action", true);
    const role = interaction.options.getRole("role", true) as Role;

    if (action === "add") {
      const success = this.djService.addDJRole(interaction.guild!.id, role.id);

      if (!success) {
        return interaction.reply({
          content: `❌ ${role} is already a DJ role!`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const settings = this.djService.getSettings(interaction.guild!.id);

      return interaction.reply({
        content:
          `🎧 **Added DJ Role!**\n\n` +
          `✅ **Role:** ${role}\n` +
          `👑 **Members with this role can now:**\n` +
          `• Skip songs\n` +
          `• Stop music\n` +
          `• Clear queue\n` +
          `• Apply filters\n` +
          `• Use advanced commands\n\n` +
          `📊 **Total DJ roles:** ${settings.djRoles.length}`,
      });
    } else {
      const success = this.djService.removeDJRole(
        interaction.guild!.id,
        role.id
      );

      if (!success) {
        return interaction.reply({
          content: `❌ ${role} is not a DJ role!`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const settings = this.djService.getSettings(interaction.guild!.id);

      return interaction.reply({
        content:
          `🗑️ **Removed DJ Role!**\n\n` +
          `❌ **Role:** ${role}\n` +
          `📊 **Remaining DJ roles:** ${settings.djRoles.length}`,
      });
    }
  }

  private async manageChannel(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const action = interaction.options.getString("action", true);
    const settings = DJManager.getSettings(interaction.guild!.id);

    if (action === "clear") {
      const count = settings.allowedChannels.length;
      settings.allowedChannels = [];
      DJManager.saveSettings(interaction.guild!.id, settings);

      return interaction.reply({
        content:
          `🧹 **Cleared all music channels!**\n\n` +
          `🗑️ **Removed:** ${count} channel${count === 1 ? "" : "s"}\n` +
          `🎵 **Music now works in any channel**`,
      });
    }

    const channel = interaction.options.getChannel("channel");
    if (!channel) {
      return interaction.reply({
        content: "❌ Please specify a channel!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === "add") {
      if (settings.allowedChannels.includes(channel.id)) {
        return interaction.reply({
          content: `❌ ${channel} is already a music channel!`,
          flags: MessageFlags.Ephemeral,
        });
      }

      settings.allowedChannels.push(channel.id);
      DJManager.saveSettings(interaction.guild!.id, settings);

      return interaction.reply({
        content:
          `🎵 **Added Music Channel!**\n\n` +
          `✅ **Channel:** ${channel}\n` +
          `🎧 **Music commands now work here**\n` +
          `📊 **Total music channels:** ${settings.allowedChannels.length}`,
      });
    } else {
      if (!settings.allowedChannels.includes(channel.id)) {
        return interaction.reply({
          content: `❌ ${channel} is not a music channel!`,
          flags: MessageFlags.Ephemeral,
        });
      }

      settings.allowedChannels = settings.allowedChannels.filter(
        (id) => id !== channel.id
      );
      DJManager.saveSettings(interaction.guild!.id, settings);

      return interaction.reply({
        content:
          `🗑️ **Removed Music Channel!**\n\n` +
          `❌ **Channel:** ${channel}\n` +
          `📊 **Remaining channels:** ${settings.allowedChannels.length}`,
      });
    }
  }

  private async showStatus(interaction: Command.ChatInputCommandInteraction) {
    const settings = DJManager.getSettings(interaction.guild!.id);

    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? 0x00ff00 : 0xff0000)
      .setTitle("🎧 DJ Settings")
      .setDescription(
        `DJ Mode: ${settings.enabled ? "**Enabled** ✅" : "**Disabled** ❌"}`
      )
      .setTimestamp();

    // DJ Roles
    if (settings.djRoles.length > 0) {
      const roles = settings.djRoles
        .map((roleId) => `<@&${roleId}>`)
        .join(", ");
      embed.addFields({
        name: "👑 DJ Roles",
        value: roles,
        inline: false,
      });
    } else {
      embed.addFields({
        name: "👑 DJ Roles",
        value: settings.enabled
          ? "None (only admins can control music)"
          : "Not applicable (DJ mode disabled)",
        inline: false,
      });
    }

    // Music Channels
    if (settings.allowedChannels.length > 0) {
      const channels = settings.allowedChannels
        .map((channelId) => `<#${channelId}>`)
        .join(", ");
      embed.addFields({
        name: "🎵 Music Channels",
        value: channels,
        inline: false,
      });
    } else {
      embed.addFields({
        name: "🎵 Music Channels",
        value: "All channels allowed",
        inline: false,
      });
    }

    // DJ-Only Commands
    if (settings.enabled) {
      embed.addFields({
        name: "🔒 DJ-Only Commands",
        value: settings.djOnlyCommands.map((cmd) => `\`/${cmd}\``).join(", "),
        inline: false,
      });
    }

    // User's DJ Status
    const member = interaction.member as GuildMember;
    const isDJ = DJManager.isDJ(member, interaction.guild!.id);
    embed.addFields({
      name: "🎯 Your Status",
      value: isDJ ? "✅ You are a DJ" : "❌ You are not a DJ",
      inline: true,
    });

    return interaction.reply({ embeds: [embed] });
  }
}

// Export the DJManager for use in other commands
export { DJManager };

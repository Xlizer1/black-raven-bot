// src/services/DJPermissionService.ts

import {
  GuildMember,
  CommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import { logger } from "../utils/logger";

export interface DJSettings {
  enabled: boolean;
  djRoles: string[]; // Role IDs
  djOnlyCommands: string[];
  allowedChannels: string[]; // Channel IDs where music is allowed
  requireSameChannel: boolean; // DJ must be in same voice channel as bot
  voteSkipEnabled: boolean; // Enable vote skip for non-DJs
  voteSkipThreshold: number; // Percentage of users needed to skip (0.5 = 50%)
}

export interface DJCheckResult {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
}

export class DJPermissionService {
  private static instance: DJPermissionService;
  private settings = new Map<string, DJSettings>();

  private constructor() {}

  static getInstance(): DJPermissionService {
    if (!DJPermissionService.instance) {
      DJPermissionService.instance = new DJPermissionService();
    }
    return DJPermissionService.instance;
  }

  getSettings(guildId: string): DJSettings {
    return this.settings.get(guildId) || this.getDefaultSettings();
  }

  private getDefaultSettings(): DJSettings {
    return {
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
        "remove",
        "move",
        "repeat",
        "volume",
      ],
      allowedChannels: [],
      requireSameChannel: true,
      voteSkipEnabled: true,
      voteSkipThreshold: 0.5,
    };
  }

  updateSettings(guildId: string, settings: Partial<DJSettings>): void {
    const current = this.getSettings(guildId);
    const updated = { ...current, ...settings };
    this.settings.set(guildId, updated);
    logger.info(`Updated DJ settings for guild ${guildId}:`, settings);
  }

  // Main permission check method
  async checkPermissions(
    interaction: CommandInteraction | AutocompleteInteraction,
    commandName: string
  ): Promise<DJCheckResult> {
    if (!interaction.guild || !interaction.member) {
      return { allowed: false, reason: "Command can only be used in servers" };
    }

    const member = interaction.member as GuildMember;
    const settings = this.getSettings(interaction.guild.id);

    // If DJ mode is disabled, everyone can use commands
    if (!settings.enabled) {
      return { allowed: true };
    }

    // Check if command requires DJ permissions
    if (!this.requiresDJPermission(commandName, settings)) {
      return { allowed: true };
    }

    // Check if user is a DJ
    const isDJ = this.isDJ(member, settings);
    if (isDJ) {
      return { allowed: true };
    }

    // Check if channel is allowed for music
    const channelAllowed = this.isChannelAllowed(
      interaction.channelId,
      settings
    );
    if (!channelAllowed) {
      return {
        allowed: false,
        reason: "Music commands are not allowed in this channel",
        suggestion:
          settings.allowedChannels.length > 0
            ? `Try using ${settings.allowedChannels
                .map((id) => `<#${id}>`)
                .join(", ")}`
            : "Ask an admin to set up music channels",
      };
    }

    // Special handling for skip command with vote skip
    if (commandName === "skip" && settings.voteSkipEnabled) {
      return {
        allowed: false,
        reason: "You need DJ permissions to skip",
        suggestion: "Vote skip feature coming soon! Ask a DJ to skip for now.",
      };
    }

    // Default denial
    const djRolesList =
      settings.djRoles.length > 0
        ? settings.djRoles.map((id) => `<@&${id}>`).join(", ")
        : "No DJ roles configured";

    return {
      allowed: false,
      reason: "This command requires DJ permissions",
      suggestion: `Get one of these roles: ${djRolesList}, or ask an admin for permissions`,
    };
  }

  // Check if user has DJ permissions
  isDJ(member: GuildMember, settings?: DJSettings): boolean {
    const djSettings = settings || this.getSettings(member.guild.id);

    // DJ mode disabled = everyone is DJ
    if (!djSettings.enabled) return true;

    // Bot admins are always DJs
    if (member.permissions.has("Administrator")) return true;

    // Check for DJ roles
    return djSettings.djRoles.some((roleId) => member.roles.cache.has(roleId));
  }

  // Check if command requires DJ permission
  private requiresDJPermission(
    commandName: string,
    settings: DJSettings
  ): boolean {
    return settings.djOnlyCommands.includes(commandName);
  }

  // Check if channel allows music commands
  isChannelAllowed(channelId: string, settings?: DJSettings): boolean {
    const djSettings = settings || this.getSettings("");

    // If no channels specified, all channels are allowed
    if (djSettings.allowedChannels.length === 0) return true;

    return djSettings.allowedChannels.includes(channelId);
  }

  // Add/remove DJ role
  addDJRole(guildId: string, roleId: string): boolean {
    const settings = this.getSettings(guildId);

    if (settings.djRoles.includes(roleId)) {
      return false; // Already exists
    }

    settings.djRoles.push(roleId);
    this.settings.set(guildId, settings);
    return true;
  }

  removeDJRole(guildId: string, roleId: string): boolean {
    const settings = this.getSettings(guildId);
    const index = settings.djRoles.indexOf(roleId);

    if (index === -1) {
      return false; // Doesn't exist
    }

    settings.djRoles.splice(index, 1);
    this.settings.set(guildId, settings);
    return true;
  }

  // Add/remove allowed channel
  addAllowedChannel(guildId: string, channelId: string): boolean {
    const settings = this.getSettings(guildId);

    if (settings.allowedChannels.includes(channelId)) {
      return false; // Already exists
    }

    settings.allowedChannels.push(channelId);
    this.settings.set(guildId, settings);
    return true;
  }

  removeAllowedChannel(guildId: string, channelId: string): boolean {
    const settings = this.getSettings(guildId);
    const index = settings.allowedChannels.indexOf(channelId);

    if (index === -1) {
      return false; // Doesn't exist
    }

    settings.allowedChannels.splice(index, 1);
    this.settings.set(guildId, settings);
    return true;
  }

  clearAllowedChannels(guildId: string): number {
    const settings = this.getSettings(guildId);
    const count = settings.allowedChannels.length;
    settings.allowedChannels = [];
    this.settings.set(guildId, settings);
    return count;
  }

  // Voice channel validation
  validateVoiceChannelAccess(
    member: GuildMember,
    botVoiceChannelId: string | null,
    settings?: DJSettings
  ): DJCheckResult {
    const djSettings = settings || this.getSettings(member.guild.id);

    // Check if user is in a voice channel
    if (!member.voice.channelId) {
      return {
        allowed: false,
        reason: "You must be in a voice channel to use music commands",
        suggestion: "Join a voice channel first",
      };
    }

    // Check if bot is in a voice channel and user must be in same channel
    if (
      djSettings.requireSameChannel &&
      botVoiceChannelId &&
      member.voice.channelId !== botVoiceChannelId
    ) {
      return {
        allowed: false,
        reason: "You must be in the same voice channel as the bot",
        suggestion: `Join <#${botVoiceChannelId}> to control music`,
      };
    }

    return { allowed: true };
  }

  // Get user-friendly permission status
  getPermissionStatus(member: GuildMember): {
    isDJ: boolean;
    canControlMusic: boolean;
    restrictions: string[];
    suggestions: string[];
  } {
    const settings = this.getSettings(member.guild.id);
    const isDJ = this.isDJ(member, settings);
    const restrictions: string[] = [];
    const suggestions: string[] = [];

    if (!settings.enabled) {
      return {
        isDJ: true,
        canControlMusic: true,
        restrictions: [],
        suggestions: ["DJ mode is disabled - all users can control music"],
      };
    }

    if (!isDJ) {
      restrictions.push("Missing DJ role");
      if (settings.djRoles.length > 0) {
        suggestions.push(
          `Get one of these roles: ${settings.djRoles
            .map((id) => `<@&${id}>`)
            .join(", ")}`
        );
      } else {
        suggestions.push("Ask an admin to set up DJ roles");
      }
    }

    if (settings.allowedChannels.length > 0) {
      restrictions.push("Music limited to specific channels");
      suggestions.push(
        `Use music in: ${settings.allowedChannels
          .map((id) => `<#${id}>`)
          .join(", ")}`
      );
    }

    if (settings.requireSameChannel) {
      restrictions.push("Must be in same voice channel as bot");
    }

    return {
      isDJ,
      canControlMusic: isDJ,
      restrictions,
      suggestions,
    };
  }

  // Export/import settings for backup
  exportSettings(guildId: string): DJSettings {
    return this.getSettings(guildId);
  }

  importSettings(guildId: string, settings: DJSettings): void {
    this.settings.set(guildId, settings);
    logger.info(`Imported DJ settings for guild ${guildId}`);
  }

  // Get statistics
  getStatistics(): {
    totalGuilds: number;
    djModeEnabled: number;
    averageDJRoles: number;
    averageAllowedChannels: number;
  } {
    const guilds = Array.from(this.settings.values());
    const enabledGuilds = guilds.filter((s) => s.enabled);

    return {
      totalGuilds: guilds.length,
      djModeEnabled: enabledGuilds.length,
      averageDJRoles:
        enabledGuilds.length > 0
          ? enabledGuilds.reduce((sum, s) => sum + s.djRoles.length, 0) /
            enabledGuilds.length
          : 0,
      averageAllowedChannels:
        enabledGuilds.length > 0
          ? enabledGuilds.reduce(
              (sum, s) => sum + s.allowedChannels.length,
              0
            ) / enabledGuilds.length
          : 0,
    };
  }
}

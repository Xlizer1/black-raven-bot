import { Command } from "@sapphire/framework";
import { MessageFlags, GuildMember } from "discord.js";
import { DJPermissionService } from "../services/DJPermissionService";
import { MusicQueue } from "../services/MusicQueue";
import { logger } from "../utils/logger";

export interface MiddlewareResult {
  allowed: boolean;
  response?: string;
  ephemeral?: boolean;
}

export class CommandMiddleware {
  private static djService = DJPermissionService.getInstance();

  // Main middleware check for music commands
  static async checkMusicCommand(
    interaction:
      | Command.ChatInputCommandInteraction
      | Command.AutocompleteInteraction,
    commandName: string,
    options: {
      requireVoiceChannel?: boolean;
      requireSameChannel?: boolean;
      requirePlaying?: boolean;
      requireQueue?: boolean;
    } = {}
  ): Promise<MiddlewareResult> {
    if (!interaction.guild || !interaction.member) {
      return {
        allowed: false,
        response: "❌ This command can only be used in a server!",
        ephemeral: true,
      };
    }

    const member = interaction.member as GuildMember;
    const queue = MusicQueue.getQueue(interaction.guild.id);

    // 1. Check DJ permissions
    const djCheck = await this.djService.checkPermissions(
      interaction,
      commandName
    );
    if (!djCheck.allowed) {
      return {
        allowed: false,
        response: `❌ **${djCheck.reason}**\n\n💡 ${
          djCheck.suggestion || "Contact an admin for help"
        }`,
        ephemeral: true,
      };
    }

    // 2. Check voice channel requirements
    if (options.requireVoiceChannel && !member.voice.channelId) {
      return {
        allowed: false,
        response: "❌ You must be in a voice channel to use this command!",
        ephemeral: true,
      };
    }

    // 3. Check same voice channel requirement
    if (options.requireSameChannel) {
      const botChannelId = queue.getConnection()?.joinConfig?.channelId;
      const djSettings = this.djService.getSettings(interaction.guild.id);

      const voiceCheck = this.djService.validateVoiceChannelAccess(
        member,
        botChannelId || null,
        djSettings
      );
      if (!voiceCheck.allowed) {
        return {
          allowed: false,
          response: `❌ **${voiceCheck.reason}**\n\n💡 ${
            voiceCheck.suggestion || ""
          }`,
          ephemeral: true,
        };
      }
    }

    // 4. Check if music is currently playing
    if (options.requirePlaying && !queue.getIsPlaying()) {
      return {
        allowed: false,
        response: "❌ No music is currently playing!",
        ephemeral: true,
      };
    }

    // 5. Check if queue has songs
    if (options.requireQueue && queue.isEmpty()) {
      return {
        allowed: false,
        response: "❌ The queue is empty! Add some songs first.",
        ephemeral: true,
      };
    }

    return { allowed: true };
  }

  // Specialized middleware for different command types
  static async checkBasicMusicCommand(
    interaction:
      | Command.ChatInputCommandInteraction
      | Command.AutocompleteInteraction,
    commandName: string
  ): Promise<MiddlewareResult> {
    return this.checkMusicCommand(interaction, commandName);
  }

  static async checkPlaybackCommand(
    interaction: Command.ChatInputCommandInteraction,
    commandName: string
  ): Promise<MiddlewareResult> {
    return this.checkMusicCommand(interaction, commandName, {
      requireVoiceChannel: true,
      requireSameChannel: true,
      requirePlaying: true,
    });
  }

  static async checkQueueCommand(
    interaction: Command.ChatInputCommandInteraction,
    commandName: string
  ): Promise<MiddlewareResult> {
    return this.checkMusicCommand(interaction, commandName, {
      requireVoiceChannel: true,
      requireSameChannel: true,
    });
  }

  static async checkAdminCommand(
    interaction: Command.ChatInputCommandInteraction,
    commandName: string
  ): Promise<MiddlewareResult> {
    if (!interaction.guild || !interaction.member) {
      return {
        allowed: false,
        response: "❌ This command can only be used in a server!",
        ephemeral: true,
      };
    }

    const member = interaction.member as GuildMember;

    if (!member.permissions.has("ManageGuild")) {
      return {
        allowed: false,
        response:
          "❌ You need **Manage Server** permission to use this command!",
        ephemeral: true,
      };
    }

    return { allowed: true };
  }

  // Utility method to handle middleware results in commands
  static async handleMiddlewareResult(
    interaction:
      | Command.ChatInputCommandInteraction
      | Command.AutocompleteInteraction,
    result: MiddlewareResult
  ): Promise<boolean> {
    if (!result.allowed && result.response) {
      if ("reply" in interaction) {
        await interaction.reply({
          content: result.response,
          flags: result.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      }
      return false;
    }
    return true;
  }

  // Log command usage for analytics
  static logCommandUsage(
    interaction:
      | Command.ChatInputCommandInteraction
      | Command.AutocompleteInteraction,
    commandName: string,
    success: boolean
  ): void {
    logger.info(
      `Command ${commandName} ${success ? "executed" : "denied"} by ${
        interaction.user.tag
      } in guild ${interaction.guild?.id}`
    );
  }

  // Check if user can bypass certain restrictions (for admins/bot owners)
  static canBypassRestrictions(member: GuildMember): boolean {
    return member.permissions.has("Administrator");
  }

  // Get user permission summary for debugging
  static getUserPermissionSummary(member: GuildMember): {
    isAdmin: boolean;
    isDJ: boolean;
    canControlMusic: boolean;
    voiceChannel: string | null;
    restrictions: string[];
  } {
    const djService = this.djService;
    const settings = djService.getSettings(member.guild.id);
    const permissionStatus = djService.getPermissionStatus(member);

    return {
      isAdmin: member.permissions.has("Administrator"),
      isDJ: permissionStatus.isDJ,
      canControlMusic: permissionStatus.canControlMusic,
      voiceChannel: member.voice.channelId,
      restrictions: permissionStatus.restrictions,
    };
  }
}

// Decorator for command classes to automatically apply middleware
export function RequireDJ(
  options: {
    requireVoiceChannel?: boolean;
    requireSameChannel?: boolean;
    requirePlaying?: boolean;
    requireQueue?: boolean;
  } = {}
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (
      interaction: Command.ChatInputCommandInteraction
    ) {
      const commandName = interaction.commandName;
      const middlewareResult = await CommandMiddleware.checkMusicCommand(
        interaction,
        commandName,
        options
      );

      if (!middlewareResult.allowed) {
        CommandMiddleware.logCommandUsage(interaction, commandName, false);
        return CommandMiddleware.handleMiddlewareResult(
          interaction,
          middlewareResult
        );
      }

      CommandMiddleware.logCommandUsage(interaction, commandName, true);
      return originalMethod.call(this, interaction);
    };

    return descriptor;
  };
}

// Decorator for admin-only commands
export function RequireAdmin() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (
      interaction: Command.ChatInputCommandInteraction
    ) {
      const commandName = interaction.commandName;
      const middlewareResult = await CommandMiddleware.checkAdminCommand(
        interaction,
        commandName
      );

      if (!middlewareResult.allowed) {
        CommandMiddleware.logCommandUsage(interaction, commandName, false);
        return CommandMiddleware.handleMiddlewareResult(
          interaction,
          middlewareResult
        );
      }

      CommandMiddleware.logCommandUsage(interaction, commandName, true);
      return originalMethod.call(this, interaction);
    };

    return descriptor;
  };
}

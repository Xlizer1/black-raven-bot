// src/commands/debug.ts

import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

export class DebugCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("debug")
        .setDescription("Debug YouTube and system issues")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("ytdlp")
            .setDescription("Check yt-dlp version and functionality")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("test")
            .setDescription("Test YouTube URL parsing")
            .addStringOption((option) =>
              option
                .setName("url")
                .setDescription("YouTube URL to test")
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("stream")
            .setDescription("Test streaming for a specific URL")
            .addStringOption((option) =>
              option
                .setName("url")
                .setDescription("YouTube URL to test streaming")
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("system").setDescription("Show system information")
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const subcommand = interaction.options.getSubcommand();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (subcommand) {
      case "ytdlp":
        return this.debugYtDlp(interaction);

      case "test":
        const url = interaction.options.getString("url", true);
        return this.testUrl(interaction, url);

      case "stream":
        const streamUrl = interaction.options.getString("url", true);
        return this.testStream(interaction, streamUrl);

      case "system":
        return this.systemInfo(interaction);

      default:
        return interaction.editReply("❌ Unknown subcommand!");
    }
  }

  private async debugYtDlp(interaction: Command.ChatInputCommandInteraction) {
    try {
      // Check yt-dlp version
      const { stdout: version } = await execAsync("yt-dlp --version", {
        timeout: 5000,
      });

      // Test basic functionality
      const testCommand = `yt-dlp --get-title "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --no-warnings`;
      const { stdout: testResult } = await execAsync(testCommand, {
        timeout: 10000,
      });

      return interaction.editReply({
        content:
          `✅ **yt-dlp Debug Info**\n` +
          `• Version: ${version.trim()}\n` +
          `• Test result: ${testResult.trim() ? "✅ Working" : "❌ Failed"}\n` +
          `• Status: ${testResult.trim() ? "Healthy" : "Needs attention"}`,
      });
    } catch (error) {
      logger.error("yt-dlp debug error:", error);
      return interaction.editReply({
        content:
          `❌ **yt-dlp Issues Detected**\n` +
          `• Error: ${error}\n` +
          `• Solution: Try updating yt-dlp: \`sudo pacman -S yt-dlp\``,
      });
    }
  }

  private async testUrl(
    interaction: Command.ChatInputCommandInteraction,
    url: string
  ) {
    try {
      // Test URL parsing
      const infoCommand = `yt-dlp "${url}" --dump-json --no-download --skip-download --no-warnings`;
      const { stdout } = await execAsync(infoCommand, {
        timeout: 15000,
      });

      const data = JSON.parse(stdout.trim());

      return interaction.editReply({
        content:
          `✅ **URL Test Results**\n` +
          `• Title: ${data.title || "Unknown"}\n` +
          `• Duration: ${
            data.duration
              ? `${Math.floor(data.duration / 60)}:${(data.duration % 60)
                  .toString()
                  .padStart(2, "0")}`
              : "Unknown"
          }\n` +
          `• Uploader: ${data.uploader || "Unknown"}\n` +
          `• Available: ✅ Yes`,
      });
    } catch (error) {
      logger.error("URL test error:", error);

      let errorMsg = "Unknown error";
      if (error && typeof error === "object") {
        const execError = error as any;
        if (execError.stderr) {
          if (execError.stderr.includes("403")) {
            errorMsg = "403 Forbidden - YouTube blocking access";
          } else if (execError.stderr.includes("Private video")) {
            errorMsg = "Private video - Cannot access";
          } else if (execError.stderr.includes("Video unavailable")) {
            errorMsg = "Video unavailable or deleted";
          } else {
            errorMsg = execError.stderr.slice(0, 200);
          }
        }
      }

      return interaction.editReply({
        content:
          `❌ **URL Test Failed**\n` +
          `• URL: ${url}\n` +
          `• Error: ${errorMsg}\n` +
          `• Suggestion: Try updating yt-dlp or use a different video`,
      });
    }
  }

  private async testStream(
    interaction: Command.ChatInputCommandInteraction,
    url: string
  ) {
    try {
      // Test the exact command that worked manually
      const testCommand = `yt-dlp "${url}" --get-url --format "bestaudio[ext=m4a]/bestaudio/best" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --referer "https://www.youtube.com/" --extractor-retries 5 --fragment-retries 5`;

      const { stdout } = await execAsync(testCommand, {
        timeout: 20000,
      });

      const streamUrl = stdout.trim();

      return interaction.editReply({
        content:
          `✅ **Stream Test Successful**\n` +
          `• URL: ${url}\n` +
          `• Stream URL: ${streamUrl.substring(0, 100)}...\n` +
          `• Status: Ready to play`,
      });
    } catch (error) {
      logger.error("Stream test error:", error);

      let errorMsg = "Unknown error";
      if (error && typeof error === "object") {
        const execError = error as any;
        if (execError.stderr) {
          if (execError.stderr.includes("403")) {
            errorMsg = "403 Forbidden - YouTube is blocking this request";
          } else if (execError.stderr.includes("fragment")) {
            errorMsg = "Fragment download failed - Video may be protected";
          } else if (execError.stderr.includes("Sign in")) {
            errorMsg = "Age-restricted content - Requires authentication";
          } else {
            errorMsg = execError.stderr.slice(0, 200);
          }
        }
      }

      return interaction.editReply({
        content:
          `❌ **Stream Test Failed**\n` +
          `• URL: ${url}\n` +
          `• Error: ${errorMsg}\n` +
          `• Suggestion: This video may be region-locked or heavily protected`,
      });
    }
  }

  private async systemInfo(interaction: Command.ChatInputCommandInteraction) {
    try {
      const nodeVersion = process.version;
      const platform = process.platform;
      const arch = process.arch;
      const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      return interaction.editReply({
        content:
          `📊 **System Information**\n` +
          `• Node.js: ${nodeVersion}\n` +
          `• Platform: ${platform} (${arch})\n` +
          `• Memory Usage: ${memory}MB\n` +
          `• Bot Uptime: ${Math.floor(process.uptime() / 60)} minutes`,
      });
    } catch (error) {
      logger.error("System info error:", error);
      return interaction.editReply("❌ Failed to get system information!");
    }
  }
}

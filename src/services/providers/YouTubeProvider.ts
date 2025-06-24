import { exec } from "child_process";
import { promisify } from "util";
import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  MusicPlatform,
  type SearchOptions,
} from "./IMusicProvider";
import { logger } from "../../utils/logger";
import { botConfig } from "../../config/config";

const execAsync = promisify(exec);

export class YouTubeProvider implements IMusicProvider {
  readonly platform = MusicPlatform.YOUTUBE;

  private static readonly URL_REGEX =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;

  // Enhanced rate limiting and bot detection avoidance
  private lastSearchTime = 0;
  private readonly SEARCH_COOLDOWN = Math.max(
    botConfig.youtube.searchCooldown,
    8000
  ); // Minimum 8 seconds
  private searchCount = 0;
  private readonly MAX_SEARCHES_PER_HOUR = Math.min(
    botConfig.youtube.maxSearchesPerHour,
    15
  ); // Maximum 15 per hour
  private hourlyResetTime = Date.now() + 3600000;

  // Bot detection tracking
  private botDetectionCount = 0;
  private lastBotDetection = 0;
  private isInCooldownMode = false;
  private cooldownEndTime = 0;

  // User agent rotation
  private userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/111.0 Firefox/117.0",
  ];

  private currentUserAgentIndex = 0;

  validateUrl(url: string): boolean {
    return YouTubeProvider.URL_REGEX.test(url);
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<VideoInfo[]> {
    try {
      // Check if we're in extended cooldown due to bot detection
      if (this.isInCooldownMode && Date.now() < this.cooldownEndTime) {
        const remainingTime = Math.ceil(
          (this.cooldownEndTime - Date.now()) / 1000
        );
        logger.warn(
          `🚫 In bot detection cooldown for ${remainingTime} more seconds`
        );
        throw new Error("YouTube temporarily unavailable due to bot detection");
      }

      // Apply enhanced rate limiting
      await this.applyEnhancedRateLimit();

      const limit = options.limit || 1;
      const sanitizedQuery = this.sanitizeQuery(query);

      // Get progressive search strategies (least to most aggressive)
      const strategies = this.getProgressiveSearchStrategies(
        sanitizedQuery,
        limit
      );

      for (const [index, strategy] of strategies.entries()) {
        try {
          logger.debug(
            `🔍 Trying search strategy ${index + 1}/${strategies.length}: ${
              strategy.name
            }`
          );

          // Add random delay between strategies
          if (index > 0) {
            await this.sleep(2000 + Math.random() * 3000); // 2-5 second delay
          }

          const { stdout } = await execAsync(strategy.command, {
            timeout: strategy.timeout,
            maxBuffer: 1024 * 1024 * 5, // 5MB buffer
          });

          const results = this.parseSearchResults(stdout);

          if (results.length > 0) {
            logger.info(`✅ Search successful with strategy: ${strategy.name}`);
            this.updateSearchStats();
            this.resetBotDetectionTracking();
            return results;
          }
        } catch (error) {
          logger.warn(
            `❌ Strategy "${strategy.name}" failed:`,
            this.getErrorSummary(error)
          );

          if (this.isBotDetectionError(error)) {
            this.handleBotDetection();

            // If this is the last strategy, don't continue
            if (index === strategies.length - 1) {
              break;
            }

            // Apply progressive delay based on detection count
            const delayTime = Math.min(
              10000 + this.botDetectionCount * 5000,
              60000
            );
            logger.warn(
              `🤖 Bot detection #${this.botDetectionCount}, waiting ${delayTime}ms`
            );
            await this.sleep(delayTime);
          }

          continue;
        }
      }

      logger.error(`❌ All search strategies exhausted for query: ${query}`);
      return [];
    } catch (error) {
      logger.error("YouTube search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    try {
      // Check cooldown
      if (this.isInCooldownMode && Date.now() < this.cooldownEndTime) {
        logger.warn("🚫 Skipping stream info due to bot detection cooldown");
        return null;
      }

      await this.applyEnhancedRateLimit();

      // Get basic info first (lightweight operation)
      let title = "Unknown";
      let duration: number | undefined;

      try {
        const infoResult = await this.getBasicInfo(url);
        if (infoResult) {
          title = infoResult.title;
          duration = infoResult.duration;
        }
      } catch (error) {
        logger.debug("Basic info failed, continuing with stream extraction");
      }

      // Enhanced streaming strategies
      const strategies = this.getEnhancedStreamingStrategies(url);

      for (const [index, strategy] of strategies.entries()) {
        try {
          logger.debug(
            `🎵 Trying streaming strategy ${index + 1}: ${strategy.name}`
          );

          if (index > 0) {
            await this.sleep(1500 + Math.random() * 2000); // Random delay
          }

          const { stdout } = await execAsync(strategy.command, {
            timeout: strategy.timeout,
          });

          const streamUrl = stdout.trim();

          if (streamUrl && this.isValidStreamUrl(streamUrl)) {
            logger.info(`✅ Stream extraction successful: ${strategy.name}`);
            this.resetBotDetectionTracking();
            return {
              title,
              streamUrl,
              duration,
              platform: this.platform,
            };
          }
        } catch (error) {
          logger.warn(
            `❌ Stream strategy "${strategy.name}" failed:`,
            this.getErrorSummary(error)
          );

          if (this.isBotDetectionError(error)) {
            this.handleBotDetection();
            break; // Don't try more strategies if bot detection is triggered
          }

          continue;
        }
      }

      logger.error(`❌ Stream extraction failed for: ${title}`);
      return null;
    } catch (error) {
      logger.error("Stream info error:", error);
      return null;
    }
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    try {
      if (this.isInCooldownMode && Date.now() < this.cooldownEndTime) {
        logger.warn("🚫 Skipping track info due to bot detection cooldown");
        return null;
      }

      await this.applyEnhancedRateLimit();

      // Try lightweight info extraction
      const basicInfo = await this.getBasicInfo(url);
      if (basicInfo) {
        return {
          id: this.extractVideoId(url),
          title: basicInfo.title,
          url: url,
          duration: basicInfo.duration,
          thumbnail: undefined,
          platform: this.platform,
          artist: undefined,
          album: undefined,
        };
      }

      return null;
    } catch (error) {
      logger.error("Track info error:", error);
      return null;
    }
  }

  supportsPlaylists(): boolean {
    return true;
  }

  supportsDirectStreaming(): boolean {
    return true;
  }

  // Enhanced private methods

  private async applyEnhancedRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset hourly counter
    if (now > this.hourlyResetTime) {
      this.searchCount = 0;
      this.hourlyResetTime = now + 3600000;
      logger.info("🔄 Hourly search limit reset");
    }

    // Check hourly limit
    if (this.searchCount >= this.MAX_SEARCHES_PER_HOUR) {
      const waitTime = this.hourlyResetTime - now;
      logger.warn(
        `⏰ Hourly limit reached. Next reset in ${Math.ceil(
          waitTime / 60000
        )} minutes`
      );
      throw new Error("Hourly search limit exceeded");
    }

    // Apply progressive cooldown based on recent bot detections
    let cooldown = this.SEARCH_COOLDOWN;
    if (this.botDetectionCount > 0) {
      cooldown = Math.min(cooldown * (1 + this.botDetectionCount), 30000); // Max 30 seconds
    }

    const timeSinceLastSearch = now - this.lastSearchTime;
    if (timeSinceLastSearch < cooldown) {
      const waitTime = cooldown - timeSinceLastSearch;
      logger.debug(`⏱️ Applying rate limit: ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    this.lastSearchTime = Date.now();
  }

  private getProgressiveSearchStrategies(query: string, limit: number) {
    const userAgent = this.getNextUserAgent();

    return [
      // Strategy 1: Ultra minimal
      {
        name: "Ultra Minimal",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-warnings --quiet --skip-download --no-check-certificate --socket-timeout 30`,
        timeout: 20000,
      },

      // Strategy 2: Mobile stealth
      {
        name: "Mobile Stealth",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-warnings --quiet --skip-download --user-agent "${this.userAgents[4]}" --referer "https://m.youtube.com/" --sleep-interval 2 --max-sleep-interval 5`,
        timeout: 25000,
      },

      // Strategy 3: Desktop with cookies simulation
      {
        name: "Desktop Stealth",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-warnings --quiet --skip-download --user-agent "${userAgent}" --referer "https://www.google.com/search?q=${encodeURIComponent(
          query
        )}" --sleep-requests 3`,
        timeout: 30000,
      },

      // Strategy 4: Geographic bypass
      {
        name: "Geo Bypass",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-warnings --quiet --skip-download --geo-bypass --geo-bypass-country US --extractor-retries 1`,
        timeout: 35000,
      },
    ];
  }

  private getEnhancedStreamingStrategies(url: string) {
    const userAgent = this.getNextUserAgent();

    return [
      // Strategy 1: Minimal audio extraction
      {
        name: "Minimal Audio",
        command: `yt-dlp "${url}" --get-url --format "140/251/250/249" --no-warnings --quiet --socket-timeout 30`,
        timeout: 20000,
      },

      // Strategy 2: Mobile audio
      {
        name: "Mobile Audio",
        command: `yt-dlp "${url}" --get-url --format "140/worst" --user-agent "${this.userAgents[4]}" --no-warnings --quiet --sleep-requests 2`,
        timeout: 25000,
      },

      // Strategy 3: Fallback any format
      {
        name: "Fallback Format",
        command: `yt-dlp "${url}" --get-url --format "bestaudio/worst" --user-agent "${userAgent}" --no-warnings --quiet --geo-bypass`,
        timeout: 30000,
      },
    ];
  }

  private async getBasicInfo(
    url: string
  ): Promise<{ title: string; duration?: number } | null> {
    try {
      const userAgent = this.getNextUserAgent();
      const command = `yt-dlp "${url}" --get-title --get-duration --no-warnings --quiet --user-agent "${userAgent}" --socket-timeout 20`;

      const { stdout } = await execAsync(command, { timeout: 15000 });
      const lines = stdout.trim().split("\n");

      if (lines.length >= 1 && lines[0]) {
        return {
          title: lines[0],
          duration:
            lines.length >= 2 && lines[1]
              ? this.parseDuration(lines[1])
              : undefined,
        };
      }
    } catch (error) {
      logger.debug(
        "Basic info extraction failed:",
        this.getErrorSummary(error)
      );
    }
    return null;
  }

  private handleBotDetection(): void {
    this.botDetectionCount++;
    this.lastBotDetection = Date.now();

    // Enter extended cooldown mode after 3 detections
    if (this.botDetectionCount >= 3) {
      this.isInCooldownMode = true;
      this.cooldownEndTime = Date.now() + 5 * 60 * 1000; // 5 minute cooldown
      logger.warn(
        `🚫 Entering 5-minute cooldown due to repeated bot detection`
      );
    }
  }

  private resetBotDetectionTracking(): void {
    // Reset tracking after successful operation
    if (Date.now() - this.lastBotDetection > 300000) {
      // 5 minutes
      this.botDetectionCount = 0;
      this.isInCooldownMode = false;
      this.cooldownEndTime = 0;
    }
  }

  private getNextUserAgent(): string | undefined {
    const agent = this.userAgents[this.currentUserAgentIndex];
    this.currentUserAgentIndex =
      (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return agent;
  }

  private isValidStreamUrl(url: string): boolean {
    return (
      url.startsWith("http") &&
      (url.includes("googlevideo.com") ||
        url.includes("youtube.com") ||
        url.includes("ytimg.com"))
    );
  }

  private updateSearchStats(): void {
    this.searchCount++;
  }

  private sanitizeQuery(query: string): string {
    return query
      .replace(/[;&|`$(){}[\]\\]/g, "")
      .replace(/"/g, '\\"')
      .trim();
  }

  private parseSearchResults(stdout: string): VideoInfo[] {
    const lines = stdout.trim().split("\n");
    const results: VideoInfo[] = [];

    for (const line of lines) {
      if (line.trim()) {
        try {
          const data = JSON.parse(line);
          results.push(this.parseVideoInfo(data));
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    return results;
  }

  private parseVideoInfo(data: any): VideoInfo {
    return {
      id: data.id || "unknown",
      title: data.title || "Unknown",
      url: data.webpage_url || data.url || "",
      duration: data.duration,
      thumbnail: data.thumbnail,
      platform: this.platform,
      artist: data.uploader,
      album: undefined,
    };
  }

  private parseDuration(durationStr: string): number | undefined {
    if (!durationStr) return undefined;

    if (durationStr.includes(":")) {
      const parts = durationStr.split(":").reverse();
      let duration = 0;
      for (let i = 0; i < parts.length; i++) {
        duration += parseInt(parts[i] || "0") * Math.pow(60, i);
      }
      return duration > 0 ? duration : undefined;
    } else {
      const duration = parseFloat(durationStr);
      return isNaN(duration) ? undefined : Math.floor(duration);
    }
  }

  private extractVideoId(url: string): string {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/
    );
    return match && match[1] ? match[1] : "unknown";
  }

  private isBotDetectionError(error: any): boolean {
    if (!error || typeof error !== "object") return false;

    const errorStr = JSON.stringify(error).toLowerCase();
    return (
      errorStr.includes("sign in to confirm") ||
      errorStr.includes("not a bot") ||
      errorStr.includes("captcha") ||
      errorStr.includes("bot detection") ||
      errorStr.includes("403") ||
      errorStr.includes("429") ||
      errorStr.includes("please confirm") ||
      errorStr.includes("verification")
    );
  }

  private getErrorSummary(error: any): string {
    if (!error) return "Unknown error";

    if (typeof error === "object" && error.stderr) {
      const stderr = error.stderr.toString();
      if (stderr.includes("Sign in to confirm")) {
        return "Bot detection triggered";
      } else if (stderr.includes("403")) {
        return "403 Forbidden";
      } else if (stderr.includes("429")) {
        return "Rate limit exceeded";
      } else if (
        stderr.includes("Private video") ||
        stderr.includes("unavailable")
      ) {
        return "Video unavailable";
      } else {
        return stderr.slice(0, 100) + "...";
      }
    }

    return error.toString().slice(0, 100);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

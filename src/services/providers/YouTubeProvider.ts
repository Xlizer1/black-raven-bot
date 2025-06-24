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

  // Rate limiting to avoid triggering bot detection
  private lastSearchTime = 0;
  private readonly SEARCH_COOLDOWN = botConfig.youtube.searchCooldown;
  private searchCount = 0;
  private readonly MAX_SEARCHES_PER_HOUR = botConfig.youtube.maxSearchesPerHour;
  private hourlyResetTime = Date.now() + 3600000; // 1 hour

  validateUrl(url: string): boolean {
    return YouTubeProvider.URL_REGEX.test(url);
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<VideoInfo[]> {
    try {
      // Apply rate limiting
      await this.applyRateLimit();

      const limit = options.limit || 1;
      const sanitizedQuery = this.sanitizeQuery(query);

      // Try multiple search strategies with increasing sophistication
      const strategies = this.getSearchStrategies(sanitizedQuery, limit);

      for (const strategy of strategies) {
        try {
          logger.debug(`Trying search strategy: ${strategy.name}`);

          const { stdout } = await execAsync(strategy.command, {
            timeout: strategy.timeout,
            maxBuffer: 1024 * 1024 * 3,
          });

          const results = this.parseSearchResults(stdout);

          if (results.length > 0) {
            logger.debug(`✅ Success with strategy: ${strategy.name}`);
            this.updateSearchStats();
            return results;
          }
        } catch (error) {
          logger.warn(
            `❌ Strategy "${strategy.name}" failed:`,
            this.getErrorSummary(error)
          );

          // If this is a bot detection error, wait longer before next attempt
          if (this.isBotDetectionError(error)) {
            logger.warn(
              "🤖 Bot detection triggered, applying extended cooldown"
            );
            await this.sleep(5000); // 5 second penalty
          }

          continue; // Try next strategy
        }
      }

      logger.error(`All search strategies failed for query: ${query}`);
      return [];
    } catch (error) {
      logger.error("YouTube search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    try {
      // Apply rate limiting
      await this.applyRateLimit();

      // First, get basic track info
      let title = "Unknown";
      let duration: number | undefined;

      try {
        const infoResult = await this.getBasicInfo(url);
        if (infoResult) {
          title = infoResult.title;
          duration = infoResult.duration;
        }
      } catch (error) {
        logger.warn("Could not get basic info, using defaults");
      }

      // Enhanced streaming strategies with better anti-bot protection
      const strategies = this.getStreamingStrategies(url);

      for (const strategy of strategies) {
        try {
          logger.debug(`🔄 Trying streaming strategy: ${strategy.name}`);

          const { stdout } = await execAsync(strategy.command, {
            timeout: strategy.timeout,
          });

          const streamUrl = stdout.trim();

          if (streamUrl && streamUrl.startsWith("http")) {
            logger.debug(`✅ Success with strategy: ${strategy.name}`);
            return {
              title,
              streamUrl,
              duration,
              platform: this.platform,
            };
          }
        } catch (error) {
          logger.warn(
            `❌ Strategy "${strategy.name}" failed:`,
            this.getErrorSummary(error)
          );

          if (this.isBotDetectionError(error)) {
            logger.warn("🤖 Bot detection during streaming, applying cooldown");
            await this.sleep(3000);
          }

          continue;
        }
      }

      logger.error(`❌ All streaming strategies failed for: ${title}`);
      return null;
    } catch (error) {
      logger.error("Stream info error:", error);
      return null;
    }
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    try {
      await this.applyRateLimit();

      // Try full info extraction first
      try {
        const command = this.buildInfoCommand(url);
        const { stdout } = await execAsync(command, {
          timeout: 20000,
        });
        const data = JSON.parse(stdout.trim());
        return this.parseVideoInfo(data);
      } catch (error) {
        logger.warn("Full info extraction failed, trying basic info...");
      }

      // Fallback to basic info
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

  // Private helper methods

  private async applyRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset hourly counter if needed
    if (now > this.hourlyResetTime) {
      this.searchCount = 0;
      this.hourlyResetTime = now + 3600000;
    }

    // Check hourly limit
    if (this.searchCount >= this.MAX_SEARCHES_PER_HOUR) {
      const waitTime = this.hourlyResetTime - now;
      logger.warn(
        `Hourly search limit reached. Waiting ${Math.ceil(
          waitTime / 60000
        )} minutes.`
      );
      throw new Error("Hourly search limit exceeded");
    }

    // Apply cooldown between searches
    const timeSinceLastSearch = now - this.lastSearchTime;
    if (timeSinceLastSearch < this.SEARCH_COOLDOWN) {
      const waitTime = this.SEARCH_COOLDOWN - timeSinceLastSearch;
      await this.sleep(waitTime);
    }

    this.lastSearchTime = Date.now();
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

  private getSearchStrategies(query: string, limit: number) {
    return [
      {
        name: "Minimal stealth",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-download --skip-download --ignore-errors --no-warnings --quiet --no-check-certificate`,
        timeout: 15000,
      },
      {
        name: "Mobile user agent",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-download --skip-download --ignore-errors --no-warnings --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1" --extractor-retries 2`,
        timeout: 18000,
      },
      {
        name: "Alternative browser",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-download --skip-download --ignore-errors --no-warnings --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 1`,
        timeout: 20000,
      },
      {
        name: "Fallback search",
        command: `yt-dlp "ytsearch${limit}:${query}" --dump-json --no-download --skip-download --ignore-errors --quiet --geo-bypass --extractor-retries 1`,
        timeout: 25000,
      },
    ];
  }

  private getStreamingStrategies(url: string) {
    return [
      {
        name: "Minimal stealth streaming",
        command: `yt-dlp "${url}" --get-url --format "bestaudio[ext=m4a]/bestaudio/best" --quiet --no-check-certificate`,
        timeout: 15000,
      },
      {
        name: "Mobile streaming",
        command: `yt-dlp "${url}" --get-url --format "140/251/250/249/bestaudio/worst" --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15" --extractor-retries 2`,
        timeout: 20000,
      },
      {
        name: "Alternative streaming",
        command: `yt-dlp "${url}" --get-url --format "bestaudio/worst" --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.youtube.com/" --extractor-retries 2`,
        timeout: 25000,
      },
      {
        name: "Fallback streaming",
        command: `yt-dlp "${url}" --get-url --format "worst" --quiet --geo-bypass --extractor-retries 1`,
        timeout: 30000,
      },
    ];
  }

  private async getBasicInfo(
    url: string
  ): Promise<{ title: string; duration?: number } | null> {
    try {
      const command = `yt-dlp "${url}" --get-title --get-duration --quiet --no-check-certificate`;
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

  private buildInfoCommand(url: string): string {
    return `yt-dlp "${url}" --dump-json --no-download --skip-download --quiet --no-check-certificate --extractor-retries 1`;
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
      errorStr.includes("429")
    );
  }

  private getErrorSummary(error: any): string {
    if (!error) return "Unknown error";

    if (typeof error === "object" && error.stderr) {
      // Extract key parts of the error
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

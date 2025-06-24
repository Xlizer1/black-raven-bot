import { MusicProviderFactory } from "./MusicProviderFactory";
import { FallbackMusicService } from "./FallbackMusicService";
import type {
  VideoInfo,
  StreamInfo,
  MusicPlatform,
  SearchOptions,
} from "./providers/IMusicProvider";
import { logger } from "../utils/logger";

export class MusicService {
  private static factory = MusicProviderFactory.getInstance();
  private static fallbackService = FallbackMusicService.getInstance();

  static async search(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions
  ): Promise<VideoInfo[]> {
    try {
      // Use fallback service for enhanced reliability
      const results = await this.fallbackService.searchWithFallback(
        query,
        platform,
        options
      );

      if (results && results.length > 0) {
        logger.debug(
          `Search successful: ${results.length} results for "${query}"`
        );
        return results;
      }

      // If fallback also fails, try direct factory as last resort
      logger.warn("Fallback search failed, trying direct factory method");
      return await this.factory.search(query, platform, options);
    } catch (error) {
      logger.error("All search methods failed:", error);

      // Return a helpful error result
      return [
        {
          id: "error",
          title: `Search failed for: ${query}`,
          url: "",
          platform: platform || ("youtube" as any),
          duration: 0,
          thumbnail: undefined,
          artist: "System",
          album: "Error",
        },
      ];
    }
  }

  static async getStreamInfo(input: string): Promise<StreamInfo | null> {
    try {
      // Use fallback service for enhanced reliability
      const streamInfo = await this.fallbackService.getStreamWithFallback(
        input
      );

      if (streamInfo) {
        logger.debug(`Stream info obtained for: ${streamInfo.title}`);
        return streamInfo;
      }

      // Try direct factory as fallback
      logger.warn("Fallback stream extraction failed, trying direct factory");
      return await this.factory.getStreamInfo(input);
    } catch (error) {
      logger.error("Stream extraction failed completely:", error);
      return null;
    }
  }

  static async getTrackInfo(url: string): Promise<VideoInfo | null> {
    try {
      // For track info, try factory first since it's usually more reliable
      const trackInfo = await this.factory.getTrackInfo(url);

      if (trackInfo) {
        return trackInfo;
      }

      // If factory fails, we could potentially extract basic info from URL
      logger.warn("Track info extraction failed");
      return null;
    } catch (error) {
      logger.error("Track info extraction error:", error);
      return null;
    }
  }

  static detectPlatform(url: string): MusicPlatform | null {
    return this.factory.detectPlatform(url);
  }

  static getAvailablePlatforms(): MusicPlatform[] {
    return this.factory.getAvailablePlatforms();
  }

  static setDefaultPlatform(platform: MusicPlatform): void {
    this.factory.setDefaultPlatform(platform);
  }

  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  static isUrl(input: string): boolean {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  }

  // New utility methods for debugging and monitoring
  static async getServiceStatus(): Promise<{
    factory: { platforms: MusicPlatform[] };
    fallback: ReturnType<FallbackMusicService["getStatus"]>;
  }> {
    return {
      factory: {
        platforms: this.factory.getAvailablePlatforms(),
      },
      fallback: this.fallbackService.getStatus(),
    };
  }

  static clearAllCaches(): void {
    this.fallbackService.clearCache();
    logger.info("All music service caches cleared");
  }

  static resetYouTubeConnection(): void {
    this.fallbackService.resetYouTubeStatus();
    logger.info("YouTube connection status reset");
  }

  // Enhanced search with retry logic
  static async searchWithRetry(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions,
    maxRetries: number = 2
  ): Promise<VideoInfo[]> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const results = await this.search(query, platform, options);

        // Check if we got valid results (not error results)
        if (results.length > 0 && results[0]?.id !== "error") {
          return results;
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff
          logger.warn(
            `Search attempt ${attempt} failed, retrying in ${delay}ms...`
          );
          await this.sleep(delay);
        }
      } catch (error) {
        lastError = error;
        logger.warn(`Search attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          const delay = Math.min(2000 * attempt, 10000);
          await this.sleep(delay);
        }
      }
    }

    logger.error(
      `All ${maxRetries} search attempts failed for query: ${query}`
    );
    throw lastError || new Error("Search failed after all retry attempts");
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

import { MusicProviderFactory } from "./MusicProviderFactory";
import { YouTubeProvider } from "./providers/YouTubeProvider";
import type {
  VideoInfo,
  StreamInfo,
  MusicPlatform,
  SearchOptions,
} from "./providers/IMusicProvider";

export class MusicService {
  private static factory = MusicProviderFactory.getInstance();

  static async search(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions
  ): Promise<VideoInfo[]> {
    return this.factory.search(query, platform, options);
  }

  // Fast search specifically for autocomplete
  static async searchForAutocomplete(
    query: string,
    platform?: MusicPlatform,
    limit: number = 10
  ): Promise<VideoInfo[]> {
    try {
      // For now, only YouTube supports fast autocomplete
      // Spotify can be added later with similar optimization
      if (!platform || platform === "youtube") {
        const youtubeProvider = this.factory.getProvider(
          "youtube" as MusicPlatform
        );
        if (youtubeProvider && youtubeProvider instanceof YouTubeProvider) {
          return await youtubeProvider.searchForAutocomplete(query, limit);
        }
      }

      // Fallback to regular search with timeout protection
      return Promise.race([
        this.factory.search(query, platform, { limit }),
        new Promise<VideoInfo[]>(
          (resolve) => setTimeout(() => resolve([]), 2000) // 2 second timeout for autocomplete
        ),
      ]);
    } catch (error) {
      console.error("Autocomplete search error:", error);
      return [];
    }
  }

  static async getStreamInfo(input: string): Promise<StreamInfo | null> {
    return this.factory.getStreamInfo(input);
  }

  static async getTrackInfo(url: string): Promise<VideoInfo | null> {
    return this.factory.getTrackInfo(url);
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
}

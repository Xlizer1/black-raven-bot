import { MusicProviderFactory } from "./MusicProviderFactory";
import { YouTubeProvider } from "./providers/YouTubeProvider";
import { AutocompleteCache } from "./AutocompleteCache";
import type {
  VideoInfo,
  StreamInfo,
  MusicPlatform,
  SearchOptions,
} from "./providers/IMusicProvider";

export class MusicService {
  private static factory = MusicProviderFactory.getInstance();
  private static cache = AutocompleteCache.getInstance();

  static async search(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions
  ): Promise<VideoInfo[]> {
    return this.factory.search(query, platform, options);
  }

  // Fast search specifically for autocomplete with caching
  static async searchForAutocomplete(
    query: string,
    platform?: MusicPlatform,
    limit: number = 8
  ): Promise<VideoInfo[]> {
    const targetPlatform = platform || "youtube";

    try {
      // Check cache first
      const cachedResults = this.cache.get(query, targetPlatform);
      if (cachedResults) {
        return cachedResults.slice(0, limit);
      }

      // For YouTube, use optimized search
      if (targetPlatform === "youtube") {
        const youtubeProvider = this.factory.getProvider(
          "youtube" as MusicPlatform
        );
        if (youtubeProvider && youtubeProvider instanceof YouTubeProvider) {
          const results = await Promise.race([
            youtubeProvider.searchForAutocomplete(query, limit),
            new Promise<VideoInfo[]>(
              (resolve) => setTimeout(() => resolve([]), 1800) // 1.8 second timeout
            ),
          ]);

          // Cache successful results
          if (results.length > 0) {
            this.cache.set(query, targetPlatform, results);
          }

          return results;
        }
      }

      // For Spotify, use optimized search if available
      if (targetPlatform === "spotify") {
        const spotifyProvider = this.factory.getProvider(
          "spotify" as MusicPlatform
        );
        if (spotifyProvider && "searchForAutocomplete" in spotifyProvider) {
          const results = await Promise.race([
            (spotifyProvider as any).searchForAutocomplete(query, limit),
            new Promise<VideoInfo[]>(
              (resolve) => setTimeout(() => resolve([]), 1800) // 1.8 second timeout
            ),
          ]);

          // Cache successful results
          if (results.length > 0) {
            this.cache.set(query, targetPlatform, results);
          }

          return results;
        }
      }

      // Fallback to regular search with aggressive timeout
      const results = await Promise.race([
        this.factory.search(query, platform as MusicPlatform, { limit }),
        new Promise<VideoInfo[]>(
          (resolve) => setTimeout(() => resolve([]), 1500) // 1.5 second fallback timeout
        ),
      ]);

      // Cache successful results
      if (results.length > 0) {
        this.cache.set(query, targetPlatform, results);
      }

      return results;
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

  // Cache management methods
  static clearAutocompleteCache(): void {
    this.cache.clear();
  }

  static getAutocompleteCacheSize(): number {
    return this.cache.size();
  }
}

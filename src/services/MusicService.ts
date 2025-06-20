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
      // Check cache first - this is crucial for performance
      const cachedResults = this.cache.get(query, targetPlatform);
      if (cachedResults) {
        return cachedResults.slice(0, limit);
      }

      // Create multiple timeout layers for reliability
      const searchPromise = async (): Promise<VideoInfo[]> => {
        // For YouTube, use the ultra-fast optimized search
        if (targetPlatform === "youtube") {
          const youtubeProvider = this.factory.getProvider(
            "youtube" as MusicPlatform
          );
          if (youtubeProvider && youtubeProvider instanceof YouTubeProvider) {
            return await youtubeProvider.searchForAutocomplete(query, limit);
          }
        }
        // For Spotify, use optimized search if available
        else if (targetPlatform === "spotify") {
          const spotifyProvider = this.factory.getProvider(
            "spotify" as MusicPlatform
          );
          if (spotifyProvider && "searchForAutocomplete" in spotifyProvider) {
            return await (spotifyProvider as any).searchForAutocomplete(
              query,
              limit
            );
          }
        }

        // Fallback - should rarely be reached
        return await this.factory.search(query, platform as MusicPlatform, {
          limit: Math.min(limit, 3),
        });
      };

      // Race with timeout
      const timeoutPromise = new Promise<VideoInfo[]>((resolve) => {
        setTimeout(() => {
          console.warn(`Autocomplete search timed out for: "${query}"`);
          resolve([]);
        }, 1500); // 1.5 second timeout
      });

      const results = await Promise.race([searchPromise(), timeoutPromise]);

      // Cache successful results (only if we got some results and no timeout)
      if (results.length > 0) {
        this.cache.set(query, targetPlatform, results);
      }

      return results.slice(0, limit);
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

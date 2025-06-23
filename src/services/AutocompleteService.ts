import { MusicService } from "./MusicService";
import { MusicPlatform, type VideoInfo } from "./providers/IMusicProvider";
import { logger } from "../utils/logger";

interface CacheEntry {
  results: Array<{ name: string; value: string }>;
  timestamp: number;
}

interface SearchResult {
  name: string;
  value: string;
}

export class AutocompleteService {
  private static instance: AutocompleteService;
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 200;
  private readonly MIN_QUERY_LENGTH = 2;
  private readonly MAX_RESULTS = 10;
  private readonly SEARCH_TIMEOUT = 2000; // 2 seconds for autocomplete

  private constructor() {}

  static getInstance(): AutocompleteService {
    if (!AutocompleteService.instance) {
      AutocompleteService.instance = new AutocompleteService();
    }
    return AutocompleteService.instance;
  }

  async getAutocompleteResults(query: string): Promise<SearchResult[]> {
    try {
      // Validate query
      if (this.shouldSkipAutocomplete(query)) {
        return [];
      }

      // Check cache first
      const cached = this.getCachedResults(query);
      if (cached.length > 0) {
        logger.debug(`Returning cached autocomplete results for: ${query}`);
        return cached;
      }

      // Search for new results
      const results = await this.searchWithTimeout(query);

      // Cache the results
      this.cacheResults(query, results);

      return results;
    } catch (error) {
      logger.error("Autocomplete service error:", error);
      return [];
    }
  }

  private shouldSkipAutocomplete(query: string): boolean {
    // Don't autocomplete URLs
    if (MusicService.isUrl(query)) {
      return true;
    }

    // Don't autocomplete very short queries
    if (query.length < this.MIN_QUERY_LENGTH) {
      return true;
    }

    // Don't autocomplete if query is just whitespace
    if (!query.trim()) {
      return true;
    }

    return false;
  }

  private getCachedResults(query: string): SearchResult[] {
    const cacheKey = this.normalizeCacheKey(query);
    const cached = this.cache.get(cacheKey);

    if (cached && this.isCacheValid(cached)) {
      return cached.results;
    }

    // Remove expired cache entry
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return [];
  }

  private async searchWithTimeout(query: string): Promise<SearchResult[]> {
    try {
      logger.debug(`Searching autocomplete for: ${query}`);

      const searchPromise = MusicService.search(query, MusicPlatform.YOUTUBE, {
        limit: this.MAX_RESULTS,
      });

      const timeoutPromise = new Promise<VideoInfo[]>((_, reject) =>
        setTimeout(
          () => reject(new Error("Autocomplete search timeout")),
          this.SEARCH_TIMEOUT
        )
      );

      const searchResults = await Promise.race([searchPromise, timeoutPromise]);

      return this.formatSearchResults(searchResults, query);
    } catch (error) {
      logger.warn(`Autocomplete search failed for "${query}":`, error);
      return [];
    }
  }

  private formatSearchResults(
    results: VideoInfo[],
    originalQuery: string
  ): SearchResult[] {
    return results.map((result, index) => {
      // Create a display name
      let displayName = this.createDisplayName(result);

      // Truncate if too long (Discord limit is 100 characters)
      displayName = this.truncateDisplayName(displayName);

      // Create a unique value that we can parse later
      const value = this.createAutocompleteValue(originalQuery, index, result);

      return {
        name: displayName,
        value: value,
      };
    });
  }

  private createDisplayName(result: VideoInfo): string {
    let displayName = result.title;

    // Add artist if it's not already in the title
    if (result.artist && !this.isArtistInTitle(result.title, result.artist)) {
      displayName = `${result.artist} - ${result.title}`;
    }

    // Add duration if available
    if (result.duration) {
      const duration = MusicService.formatDuration(result.duration);
      displayName += ` (${duration})`;
    }

    return displayName;
  }

  private isArtistInTitle(title: string, artist: string): boolean {
    const titleLower = title.toLowerCase();
    const artistLower = artist.toLowerCase();
    return titleLower.includes(artistLower);
  }

  private truncateDisplayName(displayName: string): string {
    const maxLength = 97; // Leave room for ellipsis
    if (displayName.length > maxLength) {
      return displayName.substring(0, maxLength - 3) + "...";
    }
    return displayName;
  }

  private createAutocompleteValue(
    originalQuery: string,
    index: number,
    result: VideoInfo
  ): string {
    // Create a parseable value string
    // Format: originalQuery|||index|||title|||url|||platform
    return [
      originalQuery,
      index.toString(),
      result.title,
      result.url,
      result.platform,
    ].join("|||");
  }

  parseAutocompleteValue(value: string): {
    originalQuery: string;
    index: number;
    title: string;
    url: string;
    platform: string;
  } | null {
    try {
      const parts = value.split("|||");
      if (parts.length !== 5) {
        return null;
      }

      const [originalQuery, indexStr, title, url, platform] = parts;
      const index = parseInt(indexStr || "0");

      if (isNaN(index)) {
        return null;
      }

      return {
        originalQuery: originalQuery || "",
        index,
        title: title || "",
        url: url || "",
        platform: platform || "",
      };
    } catch (error) {
      logger.warn("Failed to parse autocomplete value:", value, error);
      return null;
    }
  }

  private cacheResults(query: string, results: SearchResult[]): void {
    const cacheKey = this.normalizeCacheKey(query);

    this.cache.set(cacheKey, {
      results,
      timestamp: Date.now(),
    });

    // Clean up old cache entries if needed
    this.cleanupCache();
  }

  private normalizeCacheKey(query: string): string {
    return query.toLowerCase().trim();
  }

  private isCacheValid(cached: CacheEntry): boolean {
    return Date.now() - cached.timestamp < this.CACHE_TTL;
  }

  private cleanupCache(): void {
    if (this.cache.size <= this.MAX_CACHE_SIZE) {
      return;
    }

    // Convert to array and sort by timestamp (newest first)
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);

    // Clear cache and keep only the most recent entries
    this.cache.clear();
    entries.slice(0, this.MAX_CACHE_SIZE).forEach(([key, value]) => {
      this.cache.set(key, value);
    });

    logger.debug(`Cleaned autocomplete cache, kept ${this.cache.size} entries`);
  }

  // Methods for monitoring and debugging
  getCacheStats(): {
    size: number;
    maxSize: number;
    ttl: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.CACHE_TTL,
    };
  }

  clearCache(): void {
    this.cache.clear();
    logger.info("Autocomplete cache cleared");
  }

  // For testing purposes
  getCacheSize(): number {
    return this.cache.size;
  }
}

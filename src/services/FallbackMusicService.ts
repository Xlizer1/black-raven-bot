import { MusicService } from "./MusicService";
import {
  MusicPlatform,
  type VideoInfo,
  type StreamInfo,
} from "./providers/IMusicProvider";
import { logger } from "../utils/logger";

interface CachedResult {
  data: VideoInfo | StreamInfo | VideoInfo[];
  timestamp: number;
  expiresAt: number;
}

interface FallbackSource {
  name: string;
  searchFunction: (query: string) => Promise<VideoInfo[]>;
  streamFunction?: (url: string) => Promise<StreamInfo | null>;
  priority: number;
  enabled: boolean;
}

export class FallbackMusicService {
  private static instance: FallbackMusicService;
  private cache = new Map<string, CachedResult>();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CACHE_SIZE = 1000;

  // Track YouTube availability
  private youtubeFailureCount = 0;
  private lastYouTubeSuccess = Date.now();
  private youtubeBlocked = false;
  private youtubeBlockedUntil = 0;

  // Fallback sources
  private fallbackSources: FallbackSource[] = [];

  private constructor() {
    this.initializeFallbackSources();
  }

  static getInstance(): FallbackMusicService {
    if (!FallbackMusicService.instance) {
      FallbackMusicService.instance = new FallbackMusicService();
    }
    return FallbackMusicService.instance;
  }

  private initializeFallbackSources(): void {
    // Generic search terms that work well for finding music
    this.fallbackSources = [
      {
        name: "Generic YouTube Search",
        searchFunction: this.genericYouTubeSearch.bind(this),
        priority: 1,
        enabled: true,
      },
      {
        name: "Artist-Only Search",
        searchFunction: this.artistOnlySearch.bind(this),
        priority: 2,
        enabled: true,
      },
      {
        name: "Simplified Search",
        searchFunction: this.simplifiedSearch.bind(this),
        priority: 3,
        enabled: true,
      },
    ];
  }

  async searchWithFallback(
    query: string,
    platform?: MusicPlatform,
    options?: any
  ): Promise<VideoInfo[]> {
    const cacheKey = `search:${query}:${platform || "default"}`;

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached && Array.isArray(cached)) {
      logger.debug("Returning cached search results");
      return cached;
    }

    // Try primary search first (if YouTube not blocked)
    if (!this.isYouTubeBlocked()) {
      try {
        const results = await MusicService.search(query, platform, options);
        if (results && results.length > 0) {
          this.recordYouTubeSuccess();
          this.cacheResult(cacheKey, results);
          return results;
        }
      } catch (error) {
        logger.warn("Primary search failed:", error);
        this.recordYouTubeFailure();
      }
    }

    // Try fallback sources
    logger.info("🔄 Attempting fallback search methods");

    for (const source of this.fallbackSources.filter((s) => s.enabled)) {
      try {
        logger.debug(`Trying fallback source: ${source.name}`);
        const results = await source.searchFunction(query);

        if (results && results.length > 0) {
          logger.info(`✅ Success with fallback source: ${source.name}`);
          this.cacheResult(cacheKey, results);
          return results;
        }
      } catch (error) {
        logger.warn(`Fallback source "${source.name}" failed:`, error);
        continue;
      }
    }

    // If all else fails, return cached results even if expired
    const expiredCache = this.getFromCache(cacheKey, true);
    if (expiredCache && Array.isArray(expiredCache)) {
      logger.warn("Returning expired cache due to all sources failing");
      return expiredCache;
    }

    logger.error("All search methods failed, returning empty results");
    return [];
  }

  async getStreamWithFallback(url: string): Promise<StreamInfo | null> {
    const cacheKey = `stream:${url}`;

    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached && !Array.isArray(cached)) {
      logger.debug("Returning cached stream info");
      return cached as StreamInfo;
    }

    // Try primary stream extraction
    if (!this.isYouTubeBlocked()) {
      try {
        const streamInfo = await MusicService.getStreamInfo(url);
        if (streamInfo) {
          this.recordYouTubeSuccess();
          this.cacheResult(cacheKey, streamInfo);
          return streamInfo;
        }
      } catch (error) {
        logger.warn("Primary stream extraction failed:", error);
        this.recordYouTubeFailure();
      }
    }

    // For stream extraction, we don't have good fallbacks
    // Return cached version if available
    const expiredCache = this.getFromCache(cacheKey, true);
    if (expiredCache && !Array.isArray(expiredCache)) {
      logger.warn("Returning expired stream cache due to extraction failure");
      return expiredCache as StreamInfo;
    }

    return null;
  }

  // Fallback search implementations
  private async genericYouTubeSearch(query: string): Promise<VideoInfo[]> {
    // Remove specific terms that might trigger bot detection
    const cleanQuery = query
      .replace(/\b(official|video|music|audio|hd|hq)\b/gi, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanQuery) {
      throw new Error("Query too short after cleaning");
    }

    logger.debug(`Generic search with cleaned query: "${cleanQuery}"`);
    return await this.searchWithMinimalCommands(cleanQuery);
  }

  private async artistOnlySearch(query: string): Promise<VideoInfo[]> {
    // Extract potential artist name (first part before common separators)
    const artistMatch = query.match(/^([^-–—]+)(?:\s*[-–—]\s*.*)?$/);
    if (!artistMatch || !artistMatch[1]) {
      throw new Error("Could not extract artist name");
    }

    const artist = artistMatch[1].trim();
    logger.debug(`Artist-only search for: "${artist}"`);
    return await this.searchWithMinimalCommands(artist);
  }

  private async simplifiedSearch(query: string): Promise<VideoInfo[]> {
    // Use only the most important words
    const words = query.toLowerCase().split(/\s+/);
    const importantWords = words.filter(
      (word) =>
        word.length > 2 &&
        !["the", "and", "but", "for", "with", "from"].includes(word)
    );

    const simplifiedQuery = importantWords.slice(0, 3).join(" ");

    if (!simplifiedQuery) {
      throw new Error("No important words found");
    }

    logger.debug(`Simplified search: "${simplifiedQuery}"`);
    return await this.searchWithMinimalCommands(simplifiedQuery);
  }

  private async searchWithMinimalCommands(query: string): Promise<VideoInfo[]> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Ultra-minimal yt-dlp command
    const command = `yt-dlp "ytsearch3:${query}" --dump-json --quiet --no-warnings --socket-timeout 15 --retries 1`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: 20000,
        maxBuffer: 1024 * 1024 * 2,
      });

      const lines = stdout.trim().split("\n");
      const results: VideoInfo[] = [];

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            results.push({
              id: data.id || "unknown",
              title: data.title || "Unknown",
              url: data.webpage_url || data.url || "",
              duration: data.duration,
              thumbnail: data.thumbnail,
              platform: MusicPlatform.YOUTUBE,
              artist: data.uploader,
              album: undefined,
            });
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      return results;
    } catch (error) {
      logger.debug("Minimal command search failed:", error);
      throw error;
    }
  }

  // YouTube availability tracking
  private recordYouTubeSuccess(): void {
    this.youtubeFailureCount = 0;
    this.lastYouTubeSuccess = Date.now();
    this.youtubeBlocked = false;
    this.youtubeBlockedUntil = 0;
  }

  private recordYouTubeFailure(): void {
    this.youtubeFailureCount++;

    // Block YouTube temporarily after 3 consecutive failures
    if (this.youtubeFailureCount >= 3) {
      this.youtubeBlocked = true;
      this.youtubeBlockedUntil = Date.now() + 10 * 60 * 1000; // 10 minute block
      logger.warn("🚫 YouTube temporarily blocked due to consecutive failures");
    }
  }

  private isYouTubeBlocked(): boolean {
    if (!this.youtubeBlocked) return false;

    if (Date.now() > this.youtubeBlockedUntil) {
      this.youtubeBlocked = false;
      this.youtubeBlockedUntil = 0;
      this.youtubeFailureCount = 0;
      logger.info("✅ YouTube block lifted");
      return false;
    }

    return true;
  }

  // Cache management
  private cacheResult(
    key: string,
    data: VideoInfo[] | VideoInfo | StreamInfo
  ): void {
    // Clean cache if too large
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.cleanCache();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.CACHE_DURATION,
    });
  }

  private getFromCache(
    key: string,
    allowExpired: boolean = false
  ): VideoInfo[] | VideoInfo | StreamInfo | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (!allowExpired && Date.now() > cached.expiresAt) {
      return null;
    }

    return cached.data;
  }

  private cleanCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        toDelete.push(key);
      }
    }

    // Delete expired entries
    toDelete.forEach((key) => this.cache.delete(key));

    // If still too large, delete oldest entries
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );

      const toRemove = entries.slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.3));
      toRemove.forEach(([key]) => this.cache.delete(key));
    }

    logger.debug(`Cache cleaned. Size: ${this.cache.size}`);
  }

  // Public status methods
  getStatus(): {
    youtubeBlocked: boolean;
    youtubeFailureCount: number;
    cacheSize: number;
    lastSuccess: string;
  } {
    return {
      youtubeBlocked: this.youtubeBlocked,
      youtubeFailureCount: this.youtubeFailureCount,
      cacheSize: this.cache.size,
      lastSuccess: new Date(this.lastYouTubeSuccess).toISOString(),
    };
  }

  clearCache(): void {
    this.cache.clear();
    logger.info("Fallback service cache cleared");
  }

  resetYouTubeStatus(): void {
    this.youtubeBlocked = false;
    this.youtubeBlockedUntil = 0;
    this.youtubeFailureCount = 0;
    logger.info("YouTube status reset");
  }
}

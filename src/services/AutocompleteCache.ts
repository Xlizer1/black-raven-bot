// src/services/AutocompleteCache.ts

import { logger } from "../utils/logger";
import type { VideoInfo } from "./providers/IMusicProvider";

interface CacheEntry {
  results: VideoInfo[];
  timestamp: number;
}

export class AutocompleteCache {
  private static instance: AutocompleteCache;
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 100;

  private constructor() {
    // Clean cache every 5 minutes
    setInterval(() => this.cleanExpiredEntries(), this.CACHE_TTL);
  }

  static getInstance(): AutocompleteCache {
    if (!AutocompleteCache.instance) {
      AutocompleteCache.instance = new AutocompleteCache();
    }
    return AutocompleteCache.instance;
  }

  get(query: string, platform: string): VideoInfo[] | null {
    const key = this.createKey(query, platform);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit for: ${query} (${platform})`);
    return entry.results;
  }

  set(query: string, platform: string, results: VideoInfo[]): void {
    const key = this.createKey(query, platform);

    // Don't cache empty results
    if (results.length === 0) return;

    // Remove oldest entries if cache is full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      results,
      timestamp: Date.now(),
    });

    logger.debug(
      `Cached results for: ${query} (${platform}) - ${results.length} items`
    );
  }

  private createKey(query: string, platform: string): string {
    return `${platform}:${query.toLowerCase().trim()}`;
  }

  private cleanExpiredEntries(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Cleaned ${removed} expired cache entries`);
    }
  }

  clear(): void {
    this.cache.clear();
    logger.info("Autocomplete cache cleared");
  }

  size(): number {
    return this.cache.size;
  }
}

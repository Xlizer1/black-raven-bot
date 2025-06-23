import { MusicService } from "./MusicService";
import { MusicQueue } from "./MusicQueue";
import { MusicPlatform, type VideoInfo } from "./providers/IMusicProvider";
import { logger } from "../utils/logger";

interface AutoPlaySettings {
  enabled: boolean;
  minQueueSize: number;
  maxSongsToAdd: number;
  platform: MusicPlatform;
  similarityThreshold: number;
}

interface SongAnalysis {
  genres: string[];
  mood: string;
  tempo: "slow" | "medium" | "fast";
  energy: "low" | "medium" | "high";
}

interface RecommendationSource {
  type: "artist" | "genre" | "mood" | "similar";
  value: string;
  weight: number;
}

export class AutoPlayService {
  private static instance: AutoPlayService;
  private settings: Map<string, AutoPlaySettings> = new Map();
  private recentlyPlayed: Map<string, string[]> = new Map(); // guildId -> songIds
  private songAnalysis: Map<string, SongAnalysis> = new Map(); // songId -> analysis
  private isProcessing: Map<string, boolean> = new Map(); // guildId -> processing state

  private constructor() {
    // Initialize with default settings
  }

  static getInstance(): AutoPlayService {
    if (!AutoPlayService.instance) {
      AutoPlayService.instance = new AutoPlayService();
    }
    return AutoPlayService.instance;
  }

  // Settings management
  enableAutoPlay(guildId: string, settings?: Partial<AutoPlaySettings>): void {
    const defaultSettings: AutoPlaySettings = {
      enabled: true,
      minQueueSize: 2,
      maxSongsToAdd: 5,
      platform: MusicPlatform.YOUTUBE,
      similarityThreshold: 0.7,
    };

    this.settings.set(guildId, {
      ...defaultSettings,
      ...settings,
    });

    logger.info(`AutoPlay enabled for guild: ${guildId}`);
  }

  disableAutoPlay(guildId: string): void {
    const currentSettings = this.settings.get(guildId);
    if (currentSettings) {
      this.settings.set(guildId, {
        ...currentSettings,
        enabled: false,
      });
    }

    logger.info(`AutoPlay disabled for guild: ${guildId}`);
  }

  isEnabled(guildId: string): boolean {
    const settings = this.settings.get(guildId);
    return settings?.enabled ?? false;
  }

  getSettings(guildId: string): AutoPlaySettings | null {
    return this.settings.get(guildId) ?? null;
  }

  updateSettings(
    guildId: string,
    newSettings: Partial<AutoPlaySettings>
  ): void {
    const currentSettings = this.settings.get(guildId);
    if (currentSettings) {
      this.settings.set(guildId, {
        ...currentSettings,
        ...newSettings,
      });
    }
  }

  // Main autoplay logic
  async checkAndAddSongs(guildId: string): Promise<void> {
    try {
      if (this.isProcessing.get(guildId)) {
        return; // Already processing
      }

      const settings = this.settings.get(guildId);
      if (!settings?.enabled) {
        return;
      }

      const queue = MusicQueue.getQueue(guildId);
      const queueSize = queue.size();
      const currentSong = queue.getCurrentSong();

      // Check if we need to add songs
      if (queueSize >= settings.minQueueSize) {
        return;
      }

      if (!currentSong) {
        return; // No current song to base recommendations on
      }

      this.isProcessing.set(guildId, true);

      try {
        // Generate recommendations
        const recommendations = await this.generateRecommendations(
          guildId,
          currentSong,
          settings
        );

        // Add recommendations to queue
        let addedCount = 0;
        for (const song of recommendations) {
          if (addedCount >= settings.maxSongsToAdd) {
            break;
          }

          try {
            queue.add({
              ...song,
              requestedBy: "autoplay",
            });
            addedCount++;

            // Track recently played
            this.addToRecentlyPlayed(guildId, song.id);
          } catch (error) {
            logger.warn(`Failed to add autoplay song: ${song.title}`, error);
          }
        }

        if (addedCount > 0) {
          logger.info(
            `AutoPlay added ${addedCount} songs to queue in guild: ${guildId}`
          );
        }
      } finally {
        this.isProcessing.set(guildId, false);
      }
    } catch (error) {
      logger.error("Error in autoplay check:", error);
      this.isProcessing.set(guildId, false);
    }
  }

  // Recommendation generation
  private async generateRecommendations(
    guildId: string,
    baseSong: VideoInfo,
    settings: AutoPlaySettings
  ): Promise<VideoInfo[]> {
    try {
      const sources = await this.getRecommendationSources(guildId, baseSong);
      const allCandidates: VideoInfo[] = [];

      // Search for each recommendation source
      for (const source of sources) {
        try {
          const candidates = await this.searchBySource(
            source,
            settings.platform
          );
          allCandidates.push(...candidates);
        } catch (error) {
          logger.warn(`Failed to search by source: ${source.type}`, error);
        }
      }

      // Filter and rank candidates
      const filtered = this.filterCandidates(guildId, allCandidates, baseSong);
      const ranked = this.rankCandidates(filtered, sources);

      return ranked.slice(0, settings.maxSongsToAdd);
    } catch (error) {
      logger.error("Error generating recommendations:", error);
      return [];
    }
  }

  private async getRecommendationSources(
    guildId: string,
    baseSong: VideoInfo
  ): Promise<RecommendationSource[]> {
    const sources: RecommendationSource[] = [];

    // Add artist-based recommendations
    if (baseSong.artist) {
      sources.push({
        type: "artist",
        value: baseSong.artist,
        weight: 0.8,
      });

      // Add similar artists
      const similarArtists = await this.getSimilarArtists(baseSong.artist);
      for (const artist of similarArtists) {
        sources.push({
          type: "artist",
          value: artist,
          weight: 0.6,
        });
      }
    }

    // Add genre-based recommendations
    const genres = await this.extractGenres(baseSong);
    for (const genre of genres) {
      sources.push({
        type: "genre",
        value: genre,
        weight: 0.5,
      });
    }

    // Add mood-based recommendations
    const mood = await this.analyzeMood(baseSong);
    if (mood) {
      sources.push({
        type: "mood",
        value: mood,
        weight: 0.4,
      });
    }

    // Add similar song recommendations
    sources.push({
      type: "similar",
      value: `${baseSong.artist || ""} ${baseSong.title}`.trim(),
      weight: 0.7,
    });

    return sources;
  }

  private async searchBySource(
    source: RecommendationSource,
    platform: MusicPlatform
  ): Promise<VideoInfo[]> {
    let searchQuery = "";

    switch (source.type) {
      case "artist":
        searchQuery = source.value;
        break;
      case "genre":
        searchQuery = `${source.value} music`;
        break;
      case "mood":
        searchQuery = `${source.value} songs`;
        break;
      case "similar":
        searchQuery = `similar to ${source.value}`;
        break;
    }

    try {
      const results = await MusicService.search(searchQuery, platform, {
        limit: 5,
      });

      return results;
    } catch (error) {
      logger.warn(`Search failed for source: ${source.type}`, error);
      return [];
    }
  }

  private filterCandidates(
    guildId: string,
    candidates: VideoInfo[],
    baseSong: VideoInfo
  ): VideoInfo[] {
    const recentlyPlayed = this.recentlyPlayed.get(guildId) || [];

    return candidates.filter((song) => {
      // Filter out recently played songs
      if (recentlyPlayed.includes(song.id)) {
        return false;
      }

      // Filter out the current song
      if (song.id === baseSong.id) {
        return false;
      }

      // Filter out duplicates within candidates
      const duplicateIndex = candidates.findIndex(
        (existing, index) =>
          existing.id === song.id && candidates.indexOf(song) !== index
      );
      if (duplicateIndex !== -1 && duplicateIndex < candidates.indexOf(song)) {
        return false;
      }

      // Filter by duration (avoid very long or very short tracks)
      if (song.duration) {
        if (song.duration < 30 || song.duration > 600) {
          // 30s to 10min
          return false;
        }
      }

      return true;
    });
  }

  private rankCandidates(
    candidates: VideoInfo[],
    sources: RecommendationSource[]
  ): VideoInfo[] {
    // Simple ranking based on source weights
    const ranked = candidates.map((song) => {
      let score = 0;

      // Calculate score based on matching sources
      for (const source of sources) {
        if (this.songMatchesSource(song, source)) {
          score += source.weight;
        }
      }

      return { song, score };
    });

    // Sort by score and return songs
    return ranked.sort((a, b) => b.score - a.score).map((item) => item.song);
  }

  private songMatchesSource(
    song: VideoInfo,
    source: RecommendationSource
  ): boolean {
    const songText = `${song.title} ${song.artist || ""}`.toLowerCase();
    const sourceValue = source.value.toLowerCase();

    switch (source.type) {
      case "artist":
        return song.artist?.toLowerCase().includes(sourceValue) || false;
      case "genre":
      case "mood":
      case "similar":
        return songText.includes(sourceValue);
      default:
        return false;
    }
  }

  // Helper methods for music analysis
  private async getSimilarArtists(artist: string): Promise<string[]> {
    // This is a simplified implementation
    // In a real implementation, you'd use a music database API
    const similarMap: Record<string, string[]> = {
      // Example mappings - replace with real data
      "ed sheeran": ["taylor swift", "john mayer", "james blunt"],
      "taylor swift": ["ed sheeran", "ariana grande", "billie eilish"],
      eminem: ["50 cent", "dr. dre", "snoop dogg"],
    };

    const artistLower = artist.toLowerCase();
    return similarMap[artistLower] || [];
  }

  private async extractGenres(song: VideoInfo): Promise<string[]> {
    // Simplified genre extraction based on title/artist keywords
    const text = `${song.title} ${song.artist || ""}`.toLowerCase();
    const genres: string[] = [];

    const genreKeywords = {
      rock: ["rock", "metal", "punk", "alternative"],
      pop: ["pop", "chart", "hit", "mainstream"],
      electronic: ["electronic", "edm", "house", "techno", "dubstep"],
      hip_hop: ["hip hop", "rap", "hip-hop", "trap"],
      classical: ["classical", "orchestra", "symphony", "piano"],
      jazz: ["jazz", "blues", "swing"],
    };

    for (const [genre, keywords] of Object.entries(genreKeywords)) {
      if (keywords.some((keyword) => text.includes(keyword))) {
        genres.push(genre);
      }
    }

    return genres;
  }

  private async analyzeMood(song: VideoInfo): Promise<string | null> {
    // Simplified mood analysis based on title keywords
    const title = song.title.toLowerCase();

    const moodKeywords = {
      happy: ["happy", "joy", "celebration", "party", "fun", "upbeat"],
      sad: ["sad", "cry", "tears", "broken", "lonely", "depressed"],
      energetic: ["energy", "power", "strong", "fast", "intense"],
      calm: ["calm", "peaceful", "relax", "chill", "soft", "quiet"],
      romantic: ["love", "heart", "romance", "valentine", "kiss"],
    };

    for (const [mood, keywords] of Object.entries(moodKeywords)) {
      if (keywords.some((keyword) => title.includes(keyword))) {
        return mood;
      }
    }

    return null;
  }

  // Recently played tracking
  private addToRecentlyPlayed(guildId: string, songId: string): void {
    if (!this.recentlyPlayed.has(guildId)) {
      this.recentlyPlayed.set(guildId, []);
    }

    const recent = this.recentlyPlayed.get(guildId);
    if (recent) {
      recent.unshift(songId);
      // Keep only last 50 songs
      if (recent.length > 50) {
        recent.splice(50);
      }
    }
  }

  // Cleanup methods
  clearGuildData(guildId: string): void {
    this.settings.delete(guildId);
    this.recentlyPlayed.delete(guildId);
    this.isProcessing.delete(guildId);

    // Clear song analysis for this guild's songs
    // Note: This is simplified - in a real implementation you'd track which
    // songs belong to which guilds

    logger.info(`Cleared autoplay data for guild: ${guildId}`);
  }

  getStats(guildId: string): {
    enabled: boolean;
    songsInHistory: number;
    isProcessing: boolean;
    settings: AutoPlaySettings | null;
  } {
    const settings = this.settings.get(guildId);
    const recent = this.recentlyPlayed.get(guildId);
    const processing = this.isProcessing.get(guildId) || false;

    return {
      enabled: settings?.enabled ?? false,
      songsInHistory: recent?.length ?? 0,
      isProcessing: processing,
      settings: settings ?? null,
    };
  }
}

import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  MusicPlatform,
  type SearchOptions,
} from "./IMusicProvider";
import { YouTubeProvider } from "./YouTubeProvider";
import { botConfig } from "../../config/config";
import { logger } from "../../utils/logger";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
  duration_ms: number;
  external_urls: {
    spotify: string;
  };
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: {
    total: number;
    items: Array<{
      track: SpotifyTrack;
    }>;
  };
  external_urls: {
    spotify: string;
  };
  images: Array<{ url: string }>;
}

interface SpotifySearchResponse {
  tracks: {
    items: SpotifyTrack[];
  };
}

interface SpotifyAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class SpotifyProvider implements IMusicProvider {
  readonly platform = MusicPlatform.SPOTIFY;

  private static readonly URL_REGEX =
    /^https:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/;

  private static readonly PLAYLIST_REGEX =
    /^https:\/\/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/;

  private static readonly BASE_URL = "https://api.spotify.com/v1";
  private static readonly AUTH_URL = "https://accounts.spotify.com/api/token";

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private youtubeProvider: YouTubeProvider;

  // Enhanced retry and fallback mechanisms
  private conversionCache = new Map<string, VideoInfo | null>();
  private failedConversions = new Set<string>();

  constructor() {
    this.youtubeProvider = new YouTubeProvider();
  }

  validateUrl(url: string): boolean {
    return SpotifyProvider.URL_REGEX.test(url);
  }

  isPlaylistUrl(url: string): boolean {
    return SpotifyProvider.PLAYLIST_REGEX.test(url);
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<VideoInfo[]> {
    try {
      if (!this.isConfigured()) {
        logger.warn(
          "Spotify API not configured, falling back to YouTube search"
        );
        return this.youtubeProvider.search(query, options);
      }

      await this.ensureAuthenticated();

      const limit = Math.min(options.limit || 10, 50);
      const type = options.type || "track";

      const searchUrl = new URL(`${SpotifyProvider.BASE_URL}/search`);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("type", type);
      searchUrl.searchParams.set("limit", limit.toString());

      const response = await fetch(searchUrl.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        logger.error(
          `Spotify search failed: ${response.status} ${response.statusText}`
        );
        return this.youtubeProvider.search(query, options);
      }

      const data = (await response.json()) as SpotifySearchResponse;
      const tracks = data.tracks?.items || [];

      const results: VideoInfo[] = [];
      for (const track of tracks) {
        results.push(this.convertSpotifyTrackToVideoInfo(track));
      }

      return results;
    } catch (error) {
      logger.error("Spotify search error:", error);
      return this.youtubeProvider.search(query, options);
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    try {
      // Get Spotify track info first
      const trackInfo = await this.getTrackInfo(url);
      if (!trackInfo) {
        return null;
      }

      // Try to convert to YouTube stream with enhanced fallback
      return this.convertToYouTubeStreamWithFallback(trackInfo);
    } catch (error) {
      logger.error("Spotify stream conversion error:", error);
      return null;
    }
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    try {
      const trackId = this.extractTrackId(url);
      if (!trackId) {
        logger.error("Could not extract track ID from Spotify URL:", url);
        return null;
      }

      if (!this.isConfigured()) {
        logger.warn("Spotify API not configured, cannot get track info");
        return null;
      }

      await this.ensureAuthenticated();

      const response = await fetch(
        `${SpotifyProvider.BASE_URL}/tracks/${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        logger.error(
          `Spotify track info failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const track = (await response.json()) as SpotifyTrack;
      return this.convertSpotifyTrackToVideoInfo(track);
    } catch (error) {
      logger.error("Spotify track info error:", error);
      return null;
    }
  }

  async getPlaylistInfo(url: string): Promise<{
    title: string;
    songCount: number;
    description?: string;
  } | null> {
    try {
      const playlistId = this.extractPlaylistId(url);
      if (!playlistId) {
        logger.error("Could not extract playlist ID from Spotify URL:", url);
        return null;
      }

      if (!this.isConfigured()) {
        logger.warn("Spotify API not configured, cannot get playlist info");
        return null;
      }

      await this.ensureAuthenticated();

      const response = await fetch(
        `${SpotifyProvider.BASE_URL}/playlists/${playlistId}?fields=name,description,tracks.total`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        logger.error(
          `Spotify playlist info failed: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const playlist: any = await response.json();
      return {
        title: playlist.name || "Unknown Playlist",
        songCount: playlist.tracks?.total || 0,
        description: playlist.description || undefined,
      };
    } catch (error) {
      logger.error("Spotify playlist info error:", error);
      return null;
    }
  }

  async loadPlaylistSongs(
    url: string,
    limit: number = 50
  ): Promise<VideoInfo[]> {
    try {
      const playlistId = this.extractPlaylistId(url);
      if (!playlistId) {
        logger.error("Could not extract playlist ID from Spotify URL:", url);
        return [];
      }

      if (!this.isConfigured()) {
        logger.warn("Spotify API not configured, cannot load playlist");
        return [];
      }

      await this.ensureAuthenticated();

      const results: VideoInfo[] = [];
      let offset = 0;
      const batchSize = 50; // Spotify API limit per request

      while (results.length < limit) {
        const currentLimit = Math.min(batchSize, limit - results.length);

        const response = await fetch(
          `${SpotifyProvider.BASE_URL}/playlists/${playlistId}/tracks?limit=${currentLimit}&offset=${offset}&fields=items.track(id,name,artists,album,duration_ms,external_urls)`,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
            },
          }
        );

        if (!response.ok) {
          logger.error(
            `Spotify playlist tracks failed: ${response.status} ${response.statusText}`
          );
          break;
        }

        const data: any = await response.json();
        const tracks = data.items || [];

        if (tracks.length === 0) {
          break; // No more tracks
        }

        for (const item of tracks) {
          if (item.track && results.length < limit) {
            try {
              const videoInfo = this.convertSpotifyTrackToVideoInfo(item.track);
              results.push(videoInfo);
            } catch (error) {
              logger.warn(
                `Failed to convert track: ${item.track?.name}`,
                error
              );
            }
          }
        }

        offset += tracks.length;

        if (tracks.length < currentLimit) {
          break;
        }
      }

      logger.info(`Loaded ${results.length} tracks from Spotify playlist`);
      return results;
    } catch (error) {
      logger.error("Spotify playlist loading error:", error);
      return [];
    }
  }

  supportsPlaylists(): boolean {
    return true;
  }

  supportsDirectStreaming(): boolean {
    return false; // Always requires YouTube conversion
  }

  // Enhanced private helper methods

  private isConfigured(): boolean {
    return !!(botConfig.spotify.clientId && botConfig.spotify.clientSecret);
  }

  private async ensureAuthenticated(): Promise<void> {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiry) {
      return; // Token is still valid
    }

    try {
      const response = await fetch(SpotifyProvider.AUTH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${botConfig.spotify.clientId}:${botConfig.spotify.clientSecret}`
          ).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
      });

      if (!response.ok) {
        throw new Error(
          `Spotify auth failed: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as SpotifyAuthResponse;
      this.accessToken = data.access_token;
      this.tokenExpiry = now + data.expires_in * 1000 - 60000; // 1 minute buffer

      logger.info("Spotify authentication successful");
    } catch (error) {
      logger.error("Spotify authentication error:", error);
      throw error;
    }
  }

  private extractTrackId(url: string): string | null {
    const match = url.match(SpotifyProvider.URL_REGEX);
    if (match && match[1] === "track" && match[2]) {
      return match[2];
    }
    return null;
  }

  private extractPlaylistId(url: string): string | null {
    const match = url.match(SpotifyProvider.PLAYLIST_REGEX);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  private convertSpotifyTrackToVideoInfo(track: SpotifyTrack): VideoInfo {
    const artists = track.artists.map((artist) => artist.name).join(", ");
    const thumbnail = track.album.images[0]?.url;

    return {
      id: track.id,
      title: track.name,
      url: track.external_urls.spotify,
      duration: Math.floor(track.duration_ms / 1000),
      thumbnail,
      platform: this.platform,
      artist: artists,
      album: track.album.name,
    };
  }

  private async convertToYouTubeStreamWithFallback(
    spotifyTrack: VideoInfo
  ): Promise<StreamInfo | null> {
    const cacheKey = `${spotifyTrack.artist}-${spotifyTrack.title}`;

    // Check if we've already failed to convert this track
    if (this.failedConversions.has(cacheKey)) {
      logger.debug(`Skipping previously failed conversion: ${cacheKey}`);
      return null;
    }

    // Check cache first
    if (this.conversionCache.has(cacheKey)) {
      const cached = this.conversionCache.get(cacheKey);
      if (cached) {
        return this.youtubeProvider.getStreamInfo(cached.url);
      }
      return null;
    }

    try {
      // Try multiple search variations
      const searchQueries = this.generateSearchQueries(spotifyTrack);

      for (const [queryType, searchQuery] of searchQueries) {
        try {
          logger.debug(`Trying ${queryType}: ${searchQuery}`);

          const youtubeResults = await this.youtubeProvider.search(
            searchQuery,
            {
              limit: 3, // Get multiple results to find best match
            }
          );

          if (youtubeResults.length === 0) {
            logger.debug(`No results for ${queryType}`);
            continue;
          }

          // Find the best match based on title similarity and duration
          const bestMatch = this.findBestMatch(spotifyTrack, youtubeResults);

          if (bestMatch) {
            logger.info(`✅ Found match via ${queryType}: ${bestMatch.title}`);

            // Cache the successful conversion
            this.conversionCache.set(cacheKey, bestMatch);

            // Get stream info
            const streamInfo = await this.youtubeProvider.getStreamInfo(
              bestMatch.url
            );

            if (streamInfo) {
              return {
                ...streamInfo,
                title: `${spotifyTrack.title} (via Spotify)`,
                platform: this.platform,
              };
            }
          }
        } catch (error: any) {
          logger.debug(
            `Search variation "${queryType}" failed:`,
            error.message || error
          );
          continue;
        }
      }

      // All search variations failed
      logger.warn(`❌ All search variations failed for: ${spotifyTrack.title}`);
      this.failedConversions.add(cacheKey);
      this.conversionCache.set(cacheKey, null);

      return null;
    } catch (error) {
      logger.error("YouTube conversion error:", error);
      this.failedConversions.add(cacheKey);
      return null;
    }
  }

  private generateSearchQueries(track: VideoInfo): Array<[string, string]> {
    const artist = track.artist || "";
    const title = track.title;
    const cleanTitle = this.cleanTitle(title);
    const cleanArtist = this.cleanArtist(artist);

    const queries: Array<[string, string]> = [];

    // 1. Exact artist + title
    if (cleanArtist && cleanTitle) {
      queries.push(["exact", `${cleanArtist} ${cleanTitle}`]);
    }

    // 2. Title + artist (reversed order)
    if (cleanArtist && cleanTitle) {
      queries.push(["reversed", `${cleanTitle} ${cleanArtist}`]);
    }

    // 3. Title only
    if (cleanTitle) {
      queries.push(["title-only", cleanTitle]);
    }

    // 4. Artist + title + "official"
    if (cleanArtist && cleanTitle) {
      queries.push(["official", `${cleanArtist} ${cleanTitle} official`]);
    }

    // 5. Artist + title + "music video"
    if (cleanArtist && cleanTitle) {
      queries.push(["music-video", `${cleanArtist} ${cleanTitle} music video`]);
    }

    // 6. Artist + title + "audio"
    if (cleanArtist && cleanTitle) {
      queries.push(["audio", `${cleanArtist} ${cleanTitle} audio`]);
    }

    // 7. Title with quotes (exact match attempt)
    if (cleanTitle.length > 3) {
      queries.push(["quoted", `"${cleanTitle}"`]);
    }

    return queries;
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/\s*\(feat\..*?\)/gi, "") // Remove featuring
      .replace(/\s*\[.*?\]/g, "") // Remove bracketed content
      .replace(/\s*\(.*?\)/g, "") // Remove parenthetical content
      .replace(/\s+/g, " ") // Normalize spaces
      .trim();
  }

  private cleanArtist(artist: string): string {
    // Take first artist if multiple
    const firstArtist = artist.split(",")[0] || artist.split("&")[0] || artist;
    return firstArtist.trim();
  }

  private findBestMatch(
    spotifyTrack: VideoInfo,
    youtubeResults: VideoInfo[]
  ): VideoInfo | null {
    if (youtubeResults.length === 0) return null;

    let bestMatch = youtubeResults[0] || null;
    let bestScore = 0;

    for (const result of youtubeResults) {
      const score = this.calculateSimilarityScore(spotifyTrack, result);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // Only return if the match is reasonably good
    return bestScore > 0.3 ? bestMatch : youtubeResults[0] || null;
  }

  private calculateSimilarityScore(
    spotifyTrack: VideoInfo,
    youtubeResult: VideoInfo
  ): number {
    let score = 0;

    // Title similarity (most important)
    const titleSimilarity = this.stringSimilarity(
      spotifyTrack.title.toLowerCase(),
      youtubeResult.title.toLowerCase()
    );
    score += titleSimilarity * 0.6;

    // Artist similarity
    if (spotifyTrack.artist && youtubeResult.artist) {
      const artistSimilarity = this.stringSimilarity(
        spotifyTrack.artist.toLowerCase(),
        youtubeResult.artist.toLowerCase()
      );
      score += artistSimilarity * 0.3;
    }

    // Duration similarity (if available)
    if (spotifyTrack.duration && youtubeResult.duration) {
      const durationDiff = Math.abs(
        spotifyTrack.duration - youtubeResult.duration
      );
      const durationSimilarity = Math.max(0, 1 - durationDiff / 60); // Penalize >60s difference
      score += durationSimilarity * 0.1;
    }

    return score;
  }

  private stringSimilarity(str1: string, str2: string): number {
    // Simple similarity calculation based on common words
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);

    let commonWords = 0;
    for (const word1 of words1) {
      if (
        word1.length > 2 &&
        words2.some((word2) => word2.includes(word1) || word1.includes(word2))
      ) {
        commonWords++;
      }
    }

    return commonWords / Math.max(words1.length, words2.length);
  }
}

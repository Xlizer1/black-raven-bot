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

  private static readonly BASE_URL = "https://api.spotify.com/v1";
  private static readonly AUTH_URL = "https://accounts.spotify.com/api/token";

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private youtubeProvider: YouTubeProvider;

  constructor() {
    this.youtubeProvider = new YouTubeProvider();
  }

  validateUrl(url: string): boolean {
    return SpotifyProvider.URL_REGEX.test(url);
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
      // Fallback to YouTube
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

      // Convert to YouTube and get stream
      return this.convertToYouTubeStream(trackInfo);
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

  supportsPlaylists(): boolean {
    return true;
  }

  supportsDirectStreaming(): boolean {
    return false; // Always requires YouTube conversion
  }

  // Private helper methods

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

  private async convertToYouTubeStream(
    spotifyTrack: VideoInfo
  ): Promise<StreamInfo | null> {
    try {
      // Create search query from Spotify track info
      const searchQuery = this.createYouTubeSearchQuery(spotifyTrack);
      logger.info(`Converting Spotify track to YouTube: ${searchQuery}`);

      // Search YouTube for equivalent
      const youtubeResults = await this.youtubeProvider.search(searchQuery, {
        limit: 1,
      });

      if (youtubeResults.length === 0 || !youtubeResults[0]) {
        logger.warn(`No YouTube equivalent found for: ${spotifyTrack.title}`);
        return null;
      }

      const youtubeTrack = youtubeResults[0];

      // Verify it's a reasonable match (basic heuristic)
      if (!this.isReasonableMatch(spotifyTrack, youtubeTrack)) {
        logger.warn(`YouTube match quality low for: ${spotifyTrack.title}`);
        // Still proceed but log the warning
      }

      // Get stream info from YouTube
      const streamInfo = await this.youtubeProvider.getStreamInfo(
        youtubeTrack.url
      );

      if (streamInfo) {
        // Update the title to reflect it's from Spotify originally
        return {
          ...streamInfo,
          title: `${spotifyTrack.title} (via Spotify)`,
          platform: this.platform, // Keep as Spotify platform for UI purposes
        };
      }

      return null;
    } catch (error) {
      logger.error("YouTube conversion error:", error);
      return null;
    }
  }

  private createYouTubeSearchQuery(track: VideoInfo): string {
    // Create a search query optimized for finding the track on YouTube
    const artist = track.artist || "";
    const title = track.title;

    // Basic cleanup of common Spotify artifacts
    const cleanTitle = title
      .replace(/\s*\(feat\..*?\)/gi, "") // Remove featuring info
      .replace(/\s*\[.*?\]/g, "") // Remove bracketed info
      .trim();

    if (artist) {
      return `${artist} ${cleanTitle}`;
    }

    return cleanTitle;
  }

  private isReasonableMatch(
    spotifyTrack: VideoInfo,
    youtubeTrack: VideoInfo
  ): boolean {
    const spotifyTitle = spotifyTrack.title.toLowerCase();
    const youtubeTitle = youtubeTrack.title.toLowerCase();
    const spotifyArtist = (spotifyTrack.artist || "").toLowerCase();

    // Check if YouTube title contains main elements from Spotify
    const titleMatch = youtubeTitle.includes(
      spotifyTitle.substring(0, Math.min(spotifyTitle.length, 20))
    );
    const artistMatch = spotifyArtist
      ? youtubeTitle.includes(spotifyArtist.split(",")[0]?.trim() || "")
      : true;

    // Duration check (within 30 seconds)
    const durationMatch =
      !spotifyTrack.duration ||
      !youtubeTrack.duration ||
      Math.abs(spotifyTrack.duration - youtubeTrack.duration) <= 30;

    return titleMatch && artistMatch && durationMatch;
  }

  async searchForAutocomplete(
    query: string,
    limit: number = 10
  ): Promise<VideoInfo[]> {
    try {
      if (!this.isConfigured()) {
        return [];
      }

      await this.ensureAuthenticated();

      const searchUrl = new URL(`${SpotifyProvider.BASE_URL}/search`);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("type", "track");
      searchUrl.searchParams.set("limit", Math.min(limit, 20).toString());

      const response = await fetch(searchUrl.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        signal: AbortSignal.timeout(2000), // 2 second timeout for autocomplete
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as SpotifySearchResponse;
      const tracks = data.tracks?.items || [];

      return tracks
        .slice(0, limit)
        .map((track) => this.convertSpotifyTrackToVideoInfo(track));
    } catch (error) {
      logger.warn("Spotify autocomplete search error:", error);
      return [];
    }
  }
}

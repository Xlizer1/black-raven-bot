import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  MusicPlatform,
  type SearchOptions,
} from "./IMusicProvider";
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
  preview_url?: string; // Spotify's 30-second preview
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
        logger.warn("Spotify API not configured");
        throw new Error("Spotify API credentials not configured");
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
        throw new Error(`Spotify search failed: ${response.status}`);
      }

      const data = (await response.json()) as SpotifySearchResponse;
      const tracks = data.tracks?.items || [];

      const results: VideoInfo[] = [];
      for (const track of tracks) {
        results.push(this.convertSpotifyTrackToVideoInfo(track));
      }

      logger.info(
        `Spotify search found ${results.length} results for: ${query}`
      );
      return results;
    } catch (error) {
      logger.error("Spotify search error:", error);
      throw error;
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    // Spotify doesn't allow direct streaming - only metadata and 30-second previews
    logger.warn(
      "Spotify direct streaming not supported - use preview URL or metadata only"
    );

    try {
      const trackInfo = await this.getTrackInfo(url);
      if (!trackInfo) {
        return null;
      }

      // Return a "stream info" that indicates this is Spotify metadata only
      return {
        title: trackInfo.title,
        streamUrl: trackInfo.url, // This is the Spotify URL, not a stream
        duration: trackInfo.duration,
        platform: this.platform,
      };
    } catch (error) {
      logger.error("Spotify stream info error:", error);
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
        logger.warn("Spotify API not configured");
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
        logger.warn("Spotify API not configured");
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
        logger.warn("Spotify API not configured");
        return [];
      }

      await this.ensureAuthenticated();

      const results: VideoInfo[] = [];
      let offset = 0;
      const batchSize = 50; // Spotify API limit per request

      while (results.length < limit) {
        const currentLimit = Math.min(batchSize, limit - results.length);

        const response = await fetch(
          `${SpotifyProvider.BASE_URL}/playlists/${playlistId}/tracks?limit=${currentLimit}&offset=${offset}&fields=items.track(id,name,artists,album,duration_ms,external_urls,preview_url)`,
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
    return false; // Spotify doesn't support direct streaming - metadata only
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
      url: track.external_urls.spotify, // Keep as Spotify URL
      duration: Math.floor(track.duration_ms / 1000),
      thumbnail,
      platform: this.platform,
      artist: artists,
      album: track.album.name,
    };
  }
}

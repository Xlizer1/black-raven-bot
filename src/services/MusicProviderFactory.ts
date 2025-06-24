import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  type SearchOptions,
  MusicPlatform,
} from "./providers/IMusicProvider";
import { YouTubeProvider } from "./providers/YouTubeProvider";
import { SpotifyProvider } from "./providers/SpotifyProvider";
import { logger } from "../utils/logger";

export class MusicProviderFactory {
  private static instance: MusicProviderFactory;
  private providers: Map<MusicPlatform, IMusicProvider>;
  private defaultPlatform: MusicPlatform = MusicPlatform.YOUTUBE;

  private constructor() {
    this.providers = new Map();
    this.registerProvider(new YouTubeProvider());
    this.registerProvider(new SpotifyProvider());
  }

  static getInstance(): MusicProviderFactory {
    if (!MusicProviderFactory.instance) {
      MusicProviderFactory.instance = new MusicProviderFactory();
    }
    return MusicProviderFactory.instance;
  }

  registerProvider(provider: IMusicProvider): void {
    this.providers.set(provider.platform, provider);
  }

  getProvider(platform: MusicPlatform): IMusicProvider | null {
    return this.providers.get(platform) || null;
  }

  detectPlatform(url: string): MusicPlatform | null {
    for (const [platform, provider] of this.providers) {
      if (provider.validateUrl(url)) {
        return platform;
      }
    }
    return null;
  }

  async search(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions
  ): Promise<VideoInfo[]> {
    const targetPlatform = platform || this.defaultPlatform;
    const provider = this.getProvider(targetPlatform);

    if (!provider) {
      throw new Error(`Provider for ${targetPlatform} not available`);
    }

    return provider.search(query, options);
  }

  async getStreamInfo(input: string): Promise<StreamInfo | null> {
    // Detect platform from URL
    const platform = this.detectPlatform(input);

    if (platform) {
      const provider = this.getProvider(platform);
      if (provider) {
        // Handle Spotify differently - no streaming support
        if (platform === MusicPlatform.SPOTIFY) {
          logger.warn(
            "Spotify URLs cannot be streamed directly - metadata only"
          );
          return null;
        }

        return provider.getStreamInfo(input);
      }
    }

    // If not a URL, search on default platform (YouTube only)
    if (this.defaultPlatform === MusicPlatform.YOUTUBE) {
      const results = await this.search(input, MusicPlatform.YOUTUBE, {
        limit: 1,
      });
      if (results.length > 0 && results[0]) {
        const provider = this.getProvider(MusicPlatform.YOUTUBE);
        return provider?.getStreamInfo(results[0].url) || null;
      }
    }

    return null;
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    const platform = this.detectPlatform(url);
    if (!platform) {
      logger.warn(`No provider found for URL: ${url}`);
      return null;
    }

    const provider = this.getProvider(platform);
    if (!provider) {
      logger.warn(`Provider for ${platform} not available`);
      return null;
    }

    try {
      const trackInfo = await provider.getTrackInfo(url);

      if (trackInfo) {
        logger.debug(
          `Track info retrieved from ${platform}: ${trackInfo.title}`
        );
      }

      return trackInfo;
    } catch (error) {
      logger.error(`Error getting track info from ${platform}:`, error);
      return null;
    }
  }

  getAvailablePlatforms(): MusicPlatform[] {
    return Array.from(this.providers.keys());
  }

  setDefaultPlatform(platform: MusicPlatform): void {
    if (this.providers.has(platform)) {
      this.defaultPlatform = platform;
      logger.info(`Default platform set to: ${platform}`);
    } else {
      logger.warn(
        `Cannot set default platform to ${platform} - provider not available`
      );
    }
  }

  getDefaultPlatform(): MusicPlatform {
    return this.defaultPlatform;
  }

  // Check if a platform supports direct streaming
  supportsStreaming(platform: MusicPlatform): boolean {
    const provider = this.getProvider(platform);
    return provider?.supportsDirectStreaming() || false;
  }

  // Check if a platform supports playlists
  supportsPlaylists(platform: MusicPlatform): boolean {
    const provider = this.getProvider(platform);
    return provider?.supportsPlaylists() || false;
  }

  // Get platform capabilities
  getPlatformCapabilities(platform: MusicPlatform): {
    streaming: boolean;
    playlists: boolean;
    search: boolean;
    trackInfo: boolean;
  } {
    const provider = this.getProvider(platform);

    if (!provider) {
      return {
        streaming: false,
        playlists: false,
        search: false,
        trackInfo: false,
      };
    }

    return {
      streaming: provider.supportsDirectStreaming(),
      playlists: provider.supportsPlaylists(),
      search: true, // All providers support search
      trackInfo: true, // All providers support track info
    };
  }

  // Get status of all providers
  getProvidersStatus(): Record<
    string,
    {
      available: boolean;
      capabilities: ReturnType<typeof this.getPlatformCapabilities>;
    }
  > {
    const status: Record<string, any> = {};

    for (const platform of Object.values(MusicPlatform)) {
      const provider = this.getProvider(platform);
      status[platform] = {
        available: !!provider,
        capabilities: this.getPlatformCapabilities(platform),
      };
    }

    return status;
  }

  // Validate that a URL can be processed
  validateUrl(url: string): {
    valid: boolean;
    platform?: MusicPlatform;
    canStream: boolean;
    canGetInfo: boolean;
  } {
    const platform = this.detectPlatform(url);

    if (!platform) {
      return {
        valid: false,
        canStream: false,
        canGetInfo: false,
      };
    }

    const capabilities = this.getPlatformCapabilities(platform);

    return {
      valid: true,
      platform,
      canStream: capabilities.streaming,
      canGetInfo: capabilities.trackInfo,
    };
  }
}

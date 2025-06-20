import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  type SearchOptions,
  MusicPlatform,
} from "./providers/IMusicProvider";
import { YouTubeProvider } from "./providers/YouTubeProvider";
import { SpotifyProvider } from "./providers/SpotifyProvider";

export class MusicProviderFactory {
  private static instance: MusicProviderFactory;
  private providers: Map<MusicPlatform, IMusicProvider>;
  private defaultPlatform: MusicPlatform = MusicPlatform.YOUTUBE;

  private constructor() {
    this.providers = new Map();
    this.registerProvider(new YouTubeProvider());
    this.registerProvider(new SpotifyProvider()); // Enable Spotify!
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
    // First try to detect platform from URL
    const platform = this.detectPlatform(input);

    if (platform) {
      const provider = this.getProvider(platform);
      if (provider) {
        // For Spotify URLs, we might need special handling
        if (platform === MusicPlatform.SPOTIFY) {
          return this.handleSpotifyStream(input);
        }
        return provider.getStreamInfo(input);
      }
    }

    // If not a URL, search on default platform
    const results = await this.search(input, this.defaultPlatform, {
      limit: 1,
    });
    if (results.length > 0 && results[0]) {
      const provider = this.getProvider(this.defaultPlatform);
      return provider?.getStreamInfo(results[0].url) || null;
    }

    return null;
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    const platform = this.detectPlatform(url);
    if (!platform) return null;

    const provider = this.getProvider(platform);
    return provider?.getTrackInfo(url) || null;
  }

  getAvailablePlatforms(): MusicPlatform[] {
    return Array.from(this.providers.keys());
  }

  setDefaultPlatform(platform: MusicPlatform): void {
    if (this.providers.has(platform)) {
      this.defaultPlatform = platform;
    }
  }

  private async handleSpotifyStream(
    spotifyUrl: string
  ): Promise<StreamInfo | null> {
    // Future implementation:
    // 1. Get Spotify track info
    // 2. Search for equivalent on YouTube
    // 3. Return YouTube stream info

    console.log("Spotify streaming not yet implemented");
    return null;
  }
}

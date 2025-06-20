import { MusicProviderFactory } from "./MusicProviderFactory";
import type {
  VideoInfo,
  StreamInfo,
  MusicPlatform,
  SearchOptions,
} from "./providers/IMusicProvider";

export class MusicService {
  private static factory = MusicProviderFactory.getInstance();

  static async search(
    query: string,
    platform?: MusicPlatform,
    options?: SearchOptions
  ): Promise<VideoInfo[]> {
    return this.factory.search(query, platform, options);
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
}

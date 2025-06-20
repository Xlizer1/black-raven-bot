import { exec } from "child_process";
import { promisify } from "util";
import {
  type IMusicProvider,
  type VideoInfo,
  type StreamInfo,
  MusicPlatform,
  type SearchOptions,
} from "./IMusicProvider";

const execAsync = promisify(exec);

export class YouTubeProvider implements IMusicProvider {
  readonly platform = MusicPlatform.YOUTUBE;

  private static readonly URL_REGEX =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;

  validateUrl(url: string): boolean {
    return YouTubeProvider.URL_REGEX.test(url);
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<VideoInfo[]> {
    try {
      const limit = options.limit || 1;
      const sanitizedQuery = query.replace(/[;&|`$(){}[\]\\]/g, "");
      const searchCommand = `yt-dlp "ytsearch${limit}:${sanitizedQuery}" --dump-json --no-playlist`;

      const { stdout } = await execAsync(searchCommand);
      const lines = stdout.trim().split("\n");

      const results: VideoInfo[] = [];
      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            results.push(this.parseVideoInfo(data));
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

      return results;
    } catch (error) {
      console.error("YouTube search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    try {
      const command = `yt-dlp "${url}" --get-url --get-title --get-duration --format "bestaudio" --no-playlist`;
      const { stdout } = await execAsync(command);
      const lines = stdout.trim().split("\n");

      if (lines.length >= 2 && lines[0] && lines[1]) {
        return {
          title: lines[0],
          streamUrl: lines[1],
          duration: lines[2] ? this.parseDuration(lines[2]) : undefined,
          platform: this.platform,
        };
      }
      return null;
    } catch (error) {
      console.error("YouTube stream error:", error);
      return null;
    }
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    try {
      const command = `yt-dlp "${url}" --dump-json --no-playlist`;
      const { stdout } = await execAsync(command);
      const data = JSON.parse(stdout.trim());
      return this.parseVideoInfo(data);
    } catch (error) {
      console.error("YouTube track info error:", error);
      return null;
    }
  }

  supportsPlaylists(): boolean {
    return true;
  }

  supportsDirectStreaming(): boolean {
    return true;
  }

  private parseVideoInfo(data: any): VideoInfo {
    return {
      id: data.id,
      title: data.title || "Unknown",
      url: data.webpage_url || data.url,
      duration: data.duration,
      thumbnail: data.thumbnail,
      platform: this.platform,
      artist: data.uploader,
      album: undefined, // YouTube doesn't have albums
    };
  }

  private parseDuration(durationStr: string): number | undefined {
    const parts = durationStr.split(":").reverse();
    let duration = 0;

    for (let i = 0; i < parts.length; i++) {
      duration += parseInt(parts[i] || "0") * Math.pow(60, i);
    }

    return duration > 0 ? duration : undefined;
  }
}

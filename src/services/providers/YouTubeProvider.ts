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

      // Use a lightweight search command that only gets essential fields
      const searchCommand = `yt-dlp "ytsearch${limit}:${sanitizedQuery}" --dump-json --no-playlist --no-download --skip-download --ignore-errors --quiet --no-warnings`;

      const { stdout } = await execAsync(searchCommand, {
        timeout: 10000, // 10 second timeout
        maxBuffer: 1024 * 1024 * 2, // 2MB buffer limit
      });

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

  // Fast search specifically for autocomplete with minimal data
  async searchForAutocomplete(
    query: string,
    limit: number = 10
  ): Promise<VideoInfo[]> {
    try {
      const sanitizedQuery = query.replace(/[;&|`$(){}[\]\\]/g, "");

      // Ultra-lightweight command for autocomplete - only get essential data
      const searchCommand = `yt-dlp "ytsearch${Math.min(
        limit,
        6
      )}:${sanitizedQuery}" --print "%(id)s|%(title)s|%(uploader)s|%(duration)s|%(webpage_url)s" --no-playlist --no-download --skip-download --ignore-errors --quiet --no-warnings --no-check-certificates`;

      const { stdout } = await execAsync(searchCommand, {
        timeout: 2000, // Reduced to 2 seconds for autocomplete
        maxBuffer: 1024 * 256, // Reduced to 256KB buffer limit
        killSignal: "SIGKILL", // Use SIGKILL instead of SIGTERM
      });

      const lines = stdout.trim().split("\n");
      const results: VideoInfo[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const parts = line.split("|");
          if (parts.length >= 5 && parts[0] && parts[1] && parts[4]) {
            const id = parts[0];
            const title = parts[1];
            const url = parts[4];
            const durationStr = parts[3];
            const artist = parts[2];

            if (id && title && url) {
              results.push({
                id,
                title,
                url,
                duration: durationStr
                  ? this.parseDurationFromSeconds(durationStr)
                  : undefined,
                thumbnail: undefined, // Skip thumbnail for autocomplete speed
                platform: this.platform,
                artist: artist || undefined,
                album: undefined,
              });
            }
          }
        }
      }

      return results;
    } catch (error) {
      // Handle timeout errors gracefully
      if (error && typeof error === "object") {
        const execError = error as any;
        if (
          execError.killed ||
          execError.signal === "SIGTERM" ||
          execError.signal === "SIGKILL"
        ) {
          console.warn("YouTube autocomplete search timed out:", query);
          return [];
        }
      }
      console.error("YouTube autocomplete search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    try {
      const command = `yt-dlp "${url}" --get-url --get-title --get-duration --format "bestaudio" --no-playlist --quiet --no-warnings`;
      const { stdout } = await execAsync(command, {
        timeout: 15000, // 15 second timeout for stream info
      });
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
      const command = `yt-dlp "${url}" --dump-json --no-playlist --quiet --no-warnings`;
      const { stdout } = await execAsync(command, {
        timeout: 10000, // 10 second timeout
      });
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

  private parseDurationFromSeconds(durationStr: string): number | undefined {
    const duration = parseFloat(durationStr);
    return isNaN(duration) ? undefined : Math.floor(duration);
  }
}

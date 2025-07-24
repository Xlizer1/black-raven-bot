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

  private static readonly PLAYLIST_URL_REGEX =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/playlist\?list=)[\w-]+/;

  validateUrl(url: string): boolean {
    return (
      YouTubeProvider.URL_REGEX.test(url) ||
      YouTubeProvider.PLAYLIST_URL_REGEX.test(url)
    );
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<VideoInfo[]> {
    console.log(`[YouTubeProvider] search() called with query: '${query}', options: ${JSON.stringify(options)}`);
    try {
      const limit = options.limit || 1;
      const sanitizedQuery = query.replace(/[;&|`$(){}[\]\\]/g, "");

      // Enhanced yt-dlp command with better anti-bot protection
      const searchCommand = `yt-dlp "ytsearch${limit}:${sanitizedQuery}" --dump-json --no-download --skip-download --ignore-errors --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 3`;
      console.log(`[YouTubeProvider] Running search command: ${searchCommand}`);

      const { stdout } = await execAsync(searchCommand, {
        timeout: 20000, // Increased timeout
        maxBuffer: 1024 * 1024 * 3,
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
      console.log(`[YouTubeProvider] search() returning ${results.length} results.`);
      return results;
    } catch (error) {
      console.error("[YouTubeProvider] YouTube search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    console.log(`[YouTubeProvider] getStreamInfo() called with url: '${url}'`);
    // First, get basic track info (this usually works even when streaming fails)
    let title = "Unknown";
    let duration: number | undefined;

    try {
      const infoCommand = `yt-dlp "${url}" --get-title --get-duration --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/"`;
      console.log(`[YouTubeProvider] Running info command: ${infoCommand}`);
      const { stdout: infoOutput } = await execAsync(infoCommand, {
        timeout: 15000,
      });
      const infoLines = infoOutput.trim().split("\n");
      if (infoLines.length >= 2) {
        title = infoLines[0] || "Unknown";
        duration = infoLines[1] ? this.parseDuration(infoLines[1]) : undefined;
      }
    } catch (error) {
      console.warn("[YouTubeProvider] Could not get basic info, using defaults");
    }

    // Enhanced streaming strategies with better anti-bot protection
    const strategies = [
      // Strategy 1: Enhanced with better headers
      {
        name: "Enhanced protection",
        command: `yt-dlp "${url}" --get-url --format "bestaudio[ext=m4a]/bestaudio/best" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 3 --fragment-retries 3 --add-header "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" --add-header "Accept-Language:en-US,en;q=0.5" --add-header "Cache-Control:no-cache"`,
        timeout: 25000,
      },
      // Strategy 2: Alternative with different user agent
      {
        name: "Alternative user agent",
        command: `yt-dlp "${url}" --get-url --format "140/251/250/249/bestaudio/worst" --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.youtube.com/" --extractor-retries 2 --fragment-retries 2`,
        timeout: 20000,
      },
      // Strategy 3: Fallback with minimal options
      {
        name: "Minimal fallback",
        command: `yt-dlp "${url}" --get-url --format "bestaudio/worst" --no-warnings --extractor-retries 1`,
        timeout: 15000,
      },
    ];

    for (const strategy of strategies) {
      try {
        console.log(`🔄 Trying streaming strategy: ${strategy.name}`);

        const { stdout } = await execAsync(strategy.command, {
          timeout: strategy.timeout,
        });

        const streamUrl = stdout.trim();

        if (streamUrl && streamUrl.startsWith("http")) {
          console.log(`✅ Success with strategy: ${strategy.name}`);
          return {
            title,
            streamUrl,
            duration,
            platform: this.platform,
          };
        }
      } catch (error) {
        console.warn(`❌ Strategy "${strategy.name}" failed:`, error);

        // Log specific error types for debugging
        if (error && typeof error === "object") {
          const execError = error as any;
          if (execError.stderr) {
            if (execError.stderr.includes("Sign in to confirm")) {
              console.warn(`   → YouTube bot detection triggered`);
            } else if (execError.stderr.includes("403")) {
              console.warn(`   → 403 Forbidden error`);
            } else if (execError.stderr.includes("fragment")) {
              console.warn(`   → Fragment download error`);
            }
          }
        }

        // Continue to next strategy
        continue;
      }
    }

    // All streaming strategies failed, but we might have metadata
    console.error(`❌ All streaming strategies failed for: ${title}`);
    console.log(
      `ℹ️  This video may be region-locked, age-restricted, or heavily protected`
    );

    return null;
  }

  async getTrackInfo(url: string): Promise<VideoInfo | null> {
    console.log(`[YouTubeProvider] getTrackInfo() called with url: '${url}'`);
    try {
      // Enhanced command with better anti-bot protection
      const command = `yt-dlp "${url}" --dump-json --no-download --skip-download --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 2`;
      console.log(`[YouTubeProvider] Running getTrackInfo command: ${command}`);
      const { stdout } = await execAsync(command, {
        timeout: 20000,
      });
      const data = JSON.parse(stdout.trim());
      const info = this.parseVideoInfo(data);
      console.log(`[YouTubeProvider] getTrackInfo() returning: ${JSON.stringify(info)}`);
      return info;
    } catch (error) {
      console.warn("[YouTubeProvider] Full info extraction failed, trying basic info...");

      // Fallback to basic info (this usually works)
      try {
        const simpleCommand = `yt-dlp "${url}" --get-title --get-duration --get-id --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --referer "https://www.google.com/"`;
        console.log(`[YouTubeProvider] Running fallback getTrackInfo command: ${simpleCommand}`);
        const { stdout } = await execAsync(simpleCommand, {
          timeout: 15000,
        });
        const lines = stdout.trim().split("\n");

        if (lines.length >= 1 && lines[0]) {
          const extractedId =
            lines.length >= 3 && lines[2] ? lines[2] : this.extractVideoId(url);
          const info = {
            id: extractedId,
            title: lines[0] || "Unknown",
            url: url,
            duration:
              lines.length >= 2 && lines[1]
                ? this.parseDuration(lines[1])
                : undefined,
            thumbnail: undefined,
            platform: this.platform,
            artist: undefined,
            album: undefined,
          };
          console.log(`[YouTubeProvider] getTrackInfo() fallback returning: ${JSON.stringify(info)}`);
          return info;
        }
      } catch (fallbackError) {
        console.error("[YouTubeProvider] Even basic track info failed:", fallbackError);
      }

      return null;
    }
  }

  supportsPlaylists(): boolean {
    return true;
  }

  supportsDirectStreaming(): boolean {
    return true;
  }

  async loadPlaylistSongs(url: string, limit: number = 100): Promise<VideoInfo[]> {
    console.log(`[YouTubeProvider] loadPlaylistSongs() called with url: '${url}', limit: ${limit}`);
    try {
      // Use yt-dlp to fetch all video IDs in the playlist (new syntax)
      const command = `yt-dlp "${url}" --flat-playlist --print "%(id)s" --playlist-end ${limit} --no-warnings`;
      console.log(`[YouTubeProvider] Running command: ${command}`);
      const { stdout } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
      });
      console.log(`[YouTubeProvider] yt-dlp raw stdout:\n${stdout}`);
      const lines = stdout.trim().split("\n");
      console.log(`[YouTubeProvider] Parsed video IDs:`, lines);
      const videoIds = lines.filter(id => id && /^[\w-]{11}$/.test(id));
      const trackInfoPromises = videoIds.map(id => {
        const videoUrl = `https://www.youtube.com/watch?v=${id}`;
        return this.getTrackInfo(videoUrl).catch(err => {
          console.error(`[YouTubeProvider] Error fetching info for video ID: ${id}`, err);
          return null;
        });
      });
      const infos = await Promise.all(trackInfoPromises);
      const results = infos.filter(info => info !== null) as VideoInfo[];
      console.log(`[YouTubeProvider] Successfully fetched ${results.length} tracks from playlist.`);
      return results;
    } catch (error) {
      console.error("YouTubeProvider: Error loading playlist songs:", error);
      return [];
    }
  }

  private parseVideoInfo(data: any): VideoInfo {
    return {
      id: data.id || "unknown",
      title: data.title || "Unknown",
      url: data.webpage_url || data.url || "",
      duration: data.duration,
      thumbnail: data.thumbnail,
      platform: this.platform,
      artist: data.uploader,
      album: undefined,
    };
  }

  private parseDuration(durationStr: string): number | undefined {
    if (!durationStr) return undefined;

    // Handle both "MM:SS" and seconds format
    if (durationStr.includes(":")) {
      const parts = durationStr.split(":").reverse();
      let duration = 0;
      for (let i = 0; i < parts.length; i++) {
        duration += parseInt(parts[i] || "0") * Math.pow(60, i);
      }
      return duration > 0 ? duration : undefined;
    } else {
      const duration = parseFloat(durationStr);
      return isNaN(duration) ? undefined : Math.floor(duration);
    }
  }

  private extractVideoId(url: string): string {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/
    );
    return match && match[1] ? match[1] : "unknown";
  }
}

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

  // Rate limiting to avoid triggering bot detection
  private lastRequestTime = 0;
  private requestCount = 0;
  private readonly minRequestInterval = 2000; // 2 seconds between requests
  private readonly maxRequestsPerMinute = 15;

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
    
    // Apply rate limiting
    await this.applyRateLimit();
    
    try {
      const limit = options.limit || 1;
      const sanitizedQuery = query.replace(/[;&|`$(){}[\]\\]/g, "");

      // Enhanced anti-bot detection strategies
      const strategies = [
        // Strategy 1: Use cookies and session data
        {
          name: "With cookies",
          command: this.buildSearchCommand(sanitizedQuery, limit, {
            useCookies: true,
            useProxy: false,
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }),
          timeout: 25000,
        },
        // Strategy 2: Alternative with different approach
        {
          name: "Alternative headers",
          command: this.buildSearchCommand(sanitizedQuery, limit, {
            useCookies: false,
            useProxy: false,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          }),
          timeout: 20000,
        },
        // Strategy 3: Minimal approach
        {
          name: "Minimal",
          command: this.buildSearchCommand(sanitizedQuery, limit, {
            minimal: true,
          }),
          timeout: 15000,
        },
      ];

      for (const strategy of strategies) {
        try {
          console.log(`🔄 Trying search strategy: ${strategy.name}`);
          
          const { stdout } = await execAsync(strategy.command, {
            timeout: strategy.timeout,
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

          if (results.length > 0) {
            console.log(`✅ Search success with strategy: ${strategy.name}`);
            console.log(`[YouTubeProvider] search() returning ${results.length} results.`);
            return results;
          }

        } catch (error) {
          console.warn(`❌ Search strategy "${strategy.name}" failed:`, error);
          
          // Check for specific bot detection errors
          if (error && typeof error === "object") {
            const execError = error as any;
            if (execError.stderr?.includes("Sign in to confirm")) {
              console.warn(`   → Bot detection triggered, trying next strategy...`);
              // Add longer delay before next attempt
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
          continue;
        }
      }

      console.error("[YouTubeProvider] All search strategies failed");
      return [];
      
    } catch (error) {
      console.error("[YouTubeProvider] YouTube search error:", error);
      return [];
    }
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    console.log(`[YouTubeProvider] getStreamInfo() called with url: '${url}'`);
    
    // Apply rate limiting
    await this.applyRateLimit();
    
    // First, get basic track info (this usually works even when streaming fails)
    let title = "Unknown";
    let duration: number | undefined;

    try {
      const infoCommand = this.buildInfoCommand(url);
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
      // Strategy 1: With cookies and enhanced headers
      {
        name: "Enhanced with cookies",
        command: this.buildStreamCommand(url, {
          useCookies: true,
          format: "bestaudio[ext=m4a]/bestaudio/best",
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }),
        timeout: 30000,
      },
      // Strategy 2: Alternative format
      {
        name: "Alternative format",
        command: this.buildStreamCommand(url, {
          useCookies: false,
          format: "140/251/250/249/bestaudio/worst",
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        }),
        timeout: 25000,
      },
      // Strategy 3: Minimal fallback
      {
        name: "Minimal fallback",
        command: this.buildStreamCommand(url, {
          minimal: true,
          format: "bestaudio/worst",
        }),
        timeout: 20000,
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
              // Add delay before next attempt
              await new Promise(resolve => setTimeout(resolve, 3000));
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
    
    // Apply rate limiting
    await this.applyRateLimit();
    
    try {
      // Enhanced command with better anti-bot protection
      const command = this.buildTrackInfoCommand(url);
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
        const simpleCommand = this.buildSimpleInfoCommand(url);
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
    
    // Apply rate limiting
    await this.applyRateLimit();
    
    try {
      // Use yt-dlp to fetch all video IDs in the playlist
      const command = this.buildPlaylistCommand(url, limit);
      console.log(`[YouTubeProvider] Running command: ${command}`);
      const { stdout } = await execAsync(command, {
        timeout: 60000, // Longer timeout for playlists
        maxBuffer: 1024 * 1024 * 10, // Larger buffer for playlists
      });
      console.log(`[YouTubeProvider] yt-dlp raw stdout:\n${stdout}`);
      const lines = stdout.trim().split("\n");
      console.log(`[YouTubeProvider] Parsed video IDs:`, lines);
      const videoIds = lines.filter(id => id && /^[\w-]{11}$/.test(id));
      
      // Process videos in batches to avoid overwhelming the API
      const batchSize = 5;
      const results: VideoInfo[] = [];
      
      for (let i = 0; i < videoIds.length; i += batchSize) {
        const batch = videoIds.slice(i, i + batchSize);
        const batchPromises = batch.map(async (id) => {
          // Add small delay between requests in batch
          await new Promise(resolve => setTimeout(resolve, 1000));
          const videoUrl = `https://www.youtube.com/watch?v=${id}`;
          return this.getTrackInfo(videoUrl).catch(err => {
            console.error(`[YouTubeProvider] Error fetching info for video ID: ${id}`, err);
            return null;
          });
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(info => info !== null) as VideoInfo[]);
        
        // Add delay between batches
        if (i + batchSize < videoIds.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`[YouTubeProvider] Successfully fetched ${results.length} tracks from playlist.`);
      return results;
    } catch (error) {
      console.error("YouTubeProvider: Error loading playlist songs:", error);
      return [];
    }
  }

  // Private helper methods for building commands

  private buildSearchCommand(query: string, limit: number, options: any = {}): string {
    const baseCommand = `yt-dlp "ytsearch${limit}:${query}"`;
    
    if (options.minimal) {
      return `${baseCommand} --dump-json --no-download --skip-download --ignore-errors --no-warnings`;
    }
    
    let command = `${baseCommand} --dump-json --no-download --skip-download --ignore-errors --no-warnings`;
    
    if (options.userAgent) {
      command += ` --user-agent "${options.userAgent}"`;
    }
    
    if (options.useCookies) {
      command += ` --cookies-from-browser chrome`;
      command += ` --referer "https://www.youtube.com/"`;
    } else {
      command += ` --referer "https://www.google.com/"`;
    }
    
    command += ` --extractor-retries 2`;
    command += ` --fragment-retries 2`;
    command += ` --sleep-interval 1`;
    command += ` --max-sleep-interval 3`;
    
    // Add additional headers to look more like a real browser
    command += ` --add-header "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"`;
    command += ` --add-header "Accept-Language:en-US,en;q=0.5"`;
    command += ` --add-header "Cache-Control:no-cache"`;
    command += ` --add-header "Pragma:no-cache"`;
    
    return command;
  }

  private buildStreamCommand(url: string, options: any = {}): string {
    let command = `yt-dlp "${url}" --get-url`;
    
    if (options.format) {
      command += ` --format "${options.format}"`;
    }
    
    if (options.minimal) {
      command += ` --no-warnings --extractor-retries 1`;
      return command;
    }
    
    if (options.userAgent) {
      command += ` --user-agent "${options.userAgent}"`;
    }
    
    if (options.useCookies) {
      command += ` --cookies-from-browser chrome`;
      command += ` --referer "https://www.youtube.com/"`;
    } else {
      command += ` --referer "https://www.google.com/"`;
    }
    
    command += ` --extractor-retries 2`;
    command += ` --fragment-retries 2`;
    command += ` --sleep-interval 1`;
    command += ` --max-sleep-interval 3`;
    
    // Add headers
    command += ` --add-header "Accept:*/*"`;
    command += ` --add-header "Accept-Language:en-US,en;q=0.9"`;
    
    return command;
  }

  private buildInfoCommand(url: string): string {
    return `yt-dlp "${url}" --get-title --get-duration --no-warnings --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" --referer "https://www.google.com/" --sleep-interval 1`;
  }

  private buildTrackInfoCommand(url: string): string {
    return `yt-dlp "${url}" --dump-json --no-download --skip-download --no-warnings --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 2 --sleep-interval 1`;
  }

  private buildSimpleInfoCommand(url: string): string {
    return `yt-dlp "${url}" --get-title --get-duration --get-id --no-warnings --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" --referer "https://www.google.com/" --sleep-interval 1`;
  }

  private buildPlaylistCommand(url: string, limit: number): string {
    return `yt-dlp "${url}" --flat-playlist --print "%(id)s" --playlist-end ${limit} --no-warnings --sleep-interval 2 --user-agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"`;
  }

  // Rate limiting to avoid bot detection
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Reset request count every minute
    if (timeSinceLastRequest > 60000) {
      this.requestCount = 0;
    }
    
    // Check if we're making too many requests
    if (this.requestCount >= this.maxRequestsPerMinute) {
      const waitTime = 60000 - timeSinceLastRequest;
      console.log(`[YouTubeProvider] Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
    }
    
    // Ensure minimum interval between requests
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`[YouTubeProvider] Throttling: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
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
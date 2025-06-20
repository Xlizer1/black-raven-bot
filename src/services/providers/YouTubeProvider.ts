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

      // Enhanced yt-dlp command with better anti-bot protection
      const searchCommand = `yt-dlp "ytsearch${limit}:${sanitizedQuery}" --dump-json --no-download --skip-download --ignore-errors --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 3`;

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

      return results;
    } catch (error) {
      console.error("YouTube search error:", error);
      return [];
    }
  }

  async searchForAutocomplete(
    query: string,
    limit: number = 8
  ): Promise<VideoInfo[]> {
    try {
      // Use YouTube's ultra-fast suggestions API
      const suggestionsUrl = `https://suggestqueries.google.com/complete/search?client=youtube&q=${encodeURIComponent(
        query
      )}`;

      const response = await fetch(suggestionsUrl, {
        signal: AbortSignal.timeout(500), // Very fast timeout
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.youtube.com/",
        },
      });

      if (!response.ok) {
        return this.createQuerySuggestions(query, limit);
      }

      const text = await response.text();

      // Parse JSONP response: window.google.ac.h(["query",[suggestions...]])
      const jsonMatch = text.match(/\[.*\]/);
      if (!jsonMatch) {
        return this.createQuerySuggestions(query, limit);
      }

      const data = JSON.parse(jsonMatch[0]);
      const suggestions: unknown[] = data[1] || [];

      if (suggestions.length === 0) {
        return this.createQuerySuggestions(query, limit);
      }

      // Filter and enhance suggestions for music - with proper type checking
      const musicSuggestions = this.filterMusicSuggestions(suggestions, query);

      // Convert to VideoInfo objects
      const results: VideoInfo[] = musicSuggestions
        .slice(0, limit)
        .map((suggestion: string, index: number) => ({
          id: `yt_suggestion_${Date.now()}_${index}`,
          title: this.enhanceSuggestionTitle(suggestion),
          url: `search:${suggestion}`, // Special marker for suggestions
          duration: undefined,
          thumbnail: undefined,
          platform: this.platform,
          artist: this.extractArtistFromSuggestion(suggestion),
          album: undefined,
        }));

      return results;
    } catch (error) {
      console.warn(`YouTube suggestions failed for "${query}":`, error);
      return this.createQuerySuggestions(query, limit);
    }
  }

  private filterMusicSuggestions(
    suggestions: unknown[],
    originalQuery: string
  ): string[] {
    // First filter to ensure we only have strings
    const stringSuggestions = suggestions.filter(
      (suggestion): suggestion is string =>
        typeof suggestion === "string" && suggestion.length > 0
    );

    const filtered = stringSuggestions.filter((suggestion) => {
      const lower = suggestion.toLowerCase();
      // Prefer music-related suggestions
      return (
        lower.includes("song") ||
        lower.includes("music") ||
        lower.includes("lyrics") ||
        lower.includes("acoustic") ||
        lower.includes("cover") ||
        lower.includes("remix") ||
        lower.includes("live") ||
        lower.includes("official") ||
        // Or if it's close to the original query
        lower.includes(originalQuery.toLowerCase().substring(0, 3))
      );
    });

    // If we filtered too much, include the best original suggestions
    if (filtered.length < 3) {
      const remaining = stringSuggestions
        .filter((s) => !filtered.includes(s))
        .slice(0, 5 - filtered.length);
      filtered.push(...remaining);
    }

    return filtered;
  }

  private enhanceSuggestionTitle(suggestion: string): string {
    // Clean up and enhance the suggestion for music context
    return suggestion.replace(/\s+/g, " ").trim().substring(0, 100); // Keep reasonable length
  }

  private extractArtistFromSuggestion(suggestion: string): string | undefined {
    // Try to extract artist name from suggestion patterns
    const patterns = [
      /^([^-]+)\s*-\s*/, // "Artist - Song"
      /^([^(]+)\s*\(/, // "Artist (something)"
      /by\s+([^(]+)/, // "Song by Artist"
    ];

    for (const pattern of patterns) {
      const match = suggestion.match(pattern);
      if (match && match[1]) {
        const artist = match[1].trim();
        if (artist.length > 2 && artist.length < 50) {
          return artist;
        }
      }
    }

    return undefined;
  }

  private createQuerySuggestions(query: string, limit: number): VideoInfo[] {
    // Fallback: create smart suggestions based on the query
    const suggestions = [
      query,
      `${query} official`,
      `${query} lyrics`,
      `${query} acoustic`,
      `${query} live`,
    ];

    return suggestions.slice(0, limit).map((suggestion, index) => ({
      id: `query_suggestion_${Date.now()}_${index}`,
      title: suggestion,
      url: `search:${suggestion}`,
      duration: undefined,
      thumbnail: undefined,
      platform: this.platform,
      artist: undefined,
      album: undefined,
    }));
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    // First, get basic track info (this usually works even when streaming fails)
    let title = "Unknown";
    let duration: number | undefined;

    try {
      const infoCommand = `yt-dlp "${url}" --get-title --get-duration --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/"`;
      const { stdout: infoOutput } = await execAsync(infoCommand, {
        timeout: 15000,
      });
      const infoLines = infoOutput.trim().split("\n");
      if (infoLines.length >= 2) {
        title = infoLines[0] || "Unknown";
        duration = infoLines[1] ? this.parseDuration(infoLines[1]) : undefined;
      }
    } catch (error) {
      console.warn("Could not get basic info, using defaults");
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
    try {
      // Enhanced command with better anti-bot protection
      const command = `yt-dlp "${url}" --dump-json --no-download --skip-download --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --referer "https://www.google.com/" --extractor-retries 2`;
      const { stdout } = await execAsync(command, {
        timeout: 20000,
      });
      const data = JSON.parse(stdout.trim());
      return this.parseVideoInfo(data);
    } catch (error) {
      console.warn("Full info extraction failed, trying basic info...");

      // Fallback to basic info (this usually works)
      try {
        const simpleCommand = `yt-dlp "${url}" --get-title --get-duration --get-id --no-warnings --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --referer "https://www.google.com/"`;
        const { stdout } = await execAsync(simpleCommand, {
          timeout: 15000,
        });
        const lines = stdout.trim().split("\n");

        if (lines.length >= 1 && lines[0]) {
          const extractedId =
            lines.length >= 3 && lines[2] ? lines[2] : this.extractVideoId(url);
          return {
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
        }
      } catch (fallbackError) {
        console.error("Even basic track info failed:", fallbackError);
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

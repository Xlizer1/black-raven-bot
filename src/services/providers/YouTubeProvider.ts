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

      // Use basic search for metadata only
      const searchCommand = `yt-dlp "ytsearch${limit}:${sanitizedQuery}" --dump-json --no-download --skip-download --ignore-errors --no-warnings`;

      const { stdout } = await execAsync(searchCommand, {
        timeout: 15000,
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
      const suggestions: string[] = data[1] || [];

      if (suggestions.length === 0) {
        return this.createQuerySuggestions(query, limit);
      }

      // Filter and enhance suggestions for music
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
    suggestions: string[],
    originalQuery: string
  ): string[] {
    const filtered = suggestions.filter((suggestion) => {
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
      const remaining = suggestions
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

  private async fallbackSearch(
    query: string,
    limit: number
  ): Promise<VideoInfo[]> {
    try {
      const sanitizedQuery = query.replace(/[;&|`$(){}[\]\\]/g, "");

      // Ultra-fast yt-dlp command as last resort
      const searchCommand = `yt-dlp "ytsearch${Math.min(
        limit,
        3
      )}:${sanitizedQuery}" --print "%(id)s|%(title)s" --no-download --skip-download --ignore-errors --no-warnings --extractor-retries 1`;

      const { stdout } = await execAsync(searchCommand, {
        timeout: 1000, // 1 second max
        maxBuffer: 1024 * 64,
        killSignal: "SIGKILL",
      });

      if (!stdout?.trim()) return [];

      const results: VideoInfo[] = [];
      const lines = stdout.trim().split("\n");

      for (const line of lines.slice(0, limit)) {
        if (line.includes("|")) {
          const [id, title] = line.split("|");
          if (id?.trim() && title?.trim()) {
            results.push({
              id: id.trim(),
              title: title.trim(),
              url: `https://www.youtube.com/watch?v=${id.trim()}`,
              duration: undefined,
              thumbnail: undefined,
              platform: this.platform,
              artist: undefined,
              album: undefined,
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.warn(`Fallback search failed for "${query}":`, error);
      return [];
    }
  }

  private cleanTitle(title: string): string {
    // More aggressive cleaning for autocomplete
    return title
      .replace(/\s*\(Official.*?\)/gi, "")
      .replace(/\s*\[Official.*?\]/gi, "")
      .replace(/\s*-\s*Official.*$/gi, "")
      .replace(/\s*\|\s*Official.*$/gi, "")
      .replace(/\s*\(Music Video\)/gi, "")
      .replace(/\s*\[Music Video\]/gi, "")
      .replace(/\s*\(Lyric Video\)/gi, "")
      .replace(/\s*\[Lyric Video\]/gi, "")
      .replace(/\s*\(Audio\)/gi, "")
      .replace(/\s*\[Audio\]/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 80); // Limit length for autocomplete
  }

  private cleanArtistName(uploader: string): string {
    // Clean common channel name suffixes
    return uploader
      .replace(/\s*-\s*Topic$/gi, "")
      .replace(/\s*VEVO$/gi, "")
      .replace(/\s*Official$/gi, "")
      .replace(/\s*Music$/gi, "")
      .replace(/\s*Records$/gi, "")
      .replace(/\s*Entertainment$/gi, "")
      .trim()
      .substring(0, 50); // Limit length
  }

  async getStreamInfo(url: string): Promise<StreamInfo | null> {
    // First, get basic track info (this usually works even when streaming fails)
    let title = "Unknown";
    let duration: number | undefined;

    try {
      const infoCommand = `yt-dlp "${url}" --get-title --get-duration --no-warnings`;
      const { stdout: infoOutput } = await execAsync(infoCommand, {
        timeout: 10000,
      });
      const infoLines = infoOutput.trim().split("\n");
      if (infoLines.length >= 2) {
        title = infoLines[0] || "Unknown";
        duration = infoLines[1] ? this.parseDuration(infoLines[1]) : undefined;
      }
    } catch (error) {
      console.warn("Could not get basic info, using defaults");
    }

    // Now try streaming strategies - using EXACT command that worked in your manual test
    const strategies = [
      // Strategy 1: Your exact working command
      {
        name: "Manual test replica",
        command: `yt-dlp "${url}" --get-url --format "bestaudio[ext=m4a]/bestaudio/best" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --referer "https://www.youtube.com/" --extractor-retries 5 --fragment-retries 5`,
        timeout: 20000,
      },
      // Strategy 2: Alternative format selection
      {
        name: "Format fallback",
        command: `yt-dlp "${url}" --get-url --format "140/251/250/249/bestaudio/worst" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --referer "https://www.youtube.com/" --extractor-retries 3 --fragment-retries 3`,
        timeout: 25000,
      },
      // Strategy 3: Ultra-simple approach
      {
        name: "Simple approach",
        command: `yt-dlp "${url}" --get-url --format "worst" --no-warnings`,
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
            if (execError.stderr.includes("403")) {
              console.warn(`   → 403 Forbidden error`);
            } else if (execError.stderr.includes("fragment")) {
              console.warn(`   → Fragment download error`);
            } else if (execError.stderr.includes("Sign in to confirm")) {
              console.warn(`   → Age-restricted content`);
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
      // Try comprehensive info first
      const command = `yt-dlp "${url}" --dump-json --no-download --skip-download --no-warnings`;
      const { stdout } = await execAsync(command, {
        timeout: 15000,
      });
      const data = JSON.parse(stdout.trim());
      return this.parseVideoInfo(data);
    } catch (error) {
      console.warn("Full info extraction failed, trying basic info...");

      // Fallback to basic info (this usually works)
      try {
        const simpleCommand = `yt-dlp "${url}" --get-title --get-duration --get-id --no-warnings`;
        const { stdout } = await execAsync(simpleCommand, {
          timeout: 10000,
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

  private parseDurationFromSeconds(durationStr: string): number | undefined {
    const duration = parseFloat(durationStr);
    return isNaN(duration) ? undefined : Math.floor(duration);
  }

  private extractVideoId(url: string): string {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/
    );
    return match && match[1] ? match[1] : "unknown";
  }
}

// src/config/config.ts

import { config } from "dotenv";

config();

export interface BotConfig {
  token: string;
  prefix: string;
  maxVolumeLevel: number;
  maxQueueSize: number;
  voiceTimeout: number;
  embedColor: number;
  spotify: {
    clientId?: string;
    clientSecret?: string;
  };
  youtube: {
    searchCooldown: number;
    maxSearchesPerHour: number;
    requestTimeout: number;
    useStealthMode: boolean;
    useMinimalCommands: boolean;
    useMobileUA: boolean;
    bypassGeo: boolean;
    disableAgeGate: boolean;
  };
  performance: {
    autocompleteTimeout: number;
    searchTimeout: number;
    streamTimeout: number;
    maxBufferSize: number;
  };
  cache: {
    ttl: number;
    maxSize: number;
  };
}

class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;

  private constructor() {
    this.validateEnvironment();
    this.config = {
      token: process.env.TOKEN!,
      spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      },
      youtube: {
        searchCooldown: parseInt(process.env.YOUTUBE_SEARCH_COOLDOWN || "5000"),
        maxSearchesPerHour: parseInt(
          process.env.YOUTUBE_MAX_SEARCHES_PER_HOUR || "30"
        ),
        requestTimeout: parseInt(
          process.env.YOUTUBE_REQUEST_TIMEOUT || "20000"
        ),
        useStealthMode: process.env.YOUTUBE_USE_STEALTH_MODE === "true",
        useMinimalCommands: process.env.YOUTUBE_USE_MINIMAL_COMMANDS === "true",
        useMobileUA: process.env.YOUTUBE_USE_MOBILE_UA === "true",
        bypassGeo: process.env.YOUTUBE_BYPASS_GEO === "true",
        disableAgeGate: process.env.YOUTUBE_DISABLE_AGE_GATE === "true",
      },
      prefix: process.env.PREFIX || "!",
      maxVolumeLevel: parseInt(process.env.MAX_VOLUME || "100"),
      maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "50"),
      voiceTimeout: parseInt(process.env.VOICE_TIMEOUT || "300000"),
      embedColor: parseInt(process.env.EMBED_COLOR || "0x7289da"),
      performance: {
        autocompleteTimeout: parseInt(
          process.env.AUTOCOMPLETE_TIMEOUT || "1500"
        ),
        searchTimeout: parseInt(process.env.SEARCH_TIMEOUT || "10000"),
        streamTimeout: parseInt(process.env.STREAM_TIMEOUT || "15000"),
        maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE || "2097152"),
      },
      cache: {
        ttl: parseInt(process.env.CACHE_TTL || "300000"),
        maxSize: parseInt(process.env.MAX_CACHE_SIZE || "100"),
      },
    };
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  get(): BotConfig {
    return this.config;
  }

  private validateEnvironment(): void {
    const required = ["TOKEN"];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }

    // Validate Spotify configuration
    this.validateSpotifyConfig();

    // Validate YouTube configuration
    this.validateYouTubeConfig();
  }

  private validateSpotifyConfig(): void {
    const hasClientId = !!process.env.SPOTIFY_CLIENT_ID;
    const hasClientSecret = !!process.env.SPOTIFY_CLIENT_SECRET;

    if (hasClientId && hasClientSecret) {
      console.log(
        "✅ Spotify integration configured - Spotify URLs will be supported"
      );
    } else if (hasClientId || hasClientSecret) {
      console.warn(
        "⚠️  Incomplete Spotify configuration - Both CLIENT_ID and CLIENT_SECRET are required"
      );
      console.warn("   Spotify URLs will fall back to YouTube search");
    } else {
      console.log(
        "ℹ️  Spotify integration not configured - Only YouTube will be used"
      );
      console.log(
        "   To enable Spotify: Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET"
      );
    }
  }

  private validateYouTubeConfig(): void {
    const cooldown = parseInt(process.env.YOUTUBE_SEARCH_COOLDOWN || "5000");
    const maxSearches = parseInt(
      process.env.YOUTUBE_MAX_SEARCHES_PER_HOUR || "30"
    );

    if (cooldown < 2000) {
      console.warn(
        "⚠️  YouTube search cooldown is very low - may trigger bot detection"
      );
    }

    if (maxSearches > 50) {
      console.warn(
        "⚠️  YouTube search limit is high - may trigger bot detection"
      );
    }

    console.log(
      `ℹ️  YouTube anti-bot settings: ${cooldown}ms cooldown, ${maxSearches} searches/hour`
    );
  }
}

export const botConfig = ConfigManager.getInstance().get();

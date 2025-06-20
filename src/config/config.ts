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
      prefix: process.env.PREFIX || "!",
      maxVolumeLevel: parseInt(process.env.MAX_VOLUME || "100"),
      maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "50"),
      voiceTimeout: parseInt(process.env.VOICE_TIMEOUT || "300000"), // 5 minutes
      embedColor: parseInt(process.env.EMBED_COLOR || "0x7289da"),
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
}

export const botConfig = ConfigManager.getInstance().get();

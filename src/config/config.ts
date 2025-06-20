import { config } from "dotenv";

config();

export interface BotConfig {
  token: string;
  prefix: string;
  maxVolumeLevel: number;
  maxQueueSize: number;
  voiceTimeout: number;
  embedColor: number;
}

class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;

  private constructor() {
    this.validateEnvironment();
    this.config = {
      token: process.env.TOKEN!,
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
  }
}

export const botConfig = ConfigManager.getInstance().get();

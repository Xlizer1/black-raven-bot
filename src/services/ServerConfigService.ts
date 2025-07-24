import { logger } from "../utils/logger";

export interface ServerConfig {
  guildId: string;
  defaultVolume: number;
  announceNowPlaying: boolean;
  deleteMessagesAfter: number;
  maxQueueSize: number;
  maxSongDuration: number;
  allowExplicitContent: boolean;
  defaultPlatform: "youtube" | "spotify";
  autoLeaveTimeout: number;
  skipVoteThreshold: number;
  enableTextInVoice: boolean;
  logCommands: boolean;
  trackUsageStats: boolean;
  banOffensiveWords: boolean;
  maxRequestsPerUser: number;
  lastfmEnabled: boolean;
  spotifyIntegration: boolean;
  embedColor: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ServerConfigService {
  private static instance: ServerConfigService;
  private configs = new Map<string, ServerConfig>();
  private saveTimeout: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): ServerConfigService {
    if (!ServerConfigService.instance) {
      ServerConfigService.instance = new ServerConfigService();
    }
    return ServerConfigService.instance;
  }

  // Get server configuration with defaults
  getConfig(guildId: string): ServerConfig {
    const existing = this.configs.get(guildId);
    if (existing) {
      return existing;
    }

    // Create default configuration
    const defaultConfig: ServerConfig = {
      guildId,
      defaultVolume: 50,
      announceNowPlaying: true,
      deleteMessagesAfter: 0,

      maxQueueSize: 100,
      maxSongDuration: 0, // unlimited
      allowExplicitContent: true,
      defaultPlatform: "youtube",

      autoLeaveTimeout: 300, // 5 minutes
      skipVoteThreshold: 0.5,
      enableTextInVoice: false,

      logCommands: true,
      trackUsageStats: true,

      banOffensiveWords: false,
      maxRequestsPerUser: 20,

      lastfmEnabled: false,
      spotifyIntegration: false,

      embedColor: "#7289da",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.configs.set(guildId, defaultConfig);
    this.scheduleSave();
    return defaultConfig;
  }

  // Update specific configuration options
  updateConfig(guildId: string, updates: Partial<ServerConfig>): ServerConfig {
    const config = this.getConfig(guildId);
    const updated = {
      ...config,
      ...updates,
      updatedAt: new Date(),
    };

    this.configs.set(guildId, updated);
    this.scheduleSave();

    logger.info(
      `Updated server config for guild ${guildId}:`,
      Object.keys(updates)
    );
    return updated;
  }

  // Bulk update configuration
  bulkUpdateConfig(
    guildId: string,
    updates: Record<string, any>
  ): ServerConfig {
    const config = this.getConfig(guildId);

    // Apply updates with type safety
    for (const [key, value] of Object.entries(updates)) {
      if (key in config && key !== "guildId" && key !== "createdAt") {
        (config as any)[key] = value;
      }
    }

    config.updatedAt = new Date();
    this.configs.set(guildId, config);
    this.scheduleSave();

    return config;
  }

  // Reset configuration to defaults
  resetConfig(guildId: string): ServerConfig {
    this.configs.delete(guildId);
    return this.getConfig(guildId); // This will create a new default config
  }

  // Export configuration for backup
  exportConfig(guildId: string): string {
    const config = this.getConfig(guildId);
    return JSON.stringify(config, null, 2);
  }

  // Import configuration from backup
  importConfig(guildId: string, configJson: string): boolean {
    try {
      const importedConfig = JSON.parse(configJson) as ServerConfig;

      // Validate required fields
      if (!importedConfig.guildId || importedConfig.guildId !== guildId) {
        logger.error("Invalid config import: guild ID mismatch");
        return false;
      }

      // Update timestamps
      importedConfig.updatedAt = new Date();

      this.configs.set(guildId, importedConfig);
      this.scheduleSave();

      logger.info(`Imported configuration for guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error("Failed to import configuration:", error);
      return false;
    }
  }

  // Get configuration statistics
  getConfigStats(): {
    totalServers: number;
    averageQueueSize: number;
    averageVolume: number;
    mostUsedPlatform: string;
  } {
    const configs = Array.from(this.configs.values());

    const avgQueueSize =
      configs.reduce((sum, c) => sum + c.maxQueueSize, 0) / configs.length;
    const avgVolume =
      configs.reduce((sum, c) => sum + c.defaultVolume, 0) / configs.length;

    const platformCounts = { youtube: 0, spotify: 0 };
    configs.forEach((c) => platformCounts[c.defaultPlatform]++);
    const mostUsedPlatform =
      platformCounts.youtube >= platformCounts.spotify ? "youtube" : "spotify";

    return {
      totalServers: configs.length,
      averageQueueSize: Math.round(avgQueueSize),
      averageVolume: Math.round(avgVolume),
      mostUsedPlatform,
    };
  }

  // Validate configuration values
  validateConfig(config: Partial<ServerConfig>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (config.defaultVolume !== undefined) {
      if (config.defaultVolume < 0 || config.defaultVolume > 100) {
        errors.push("Default volume must be between 0 and 100");
      }
    }

    if (config.maxQueueSize !== undefined) {
      if (config.maxQueueSize < 1 || config.maxQueueSize > 1000) {
        errors.push("Max queue size must be between 1 and 1000");
      }
    }

    if (config.autoLeaveTimeout !== undefined) {
      if (config.autoLeaveTimeout < 60 || config.autoLeaveTimeout > 3600) {
        errors.push("Auto leave timeout must be between 60 and 3600 seconds");
      }
    }

    if (config.skipVoteThreshold !== undefined) {
      if (config.skipVoteThreshold < 0.1 || config.skipVoteThreshold > 1.0) {
        errors.push("Skip vote threshold must be between 0.1 and 1.0");
      }
    }

    if (config.embedColor !== undefined) {
      if (!/^#[0-9A-F]{6}$/i.test(config.embedColor)) {
        errors.push("Embed color must be a valid hex color (e.g., #7289da)");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // Schedule save to prevent frequent disk writes
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveConfigsToDisk();
      this.saveTimeout = null;
    }, 5000); // Save after 5 seconds of inactivity
  }

  // Save configurations to disk (placeholder)
  private async saveConfigsToDisk(): Promise<void> {
    try {
      // In a real implementation, you would save to a database
      // For now, we'll just log the save operation
      logger.debug(`Saving ${this.configs.size} server configurations to disk`);

      // Example: Save to JSON file or database
      // await fs.writeFile('configs.json', JSON.stringify(Array.from(this.configs.entries())));
    } catch (error) {
      logger.error("Failed to save configurations to disk:", error);
    }
  }

  // Load configurations from disk (placeholder)
  async loadConfigsFromDisk(): Promise<void> {
    try {
      // In a real implementation, you would load from a database
      logger.info("Loading server configurations from disk");

      // Example: Load from JSON file or database
      // const data = await fs.readFile('configs.json', 'utf8');
      // const configs = JSON.parse(data);
      // this.configs = new Map(configs);
    } catch (error) {
      logger.error("Failed to load configurations from disk:", error);
    }
  }

  // Cleanup old configurations
  async cleanupOldConfigs(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let cleanedCount = 0;
    for (const [guildId, config] of this.configs.entries()) {
      if (config.updatedAt < cutoffDate) {
        this.configs.delete(guildId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old server configurations`);
      this.scheduleSave();
    }

    return cleanedCount;
  }

  // Get all guild IDs with configurations
  getAllGuildIds(): string[] {
    return Array.from(this.configs.keys());
  }

  // Check if guild has custom configuration
  hasCustomConfig(guildId: string): boolean {
    return this.configs.has(guildId);
  }
}

// src/services/AudioFilterService.ts

import { promises as fs } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

export interface AudioFilters {
  bassboost: string;
  nightcore: string;
  vaporwave: string;
  eightD: string;
  karaoke: string;
  vibrato: string;
  tremolo: string;
  surrounding: string;
  pulsator: string;
  subboost: string;
}

export const DEFAULT_FILTERS: Record<keyof AudioFilters, string> = {
  bassboost: "bass=g=15:f=110:w=0.3",
  nightcore: "aresample=48000,asetrate=48000*1.25",
  vaporwave: "aresample=48000,asetrate=48000*0.8",
  eightD: "apulsator=hz=0.09",
  karaoke: "pan=mono|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,highpass=f=1000",
  vibrato: "vibrato=f=6.5:d=0.5",
  tremolo: "tremolo=f=3:d=0.4",
  surrounding: "surround",
  pulsator: "apulsator=hz=1",
  subboost: "asubboost",
};

export class AudioFilterService {
  private static instance: AudioFilterService;
  private tempDir: string;
  private activeFilters: Map<string, Set<keyof AudioFilters>> = new Map();

  private constructor() {
    this.tempDir = join(process.cwd(), "temp", "filters");
    this.ensureTempDir();
  }

  static getInstance(): AudioFilterService {
    if (!AudioFilterService.instance) {
      AudioFilterService.instance = new AudioFilterService();
    }
    return AudioFilterService.instance;
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create temp directory:", error);
    }
  }

  async applyFilters(
    inputStream: string,
    guildId: string,
    filters: (keyof AudioFilters)[]
  ): Promise<string | null> {
    try {
      if (filters.length === 0) {
        return inputStream;
      }

      // Build FFmpeg filter chain
      const filterChain = filters
        .map((filter) => DEFAULT_FILTERS[filter])
        .join(",");

      // Generate output filename
      const outputFile = join(
        this.tempDir,
        `${guildId}-${Date.now()}-filtered.webm`
      );

      // Build FFmpeg command
      const ffmpegCommand = [
        "ffmpeg",
        "-i",
        `"${inputStream}"`,
        "-af",
        `"${filterChain}"`,
        "-c:v",
        "copy",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        "-f",
        "webm",
        `"${outputFile}"`,
        "-y", // Overwrite output file
      ].join(" ");

      // Execute FFmpeg command
      await execAsync(ffmpegCommand, {
        timeout: 30000, // 30 second timeout
      });

      // Check if output file exists
      try {
        await fs.access(outputFile); // Fixed: Using fs.promises.access instead of fs.access
        this.activeFilters.set(guildId, new Set(filters));
        return outputFile;
      } catch {
        logger.error("Output file was not created:", outputFile);
        return null;
      }
    } catch (error) {
      logger.error("Error applying audio filters:", error);
      return null;
    }
  }

  async removeFilters(guildId: string): Promise<void> {
    try {
      // Clear active filters
      this.activeFilters.delete(guildId);

      // Clean up temporary files
      await this.cleanupTempFiles(guildId);
    } catch (error) {
      logger.error("Error removing filters:", error);
    }
  }

  getActiveFilters(guildId: string): (keyof AudioFilters)[] {
    const filters = this.activeFilters.get(guildId);
    return filters ? Array.from(filters) : [];
  }

  async addFilter(
    guildId: string,
    filter: keyof AudioFilters
  ): Promise<boolean> {
    try {
      if (!this.activeFilters.has(guildId)) {
        this.activeFilters.set(guildId, new Set());
      }

      const filters = this.activeFilters.get(guildId)!;
      filters.add(filter);

      return true;
    } catch (error) {
      logger.error("Error adding filter:", error);
      return false;
    }
  }

  async removeFilter(
    guildId: string,
    filter: keyof AudioFilters
  ): Promise<boolean> {
    try {
      const filters = this.activeFilters.get(guildId);
      if (filters) {
        filters.delete(filter);
        if (filters.size === 0) {
          this.activeFilters.delete(guildId);
        }
      }

      return true;
    } catch (error) {
      logger.error("Error removing filter:", error);
      return false;
    }
  }

  async listAvailableFilters(): Promise<(keyof AudioFilters)[]> {
    return Object.keys(DEFAULT_FILTERS) as (keyof AudioFilters)[];
  }

  async validateFilter(filter: string): Promise<boolean> {
    return filter in DEFAULT_FILTERS;
  }

  async getFilterDescription(filter: keyof AudioFilters): Promise<string> {
    const descriptions: Record<keyof AudioFilters, string> = {
      bassboost: "Enhances bass frequencies for deeper sound",
      nightcore: "Increases tempo and pitch for energetic effect",
      vaporwave: "Slows down tempo for dreamy, nostalgic effect",
      eightD: "Creates 8D surround sound effect",
      karaoke: "Removes center vocals for karaoke effect",
      vibrato: "Adds periodic volume variations",
      tremolo: "Adds periodic frequency variations",
      surrounding: "Creates surround sound effect",
      pulsator: "Adds rhythmic pulsing effect",
      subboost: "Enhances sub-bass frequencies",
    };

    return descriptions[filter] || "Unknown filter";
  }

  private async cleanupTempFiles(guildId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      const guildFiles = files.filter((file) => file.startsWith(`${guildId}-`));

      for (const file of guildFiles) {
        try {
          await fs.unlink(join(this.tempDir, file));
        } catch (error) {
          logger.warn(`Failed to delete temp file ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error("Error cleaning up temp files:", error);
    }
  }

  async cleanupAllTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);

      for (const file of files) {
        try {
          await fs.unlink(join(this.tempDir, file));
        } catch (error) {
          logger.warn(`Failed to delete temp file ${file}:`, error);
        }
      }

      logger.info("Cleaned up all temporary filter files");
    } catch (error) {
      logger.error("Error cleaning up all temp files:", error);
    }
  }

  async isFFmpegAvailable(): Promise<boolean> {
    try {
      await execAsync("ffmpeg -version", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

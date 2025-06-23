import { VoiceConnection, AudioPlayer } from "@discordjs/voice";
import type { VideoInfo } from "./providers/IMusicProvider";
import { logger } from "../utils/logger";
import {
  AudioFilterService,
  type AudioFilters,
  DEFAULT_FILTERS,
} from "./AudioFilterService";
import { AutoPlayService } from "./AutoPlayService";

export interface QueueItem extends VideoInfo {
  requestedBy: string; // User ID
  addedAt: Date;
}

export enum RepeatMode {
  OFF = "off",
  TRACK = "track",
  QUEUE = "queue",
}

export class MusicQueue {
  private static instances = new Map<string, MusicQueue>();

  private queue: QueueItem[] = [];
  private currentSong: QueueItem | null = null;
  private isPlaying = false;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;

  // Enhanced properties
  private repeatMode: RepeatMode = RepeatMode.OFF;
  private volume: number = 1.0;
  private history: QueueItem[] = [];
  private autoLeaveTimeout: NodeJS.Timeout | null = null;

  // Audio filters integration
  private activeFilters: Record<keyof AudioFilters, string> = {
    ...DEFAULT_FILTERS,
  };
  private enabledFilters: Set<keyof AudioFilters> = new Set();
  private audioFilterService: AudioFilterService;
  private autoPlayService: AutoPlayService;

  private constructor(private guildId: string) {
    this.audioFilterService = AudioFilterService.getInstance();
    this.autoPlayService = AutoPlayService.getInstance();
  }

  static getQueue(guildId: string): MusicQueue {
    if (!this.instances.has(guildId)) {
      this.instances.set(guildId, new MusicQueue(guildId));
    }
    return this.instances.get(guildId)!;
  }

  static deleteQueue(guildId: string): void {
    const queue = this.instances.get(guildId);
    if (queue) {
      queue.clear();
      this.instances.delete(guildId);
    }
  }

  // Existing methods (keep these as they are)
  add(item: Omit<QueueItem, "addedAt">): QueueItem {
    const queueItem: QueueItem = {
      ...item,
      addedAt: new Date(),
    };

    this.queue.push(queueItem);

    // Trigger autoplay check if enabled
    this.autoPlayService.checkAndAddSongs(this.guildId).catch((error) => {
      logger.warn("AutoPlay check failed:", error);
    });

    return queueItem;
  }

  remove(index: number): QueueItem | null {
    if (index >= 0 && index < this.queue.length) {
      const removed = this.queue.splice(index, 1)[0];
      return removed ?? null;
    }
    return null;
  }

  // Enhanced next() method with repeat logic
  next(): QueueItem | null {
    const current = this.currentSong;

    if (current) {
      this.addToHistory(current);

      // Handle repeat modes
      if (this.repeatMode === RepeatMode.TRACK) {
        return current; // Repeat current song
      }
    }

    const nextItem = this.queue.shift();

    // Handle queue repeat
    if (
      !nextItem &&
      this.repeatMode === RepeatMode.QUEUE &&
      this.history.length > 0
    ) {
      // Restart queue from history (in reverse order)
      this.queue = [...this.history.reverse()];
      this.history = [];
      return this.queue.shift() || null;
    }

    // Trigger autoplay if queue is getting low
    if (this.queue.length <= 2) {
      this.autoPlayService.checkAndAddSongs(this.guildId).catch((error) => {
        logger.warn("AutoPlay check failed:", error);
      });
    }

    return nextItem || null;
  }

  peek(): QueueItem | null {
    const item = this.queue[0];
    return item ?? null;
  }

  // Enhanced clear method
  clear(): void {
    this.queue = [];
    this.currentSong = null;
    this.isPlaying = false;
    this.clearAutoLeaveTimer();

    // Clear audio filters
    this.enabledFilters.clear();
    this.audioFilterService.removeFilters(this.guildId).catch((error) => {
      logger.warn("Failed to clear audio filters:", error);
    });

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this.player = null;
  }

  shuffle(): void {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = this.queue[i];
      const other = this.queue[j];

      if (temp && other) {
        this.queue[i] = other;
        this.queue[j] = temp;
      }
    }
  }

  getQueue(): readonly QueueItem[] {
    return [...this.queue];
  }

  getCurrentSong(): QueueItem | null {
    return this.currentSong;
  }

  setCurrentSong(song: QueueItem | null): void {
    this.currentSong = song;
  }

  setConnection(connection: VoiceConnection | null): void {
    this.connection = connection;
  }

  setPlayer(player: AudioPlayer | null): void {
    this.player = player;
  }

  getConnection(): VoiceConnection | null {
    return this.connection;
  }

  getPlayer(): AudioPlayer | null {
    return this.player;
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    if (playing) {
      this.clearAutoLeaveTimer();
    } else {
      this.startAutoLeaveTimer();
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  // QUEUE MANIPULATION METHODS
  clearQueue(): void {
    this.queue.length = 0;
  }

  removeFromQueue(index: number): QueueItem | null {
    if (index >= 0 && index < this.queue.length) {
      const removed = this.queue.splice(index, 1)[0];
      return removed ?? null;
    }
    return null;
  }

  moveInQueue(from: number, to: number): boolean {
    if (
      from >= 0 &&
      from < this.queue.length &&
      to >= 0 &&
      to < this.queue.length
    ) {
      const song = this.queue.splice(from, 1)[0];
      if (song) {
        this.queue.splice(to, 0, song);
        return true;
      }
    }
    return false;
  }

  // REPEAT MODE METHODS
  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode;
  }

  getRepeatMode(): RepeatMode {
    return this.repeatMode;
  }

  // VOLUME METHODS
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.volume;
  }

  // HISTORY METHODS
  addToHistory(item: QueueItem): void {
    this.history.unshift(item);
    // Keep only last 50 songs in history
    if (this.history.length > 50) {
      this.history = this.history.slice(0, 50);
    }
  }

  getHistory(): readonly QueueItem[] {
    return [...this.history];
  }

  // AUTO-LEAVE METHODS
  startAutoLeaveTimer(): void {
    this.clearAutoLeaveTimer();
    this.autoLeaveTimeout = setTimeout(() => {
      if (this.connection && this.queue.length === 0 && !this.isPlaying) {
        this.connection.destroy();
        this.connection = null;
        logger.info(
          `Auto-left voice channel due to inactivity: ${this.guildId}`
        );
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  clearAutoLeaveTimer(): void {
    if (this.autoLeaveTimeout) {
      clearTimeout(this.autoLeaveTimeout);
      this.autoLeaveTimeout = null;
    }
  }

  // AUDIO FILTERS METHODS
  async enableFilter(filter: keyof AudioFilters): Promise<boolean> {
    try {
      if (await this.audioFilterService.validateFilter(filter)) {
        this.enabledFilters.add(filter);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error enabling filter ${filter}:`, error);
      return false;
    }
  }

  async disableFilter(filter: keyof AudioFilters): Promise<boolean> {
    try {
      this.enabledFilters.delete(filter);
      return true;
    } catch (error) {
      logger.error(`Error disabling filter ${filter}:`, error);
      return false;
    }
  }

  getEnabledFilters(): (keyof AudioFilters)[] {
    return Array.from(this.enabledFilters);
  }

  async clearAllFilters(): Promise<void> {
    try {
      this.enabledFilters.clear();
      await this.audioFilterService.removeFilters(this.guildId);
    } catch (error) {
      logger.error("Error clearing all filters:", error);
    }
  }

  async applyFiltersToStream(streamUrl: string): Promise<string | null> {
    try {
      if (this.enabledFilters.size === 0) {
        return streamUrl;
      }

      const filtersArray = Array.from(this.enabledFilters);
      return await this.audioFilterService.applyFilters(
        streamUrl,
        this.guildId,
        filtersArray
      );
    } catch (error) {
      logger.error("Error applying filters to stream:", error);
      return streamUrl; // Return original stream if filtering fails
    }
  }

  // AUTOPLAY METHODS
  enableAutoPlay(): void {
    this.autoPlayService.enableAutoPlay(this.guildId);
  }

  disableAutoPlay(): void {
    this.autoPlayService.disableAutoPlay(this.guildId);
  }

  isAutoPlayEnabled(): boolean {
    return this.autoPlayService.isEnabled(this.guildId);
  }

  getAutoPlayStats() {
    return this.autoPlayService.getStats(this.guildId);
  }
}

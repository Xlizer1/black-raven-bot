import { VoiceConnection, AudioPlayer } from "@discordjs/voice";
import type { VideoInfo } from "./providers/IMusicProvider";

export interface QueueItem extends VideoInfo {
  requestedBy: string; // User ID
  addedAt: Date;
}

export class MusicQueue {
  private static instances = new Map<string, MusicQueue>();

  private queue: QueueItem[] = [];
  private currentSong: QueueItem | null = null;
  private isPlaying = false;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;

  private constructor(private guildId: string) {}

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

  add(item: Omit<QueueItem, "addedAt">): QueueItem {
    const queueItem: QueueItem = {
      ...item,
      addedAt: new Date(),
    };

    this.queue.push(queueItem);
    return queueItem;
  }

  remove(index: number): QueueItem | null {
    if (index >= 0 && index < this.queue.length) {
      const removed = this.queue.splice(index, 1)[0];
      return removed ?? null;
    }
    return null;
  }

  next(): QueueItem | null {
    const item = this.queue.shift();
    return item !== undefined ? item : null;
  }

  peek(): QueueItem | null {
    const item = this.queue[0];
    return item ?? null;
  }

  clear(): void {
    this.queue = [];
    this.currentSong = null;
    this.isPlaying = false;

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
}

export interface VideoInfo {
  id: string;
  title: string;
  url: string;
  duration?: number;
  thumbnail?: string;
  platform: MusicPlatform;
  artist?: string;
  album?: string;
}

export interface StreamInfo {
  streamUrl: string;
  title: string;
  duration?: number;
  platform: MusicPlatform;
}

export enum MusicPlatform {
  YOUTUBE = "youtube",
  SPOTIFY = "spotify",
  SOUNDCLOUD = "soundcloud",
}

export interface SearchOptions {
  limit?: number;
  type?: "track" | "playlist" | "album";
}

export interface IMusicProvider {
  readonly platform: MusicPlatform;

  // URL validation
  validateUrl(url: string): boolean;

  // Search functionality
  search(query: string, options?: SearchOptions): Promise<VideoInfo[]>;

  // Get stream info
  getStreamInfo(input: string): Promise<StreamInfo | null>;

  // Get track/video details
  getTrackInfo(url: string): Promise<VideoInfo | null>;

  // Platform-specific features
  supportsPlaylists(): boolean;
  supportsDirectStreaming(): boolean;
}

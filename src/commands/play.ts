import { Command } from "@sapphire/framework";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice";
import { GuildMember, MessageFlags } from "discord.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class PlayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("play")
        .setDescription("Play music from YouTube")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Song name or YouTube URL")
            .setRequired(true)
        )
    );
  }

  private isYouTubeURL(url: string): boolean {
    return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/.test(
      url
    );
  }

  private async searchYoutube(
    query: string
  ): Promise<{ url: string; title: string } | null> {
    try {
      const searchCommand = `yt-dlp "ytsearch:${query.replace(
        /"/g,
        '\\"'
      )}" --get-url --get-title --no-playlist -x --audio-format mp3`;
      const { stdout } = await execAsync(searchCommand);
      const lines = stdout.trim().split("\n");

      if (lines.length >= 2 && lines[0] && lines[1]) {
        return {
          title: lines[0],
          url: lines[1],
        };
      }
      return null;
    } catch (error) {
      console.error("Search error:", error);
      return null;
    }
  }

  private async getStreamUrl(
    videoUrl: string
  ): Promise<{ streamUrl: string; title: string } | null> {
    try {
      const command = `yt-dlp "${videoUrl}" --get-url --get-title --format "bestaudio" --no-playlist`;
      const { stdout } = await execAsync(command);
      const lines = stdout.trim().split("\n");

      if (lines.length >= 2 && lines[0] && lines[1]) {
        return {
          title: lines[0],
          streamUrl: lines[1],
        };
      }
      return null;
    } catch (error) {
      console.error("Stream URL error:", error);
      return null;
    }
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    // Check if user is in a voice channel
    const member = interaction.member as GuildMember;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ You need to be in a voice channel to play music!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const query = interaction.options.getString("query", true);

    await interaction.deferReply();

    try {
      let videoUrl = query;
      let videoTitle = "Unknown";

      // If it's not a YouTube URL, search for it
      if (!this.isYouTubeURL(query)) {
        console.log(`Searching for: ${query}`);
        const searchResult = await this.searchYoutube(query);

        if (!searchResult) {
          return interaction.editReply(
            "❌ Couldn't find that song on YouTube!"
          );
        }

        videoUrl = searchResult.url;
        videoTitle = searchResult.title;
        console.log(`Found: ${videoTitle}`);
      }

      // Get stream URL
      console.log(`Getting stream URL for: ${videoUrl}`);
      const streamInfo = await this.getStreamUrl(videoUrl);

      if (!streamInfo) {
        return interaction.editReply(
          "❌ Could not get stream URL for this video!"
        );
      }

      videoTitle = streamInfo.title;
      console.log(`Stream URL obtained for: ${videoTitle}`);

      // Join voice channel
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild!.id,
        adapterCreator: interaction.guild!.voiceAdapterCreator as any,
      });

      // Wait for connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      // Create audio resource from the stream URL
      const resource = createAudioResource(streamInfo.streamUrl, {
        inputType: StreamType.Arbitrary,
      });

      // Create and configure audio player
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      let connectionDestroyed = false;

      const cleanupConnection = () => {
        if (
          !connectionDestroyed &&
          connection.state.status !== VoiceConnectionStatus.Destroyed
        ) {
          connectionDestroyed = true;
          connection.destroy();
        }
      };

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`Now playing: ${videoTitle}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log("Finished playing audio");
        cleanupConnection();
      });

      player.on("error", (error) => {
        console.error("Audio player error:", error.message);
        cleanupConnection();
      });

      // Play the audio
      player.play(resource);
      connection.subscribe(player);

      return interaction.editReply({
        content: `🎵 Now playing: **${videoTitle}**`,
      });
    } catch (error) {
      console.error("Play command error:", error);
      return interaction.editReply(
        "❌ An error occurred while trying to play the song! Make sure yt-dlp is installed on your system."
      );
    }
  }
}

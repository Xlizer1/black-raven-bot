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
import ytdl from "ytdl-core";
import ytsr from "ytsr";

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
      let url = query;
      let videoTitle = "Unknown";

      // If it's not a YouTube URL, search for it
      if (!ytdl.validateURL(query)) {
        console.log(`Searching for: ${query}`);
        const searchResults = await ytsr(query, { limit: 1 });

        if (!searchResults.items.length) {
          return interaction.editReply(
            "❌ Couldn't find that song on YouTube!"
          );
        }

        const firstVideo = searchResults.items.find(
          (item) => item.type === "video"
        ) as any;
        if (!firstVideo) {
          return interaction.editReply(
            "❌ Couldn't find any videos for that search!"
          );
        }

        url = firstVideo.url;
        videoTitle = firstVideo.title;
        console.log(`Found: ${videoTitle} - ${url}`);
      } else {
        // Get video info for display
        try {
          const info = await ytdl.getInfo(url);
          videoTitle = info.videoDetails.title;
        } catch (infoError) {
          console.log(
            "Could not get video info, but will try to stream anyway"
          );
        }
      }

      // Validate the final URL
      if (!ytdl.validateURL(url)) {
        return interaction.editReply("❌ Invalid YouTube URL!");
      }

      // Join voice channel
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild!.id,
        adapterCreator: interaction.guild!.voiceAdapterCreator,
      });

      // Wait for connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      // Create audio stream
      const stream = ytdl(url, {
        filter: "audioonly",
        quality: "lowestaudio",
        highWaterMark: 1 << 25,
      });

      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
      });

      // Create and configure audio player
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`Now playing: ${videoTitle}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log("Finished playing audio");
        connection.destroy();
      });

      player.on("error", (error) => {
        console.error("Audio player error:", error);
        connection.destroy();
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
        "❌ An error occurred while trying to play the song! The video might be restricted or unavailable."
      );
    }
  }
}

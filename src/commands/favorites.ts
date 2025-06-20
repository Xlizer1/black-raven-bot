import { Command } from "@sapphire/framework";
import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { MusicQueue } from "../services/MusicQueue";
import { MusicService } from "../services/MusicService";
import { logger } from "../utils/logger";

// Simple in-memory storage for favorites (in production, use a database)
interface FavoriteItem {
  id: string;
  title: string;
  artist?: string;
  url: string;
  platform: string;
  duration?: number;
  addedAt: Date;
}

class FavoritesStorage {
  private static favorites = new Map<string, FavoriteItem[]>();

  static getFavorites(userId: string): FavoriteItem[] {
    return this.favorites.get(userId) || [];
  }

  static addFavorite(
    userId: string,
    item: Omit<FavoriteItem, "addedAt">
  ): boolean {
    const userFavorites = this.getFavorites(userId);

    // Check if already exists
    const exists = userFavorites.some(
      (fav) => fav.id === item.id || fav.url === item.url
    );
    if (exists) return false;

    const favorite: FavoriteItem = {
      ...item,
      addedAt: new Date(),
    };

    userFavorites.push(favorite);
    this.favorites.set(userId, userFavorites);
    return true;
  }

  static removeFavorite(userId: string, index: number): boolean {
    const userFavorites = this.getFavorites(userId);
    if (index >= 0 && index < userFavorites.length) {
      userFavorites.splice(index, 1);
      this.favorites.set(userId, userFavorites);
      return true;
    }
    return false;
  }

  static clearFavorites(userId: string): number {
    const userFavorites = this.getFavorites(userId);
    const count = userFavorites.length;
    this.favorites.set(userId, []);
    return count;
  }
}

export class FavoritesCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("favorites")
        .setDescription("Manage your personal favorite songs")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription("Show your favorite songs")
            .addIntegerOption((option) =>
              option
                .setName("page")
                .setDescription("Page number to display")
                .setMinValue(1)
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription("Add current song or a specific song to favorites")
            .addStringOption((option) =>
              option
                .setName("song")
                .setDescription(
                  "Song to add (if not specified, adds current song)"
                )
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription("Remove a song from your favorites")
            .addIntegerOption((option) =>
              option
                .setName("position")
                .setDescription(
                  "Position of the song to remove (use /favorites list to see positions)"
                )
                .setMinValue(1)
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("play")
            .setDescription("Play songs from your favorites")
            .addIntegerOption((option) =>
              option
                .setName("position")
                .setDescription(
                  "Position of the song to play (if not specified, plays all)"
                )
                .setMinValue(1)
                .setRequired(false)
            )
            .addBooleanOption((option) =>
              option
                .setName("shuffle")
                .setDescription("Shuffle favorites before adding to queue")
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("clear")
            .setDescription("Clear all your favorite songs")
        )
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "list":
        return this.listFavorites(interaction);
      case "add":
        return this.addFavorite(interaction);
      case "remove":
        return this.removeFavorite(interaction);
      case "play":
        return this.playFavorites(interaction);
      case "clear":
        return this.clearFavorites(interaction);
      default:
        return interaction.reply({
          content: "❌ Unknown subcommand!",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async listFavorites(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const page = interaction.options.getInteger("page") || 1;
    const itemsPerPage = 10;
    const favorites = FavoritesStorage.getFavorites(interaction.user.id);

    if (favorites.length === 0) {
      return interaction.reply({
        content:
          "💖 **Your favorites list is empty!**\n\n" +
          "💡 **How to add favorites:**\n" +
          "• Use `/favorites add` while a song is playing\n" +
          "• Use `/favorites add <song name>` to search and add\n" +
          "• Use the ⭐ reaction on now playing messages",
        flags: MessageFlags.Ephemeral,
      });
    }

    const totalPages = Math.ceil(favorites.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, favorites.length);

    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle("💖 Your Favorite Songs")
      .setDescription(
        `You have ${favorites.length} favorite song${
          favorites.length === 1 ? "" : "s"
        }`
      )
      .setTimestamp();

    // Create favorites list
    const favoritesText = favorites
      .slice(startIndex, endIndex)
      .map((fav, index) => {
        const position = startIndex + index + 1;
        const duration = fav.duration
          ? MusicService.formatDuration(fav.duration)
          : "Unknown";
        const platformEmoji = this.getPlatformEmoji(fav.platform);
        const artist = fav.artist ? ` - ${fav.artist}` : "";
        const timeAgo = this.getTimeAgo(fav.addedAt);

        return (
          `**${position}.** ${platformEmoji} ${fav.title}${artist}\n` +
          `⏱️ ${duration} • 📅 Added ${timeAgo}`
        );
      })
      .join("\n\n");

    embed.addFields({
      name: `🎵 Favorites (${favorites.length} total)`,
      value: favoritesText,
      inline: false,
    });

    // Add statistics
    const platformCounts = this.getPlatformStats(favorites);
    const totalDuration = favorites.reduce(
      (total, fav) => total + (fav.duration || 0),
      0
    );

    embed.addFields({
      name: "📊 Statistics",
      value:
        `🎵 **Total songs:** ${favorites.length}\n` +
        `⏱️ **Total duration:** ${MusicService.formatDuration(
          totalDuration
        )}\n` +
        `🎯 **Platforms:** ${platformCounts}`,
      inline: false,
    });

    if (totalPages > 1) {
      embed.setFooter({
        text: `Page ${page}/${totalPages} • Use /favorites list <page> to navigate`,
      });
    }

    // Create action buttons
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("favorites_play_all")
        .setLabel("Play All")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("▶️"),
      new ButtonBuilder()
        .setCustomId("favorites_shuffle_play")
        .setLabel("Shuffle & Play")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔀"),
      new ButtonBuilder()
        .setCustomId("favorites_export")
        .setLabel("Export List")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📤")
    );

    return interaction.reply({
      embeds: [embed],
      components: [buttonRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async addFavorite(interaction: Command.ChatInputCommandInteraction) {
    const songQuery = interaction.options.getString("song");

    if (songQuery) {
      // User specified a song to search for and add
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const searchResults = await MusicService.search(songQuery, undefined, {
          limit: 1,
        });

        if (searchResults.length === 0) {
          return interaction.editReply(`❌ No songs found for "${songQuery}"`);
        }

        const song = searchResults[0];
        if (!song) {
          return interaction.editReply("❌ Failed to get song information");
        }

        const success = FavoritesStorage.addFavorite(interaction.user.id, {
          id: song.id,
          title: song.title,
          artist: song.artist,
          url: song.url,
          platform: song.platform,
          duration: song.duration,
        });

        if (success) {
          const platformEmoji = this.getPlatformEmoji(song.platform);
          const artist = song.artist ? ` - ${song.artist}` : "";

          return interaction.editReply({
            content:
              `⭐ **Added to favorites!**\n\n` +
              `${platformEmoji} **${song.title}**${artist}\n` +
              `🎵 Platform: ${song.platform}\n\n` +
              `💖 You now have ${
                FavoritesStorage.getFavorites(interaction.user.id).length
              } favorite songs`,
          });
        } else {
          return interaction.editReply(
            "❌ This song is already in your favorites!"
          );
        }
      } catch (error) {
        logger.error("Error adding favorite song:", error);
        return interaction.editReply("❌ Failed to add song to favorites!");
      }
    } else {
      // Add current playing song
      if (!interaction.guild) {
        return interaction.reply({
          content: "❌ This command can only be used in a server!",
          flags: MessageFlags.Ephemeral,
        });
      }

      const queue = MusicQueue.getQueue(interaction.guild.id);
      const currentSong = queue.getCurrentSong();

      if (!currentSong) {
        return interaction.reply({
          content:
            "❌ No song is currently playing! Use `/favorites add <song name>` to search for a specific song.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const success = FavoritesStorage.addFavorite(interaction.user.id, {
        id: currentSong.id,
        title: currentSong.title,
        artist: currentSong.artist,
        url: currentSong.url,
        platform: currentSong.platform,
        duration: currentSong.duration,
      });

      if (success) {
        const platformEmoji = this.getPlatformEmoji(currentSong.platform);
        const artist = currentSong.artist ? ` - ${currentSong.artist}` : "";

        return interaction.reply({
          content:
            `⭐ **Added to favorites!**\n\n` +
            `${platformEmoji} **${currentSong.title}**${artist}\n` +
            `👤 Originally requested by: <@${currentSong.requestedBy}>\n\n` +
            `💖 You now have ${
              FavoritesStorage.getFavorites(interaction.user.id).length
            } favorite songs`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        return interaction.reply({
          content: "❌ This song is already in your favorites!",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private async removeFavorite(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const position = interaction.options.getInteger("position", true);
    const favorites = FavoritesStorage.getFavorites(interaction.user.id);

    if (favorites.length === 0) {
      return interaction.reply({
        content: "❌ Your favorites list is empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (position > favorites.length) {
      return interaction.reply({
        content: `❌ Invalid position! You only have ${
          favorites.length
        } favorite song${
          favorites.length === 1 ? "" : "s"
        }.\nUse \`/favorites list\` to see your favorites.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const removedSong = favorites[position - 1];
    const success = FavoritesStorage.removeFavorite(
      interaction.user.id,
      position - 1
    );

    if (success && removedSong) {
      const platformEmoji = this.getPlatformEmoji(removedSong.platform);
      const artist = removedSong.artist ? ` - ${removedSong.artist}` : "";

      return interaction.reply({
        content:
          `💔 **Removed from favorites:**\n\n` +
          `${platformEmoji} **${removedSong.title}**${artist}\n` +
          `📍 Was at position: ${position}\n\n` +
          `💖 You now have ${
            FavoritesStorage.getFavorites(interaction.user.id).length
          } favorite songs`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      return interaction.reply({
        content: "❌ Failed to remove song from favorites!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async playFavorites(
    interaction: Command.ChatInputCommandInteraction
  ) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const position = interaction.options.getInteger("position");
    const shouldShuffle = interaction.options.getBoolean("shuffle") || false;
    const favorites = FavoritesStorage.getFavorites(interaction.user.id);

    if (favorites.length === 0) {
      return interaction.reply({
        content:
          "❌ Your favorites list is empty! Add some songs first with `/favorites add`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const queue = MusicQueue.getQueue(interaction.guild.id);
      let songsToAdd: FavoriteItem[];

      if (position) {
        // Play specific song
        if (position > favorites.length) {
          return interaction.editReply(
            `❌ Invalid position! You only have ${favorites.length} favorite songs.`
          );
        }
        songsToAdd = [favorites[position - 1]!];
      } else {
        // Play all favorites
        songsToAdd = [...favorites];
        if (shouldShuffle) {
          this.shuffleArray(songsToAdd);
        }
      }

      let addedCount = 0;
      for (const favorite of songsToAdd) {
        try {
          queue.add({
            id: favorite.id,
            title: favorite.title,
            url: favorite.url,
            duration: favorite.duration,
            thumbnail: undefined,
            platform: favorite.platform as any,
            artist: favorite.artist,
            album: undefined,
            requestedBy: interaction.user.id,
          });
          addedCount++;
        } catch (error) {
          logger.warn(
            `Failed to add favorite to queue: ${favorite.title}`,
            error
          );
        }
      }

      if (addedCount === 0) {
        return interaction.editReply(
          "❌ Failed to add any songs to the queue!"
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle("💖 Added Favorites to Queue")
        .addFields(
          {
            name: "✅ Songs Added",
            value: addedCount.toString(),
            inline: true,
          },
          {
            name: "📋 Queue Position",
            value: `${queue.size() - addedCount + 1}-${queue.size()}`,
            inline: true,
          },
          {
            name: "🔀 Shuffled",
            value: shouldShuffle ? "Yes" : "No",
            inline: true,
          }
        );

      if (position) {
        const song = songsToAdd[0]!;
        const platformEmoji = this.getPlatformEmoji(song.platform);
        embed.setDescription(
          `${platformEmoji} **${song.title}**${
            song.artist ? ` - ${song.artist}` : ""
          }`
        );
      } else {
        embed.setDescription(
          `Added ${addedCount} of your favorite songs to the queue`
        );
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error("Error playing favorites:", error);
      return interaction.editReply(
        "❌ An error occurred while adding favorites to the queue!"
      );
    }
  }

  private async clearFavorites(
    interaction: Command.ChatInputCommandInteraction
  ) {
    const favorites = FavoritesStorage.getFavorites(interaction.user.id);

    if (favorites.length === 0) {
      return interaction.reply({
        content: "❌ Your favorites list is already empty!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const clearedCount = FavoritesStorage.clearFavorites(interaction.user.id);

    return interaction.reply({
      content:
        `💔 **Cleared all favorites!**\n\n` +
        `🗑️ Removed ${clearedCount} song${
          clearedCount === 1 ? "" : "s"
        } from your favorites\n\n` +
        `💡 You can start building your favorites again with \`/favorites add\``,
      flags: MessageFlags.Ephemeral,
    });
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      const other = array[j];

      if (temp !== undefined && other !== undefined) {
        array[i] = other;
        array[j] = temp;
      }
    }
  }

  private getPlatformEmoji(platform: string): string {
    switch (platform.toLowerCase()) {
      case "youtube":
        return "📺";
      case "spotify":
        return "🟢";
      case "soundcloud":
        return "🟠";
      default:
        return "🎵";
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ago`;
    } else {
      return "just now";
    }
  }

  private getPlatformStats(favorites: FavoriteItem[]): string {
    const platformCounts: { [key: string]: number } = {};

    favorites.forEach((fav) => {
      const platform = fav.platform.toLowerCase();
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    });

    return Object.entries(platformCounts)
      .map(([platform, count]) => {
        const emoji = this.getPlatformEmoji(platform);
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        return `${emoji} ${name}: ${count}`;
      })
      .join(" • ");
  }
}

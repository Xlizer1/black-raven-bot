# Black Raven Bot 🎵

A Discord music bot built with the Sapphire Framework and Bun runtime.

## Features

- 🎶 Play music from YouTube and Spotify (search or direct URLs)
- 🔍 **Real-time autocomplete** for song suggestions as you type
- 📋 Music queue system with shuffle support
- ⏯️ Playback controls (play, stop, skip)
- 🔊 Voice channel integration
- 🛡️ Error handling and input validation
- 📝 Comprehensive logging
- ⚡ Performance optimizations with caching

## Prerequisites

- [Bun](https://bun.sh) v1.2.13 or higher
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed system-wide
- Discord bot token

## Installation

1. **Clone the repository**

   ```bash
   git clone <your-repo-url>
   cd black-raven-bot
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Install yt-dlp**

   ```bash
   # On Arch Linux
   sudo pacman -S yt-dlp

   # On Ubuntu/Debian
   sudo apt install yt-dlp

   # Or via pip
   pip install yt-dlp
   ```

4. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your bot token and preferences
   ```

5. **Start the bot**

   ```bash
   # Development mode (with hot reload)
   bun run watch

   # Production mode
   bun run start
   ```

## Commands

- `/ping` - Check if the bot is responsive
- `/play <song name or URL>` - Play music from YouTube or Spotify
  - **✨ Features autocomplete!** Start typing and see song suggestions
  - Choose platform with the `platform` option
- `/stop` - Stop music and clear queue
- `/cache clear` - Clear autocomplete cache (for troubleshooting)
- `/cache status` - Show cache statistics

## Using Autocomplete

The `/play` command now features real-time autocomplete:

1. Start typing `/play query: `
2. Begin entering a song name (e.g., "bohemian rhap...")
3. Watch as suggestions appear automatically
4. Click on a suggestion to select it instantly

**Tips:**

- Autocomplete works best with at least 2 characters
- Results are cached for 5 minutes for faster responses
- URLs won't trigger autocomplete (they don't need it!)

## Project Structure

```
src/
├── commands/           # Slash commands (play, stop, cache, etc.)
├── services/          # Business logic
│   ├── providers/     # Music platform providers (YouTube, Spotify)
│   ├── MusicService.ts    # Main music service
│   ├── MusicQueue.ts      # Queue management
│   └── AutocompleteCache.ts # Caching for performance
├── utils/            # Utilities (logger)
├── config/           # Configuration management
└── index.ts          # Bot entry point
```

## Configuration

See `.env.example` for all available configuration options, including:

- Discord bot token
- Spotify API credentials (optional)
- Performance tuning settings
- Logging levels

## Performance Features

- **Smart caching**: Autocomplete results are cached for faster responses
- **Optimized searches**: Lightweight queries for real-time suggestions
- **Timeout protection**: Aggressive timeouts prevent Discord interaction failures
- **Platform detection**: Automatically detects YouTube/Spotify URLs

## Troubleshooting

**Autocomplete not working?**

- Check that yt-dlp is installed and up to date
- Try `/cache clear` to reset the cache
- Ensure your query is at least 2 characters long

**Search timeouts?**

- The bot uses aggressive timeouts (1.5-2s) for autocomplete
- This prevents Discord interaction failures
- Regular searches use longer timeouts for better results

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (especially autocomplete performance)
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

# Black Raven Bot 🎵

A Discord music bot built with the Sapphire Framework and Bun runtime.

## Features

- 🎶 Play music from YouTube (search or direct URLs)
- 📋 Music queue system with shuffle support
- ⏯️ Playback controls (play, stop, skip)
- 🔊 Voice channel integration
- 🛡️ Error handling and input validation
- 📝 Comprehensive logging

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
- `/play <song name or URL>` - Play music from YouTube
- `/stop` - Stop music and clear queue

## Project Structure

```
src/
├── commands/           # Slash commands
├── services/          # Business logic (MusicService, MusicQueue)
├── utils/            # Utilities (logger)
├── config/           # Configuration management
└── index.ts          # Bot entry point
```

## Configuration

See `.env.example` for all available configuration options.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

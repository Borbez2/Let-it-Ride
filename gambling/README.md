# Gambling Bot

A Discord gambling and economy bot with blackjack, roulette, mines, and daily pool events.

## Requirements

- Node.js 18+
- A Discord application and bot token

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```bash
TOKEN=your_bot_token
CLIENT_ID=your_app_client_id
GUILD_ID=your_guild_id
ANNOUNCE_CHANNEL_ID=channel_id_for_announcements
ADMIN_IDS=comma,separated,discord_user_ids
```

3. Start the bot:

```bash
node bot.js
```

## Commands (high level)

- Economy: `balance`, `daily`, `give`, `deposit`, `withdraw`, `bank`
- Games: `flip`, `dice`, `blackjack`, `roulette`, `mines`, `duel`, `letitride`
- Social: `leaderboard`, `inventory`, `collection`, `pool`, `mysterybox`
- Admin: `admin ...`

Data is stored locally in JSON files under `data/`.

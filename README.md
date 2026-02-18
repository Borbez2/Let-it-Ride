# Let it Ride

A Discord economy + gambling bot built with `discord.js` and `better-sqlite3`.

It includes:
- Wallets with purse + bank
- Daily rewards with streak scaling
- Multiple games (flip, dice, roulette, blackjack, mines, duel, let-it-ride)
- Upgrade system (interest, cashback, spin multiplier)
- Collectibles + mystery boxes + trading
- Universal income pool (hourly) + loss pool daily spin
- Giveaways and persistent interactive sessions

---

## Tech Stack

- Node.js (CommonJS)
- `discord.js` v14
- `better-sqlite3`
- `dotenv`
- SQLite database at `data/gambling.db`

---

## Requirements

- Node.js 18+
- A Discord application + bot token
- Bot invited to your server with application commands permissions

---

## Installation

1. Install dependencies:

```bash
npm install
```

2. Copy the example env file:

```bash
cp .env.example .env
```

3. Edit `.env` with your values (template below):

```env
TOKEN=your_bot_token
CLIENT_ID=your_discord_app_client_id
GUILD_ID=your_discord_guild_id
ANNOUNCE_CHANNEL_ID=channel_id_for_announcements
ADMIN_IDS=comma,separated,discord_user_ids
STATS_RESET_ADMIN_IDS=comma,separated,discord_user_ids_optional
```

### Environment variables

- `TOKEN` (required): bot token
- `CLIENT_ID` (required): Discord application ID
- `GUILD_ID` (required): guild where slash commands are registered
- `ANNOUNCE_CHANNEL_ID` (optional): used for announcement flows
- `ADMIN_IDS` (optional but recommended): IDs allowed to use `/admin`
- `STATS_RESET_ADMIN_IDS` (optional): IDs allowed to use `/admin resetstats`
	- Falls back to `ADMIN_IDS` if not set

If `TOKEN`, `CLIENT_ID`, or `GUILD_ID` are missing, bot startup exits immediately.

---

## Running

```bash
node bot.js
```

On startup, the bot:
1. Logs in
2. Registers guild slash commands
3. Schedules recurring jobs
4. Restores persisted runtime sessions (active games/trades/giveaways)

---

## Data & Persistence

Primary storage is SQLite (`data/gambling.db`) with these main tables:
- `wallets`
- `pool`
- `runtime_state`

### Migration behavior

On first run with an empty `wallets` table:
- If `wallets.json` exists, wallet data is migrated into SQLite
- If `pool.json` exists and pool row is empty, pool data is migrated

### Persisted runtime sessions

In-progress interactions survive restarts via `runtime_state`, including:
- blackjack sessions
- mines sessions
- simple game sessions (dice/roulette/ride/duel)
- trade sessions
- giveaway state

---

## Economy Model

### Starting values

- New wallet starts with `1000` coins (purse)
- Daily base reward is `500`
- Daily streak bonus is `+50` per extra streak day

### Bank system

- Players can move coins between purse and bank
- Base bank rate: `1%` daily
- Interest upgrade adds `+1%` daily per level (up to level 10)
- Interest is processed hourly (compounded by whole elapsed hours)

### Pools

- **Universal Pool**: funded by win tax (`5%` of profits)
	- Distributed equally to all wallets every hour
	- Paid into bank
- **Loss Pool**: funded by loss tax (`5%` of losses)
	- Paid once daily at scheduled spin time to one weighted winner

### Upgrade paths

- **Interest Level** (0–10)
- **Cashback Level** (0–10)
	- Cashback is currently `level * 0.1%` on losses
- **Spin Mult Level** (0–10)
	- Adds daily spin weight (`1 + level`)

---

## Games

All bet amount inputs support abbreviated formats like:
- `100`
- `4.7k`, `1.2m`, `1b`
- `all`

### `/flip`
- 50/50 coin flip
- Optional quantity `1-10`
- Multi-flip returns net result across all flips

### `/dice`
- Pick high (`4-6`) or low (`1-3`)
- Win doubles stake outcome style (profit = bet)

### `/roulette`
- Bets on red, black, or green `0`
- Red/black: 2x total return style (profit = bet)
- Green: 14x total return style (profit = 13x bet)

### `/allin17black`
- Special high-risk roulette mode
- Bets full current balance on exact `17`
- Hit pays `36x` total

### `/blackjack`
- Supports hit, stand, double, split
- Natural blackjack payout: 2.5x total return (1.5x profit)
- Active hands persist across bot restarts

### `/mines`
- 4x5 grid (20 tiles), choose `1-15` mines
- Revealing safe tiles increases multiplier
- Can cash out anytime after first reveal

### `/letitride`
- First win check, then optional repeated double-or-bust rides
- Cash out at any step or risk for another double

### `/duel`
- Challenge another user
- Both sides stake the same amount
- Winner takes both stakes

---

## Collectibles & Mystery Boxes

- `/mysterybox [quantity]` buys boxes (cost: `5,000` each)
- 120 placeholder collectibles across 7 rarities
- Duplicate placeholder drops pay rarity-based compensation instead
- `/inventory` shows owned collectibles
- `/collection` shows top collectors by unique count
- `/trade` allows user-to-user coin + item trades

Duplicate compensation values:
- ⬜ Common: `2,000`
- 🟩 Uncommon: `3,500`
- 🟦 Rare: `6,000`
- 🟪 Epic: `12,000`
- 🟨 Legendary: `20,000`
- 🩷 Mythic: `60,000`
- 🩵 Divine: `150,000`

Rarities used:
- common
- uncommon
- rare
- epic
- legendary
- mythic
- divine

---

## Giveaways

- `/giveaway` opens modal to create giveaway
- Host sets amount + duration (1 to 1440 minutes)
- Coins are held from host immediately
- Participants join via button in giveaway channel
- Expired giveaways are checked every 30 seconds
	- If participants exist: random winner gets prize
	- If none: host is refunded

---

## Commands Reference

### Economy / Progress
- `/balance`
- `/daily`
- `/deposit amount`
- `/invest amount` (alias of deposit)
- `/withdraw amount`
- `/bank`
- `/give user amount`
- `/leaderboard`
- `/pool`
- `/upgrades`
- `/stats [user|username]`

### Games
- `/flip amount [quantity]`
- `/dice amount`
- `/roulette amount`
- `/allin17black`
- `/blackjack amount`
- `/mines amount mines`
- `/letitride amount`
- `/duel opponent amount`

### Collectibles / Social
- `/mysterybox [quantity]`
- `/inventory [page]`
- `/collection`
- `/trade user`
- `/help [topic]`
- `/giveaway`

### Admin
- `/admin give user amount`
- `/admin set user amount`
- `/admin reset user`
- `/admin resetupgrades user`
- `/admin forcespin`
- `/admin forcepoolpayout`
- `/admin start`
- `/admin stop`
- `/admin resetstats user` (restricted to `STATS_RESET_ADMIN_IDS`)

---

## Scheduled Jobs

Configured in `bot.js`:

- **Hourly (aligned to next UTC hour):**
	- bank interest processing
	- universal pool distribution

- **Daily at 11:15 (server local time):**
	- daily spin execution
	- daily leaderboard post

- **Every 30 seconds:**
	- giveaway expiration check

> Note: channel IDs for daily spin and hourly payout are currently hardcoded in `bot.js`.

---

## Project Layout

```text
bot.js                # startup, command registration, scheduling, interaction router
config.js             # economy constants, upgrade costs, collectible pools
commands/
	admin.js            # admin slash command logic
	economy.js          # economy, upgrades, collectibles, trading, giveaway flow
	help.js             # help topics
	stats.js            # user stats rendering
games/
	blackjack.js        # blackjack gameplay + split/double flow
	mines.js            # mines game logic
	simple.js           # flip, dice, roulette, duel, let-it-ride
	cards.js            # deck + card utilities
data/
	store.js            # sqlite access layer, migration, persistence, stats tracking
```

---

## Operational Notes

- Command registration is guild-scoped (fast updates, one guild target)
- Wallet is auto-created the first time a user interacts
- Most user-facing balance changes are persisted immediately
- If bot is stopped with `/admin stop`, non-admin interactions are blocked
- On any interaction error, bot attempts a safe fallback reply

---

## Troubleshooting

### Bot exits with "Missing env vars."
Ensure `TOKEN`, `CLIENT_ID`, and `GUILD_ID` are set in `.env`.

### Slash commands not updating
- Confirm bot started successfully and command registration completed
- Ensure `CLIENT_ID` and `GUILD_ID` match the target application/server

### No messages in scheduled channels
- Verify bot has access to channel IDs used by scheduler/giveaway flows
- Check `View Channel`, `Send Messages`, `Manage Messages` permissions

### Database issues
- Ensure process has write permission to `data/`
- Stop bot before replacing DB files manually

---

## Security / Fairness Notes

- Random outcomes rely on `Math.random()` (not cryptographically secure)
- Admin commands can directly alter balances and states
- This bot is for community entertainment, not regulated wagering

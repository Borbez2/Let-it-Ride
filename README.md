# Let it Ride

## It is still currently under development and some features may not work properly!

Let it Ride is a Discord economy + gambling bot built on `discord.js` and `better-sqlite3`.

It has wallets (purse + bank), daily streak rewards, multiple games, upgrades, collectibles, mystery boxes, trading, giveaways, persistent sessions, and scheduled economy events.

## What it runs on

- Node.js (CommonJS), `discord.js` v14, `better-sqlite3`, `dotenv`
- SQLite database at `data/gambling.db`

## Setup

Requirements:

- Node.js 18+
- Discord application + bot token
- Bot invited with app commands permission

Install:

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```env
TOKEN=your_bot_token
CLIENT_ID=your_discord_app_client_id
GUILD_ID=your_discord_guild_id
ANNOUNCE_CHANNEL_ID=channel_id_for_announcements
ADMIN_IDS=comma,separated,discord_user_ids
STATS_RESET_ADMIN_IDS=comma,separated,discord_user_ids_optional
```

Notes:

- `TOKEN`, `CLIENT_ID`, `GUILD_ID` are required.
- `STATS_RESET_ADMIN_IDS` falls back to `ADMIN_IDS` when omitted.

Run:

```bash
node bot.js
```

On startup the bot registers slash commands, restores active sessions from `runtime_state`, starts scheduled jobs, and starts database backups.

## Data model and persistence

Primary tables in `data/gambling.db`:

- `wallets`
- `pool`
- `runtime_state`

On first run, if `wallets` is empty, old JSON files are migrated when present.

Persistent session state (so interactions survive restart) includes:

- blackjack
- mines
- simple games (dice/roulette/ride/duel)
- trades
- giveaways

## Economy and gameplay summary

- New wallet starts with `1000` coins.
- Daily base reward is `500` with `+50` per streak day.
- Bank pays hourly from accrued interest (base `1%` daily + upgrades + item bonuses).
- Universal pool is funded by win tax and distributed hourly.
- Loss pool is funded by loss tax and used for daily spin payout.
- Upgrades cover interest, cashback, spin weight, and universal-income double chance.
- Collectibles can add passive bonuses (interest, cashback, mystery luck, EV boosts, mines reveal save).

Supported games:

- `/flip` (single or multi)
- `/dice`
- `/roulette`
- `/allin17black`
- `/blackjack`
- `/mines`
- `/letitride`
- `/duel`

Amount parsing supports `100`, `4.7k`, `1.2m`, `1b`, and `all`.

## Commands

Economy / utility:

- `/balance`, `/daily`, `/deposit`, `/invest`, `/withdraw`, `/bank`
- `/give`, `/leaderboard`, `/pool`, `/upgrades`
- `/stats [user|username]`

Collectibles / social:

- `/mysterybox [quantity]`, `/inventory [page]`, `/collection`, `/trade user`
- `/giveaway`
- `/help [topic]`

Admin entrypoint:

- `/admin <subcommand>`

## Scheduled jobs

- Hourly: bank processing + universal pool distribution
- Daily at 11:15 local server time: daily spin cycle
- Every 30s: giveaway expiry check
- Hourly (top of hour): database backup creation

## Database backups (detailed)

The bot now performs automatic local backups in `backups/` with tiered retention.

### What gets backed up

Each snapshot writes:

- `gambling.db` (created via SQLite online backup API, not a blind file copy)
- `gambling.db-wal` if present
- `gambling.db-shm` if present
- `meta.json` with timestamp and backup metadata

Before snapshotting, the bot runs a passive WAL checkpoint to improve consistency of sidecar files.

### When backups run

- Once on startup (`reason: startup`)
- Then every hour, aligned to the next hour boundary (`reason: hourly`)

### Folder layout

Backups are organized as:

```text
backups/
  hourly/
    YYYY-MM-DD/
      HH-mm-ss/
        gambling.db
        gambling.db-wal (if present)
        gambling.db-shm (if present)
        meta.json
  legacy/
    flat-backup-files/
    data-pre-restore/
```

Old loose backup clutter is automatically moved into `backups/legacy/...`.

### Retention policy

Retention is automatic and runs after each snapshot:

1. Keep all hourly snapshots for the last 7 days.
2. For snapshots older than 7 days and newer than 30 days, keep only the latest snapshot per day.
3. For snapshots older than 30 days, keep only the latest snapshot per month.

This gives:

- up to `24 * 7 = 168` recent hourly points
- then one per day for the rest of the month window
- then one per month indefinitely

### Git behavior (no commits of backups)

Generated backup folders are ignored with:

- `backups/**`
- exception for `backups/README.md`

So backup data stays local and won’t be committed unless you intentionally override ignore rules.

### Safe restore guidance

If you need to restore manually:

1. Stop the bot.
2. Choose one snapshot folder in `backups/hourly/...`.
3. Copy `gambling.db` to `data/gambling.db`.
4. If that snapshot includes `gambling.db-wal` and `gambling.db-shm`, copy those too.
5. Start the bot.

Do not mix `db` from one snapshot with `wal/shm` from another snapshot.

#### Partial stat/xp restoration

Sometimes you only want to recover specific pieces of player state (for
example, win/loss counts and experience) without overwriting balances,
inventory, or other live data. A helper script is provided for that
purpose:

```sh
# dry-run will show what would change without touching the live DB
node scripts/restore-stats.js --dry-run \
  /absolute/path/to/backups/hourly/2026-02-24/23-00-00/gambling.db

# and when you're happy:
node scripts/restore-stats.js \
  /absolute/path/to/backups/hourly/2026-02-24/23-00-00/gambling.db
```

The script will:

1. open the backup and current databases side‑by‑side
2. copy each wallet's game `wins`/`losses`, `xp` and `totalGamesPlayed`
3. correct any XP mismatch by recalculating as `totalGamesPlayed * XP_PER_GAME`
4. leave every other field intact

Stop the bot before running the script to prevent concurrent writes.

It’s safe to run repeatedly; wallets not present in the live database are
ignored and only the targeted fields are merged.

## Project layout

## Resetting player statistics

A helper script exists for clearing game records and experience for all
wallets. This is typically run with the bot stopped and may be used to
start a new season or fix corrupted stats.

```sh
# wipe everything except balances/inventory; backfill XP from an old snapshot
node scripts/wipe-stats.js --backup /path/to/old/gambling.db

# wipe stats and **zero all XP** without touching backups
node scripts/wipe-stats.js --zero-xp
```

The script will also reset net worth/xp/collectible histories and various
lifetime counters. See the header comment in
`scripts/wipe-stats.js` for full details.

## Project layout

```text
bot.js                startup, command registration, scheduling, routing
config.js             central config and legacy export aliases
commands/             command handlers
games/                game logic
data/store.js         sqlite access, migration, state persistence
utils/dbBackup.js     backup scheduler + retention + legacy cleanup
```

## Troubleshooting

Bot exits with missing env vars:

- Set `TOKEN`, `CLIENT_ID`, and `GUILD_ID` in `.env`.

Slash commands not updating:

- Check that the bot logged in and command registration succeeded.
- Confirm `CLIENT_ID` and `GUILD_ID` are correct for the target server.

Database restore/backup confusion:

- Stop the bot before replacing database files.
- Restore matching `db`/`wal`/`shm` from the same timestamp folder.

## Notes

- Random outcomes use `Math.random()` (not cryptographic randomness).
- Admin commands can directly alter balances and state.
- Intended for community entertainment, not regulated wagering.

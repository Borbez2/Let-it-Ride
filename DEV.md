# Developer Reference

Technical details for anyone working on or hosting the bot.

---

## Setup

**Requirements:** Node.js 18+, a Discord application with bot token, bot invited with `applications.commands` scope.

```bash
npm install
cp .env.example .env
# fill in .env then:
node bot.js
```

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Discord application client ID |
| `GUILD_ID` | ✅ | Target Discord server ID |
| `ANNOUNCE_CHANNEL_ID` | | Channel for announcements |
| `ADMIN_IDS` | | Comma-separated admin user IDs |
| `STATS_RESET_ADMIN_IDS` | | Falls back to `ADMIN_IDS` |

On startup the bot registers slash commands, restores active sessions from `runtime_state`, starts schedulers, and begins database backups.

---

## Project Layout

```
bot.js              Entry point — commands, interaction routing, schedulers
config.js           Central config — all tuning, game params, economy constants
data/store.js       SQLite layer — all economy read/write, balance management

commands/
  help.js           Interactive paginated help embed
  admin.js          Admin-only management commands
  effects.js        Player effects/buffs display (tabbed embed)
  shop.js           Shop UI — upgrades, potions, mystery boxes
  stats.js          Game statistics and analytics
  balance.js        Balance, daily, deposit, withdraw
  bank.js           Bank overview and breakdown
  pool.js           Universal & Spin pool info
  give.js           Player-to-player coin transfer
  trade.js          Item trading with modals
  leaderboard.js    Leaderboard and net worth graphs
  inventory.js      Collectible inventory browser
  giveaway.js       Giveaway creation and participation

games/
  shared.js         Shared utilities (pity announcements)
  cards.js          Card deck utilities
  flip.js           Coin flip
  roulette.js       Roulette + All-In 17 Black
  blackjack.js      Blackjack with split support
  mines.js          Mines grid with charm saves
  letitride.js      Let It Ride double-or-bust
  duel.js           Player vs player duel

utils/
  binomial.js       Binomial distribution for pity system
  dbBackup.js       Automated hourly SQLite backups
  renderChart.js    Server-side chart rendering (chart.js)
  graphBuilder.js   Graph data builder

scripts/
  restore-stats.js  Restore specific stats from a backup
  wipe-stats.js     Reset game records / start a new season
```

---

## Data Model

Primary tables in `data/gambling.db`:

| Table | Purpose |
|-------|---------|
| `wallets` | Per-user balances, upgrade levels, inventory (JSON), stats (JSON) |
| `pool` | Universal pool, spin pool, last payout timestamps |
| `runtime_state` | Key-value store for persistent session state |

Sessions (blackjack, mines, trades, duels, giveaways) are held in memory `Map`s and persisted to `runtime_state` via `store.setRuntimeState()` for restart survival.

---

## Architecture Notes

- **Interaction routing:** `bot.js` dispatches slash commands, buttons, select menus, and modals to handler modules.
- **Embed colours:** Green `0x57f287` win · Red `0xed4245` loss · Blue `0x5865f2` neutral · Dark `0x2b2d31` info.
- **Schedulers:** Hourly pool payout, daily spin 11:15 AM, giveaway expiry every 30 s, hourly DB backup.
- **RNG:** `Math.random()` — not cryptographic.

---

## Configuration (`config.js`)

All tuning lives under the `CONFIG` object.

| Section | Controls |
|---------|----------|
| `economy.daily` | Daily rewards, streak, cooldowns |
| `economy.bank` | Interest, tiered slab thresholds |
| `economy.pools` | Tax rates, contribution slabs, payouts |
| `economy.upgrades` | Max levels, per-level values, cost curve |
| `games.*` | Win chances, payouts, grid sizes |
| `collectibles` | Box costs, drop weights, dupe comp, set bonuses |
| `runtime` | Pity tuning, net worth history retention |
| `xp` | XP per game, level thresholds, titles, per-10-level bonuses (max 500) |

---

## Database Backups

Automatic local backups in `backups/hourly/YYYY-MM-DD/HH-MM-SS/`.

Each snapshot writes `gambling.db` (via SQLite online backup API), plus `gambling.db-wal` and `gambling.db-shm` if present, and a `meta.json`.

**Schedule:** once on startup, then every hour aligned to the hour.

**Retention:**
1. Last 7 days: keep all hourly snapshots (up to 168).
2. 7-30 days: keep one per day.
3. 30+ days: keep one per month.

Backups are `.gitignore`d except `backups/README.md`.

### Manual Restore

1. Stop the bot.
2. Copy `gambling.db` (+ `wal`/`shm` from **same** snapshot) to `data/`.
3. Start the bot.

### Partial Stat Restore

```bash
node scripts/restore-stats.js --dry-run /path/to/snapshot/gambling.db
node scripts/restore-stats.js /path/to/snapshot/gambling.db
```

### Wipe Stats

```bash
node scripts/wipe-stats.js --backup /path/to/old/gambling.db   # backfill XP
node scripts/wipe-stats.js --zero-xp                            # zero everything
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot exits on start | Set `TOKEN`, `CLIENT_ID`, `GUILD_ID` in `.env` |
| Slash commands missing | Confirm `CLIENT_ID` + `GUILD_ID` match your server |
| DB restore confusion | Stop bot first; use matching `db`/`wal`/`shm` from same timestamp |

---

## Discord Embed Limits

Discord rejects embeds that exceed these hard character limits:

| Property | Max |
|----------|-----|
| Title | 256 |
| Description | 4,096 |
| Field name | 256 |
| **Field value** | **1,024** |
| Footer | 2,048 |
| Author name | 256 |
| **Entire embed total** | **6,000** |

Also: max 25 fields/embed, 10 embeds/message, 25 select-menu options, 80-char button labels, 4,000-char modal inputs.

### How the Bot Handles It

`commands/effects.js` has `truncateField()` (caps field values at 1,024) and `clampEmbed()` (enforces 6,000 total). Use `clampEmbed()` on any new embed that might grow dynamically.

The `/effects` Gameplay tab's **Item Effects** field is the biggest risk — it concatenates one line per owned collectible effect. It now auto-truncates with "… and N more". When adding new items with `customEffect.label`, keep labels **short** (< 60 chars).

---

## Important Notes

- **RNG:** `Math.random()` — not cryptographic. Fine for entertainment, not regulated wagering.
- **Admin commands** (`/admin`) can directly alter any balance or state.
- **Tiered slabs** on tax and interest prevent runaway wealth.
- **Pity system** is capped — nudges odds without guaranteeing wins.
- **LIR losses** don't count toward pity streak (prevents farming).
- **Session persistence:** in-memory `Map`s serialised to `runtime_state` in SQLite on every change. Ensure backward compat when modifying session data structures.
- **Backup safety:** uses SQLite `db.backup()` API (not file copy). Never mix `db`/`wal`/`shm` from different timestamps. `backups/` is `.gitignore`d.

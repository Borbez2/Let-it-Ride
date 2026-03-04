# Gambling Bot - Reference Guide

A Discord economy and gambling bot built with discord.js v14, better-sqlite3, and chart.js. Players start with coins, play games, collect items, and grow their net worth over time.

---

## Table of Contents

1. [Economy Overview](#economy-overview)
2. [Games](#games)
3. [Effects & Modifiers](#effects--modifiers)
4. [Bank & Interest](#bank--interest)
5. [Universal Pool & Spin Pool](#universal-pool--spin-pool)
6. [Collectibles & Mystery Boxes](#collectibles--mystery-boxes)
7. [Commands Reference](#commands-reference)
8. [Codebase Structure](#codebase-structure)
9. [Configuration](#configuration)

---

## Economy Overview

Every player starts with **1,000 coins**. Coins live in two places:

- **Purse** - Spending money used for bets, trades, shop purchases, and giving.
- **Bank** - Earns interest over time. Move coins in with `/deposit`, out with `/withdraw`.

### Earning coins

| Method | How it works |
|--------|-------------|
| `/daily` | Claim 750 base + 75 per streak day. Must claim within 48h to keep streak. |
| Winning games | Play any game and win. Profits feed the economy through hourly net-worth tax. |
| Universal Pool payout | Every hour, the pool is split equally among all registered players (deposited to bank). |
| Daily Spin | Each day at 11:15 AM, the spin pool goes to one lucky winner. |
| Cashback | Lose a game and get a small % back based on your cashback rate. |
| Trading | Swap collectibles with other players via `/trade`. |

### Number formatting

Large numbers are shortened with suffixes:

| Suffix | Value |
|--------|-------|
| k | Thousand (1,000) |
| m | Million (1,000,000) |
| b | Billion (1,000,000,000) |
| t | Trillion (1,000,000,000,000) |
| qa | Quadrillion |
| qi | Quintillion |
| sx | Sextillion |

When entering amounts, you can type `100`, `4.7k`, `1.2m`, `2b`, or `all`. Values round down to the nearest whole coin.

---

## Games

### Coin Flip (`/flip`)

Bet on a coin flip. Win chance is exactly **50%**. Roughly break-even before cashback and luck buffs. If you bet your entire balance, the result will include a special “‼️ **ALL IN!**” indicator to show you went all‑in.

- Counts toward pity/luck streak tracking.
- Can flip 1-10 times at once with the `quantity` parameter.

### Roulette (`/roulette`)

Bet on a European-style roulette wheel with 37 slots (0-36).

| Bet | Payout | EV |
|-----|--------|-----|
| Red or Black | 2x (1x profit) | -2.70% |
| Green (0) | 14x (13x profit) | -62.16% |

Red has 18 slots, Black has 18 slots, Green has 1 slot.

### All-In 17 Black (`/allin17black`)

Straight-up bet on the number 17. Pays **36x** (35x profit) if it hits. Same wheel as roulette, so 1/37 chance.

### Blackjack (`/blackjack`)

Standard blackjack rules. Your skill determines the outcome - no fixed EV.

- Dealer stands on 17.
- Natural blackjack pays 2.5x (1.5x profit).
- **Hit**, **Stand**, **Double**, **Split** buttons available.
- Split creates two independent hands, each playing the original bet.
- Doubling doubles the bet, draws one card, then auto-stands.

### Mines (`/mines`)

Reveal tiles on a 4x5 grid (20 tiles total). Choose how many mines (1-15).

- Each safe reveal increases your multiplier.
- **Cash Out** anytime to lock in winnings.
- Hit a mine and lose your bet.
- **Mines Charm** (from collectibles) gives a chance to survive hitting a mine.
- Clearing all safe tiles is a **Perfect Clear** with maximum payout.

Multiplier formula: for each reveal, multiplier scales by `(total_tiles - i) / (safe_tiles - i)`.

### Let It Ride (`/letitride`)

Start with a bet. Each round is a 50/50 - win and your bet doubles, lose and it's gone. After each win, choose to **Ride** (keep going) or **Cash Out**.

- Does NOT count toward pity streak (to prevent abuse).
- Each step is independent 50% chance.

### Duel (`/duel`)

Challenge another player. Both stake equal amounts. A random 50/50 determines the winner, who takes the full pot.

- Players can accept or decline.
- Counts toward pity/luck streak tracking.

---

## Effects & Modifiers

View your current effects with `/effects`. All effects passively influence your gameplay.

### Luck (Pity System)

Lose **3+ games in a row** (Flip or Duel only) and you get a win-chance buff:

| Streak | Boost per loss |
|--------|---------------|
| 3-7 | +0.25% per loss |
| 8-12 | +0.5% per loss |

Example: 7 losses in a row = +1.25% win chance. 12 losses = +3.75%.

The buff **lasts 5 minutes** and a higher streak replaces a lower one. Winning resets the streak counter, but any active buff continues until expiry. Stacks with Lucky Pot.

Let It Ride losses do **not** count toward the streak.

### Bank Interest

Hourly passive income on your bank balance. Rate = base (2%) + upgrade levels + collectible bonuses. Calculated in tiered slabs (see [Bank & Interest](#bank--interest)).

### Cashback

Get back a percentage of every loss. Rate = base + upgrade levels + collectible bonuses.

### Daily Spin Multiplier

Multiplies your spin pool winnings if you're the daily winner. Upgradeable in `/shop`.

### Universal Income Multiplier

Chance to **double** your hourly pool payout. Each upgrade level adds 1% chance (capped at 20x the base chance).

### Mines Save (Mines Charm)

Chance to survive hitting a mine. Only available through collectible bonuses.

### Upgradeable in /shop

| Effect | Symbol | Per Level |
|--------|--------|-----------|
| Bank Interest | ∑ | +0.1% per level |
| Cashback | ↩ | +0.005% per level |
| Spin Multiplier | ⟳× | Multiplies spin winnings |
| Universal Income | ∀× | +1% double chance per level |

All upgrades have 100 levels. Cost formula: `floor(500 × 1.18^level)` – early levels are cheap, late levels require significant wealth.

---

## Bank & Interest

Interest is calculated hourly using **tiered slabs** (like tax brackets). Your effective rate `r` comes from base + upgrades + collectibles.

| Slab | Balance Range | Effective Rate |
|------|--------------|---------------|
| 1 | 0 to 500K | r (full rate) |
| 2 | 500K to 2M | r × 0.70 |
| 3 | 2M to 10M | r × 0.45 |
| 4 | 10M to 50M | r × 0.25 |
| 5 | 50M to 250M | r × 0.12 |
| 6 | 250M to 1B | r × 0.05 |
| 7 | Above 1B | r × 0.02 |

Use `/bank` to view your current balance, rate, and detailed breakdown.

---


## Hourly Pool & Daily Pool

### Hourly Pool

- Pool funding comes from an **hourly net-worth tax** (0.03% base) applied to bank balances.
- Tax is calculated in tiered slabs: lower balances pay the full rate, higher balances are scaled down.
- Every **hour**, the hourly pool is split equally among all registered players and deposited to their banks.

Net-worth tax slabs:

| Balance Range | Scale |
|-------------|----------|
| 0 to 1M | 100% |
| 1M to 5M | 80% |
| 5M to 25M | 65% |
| 25M to 100M | 50% |
| 100M to 500M | 38% |
| 500M to 2B | 28% |
| Above 2B | 20% |

### Daily Pool

- Half of the hourly net-worth tax goes to the daily spin pool.
- Each day at **11:15 AM** (local server time), one random player wins the entire daily pool.
- Your Spin Multiplier upgrade scales the payout.

View both pools with `/pool`.

---

## Collectibles & Mystery Boxes

### Mystery Boxes

Buy mystery boxes through `/shop` for **3,500 coins** each (standard) or **350,000 coins** (premium, no common items).
On the shop's **Mystery Box** page you can now see how many duplicate items you have and sell all of them directly with a button (or still use `/inventory`).

There are **1,000 collectibles** spread across 9 rarity tiers:

| Rarity | Items | Base Drop Weight | Dupe Compensation |
|--------|-------|-----------------|-------------------|
| ⬜ Common    | 400 | 80     | 1,600    |
| 🟩 Uncommon  | 300 | 18.29  | 3,500    |
| 🟦 Rare      | 150 | 1      | 12,000   |
| 🟪 Epic      | 80  | 0.5    | 30,000   |
| 🟨 Legendary | 40  | 0.15   | 100,000  |
| 🩷 Mythic    | 20  | 0.05   | 300,000  |
| 🩵 Divine    | 5   | 0.01   | 1,250,000|
| 🔴 Special   | 3   | 0.0005 | 5,000,000|
| 🟡 Godly     | 2   | 0.0001 | 10,000,000|

Duplicate items are automatically converted to coins based on the compensation table above.

### Collectible Buffs

Most collectibles still use the familiar "set bonus" system: individual items only provide
very tiny passive boosts (interest, cashback, etc.) but if you own every item of a given
rarity you unlock a larger cumulative bonus.

**Higher‑tier items (legendary and above)** have been updated with small, quirky
*game‑specific effects* instead of the boring flat stats. Examples:

- 🎭 **Scary Mask** (legendary) - 1% extra chance to win duels
- 🪙 **Quantum Coin** (legendary) - 2% chance to triple your coin‑flip payout

These special abilities are listed on the `/effects` page under **Item Effects** and
also appear in your `/inventory` view when you own them. They are purposefully
tiny to keep EV balanced, and the pool still contains placeholders for the remaining
thousands of items; additional unique effects will be added over time.

The table below still describes the set completion bonuses that apply to all rarities:

| Rarity | ∑ Interest | ↩ Cashback | ⛁⌖ Mines | ∀× Income | ⟳× Spin |
|--------|-----------|-----------|---------|----------|---------|
| Common | +0.015% | +0.002% | +0.025% | +0.06% | +0.3% |
| Uncommon | +0.03% | +0.005% | +0.05% | +0.13% | +0.7% |
| Rare | +0.06% | +0.01% | +0.1% | +0.3% | +1.3% |
| Epic | +0.15% | +0.03% | +0.2% | +0.6% | +3% |
| Legendary | +0.4% | +0.08% | +0.5% | +1.3% | +6.5% |
| Mythic | +0.9% | +0.18% | +1.2% | +3.2% | +16% |
| Divine | +1.5% | +0.3% | +2.5% | +6.5% | +32% |
| Special | +3% | +0.6% | +5% | +15% | +70% |
| Godly | +6% | +1.2% | +10% | +30% | +150% |

### Luck-based drop rates

Your luck stat influences drop rates. Higher luck pushes the odds toward rarer items:
- Common and Uncommon weights **decrease** with higher luck.
- Rare through Divine weights **increase** with higher luck.
- Each rarity has a `slope` that determines how much luck shifts its weight.

### Box pity system

Opening boxes without getting a high-rarity item (Epic+) builds a pity counter. Each streak step adds **+2% luck bonus** up to a maximum of **+50%**, making rare drops more likely the longer you go without one.

---

## Commands Reference

### Economy

| Command | Description |
|---------|-------------|
| `/balance` | Check your purse and bank balance |
| `/daily` | Claim daily coins (streak bonus) |
| `/deposit <amount>` | Move coins from purse to bank |
| `/withdraw <amount>` | Move coins from bank to purse |
| `/invest <amount>` | Alias for deposit |
| `/bank` | View bank details, rate, and breakdown |
| `/pool` | View Universal Pool and Spin Pool info |
| `/give <user> <amount>` | Send coins to another player |
| `/shop` | Browse upgrades, potions, and mystery boxes (navigate between pages freely) |

### Games

| Command | Description |
|---------|-------------|
| `/flip <amount> [quantity]` | Coin flip (1-10 flips) |
| `/roulette <amount> <color>` | Roulette - red, black, or green |
| `/allin17black <amount>` | All-in on number 17 |
| `/blackjack <amount>` | Play blackjack |
| `/mines <amount> <mines>` | Play mines (1-15 mines) |
| `/letitride <amount>` | Let It Ride - double or bust |
| `/duel <user> <amount>` | Challenge someone to a duel |

### Social & Info

| Command | Description |
|---------|-------------|
| `/leaderboard` | Server wealth rankings |
| `/stats [game] [timeframe]` | Your game statistics |
| `/effects` | View your current buffs and modifiers |
| `/inventory` | Browse your collectible items |
| `/collection` | Server-wide collection progress |
| `/trade <user>` | Start a trade with another player |
| `/giveaway <amount> <duration>` | Start a coin giveaway |
| `/help` | Interactive help pages |

### Admin

Admin commands are restricted to configured admin user IDs.

| Command | Description |
|---------|-------------|
| `/admin balance-set` | Set a player's balance |
| `/admin balance-add` | Add coins to a player |
| `/admin balance-remove` | Remove coins from a player |
| `/admin bank-set` | Set a player's bank balance |
| `/admin reset-user` | Reset a player's data |
| `/admin pool-set` | Set the Universal Pool balance |
| `/admin losspool-set` | Set the Spin Pool balance |
| `/admin ev-scalar` | Adjust global EV scalar |
| `/admin pity-threshold` | Set binomial pity threshold |
| `/admin backup` | Create a manual backup |

---

## Codebase Structure

```
bot.js                    Main entry point - command registration, interaction routing, schedulers
config.js                 Central configuration - all tuning values, game parameters, economy constants
package.json              Dependencies: discord.js, better-sqlite3, dotenv, chart.js, chartjs-node-canvas

data/
  store.js                SQLite database layer - all economy read/write operations, balance management

games/
  shared.js               Shared game utilities (pity trigger announcements)
  cards.js                Card deck utilities (create, shuffle, hand value, formatting)
  flip.js                 Coin flip game logic
  roulette.js             Roulette + All-In 17 Black game logic
  blackjack.js            Blackjack game logic with split support
  mines.js                Mines grid game with charm saves
  letitride.js            Let It Ride double-or-bust game
  duel.js                 Player vs player duel system

commands/
  help.js                 Interactive 5-page help embed
  admin.js                Admin-only management commands
  effects.js              Player effects/buffs display
  shop.js                 Shop UI - upgrades, potions, mystery boxes
  stats.js                Game statistics and analytics
  balance.js              Balance, daily, deposit, withdraw commands
  bank.js                 Bank overview and breakdown display
  pool.js                 Universal Pool and Spin Pool info embed
  give.js                 Player-to-player coin transfer
  trade.js                Item trading system with modals
  leaderboard.js          Server leaderboard and net worth graphs
  inventory.js            Collectible inventory browser
  giveaway.js             Giveaway creation and participation

utils/
  binomial.js             Binomial distribution calculations for pity system
  dbBackup.js             Automated hourly SQLite backups
  renderChart.js          Server-side chart rendering with chart.js
```

### Architecture Notes

- **Session management**: Each game maintains its own in-memory `Map` for active sessions. Sessions are persisted to SQLite via `store.setRuntimeState()` and restored on restart.
- **Interaction routing**: `bot.js` dispatches slash commands, button clicks, select menus, and modals to the appropriate handler module.
- **Embed color scheme**: Green (`0x57f287`) for wins, Red (`0xed4245`) for losses, Blue (`0x5865f2`) for neutral/in-progress, Dark (`0x2b2d31`) for info/help.
- **Backup system**: Hourly snapshots stored in `backups/hourly/YYYY-MM-DD/HH-MM-SS/`.
- **Schedulers**: Hourly pool payout, daily spin at 11:15 AM, periodic life stats reporting, session expiry sweeps.

---

## Configuration

All tunable values are in `config.js` under the `CONFIG` object. Key sections:

| Section | What it controls |
|---------|-----------------|
| `economy.daily` | Daily reward amounts, streak bonus, cooldowns |
| `economy.bank` | Interest calculation, tiered slab thresholds |
| `economy.pools` | Tax rates, contribution slabs, payout intervals |
| `economy.upgrades` | Max levels, per-level values, cost arrays |
| `games.*` | Win chances, payout multipliers, grid sizes |
| `collectibles` | Box costs, drop weights, dupe compensation, set bonuses |
| `runtime` | Pity system tuning, networth history retention |
| `bot.channels` | Discord channel IDs for announcements |
| `xp` | Player experience, level thresholds, titles, and per-10-level stat bonuses (max 500, exponential growth) |

Experience points (XP) are awarded for every completed game; levels unlock titles and small permanent bonuses. Requirements increase exponentially, and the system now tops out at level 500.

Environment variables (`.env`):

| Variable | Purpose |
|----------|---------|
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client ID |
| `GUILD_ID` | Target Discord server ID |
| `ADMIN_IDS` | Comma-separated admin user IDs |

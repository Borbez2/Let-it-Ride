# Let It Ride

> ⚠️ Still under development — some features may not work properly.

Discord economy + gambling bot built on `discord.js` v14 and `better-sqlite3`.

---

## Setup

**Requirements:** Node.js 18+ · Discord application with bot token · Bot invited with `applications.commands` scope.

```bash
npm install
cp .env.example .env   # fill in your values
node bot.js
```

### `.env`

```env
TOKEN=your_bot_token          # required
CLIENT_ID=your_app_client_id  # required
GUILD_ID=your_server_id       # required
ANNOUNCE_CHANNEL_ID=           # optional
ADMIN_IDS=id1,id2              # optional
STATS_RESET_ADMIN_IDS=         # falls back to ADMIN_IDS
```

---

## Economy

- Start with **1,000 coins**. Money lives in your **Purse** (spending) and **Bank** (earns interest).
- `/daily` — 750 + 75/streak day. Claim within 48 h to keep streak.
- `/deposit` / `/withdraw` — move coins between purse and bank.
- Amount input: `100`, `4.7k`, `1.2m`, `2b`, `all`.

| Earning Method | Summary |
|----------------|---------|
| `/daily` | Free coins + streak bonus |
| Games | Win any game |
| Hourly Pool | Split equally to all players each hour → bank |
| Daily Spin | One winner each day at 11:15 AM |
| Cashback | Small % of losses returned |
| Trading | Swap collectibles via `/trade` |

---

## Games

| Game | Command | Notes |
|------|---------|-------|
| Coin Flip | `/flip <amt> [qty]` | 50 %, 2× payout. 1-10 flips |
| Roulette | `/roulette <amt> <color>` | Red/Black 2× · Green 14× (1/37) |
| All-In 17 | `/allin17black <amt>` | 36× payout, 1/37 chance |
| Blackjack | `/blackjack <amt>` | Skill-based. Natural BJ = 2.5× |
| Mines | `/mines <amt> <mines>` | 4×5 grid, 1-15 mines, cash out anytime |
| Let It Ride | `/letitride <amt>` | 50/50 per round, ride or cash out |
| Duel | `/duel <user> <amt>` | 50/50, winner takes all |

---

## Effects & Modifiers (`/effects`)

| Effect | Source | What it does |
|--------|--------|-------------|
| ☘ Luck | Losing streak | +win chance after 3+ losses (Flip/Duel) |
| ∑ Interest | Base + upgrades + items | Hourly bank payout (tiered slabs) |
| ↩ Cashback | Upgrades + items | % of losses returned |
| ⟳× Spin Mult | Upgrades + items | Multiplies daily spin winnings |
| ∀× Income Mult | Upgrades + items | Chance to ×2 hourly payout |
| ⛁⌖ Mines Save | Items only | Chance to survive a mine |

**Luck:** 3-7 losses → +0.25 %/loss · 8-12 → +0.5 %/loss. Lasts 5 min. Win resets streak. LIR doesn't count.

### Bank Interest Slabs

Rate **r** = 2 % base + upgrades + collectibles.

| Balance | Rate |
|---------|------|
| 0 – 500 K | r |
| 500 K – 2 M | r × 0.70 |
| 2 M – 10 M | r × 0.45 |
| 10 M – 50 M | r × 0.25 |
| 50 M – 250 M | r × 0.12 |
| 250 M – 1 B | r × 0.05 |
| 1 B + | r × 0.02 |

---

## Pools

- **Hourly Pool** — net-worth tax split equally to all players each hour.
- **Daily Spin Pool** — half of tax; one winner daily at 11:15 AM.
- View with `/pool`.

---

## Collectibles & Mystery Boxes

Buy boxes in `/shop` (3,500 standard · 350 K premium). 1,000 items across 9 rarities.

| Rarity | Items | Dupe Comp |
|--------|-------|-----------|
| ⬜ Common | 400 | 1,600 |
| 🟩 Uncommon | 300 | 3,500 |
| 🟦 Rare | 150 | 12,000 |
| 🟪 Epic | 80 | 30,000 |
| 🟨 Legendary | 40 | 100,000 |
| 🩷 Mythic | 20 | 300,000 |
| 🩵 Divine | 5 | 1,250,000 |
| 🔴 Special | 3 | 5,000,000 |
| 🟡 Godly | 2 | 10,000,000 |

Dupes auto-convert to coins. Full rarity set → **set bonus**. High-tier items may have unique effects (shown in `/effects`).

**Box pity:** Each box without Epic+ adds +2 % luck (max +50 %).

---

## Shop Upgrades (`/shop`)

| Upgrade | Per Level | Max |
|---------|-----------|-----|
| ∑ Interest | +0.1 % | 100 |
| ↩ Cashback | +0.005 % | 100 |
| ⟳× Spin Mult | +0.01× | 100 |
| ∀× Income | +1 % double chance | 100 |

Cost: `floor(500 × 1.18^level)`

---

## Commands

**Economy:** `/balance` `/daily` `/deposit` `/withdraw` `/bank` `/pool` `/give` `/shop`
**Games:** `/flip` `/roulette` `/allin17black` `/blackjack` `/mines` `/letitride` `/duel`
**Social:** `/leaderboard` `/stats` `/effects` `/inventory` `/collection` `/trade` `/giveaway` `/help`
**Admin:** `/admin <subcommand>` (restricted to configured admin IDs)

---

*Developer reference: see [DEV.md](DEV.md)*

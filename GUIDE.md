# Gambling Bot — Player Guide

Quick reference for everything players need to know.

---

## Economy Basics

- Start with **1,000 coins**. Money lives in your **Purse** (spending) and **Bank** (earns interest).
- `/daily` — 750 + 75/streak day (claim within 48 h to keep streak).
- `/deposit` / `/withdraw` — move coins between purse and bank.
- Amount input: `100`, `4.7k`, `1.2m`, `2b`, `all`.

### Earning Coins

| Method | Summary |
|--------|---------|
| `/daily` | Free coins + streak bonus |
| Games | Win any game |
| Hourly Pool | Split equally to all players each hour → bank |
| Daily Spin | One winner each day at 11:15 AM |
| Cashback | Small % of losses returned |
| Trading | Swap collectibles via `/trade` |

---

## Games

| Game | Command | Win Chance / Notes |
|------|---------|--------------------|
| Coin Flip | `/flip <amt> [qty]` | 50 %, 2× payout. 1-10 flips at once |
| Roulette | `/roulette <amt> <color>` | Red/Black 2× · Green 14× (1/37) |
| All-In 17 | `/allin17black <amt>` | 36× payout, 1/37 chance |
| Blackjack | `/blackjack <amt>` | Skill-based. Natural BJ = 2.5× |
| Mines | `/mines <amt> <mines>` | 4×5 grid, 1-15 mines, cash out anytime |
| Let It Ride | `/letitride <amt>` | 50/50 each round, ride or cash out |
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

**Luck details:** Lose 3-7 → +0.25 %/loss · 8-12 → +0.5 %/loss. Lasts 5 min. Win resets streak. LIR does not count.

---

## Bank Interest Slabs

Rate **r** = 2 % base + upgrade levels + collectible bonuses.

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

- **Hourly Pool** — funded by net-worth tax, split equally to all players each hour.
- **Daily Spin Pool** — half of hourly tax goes here; one winner daily at 11:15 AM.
- View with `/pool`.

---

## Collectibles & Mystery Boxes

Buy boxes in `/shop` (3,500 coins standard · 350 K premium). 1,000 items across 9 rarities.

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

Duplicates auto-convert to coins. Completing a full rarity tier grants a **set bonus**. Higher-tier items may have unique game effects (shown in `/effects`).

**Box pity:** Each box without an Epic+ builds +2 % luck (max +50 %).

---

## Shop Upgrades (`/shop`)

| Upgrade | Per Level | Max |
|---------|-----------|-----|
| ∑ Interest | +0.1 % | 100 |
| ↩ Cashback | +0.005 % | 100 |
| ⟳× Spin Mult | +0.01× | 100 |
| ∀× Income | +1 % double chance | 100 |

Cost formula: `floor(500 × 1.18^level)`

---

## Commands Quick Ref

**Economy:** `/balance` `/daily` `/deposit` `/withdraw` `/bank` `/pool` `/give` `/shop`
**Games:** `/flip` `/roulette` `/allin17black` `/blackjack` `/mines` `/letitride` `/duel`
**Social:** `/leaderboard` `/stats` `/effects` `/inventory` `/collection` `/trade` `/giveaway` `/help`
**Admin:** `/admin <subcommand>` (restricted to configured admin IDs)

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  CONFIG,
  STARTING_COINS, BASE_INVEST_RATE,
  POOL_TAX_RATE, LOSS_POOL_RATE, MYSTERY_BOX_POOLS, PREMIUM_MYSTERY_BOX_POOLS,
} = require('../config');

const GAME_KEYS = CONFIG.stats.games;
const RARITY_TIER = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 4,
  epic: 5,
  mythic: 6,
  divine: 7,
};
const DEFAULT_RUNTIME_TUNING = { ...CONFIG.runtime.defaults };

// Luck buff constants - tiered single-buff system
const LUCK_ACTIVATION_THRESHOLD = 3;   // minimum streak to activate
const LUCK_TIER1_CAP = 7;              // losses 3-7 give 0.5% each
const LUCK_TIER1_RATE = 0.0025;         // 0.25% per loss in tier 1
const LUCK_TIER2_CAP = 12;             // losses 8-12 give 0.5% each
const LUCK_TIER2_RATE = 0.005;          // 0.5% per loss in tier 2
const LUCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function calculateLuckBoost(streak) {
  if (streak < LUCK_ACTIVATION_THRESHOLD) return 0;
  if (streak <= LUCK_TIER1_CAP) return (streak - LUCK_ACTIVATION_THRESHOLD + 1) * LUCK_TIER1_RATE;
  const tier1Part = (LUCK_TIER1_CAP - LUCK_ACTIVATION_THRESHOLD + 1) * LUCK_TIER1_RATE;
  const tier2Losses = Math.min(streak, LUCK_TIER2_CAP) - LUCK_TIER1_CAP;
  return tier1Part + tier2Losses * LUCK_TIER2_RATE;
}

const LUCK_MAX_BOOST = calculateLuckBoost(LUCK_TIER2_CAP);

// Potion system constants
const LUCKY_POT_DURATION_MS = 30 * 60 * 1000;
const LUCKY_POT_COST = 100000;
const LUCKY_POT_BOOST = 0.005;
const UNLUCKY_POT_DURATION_MS = 30 * 60 * 1000;
const UNLUCKY_POT_COST = 200000;
const UNLUCKY_POT_PENALTY = 0.25;

const { COLLECTIBLES } = require('../config');

const COLLECTIBLE_EFFECTS = (() => {
  const statBoosts = CONFIG.collectibles.mysteryBox.statBoostPerItem;
  const map = {};
  for (const item of COLLECTIBLES) {
    const boosts = statBoosts[item.rarity] || {};
    map[item.id] = {
      interestRateBonus: boosts.interestRate || 0,
      cashbackRateBonus: boosts.cashbackRate || 0,
      minesRevealChance: boosts.minesRevealChance || 0,
      universalDoubleChanceBonus: boosts.universalDoubleChance || 0,
      spinWeightBonus: boosts.spinWeight || 0,
      label: null,
    };
  }
  return map;
})();

// Set up the SQLite database.
const DB_PATH = path.join(__dirname, 'gambling.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function checkpointWal(mode = 'PASSIVE') {
  const normalized = String(mode || 'PASSIVE').toUpperCase();
  if (!['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'].includes(normalized)) return null;
  try {
    return db.pragma(`wal_checkpoint(${normalized})`);
  } catch (err) {
    console.error('WAL checkpoint failed:', err?.message || err);
    return null;
  }
}

function backupDatabaseToFile(destinationPath) {
  return db.backup(destinationPath);
}

function getDbFilePaths() {
  return {
    db: DB_PATH,
    wal: `${DB_PATH}-wal`,
    shm: `${DB_PATH}-shm`,
  };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT ${STARTING_COINS},
    last_daily INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    bank INTEGER NOT NULL DEFAULT 0,
    last_bank_payout INTEGER NOT NULL DEFAULT 0,
    interest_level INTEGER NOT NULL DEFAULT 0,
    cashback_level INTEGER NOT NULL DEFAULT 0,
    spin_mult_level INTEGER NOT NULL DEFAULT 0,
    universal_income_mult_level INTEGER NOT NULL DEFAULT 0,
    inventory TEXT NOT NULL DEFAULT '[]',
    stats TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS pool (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    universal_pool INTEGER NOT NULL DEFAULT 0,
    loss_pool INTEGER NOT NULL DEFAULT 0,
    last_hourly_payout INTEGER NOT NULL DEFAULT 0,
    last_daily_spin INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS runtime_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO pool (id, last_hourly_payout) VALUES (1, ${Date.now()});
`);

const walletColumns = db.prepare('PRAGMA table_info(wallets)').all();
if (!walletColumns.some(c => c.name === 'universal_income_mult_level')) {
  db.exec('ALTER TABLE wallets ADD COLUMN universal_income_mult_level INTEGER NOT NULL DEFAULT 0');
}

// Default stats template for new wallets.
const DEFAULT_STATS = () => ({
  flip: { wins: 0, losses: 0 },
  dice: { wins: 0, losses: 0 },
  roulette: { wins: 0, losses: 0 },
  blackjack: { wins: 0, losses: 0 },
  mines: { wins: 0, losses: 0 },
  letitride: { wins: 0, losses: 0 },
  duel: { wins: 0, losses: 0 },
  giveaway: { created: 0, amountGiven: 0, won: 0, amountWon: 0 },
  mysteryBox: { duplicateCompEarned: 0, opened: 0, spent: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 },
  dailySpin: { won: 0, amountWon: 0 },
  interest: { totalEarned: 0, pendingFraction: 0, pendingCoins: 0, pendingMinutes: 0, lastAccrualAt: 0 },
  universalIncome: { totalEarned: 0 },
  bonuses: {
    minesSaves: 0,
    evBoostProfit: 0,
    binomialPity: {
      activeUntil: 0,
      boostRate: 0,
      stacks: [],
      triggers: 0,
      lastTriggeredAt: 0,
      lastDirection: 'neutral',
      lastConfidence: 0,
      lastTotalGames: 0,
    },
  },
  netWorthHistory: [],
  xpHistory: [],
  collectibleHistory: [],
  topWins: [],
  topLosses: [],
  lifetimeEarnings: 0,
  lifetimeLosses: 0,
});

function getInventoryBonuses(inventory) {
  const bonuses = {
    interestRateBonus: 0,
    cashbackRateBonus: 0,
    mysteryBoxLuckBonus: 0,
    minesRevealChance: 0,
    universalDoubleChanceBonus: 0,
    spinWeightBonus: 0,
    effectLines: [],
  };

  if (!Array.isArray(inventory) || inventory.length === 0) return bonuses;

  // Collect unique owned ids for completion checks
  const ownedIds = new Set(inventory.map(item => item.id));

  for (const item of inventory) {
    const effect = COLLECTIBLE_EFFECTS[item.id];
    if (!effect) continue;

    bonuses.interestRateBonus += effect.interestRateBonus || 0;
    bonuses.cashbackRateBonus += effect.cashbackRateBonus || 0;
    bonuses.mysteryBoxLuckBonus += effect.mysteryBoxLuckBonus || 0;
    bonuses.minesRevealChance += effect.minesRevealChance || 0;
    bonuses.universalDoubleChanceBonus += effect.universalDoubleChanceBonus || 0;
    bonuses.spinWeightBonus += effect.spinWeightBonus || 0;

    if (effect.label) {
      bonuses.effectLines.push(effect.label);
    }
  }

  // Collection completion bonuses
  const completionBonuses = CONFIG.collectibles.mysteryBox.collectionCompleteBonus;
  const rarityOrder = CONFIG.ui.rarityOrder;
  for (const rarity of rarityOrder) {
    const allOfRarity = COLLECTIBLES.filter(c => c.rarity === rarity);
    const allCollected = allOfRarity.length > 0 && allOfRarity.every(c => ownedIds.has(c.id));
    if (allCollected && completionBonuses[rarity]) {
      const cb = completionBonuses[rarity];
      bonuses.interestRateBonus += cb.interestRate || 0;
      bonuses.cashbackRateBonus += cb.cashbackRate || 0;
      bonuses.minesRevealChance += cb.minesRevealChance || 0;
      bonuses.universalDoubleChanceBonus += cb.universalDoubleChance || 0;
      bonuses.spinWeightBonus += cb.spinWeight || 0;
    }
  }

  if (!bonuses.effectLines.length) {
    if (bonuses.interestRateBonus > 0) bonuses.effectLines.push(`Bank interest +${(bonuses.interestRateBonus * 100).toFixed(2)}%/day`);
    if (bonuses.cashbackRateBonus > 0) bonuses.effectLines.push(`Cashback +${(bonuses.cashbackRateBonus * 100).toFixed(2)}%`);
    if (bonuses.mysteryBoxLuckBonus > 0) bonuses.effectLines.push(`Mystery box luck +${(bonuses.mysteryBoxLuckBonus * 100).toFixed(2)}%`);
    if (bonuses.minesRevealChance > 0) bonuses.effectLines.push(`Mines auto-reveal save ${(bonuses.minesRevealChance * 100).toFixed(2)}%`);
    if (bonuses.spinWeightBonus > 0) bonuses.effectLines.push(`Spin payout +${bonuses.spinWeightBonus.toFixed(2)}x`);
  }

  return bonuses;
}

function ensureWalletStatsShape(w) {
  if (!w.stats) w.stats = DEFAULT_STATS();
  for (const g of GAME_KEYS) {
    if (!w.stats[g]) w.stats[g] = { wins: 0, losses: 0 };
  }
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0, opened: 0, spent: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 };
  if (w.stats.mysteryBox.duplicateCompEarned === undefined) w.stats.mysteryBox.duplicateCompEarned = 0;
  if (w.stats.mysteryBox.opened === undefined) w.stats.mysteryBox.opened = 0;
  if (w.stats.mysteryBox.spent === undefined) w.stats.mysteryBox.spent = 0;
  if (w.stats.mysteryBox.luckyHighRarity === undefined) w.stats.mysteryBox.luckyHighRarity = 0;
  if (w.stats.mysteryBox.pityStreak === undefined) w.stats.mysteryBox.pityStreak = 0;
  if (w.stats.mysteryBox.bestPityStreak === undefined) w.stats.mysteryBox.bestPityStreak = 0;
  if (!w.stats.dailySpin) w.stats.dailySpin = { won: 0, amountWon: 0 };
  if (!w.stats.interest) w.stats.interest = { totalEarned: 0, pendingFraction: 0, pendingCoins: 0, pendingMinutes: 0, lastAccrualAt: 0 };
  if (w.stats.interest.pendingFraction === undefined) w.stats.interest.pendingFraction = 0;
  if (w.stats.interest.pendingCoins === undefined) w.stats.interest.pendingCoins = 0;
  if (w.stats.interest.pendingMinutes === undefined) w.stats.interest.pendingMinutes = 0;
  if (w.stats.interest.lastAccrualAt === undefined) w.stats.interest.lastAccrualAt = 0;
  if (!w.stats.universalIncome) w.stats.universalIncome = { totalEarned: 0 };
  if (!w.stats.bonuses) {
    w.stats.bonuses = {
      minesSaves: 0,
      evBoostProfit: 0,
      luck: {
        lossStreak: 0,
        bestLossStreak: 0,
        stacks: [],
        triggers: 0,
        totalCashback: 0,
      },
    };
  }
  if (w.stats.bonuses.minesSaves === undefined) w.stats.bonuses.minesSaves = 0;
  if (w.stats.bonuses.evBoostProfit === undefined) w.stats.bonuses.evBoostProfit = 0;
  if (!w.stats.bonuses.luck) {
    w.stats.bonuses.luck = {
      lossStreak: 0,
      bestLossStreak: 0,
      stacks: [],
      triggers: 0,
      totalCashback: 0,
    };
  }
  if (w.stats.bonuses.luck.lossStreak === undefined) w.stats.bonuses.luck.lossStreak = 0;
  if (w.stats.bonuses.luck.bestLossStreak === undefined) w.stats.bonuses.luck.bestLossStreak = 0;
  if (!Array.isArray(w.stats.bonuses.luck.stacks)) w.stats.bonuses.luck.stacks = [];
  if (w.stats.bonuses.luck.triggers === undefined) w.stats.bonuses.luck.triggers = 0;
  if (w.stats.bonuses.luck.totalCashback === undefined) w.stats.bonuses.luck.totalCashback = 0;
  if (!w.stats.potions) w.stats.potions = { lucky: null, unlucky: null };
  if (!Array.isArray(w.stats.netWorthHistory)) w.stats.netWorthHistory = [];
  if (!Array.isArray(w.stats.xpHistory)) w.stats.xpHistory = [];
  if (!Array.isArray(w.stats.collectibleHistory)) w.stats.collectibleHistory = [];
  if (!Array.isArray(w.stats.topWins)) w.stats.topWins = [];
  if (!Array.isArray(w.stats.topLosses)) w.stats.topLosses = [];
  if (w.stats.lifetimeEarnings === undefined) w.stats.lifetimeEarnings = 0;
  if (w.stats.lifetimeLosses === undefined) w.stats.lifetimeLosses = 0;
  // XP fields
  if (w.stats.xp === undefined) w.stats.xp = 0;
  if (w.stats.totalGamesPlayed === undefined) w.stats.totalGamesPlayed = 0;
  // XP & collectible history
  if (!Array.isArray(w.stats.xpHistory)) w.stats.xpHistory = [];
  if (!Array.isArray(w.stats.collectibleHistory)) w.stats.collectibleHistory = [];
}

// Refresh luck: check if the single buff has expired.
function refreshLuckBuff(luck, now = Date.now()) {
  // Migrate from old stack-based system
  if (Array.isArray(luck.stacks)) {
    delete luck.stacks;
  }
  if (!luck.buff) luck.buff = { boost: 0, expiresAt: 0, streak: 0 };
  if (luck.buff.streak === undefined) luck.buff.streak = 0;
  if (luck.buff.expiresAt <= now) {
    luck.buff.boost = 0;
    luck.buff.expiresAt = 0;
    luck.buff.streak = 0;
  }
}

function getLuckState(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  refreshLuckBuff(luck, now);
  const buff = luck.buff;
  const active = buff.boost > 0 && buff.expiresAt > now;
  return {
    active,
    winChanceBoost: active ? buff.boost : 0,
    maxWinChanceBoost: LUCK_MAX_BOOST,
    buffStreak: active ? (buff.streak || 0) : 0,
    lossStreak: luck.lossStreak || 0,
    bestLossStreak: luck.bestLossStreak || 0,
    triggers: luck.triggers || 0,
    totalCashback: luck.totalCashback || 0,
    expiresInMs: active ? Math.max(0, buff.expiresAt - now) : 0,
    tier2Cap: LUCK_TIER2_CAP,
    activationThreshold: LUCK_ACTIVATION_THRESHOLD,
  };
}

function evaluateLuckOnLoss(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  luck.lossStreak = (luck.lossStreak || 0) + 1;
  if (luck.lossStreak > (luck.bestLossStreak || 0)) luck.bestLossStreak = luck.lossStreak;
  refreshLuckBuff(luck, now);

  const streak = luck.lossStreak;
  const newBoost = calculateLuckBoost(streak);
  if (newBoost <= 0) return { triggered: false };

  const currentBoost = luck.buff.boost || 0;
  // Only upgrade if the new boost is higher than the active one
  if (newBoost <= currentBoost) return { triggered: false };

  const previousBoost = currentBoost;
  luck.buff.boost = newBoost;
  luck.buff.expiresAt = now + LUCK_DURATION_MS;
  luck.buff.streak = streak;
  luck.triggers = (luck.triggers || 0) + 1;

  return {
    triggered: true,
    previousBoost,
    winChanceBoost: newBoost,
    lossStreak: streak,
  };
}

function evaluateLuckOnWin(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  // Reset the loss streak counter so the next losing streak starts fresh.
  // The active buff is intentionally NOT cleared here  - it persists for its
  // full 5-minute duration regardless of wins. If a new, higher-tier boost
  // is earned during that window it will replace (not stack on) this one.
  luck.lossStreak = 0;
  refreshLuckBuff(luck, now);
}

function applyLuckCashback(userId, lossAmount, now = Date.now()) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  refreshLuckBuff(luck, now);
  const boost = luck.buff.boost || 0;
  if (boost <= 0) return 0;
  const cashback = Math.floor(normalizeCoins(lossAmount, 0) * boost);
  if (cashback > 0) {
    w.balance += cashback;
    luck.totalCashback = (luck.totalCashback || 0) + cashback;
    saveWallets();
  }
  return cashback;
}

/**
 * Compact a networth history array using tiered retention.
 * Recent data is kept at full resolution; older data is downsampled
 * to coarser time buckets so the array stays bounded while still
 * providing useful data across all graph timeframes.
 *
 * The algorithm mirrors the backup retention approach:
 * each tier defines a maxAgeMs threshold and a bucketMs resolution.
 * Within each bucket only the latest point is kept.
 */
function compactNetworthHistory(history, now = Date.now()) {
  const tiers = CONFIG.runtime.networthHistory.retentionTiers;
  if (!tiers || !tiers.length || history.length <= 1) return history;

  const result = [];
  let lastBucketKey = null;

  for (const point of history) {
    const ageMs = now - point.t;

    // Find the tier for this point's age (first tier whose maxAgeMs > ageMs).
    let tierIdx = tiers.length - 1;
    for (let i = 0; i < tiers.length; i++) {
      if (ageMs < tiers[i].maxAgeMs) {
        tierIdx = i;
        break;
      }
    }

    const bucketMs = tiers[tierIdx].bucketMs;

    // bucketMs === 0 means raw - keep every point as-is.
    if (bucketMs === 0) {
      result.push(point);
      lastBucketKey = null;
      continue;
    }

    // Compute a unique bucket key (tier + aligned bucket start).
    const bucketStart = Math.floor(point.t / bucketMs) * bucketMs;
    const bucketKey = `${tierIdx}:${bucketStart}`;

    if (bucketKey === lastBucketKey && result.length > 0) {
      // Same bucket - replace with the later (more recent) point.
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
    lastBucketKey = bucketKey;
  }

  return result;
}

function maybeTrackNetWorthSnapshotForWallet(w, now = Date.now(), reason = 'auto', options = {}) {
  ensureWalletStatsShape(w);
  const history = w.stats.netWorthHistory;
  const total = normalizeCoins((w.balance || 0) + (w.bank || 0), 0);
  const last = history.length ? history[history.length - 1] : null;
  const minMs = Number.isFinite(options.minMs)
    ? Math.max(0, options.minMs)
    : CONFIG.runtime.networthHistory.defaultMinWriteMs;
  const minDelta = CONFIG.runtime.networthHistory.minDelta;
  const force = !!options.force;
  const shouldWrite = force || !last || (now - last.t >= minMs) || Math.abs(total - last.v) >= minDelta;
  if (!shouldWrite) return false;
  history.push({ t: now, v: total, r: reason });

  // Apply tiered compaction instead of a hard entry cap.
  const compacted = compactNetworthHistory(history, now);
  if (compacted.length !== history.length) {
    history.length = 0;
    history.push(...compacted);
  }
  return true;
}

// XP history snapshot – similar to networth but tracks total XP.
function maybeTrackXpSnapshot(w, now = Date.now(), reason = 'auto') {
  ensureWalletStatsShape(w);
  const history = w.stats.xpHistory;
  const value = w.stats.xp || 0;
  const last = history.length ? history[history.length - 1] : null;
  // Write if first point, 15 min gap, or XP changed by at least 50
  if (last && (now - last.t < 15 * 60 * 1000) && Math.abs(value - last.v) < 50) return false;
  history.push({ t: now, v: value, r: reason });
  const compacted = compactNetworthHistory(history, now);
  if (compacted.length !== history.length) { history.length = 0; history.push(...compacted); }
  return true;
}

// Collectible history snapshot – tracks unique collectible count.
function maybeTrackCollectibleSnapshot(w, now = Date.now(), reason = 'auto') {
  ensureWalletStatsShape(w);
  const history = w.stats.collectibleHistory;
  const uniqueCount = new Set((w.inventory || []).map(i => i.id)).size;
  const last = history.length ? history[history.length - 1] : null;
  // Write if first point, 15 min gap, or count changed
  if (last && (now - last.t < 15 * 60 * 1000) && uniqueCount === last.v) return false;
  history.push({ t: now, v: uniqueCount, r: reason });
  const compacted = compactNetworthHistory(history, now);
  if (compacted.length !== history.length) { history.length = 0; history.push(...compacted); }
  return true;
}

function trackLifeStatsHeartbeat(now = Date.now()) {
  const changedIds = [];
  for (const [userId, wallet] of Object.entries(wallets)) {
    let wrote = false;
    // Net worth history
    wrote = maybeTrackNetWorthSnapshotForWallet(wallet, now, 'heartbeat', {
      minMs: CONFIG.runtime.networthHistory.heartbeatMinWriteMs,
    }) || wrote;
    // XP history
    wrote = maybeTrackXpSnapshot(wallet, now, 'heartbeat') || wrote;
    // Collectible history
    wrote = maybeTrackCollectibleSnapshot(wallet, now, 'heartbeat') || wrote;
    if (wrote) changedIds.push(userId);
  }
  if (changedIds.length > 0) {
    const upsertChanged = db.transaction(() => {
      for (const userId of changedIds) {
        const w = wallets[userId];
        if (!w) continue;
        ensureWalletStatsShape(w);
        stmts.upsertWallet.run(
          userId,
          w.balance, w.lastDaily || 0, w.streak || 0,
          w.bank || 0, w.lastBankPayout || 0,
          w.interestLevel || 0, w.cashbackLevel || 0, w.spinMultLevel || 0, w.universalIncomeMultLevel || 0,
          JSON.stringify(w.inventory || []),
          JSON.stringify(w.stats || DEFAULT_STATS())
        );
      }
    });
    upsertChanged();
  }
  return changedIds.length > 0;
}

// Prepared SQL statements.
const stmts = {
  getAllWallets: db.prepare('SELECT * FROM wallets'),
  upsertWallet: db.prepare(`
    INSERT OR REPLACE INTO wallets
    (user_id, balance, last_daily, streak, bank, last_bank_payout,
     interest_level, cashback_level, spin_mult_level, universal_income_mult_level, inventory, stats)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteWallet: db.prepare('DELETE FROM wallets WHERE user_id = ?'),
  getPool: db.prepare('SELECT * FROM pool WHERE id = 1'),
  updatePool: db.prepare(`
    UPDATE pool SET universal_pool = ?, loss_pool = ?, last_hourly_payout = ?, last_daily_spin = ?
    WHERE id = 1
  `),
  getRuntimeState: db.prepare('SELECT value FROM runtime_state WHERE key = ?'),
  upsertRuntimeState: db.prepare('INSERT OR REPLACE INTO runtime_state (key, value) VALUES (?, ?)'),
  deleteRuntimeState: db.prepare('DELETE FROM runtime_state WHERE key = ?'),
};

// Convert a DB row into the wallet object shape.
function rowToWallet(row) {
  let stats;
  try { stats = JSON.parse(row.stats); } catch { stats = DEFAULT_STATS(); }
  let inventory;
  try { inventory = JSON.parse(row.inventory); } catch { inventory = []; }
  return {
    balance: row.balance,
    lastDaily: row.last_daily,
    streak: row.streak,
    bank: row.bank,
    lastBankPayout: row.last_bank_payout,
    interestLevel: row.interest_level,
    cashbackLevel: row.cashback_level,
    spinMultLevel: row.spin_mult_level,
    universalIncomeMultLevel: row.universal_income_mult_level || 0,
    inventory,
    stats,
  };
}

// One-time migration from old JSON files.
function migrateFromJson() {
  const OLD_WALLETS = path.resolve('./wallets.json');
  const OLD_POOL = path.resolve('./pool.json');
  const walletCount = db.prepare('SELECT COUNT(*) as cnt FROM wallets').get().cnt;

  if (walletCount === 0 && fs.existsSync(OLD_WALLETS)) {
    console.log('Migrating wallets from JSON → SQLite …');
    try {
      const jsonWallets = JSON.parse(fs.readFileSync(OLD_WALLETS, 'utf8'));
      const migrate = db.transaction(() => {
        for (const [userId, w] of Object.entries(jsonWallets)) {
          const stats = w.stats || DEFAULT_STATS();
          // Ensure every game stat bucket exists.
          for (const g of GAME_KEYS) {
            if (!stats[g]) stats[g] = { wins: 0, losses: 0 };
          }
          if (stats.lifetimeEarnings === undefined) stats.lifetimeEarnings = 0;
          if (stats.lifetimeLosses === undefined) stats.lifetimeLosses = 0;
          stmts.upsertWallet.run(
            userId,
            w.balance ?? STARTING_COINS,
            w.lastDaily || 0,
            w.streak || 0,
            w.bank || 0,
            w.lastBankPayout || Date.now(),
            w.interestLevel || 0,
            w.cashbackLevel || 0,
            w.spinMultLevel || 0,
            w.universalIncomeMultLevel || 0,
            JSON.stringify(w.inventory || []),
            JSON.stringify(stats)
          );
        }
      });
      migrate();
      console.log(`  ✓ ${Object.keys(jsonWallets).length} wallets migrated.`);
    } catch (e) { console.error('Wallet migration error:', e); }
  }

  const poolRow = db.prepare('SELECT * FROM pool WHERE id = 1').get();
  if (poolRow.universal_pool === 0 && poolRow.loss_pool === 0 && fs.existsSync(OLD_POOL)) {
    console.log('Migrating pool from JSON → SQLite …');
    try {
      const jp = JSON.parse(fs.readFileSync(OLD_POOL, 'utf8'));
      stmts.updatePool.run(
        jp.universalPool || 0, jp.lossPool || 0,
        jp.lastHourlyPayout || Date.now(), jp.lastDailySpin || 0
      );
      console.log('  ✓ Pool migrated.');
    } catch (e) { console.error('Pool migration error:', e); }
  }
}
migrateFromJson();

// Load wallet and pool data into memory.
function loadWalletsFromDb() {
  const rows = stmts.getAllWallets.all();
  const result = {};
  for (const row of rows) result[row.user_id] = rowToWallet(row);
  return result;
}

function loadPoolFromDb() {
  const row = stmts.getPool.get();
  return {
    universalPool: row.universal_pool,
    lossPool: row.loss_pool,
    lastHourlyPayout: row.last_hourly_payout,
    lastDailySpin: row.last_daily_spin,
  };
}

let wallets = loadWalletsFromDb();
let poolData = loadPoolFromDb();

function normalizeNumeric(value, fallback = 0) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    if (value < BigInt(Number.MIN_SAFE_INTEGER)) return Number.MIN_SAFE_INTEGER;
    return Number(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeCoins(value, fallback = 0) {
  return Math.trunc(normalizeNumeric(value, fallback));
}

for (const wallet of Object.values(wallets)) {
  wallet.balance = normalizeCoins(wallet.balance, STARTING_COINS);
  wallet.bank = normalizeCoins(wallet.bank, 0);
}
poolData.universalPool = normalizeCoins(poolData.universalPool, 0);
poolData.lossPool = normalizeCoins(poolData.lossPool, 0);

function setRuntimeState(key, value) {
  stmts.upsertRuntimeState.run(key, JSON.stringify(value));
}

function getRuntimeState(key, fallback = null) {
  const row = stmts.getRuntimeState.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function removeRuntimeState(key) {
  stmts.deleteRuntimeState.run(key);
}

function sanitizeRuntimeTuning(partial = {}) {
  const merged = { ...DEFAULT_RUNTIME_TUNING, ...(partial || {}) };
  const intervalMs = Math.max(
    CONFIG.runtime.bounds.lifeStatsIntervalMs.min,
    Math.min(CONFIG.runtime.bounds.lifeStatsIntervalMs.max, Math.trunc(normalizeNumeric(merged.lifeStatsIntervalMs, DEFAULT_RUNTIME_TUNING.lifeStatsIntervalMs)))
  );
  const globalEvScalar = Math.max(
    CONFIG.runtime.bounds.globalEvScalar.min,
    Math.min(CONFIG.runtime.bounds.globalEvScalar.max, normalizeNumeric(merged.globalEvScalar, DEFAULT_RUNTIME_TUNING.globalEvScalar))
  );
  const threshold = Math.max(
    CONFIG.runtime.bounds.binomialPityThreshold.min,
    Math.min(CONFIG.runtime.bounds.binomialPityThreshold.max, normalizeNumeric(merged.binomialPityThreshold, DEFAULT_RUNTIME_TUNING.binomialPityThreshold))
  );
  const boostRate = Math.max(
    CONFIG.runtime.bounds.binomialPityBoostRate.min,
    Math.min(CONFIG.runtime.bounds.binomialPityBoostRate.max, normalizeNumeric(merged.binomialPityBoostRate, DEFAULT_RUNTIME_TUNING.binomialPityBoostRate))
  );
  const durationMinutes = Math.max(
    CONFIG.runtime.bounds.binomialPityDurationMinutes.min,
    Math.min(CONFIG.runtime.bounds.binomialPityDurationMinutes.max, normalizeNumeric(merged.binomialPityDurationMinutes, DEFAULT_RUNTIME_TUNING.binomialPityDurationMinutes))
  );
  const cooldownMinutes = Math.max(
    CONFIG.runtime.bounds.binomialPityCooldownMinutes.min,
    Math.min(CONFIG.runtime.bounds.binomialPityCooldownMinutes.max, normalizeNumeric(merged.binomialPityCooldownMinutes, DEFAULT_RUNTIME_TUNING.binomialPityCooldownMinutes))
  );
  return {
    lifeStatsIntervalMs: intervalMs,
    globalEvScalar,
    binomialPityThreshold: threshold,
    binomialPityBoostRate: boostRate,
    binomialPityDurationMinutes: durationMinutes,
    binomialPityCooldownMinutes: cooldownMinutes,
  };
}

function getRuntimeTuning() {
  const raw = getRuntimeState('runtime:tuning', null);
  return sanitizeRuntimeTuning(raw || {});
}

function updateRuntimeTuning(partial = {}) {
  const next = sanitizeRuntimeTuning({ ...getRuntimeTuning(), ...(partial || {}) });
  setRuntimeState('runtime:tuning', next);
  return next;
}

function resetRuntimeTuning() {
  setRuntimeState('runtime:tuning', { ...DEFAULT_RUNTIME_TUNING });
  return getRuntimeTuning();
}

function getDefaultRuntimeTuning() {
  return { ...DEFAULT_RUNTIME_TUNING };
}

// Backfill missing fields on existing wallets.
for (const id in wallets) {
  const w = wallets[id];
  if (!w.inventory) w.inventory = [];
  if (w.spinMultLevel === undefined) w.spinMultLevel = 0;
  if (w.universalIncomeMultLevel === undefined) w.universalIncomeMultLevel = 0;
  if (w.lastBankPayout === undefined) w.lastBankPayout = Date.now();
  ensureWalletStatsShape(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'migration');
}
saveWallets();
console.log('Wallets loaded from SQLite. Fields migrated.');

// Pool helpers.
function savePool() {
  stmts.updatePool.run(
    poolData.universalPool, poolData.lossPool,
    poolData.lastHourlyPayout, poolData.lastDailySpin
  );
}

function getPoolData() { return poolData; }

function computeTieredTax(amount, baseRate) {
  const cfg = CONFIG.economy.pools;
  const slabs = cfg.contributionSlabs;
  if (!slabs || !slabs.length) return Math.floor(amount * baseRate);
  const finalScale = cfg.contributionFinalScale ?? 0.005;
  let total = 0;
  let remaining = amount;
  let prevThreshold = 0;
  for (const slab of slabs) {
    const slabSize = slab.threshold - prevThreshold;
    const applicable = Math.min(remaining, slabSize);
    if (applicable <= 0) break;
    total += applicable * baseRate * slab.scale;
    remaining -= applicable;
    prevThreshold = slab.threshold;
  }
  if (remaining > 0) {
    total += remaining * baseRate * finalScale;
  }
  return Math.floor(total);
}

function computeTieredTaxWithSlabs(amount, baseRate) {
  const cfg = CONFIG.economy.pools;
  const slabs = cfg.contributionSlabs;
  const finalScale = cfg.contributionFinalScale ?? 0.005;
  const result = { total: 0, slabAmounts: [] };
  let remaining = amount;
  let prevThreshold = 0;
  if (slabs && slabs.length) {
    for (let i = 0; i < slabs.length; i++) {
      const slab = slabs[i];
      const slabSize = slab.threshold - prevThreshold;
      const applicable = Math.min(remaining, slabSize);
      const contrib = applicable > 0 ? applicable * baseRate * slab.scale : 0;
      result.slabAmounts.push(Math.floor(contrib));
      result.total += contrib;
      remaining -= applicable;
      if (applicable <= 0) { result.slabAmounts.push(0); }
      prevThreshold = slab.threshold;
    }
  }
  if (remaining > 0) {
    result.slabAmounts.push(Math.floor(remaining * baseRate * finalScale));
    result.total += remaining * baseRate * finalScale;
  }
  result.total = Math.floor(result.total);
  return result;
}

function addToUniversalPool(amount, userId) {
  // Win tax always applies (flat rate)
  const flatTax = Math.floor(amount * POOL_TAX_RATE);
  // But only a tiered portion actually enters the pool (rest is burned)
  const slabResult = computeTieredTaxWithSlabs(amount, POOL_TAX_RATE);
  if (slabResult.total > 0) {
    poolData.universalPool += slabResult.total;
    // Track cumulative contributions per slab for the breakdown page
    const slabStats = getRuntimeState('poolSlabStats', {}) || {};
    for (let i = 0; i < slabResult.slabAmounts.length; i++) {
      const key = `slab_${i}`;
      slabStats[key] = (slabStats[key] || 0) + slabResult.slabAmounts[i];
    }
    slabStats._totalContributed = (slabStats._totalContributed || 0) + slabResult.total;
    setRuntimeState('poolSlabStats', slabStats);
    savePool();
  }
  return flatTax;
}

function getPoolSlabStats() {
  return getRuntimeState('poolSlabStats', {}) || {};
}

function addToLossPool(amount) {
  const tax = Math.floor(amount * LOSS_POOL_RATE);
  if (tax > 0) { poolData.lossPool += tax; savePool(); }
  return tax;
}

// Wallet helpers.

// Save a single wallet to the database (used by hot-path operations).
function saveWallet(userId) {
  const w = wallets[userId];
  if (!w) return;
  ensureWalletStatsShape(w);
  maybeTrackNetWorthSnapshotForWallet(w);
  stmts.upsertWallet.run(
    userId,
    w.balance, w.lastDaily || 0, w.streak || 0,
    w.bank || 0, w.lastBankPayout || 0,
    w.interestLevel || 0, w.cashbackLevel || 0, w.spinMultLevel || 0, w.universalIncomeMultLevel || 0,
    JSON.stringify(w.inventory || []),
    JSON.stringify(w.stats || DEFAULT_STATS())
  );
}

// Save ALL wallets (used for bulk operations like hourly distribution).
function saveWallets() {
  const entries = Object.entries(wallets);
  if (entries.length === 0) return;
  const upsertAll = db.transaction(() => {
    for (const [userId, w] of entries) {
      ensureWalletStatsShape(w);
      maybeTrackNetWorthSnapshotForWallet(w);
      stmts.upsertWallet.run(
        userId,
        w.balance, w.lastDaily || 0, w.streak || 0,
        w.bank || 0, w.lastBankPayout || 0,
        w.interestLevel || 0, w.cashbackLevel || 0, w.spinMultLevel || 0, w.universalIncomeMultLevel || 0,
        JSON.stringify(w.inventory || []),
        JSON.stringify(w.stats || DEFAULT_STATS())
      );
    }
  });
  upsertAll();
}

function getAllWallets() { return wallets; }

function getWallet(userId) {
  if (!wallets[userId]) {
    wallets[userId] = {
      balance: STARTING_COINS, lastDaily: 0, streak: 0,
      bank: 0, lastBankPayout: Date.now(),
      interestLevel: 0, cashbackLevel: 0, spinMultLevel: 0, universalIncomeMultLevel: 0,
      inventory: [],
      stats: DEFAULT_STATS(),
    };
    saveWallet(userId);
  }
  const w = wallets[userId];
  if (w.balance === undefined) w.balance = STARTING_COINS;
  w.balance = normalizeCoins(w.balance, STARTING_COINS);
  if (w.bank === undefined) w.bank = 0;
  w.bank = normalizeCoins(w.bank, 0);
  if (w.lastBankPayout === undefined) w.lastBankPayout = Date.now();
  if (w.interestLevel === undefined) w.interestLevel = 0;
  if (w.cashbackLevel === undefined) w.cashbackLevel = 0;
  if (w.spinMultLevel === undefined) w.spinMultLevel = 0;
  if (w.universalIncomeMultLevel === undefined) w.universalIncomeMultLevel = 0;
  if (!w.inventory) w.inventory = [];
  ensureWalletStatsShape(w);
  return w;
}

function deleteWallet(userId) {
  delete wallets[userId];
  stmts.deleteWallet.run(userId);
}

// Reset only the purse (balance) to starting coins, keeping inventory, upgrades, bank, stats.
function resetPurse(userId) {
  const w = getWallet(userId);
  w.balance = STARTING_COINS;
  saveWallet(userId);
}

// Clear the hourly (universal) pool.
function clearHourlyPool() {
  poolData.universalPool = 0;
  savePool();
}

// Clear the daily spin (loss) pool.
function clearDailySpinPool() {
  poolData.lossPool = 0;
  savePool();
}

// Reset all players' purse and bank, preserving inventory/upgrades/stats.
// Purse is set to STARTING_COINS; bank is set to 0.
function resetAllPursesAndBanks() {
  let count = 0;
  for (const userId of Object.keys(wallets)) {
    const w = wallets[userId];
    w.balance = STARTING_COINS;
    w.bank = 0;
    count++;
  }
  if (count > 0) saveWallets();
  return count;
}

function getBalance(userId) { return normalizeCoins(getWallet(userId).balance, 0); }

function setBalance(userId, amount) {
  const w = getWallet(userId);
  w.balance = normalizeCoins(amount, 0);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'balance');
  saveWallet(userId);
}

function getInterestRate(userId) {
  const w = getWallet(userId);
  const bonuses = getInventoryBonuses(w.inventory);
  const xpInfo = getXpInfo(userId);
  return BASE_INVEST_RATE + (w.interestLevel * CONFIG.economy.upgrades.interestPerLevel) + bonuses.interestRateBonus + xpInfo.xpBonuses.interestRate;
}

function getCashbackRate(userId) {
  const w = getWallet(userId);
  const bonuses = getInventoryBonuses(w.inventory);
  const xpInfo = getXpInfo(userId);
  return (w.cashbackLevel * CONFIG.economy.upgrades.cashbackPerLevel) + bonuses.cashbackRateBonus + xpInfo.xpBonuses.cashbackRate;
}

function applyCashback(userId, lossAmount) {
  const loss = normalizeCoins(lossAmount, 0);
  if (loss <= 0) return 0;
  const rate = getCashbackRate(userId);
  let totalCashback = 0;
  if (rate > 0) {
    totalCashback += Math.floor(loss * rate);
  }
  // Luck buff no longer gives cashback  - it now boosts win chance instead.
  // (Legacy block removed)
  const w = getWallet(userId);
  if (totalCashback > 0) {
    w.balance += totalCashback;
    saveWallet(userId);
  }
  return totalCashback;
}

// Luck buff is now applied as a win-chance modifier (via getWinChanceModifier), not cashback.
// This function is kept as a no-op for any legacy callers.
function applyLuckCashback(userId, lossAmount, now = Date.now()) {
  return 0;
}

function getSpinWeight(userId) {
  return 1 + (getWallet(userId).spinMultLevel || 0) * CONFIG.economy.upgrades.spinMultPerLevel;
}

function getUniversalIncomeDoubleChance(userId) {
  const w = getWallet(userId);
  const level = w.universalIncomeMultLevel || 0;
  const bonuses = getInventoryBonuses(w.inventory);
  const xpInfo = getXpInfo(userId);
  const chance = (Math.max(0, Math.min(CONFIG.economy.upgrades.maxLevel, level)) * CONFIG.economy.upgrades.universalIncomePerLevelChance) + bonuses.universalDoubleChanceBonus + xpInfo.xpBonuses.universalDoubleChance;
  return Math.max(0, Math.min(CONFIG.economy.upgrades.universalIncomeChanceCap, chance));
}

function getMysteryBoxLuckInfo(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const inventoryBonuses = getInventoryBonuses(w.inventory);
  const pityStreak = Math.max(0, w.stats.mysteryBox.pityStreak || 0);
  const pityLuckBonus = Math.min(
    CONFIG.collectibles.mysteryBox.pity.maxLuckBonus,
    pityStreak * CONFIG.collectibles.mysteryBox.pity.luckPerStreakStep
  );
  const totalLuck = inventoryBonuses.mysteryBoxLuckBonus + pityLuckBonus;
  return {
    pityStreak,
    pityLuckBonus,
    inventoryLuckBonus: inventoryBonuses.mysteryBoxLuckBonus,
    totalLuck,
  };
}

function getUserBonuses(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const tuning = getRuntimeTuning();
  const invBonuses = getInventoryBonuses(w.inventory);
  const boxLuck = getMysteryBoxLuckInfo(userId);
  const luckState = getLuckState(w);

  // Base values (upgrades only, no items)
  const baseInterestRate = BASE_INVEST_RATE + (w.interestLevel * CONFIG.economy.upgrades.interestPerLevel);
  const baseCashbackRate = w.cashbackLevel * CONFIG.economy.upgrades.cashbackPerLevel;
  const baseSpinWeight = 1 + (w.spinMultLevel || 0) * CONFIG.economy.upgrades.spinMultPerLevel;
  const baseUniversalDoubleChance = Math.max(0, Math.min(CONFIG.economy.upgrades.maxLevel, w.universalIncomeMultLevel || 0)) * CONFIG.economy.upgrades.universalIncomePerLevelChance;
  const baseMinesRevealChance = 0;

  return {
    interestRate: getInterestRate(userId),
    cashbackRate: getCashbackRate(userId),
    spinWeight: getSpinWeight(userId),
    universalIncomeDoubleChance: getUniversalIncomeDoubleChance(userId),
    mysteryBoxLuck: boxLuck.totalLuck,
    pityStreak: boxLuck.pityStreak,
    pityLuckBonus: boxLuck.pityLuckBonus,
    inventoryLuckBonus: boxLuck.inventoryLuckBonus,
    minesRevealChance: invBonuses.minesRevealChance,
    spinWeightBonus: invBonuses.spinWeightBonus,
    inventoryEffects: invBonuses.effectLines,
    // Breakdown: base (upgrades only)
    base: {
      interestRate: baseInterestRate,
      cashbackRate: baseCashbackRate,
      spinWeight: baseSpinWeight,
      universalDoubleChance: baseUniversalDoubleChance,
      minesRevealChance: baseMinesRevealChance,
    },
    // Breakdown: item bonuses only
    items: {
      interestRate: invBonuses.interestRateBonus,
      cashbackRate: invBonuses.cashbackRateBonus,
      spinWeight: invBonuses.spinWeightBonus,
      universalDoubleChance: invBonuses.universalDoubleChanceBonus,
      minesRevealChance: invBonuses.minesRevealChance,
    },
    luck: {
      active: luckState.active,
      winChanceBoost: luckState.winChanceBoost,
      maxWinChanceBoost: luckState.maxWinChanceBoost,
      buffStreak: luckState.buffStreak,
      lossStreak: luckState.lossStreak,
      bestLossStreak: luckState.bestLossStreak,
      triggers: luckState.triggers,
      totalCashback: luckState.totalCashback,
      expiresInMs: luckState.expiresInMs,
      activationThreshold: LUCK_ACTIVATION_THRESHOLD,
      tier1Cap: LUCK_TIER1_CAP,
      tier2Cap: LUCK_TIER2_CAP,
      durationMs: LUCK_DURATION_MS,
    },
    runtimeTuning: tuning,
    // XP level bonuses applied on top of everything else
    xpBonuses: (() => {
      const xpInfo = getXpInfo(userId);
      return xpInfo.xpBonuses;
    })(),
  };
}

function getXpLeaderboard() {
  // return the top 10 players by total XP, useful for public leaderboards
  return Object.entries(wallets).map(([userId, w]) => {
    const xpInfo = getXpInfo(userId);
    return { userId, totalXp: xpInfo.totalXp, level: xpInfo.level, title: xpInfo.title, gamesPlayed: xpInfo.totalGamesPlayed };
  }).sort((a, b) => b.totalXp - a.totalXp).slice(0, 10);
}

// full sorted list for internal ranking calculations (not sliced)
function getXpLeaderboardAll() {
  return Object.entries(wallets).map(([userId, w]) => {
    const xpInfo = getXpInfo(userId);
    return { userId, totalXp: xpInfo.totalXp };
  }).sort((a, b) => b.totalXp - a.totalXp);
}

function getXpRank(userId) {
  const list = getXpLeaderboardAll();
  const idx = list.findIndex(e => e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

function getCollectibleLeaderboard() {
  // sort primarily by unique count then by total items owned
  return Object.entries(wallets).map(([userId, w]) => {
    const total = (w.inventory || []).length;
    const unique = new Set((w.inventory || []).map(i => i.id)).size;
    return { userId, unique, total };
  }).filter(e => e.total > 0)
    .sort((a, b) => {
      if (b.unique !== a.unique) return b.unique - a.unique;
      return b.total - a.total;
    });
}

function getCollectibleRank(userId) {
  const list = getCollectibleLeaderboard();
  const idx = list.findIndex(e => e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

function getUserPityStatus(userId, now = Date.now()) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  refreshLuckBuff(luck, now);

  const buff = luck.buff || { boost: 0, expiresAt: 0, streak: 0 };
  const active = buff.boost > 0 && buff.expiresAt > now;

  return {
    active,
    winChanceBoost: active ? buff.boost : 0,
    maxWinChanceBoost: LUCK_MAX_BOOST,
    buffStreak: active ? (buff.streak || 0) : 0,
    lossStreak: luck.lossStreak || 0,
    bestLossStreak: luck.bestLossStreak || 0,
    triggers: luck.triggers || 0,
    totalCashback: luck.totalCashback || 0,
    expiresInMs: active ? Math.max(0, buff.expiresAt - now) : 0,
    activationThreshold: LUCK_ACTIVATION_THRESHOLD,
    tier1Cap: LUCK_TIER1_CAP,
    tier2Cap: LUCK_TIER2_CAP,
  };
}

// ── Potion System ──

function getPotionConfig() {
  return {
    luckyPotCost: LUCKY_POT_COST,
    luckyPotDurationMs: LUCKY_POT_DURATION_MS,
    luckyPotBoost: LUCKY_POT_BOOST,
    unluckyPotCost: UNLUCKY_POT_COST,
    unluckyPotDurationMs: UNLUCKY_POT_DURATION_MS,
    unluckyPotPenalty: UNLUCKY_POT_PENALTY,
  };
}

function getActivePotions(userId, now = Date.now()) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const potions = w.stats.potions || { lucky: null, unlucky: null };
  let lucky = null;
  let unlucky = null;
  if (potions.lucky && Array.isArray(potions.lucky.stacks)) {
    // Filter out expired stacks
    lucky = {
      stacks: potions.lucky.stacks.filter(s => s.expiresAt > now),
      expiresAt: Math.max(...potions.lucky.stacks.map(s => s.expiresAt)),
    };
    if (lucky.stacks.length === 0) lucky = null;
  } else if (potions.lucky && potions.lucky.expiresAt > now) {
    lucky = { stacks: [{ expiresAt: potions.lucky.expiresAt }], expiresAt: potions.lucky.expiresAt };
  }
  if (potions.unlucky && potions.unlucky.expiresAt > now) {
    unlucky = potions.unlucky;
  }
  return { lucky, unlucky };
}

function getWinChanceModifier(userId, now = Date.now()) {
  const potions = getActivePotions(userId, now);
  let modifier = 1.0;
  if (potions.lucky) {
    // One active stack gives LUCKY_POT_BOOST
    const stacks = potions.lucky.stacks ? potions.lucky.stacks.length : 1;
    modifier += Math.min(stacks, 1) * LUCKY_POT_BOOST;
  }
  if (potions.unlucky) modifier -= UNLUCKY_POT_PENALTY;
  // Losing streak win chance boost stacks on top of potions
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  refreshLuckBuff(luck, now);
  const luckBoost = (luck.buff && luck.buff.boost > 0 && luck.buff.expiresAt > now) ? luck.buff.boost : 0;
  modifier += luckBoost;
  return modifier;
}

function buyLuckyPot(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.balance < LUCKY_POT_COST) return { success: false, reason: 'insufficient_funds' };
  const now = Date.now();
  if (!w.stats.potions) w.stats.potions = {};
  if (!w.stats.potions.lucky) w.stats.potions.lucky = { stacks: [] };
  if (!Array.isArray(w.stats.potions.lucky.stacks)) w.stats.potions.lucky.stacks = [];
  // Remove expired stacks
  w.stats.potions.lucky.stacks = w.stats.potions.lucky.stacks.filter(s => s.expiresAt > now);
  if (w.stats.potions.lucky.stacks.length >= 1) return { success: false, reason: 'already_active' };
  w.balance -= LUCKY_POT_COST;
  w.stats.potions.lucky.stacks.push({ expiresAt: now + LUCKY_POT_DURATION_MS });
  saveWallet(userId);
  return { success: true, stacks: w.stats.potions.lucky.stacks.length };
}

function buyUnluckyPot(buyerId, targetId) {
  const buyer = getWallet(buyerId);
  ensureWalletStatsShape(buyer);
  if (buyer.balance < UNLUCKY_POT_COST) return { success: false, reason: 'insufficient_funds' };
  if (buyerId === targetId) return { success: false, reason: 'self_target' };
  if (!hasWallet(targetId)) return { success: false, reason: 'no_wallet' };
  const target = getWallet(targetId);
  ensureWalletStatsShape(target);
  const activePotions = getActivePotions(targetId);
  if (activePotions.unlucky) return { success: false, reason: 'already_active' };
  buyer.balance -= UNLUCKY_POT_COST;
  target.stats.potions.unlucky = { expiresAt: Date.now() + UNLUCKY_POT_DURATION_MS, appliedBy: buyerId };
  saveWallet(buyerId);
  saveWallet(targetId);
  return { success: true };
}

function removeUnluckyPot(targetId) {
  if (!hasWallet(targetId)) return { success: false, reason: 'no_wallet' };
  const target = getWallet(targetId);
  ensureWalletStatsShape(target);
  if (!target.stats.potions.unlucky || target.stats.potions.unlucky.expiresAt <= Date.now()) {
    return { success: false, reason: 'not_active' };
  }
  target.stats.potions.unlucky = null;
  saveWallet(targetId);
  return { success: true };
}

function applyProfitBoost(userId, gameName, baseProfit) {
  const profit = normalizeCoins(baseProfit, 0);
  return profit;
}

function tryTriggerMinesReveal(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const bonuses = getInventoryBonuses(w.inventory);
  if (bonuses.minesRevealChance <= 0) return false;
  const triggered = Math.random() < bonuses.minesRevealChance;
  if (triggered) {
    w.stats.bonuses.minesSaves += 1;
    saveWallet(userId);
  }
  return triggered;
}

// Compute the total daily interest on `balance` using a tiered slab system.
// Interest for each slab uses progressive rate scaling.
// Mirrors tax-bracket semantics with an array of slab definitions.
function computeTieredDailyInterest(balance, r) {
  const cfg = CONFIG.economy.bank.tieredInterest;
  if (!cfg || !cfg.slabs) return balance * r; // fallback: flat rate
  const { slabs, finalScale } = cfg;
  let total = 0;
  let remaining = balance;
  let prevThreshold = 0;
  for (const slab of slabs) {
    const slabSize = slab.threshold - prevThreshold;
    const applicable = Math.min(remaining, slabSize);
    if (applicable <= 0) break;
    total += applicable * r * slab.scale;
    remaining -= applicable;
    prevThreshold = slab.threshold;
  }
  // Anything above the last slab threshold
  if (remaining > 0) {
    total += remaining * r * (finalScale || 0.001);
  }
  return total;
}

// Process minute-accrued bank interest, paid to bank on hourly boundaries.
// Optimized: batches minutes in chunks up to the next payout boundary instead
// of looping minute-by-minute (60x fewer iterations for a 24h gap).
function processBank(userId, { forceFlush = false } = {}) {
  const w = getWallet(userId);
  if (!w.stats.interest) w.stats.interest = { totalEarned: 0, pendingFraction: 0, pendingCoins: 0, pendingMinutes: 0, lastAccrualAt: 0 };
  if (w.stats.interest.pendingFraction === undefined) w.stats.interest.pendingFraction = 0;
  if (w.stats.interest.pendingCoins === undefined) w.stats.interest.pendingCoins = 0;
  if (w.stats.interest.pendingMinutes === undefined) w.stats.interest.pendingMinutes = 0;
  if (w.stats.interest.lastAccrualAt === undefined) w.stats.interest.lastAccrualAt = 0;

  const hasPrincipal = !!w.bank && w.bank > 0;
  const hasPending = (w.stats.interest.pendingCoins || 0) > 0 || (w.stats.interest.pendingMinutes || 0) > 0 || (w.stats.interest.pendingFraction || 0) > 0;
  if (!hasPrincipal && !hasPending) return 0;

  const now = Date.now();
  const minuteMs = CONFIG.economy.bank.interestAccrualMinuteMs;
  const baseLast = w.stats.interest.lastAccrualAt || w.lastBankPayout || now;
  const elapsedMinutes = Math.floor((now - baseLast) / minuteMs);
  if (elapsedMinutes < 1 && !forceFlush) return 0;

  const r = getInterestRate(userId);
  let pendingFraction = w.stats.interest.pendingFraction || 0;
  let pendingCoins = w.stats.interest.pendingCoins || 0;
  let pendingMinutes = w.stats.interest.pendingMinutes || 0;
  let processedAt = baseLast;
  let totalPayout = 0;
  const payoutInterval = CONFIG.economy.bank.payoutIntervalMinutes;
  let remainingMinutes = elapsedMinutes;

  while (remainingMinutes > 0) {
    // How many minutes until the next payout boundary?
    const minutesToPayout = payoutInterval - pendingMinutes;
    const batchMinutes = Math.min(remainingMinutes, minutesToPayout);

    // Calculate interest for the entire batch at current bank balance.
    // perMinuteRaw is constant within a batch because bank doesn't change
    // until a payout boundary is crossed.
    const perMinuteRaw = computeTieredDailyInterest(w.bank || 0, r) / 24 / 60;
    const rawInterest = perMinuteRaw * batchMinutes + pendingFraction;
    const batchInterest = Math.floor(rawInterest);
    pendingFraction = rawInterest - batchInterest;
    pendingCoins += batchInterest;
    pendingMinutes += batchMinutes;
    processedAt += batchMinutes * minuteMs;
    remainingMinutes -= batchMinutes;

    if (pendingMinutes >= payoutInterval) {
      if (pendingCoins > 0) {
        w.bank += pendingCoins;
        totalPayout += pendingCoins;
      }
      pendingCoins = 0;
      pendingMinutes = 0;
      w.lastBankPayout = processedAt;
    }
  }

  // When forceFlush is true (hourly distribution), pay out any remaining pending coins
  if (forceFlush && pendingCoins > 0) {
    w.bank += pendingCoins;
    totalPayout += pendingCoins;
    pendingCoins = 0;
    pendingMinutes = 0;
    w.lastBankPayout = processedAt || now;
  }

  w.stats.interest.pendingFraction = pendingFraction;
  w.stats.interest.pendingCoins = pendingCoins;
  w.stats.interest.pendingMinutes = pendingMinutes;
  w.stats.interest.lastAccrualAt = processedAt || now;

  if (totalPayout > 0) {
    w.stats.interest.totalEarned += totalPayout;
    w.stats.lifetimeEarnings += totalPayout;
    maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'interest');
  }

  saveWallet(userId);
  return totalPayout;
}

// Daily reward helpers.
function checkDaily(userId) {
  const w = getWallet(userId);
  const now = Date.now(), last = w.lastDaily || 0;
  const dayMs = CONFIG.economy.daily.claimCooldownMs;
  if (now - last < dayMs) {
    const rem = (last + dayMs) - now;
    return {
      canClaim: false,
      hours: Math.floor(rem / 3600000),
      mins: Math.floor((rem % 3600000) / 60000),
      streak: w.streak || 0,
    };
  }
  return { canClaim: true, streakBroken: (now - last) > CONFIG.economy.daily.streakBreakMs, streak: w.streak || 0 };
}

function claimDaily(userId) {
  const w = getWallet(userId);
  const now = Date.now(), last = w.lastDaily || 0;
  if ((now - last) > CONFIG.economy.daily.streakBreakMs && last !== 0) w.streak = 1;
  else w.streak = (w.streak || 0) + 1;
  const reward = CONFIG.economy.daily.baseReward + (CONFIG.economy.daily.streakBonusPerDay * (w.streak - 1));
  w.balance += reward;
  w.lastDaily = now;
  maybeTrackNetWorthSnapshotForWallet(w, now, 'daily');
  saveWallet(userId);
  return { newBalance: w.balance, streak: w.streak, reward };
}

// Mystery box helpers.
function rollMysteryBox(userId = null) {
  let luck = 0;
  let w = null;
  if (userId) {
    w = getWallet(userId);
    ensureWalletStatsShape(w);
    const luckInfo = getMysteryBoxLuckInfo(userId);
    luck = Math.max(0, luckInfo.totalLuck);
  }

  const adjustedPools = Object.entries(MYSTERY_BOX_POOLS).map(([rarity, pool]) => {
    let mult = 1;
    const rules = CONFIG.collectibles.mysteryBox.luckWeightMultipliers[rarity];
    if (luck > 0) {
      if (rules) {
        mult = 1 + (luck * rules.slope);
        if (Number.isFinite(rules.floor)) {
          mult = Math.max(rules.floor, mult);
        }
      }
    }
    return [rarity, { ...pool, adjustedWeight: pool.weight * mult }];
  });

  const totalW = adjustedPools.reduce((s, [, p]) => s + p.adjustedWeight, 0);
  let roll = Math.random() * totalW;
  for (const [rarity, pool] of adjustedPools) {
    roll -= pool.adjustedWeight;
    if (roll <= 0) {
      const it = pool.items;
      const item = it[Math.floor(Math.random() * it.length)];
      const isHighRarity = (RARITY_TIER[rarity] || 1) >= RARITY_TIER[CONFIG.collectibles.mysteryBox.highRarityThreshold];
      return { ...item, _rarity: rarity, _isHighRarity: isHighRarity };
    }
  }
  const c = MYSTERY_BOX_POOLS.common.items;
  const item = c[Math.floor(Math.random() * c.length)];
  return { ...item, _rarity: 'common', _isHighRarity: false };
}

function rollPremiumMysteryBox(userId = null) {
  let luck = 0;
  if (userId) {
    const w = getWallet(userId);
    ensureWalletStatsShape(w);
    const luckInfo = getMysteryBoxLuckInfo(userId);
    luck = Math.max(0, luckInfo.totalLuck);
  }

  const adjustedPools = Object.entries(PREMIUM_MYSTERY_BOX_POOLS).map(([rarity, pool]) => {
    let mult = 1;
    const rules = CONFIG.collectibles.premiumMysteryBox.luckWeightMultipliers[rarity];
    if (luck > 0 && rules) {
      mult = 1 + (luck * rules.slope);
      if (Number.isFinite(rules.floor)) {
        mult = Math.max(rules.floor, mult);
      }
    }
    return [rarity, { ...pool, adjustedWeight: pool.weight * mult }];
  });

  const totalW = adjustedPools.reduce((s, [, p]) => s + p.adjustedWeight, 0);
  let roll = Math.random() * totalW;
  for (const [rarity, pool] of adjustedPools) {
    roll -= pool.adjustedWeight;
    if (roll <= 0) {
      const it = pool.items;
      const item = it[Math.floor(Math.random() * it.length)];
      const isHighRarity = (RARITY_TIER[rarity] || 1) >= RARITY_TIER[CONFIG.collectibles.premiumMysteryBox.highRarityThreshold];
      return { ...item, _rarity: rarity, _isHighRarity: isHighRarity };
    }
  }
  // fallback to uncommon
  const u = PREMIUM_MYSTERY_BOX_POOLS.uncommon.items;
  const item = u[Math.floor(Math.random() * u.length)];
  return { ...item, _rarity: 'uncommon', _isHighRarity: false };
}

// Apply mystery box stats after a successful interaction reply.
function applyMysteryBoxStats(userId, items) {
  const w = getWallet(userId);
  if (!w) return;
  ensureWalletStatsShape(w);
  for (const item of items) {
    w.stats.mysteryBox.opened += 1;
    if (item._isHighRarity) {
      w.stats.mysteryBox.luckyHighRarity += 1;
      w.stats.mysteryBox.pityStreak = 0;
    } else {
      w.stats.mysteryBox.pityStreak += 1;
      if (w.stats.mysteryBox.pityStreak > w.stats.mysteryBox.bestPityStreak) {
        w.stats.mysteryBox.bestPityStreak = w.stats.mysteryBox.pityStreak;
      }
    }
  }
  maybeTrackCollectibleSnapshot(w, Date.now(), 'mysteryBox');
}

// Calculate duplicate compensation by rarity.
function getDuplicateCompensation(itemId, rarity) {
  const COMP_BY_RARITY = CONFIG.collectibles.mysteryBox.duplicateCompensationByRarity;
  return COMP_BY_RARITY[rarity] || 0;
}

function getDuplicateCompensationTable() {
  return { ...CONFIG.collectibles.mysteryBox.duplicateCompensationByRarity };
}

// Number formatting helpers.
const NUMBER_TIERS = [
  { threshold: 1e21, suffix: 'sx' },
  { threshold: 1e18, suffix: 'qi' },
  { threshold: 1e15, suffix: 'qa' },
  { threshold: 1e12, suffix: 't' },
  { threshold: 1e9,  suffix: 'b' },
  { threshold: 1e6,  suffix: 'm' },
];

function formatNumberRaw(num) {
  return normalizeCoins(num, 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumber(num) {
  num = normalizeCoins(num, 0);
  for (const tier of NUMBER_TIERS) {
    if (num >= tier.threshold) {
      const abbr = (num / tier.threshold).toFixed(2) + tier.suffix;
      const full = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return `${abbr} (${full})`;
    }
  }
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumberShort(num) {
  num = normalizeCoins(num, 0);
  for (const tier of NUMBER_TIERS) {
    if (num >= tier.threshold) return (num / tier.threshold).toFixed(1) + tier.suffix.toUpperCase();
  }
  if (num >= 1e4) return (num / 1e3).toFixed(1) + 'K';
  return formatNumberRaw(num);
}

// Parse abbreviated amounts like 1k/1m/1b.
function parseAmount(str, maxValue = null) {
  if (!str) return null;
  const trimmed = str.toLowerCase().trim();
  const cap = (maxValue !== null && maxValue !== undefined)
    ? normalizeCoins(maxValue, 0)
    : null;
  
  // Support the special "all" keyword.
  if (trimmed === 'all') {
    return cap !== null ? cap : null;
  }
  
  // Parse numeric values with optional k/m/b/t/qa/qi/sx suffixes.
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(k|m|b|t|qa|qi|sx)?$/);
  if (!match) return null;
  
  let num = parseFloat(match[1]);
  const suffix = match[2] || '';
  
  if (suffix === 'k') num *= 1e3;
  else if (suffix === 'm') num *= 1e6;
  else if (suffix === 'b') num *= 1e9;
  else if (suffix === 't') num *= 1e12;
  else if (suffix === 'qa') num *= 1e15;
  else if (suffix === 'qi') num *= 1e18;
  else if (suffix === 'sx') num *= 1e21;
  
  num = Math.floor(num);
  if (cap !== null && num > cap) num = cap;
  
  return num > 0 ? num : null;
}

// Giveaway state helpers.
let activeGiveaways = {};
let giveawayCounter = 0;

function saveGiveawayState() {
  setRuntimeState('giveaways', {
    activeGiveaways,
    giveawayCounter,
  });
}

function loadGiveawayState() {
  const state = getRuntimeState('giveaways', null);
  if (!state || typeof state !== 'object') return;
  activeGiveaways = state.activeGiveaways && typeof state.activeGiveaways === 'object' ? state.activeGiveaways : {};
  giveawayCounter = Number.isInteger(state.giveawayCounter) ? state.giveawayCounter : 0;
}

loadGiveawayState();

function createGiveaway(initiatorId, amount, durationMs, channelId = null, message = null) {
  const id = `giveaway_${++giveawayCounter}`;
  const giveaway = {
    id, initiatorId, amount,
    channelId,
    message,
    messageId: null,
    participants: [],
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  activeGiveaways[id] = giveaway;
  saveGiveawayState();
  return giveaway;
}

function setGiveawayMessageRef(giveawayId, messageId, channelId = null) {
  const g = activeGiveaways[giveawayId];
  if (!g) return false;
  g.messageId = messageId;
  if (channelId) g.channelId = channelId;
  saveGiveawayState();
  return true;
}

function getGiveaway(id) { return activeGiveaways[id] || null; }

function getAllGiveaways() { return Object.values(activeGiveaways); }

function joinGiveaway(giveawayId, userId) {
  const g = activeGiveaways[giveawayId];
  if (!g || g.participants.includes(userId)) return false;
  g.participants.push(userId);
  saveGiveawayState();
  return true;
}

function removeGiveaway(id) {
  delete activeGiveaways[id];
  saveGiveawayState();
}

// Basic stats tracking.
function insertTopResult(arr, entry, limit = 5) {
  arr.push(entry);
  arr.sort((a, b) => b.amount - a.amount);
  if (arr.length > limit) arr.length = limit;
}

// Games that qualify for the luck/pity streak system.
// letitride is excluded because users can abuse it with tiny bets to build streaks.
const LUCK_ELIGIBLE_GAMES = new Set(['flip', 'duel']);

// ── XP System ──

// Compute and return xp info for a user (level, title, progress to next level).
function getXpInfo(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const totalXp = w.stats.xp || 0;
  const thresholds = CONFIG.xp.levelThresholds;
  const maxLevel = CONFIG.xp.maxLevel;
  let level = 0;
  let xpUsed = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (totalXp >= xpUsed + thresholds[i]) {
      xpUsed += thresholds[i];
      level = i + 1;
    } else {
      break;
    }
  }
  const currentLevelXp = totalXp - xpUsed;
  const xpToNext = level < maxLevel ? thresholds[level] - currentLevelXp : 0;
  const nextLevelTotal = level < maxLevel ? thresholds[level] : 0;
  const titles = CONFIG.xp.titles;
  const title = [...titles].reverse().find(t => level >= t.minLevel)?.title || 'Newcomer';
  const tenLevelMilestones = Math.floor(level / 10);
  const bonusPer10 = CONFIG.xp.bonusPerTenLevels;
  const xpBonuses = {
    interestRate: tenLevelMilestones * bonusPer10.interestRate,
    cashbackRate: tenLevelMilestones * bonusPer10.cashbackRate,
    universalDoubleChance: tenLevelMilestones * bonusPer10.universalDoubleChance,
  };
  return { totalXp, level, currentLevelXp, xpToNext, nextLevelTotal, title, xpBonuses, totalGamesPlayed: w.stats.totalGamesPlayed || 0 };
}

function awardGameXp(w) {
  const xpPerGame = CONFIG.xp.perGame;
  w.stats.xp = (w.stats.xp || 0) + xpPerGame;
  w.stats.totalGamesPlayed = (w.stats.totalGamesPlayed || 0) + 1;
  maybeTrackXpSnapshot(w, Date.now(), 'game');
}

function recordWin(userId, gameName, amount) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.stats[gameName]) {
    w.stats[gameName].wins += 1;
  }
  w.stats.lifetimeEarnings += amount;
  insertTopResult(w.stats.topWins, { game: gameName, amount, t: Date.now() });
  if (LUCK_ELIGIBLE_GAMES.has(gameName)) evaluateLuckOnWin(w);
  awardGameXp(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `win:${gameName}`);
  saveWallet(userId);
  return { triggered: false };
}

function recordLoss(userId, gameName, amount) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.stats[gameName]) {
    w.stats[gameName].losses += 1;
  }
  w.stats.lifetimeLosses += amount;
  insertTopResult(w.stats.topLosses, { game: gameName, amount, t: Date.now() });
  const luckResult = LUCK_ELIGIBLE_GAMES.has(gameName) ? evaluateLuckOnLoss(w) : { triggered: false };
  awardGameXp(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `loss:${gameName}`);
  saveWallet(userId);
  return luckResult;
}

// Extended stats tracking helpers.
function hasWallet(userId) {
  return !!wallets[userId];
}

function resetStats(userId) {
  const w = getWallet(userId);
  const totalBalance = (w.balance || 0) + (w.bank || 0);
  w.stats = DEFAULT_STATS();
  w.stats.lifetimeEarnings = totalBalance;
  w.stats.lifetimeLosses = 0;
  saveWallet(userId);
}

// Clear game stats for ALL wallets, but keep inventory, upgrades, XP, and balances.
// Resets: per-game W/L, earnings, losses, topWins, topLosses, netWorthHistory,
//         xpHistory, collectibleHistory, giveaway, mysteryBox, dailySpin, interest earned, universal earned.
// Keeps: balance, bank, upgrade levels, inventory, XP total, totalGamesPlayed, active buffs.
function clearAllGameStats() {
  const now = Date.now();
  let count = 0;
  for (const [userId, w] of Object.entries(wallets)) {
    ensureWalletStatsShape(w);
    const currentBalance = (w.balance || 0) + (w.bank || 0);

    // Reset per-game stats
    for (const g of GAME_KEYS) {
      w.stats[g] = { wins: 0, losses: 0 };
    }

    // Reset lifetime tracking
    w.stats.lifetimeEarnings = currentBalance;
    w.stats.lifetimeLosses = 0;
    w.stats.topWins = [];
    w.stats.topLosses = [];

    // Reset all history graphs - fresh start with a single current point
    w.stats.netWorthHistory = [{ t: now, v: currentBalance, r: 'reset' }];
    w.stats.xpHistory = [{ t: now, v: w.stats.xp || 0, r: 'reset' }];
    const uniqueCollectibles = new Set((w.inventory || []).map(i => i.id)).size;
    w.stats.collectibleHistory = [{ t: now, v: uniqueCollectibles, r: 'reset' }];

    // Reset tracking counters
    w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
    w.stats.mysteryBox = { duplicateCompEarned: 0, opened: 0, spent: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 };
    w.stats.dailySpin = { won: 0, amountWon: 0 };
    w.stats.interest.totalEarned = 0;
    w.stats.universalIncome = { totalEarned: 0 };
    w.stats.bonuses.minesSaves = 0;
    w.stats.bonuses.evBoostProfit = 0;

    count++;
  }
  if (count > 0) saveWallets();
  return count;
}

function resetAllActivePity() {
  let usersCleared = 0;
  let buffsCleared = 0;
  for (const wallet of Object.values(wallets)) {
    ensureWalletStatsShape(wallet);
    const luck = wallet.stats.bonuses.luck;
    // Migrate old stacks
    if (Array.isArray(luck.stacks)) delete luck.stacks;
    if (!luck.buff) luck.buff = { boost: 0, expiresAt: 0, streak: 0 };
    if (luck.buff.boost > 0) {
      usersCleared += 1;
      buffsCleared += 1;
      luck.buff = { boost: 0, expiresAt: 0, streak: 0 };
    }
    luck.lossStreak = 0;
  }
  if (usersCleared > 0) saveWallets();
  return { usersCleared, stacksCleared: buffsCleared };
}

function trackGiveawayWin(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  w.stats.giveaway.won += 1;
  w.stats.giveaway.amountWon += amount;
  w.stats.lifetimeEarnings += amount;
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'giveawayWin');
}

function trackGiveawayCreated(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  w.stats.giveaway.created += 1;
  w.stats.giveaway.amountGiven += amount;
  w.stats.lifetimeLosses += amount;
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'giveawayCreate');
}

function trackDailySpinWin(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.dailySpin) w.stats.dailySpin = { won: 0, amountWon: 0 };
  w.stats.dailySpin.won += 1;
  w.stats.dailySpin.amountWon += amount;
  w.stats.lifetimeEarnings += amount;
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'dailySpin');
}

function trackUniversalIncome(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.universalIncome) w.stats.universalIncome = { totalEarned: 0 };
  w.stats.universalIncome.totalEarned += amount;
  w.stats.lifetimeEarnings += amount;
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'universalIncome');
}

function trackMysteryBoxDuplicateComp(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0 };
  w.stats.mysteryBox.duplicateCompEarned += amount;
  w.stats.lifetimeEarnings += amount;
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'mysteryComp');
}

function getCollectionStats(userId) {
  const w = getWallet(userId);
  const ownedIds = new Set((w.inventory || []).map(item => item.id));
  const rarityOrder = CONFIG.ui.rarityOrder;
  const statBoosts = CONFIG.collectibles.mysteryBox.statBoostPerItem;
  const completionBonuses = CONFIG.collectibles.mysteryBox.collectionCompleteBonus;

  const byRarity = {};
  for (const rarity of rarityOrder) {
    const allOfRarity = COLLECTIBLES.filter(c => c.rarity === rarity);
    const owned = allOfRarity.filter(c => ownedIds.has(c.id));
    byRarity[rarity] = {
      total: allOfRarity.length,
      owned: owned.length,
      complete: allOfRarity.length > 0 && owned.length === allOfRarity.length,
      items: allOfRarity,
    };
  }

  // Calculate total stat boosts
  const totals = { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 };
  for (const rarity of rarityOrder) {
    const info = byRarity[rarity];
    const boosts = statBoosts[rarity] || {};
    totals.interestRate += info.owned * (boosts.interestRate || 0);
    totals.cashbackRate += info.owned * (boosts.cashbackRate || 0);
    totals.minesRevealChance += info.owned * (boosts.minesRevealChance || 0);
    totals.universalDoubleChance += info.owned * (boosts.universalDoubleChance || 0);
    totals.spinWeight += info.owned * (boosts.spinWeight || 0);
    if (info.complete && completionBonuses[rarity]) {
      const cb = completionBonuses[rarity];
      totals.interestRate += cb.interestRate || 0;
      totals.cashbackRate += cb.cashbackRate || 0;
      totals.minesRevealChance += cb.minesRevealChance || 0;
      totals.universalDoubleChance += cb.universalDoubleChance || 0;
      totals.spinWeight += cb.spinWeight || 0;
    }
  }

  const totalOwned = Array.from(ownedIds).filter(id => COLLECTIBLES.some(c => c.id === id)).length;
  const totalItems = COLLECTIBLES.length;

  return { byRarity, totals, totalOwned, totalItems, ownedIds };
}

// Sell all duplicate items (count > 1) at the refund price per extra copy.
// Returns { totalCoins, totalItemsSold, breakdown: [{name, rarity, emoji, sold, refundEach}] }
// Sell all duplicate items (count > 1) at the refund price per extra copy.
// Returns { totalCoins, totalItemsSold, breakdown: [{name, rarity, emoji, sold, refundEach}] }
function sellAllDuplicates(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const COMP_BY_RARITY = CONFIG.collectibles.mysteryBox.duplicateCompensationByRarity;
  let totalCoins = 0;
  let totalItemsSold = 0;
  const breakdown = [];

  for (const item of w.inventory) {
    const count = item.count || 1;
    if (count <= 1) continue;
    const extras = count - 1;
    const refund = COMP_BY_RARITY[item.rarity] || 0;
    const earned = extras * refund;
    totalCoins += earned;
    totalItemsSold += extras;
    item.count = 1;
    breakdown.push({ name: item.name, rarity: item.rarity, emoji: item.emoji, sold: extras, refundEach: refund });
  }

  if (totalCoins > 0) {
    w.balance += totalCoins;
    trackMysteryBoxDuplicateComp(userId, totalCoins);
    saveWallet(userId);
  }

  return { totalCoins, totalItemsSold, breakdown };
}

// Get a summary of duplicates in the user's inventory.  The result has
// { total: <number of extra copies>, byRarity: { rarity: count } } and does
// not modify any state.
function getDuplicateSummary(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const summary = { total: 0, byRarity: {} };
  for (const item of w.inventory) {
    const count = item.count || 1;
    if (count > 1) {
      const extras = count - 1;
      summary.total += extras;
      summary.byRarity[item.rarity] = (summary.byRarity[item.rarity] || 0) + extras;
    }
  }
  return summary;
}

// Count total duplicate items across all inventory slots.
function countDuplicates(userId) {
  const w = getWallet(userId);
  let total = 0;
  for (const item of (w.inventory || [])) {
    const count = item.count || 1;
    if (count > 1) total += count - 1;
  }
  return total;
}

module.exports = {
  getPoolData, savePool,
  addToUniversalPool, addToLossPool, clearHourlyPool, clearDailySpinPool,
  getAllWallets, getWallet, hasWallet, deleteWallet, resetPurse, resetAllPursesAndBanks,
  getBalance, setBalance,
  getInterestRate, getCashbackRate, applyCashback, applyLuckCashback,
  getSpinWeight, getUniversalIncomeDoubleChance, processBank,
  getUserBonuses, getMysteryBoxLuckInfo, getUserPityStatus,
  getCollectionStats,
  applyProfitBoost, tryTriggerMinesReveal,
  getPotionConfig, getActivePotions, getWinChanceModifier, buyLuckyPot, buyUnluckyPot, removeUnluckyPot,
  checkDaily, claimDaily,
  rollMysteryBox, rollPremiumMysteryBox, applyMysteryBoxStats, getDuplicateCompensation, getDuplicateCompensationTable,
  formatNumber, formatNumberShort, parseAmount,
  recordWin, recordLoss, resetStats, clearAllGameStats, resetAllActivePity,
  saveWallets, saveWallet,
  createGiveaway, getGiveaway, getAllGiveaways, joinGiveaway, removeGiveaway,
  setGiveawayMessageRef,
  trackGiveawayWin, trackGiveawayCreated, trackDailySpinWin, trackUniversalIncome,
  trackMysteryBoxDuplicateComp,
  ensureWalletStatsShape,
  trackLifeStatsHeartbeat,
  getRuntimeTuning, updateRuntimeTuning, resetRuntimeTuning, getDefaultRuntimeTuning,
  setRuntimeState, getRuntimeState, removeRuntimeState,
  checkpointWal,
  backupDatabaseToFile,
  getDbFilePaths,
  sellAllDuplicates,
  countDuplicates,
  getDuplicateSummary,
  getXpInfo,
  getXpLeaderboard,
  getXpLeaderboardAll,
  getXpRank,
  getCollectibleLeaderboard,
  getCollectibleRank,
  getXpLeaderboard,
  getPoolSlabStats,
  maybeTrackXpSnapshot,
  maybeTrackCollectibleSnapshot,
};

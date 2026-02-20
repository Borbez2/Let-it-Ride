const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  CONFIG,
  STARTING_COINS, BASE_INVEST_RATE,
  POOL_TAX_RATE, LOSS_POOL_RATE, MYSTERY_BOX_POOLS,
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

// Luck buff constants – tiered single-buff system
const LUCK_ACTIVATION_THRESHOLD = 3;   // minimum streak to activate
const LUCK_TIER1_CAP = 7;              // losses 3-7 give 1% each
const LUCK_TIER1_RATE = 0.01;          // 1% per loss in tier 1
const LUCK_TIER2_CAP = 12;             // losses 8-12 give 2% each
const LUCK_TIER2_RATE = 0.02;          // 2% per loss in tier 2
const LUCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function calculateLuckBoost(streak) {
  if (streak < LUCK_ACTIVATION_THRESHOLD) return 0;
  if (streak <= LUCK_TIER1_CAP) return (streak - LUCK_ACTIVATION_THRESHOLD + 1) * LUCK_TIER1_RATE;
  const tier1Part = (LUCK_TIER1_CAP - LUCK_ACTIVATION_THRESHOLD + 1) * LUCK_TIER1_RATE;
  const tier2Losses = Math.min(streak, LUCK_TIER2_CAP) - LUCK_TIER1_CAP;
  return tier1Part + tier2Losses * LUCK_TIER2_RATE;
}

const LUCK_MAX_BOOST = calculateLuckBoost(LUCK_TIER2_CAP);

// Potion system constants
const LUCKY_POT_DURATION_MS = 60 * 60 * 1000;
const LUCKY_POT_COST = 75000;
const LUCKY_POT_BOOST = 0.05;
const UNLUCKY_POT_DURATION_MS = 60 * 60 * 1000;
const UNLUCKY_POT_COST = 500000;
const UNLUCKY_POT_PENALTY = 0.10;

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
  mysteryBox: { duplicateCompEarned: 0, opened: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 },
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
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0, opened: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 };
  if (w.stats.mysteryBox.duplicateCompEarned === undefined) w.stats.mysteryBox.duplicateCompEarned = 0;
  if (w.stats.mysteryBox.opened === undefined) w.stats.mysteryBox.opened = 0;
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
  if (!Array.isArray(w.stats.topWins)) w.stats.topWins = [];
  if (!Array.isArray(w.stats.topLosses)) w.stats.topLosses = [];
  if (w.stats.lifetimeEarnings === undefined) w.stats.lifetimeEarnings = 0;
  if (w.stats.lifetimeLosses === undefined) w.stats.lifetimeLosses = 0;
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
    cashbackRate: active ? buff.boost : 0,
    maxCashbackRate: LUCK_MAX_BOOST,
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
    cashbackRate: newBoost,
    lossStreak: streak,
  };
}

function evaluateLuckOnWin(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  w.stats.bonuses.luck.lossStreak = 0;
  refreshLuckBuff(w.stats.bonuses.luck, now);
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

    // bucketMs === 0 means raw – keep every point as-is.
    if (bucketMs === 0) {
      result.push(point);
      lastBucketKey = null;
      continue;
    }

    // Compute a unique bucket key (tier + aligned bucket start).
    const bucketStart = Math.floor(point.t / bucketMs) * bucketMs;
    const bucketKey = `${tierIdx}:${bucketStart}`;

    if (bucketKey === lastBucketKey && result.length > 0) {
      // Same bucket – replace with the later (more recent) point.
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

function trackLifeStatsHeartbeat(now = Date.now()) {
  let wroteAny = false;
  for (const wallet of Object.values(wallets)) {
    const wrote = maybeTrackNetWorthSnapshotForWallet(wallet, now, 'heartbeat', {
      minMs: CONFIG.runtime.networthHistory.heartbeatMinWriteMs,
    });
    if (wrote) wroteAny = true;
  }
  if (wroteAny) saveWallets();
  return wroteAny;
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

function addToUniversalPool(amount) {
  const tax = Math.floor(amount * POOL_TAX_RATE);
  if (tax > 0) { poolData.universalPool += tax; savePool(); }
  return tax;
}

function addToLossPool(amount) {
  const tax = Math.floor(amount * LOSS_POOL_RATE);
  if (tax > 0) { poolData.lossPool += tax; savePool(); }
  return tax;
}

// Wallet helpers.
function saveWallets() {
  const upsertAll = db.transaction(() => {
    for (const [userId, w] of Object.entries(wallets)) {
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
    saveWallets();
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

function getBalance(userId) { return normalizeCoins(getWallet(userId).balance, 0); }

function setBalance(userId, amount) {
  const w = getWallet(userId);
  w.balance = normalizeCoins(amount, 0);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), 'balance');
  saveWallets();
}

function getInterestRate(userId) {
  const w = getWallet(userId);
  const bonuses = getInventoryBonuses(w.inventory);
  return BASE_INVEST_RATE + (w.interestLevel * CONFIG.economy.upgrades.interestPerLevel) + bonuses.interestRateBonus;
}

function getCashbackRate(userId) {
  const w = getWallet(userId);
  const bonuses = getInventoryBonuses(w.inventory);
  return (w.cashbackLevel * CONFIG.economy.upgrades.cashbackPerLevel) + bonuses.cashbackRateBonus;
}

function applyCashback(userId, lossAmount) {
  const loss = normalizeCoins(lossAmount, 0);
  if (loss <= 0) return 0;
  const rate = getCashbackRate(userId);
  let totalCashback = 0;
  if (rate > 0) {
    totalCashback += Math.floor(loss * rate);
  }
  // Also apply luck buff cashback
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const luck = w.stats.bonuses.luck;
  refreshLuckBuff(luck);
  const luckBoost = luck.buff.boost || 0;
  if (luckBoost > 0) {
    const luckCb = Math.floor(loss * luckBoost);
    if (luckCb > 0) {
      totalCashback += luckCb;
      luck.totalCashback = (luck.totalCashback || 0) + luckCb;
    }
  }
  if (totalCashback > 0) { w.balance += totalCashback; saveWallets(); }
  return totalCashback;
}

function getSpinWeight(userId) {
  return 1 + (getWallet(userId).spinMultLevel || 0) * 0.1;
}

function getUniversalIncomeDoubleChance(userId) {
  const w = getWallet(userId);
  const level = w.universalIncomeMultLevel || 0;
  const bonuses = getInventoryBonuses(w.inventory);
  const chance = (Math.max(0, Math.min(CONFIG.economy.upgrades.maxLevel, level)) * CONFIG.economy.upgrades.universalIncomePerLevelChance) + bonuses.universalDoubleChanceBonus;
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
  const baseSpinWeight = 1 + (w.spinMultLevel || 0) * 0.1;
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
      cashbackRate: luckState.cashbackRate,
      maxCashbackRate: luckState.maxCashbackRate,
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
  };
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
    cashbackRate: active ? buff.boost : 0,
    maxCashbackRate: LUCK_MAX_BOOST,
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
    // Each stack gives 1%, up to 5 stacks
    const stacks = potions.lucky.stacks ? potions.lucky.stacks.length : 1;
    modifier += Math.min(stacks, 5) * 0.01;
  }
  if (potions.unlucky) modifier -= UNLUCKY_POT_PENALTY;
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
  if (w.stats.potions.lucky.stacks.length >= 5) return { success: false, reason: 'max_stacks' };
  w.balance -= LUCKY_POT_COST;
  w.stats.potions.lucky.stacks.push({ expiresAt: now + LUCKY_POT_DURATION_MS });
  saveWallets();
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
  saveWallets();
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
    saveWallets();
  }
  return triggered;
}

// Process minute-accrued bank interest, paid to bank on hourly boundaries.
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

  const perMinuteRate = getInterestRate(userId) / 24 / 60;
  let pendingFraction = w.stats.interest.pendingFraction || 0;
  let pendingCoins = w.stats.interest.pendingCoins || 0;
  let pendingMinutes = w.stats.interest.pendingMinutes || 0;
  let processedAt = baseLast;
  let totalPayout = 0;

  for (let i = 0; i < elapsedMinutes; i++) {
    const rawInterest = ((w.bank || 0) * perMinuteRate) + pendingFraction;
    const minuteInterest = Math.floor(rawInterest);
    pendingFraction = rawInterest - minuteInterest;
    pendingCoins += minuteInterest;
    pendingMinutes += 1;
    processedAt += minuteMs;

    if (pendingMinutes >= CONFIG.economy.bank.payoutIntervalMinutes) {
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

  saveWallets();
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
  saveWallets();
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
      if (w) {
        w.stats.mysteryBox.opened += 1;
        const highRarity = (RARITY_TIER[rarity] || 1) >= RARITY_TIER[CONFIG.collectibles.mysteryBox.highRarityThreshold];
        if (highRarity) {
          w.stats.mysteryBox.luckyHighRarity += 1;
          w.stats.mysteryBox.pityStreak = 0;
        } else {
          w.stats.mysteryBox.pityStreak += 1;
          if (w.stats.mysteryBox.pityStreak > w.stats.mysteryBox.bestPityStreak) {
            w.stats.mysteryBox.bestPityStreak = w.stats.mysteryBox.pityStreak;
          }
        }
      }
      return { ...item, _rarity: rarity };
    }
  }
  const c = MYSTERY_BOX_POOLS.common.items;
  const item = c[Math.floor(Math.random() * c.length)];
  if (w) {
    w.stats.mysteryBox.opened += 1;
    w.stats.mysteryBox.pityStreak += 1;
    if (w.stats.mysteryBox.pityStreak > w.stats.mysteryBox.bestPityStreak) {
      w.stats.mysteryBox.bestPityStreak = w.stats.mysteryBox.pityStreak;
    }
  }
  return { ...item, _rarity: 'common' };
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
function formatNumber(num) {
  return normalizeCoins(num, 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumberShort(num) {
  num = normalizeCoins(num, 0);
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e4) return (num / 1e3).toFixed(1) + 'K';
  return formatNumber(num);
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
  
  // Parse numeric values with optional k/m/b suffixes.
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!match) return null;
  
  let num = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'k') num *= 1000;
  else if (suffix === 'm') num *= 1000000;
  else if (suffix === 'b') num *= 1000000000;
  
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

function recordWin(userId, gameName, amount) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.stats[gameName]) {
    w.stats[gameName].wins += 1;
  }
  w.stats.lifetimeEarnings += amount;
  insertTopResult(w.stats.topWins, { game: gameName, amount, t: Date.now() });
  evaluateLuckOnWin(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `win:${gameName}`);
  saveWallets();
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
  const luckResult = evaluateLuckOnLoss(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `loss:${gameName}`);
  saveWallets();
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
  saveWallets();
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

module.exports = {
  getPoolData, savePool,
  addToUniversalPool, addToLossPool,
  getAllWallets, getWallet, hasWallet, deleteWallet,
  getBalance, setBalance,
  getInterestRate, getCashbackRate, applyCashback, applyLuckCashback,
  getSpinWeight, getUniversalIncomeDoubleChance, processBank,
  getUserBonuses, getMysteryBoxLuckInfo, getUserPityStatus,
  getCollectionStats,
  applyProfitBoost, tryTriggerMinesReveal,
  getPotionConfig, getActivePotions, getWinChanceModifier, buyLuckyPot, buyUnluckyPot,
  checkDaily, claimDaily,
  rollMysteryBox, getDuplicateCompensation, getDuplicateCompensationTable,
  formatNumber, formatNumberShort, parseAmount,
  recordWin, recordLoss, resetStats, resetAllActivePity,
  saveWallets,
  createGiveaway, getGiveaway, getAllGiveaways, joinGiveaway, removeGiveaway,
  setGiveawayMessageRef,
  trackGiveawayWin, trackGiveawayCreated, trackDailySpinWin, trackUniversalIncome,
  trackMysteryBoxDuplicateComp,
  trackLifeStatsHeartbeat,
  getRuntimeTuning, updateRuntimeTuning, resetRuntimeTuning, getDefaultRuntimeTuning,
  setRuntimeState, getRuntimeState, removeRuntimeState,
  checkpointWal,
  backupDatabaseToFile,
  getDbFilePaths,
};

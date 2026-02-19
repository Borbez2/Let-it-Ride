const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const binomial = require('../utils/binomial');
const {
  STARTING_COINS, BASE_INVEST_RATE,
  POOL_TAX_RATE, LOSS_POOL_RATE, MYSTERY_BOX_POOLS,
} = require('../config');

const GAME_KEYS = ['flip', 'dice', 'roulette', 'blackjack', 'mines', 'letitride', 'duel'];
const RARITY_TIER = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 4,
  epic: 5,
  mythic: 6,
  divine: 7,
};
const DEFAULT_RUNTIME_TUNING = {
  lifeStatsIntervalMs: 10000,
  globalEvScalar: 1,
  binomialPityThreshold: 97,
  binomialPityBoostRate: 0.01,
  binomialPityDurationMinutes: 30,
  binomialPityCooldownMinutes: 15,
};
const PITY_MAX_BOOST_RATE = 0.10;

const COLLECTIBLE_EFFECTS = (() => {
  const map = {};
  for (let i = 1; i <= 120; i++) {
    map[`placeholder_${i}`] = {
      interestRateBonus: 0,
      cashbackRateBonus: 0,
      mysteryBoxLuckBonus: 0,
      minesRevealChance: 0,
      universalDoubleChanceBonus: 0,
      evBoostByGame: {
        flip: 0,
        dice: 0,
        roulette: 0,
        blackjack: 0,
        mines: 0,
        letitride: 0,
        duel: 0,
      },
      label: null,
    };
  }
  return map;
})();

// Set up the SQLite database.
const DB_PATH = path.join(__dirname, 'gambling.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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
    evBoostByGame: {
      flip: 0,
      dice: 0,
      roulette: 0,
      blackjack: 0,
      mines: 0,
      letitride: 0,
      duel: 0,
    },
    effectLines: [],
  };

  if (!Array.isArray(inventory) || inventory.length === 0) return bonuses;

  for (const item of inventory) {
    const effect = COLLECTIBLE_EFFECTS[item.id];
    if (!effect) continue;

    bonuses.interestRateBonus += effect.interestRateBonus || 0;
    bonuses.cashbackRateBonus += effect.cashbackRateBonus || 0;
    bonuses.mysteryBoxLuckBonus += effect.mysteryBoxLuckBonus || 0;
    bonuses.minesRevealChance += effect.minesRevealChance || 0;
    bonuses.universalDoubleChanceBonus += effect.universalDoubleChanceBonus || 0;

    for (const game of GAME_KEYS) {
      bonuses.evBoostByGame[game] += (effect.evBoostByGame && effect.evBoostByGame[game]) || 0;
    }

    if (effect.label) {
      bonuses.effectLines.push(effect.label);
    }
  }

  if (!bonuses.effectLines.length) {
    if (bonuses.interestRateBonus > 0) bonuses.effectLines.push(`Bank interest +${(bonuses.interestRateBonus * 100).toFixed(2)}%/day`);
    if (bonuses.cashbackRateBonus > 0) bonuses.effectLines.push(`Cashback +${(bonuses.cashbackRateBonus * 100).toFixed(2)}%`);
    if (bonuses.mysteryBoxLuckBonus > 0) bonuses.effectLines.push(`Mystery box luck +${(bonuses.mysteryBoxLuckBonus * 100).toFixed(2)}%`);
    if (bonuses.minesRevealChance > 0) bonuses.effectLines.push(`Mines auto-reveal save ${(bonuses.minesRevealChance * 100).toFixed(2)}%`);
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
    };
  }
  if (w.stats.bonuses.minesSaves === undefined) w.stats.bonuses.minesSaves = 0;
  if (w.stats.bonuses.evBoostProfit === undefined) w.stats.bonuses.evBoostProfit = 0;
  if (!w.stats.bonuses.binomialPity) {
    w.stats.bonuses.binomialPity = {
      activeUntil: 0,
      boostRate: 0,
      stacks: [],
      triggers: 0,
      lastTriggeredAt: 0,
      lastDirection: 'neutral',
      lastConfidence: 0,
      lastTotalGames: 0,
    };
  }
  if (w.stats.bonuses.binomialPity.activeUntil === undefined) w.stats.bonuses.binomialPity.activeUntil = 0;
  if (w.stats.bonuses.binomialPity.boostRate === undefined) w.stats.bonuses.binomialPity.boostRate = 0;
  if (!Array.isArray(w.stats.bonuses.binomialPity.stacks)) w.stats.bonuses.binomialPity.stacks = [];
  if (w.stats.bonuses.binomialPity.triggers === undefined) w.stats.bonuses.binomialPity.triggers = 0;
  if (w.stats.bonuses.binomialPity.lastTriggeredAt === undefined) w.stats.bonuses.binomialPity.lastTriggeredAt = 0;
  if (w.stats.bonuses.binomialPity.lastDirection === undefined) w.stats.bonuses.binomialPity.lastDirection = 'neutral';
  if (w.stats.bonuses.binomialPity.lastConfidence === undefined) w.stats.bonuses.binomialPity.lastConfidence = 0;
  if (w.stats.bonuses.binomialPity.lastTotalGames === undefined) w.stats.bonuses.binomialPity.lastTotalGames = 0;
  if (!Array.isArray(w.stats.netWorthHistory)) w.stats.netWorthHistory = [];
  if (w.stats.lifetimeEarnings === undefined) w.stats.lifetimeEarnings = 0;
  if (w.stats.lifetimeLosses === undefined) w.stats.lifetimeLosses = 0;
}

function getCombinedGameWinStats(stats) {
  let wins = 0;
  let total = 0;
  for (const game of GAME_KEYS) {
    const gs = stats[game] || { wins: 0, losses: 0 };
    wins += gs.wins || 0;
    total += (gs.wins || 0) + (gs.losses || 0);
  }
  return { wins, total };
}

function refreshBinomialPityStacks(pity, now = Date.now()) {
  const stacks = Array.isArray(pity.stacks) ? pity.stacks : [];
  const activeStacks = stacks.filter((stack) => {
    const rate = normalizeNumeric(stack.rate, 0);
    const expiresAt = normalizeNumeric(stack.expiresAt, 0);
    return rate > 0 && expiresAt > now;
  }).map((stack) => ({
    rate: normalizeNumeric(stack.rate, 0),
    expiresAt: normalizeNumeric(stack.expiresAt, 0),
    reason: typeof stack.reason === 'string' ? stack.reason : 'threshold',
  }));

  let runningRate = 0;
  const cappedStacks = [];
  for (const stack of activeStacks) {
    if (runningRate >= PITY_MAX_BOOST_RATE) break;
    const remainingCap = PITY_MAX_BOOST_RATE - runningRate;
    if (stack.rate > remainingCap) continue;
    cappedStacks.push(stack);
    runningRate += stack.rate;
  }

  pity.stacks = cappedStacks;
  pity.boostRate = cappedStacks.reduce((sum, stack) => sum + stack.rate, 0);
  pity.activeUntil = cappedStacks.reduce((max, stack) => Math.max(max, stack.expiresAt), 0);
}

function getBinomialPityBoostState(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  const pity = w.stats.bonuses.binomialPity;
  refreshBinomialPityStacks(pity, now);
  const active = pity.activeUntil > now && pity.boostRate > 0;
  return {
    active,
    boostRate: active ? pity.boostRate : 0,
    activeUntil: pity.activeUntil || 0,
    expiresInMs: active ? (pity.activeUntil - now) : 0,
    triggers: pity.triggers || 0,
    lastTriggeredAt: pity.lastTriggeredAt || 0,
    lastDirection: pity.lastDirection || 'neutral',
    lastConfidence: pity.lastConfidence || 0,
    lastTotalGames: pity.lastTotalGames || 0,
    activeStacks: (pity.stacks || []).length,
  };
}

function evaluateBinomialPity(w, now = Date.now()) {
  ensureWalletStatsShape(w);
  const tuning = getRuntimeTuning();
  const pity = w.stats.bonuses.binomialPity;
  const previousDirection = pity.lastDirection || 'neutral';
  const previousConfidence = normalizeNumeric(pity.lastConfidence, 0);
  const { wins, total } = getCombinedGameWinStats(w.stats);
  const assessment = binomial.getLuckAssessment(wins, total, 0.5);
  if (!assessment) {
    getBinomialPityBoostState(w, now);
    return { triggered: false };
  }

  pity.lastDirection = assessment.direction;
  pity.lastConfidence = assessment.confidence;
  pity.lastTotalGames = total;
  refreshBinomialPityStacks(pity, now);

  if (assessment.direction !== 'unlucky') {
    return { triggered: false };
  }

  const thresholdFloor = Math.max(50, Math.min(99, normalizeNumeric(tuning.binomialPityThreshold, 97)));
  const thresholds = [60, 70, 80, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99].filter((value) => value >= thresholdFloor);
  const prior = previousDirection === 'unlucky' ? previousConfidence : 0;
  const crossedThresholds = thresholds.filter((threshold) => prior < threshold && assessment.confidence >= threshold);

  const perTriggerRate = Math.max(0, tuning.binomialPityBoostRate || 0.01);
  const durationMs = Math.max(1, tuning.binomialPityDurationMinutes) * 60 * 1000;
  const availableHeadroom = Math.max(0, PITY_MAX_BOOST_RATE - (pity.boostRate || 0));
  const maxTriggersByCap = perTriggerRate > 0 ? Math.floor((availableHeadroom + 1e-12) / perTriggerRate) : 0;
  const triggerCount = Math.min(crossedThresholds.length, maxTriggersByCap);
  if (triggerCount <= 0 || perTriggerRate <= 0) {
    return { triggered: false };
  }

  const appliedThresholds = crossedThresholds.slice(0, triggerCount);
  for (const threshold of appliedThresholds) {
    pity.stacks.push({
      rate: perTriggerRate,
      expiresAt: now + durationMs,
      reason: `threshold:${threshold}`,
    });
  }
  refreshBinomialPityStacks(pity, now);
  pity.lastTriggeredAt = now;
  pity.triggers = (pity.triggers || 0) + triggerCount;

  return {
    triggered: true,
    addedStacks: triggerCount,
    addedBoostRate: perTriggerRate * triggerCount,
    totalBoostRate: pity.boostRate,
    activeUntil: pity.activeUntil,
    confidence: assessment.confidence,
    totalGames: total,
    crossedThresholds: appliedThresholds,
    highBonusTriggered: false,
  };
}

function maybeTrackNetWorthSnapshotForWallet(w, now = Date.now(), reason = 'auto', options = {}) {
  ensureWalletStatsShape(w);
  const history = w.stats.netWorthHistory;
  const total = normalizeCoins((w.balance || 0) + (w.bank || 0), 0);
  const last = history.length ? history[history.length - 1] : null;
  const minMs = Number.isFinite(options.minMs) ? Math.max(0, options.minMs) : (15 * 60 * 1000);
  const minDelta = 1000;
  const force = !!options.force;
  const shouldWrite = force || !last || (now - last.t >= minMs) || Math.abs(total - last.v) >= minDelta;
  if (!shouldWrite) return false;
  history.push({ t: now, v: total, r: reason });
  if (history.length > 240) {
    history.splice(0, history.length - 240);
  }
  return true;
}

function trackLifeStatsHeartbeat(now = Date.now()) {
  let wroteAny = false;
  for (const wallet of Object.values(wallets)) {
    const wrote = maybeTrackNetWorthSnapshotForWallet(wallet, now, 'heartbeat', { minMs: 10 * 1000 });
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
  const intervalMs = Math.max(10000, Math.min(600000, Math.trunc(normalizeNumeric(merged.lifeStatsIntervalMs, DEFAULT_RUNTIME_TUNING.lifeStatsIntervalMs))));
  const globalEvScalar = Math.max(0, Math.min(5, normalizeNumeric(merged.globalEvScalar, DEFAULT_RUNTIME_TUNING.globalEvScalar)));
  const threshold = Math.max(50, Math.min(99.999, normalizeNumeric(merged.binomialPityThreshold, DEFAULT_RUNTIME_TUNING.binomialPityThreshold)));
  const boostRate = Math.max(0, Math.min(0.5, normalizeNumeric(merged.binomialPityBoostRate, DEFAULT_RUNTIME_TUNING.binomialPityBoostRate)));
  const durationMinutes = Math.max(1, Math.min(1440, normalizeNumeric(merged.binomialPityDurationMinutes, DEFAULT_RUNTIME_TUNING.binomialPityDurationMinutes)));
  const cooldownMinutes = Math.max(0, Math.min(1440, normalizeNumeric(merged.binomialPityCooldownMinutes, DEFAULT_RUNTIME_TUNING.binomialPityCooldownMinutes)));
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
  return BASE_INVEST_RATE + (w.interestLevel * 0.01) + bonuses.interestRateBonus;
}

function getCashbackRate(userId) {
  const w = getWallet(userId);
  const bonuses = getInventoryBonuses(w.inventory);
  return (w.cashbackLevel * 0.001) + bonuses.cashbackRateBonus;
}

function applyCashback(userId, lossAmount) {
  const loss = normalizeCoins(lossAmount, 0);
  if (loss <= 0) return 0;
  const rate = getCashbackRate(userId);
  if (rate <= 0) return 0;
  const cashback = Math.floor(loss * rate);
  if (cashback > 0) { getWallet(userId).balance += cashback; saveWallets(); }
  return cashback;
}

function getSpinWeight(userId) {
  return 1 + (getWallet(userId).spinMultLevel || 0);
}

function getUniversalIncomeDoubleChance(userId) {
  const w = getWallet(userId);
  const level = w.universalIncomeMultLevel || 0;
  const bonuses = getInventoryBonuses(w.inventory);
  const chance = (Math.max(0, Math.min(10, level)) * 0.01) + bonuses.universalDoubleChanceBonus;
  return Math.max(0, Math.min(0.75, chance));
}

function getMysteryBoxLuckInfo(userId) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const inventoryBonuses = getInventoryBonuses(w.inventory);
  const pityStreak = Math.max(0, w.stats.mysteryBox.pityStreak || 0);
  const pityLuckBonus = Math.min(0.5, pityStreak * 0.02);
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
  const luck = getMysteryBoxLuckInfo(userId);
  const pity = getBinomialPityBoostState(w);
  const evBoostByGame = { ...invBonuses.evBoostByGame };
  if (pity.boostRate > 0) {
    for (const game of GAME_KEYS) {
      evBoostByGame[game] += pity.boostRate;
    }
  }
  return {
    interestRate: getInterestRate(userId),
    cashbackRate: getCashbackRate(userId),
    spinWeight: getSpinWeight(userId),
    universalIncomeDoubleChance: getUniversalIncomeDoubleChance(userId),
    mysteryBoxLuck: luck.totalLuck,
    pityStreak: luck.pityStreak,
    pityLuckBonus: luck.pityLuckBonus,
    inventoryLuckBonus: luck.inventoryLuckBonus,
    minesRevealChance: invBonuses.minesRevealChance,
    evBoostByGame,
    inventoryEffects: invBonuses.effectLines,
    binomialPity: {
      active: pity.active,
      boostRate: pity.boostRate,
      activeUntil: pity.activeUntil,
      expiresInMs: pity.expiresInMs,
      triggers: pity.triggers,
      thresholdConfidence: tuning.binomialPityThreshold,
      thresholdStep: 1,
      lastDirection: pity.lastDirection,
      lastConfidence: pity.lastConfidence,
      lastTotalGames: pity.lastTotalGames,
      activeStacks: pity.activeStacks,
      highBonusCooldownMinutes: tuning.binomialPityCooldownMinutes,
    },
    runtimeTuning: tuning,
  };
}

function getUserPityStatus(userId, now = Date.now()) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const pity = w.stats.bonuses.binomialPity;
  refreshBinomialPityStacks(pity, now);

  const stacks = (pity.stacks || [])
    .map((stack, idx) => {
      const rate = normalizeNumeric(stack.rate, 0);
      const expiresAt = normalizeNumeric(stack.expiresAt, 0);
      const reason = typeof stack.reason === 'string' ? stack.reason : 'threshold';
      let threshold = null;
      if (reason.startsWith('threshold:')) {
        const parsed = Number(reason.slice('threshold:'.length));
        if (Number.isFinite(parsed)) threshold = parsed;
      }
      return {
        id: idx + 1,
        rate,
        threshold,
        reason,
        expiresAt,
        remainingMs: Math.max(0, expiresAt - now),
      };
    })
    .sort((a, b) => {
      if ((a.threshold || 0) !== (b.threshold || 0)) return (a.threshold || 0) - (b.threshold || 0);
      return a.expiresAt - b.expiresAt;
    });

  const totalBoostRate = stacks.reduce((sum, s) => sum + s.rate, 0);
  return {
    active: totalBoostRate > 0,
    totalBoostRate,
    activeUntil: pity.activeUntil || 0,
    triggers: pity.triggers || 0,
    lastDirection: pity.lastDirection || 'neutral',
    lastConfidence: pity.lastConfidence || 0,
    lastTotalGames: pity.lastTotalGames || 0,
    stacks,
  };
}

function applyProfitBoost(userId, gameName, baseProfit) {
  const profit = normalizeCoins(baseProfit, 0);
  if (profit <= 0) return profit;
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  const tuning = getRuntimeTuning();
  const bonuses = getInventoryBonuses(w.inventory);
  const pity = getBinomialPityBoostState(w);
  const boost = ((bonuses.evBoostByGame[gameName] || 0) + (pity.boostRate || 0)) * (tuning.globalEvScalar || 1);
  if (boost <= 0) return profit;
  const boosted = Math.floor(profit * (1 + boost));
  const extra = boosted - profit;
  if (extra > 0) {
    w.stats.bonuses.evBoostProfit += extra;
  }
  return boosted;
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
function processBank(userId) {
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
  const minuteMs = 60 * 1000;
  const baseLast = w.stats.interest.lastAccrualAt || w.lastBankPayout || now;
  const elapsedMinutes = Math.floor((now - baseLast) / minuteMs);
  if (elapsedMinutes < 1) return 0;

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

    if (pendingMinutes >= 60) {
      if (pendingCoins > 0) {
        w.bank += pendingCoins;
        totalPayout += pendingCoins;
      }
      pendingCoins = 0;
      pendingMinutes = 0;
      w.lastBankPayout = processedAt;
    }
  }

  w.stats.interest.pendingFraction = pendingFraction;
  w.stats.interest.pendingCoins = pendingCoins;
  w.stats.interest.pendingMinutes = pendingMinutes;
  w.stats.interest.lastAccrualAt = processedAt;

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
  const dayMs = 86400000;
  if (now - last < dayMs) {
    const rem = (last + dayMs) - now;
    return {
      canClaim: false,
      hours: Math.floor(rem / 3600000),
      mins: Math.floor((rem % 3600000) / 60000),
      streak: w.streak || 0,
    };
  }
  return { canClaim: true, streakBroken: (now - last) > 172800000, streak: w.streak || 0 };
}

function claimDaily(userId) {
  const { DAILY_BASE, DAILY_STREAK_BONUS } = require('../config');
  const w = getWallet(userId);
  const now = Date.now(), last = w.lastDaily || 0;
  if ((now - last) > 172800000 && last !== 0) w.streak = 1;
  else w.streak = (w.streak || 0) + 1;
  const reward = DAILY_BASE + (DAILY_STREAK_BONUS * (w.streak - 1));
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
    if (luck > 0) {
      if (rarity === 'common') mult = Math.max(0.25, 1 - (luck * 0.6));
      if (rarity === 'uncommon') mult = Math.max(0.35, 1 - (luck * 0.35));
      if (rarity === 'rare') mult = 1 + (luck * 0.8);
      if (rarity === 'legendary') mult = 1 + (luck * 1.4);
      if (rarity === 'epic') mult = 1 + (luck * 1.8);
      if (rarity === 'mythic') mult = 1 + (luck * 2.6);
      if (rarity === 'divine') mult = 1 + (luck * 3.2);
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
        const highRarity = (RARITY_TIER[rarity] || 1) >= RARITY_TIER.legendary;
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
  const COMP_BY_RARITY = {
    common: 2000,
    uncommon: 3500,
    rare: 6000,
    epic: 12000,
    legendary: 20000,
    mythic: 60000,
    divine: 150000,
  };
  return COMP_BY_RARITY[rarity] || 0;
}

function getDuplicateCompensationTable() {
  return {
    common: 2000,
    uncommon: 3500,
    rare: 6000,
    epic: 12000,
    legendary: 20000,
    mythic: 60000,
    divine: 150000,
  };
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
function recordWin(userId, gameName, amount) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.stats[gameName]) {
    w.stats[gameName].wins += 1;
  }
  w.stats.lifetimeEarnings += amount;
  const pityResult = evaluateBinomialPity(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `win:${gameName}`);
  saveWallets();
  return pityResult;
}

function recordLoss(userId, gameName, amount) {
  const w = getWallet(userId);
  ensureWalletStatsShape(w);
  if (w.stats[gameName]) {
    w.stats[gameName].losses += 1;
  }
  w.stats.lifetimeLosses += amount;
  const pityResult = evaluateBinomialPity(w);
  maybeTrackNetWorthSnapshotForWallet(w, Date.now(), `loss:${gameName}`);
  saveWallets();
  return pityResult;
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
  let stacksCleared = 0;
  for (const wallet of Object.values(wallets)) {
    ensureWalletStatsShape(wallet);
    const pity = wallet.stats.bonuses.binomialPity;
    const activeStacks = Array.isArray(pity.stacks) ? pity.stacks.length : 0;
    const hadActive = activeStacks > 0 || (pity.boostRate || 0) > 0 || (pity.activeUntil || 0) > Date.now();
    if (!hadActive) continue;

    usersCleared += 1;
    stacksCleared += activeStacks;
    pity.stacks = [];
    pity.boostRate = 0;
    pity.activeUntil = 0;
  }
  if (usersCleared > 0) saveWallets();
  return { usersCleared, stacksCleared };
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

module.exports = {
  getPoolData, savePool,
  addToUniversalPool, addToLossPool,
  getAllWallets, getWallet, hasWallet, deleteWallet,
  getBalance, setBalance,
  getInterestRate, getCashbackRate, applyCashback,
  getSpinWeight, getUniversalIncomeDoubleChance, processBank,
  getUserBonuses, getMysteryBoxLuckInfo, getUserPityStatus,
  applyProfitBoost, tryTriggerMinesReveal,
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
};

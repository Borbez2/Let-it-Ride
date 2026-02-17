const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  STARTING_COINS, BASE_INVEST_RATE,
  POOL_TAX_RATE, LOSS_POOL_RATE, MYSTERY_BOX_POOLS,
} = require('../config');

// ─── Database Setup ───
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

  INSERT OR IGNORE INTO pool (id, last_hourly_payout) VALUES (1, ${Date.now()});
`);

// ─── Default Stats Template ───
const DEFAULT_STATS = () => ({
  flip: { wins: 0, losses: 0 },
  dice: { wins: 0, losses: 0 },
  roulette: { wins: 0, losses: 0 },
  blackjack: { wins: 0, losses: 0 },
  mines: { wins: 0, losses: 0 },
  letitride: { wins: 0, losses: 0 },
  duel: { wins: 0, losses: 0 },
  giveaway: { created: 0, amountGiven: 0, won: 0, amountWon: 0 },
  mysteryBox: { duplicateCompEarned: 0 },
  dailySpin: { won: 0, amountWon: 0 },
  interest: { totalEarned: 0 },
  universalIncome: { totalEarned: 0 },
  lifetimeEarnings: 0,
  lifetimeLosses: 0,
});

// ─── Prepared Statements ───
const stmts = {
  getAllWallets: db.prepare('SELECT * FROM wallets'),
  upsertWallet: db.prepare(`
    INSERT OR REPLACE INTO wallets
    (user_id, balance, last_daily, streak, bank, last_bank_payout,
     interest_level, cashback_level, spin_mult_level, inventory, stats)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteWallet: db.prepare('DELETE FROM wallets WHERE user_id = ?'),
  getPool: db.prepare('SELECT * FROM pool WHERE id = 1'),
  updatePool: db.prepare(`
    UPDATE pool SET universal_pool = ?, loss_pool = ?, last_hourly_payout = ?, last_daily_spin = ?
    WHERE id = 1
  `),
};

// ─── Row → wallet object (matches old JSON shape) ───
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
    inventory,
    stats,
  };
}

// ─── Migrate from JSON (one-time, on first run) ───
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
          // Ensure all game types exist
          for (const g of ['flip','dice','roulette','blackjack','mines','letitride','duel']) {
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

// ─── Load into memory ───
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

// Migrate any missing fields on existing wallets
for (const id in wallets) {
  const w = wallets[id];
  if (!w.inventory) w.inventory = [];
  if (w.spinMultLevel === undefined) w.spinMultLevel = 0;
  if (w.lastBankPayout === undefined) w.lastBankPayout = Date.now();
  if (!w.stats) w.stats = DEFAULT_STATS();
  for (const g of ['flip','dice','roulette','blackjack','mines','letitride','duel']) {
    if (!w.stats[g]) w.stats[g] = { wins: 0, losses: 0 };
  }
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0 };
  if (!w.stats.dailySpin) w.stats.dailySpin = { won: 0, amountWon: 0 };
  if (!w.stats.interest) w.stats.interest = { totalEarned: 0 };
  if (!w.stats.universalIncome) w.stats.universalIncome = { totalEarned: 0 };
  if (w.stats.lifetimeEarnings === undefined) w.stats.lifetimeEarnings = 0;
  if (w.stats.lifetimeLosses === undefined) w.stats.lifetimeLosses = 0;
}
saveWallets();
console.log('Wallets loaded from SQLite. Fields migrated.');

// ─── Pool ───
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

// ─── Wallets ───
function saveWallets() {
  const upsertAll = db.transaction(() => {
    for (const [userId, w] of Object.entries(wallets)) {
      stmts.upsertWallet.run(
        userId,
        w.balance, w.lastDaily || 0, w.streak || 0,
        w.bank || 0, w.lastBankPayout || 0,
        w.interestLevel || 0, w.cashbackLevel || 0, w.spinMultLevel || 0,
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
      interestLevel: 0, cashbackLevel: 0, spinMultLevel: 0,
      inventory: [],
      stats: DEFAULT_STATS(),
    };
    saveWallets();
  }
  const w = wallets[userId];
  if (w.bank === undefined) w.bank = 0;
  if (w.lastBankPayout === undefined) w.lastBankPayout = Date.now();
  if (w.interestLevel === undefined) w.interestLevel = 0;
  if (w.cashbackLevel === undefined) w.cashbackLevel = 0;
  if (w.spinMultLevel === undefined) w.spinMultLevel = 0;
  if (!w.inventory) w.inventory = [];
  if (!w.stats) w.stats = DEFAULT_STATS();
  for (const g of ['flip','dice','roulette','blackjack','mines','letitride','duel']) {
    if (!w.stats[g]) w.stats[g] = { wins: 0, losses: 0 };
  }
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0 };
  if (!w.stats.dailySpin) w.stats.dailySpin = { won: 0, amountWon: 0 };
  if (!w.stats.interest) w.stats.interest = { totalEarned: 0 };
  if (!w.stats.universalIncome) w.stats.universalIncome = { totalEarned: 0 };
  if (w.stats.lifetimeEarnings === undefined) w.stats.lifetimeEarnings = 0;
  if (w.stats.lifetimeLosses === undefined) w.stats.lifetimeLosses = 0;
  return w;
}

function deleteWallet(userId) {
  delete wallets[userId];
  stmts.deleteWallet.run(userId);
}

function getBalance(userId) { return getWallet(userId).balance; }

function setBalance(userId, amount) {
  getWallet(userId).balance = Math.floor(amount);
  saveWallets();
}

function getInterestRate(userId) {
  return BASE_INVEST_RATE + (getWallet(userId).interestLevel * 0.01);
}

function getCashbackRate(userId) {
  return getWallet(userId).cashbackLevel * 0.001;
}

function applyCashback(userId, lossAmount) {
  const rate = getCashbackRate(userId);
  if (rate <= 0) return 0;
  const cashback = Math.floor(lossAmount * rate);
  if (cashback > 0) { getWallet(userId).balance += cashback; saveWallets(); }
  return cashback;
}

function getSpinWeight(userId) {
  return 1 + (getWallet(userId).spinMultLevel || 0);
}

// ─── Bank interest (hourly proportional) ───
function processBank(userId) {
  const w = getWallet(userId);
  if (!w.bank || w.bank <= 0) return 0;

  const now = Date.now();
  const last = w.lastBankPayout || now;
  const hourMs = 60 * 60 * 1000;
  const hoursPassed = Math.floor((now - last) / hourMs);

  if (hoursPassed >= 1) {
    const hourlyRate = getInterestRate(userId) / 24;
    let current = w.bank;
    for (let i = 0; i < hoursPassed; i++) {
      current += Math.floor(current * hourlyRate);
    }
    const totalPayout = current - w.bank;
    w.bank = current;
    w.lastBankPayout = last + (hoursPassed * hourMs);
    if (totalPayout > 0) {
      if (!w.stats.interest) w.stats.interest = { totalEarned: 0 };
      w.stats.interest.totalEarned += totalPayout;
      w.stats.lifetimeEarnings += totalPayout;
    }
    saveWallets();
    return totalPayout;
  }
  return 0;
}

// ─── Daily ───
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
  saveWallets();
  return { newBalance: w.balance, streak: w.streak, reward };
}

// ─── Mystery box ───
function rollMysteryBox() {
  const totalW = Object.values(MYSTERY_BOX_POOLS).reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * totalW;
  for (const [rarity, pool] of Object.entries(MYSTERY_BOX_POOLS)) {
    roll -= pool.weight;
    if (roll <= 0) {
      const it = pool.items;
      const item = it[Math.floor(Math.random() * it.length)];
      return { ...item, _rarity: rarity };
    }
  }
  const c = MYSTERY_BOX_POOLS.common.items;
  const item = c[Math.floor(Math.random() * c.length)];
  return { ...item, _rarity: 'common' };
}

// Calculate compensation for duplicate placeholders
function getDuplicateCompensation(itemId, rarity) {
  const COMP_BY_RARITY = {
    common: 2500,
    uncommon: 5000,
    rare: 12500,
    legendary: 35000,
    epic: 75000,
    mythic: 150000,
    divine: 500000,
  };
  return COMP_BY_RARITY[rarity] || 0;
}

function getDuplicateCompensationTable() {
  return {
    common: 2500,
    uncommon: 5000,
    rare: 12500,
    legendary: 35000,
    epic: 75000,
    mythic: 150000,
    divine: 500000,
  };
}

// ─── Formatting ───
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumberShort(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e4) return (num / 1e3).toFixed(1) + 'K';
  return formatNumber(num);
}

// ─── Parse abbreviated amounts ───
function parseAmount(str, maxValue = null) {
  if (!str) return null;
  const trimmed = str.toLowerCase().trim();
  
  // Handle "all"
  if (trimmed === 'all') {
    return maxValue !== null ? maxValue : null;
  }
  
  // Parse number with abbreviations (1k, 1m, 1b)
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!match) return null;
  
  let num = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'k') num *= 1000;
  else if (suffix === 'm') num *= 1000000;
  else if (suffix === 'b') num *= 1000000000;
  
  num = Math.floor(num);
  if (maxValue !== null && num > maxValue) num = maxValue;
  
  return num > 0 ? num : null;
}

// ─── Giveaways ───
let activeGiveaways = {};
let giveawayCounter = 0;

function createGiveaway(initiatorId, amount, durationMs, channelId = null) {
  const id = `giveaway_${++giveawayCounter}`;
  const giveaway = {
    id, initiatorId, amount,
    channelId,
    participants: [],
    expiresAt: Date.now() + durationMs,
    createdAt: Date.now(),
  };
  activeGiveaways[id] = giveaway;
  return giveaway;
}

function getGiveaway(id) { return activeGiveaways[id] || null; }

function getAllGiveaways() { return Object.values(activeGiveaways); }

function joinGiveaway(giveawayId, userId) {
  const g = activeGiveaways[giveawayId];
  if (!g || g.participants.includes(userId)) return false;
  g.participants.push(userId);
  return true;
}

function removeGiveaway(id) { delete activeGiveaways[id]; }

// ─── Stats tracking ───
function recordWin(userId, gameName, amount) {
  const w = getWallet(userId);
  if (w.stats[gameName]) {
    w.stats[gameName].wins += 1;
  }
  w.stats.lifetimeEarnings += amount;
  saveWallets();
}

function recordLoss(userId, gameName, amount) {
  const w = getWallet(userId);
  if (w.stats[gameName]) {
    w.stats[gameName].losses += 1;
  }
  w.stats.lifetimeLosses += amount;
  saveWallets();
}

// ─── Extended Stats Tracking ───
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

function trackGiveawayWin(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  w.stats.giveaway.won += 1;
  w.stats.giveaway.amountWon += amount;
  w.stats.lifetimeEarnings += amount;
}

function trackGiveawayCreated(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.giveaway) w.stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  w.stats.giveaway.created += 1;
  w.stats.giveaway.amountGiven += amount;
  w.stats.lifetimeLosses += amount;
}

function trackDailySpinWin(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.dailySpin) w.stats.dailySpin = { won: 0, amountWon: 0 };
  w.stats.dailySpin.won += 1;
  w.stats.dailySpin.amountWon += amount;
  w.stats.lifetimeEarnings += amount;
}

function trackUniversalIncome(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.universalIncome) w.stats.universalIncome = { totalEarned: 0 };
  w.stats.universalIncome.totalEarned += amount;
  w.stats.lifetimeEarnings += amount;
}

function trackMysteryBoxDuplicateComp(userId, amount) {
  const w = getWallet(userId);
  if (!w.stats.mysteryBox) w.stats.mysteryBox = { duplicateCompEarned: 0 };
  w.stats.mysteryBox.duplicateCompEarned += amount;
  w.stats.lifetimeEarnings += amount;
}

module.exports = {
  getPoolData, savePool,
  addToUniversalPool, addToLossPool,
  getAllWallets, getWallet, hasWallet, deleteWallet,
  getBalance, setBalance,
  getInterestRate, getCashbackRate, applyCashback,
  getSpinWeight, processBank,
  checkDaily, claimDaily,
  rollMysteryBox, getDuplicateCompensation, getDuplicateCompensationTable,
  formatNumber, formatNumberShort, parseAmount,
  recordWin, recordLoss, resetStats,
  saveWallets,
  createGiveaway, getGiveaway, getAllGiveaways, joinGiveaway, removeGiveaway,
  trackGiveawayWin, trackGiveawayCreated, trackDailySpinWin, trackUniversalIncome,
  trackMysteryBoxDuplicateComp,
};

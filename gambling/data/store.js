const fs = require('fs');
const {
  STARTING_COINS, BASE_INVEST_RATE,
  POOL_TAX_RATE, LOSS_POOL_RATE, MYSTERY_BOX_POOLS,
} = require('../config');

const DATA_FILE = './wallets.json';
const POOL_FILE = './pool.json';

// ─── Pool ───
function loadPool() {
  try {
    if (fs.existsSync(POOL_FILE))
      return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return { universalPool: 0, lossPool: 0, lastHourlyPayout: Date.now(), lastDailySpin: 0 };
}

let poolData = loadPool();

function savePool() {
  fs.writeFileSync(POOL_FILE, JSON.stringify(poolData, null, 2));
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
function loadWallets() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}

let wallets = loadWallets();

// Migrate any missing fields on existing wallets
for (const id in wallets) {
  const w = wallets[id];
  if (!w.inventory) w.inventory = [];
  if (w.spinMultLevel === undefined) w.spinMultLevel = 0;
  if (w.lastBankPayout === undefined) w.lastBankPayout = Date.now();
}
saveWallets();
console.log('Wallets loaded (no reset). New fields migrated.');

function saveWallets() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
}

function getAllWallets() { return wallets; }

function getWallet(userId) {
  if (!wallets[userId]) {
    wallets[userId] = {
      balance: STARTING_COINS, lastDaily: 0, streak: 0,
      bank: 0, lastBankPayout: Date.now(),
      interestLevel: 0, cashbackLevel: 0, spinMultLevel: 0,
      inventory: [],
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
  return w;
}

function deleteWallet(userId) {
  delete wallets[userId];
  saveWallets();
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
  const { MYSTERY_BOX_COST, MYSTERY_BOX_POOLS } = require('../config');
  const pool = MYSTERY_BOX_POOLS[rarity];
  
  if (!pool || !pool.weight) return 0;
  
  // Weight is proportional to drop chance
  const totalWeight = Object.values(MYSTERY_BOX_POOLS).reduce((s, p) => s + p.weight, 0);
  const dropChance = pool.weight / totalWeight;
  
  // Return 50% of mystery box cost, scaled by drop chance
  return Math.floor((MYSTERY_BOX_COST * 0.5) * dropChance);
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

module.exports = {
  getPoolData, savePool,
  addToUniversalPool, addToLossPool,
  getAllWallets, getWallet, deleteWallet,
  getBalance, setBalance,
  getInterestRate, getCashbackRate, applyCashback,
  getSpinWeight, processBank,
  checkDaily, claimDaily,
  rollMysteryBox, getDuplicateCompensation,
  formatNumber, formatNumberShort, parseAmount,
  saveWallets,
};

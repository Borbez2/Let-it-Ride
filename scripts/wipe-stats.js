#!/usr/bin/env node
/**
 * One-time script to:
 * 1. Wipe all graph data (netWorthHistory, xpHistory, collectibleHistory)
 * 2. Clear game stats (W/L, earnings, losses, top bets)
 * 3. Backfill XP from historical total games played (from backup)
 *
 * Run with bot STOPPED: sudo systemctl stop lets-go-gambling && node scripts/wipe-stats.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const { CONFIG } = require('../config');

const DB_PATH = path.join(__dirname, '..', 'data', 'gambling.db');
const BACKUP_PATH = path.join(__dirname, '..', 'backups', 'hourly', '2026-02-24', '22-14-34', 'gambling.db');

const XP_PER_GAME = CONFIG.xp.perGame; // 25
const GAME_KEYS = CONFIG.stats.games;   // ['flip','roulette','blackjack','mines','letitride','duel']

// Load historical game counts from backup
const backupDb = new Database(BACKUP_PATH, { readonly: true });
const historicalGames = {};
const backupRows = backupDb.prepare('SELECT user_id, stats FROM wallets').all();
for (const row of backupRows) {
  const stats = JSON.parse(row.stats);
  let total = 0;
  for (const g of GAME_KEYS) {
    const s = stats[g] || {};
    total += (s.wins || 0) + (s.losses || 0);
  }
  historicalGames[row.user_id] = total;
}
backupDb.close();
console.log('Loaded historical game counts from backup:', Object.entries(historicalGames).map(([id, g]) => `${id.slice(-6)}:${g}`).join(', '));

// Now operate on the live DB
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const rows = db.prepare('SELECT user_id, balance, bank, stats, inventory FROM wallets').all();
const now = Date.now();
let count = 0;

const update = db.prepare('UPDATE wallets SET stats = ? WHERE user_id = ?');
const updateAll = db.transaction(() => {
  for (const row of rows) {
    const stats = JSON.parse(row.stats);
    const currentBalance = (row.balance || 0) + (row.bank || 0);
    const inventory = JSON.parse(row.inventory || '[]');
    const uniqueCollectibles = new Set(inventory.map(i => i.id)).size;

    // Backfill XP from historical game count
    const historicalTotal = historicalGames[row.user_id] || 0;
    // Add any games played since the backup (from current stats)
    let currentGames = 0;
    for (const g of GAME_KEYS) {
      const s = stats[g] || {};
      currentGames += (s.wins || 0) + (s.losses || 0);
    }
    const totalGames = historicalTotal + currentGames;
    const totalXp = totalGames * XP_PER_GAME;

    // Reset per-game stats
    for (const g of GAME_KEYS) {
      stats[g] = { wins: 0, losses: 0 };
    }

    // Reset lifetime tracking
    stats.lifetimeEarnings = currentBalance;
    stats.lifetimeLosses = 0;
    stats.topWins = [];
    stats.topLosses = [];

    // Wipe all graph histories — seed with two points (15 min apart) so charts render
    const fifteenMinAgo = now - 15 * 60 * 1000;
    stats.netWorthHistory = [
      { t: fifteenMinAgo, v: currentBalance, r: 'reset' },
      { t: now, v: currentBalance, r: 'reset' }
    ];
    stats.xpHistory = [
      { t: fifteenMinAgo, v: totalXp, r: 'reset' },
      { t: now, v: totalXp, r: 'reset' }
    ];
    stats.collectibleHistory = [
      { t: fifteenMinAgo, v: uniqueCollectibles, r: 'reset' },
      { t: now, v: uniqueCollectibles, r: 'reset' }
    ];

    // Reset tracking counters
    stats.giveaway = { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
    stats.mysteryBox = { duplicateCompEarned: 0, opened: 0, spent: 0, luckyHighRarity: 0, pityStreak: 0, bestPityStreak: 0 };
    stats.dailySpin = { won: 0, amountWon: 0 };
    if (stats.interest) stats.interest.totalEarned = 0;
    stats.universalIncome = { totalEarned: 0 };
    if (stats.bonuses) {
      stats.bonuses.minesSaves = 0;
      stats.bonuses.evBoostProfit = 0;
    }

    // Set XP and totalGamesPlayed from historical data
    stats.xp = totalXp;
    stats.totalGamesPlayed = totalGames;

    update.run(JSON.stringify(stats), row.user_id);
    console.log(`  ${row.user_id.slice(-6)}: ${totalGames} games → ${totalXp} XP, nwH reset, balance=${currentBalance}`);
    count++;
  }
});

updateAll();
db.close();
console.log(`\nDone. Wiped stats & backfilled XP for ${count} wallet(s).`);
process.exit(0);

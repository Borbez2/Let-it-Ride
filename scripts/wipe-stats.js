#!/usr/bin/env node
/**
 * One-time script to wipe player statistics and experience.
 *
 * By default the script will also attempt to backfill XP from a historical
 * backup so that players don’t lose credit for games they already played.
 * Supply `--zero-xp` to instead clear everyone's XP/games to zero.
 *
 * Usage examples (bot must be stopped first):
 *
 *   # backfill mode (you may need to edit BACKUP_PATH below):
 *   node scripts/wipe-stats.js
 *
 *   # or specify a different backup file path:
 *   node scripts/wipe-stats.js --backup /path/to/old/gambling.db
 *
 *   # clear XP entirely, no backup needed:
 *   node scripts/wipe-stats.js --zero-xp
 *
 * The script will reset W/L counts, clear graph histories, and either
 * backfill XP or zero it depending on options.
 */
const Database = require('better-sqlite3');
const path = require('path');
const { CONFIG } = require('../config');

const DB_PATH = path.join(__dirname, '..', 'data', 'gambling.db');
// default backup path, can be overridden by --backup flag
let BACKUP_PATH = path.join(__dirname, '..', 'backups', 'hourly', '2026-02-24', '22-14-34', 'gambling.db');

const XP_PER_GAME = CONFIG.xp.perGame; // 25
const GAME_KEYS = CONFIG.stats.games;   // ['flip','roulette','blackjack','mines','letitride','duel']

// parse command-line options
let zeroXp = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--zero-xp') {
    zeroXp = true;
  } else if (a === '--backup' && argv[i+1]) {
    BACKUP_PATH = argv[++i];
  } else if (a === '--help' || a === '-h') {
    console.log('Usage: node scripts/wipe-stats.js [--zero-xp] [--backup <path>]');
    process.exit(0);
  }
}

let historicalGames = {};
if (!zeroXp) {
  // Load historical game counts from backup
  if (!BACKUP_PATH || !require('fs').existsSync(BACKUP_PATH)) {
    console.error('Backup file not found:', BACKUP_PATH);
    process.exit(1);
  }
  const backupDb = new Database(BACKUP_PATH, { readonly: true });
  historicalGames = {};
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
} else {
  console.log('Zero-XP mode: no backup used, all xp/games will be cleared.');
}

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

    let totalGames, totalXp;
    if (zeroXp) {
      totalGames = 0;
      totalXp = 0;
    } else {
      // Backfill XP from historical game count
      const historicalTotal = historicalGames[row.user_id] || 0;
      // Add any games played since the backup (from current stats)
      let currentGames = 0;
      for (const g of GAME_KEYS) {
        const s = stats[g] || {};
        currentGames += (s.wins || 0) + (s.losses || 0);
      }
      totalGames = historicalTotal + currentGames;
      totalXp = totalGames * XP_PER_GAME;
    }

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
const modeMsg = zeroXp ? 'zeroed XP' : 'backfilled XP from backup';
console.log(`\nDone. Wiped stats & ${modeMsg} for ${count} wallet(s).`);
process.exit(0);

// utility for targeted restoration from a backup snapshot
// usage: node scripts/restore-stats.js /absolute/path/to/backups/hourly/2026-02-24/23-00-00/gambling.db

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { CONFIG } = require('../config');

if (process.argv.length < 3) {
  console.error('Usage: node scripts/restore-stats.js <backup-db-path>');
  process.exit(1);
}

// allow an optional --dry-run flag before the path
const args = process.argv.slice(2);
let dryRun = false;
let backupPath;
if (args[0] === '--dry-run') {
  dryRun = true;
  backupPath = args[1];
} else {
  backupPath = args[0];
}

if (!backupPath) {
  console.error('Usage: node scripts/restore-stats.js [--dry-run] <backup-db-path>');
  process.exit(1);
}

if (!fs.existsSync(backupPath)) {
  console.error('Backup file not found:', backupPath);
  process.exit(1);
}

const liveDbPath = path.join(__dirname, '..', 'data', 'gambling.db');

console.log('Opening live database:', liveDbPath);
const liveDb = new Database(liveDbPath);

console.log('Opening backup database:', backupPath);
const backupDb = new Database(backupPath);

// games that keep win/loss stats in the wallet.stats object
const GAME_KEYS = ['flip','dice','roulette','blackjack','mines','letitride','duel'];

const perGameXp = (CONFIG && CONFIG.xp && CONFIG.xp.perGame) || 0;

function parseStats(statsText) {
  try {
    return JSON.parse(statsText || '{}');
  } catch (err) {
    return {};
  }
}

const selectBackup = backupDb.prepare('SELECT user_id, stats FROM wallets');
// prepared statement to fetch a single wallet by id
const selectLive = liveDb.prepare('SELECT user_id, stats FROM wallets WHERE user_id = ?');
const updateLive = liveDb.prepare('UPDATE wallets SET stats = ? WHERE user_id = ?');

console.log('Beginning restoration...');

const now = Date.now();
let count = 0;
for (const row of selectBackup.iterate()) {
  const { user_id, stats: statsText } = row;
  const bstats = parseStats(statsText);
  if (!bstats) continue;

  // build patch object containing only the pieces we want to transfer
  const patch = {};

  // copy xp and totalGamesPlayed
  if (bstats.xp !== undefined) patch.xp = bstats.xp;
  if (bstats.totalGamesPlayed !== undefined) patch.totalGamesPlayed = bstats.totalGamesPlayed;

  // win/loss for each game
  for (const g of GAME_KEYS) {
    if (bstats[g] && (bstats[g].wins !== undefined || bstats[g].losses !== undefined)) {
      patch[g] = {
        wins: bstats[g].wins || 0,
        losses: bstats[g].losses || 0,
      };
    }
  }

  // fix xp if mismatched with count
  if (patch.xp !== undefined && patch.totalGamesPlayed !== undefined) {
    const expected = patch.totalGamesPlayed * perGameXp;
    if (patch.xp !== expected) {
      console.warn(`xp mismatch for ${user_id}: ${patch.xp} != ${expected} (games ${patch.totalGamesPlayed}), correcting`);
      patch.xp = expected;
    }
  }

  if (Object.keys(patch).length === 0) continue;

  const liveRow = selectLive.get(user_id);
  if (!liveRow) continue; // skip users not present in live DB
  const lstats = parseStats(liveRow.stats);

  // merge patch into live stats
  for (const key of Object.keys(patch)) {
    lstats[key] = patch[key];
  }

  if (dryRun) {
    console.log(`[dry-run] would update ${user_id} with`, JSON.stringify(patch));
  } else {
    updateLive.run(JSON.stringify(lstats), user_id);
  }
  count++;
}

console.log(`Restored stats for ${count} wallet(s).`);
console.log('Done.');

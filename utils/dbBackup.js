const fs = require('fs');
const path = require('path');

const store = require('../data/store');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RETAIN_HOURLY_DAYS = 7;
const RETAIN_DAILY_DAYS = 30;

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKUP_ROOT = path.join(ROOT_DIR, 'backups');
const HOURLY_ROOT = path.join(BACKUP_ROOT, 'hourly');
const LEGACY_BACKUP_ROOT = path.join(BACKUP_ROOT, 'legacy');
const LEGACY_FLAT_BACKUPS_DIR = path.join(LEGACY_BACKUP_ROOT, 'flat-backup-files');
const LEGACY_DATA_PRERESTORE_DIR = path.join(LEGACY_BACKUP_ROOT, 'data-pre-restore');

function pad(num) {
  return String(num).padStart(2, '0');
}

function formatDateParts(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return {
    dayKey: `${year}-${month}-${day}`,
    timeKey: `${hour}-${minute}-${second}`,
  };
}

function ensureBackupFolders() {
  fs.mkdirSync(HOURLY_ROOT, { recursive: true });
  fs.mkdirSync(LEGACY_FLAT_BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(LEGACY_DATA_PRERESTORE_DIR, { recursive: true });
}

function moveFileSafe(sourcePath, targetDir) {
  if (!fs.existsSync(sourcePath)) return null;
  fs.mkdirSync(targetDir, { recursive: true });

  const base = path.basename(sourcePath);
  let targetPath = path.join(targetDir, base);
  if (fs.existsSync(targetPath)) {
    targetPath = path.join(targetDir, `${base}.${Date.now()}`);
  }

  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

function organizeLegacyFiles(logger = console) {
  ensureBackupFolders();

  const moved = [];

  if (fs.existsSync(BACKUP_ROOT)) {
    for (const name of fs.readdirSync(BACKUP_ROOT)) {
      const fullPath = path.join(BACKUP_ROOT, name);
      if (!fs.statSync(fullPath).isFile()) continue;
      if (!/^gambling-\d{8}-\d{6}\.db$/i.test(name)) continue;

      const movedTo = moveFileSafe(fullPath, LEGACY_FLAT_BACKUPS_DIR);
      if (movedTo) moved.push({ from: fullPath, to: movedTo });
    }
  }

  const dataDir = path.dirname(store.getDbFilePaths().db);
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (!name.includes('.pre-restore')) continue;
      const fullPath = path.join(dataDir, name);
      if (!fs.statSync(fullPath).isFile()) continue;

      const movedTo = moveFileSafe(fullPath, LEGACY_DATA_PRERESTORE_DIR);
      if (movedTo) moved.push({ from: fullPath, to: movedTo });
    }
  }

  if (moved.length > 0) {
    logger.log(`Backup organizer moved ${moved.length} legacy file(s).`);
  }

  return moved;
}

function parseSnapshotTimestamp(dayFolder, timeFolder, metadata) {
  if (metadata && metadata.createdAt && Number.isFinite(metadata.createdAt)) {
    return metadata.createdAt;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayFolder);
  const timeMatch = /^(\d{2})-(\d{2})-(\d{2})$/.exec(timeFolder);
  if (!match || !timeMatch) return null;

  const [_, year, month, day] = match;
  const [__, hour, minute, second] = timeMatch;
  const d = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function listSnapshots() {
  if (!fs.existsSync(HOURLY_ROOT)) return [];

  const snapshots = [];
  const dayFolders = fs.readdirSync(HOURLY_ROOT);

  for (const dayFolder of dayFolders) {
    const dayPath = path.join(HOURLY_ROOT, dayFolder);
    if (!fs.statSync(dayPath).isDirectory()) continue;

    for (const timeFolder of fs.readdirSync(dayPath)) {
      const snapshotPath = path.join(dayPath, timeFolder);
      if (!fs.statSync(snapshotPath).isDirectory()) continue;

      const metadataPath = path.join(snapshotPath, 'meta.json');
      let metadata = null;
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch {
          metadata = null;
        }
      }

      const timestamp = parseSnapshotTimestamp(dayFolder, timeFolder, metadata);
      if (!timestamp) continue;

      snapshots.push({
        path: snapshotPath,
        dayFolder,
        timeFolder,
        timestamp,
      });
    }
  }

  return snapshots.sort((a, b) => a.timestamp - b.timestamp);
}

function buildRetentionKeepSet(snapshots, nowTs) {
  const keep = new Set();
  const dailyCandidates = new Map();
  const monthlyCandidates = new Map();

  for (const snap of snapshots) {
    const ageMs = nowTs - snap.timestamp;
    if (ageMs < RETAIN_HOURLY_DAYS * DAY_MS) {
      keep.add(snap.path);
      continue;
    }

    const d = new Date(snap.timestamp);
    if (ageMs < RETAIN_DAILY_DAYS * DAY_MS) {
      const dayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const current = dailyCandidates.get(dayKey);
      if (!current || snap.timestamp > current.timestamp) {
        dailyCandidates.set(dayKey, snap);
      }
      continue;
    }

    const monthKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const currentMonth = monthlyCandidates.get(monthKey);
    if (!currentMonth || snap.timestamp > currentMonth.timestamp) {
      monthlyCandidates.set(monthKey, snap);
    }
  }

  for (const snap of dailyCandidates.values()) keep.add(snap.path);
  for (const snap of monthlyCandidates.values()) keep.add(snap.path);

  return keep;
}

function cleanupEmptyBackupFolders() {
  if (!fs.existsSync(HOURLY_ROOT)) return;

  for (const dayFolder of fs.readdirSync(HOURLY_ROOT)) {
    const dayPath = path.join(HOURLY_ROOT, dayFolder);
    if (!fs.statSync(dayPath).isDirectory()) continue;

    const remaining = fs.readdirSync(dayPath);
    if (remaining.length === 0) {
      fs.rmSync(dayPath, { recursive: true, force: true });
    }
  }
}

function applyRetentionPolicy(logger = console) {
  const snapshots = listSnapshots();
  if (snapshots.length === 0) return { deleted: 0, kept: 0, total: 0 };

  const keepSet = buildRetentionKeepSet(snapshots, Date.now());
  let deleted = 0;

  for (const snap of snapshots) {
    if (keepSet.has(snap.path)) continue;
    fs.rmSync(snap.path, { recursive: true, force: true });
    deleted += 1;
  }

  cleanupEmptyBackupFolders();

  const result = { deleted, kept: keepSet.size, total: snapshots.length };
  if (deleted > 0) {
    logger.log(`Backup retention deleted ${deleted} snapshot(s), kept ${keepSet.size}.`);
  }
  return result;
}

function copyIfExists(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) return false;
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

async function createDatabaseBackup({ reason = 'manual', logger = console } = {}) {
  ensureBackupFolders();

  const createdAt = Date.now();
  const now = new Date(createdAt);
  const { dayKey, timeKey } = formatDateParts(now);
  const targetDir = path.join(HOURLY_ROOT, dayKey, timeKey);

  fs.mkdirSync(targetDir, { recursive: true });

  const dbPaths = store.getDbFilePaths();

  store.checkpointWal('PASSIVE');

  const tmpMain = path.join(targetDir, 'gambling.db.tmp');
  const mainDest = path.join(targetDir, 'gambling.db');

  await store.backupDatabaseToFile(tmpMain);
  fs.renameSync(tmpMain, mainDest);

  const walCopied = copyIfExists(dbPaths.wal, path.join(targetDir, 'gambling.db-wal'));
  const shmCopied = copyIfExists(dbPaths.shm, path.join(targetDir, 'gambling.db-shm'));

  const metadata = {
    createdAt,
    createdAtIso: now.toISOString(),
    reason,
    files: {
      db: true,
      wal: walCopied,
      shm: shmCopied,
    },
  };

  fs.writeFileSync(path.join(targetDir, 'meta.json'), JSON.stringify(metadata, null, 2));

  const retention = applyRetentionPolicy(logger);
  logger.log(`Database backup created at ${targetDir}`);

  return {
    targetDir,
    createdAt,
    retention,
    files: metadata.files,
  };
}

function msUntilNextHour(now = Date.now()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return Math.max(1000, d.getTime() - now);
}

function startHourlyBackupScheduler({ logger = console, runOnStartup = true } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  function logError(prefix, err) {
    logger.error(prefix, err?.message || err);
  }

  async function runBackup(reason) {
    if (running || stopped) return;
    running = true;
    try {
      await createDatabaseBackup({ reason, logger });
    } catch (err) {
      logError('Database backup failed:', err);
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    if (stopped) return;
    const delay = msUntilNextHour();
    timer = setTimeout(async () => {
      await runBackup('hourly');
      scheduleNext();
    }, delay);
  }

  organizeLegacyFiles(logger);

  if (runOnStartup) {
    runBackup('startup').catch((err) => logError('Startup backup failed:', err));
  }

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = {
  BACKUP_ROOT,
  createDatabaseBackup,
  applyRetentionPolicy,
  organizeLegacyFiles,
  startHourlyBackupScheduler,
};

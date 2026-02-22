# Automated Database Backups

This folder is managed automatically by the bot.

## Layout

- `hourly/YYYY-MM-DD/HH-mm-ss/`
  - `gambling.db`
  - `gambling.db-wal` (if present at backup time)
  - `gambling.db-shm` (if present at backup time)
  - `meta.json`
- `legacy/flat-backup-files/`  - old loose backup files moved from the root of `backups/`
- `legacy/data-pre-restore/`  - old `data/*.pre-restore*` files moved out of `data/`

## Retention

- Keep **all hourly backups** for the most recent **7 days**.
- For backups older than 7 days and newer than 30 days, keep only the **latest backup of each day**.
- For backups older than 30 days, keep only the **latest backup of each month** (kept indefinitely).

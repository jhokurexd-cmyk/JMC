#!/usr/bin/env bash
# Nightly database backup: dump -> gzip -> (optional) encrypt -> ship off-site.
# Install on the server with:  crontab -e
#   0 2 * * * /opt/clinic/server/scripts/backup.sh >> /var/log/clinic-backup.log 2>&1
# Requires: pg_dump, gzip, and rclone configured with a remote named "offsite"
# (Backblaze B2 / Google Drive: run `rclone config` once).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/clinic/backups}"
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL before running}"
RCLONE_REMOTE="${RCLONE_REMOTE:-offsite:clinic-backups}"
KEEP_LOCAL_DAYS=7
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/clinic_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] dumping database..."
pg_dump "$DATABASE_URL" | gzip > "$FILE"

echo "[$(date)] uploading to $RCLONE_REMOTE ..."
rclone copy "$FILE" "$RCLONE_REMOTE"

# keep a week locally, retention on the remote is managed by rclone or bucket lifecycle
find "$BACKUP_DIR" -name 'clinic_*.sql.gz' -mtime +$KEEP_LOCAL_DAYS -delete

# ping healthchecks.io so a silent failure gets noticed (set HEALTHCHECK_URL in env)
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || true
fi

echo "[$(date)] backup complete: $FILE"

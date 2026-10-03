#!/usr/bin/env bash
# Restore the database from a backup made by backup.sh.
#   ./scripts/restore.sh /path/to/clinic_2026-09-06_0200.sql.gz
#
# This DROPS and recreates the target database. DATABASE_URL must point at the
# database to overwrite (load it from server/.env first, e.g.
#   set -a; source .env; set +a; ./scripts/restore.sh <file>
# ).
set -euo pipefail

FILE="${1:?Usage: restore.sh <clinic_YYYY-MM-DD_HHMM.sql.gz>}"
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL (the database to restore INTO)}"

[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
echo "[$(date)] verifying archive..."
gzip -t "$FILE"

# pull the db name out of the URL for the drop/create
DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
ADMIN_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/${DB_NAME}([?].*)?\$#/postgres#")"

echo
echo "  This will DROP database '${DB_NAME}' and reload it from:"
echo "    $FILE"
echo
read -r -p "  Type the database name to confirm: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "Aborted." >&2; exit 1; }

echo "[$(date)] recreating '${DB_NAME}'..."
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\";"

echo "[$(date)] loading dump..."
gunzip -c "$FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --quiet

echo "[$(date)] restore complete."

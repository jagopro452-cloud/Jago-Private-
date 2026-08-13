#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/jago_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] creating $FILE"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$FILE"

echo "[backup] pruning files older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -type f -name "jago_*.dump" -mtime +"$RETENTION_DAYS" -delete

echo "[backup] done"

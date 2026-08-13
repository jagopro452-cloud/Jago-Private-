#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
PSQL="psql -h localhost -U jago -d jago -v ON_ERROR_STOP=0"

$PSQL <<SQL
CREATE INDEX IF NOT EXISTS idx_ledger_entries_trip_id ON ledger_entries(trip_id);
SQL

for dir in /home/ubuntu/jago-app/migrations /home/ubuntu/jago-app/server/migrations; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    echo "INSERT INTO migrations (name, applied_at) VALUES ('$base', NOW()) ON CONFLICT (name) DO NOTHING;" | $PSQL
  done
done

pm2 restart jago-server
sleep 35
curl -sS http://127.0.0.1:5000/api/health || true
echo
tail -8 /home/ubuntu/.pm2/logs/jago-server-out.log
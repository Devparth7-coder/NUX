#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Start NEXUS: brings up the local PostgreSQL cluster if it is not already
# running, then serves the built application on 0.0.0.0:$PORT.
#
#   bash scripts/start.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PGDATA="${PGDATA:-$HOME/.pgdata}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-nexus}"
PGDB="${PGDB:-nexus}"
PORT="${PORT:-3000}"
PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"

if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then
  echo "▸ Starting PostgreSQL from $PGDATA"
  if [ ! -d "$PGDATA" ]; then
    echo "  No cluster found — run scripts/bootstrap.sh first."
    exit 1
  fi
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
    -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" start
fi

if [ ! -d .next ]; then
  echo "▸ No build found — building"
  npm run build
fi

echo "▸ NEXUS ready on http://0.0.0.0:$PORT"
exec env NODE_OPTIONS="--max-old-space-size=1200" npx next start -H 0.0.0.0 -p "$PORT"

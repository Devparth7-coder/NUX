#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NEXUS bootstrap — one command from a clean Debian/Ubuntu machine to a running,
# seeded, indexed workspace.
#
#   bash scripts/bootstrap.sh
#
# Steps: install PostgreSQL 17 + pgvector → initialise a persistent cluster in
# ~/.pgdata → create the `nexus` database → install dependencies → push the
# Prisma schema → ingest the seed corpus → build → start on 0.0.0.0:3000.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PGDATA="${PGDATA:-$HOME/.pgdata}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-nexus}"
PGDB="${PGDB:-nexus}"
PORT="${PORT:-3000}"

say() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }

say "Installing PostgreSQL 17 + pgvector"
if ! command -v initdb > /dev/null; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-17 postgresql-17-pgvector
fi
PGBIN="$(dirname "$(sudo find /usr/lib/postgresql -name initdb | head -1)")"
echo "  postgres binaries: $PGBIN"

if [ ! -d "$PGDATA" ]; then
  say "Initialising a persistent cluster at $PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U "$PGUSER" --auth=trust --encoding=UTF8 > /tmp/nexus-initdb.log
fi

if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q; then
  say "Starting PostgreSQL on 127.0.0.1:$PGPORT"
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
    -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" start
fi

say "Creating database $PGDB with the vector extension"
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname='$PGDB'" | grep -q 1 \
  || "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDB;"
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "CREATE EXTENSION IF NOT EXISTS vector;"

say "Installing dependencies"
npm install

say "Configuring environment"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://$PGUSER@127.0.0.1:$PGPORT/$PGDB?schema=public\"#" .env
fi

say "Pushing the Prisma schema and generating the client"
npx prisma db push
npx prisma generate

say "Seeding the workspace (this ingests and embeds real documents)"
npx tsx prisma/seed.ts

say "Building for production"
npm run build

say "Starting NEXUS on 0.0.0.0:$PORT"
echo "  Sign in at http://localhost:$PORT with demo@nexus.ai / nexus-demo-2026"
NODE_OPTIONS="--max-old-space-size=1200" npx next start -H 0.0.0.0 -p "$PORT"

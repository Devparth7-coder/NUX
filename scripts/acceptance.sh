#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NEXUS acceptance scenario (spec §48) driven entirely over HTTP.
#
#   bash scripts/acceptance.sh [base-url]
#
# This exercises the same routes the browser uses: sign in → command → intent →
# context → plan → orchestration → approval → execution → validation → memory.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok()  { printf "  ✓ %s\n" "$1"; }

say "1 · Sign in to the seeded workspace"
curl -s -c "$JAR" -X POST "$BASE/api/auth/demo" -H 'content-type: application/json' > /dev/null
ok "session created"

say "2 · Send the command: \"Prepare my NEXUS launch for this week.\""
RESP=$(curl -s -b "$JAR" -X POST "$BASE/api/intents" -H 'content-type: application/json' \
  -d '{"input":"Prepare my NEXUS launch for this week."}')
INTENT=$(echo "$RESP" | python3 scripts/report.py intent_id)
echo "$RESP" | python3 scripts/report.py started

say "3 · Wait for the approval gate"
for _ in $(seq 1 60); do
  STATUS=$(curl -s -b "$JAR" "$BASE/api/intents/$INTENT" | python3 scripts/report.py status)
  case "$STATUS" in WAITING_APPROVAL|COMPLETED|PARTIAL|FAILED) break ;; esac
  sleep 1
done
echo "  run status: $STATUS"

say "4 · Approvals raised by the orchestrator"
curl -s -b "$JAR" "$BASE/api/intents/$INTENT" | python3 scripts/report.py approvals

say "5 · Approve and resume"
curl -s -b "$JAR" -X POST "$BASE/api/intents/$INTENT/approve" -H 'content-type: application/json' \
  | python3 scripts/report.py approved

say "6 · Wait for completion"
for _ in $(seq 1 90); do
  STATUS=$(curl -s -b "$JAR" "$BASE/api/intents/$INTENT" | python3 scripts/report.py status)
  case "$STATUS" in COMPLETED|PARTIAL|FAILED) break ;; esac
  sleep 1
done
echo "  run status: $STATUS"

say "7 · Final result"
curl -s -b "$JAR" "$BASE/api/intents/$INTENT" | python3 scripts/report.py result

say "8 · Project state after the run"
curl -s -b "$JAR" "$BASE/api/projects?pageSize=5" | python3 scripts/report.py projects

say "9 · Timeline (last 12 execution events)"
curl -s -b "$JAR" "$BASE/api/agent-runs/$(echo "$RESP" | python3 scripts/report.py run_id)" \
  | python3 scripts/report.py timeline

say "Acceptance scenario complete"

#!/usr/bin/env bash
#
# Criterion A3, scripted: a posted update survives a full service restart.
#
# Run it ON the host, as the ordinary `bench` user (it needs `systemctl` and the
# database file):
#
#   ssh bench-target
#   set -a; . /etc/pulseboard/pulseboard.env; set +a   # TEAM_CODE, never in git
#   bash /srv/pulseboard/current/deploy/restart-check.sh
#
# Do NOT run the whole script under `sudo`: sudo strips the environment, so
# TEAM_CODE would arrive empty and the script would stop at step 1. It calls
# `sudo systemctl restart` for the one command that actually needs root, and
# nothing else.
#
# What it does: join over the public HTTPS origin, post an update through
# `POST /api/updates`, restart `pulseboard`, wait for `/healthz`, then read the
# row back and compare it character for character.
#
# Why it reads the database rather than the page: Stage 3 has no read endpoint
# yet — `GET /api/board` is Stage 4 — so the browser cannot show a row it did
# not just post. The durable store is what A3 is about, and this is the honest
# way to ask it before the board exists. From Stage 4 on, prefer the browser
# check in docs/ui-smoke/stage-4.md; this script stays as the scripted form.
#
# It prints PASS or FAIL and exits non-zero on failure. It writes exactly one
# Member row and one Update row, both harmless.

set -euo pipefail

BASE_URL="${BASE_URL:-https://bench-target.taile0ffc4.ts.net}"
APP_ROOT="${APP_ROOT:-/srv/pulseboard/current}"
DATABASE_FILE="${DATABASE_FILE:-/srv/pulseboard/data/pulseboard.db}"
SERVICE="${SERVICE:-pulseboard}"
DISPLAY_NAME="${DISPLAY_NAME:-Restart Check}"

if [ -z "${TEAM_CODE:-}" ]; then
  echo "FAIL: TEAM_CODE is not set. Source it from /etc/pulseboard/pulseboard.env;" >&2
  echo "      it is a secret and must never be written into this repository." >&2
  exit 2
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

MARKER="restart check $(date -u +%Y-%m-%dT%H:%M:%SZ)"

json_string() {
  # Escapes a shell value into a JSON string body without needing jq.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

echo "1/5  joining $BASE_URL as \"$DISPLAY_NAME\""
join_status="$(
  curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
    -X POST "$BASE_URL/api/session" \
    -H 'Content-Type: application/json' \
    -d "{\"teamCode\":\"$(json_string "$TEAM_CODE")\",\"displayName\":\"$(json_string "$DISPLAY_NAME")\"}"
)"
if [ "$join_status" != "201" ]; then
  echo "FAIL: join answered $join_status, expected 201 (wrong TEAM_CODE?)." >&2
  exit 1
fi

echo "2/5  posting an update"
post_body="$(
  curl -sS -b "$COOKIE_JAR" \
    -X POST "$BASE_URL/api/updates" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"$(json_string "$MARKER")\",\"mood\":\"focused\"}"
)"
update_id="$(printf '%s' "$post_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
if [ -z "$update_id" ]; then
  echo "FAIL: no update id in the response: $post_body" >&2
  exit 1
fi
echo "     posted $update_id"

echo "3/5  restarting $SERVICE"
# The only command in this script that needs root. Everything else runs as the
# ordinary user, so a stray secret in the environment is never exported to root.
sudo systemctl restart "$SERVICE"

echo "4/5  waiting for /healthz"
ready=""
for _ in $(seq 1 30); do
  if curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    ready="yes"
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "FAIL: the service did not come back within 30s." >&2
  exit 1
fi

echo "5/5  reading the row back out of $DATABASE_FILE"
stored="$(
  cd "$APP_ROOT" && DATABASE_URL="file:$DATABASE_FILE" node -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.update
      .findUnique({ where: { id: process.argv[1] } })
      .then((row) => {
        console.log(row === null ? "" : row.text);
        return prisma.$disconnect();
      })
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  ' "$update_id"
)"

if [ "$stored" != "$MARKER" ]; then
  echo "FAIL: the update did not survive the restart." >&2
  echo "      expected: $MARKER" >&2
  echo "      found:    ${stored:-<no row>}" >&2
  exit 1
fi

echo
echo "PASS: A3 — update $update_id survived a restart of $SERVICE, text intact."

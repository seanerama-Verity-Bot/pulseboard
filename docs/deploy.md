# Deploying Pulseboard to `bench-target`

The one and only deploy target (ADR 0004): a self-hosted Ubuntu 24.04 VPS reached as
`ssh bench-target`, published over public HTTPS by Tailscale Funnel at
<https://bench-target.taile0ffc4.ts.net/>.

Every command below is meant to be pasted verbatim. Nothing here contains a secret; the
only secret-bearing file is `/etc/pulseboard/pulseboard.env`, which is created **on the
host** and is never committed.

| Thing | Value |
| --- | --- |
| Host | `bench-target.taile0ffc4.ts.net` (user `bench`, passwordless sudo) |
| Listen address | `127.0.0.1:3001` — loopback only; the funnel is the sole public path in |
| Public URL | `https://bench-target.taile0ffc4.ts.net/` |
| App root | `/srv/pulseboard/current` (rsync target) |
| Database | `/srv/pulseboard/data/pulseboard.db` — **outside** the release directory |
| Env file | `/etc/pulseboard/pulseboard.env`, mode `0640`, owner `bench` |
| Unit | `pulseboard.service` (source of truth: [`deploy/pulseboard.service`](../deploy/pulseboard.service)) |

---

## 1. One-time host preparation

```bash
ssh bench-target

# Directories. The data directory is deliberately a sibling of the release
# directory, never inside it, so a deploy can never overwrite the database.
sudo mkdir -p /srv/pulseboard/current /srv/pulseboard/data
sudo chown -R bench:bench /srv/pulseboard

# Environment file. Fill in real values; keep it out of git forever.
sudo mkdir -p /etc/pulseboard
sudo tee /etc/pulseboard/pulseboard.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3001
DATABASE_URL=file:/srv/pulseboard/data/pulseboard.db
TEAM_CODE=<the shared team code>
SESSION_SECRET=<paste the output of: openssl rand -hex 32>
APP_TIMEZONE=UTC
EOF
sudo chown bench:bench /etc/pulseboard/pulseboard.env
sudo chmod 0640 /etc/pulseboard/pulseboard.env
```

`SESSION_SECRET` must be at least 32 characters and has **no fallback** — the process
exits non-zero at boot without it (ADR 0005). Same for a missing `TEAM_CODE` or an
invalid `APP_TIMEZONE`.

## 2. Install the systemd unit

```bash
# From a checkout of this repo on your workstation:
scp deploy/pulseboard.service bench-target:/tmp/pulseboard.service

ssh bench-target
sudo install -m 0644 -o root -g root /tmp/pulseboard.service \
  /etc/systemd/system/pulseboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now pulseboard
sudo systemctl status pulseboard --no-pager
```

If `node` is not on the service's `PATH`, replace `/usr/bin/env node` in the unit's
`ExecStart` with the absolute path from `which node`.

## 3. Publish over HTTPS

```bash
ssh bench-target
sudo tailscale funnel --bg 3001
tailscale funnel status          # expect: https://bench-target.taile0ffc4.ts.net/ -> 127.0.0.1:3001
```

## 4. Deploy a release

Build locally (or download the CI artifact), then sync the build output and the
production dependencies. `npm ci --omit=dev` cannot run on the host without the source
tree, so we ship `node_modules` with the release.

```bash
# --- on your workstation, from the repo root ---
npm ci
npx prisma generate --schema apps/server/prisma/schema.prisma
npm run build

rsync -az --delete \
  --include='package.json' --include='package-lock.json' \
  --include='node_modules/***' \
  --include='apps/***' --include='packages/***' \
  --exclude='*' \
  ./ bench-target:/srv/pulseboard/current/

# --- on the host ---
ssh bench-target
cd /srv/pulseboard/current

# NEVER `migrate dev`, NEVER `db push` on the host.
DATABASE_URL=file:/srv/pulseboard/data/pulseboard.db \
  npx prisma migrate deploy --schema apps/server/prisma/schema.prisma

sudo systemctl restart pulseboard

# Readiness poll — this is the same endpoint the deploy script waits on.
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3001/healthz && break
  sleep 1
done
```

## 5. Verify (this is the smoke, not a formality)

```bash
# Public HTTPS, from anywhere:
curl -i https://bench-target.taile0ffc4.ts.net/healthz
# expect: HTTP/2 200 and {"status":"ok","version":"..."}

curl -s -o /dev/null -w '%{http_code}\n' https://bench-target.taile0ffc4.ts.net/
# expect: 200

# The rule that must never regress: unmatched /api is JSON, never index.html.
curl -s https://bench-target.taile0ffc4.ts.net/api/nope
# expect: {"error":{"code":"NOT_FOUND","message":"That endpoint does not exist."}}
```

Then rehearse criterion A3:

```bash
ssh bench-target sudo systemctl restart pulseboard
sleep 3
curl -fsS https://bench-target.taile0ffc4.ts.net/healthz
```

The manual browser checklist lives at [`docs/ui-smoke/stage-1.md`](ui-smoke/stage-1.md).

## Rollback

```bash
ssh bench-target
sudo systemctl stop pulseboard
# re-rsync the previous release into /srv/pulseboard/current, then:
sudo systemctl start pulseboard
```

The database is untouched by either direction because it lives in
`/srv/pulseboard/data/`. Migrations are forward-only: a rollback that needs a schema
change needs a new migration, not a reverted one.

## Logs

```bash
journalctl -u pulseboard -f
journalctl -u pulseboard --since '15 min ago' --no-pager
```

Stack traces appear here and only here — they are never placed in an HTTP response body.

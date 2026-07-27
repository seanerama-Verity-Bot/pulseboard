# 0004. Deploy to bench-target on port 3001 via systemd and Tailscale Funnel

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

`verity deployment list` shows exactly one configured method in the operator's catalog,
and the operator's instruction names it as the only permitted target:

- **`bench-target`** — self-hosted Ubuntu 24.04 VPS, host `bench-target.taile0ffc4.ts.net`,
  user `bench` with passwordless sudo, reached as `ssh bench-target` (key location
  `~/.ssh/bench_target`). Node 20, npm, git, curl, jq, rsync preinstalled. Public HTTPS
  is available only through Tailscale Funnel at `https://bench-target.taile0ffc4.ts.net/`
  with a valid Let's Encrypt certificate; nothing is proxied by default. `ufw` is active
  with 22, 80, 443 and 3000–3999 open. Ports and process management are our choice, to be
  recorded in an ADR and documented in the README.

The spec's definition of done requires every acceptance criterion to be verified against
the **live deployment**, not localhost — so the public URL is load-bearing, not a nicety.
Criterion A3 requires updates to survive a full server restart, and A8 measures
Lighthouse on the live deployment.

Global non-goals forbid Docker "unless the deployment target requires it". This target
does not require it: Node 20 is preinstalled.

## Decision

- **Target:** `bench-target`. No other target is proposed or configured.
- **Port:** the app listens on **`127.0.0.1:3001`**, from `PORT` (default 3001). Binding
  to loopback rather than `0.0.0.0` means the only public path in is the funnel, and the
  open 3000–3999 firewall range does not expose the app directly.
- **Public URL:** `https://bench-target.taile0ffc4.ts.net/`, published once with
  `sudo tailscale funnel --bg 3001` and verified with `tailscale funnel status`. This is
  the URL used for live verification, Lighthouse runs, and the README.
- **Process management: systemd**, unit `pulseboard.service`, `Restart=always`,
  `After=network-online.target`, `WantedBy=multi-user.target` so it is enabled at boot.
  Environment comes from `/etc/pulseboard/pulseboard.env`, mode `0640`, owned by `bench`,
  outside the repo and never in git.
- **App root on host:** `/srv/pulseboard` (owned by `bench`).
- **Database file:** `/srv/pulseboard/data/pulseboard.db`, i.e. `DATABASE_URL="file:/srv/pulseboard/data/pulseboard.db"`.
  It lives **outside** the synced release directory so a deploy can never overwrite it —
  this is what makes A3 (survive a full server restart) structurally true rather than
  incidentally true.
- **Deploy shape** (`/verity:ship` owns the script): build in CI or locally → `rsync` the
  build output and production `node_modules` to `/srv/pulseboard/current` →
  `prisma migrate deploy` → `sudo systemctl restart pulseboard` → poll `/healthz` until
  it returns 200 → smoke the public URL.
- **No Docker**, consistent with the global non-goals.

## Alternatives considered

1. **pm2 instead of systemd.** Popular in Node deployments and pleasant to use. Rejected:
   it adds a global npm dependency and a second supervision system on a box that already
   has systemd, and surviving a reboot then depends on `pm2 startup` having been run
   correctly. systemd is already installed, already starts at boot, already handles
   restart backoff, and already collects logs into journald. Fewer moving parts wins.
2. **Binding `0.0.0.0:3001` and letting the open firewall range serve traffic directly.**
   Rejected: it would expose plain HTTP publicly alongside the HTTPS funnel, which is
   both a needless surface and a mixed-origin cookie hazard (ADR 0005 sets `Secure` on
   the session cookie, which a plain-HTTP origin would break).
3. **nginx or Caddy in front.** Rejected: the funnel already terminates TLS with a valid
   certificate and maps 443 to one local port. A reverse proxy would add a component to
   operate for no capability we lack. Static asset caching is handled in-process
   (ADR 0002).
4. **Docker.** Rejected: an explicit global non-goal unless the target requires it, and
   this target does not.
5. **A ports-3000 choice.** 3001 is used rather than 3000 so a stray local dev server on
   the conventional port cannot collide with the production service on the same host.

## Consequences

- Exactly one public entry point, on HTTPS, which is what the `Secure` session cookie and
  the live-verification criteria need.
- The funnel mapping is host state, not repo state. It must be asserted (and verified via
  `tailscale funnel status`) as part of the first deploy and re-checked by SRE; the
  README documents the command so it can be re-established after a host rebuild.
- Secrets (`TEAM_CODE`, `SESSION_SECRET`) live only in `/etc/pulseboard/pulseboard.env`
  on the host and in GitHub Actions secrets. Nothing secret enters git — the repo carries
  only `.env.example` with placeholder values, and `.verity/deploy-access.md` records
  credential *locations*, never credentials.
- Restart semantics are the A3 test: `sudo systemctl restart pulseboard` must leave the
  database untouched. Because the DB path is outside the release directory, a redeploy is
  equally safe.
- Environment variables the unit must supply, documented in the README:
  `NODE_ENV=production`, `PORT=3001`, `DATABASE_URL`, `TEAM_CODE`, `SESSION_SECRET`,
  `APP_TIMEZONE` (ADR 0008).

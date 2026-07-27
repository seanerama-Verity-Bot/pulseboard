# UI smoke — Stage 1 (walking skeleton)

For the Operator. Runs against the **live** deployment, not localhost. Takes about two
minutes. Every step states exactly what to do and exactly what "pass" looks like.

- **Live URL:** <https://bench-target.taile0ffc4.ts.net/>
- **Build under test:** the version string shown by step 3 / returned by step 4.

Tick every box. Any unticked box is a fail — record what you saw and stop.

---

## 1. The page loads over HTTPS

- [ ] Open <https://bench-target.taile0ffc4.ts.net/> in a browser.
- [ ] The page returns **200** and renders. It is **not** blank, not a browser error page,
      not a certificate warning.
- [ ] The address bar shows a valid padlock (Let's Encrypt via Tailscale Funnel).

## 2. The app shell is visible

- [ ] A header is present at the top of the page with the heading **"Pulseboard"**.
- [ ] Below it, the tagline **"What the team is up to, right now."**.
- [ ] Content sits in a centred column with comfortable margins, not edge-to-edge.

## 3. The health view renders a real status

- [ ] A card titled **"Service health"** is visible.
- [ ] It reads **"Server status: ok"** (the word `ok` in green).
- [ ] Below it, a line reading **"Version <something>"** — a git sha or `0.1.0`.
- [ ] It does **not** stay stuck on "Checking the server…", and it does **not** read
      "Server status: unreachable".

## 4. `/healthz` answers the documented JSON

Run, or paste the URL into a browser tab:

```bash
curl -i https://bench-target.taile0ffc4.ts.net/healthz
```

- [ ] Status line is **`200`**.
- [ ] Body is exactly of the form `{"status":"ok","version":"<sha or package version>"}`.
- [ ] `content-type` contains `application/json`.

## 5. An unknown API route is JSON, never the app HTML

```bash
curl -i https://bench-target.taile0ffc4.ts.net/api/nope
```

- [ ] Status line is **`404`**.
- [ ] Body is `{"error":{"code":"NOT_FOUND","message":"That endpoint does not exist."}}`.
- [ ] The body is **not** HTML and contains no `<html`, no `<!doctype`, and no stack trace.

## 6. Mobile width is usable

- [ ] Open the browser's device toolbar (or resize) to **375 px** wide.
- [ ] The "Pulseboard" heading and the "Service health" card are both fully readable.
- [ ] There is **no horizontal scrollbar** and no text is cut off.

## 7. A restart leaves it healthy (criterion A3 rehearsal)

```bash
ssh bench-target sudo systemctl restart pulseboard
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' https://bench-target.taile0ffc4.ts.net/healthz
```

- [ ] Prints **`200`**.
- [ ] Reloading the browser tab still shows "Server status: ok".

---

**Scope note.** Stage 1 is the spine only. There is deliberately nothing to join, post,
edit or filter yet — if you are looking for those, they arrive in Stages 2 to 6.

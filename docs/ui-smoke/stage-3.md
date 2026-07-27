# UI smoke — Stage 3 (post an update: text, mood, the 280-character limit)

For the Operator. Runs against the **live** deployment, not localhost. Takes about five
minutes. Every step states exactly what to do and exactly what "pass" looks like.

- **Live URL:** <https://bench-target.taile0ffc4.ts.net/>
- **You will need:** the real `TEAM_CODE` for this deployment. It is supplied out of band
  (it lives in `/etc/pulseboard/pulseboard.env` on the host and nowhere in this repo).
  **Do not paste it into this file, a ticket, or a commit message.**
- **For section 7 only:** an SSH session on `bench-target` with `sudo`.

Tick every box. Any unticked box is a fail — record what you saw and stop.

---

## 1. Join, and find the composer waiting

- [ ] Open <https://bench-target.taile0ffc4.ts.net/> in a **private/incognito** window.
- [ ] Join with the real team code and the display name `Smoke Test`.
- [ ] Below the **"You are on the board"** card there is now a card titled
      **"Post an update"**.
- [ ] It has a labelled text box (**"What are you up to?"**), a **"Mood"** group with
      exactly four choices — **Focused, Cruising, Blocked, Away** — and a
      **"Post update"** button.
- [ ] **No mood is pre-selected.** All four are empty circles.
- [ ] The **"Post update"** button is **greyed out / not clickable**.
- [ ] Under the text box it reads **"280 characters left"**.
- [ ] A card below reads **"Posted just now"** with a line saying nothing has been posted
      from this tab yet. That is the expected empty state, not an error.

## 2. Post a short update, and see it

- [ ] Type `Smoke testing the composer.` into the text box.
- [ ] The counter counts down as you type and now reads **"253 characters left"** (27
      characters typed).
- [ ] The **"Post update"** button is still greyed out — because no mood is chosen yet.
- [ ] Click **Focused**.
- [ ] The button becomes clickable. Click it.
- [ ] Within a second, the update appears in the **"Posted just now"** card, showing
      **your display name**, the mood **Focused**, and the exact text you typed.
- [ ] The text box is now **empty** and **no mood is selected** again — the composer is
      ready for the next update, not still holding the last one.
- [ ] Nothing red, no status number, no JSON, no stack trace anywhere on the page.

## 3. The 281-character rejection (criterion A7)

- [ ] Paste **281 characters** into the text box. The quickest way: type one character,
      then paste it 280 more times — or paste this and confirm the counter agrees:

  ```
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  ```

  (four lines of 80 `a`s plus one — paste it as a single line if your browser keeps the
  line breaks; whitespace is trimmed before counting, so the count is what matters.)

- [ ] At exactly **280** the counter reads **"0 characters left"** and the button is
      **still clickable**.
- [ ] At **281** the counter turns a warning colour and reads
      **"1 characters over the limit"**.
- [ ] The **"Post update"** button is **greyed out** and clicking it does nothing.
- [ ] The warning is a plain sentence: **no `400`**, no "error", no JSON, no stack trace.
- [ ] Delete one character. The counter goes back to **"0 characters left"** and the
      button is clickable again — it recovers rather than staying stuck.
- [ ] Clear the box before moving on.

The server enforces the same limit independently — the counter is a courtesy. Check that
directly (this is the criterion, not the counter):

```bash
curl -i -X POST https://bench-target.taile0ffc4.ts.net/api/updates \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$(printf 'a%.0s' $(seq 1 281))\",\"mood\":\"focused\"}"
```

- [ ] Status line is **`401`** with code **`NOT_AUTHENTICATED`** — no cookie was sent, and
      the server checks who you are before it looks at what you sent.
- [ ] Repeat it with a session (add `-b` and a cookie jar from a `POST /api/session`, or
      simply trust the automated integration test that covers this): the answer is
      **`400`** with code **`TEXT_TOO_LONG`** and `"field":"text"`, and **no row is
      written**.

## 4. The mood picker works from the keyboard

- [ ] Click into the text box and type `Keyboard only.`
- [ ] Press **Tab** once. The focus ring lands on **Focused** (the first mood), not on the
      button and not somewhere invisible.
- [ ] Press **Space**. **Focused** is now selected.
- [ ] Press **→ (right arrow)**. The selection moves to **Cruising** — and **Focused** is
      no longer selected. Press **←** to go back.
- [ ] Press **Tab** once more, then **Enter**. The update posts.
- [ ] It appears in **"Posted just now"** with the mood you left selected.
- [ ] At no point did you need the mouse.

## 5. Mobile width is usable

- [ ] Open the browser's device toolbar (or resize) to **375 px** wide.
- [ ] The text box, all four mood choices and the **"Post update"** button are fully
      visible and fully readable; no label is cut off.
- [ ] There is **no horizontal scrollbar**.
- [ ] Post a short update at this width. It appears in the list, and there is **still** no
      horizontal scrollbar — including for a long unbroken word such as
      `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.

## 6. Emoji count as one character each

- [ ] Clear the box and paste **one emoji** (🚀). The counter reads **"279 characters
      left"**, not 278.

  That is the point of counting code points: the client and the server measure the same
  way, so the counter never says "fine" for something the server will refuse.

## 7. The update survives a restart (criterion A3)

This is the criterion the whole stage rests on: the update is in a database, not in a
process. Stage 3 has no read endpoint yet (`GET /api/board` is Stage 4), so the
**"Posted just now"** list is empty after a reload by design — the check below asks the
durable store directly.

**Scripted (preferred):**

```bash
ssh bench-target
set -a; . /etc/pulseboard/pulseboard.env; set +a     # brings in TEAM_CODE; do not echo it
bash /srv/pulseboard/current/deploy/restart-check.sh
```

Run it as the ordinary `bench` user, **not** under `sudo` — `sudo` strips the environment
and `TEAM_CODE` would arrive empty. The script calls `sudo systemctl restart` itself for
the one command that needs root.

- [ ] It prints steps 1/5 to 5/5 and ends with
      **`PASS: A3 — update <id> survived a restart of pulseboard, text intact.`**
- [ ] Its exit status is `0` (`echo $?`).

**By hand, if you would rather see it yourself:**

- [ ] In the browser, post an update reading `Survives a restart.` and note the time.
- [ ] On the host: `sudo systemctl restart pulseboard`
- [ ] Wait for `curl -fsS https://bench-target.taile0ffc4.ts.net/healthz` to answer `ok`.
- [ ] Reload the page in the browser. You are **still signed in** (the cookie is signed,
      not server-held), and the **"Posted just now"** list is empty — expected at this
      stage.
- [ ] Confirm the row is still there:

  ```bash
  cd /srv/pulseboard/current
  DATABASE_URL=file:/srv/pulseboard/data/pulseboard.db node -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.update.findMany({ orderBy: { createdAt: "desc" }, take: 3 })
      .then((rows) => { console.log(rows); return prisma.$disconnect(); });
  '
  ```

- [ ] The newest row is your `Survives a restart.` update, with `mood` one of the four
      lowercase moods and a `createdAt` from **before** the restart.

## 8. The API tells the truth on its own

```bash
curl -i -X POST https://bench-target.taile0ffc4.ts.net/api/updates \
  -H 'Content-Type: application/json' \
  -d '{"text":"no session","mood":"focused"}'
```

- [ ] Status line is **`401`**, code **`NOT_AUTHENTICATED`**, and the body is the plain
      `{"error":{"code":...,"message":...}}` envelope — no HTML, no stack trace.

```bash
curl -i https://bench-target.taile0ffc4.ts.net/api/updates
```

- [ ] Status line is **`404`** with code **`NOT_FOUND`** — a `GET` of the updates
      collection does not exist yet, and an unmatched `/api/*` route is JSON, never the
      SPA's `index.html`.

---

**Scope note.** Stage 3 is the write half. There is deliberately still no team board, no
Today/Yesterday filter, and no edit or delete — those are Stages 4 to 6. The
**"Posted just now"** list showing only what this tab posted, and emptying on reload, is
expected at this stage and is replaced by the real board in Stage 4.

**Housekeeping.** The `Smoke Test` member and the updates you posted stay in the database.
That is harmless and intentional; note it in the release record if the board is about to
be shown to the team, and post a real first update so the board does not open on smoke
text.

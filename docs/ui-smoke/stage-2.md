# UI smoke — Stage 2 (join: team code and signed session)

For the Operator. Runs against the **live** deployment, not localhost. Takes about three
minutes. Every step states exactly what to do and exactly what "pass" looks like.

- **Live URL:** <https://bench-target.taile0ffc4.ts.net/>
- **You will need:** the real `TEAM_CODE` for this deployment. It is supplied out of band
  (it lives in `/etc/pulseboard/pulseboard.env` on the host and nowhere in this repo).
  **Do not paste it into this file, a ticket, or a commit message.**

Tick every box. Any unticked box is a fail — record what you saw and stop.

---

## 1. A stranger lands on the door, not on the board

- [ ] Open <https://bench-target.taile0ffc4.ts.net/> in a **private/incognito** window, so
      no earlier session is in play.
- [ ] A card titled **"Join the board"** is visible.
- [ ] It has two labelled fields, **"Team code"** and **"Display name"**, and a button
      reading **"Join the board"**.
- [ ] There is **no error message** on the page. Arriving signed-out is normal, not a
      failure, and nothing red or alarming should be showing.

## 2. A wrong team code is refused politely, and does not sign you in

- [ ] In **Team code**, type `not-the-code`.
- [ ] In **Display name**, type `Smoke Test`.
- [ ] Press **Enter** (do not click) — the form must submit on Enter.
- [ ] A message appears **directly under the Team code field**, in red, saying the code did
      not match and suggesting you check it with a teammate.
- [ ] The message is **polite and non-blaming**: no "access denied", no "forbidden", no
      raw status number like `401`, no stack trace, no JSON.
- [ ] The cursor is back **in the Team code field** (the text caret is visible there).
- [ ] You are **still on the join card**. There is no "You are on the board" card and no
      display name shown anywhere.

## 3. No cookie was issued for the wrong code

- [ ] Open the browser devtools → **Application** (Chrome) or **Storage** (Firefox) →
      **Cookies** → the site's origin.
- [ ] There is **no cookie named `pb_session`**. Not an empty one — none at all.

## 4. The real team code lets you in

- [ ] Clear the **Team code** field and type the real `TEAM_CODE` supplied to you.
- [ ] Leave **Display name** as `Smoke Test` (or set it to your own name).
- [ ] Click **"Join the board"**.
- [ ] The join card is replaced by a card titled **"You are on the board"**.
- [ ] It reads **"Signed in as Smoke Test"** — the display name you typed, spelled exactly
      as you typed it.
- [ ] A **"Sign out"** button is visible next to it.
- [ ] The "Service health" card from Stage 1 is still visible below and still reads
      **"Server status: ok"**.

## 5. The session is a real cookie, and a proper one

Back in devtools → Cookies:

- [ ] A cookie named **`pb_session`** now exists.
- [ ] Its **HttpOnly** column is ticked (script cannot read it).
- [ ] Its **Secure** column is ticked (the live origin is HTTPS-only).
- [ ] Its **SameSite** is **`Lax`** and its **Path** is **`/`**.
- [ ] Its value is two chunks separated by a single `.` — and it contains **no** readable
      team code and **no** readable password-like string.

## 6. A reload keeps you signed in

- [ ] Press reload (F5 / Cmd-R).
- [ ] The page comes back showing **"You are on the board"** and **"Signed in as
      Smoke Test"** again.
- [ ] It does **not** flash back to the join card and stay there.
- [ ] Close the tab, open <https://bench-target.taile0ffc4.ts.net/> again in the **same**
      private window: still signed in.

## 7. Re-joining with the same name is the same person

- [ ] Sign out (step 8), then join again with the **same display name** but different
      capitalisation and extra spaces — e.g. `  smoke   test  `.
- [ ] You are signed in, and the name shown is the **original** spelling, `Smoke Test` —
      the server recognised a returning teammate rather than creating a second one.

## 8. Sign out returns you to the door

- [ ] Click **"Sign out"**.
- [ ] The join card comes back, with both fields empty and no error message.
- [ ] In devtools → Cookies, **`pb_session` is gone**.
- [ ] Reload the page: you are **still** on the join card, not signed back in.

## 9. Mobile width is usable

- [ ] Open the browser's device toolbar (or resize) to **375 px** wide.
- [ ] Both fields, both labels and the **"Join the board"** button are fully visible and
      fully readable; no text is cut off.
- [ ] There is **no horizontal scrollbar**.
- [ ] Join at this width. The **"Signed in as …"** line and the **"Sign out"** button both
      fit, wrapping onto two lines if they need to, still with no horizontal scrollbar.

## 10. The API tells the truth on its own

```bash
curl -i https://bench-target.taile0ffc4.ts.net/api/session
```

- [ ] Status line is **`401`**.
- [ ] Body is `{"error":{"code":"NOT_AUTHENTICATED","message":"..."}}` — the message is a
      plain, polite sentence.
- [ ] The response contains **no** team code, **no** secret, no HTML and no stack trace.

```bash
curl -i -X POST https://bench-target.taile0ffc4.ts.net/api/session \
  -H 'Content-Type: application/json' \
  -d '{"teamCode":"not-the-code","displayName":"Smoke Test"}'
```

- [ ] Status line is **`401`** and the code is **`INVALID_TEAM_CODE`**.
- [ ] There is **no `set-cookie:` header** anywhere in the response.
- [ ] The body does **not** echo the expected team code, in whole or in part.

---

**Scope note.** Stage 2 is the door only. There is deliberately still nothing to post,
edit or filter once you are inside — the board itself arrives in Stages 3 to 6. The
"Service health" card staying visible is expected, not a leftover.

**Housekeeping.** If you joined as `Smoke Test`, that Member row stays in the database.
That is harmless and intentional (there is no delete-account feature and none is planned);
note it in the release record if the board is about to be shown to the team.

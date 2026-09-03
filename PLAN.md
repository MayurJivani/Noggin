# Plan

What exists, and what is deliberately left for later.

## Shipped

- **Accounts** — host sign-in with scrypt and cookie sessions. Players never
  need one. Boards and saved games are owned; signups close after the first.
- **Remote controller** (`/control`) — the in-depth surface for a second
  operator, reachable with an account or a host-issued key (with QR) that dies
  with the room.
- **Several games at once** — the desk switches between your rooms and opens new
  ones; deleting a game ends it live and removes the saved copy.
- **Undo the last ruling** — one deep, restoring score, spent player, buzzer and
  tile together.
- **The final clue** — blind wagers, written answers against a clock, and a
  reveal that turns players over poorest first. Wagers and answers are projected
  per viewer, so no player sees another's before the host opens it.
- **Spreadsheet import** — CSV or a tab-separated paste, previewed before it
  replaces anything, with bad rows reported by line.
- **Auto-arm** — the buzzer opens with the clue, optionally after a reading
  delay.
- **Board housekeeping** — duplicate and delete from the builder's list.
- **Podium screens** (`/podium`) — one per player, name and score filling it,
  lighting up when they buzz. **Scoreboard** (`/scores`) — all of them at once.
- **Front door** (`/`) — pick a role, join by code, and resume any unfinished
  game of your own. Live rooms are marked as such.
- **Save & resume** — a room freezes to storage under its own code and comes
  back with its board, spent tiles, players and scores. Autosaves on change, on
  the last person leaving, and on shutdown.
- **Storage** — Postgres when `DATABASE_URL` is set, JSON files otherwise,
  behind one async interface.
- **Host desk** (`/host`) — board builder and control desk in one page.
  Categories, editable point ladders, image/audio clues, daily doubles, board
  autosave and import/export, tunable rules.
- **Big screen** (`/display`) — board grid, clue reveal that flies out of the
  tile it came from, daily double splash, buzz-in slam, countdown rings,
  rolling scores, lobby with join QR.
- **Player buzzer** (`/play`) — join by code or QR, one thumb-sized button,
  haptics, early-buzz feedback, the clue text mirrored for anyone who can't see
  the TV, Phone a Friend request.
- **Relay** — server-authoritative rules, per-role redaction, reconnection with
  grace, media upload and range-serving, board persistence.

## Next

- **A slimmer host tab.** The controller shipped, but `/host` is still the full
  desk. The original idea was a host holding a tablet with the clue, the answer
  and two buttons while the controller runs everything else — that mode does not
  exist yet, and the host desk is a poor thing to hold in one hand.
- **Who did what.** Two privileged clients can both press Arm. The relay's
  mutators are idempotent enough that this is harmless, but neither screen shows
  which operator acted, and two people will eventually fight over the buzzer.
- **Presence between operators.** Neither the host nor the controller can see
  that the other is connected, or notice when they drop.
- **Password reset.** There is no recovery flow. A forgotten password currently
  means editing the database.

## Later, unranked

- **Teams.** Several phones sharing one score and one buzzer. Every comparable
  tool has this and pub quizzes are team-based, but it reaches into the player
  model, the buzzer, scoring and all three screens — worth doing deliberately
  rather than bolted onto a working buzzer.
- **Question bank.** Boards can be duplicated; individual clues cannot be reused
  across games without copying the whole thing.
- **Board library.** The relay stores boards; the builder lists them. Missing:
  duplicate, rename, delete, and folders once there are more than a dozen.
- **Answer checking.** Optionally let players type an answer and have the host
  judge the text rather than the room. Useful for a written round; harmful for
  a fast one.
- **Spectator view.** A read-only `/display` variant for people watching from
  another room.
- **Persisted game history.** Who won, what was missed, which clues nobody got.

## Browser notes

The player page is the one that has to work on whatever someone happens to be
holding, so it avoids things that are absent or hostile on real devices:

- Pointer Events are not universal in in-app browsers; touch is handled too.
- `localStorage` throws on write in Safari Private Browsing. Every access goes
  through `src/lib/storage.js`, which degrades to a no-op — nothing in the game
  depends on it.
- `MediaQueryList.addEventListener` is Safari 14+. The reduced-motion hook
  feature-detects and falls back to `addListener`.
- React registers `touchstart` passively, so `preventDefault` from a touch
  handler does nothing but log an error in Safari. `touch-action: none` on the
  button does the real work.

## Known limits

- One relay process holds live rooms in memory. It writes them down on change
  and on shutdown, so a restart loses at most the last few seconds and any
  buzzer race in flight — but two relay processes would not share rooms. Fine
  for a living room, not for a hosted service.
- Players are still unauthenticated by design: anyone on the wifi who knows a
  room code can take a seat under any name. That is the right trade for a party.
  Hosting, resuming and controlling are all gated; joining is not.
- No rate limiting on the login route. On a LAN that is fine; on a public URL a
  patient attacker can grind passwords. scrypt makes each attempt expensive, but
  expensive is not the same as blocked.
- Saved rooms are never expired. A machine that has hosted a hundred quizzes
  accumulates a hundred rows; the front page shows the most recent and the rest
  just sit there.
- The big screen assumes a landscape display and a room that can see it.

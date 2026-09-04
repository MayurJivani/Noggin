# Plan

What exists, and what is deliberately left for later.

## Shipped

- **Teams** — several phones sharing one score, one lifeline purse and one
  buzz. The buzzer thinks in sides rather than seats, so a team gets one entry
  in the race however many phones it fields and a miss puts all of them out.
  Sides carry through the nitro wager, the final and all four screens.
- **Pause** — the room freezes, the buzzer shuts, and a running clock is banked
  rather than cancelled: resuming returns exactly the time that was left.
- **Video clues** — alongside image and audio, served with range support.
- **Ping correction** — judge the race on reaction rather than on whose wifi is
  faster. The relay measures each phone's round trip itself, credits it back
  capped at 500ms, and holds the race open briefly so the corrected winner can
  actually win it.
- **Buzzer sound-check** — prove every phone's button reaches the relay before
  the first clue, with each phone's round-trip beside it. A test press scores
  nothing and is not a race entry.
- **The soundboard** — built, and **switched off** until sounds are chosen:
  a sample engine, a fifteen-cue roster, a bed that ducks under a clue, relay
  messages to fire them. One constant (`SAMPLES_ENABLED`) and a folder of MP3s
  away from working. Game cues stay synthesised and are unaffected.
- **The cue cards** (`/cards`) — the tablet a host reads from: the clue, the
  answer, a grid to pick the next one, and the verdict under a thumb. The
  "slimmer host tab" the original plan wanted, finally.
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
  Categories, editable point ladders, image/audio clues, Nitro tiles, board
  autosave and import/export, tunable rules.
- **Big screen** (`/display`) — board grid, clue reveal that flies out of the
  tile it came from, Nitro splash, buzz-in slam, countdown rings,
  rolling scores, lobby with join QR.
- **Player buzzer** (`/play`) — join by code or QR, one thumb-sized button,
  haptics, early-buzz feedback, the clue text mirrored for anyone who can't see
  the TV, Phone a Friend request.
- **Relay** — server-authoritative rules, per-role redaction, reconnection with
  grace, media upload and range-serving, board persistence.

## Next

- **Who did what.** Two privileged clients can both press Arm. The relay's
  mutators are idempotent enough that this is harmless, but neither screen shows
  which operator acted, and two people will eventually fight over the buzzer.
- **Presence between operators.** Neither the host nor the controller can see
  that the other is connected, or notice when they drop.
- **Password reset.** There is no recovery flow. A forgotten password currently
  means editing the database.

## Later, unranked

- **Team chat.** Factile lets a team confer in the app before answering. In a
  living room they just talk, so this only matters for a remote quiz.
- **Typed answers.** Optionally let players type an answer and have the host
  judge the text rather than the room. Useful for a written round; harmful for
  a fast one, and it needs its own phase rather than a flag on the buzzer.
- **Multiple choice.** A per-clue list of options shown on the phones. Cheap to
  add and a different game — worth deciding it is wanted before building it.
- **Question bank.** Boards can be duplicated; individual clues cannot be reused
  across games without copying the whole thing.
- **Board library.** The relay stores boards; the builder lists them. Missing:
  duplicate, rename, delete, and folders once there are more than a dozen.
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
- `requestAnimationFrame` does not run in a page the browser has stopped
  compositing — a projector window behind another, a display on a second
  desktop. The rolling scores used to freeze on a stale total there, silently.
  `src/lib/useRolling.js` commits the target on a timer as well as on the last
  frame, and skips the animation outright when the page is already hidden:
  being right beats being pretty on the one screen the room is reading. The
  clue card had the same disease and worse symptoms — it starts at `opacity: 0`
  and is revealed *by* the animation, so on such a window the clue never
  appeared at all. It now has the same net.

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

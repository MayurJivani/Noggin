# Plan

What exists, and what is deliberately left for later.

## Shipped

- **Front door** (`/`) — pick a role, join by code, and resume any unfinished
  game. Live rooms are marked as such.
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

## Next: the remote controller (`/control`)

The route and the protocol role exist; only the interface is outstanding.

**Why.** One person cannot comfortably read a clue aloud, watch five faces, and
also drive a board. Splitting the desk lets the host hold a tablet with the clue
and the two buttons that matter, while someone at the side runs everything else.

**How it slots in.** The relay already accepts `role: "controller"` and gives it
the same privileged command surface and the same unredacted state as the host
(`projectState` treats `host` and `controller` identically — there's a test that
asserts the two projections match). Nothing about the server needs to change.

**What has to be decided and built:**

1. **The split.** Proposed:
   - *Host tab* — clue text, the answer, who holds the buzzer, Correct/Wrong,
     Next. Nothing else on the screen.
   - *Controller* — the grid, arm/lock/reset, score corrections, lifelines,
     timers, media cueing, player management.
2. **Pairing.** Same room code, entered or scanned from a QR on the host desk.
   Worth considering whether a controller should need to be admitted by the
   host rather than just knowing the code — the code is on a projector.
3. **Conflict.** Two privileged clients can both press Arm. The relay's mutators
   are already idempotent enough that this is harmless, but the UI should show
   *who* did what, or the two operators will fight over the buzzer.
4. **Presence.** Each privileged client should be able to see the other is
   connected, and notice when it isn't.

## Later, unranked

- **Final round.** A wager-and-write-it-down finale: every player stakes part of
  their score, answers on their phone, and the screen reveals them one at a
  time. The board data model already carries multiple rounds; this needs a new
  phase, per-player wagers and submitted answers, and a reveal sequence.
- **Teams.** Several phones sharing one score and one buzzer.
- **Board library.** The relay stores boards; the builder lists them. Missing:
  duplicate, rename, delete, and folders once there are more than a dozen.
- **Answer checking.** Optionally let players type an answer and have the host
  judge the text rather than the room. Useful for a written round; harmful for
  a fast one.
- **Spectator view.** A read-only `/display` variant for people watching from
  another room.
- **Board CSV/TSV import.** Most people write their quiz in a spreadsheet.
- **Persisted game history.** Who won, what was missed, which clues nobody got.

## Known limits

- One relay process holds live rooms in memory. It writes them down on change
  and on shutdown, so a restart loses at most the last few seconds and any
  buzzer race in flight — but two relay processes would not share rooms. Fine
  for a living room, not for a hosted service.
- No authentication anywhere. Anyone on the wifi who knows a room code can join
  as a player, anyone who opens `/host` can open a room, and anyone can resume
  or forget a saved game. That is the right trade for a party and the wrong one
  for anything public. If this ever goes past a LAN, the saved-room endpoints
  are the first thing that needs a gate.
- Saved rooms are never expired. A machine that has hosted a hundred quizzes
  accumulates a hundred rows; the front page shows the most recent and the rest
  just sit there.
- The big screen assumes a landscape display and a room that can see it.

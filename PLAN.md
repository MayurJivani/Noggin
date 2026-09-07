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
  the first clue, with each phone's round-trip beside it, and see who got there
  first. The order is computed by the relay with the same rule that will judge
  the real race, lag credit included — a check that ranked on raw arrival would
  tell the host the opposite of what the game is about to do, and they would
  find out on the first clue that mattered. A test press scores nothing and is
  not a race entry.
- **Join by being in the room** — the big screen plays the room code and a
  rotating nonce as a tone nobody can hear, and a phone with the player page
  open decodes it and joins. The modem is [Knock](../Knock), vendored into
  `src/lib/knock/` and `server/knock.js`: `knock-audio` is not on npm and the
  Docker build context cannot reach a sibling directory, so it is a copy with a
  commit on it. **Fix bugs upstream first, then re-copy.**

  The nonce is not a gate and is not sold as one — joining a Noggin room has
  never needed more than the code. What it buys is narrower: a *recording* of
  the room cannot join. Without it, filming the television and playing the clip
  back near a phone would walk that phone into the game.

  Microphone access needs a secure context, so **this does not work over a bare
  LAN address** — the button is not offered on `http://192.168.x.x` at all, only
  over HTTPS or localhost. Every path falls back to typing the code, including
  browsers that resample the microphone below the band and can never hear it.
- **Streamer mode** — a room setting that keeps the code and the join QR off
  every screen a camera can see: the big screen, the scoreboard, the podiums and
  the players' own phones. The host desk, the cue cards and the controller keep
  it, because the people driving still need it.

  The code is withheld in `projectState` rather than hidden in CSS. An overlay
  is not a redaction: a broadcaster capturing a browser source can inspect it, a
  screenshot tool reads what is merely transparent, and the next component to
  render `state.code` leaks it again. The QR goes too — a QR on a stream is
  *easier* to use than one in the room, because a viewer can pause the video.

  It pairs with joining by sound, and that pairing is the point: the tone is the
  way in that a hidden code leaves open. It does not survive a stream nearly as
  well as a QR does, and it expires in seconds regardless.
- **Six takes of every game cue, and a chosen mix.** Four takes are one family,
  differing in production rather than material: `current` is the original, plain
  and legible; `v2` is the original made properly — an onset, a body of two
  detuned voices, sub weight under the moments a room reacts to physically;
  `v3` is V2 tightened for a hall, where a long tail smears into the next thing;
  `v4` is V2 warmed for a living room. Two change the material instead: `gold`
  is struck bells and brass, `arcade` a chip blip with a gold tail. All
  synthesised, so a buzz-in still lands *with* the press.

  What ships is `CHOSEN` in `src/lib/sfx.js` — **one take per cue**, from a real
  listening session rather than a preference. The pattern that came out of it:
  the heavy moments went warm and the quick ones stayed plain. Everything
  marking a change of state took V4; everything firing *during* play stayed on
  the original. A single take for twenty cues that do different jobs was always
  going to be wrong for some of them. `FORCE_TAKE` overrides the lot when you
  need to hear one voice across the board.

  The listening page that produced this is **gone** — it existed to be compared
  on, that comparison happened, and a public page making noises is not something
  to leave standing once it has nothing left to decide. The two unchosen takes
  (`gold`, `arcade`) are kept in source: the expensive part of rethinking a cue
  is having something to hold it against.
- **A 404 page** — the one page rendered at build time with no island at all, so
  it survives a browser having a bad day. Two ways out rather than a back
  button: the people who land here are a player whose link is wrong and a host
  whose bookmark moved, and they want opposite things.
- **Interface sounds** — a tap, a tab, a toggle, a panel, a save, a refusal.
  Built and **off**, on their own bus so they can be silenced without touching
  the game. Never reviewed and not wired to any button, so `UI_SFX_ENABLED`
  alone changes nothing — the wiring is deliberately the last step, since
  spreading unapproved cues across fifty call sites is work that gets thrown
  away.
- **The soundboard** — built, and **switched off** until sounds are chosen:
  a sample engine, a fifteen-cue roster, a bed that ducks under a clue, relay
  messages to fire them. One constant (`SAMPLES_ENABLED`) and a folder of MP3s
  away from working. Game cues stay synthesised and are unaffected.
- **The cue cards** (`/cards`) — the tablet a host reads from: the clue, the
  answer, a grid to pick the next one, and the verdict under a thumb. The
  "slimmer host tab" the original plan wanted, finally.
- **Screens that stay awake** — every screen that has to keep working unattended
  holds a wake lock, re-acquired whenever the page comes back, with a muted-clip
  fallback for iOS before 16.4 and an honest hint on the phone when neither
  works.
- **Operators** — the desk, the cue cards and the controller can see each other
  and what the last one of them did, with the surface they did it from. Shown to
  operators only; players and the big screen see none of it.
- **Accounts** — host sign-in with scrypt and cookie sessions. Players never
  need one. Boards and saved games are owned; signups close after the first.
- **Password recovery** — a code handed over once at signup and kept only as a
  hash; one step to redeem, spent on use, and every open session turned out with
  it. `scripts/recovery-code.js` mints one for accounts that predate it. No
  email server involved, deliberately.
- **Remote controller** (`/control`) — the in-depth surface for a second
  operator, reachable with an account or a host-issued key (with QR) that dies
  with the room.
- **Several games at once** — the desk switches between your rooms and opens new
  ones; deleting a game ends it live and removes the saved copy.
- **Undo the last ruling** — one deep, restoring score, spent player, buzzer and
  tile together.
- **Survey round** — an optional "we asked a hundred people" round played last,
  after the final and *before* any tie-break — it still moves scores, so a tie
  settled ahead of it would be settled on the wrong numbers. Up to five questions, each its own board of
  hidden answers with points, a buzzer race per slot, strikes, and the buzzed
  player types their answer for the host to match. Boards can be built from a
  **public survey link** (`/survey`) handed to anyone: responses are tallied per
  question, folded by meaning, and turned into slots.
- **A running order the engine owns** — rounds, then the final if the board has
  one, then the survey if it has one, then a tie-break if the scores are still
  level. `pending()` in `server/game.js` answers "what next" and every screen and
  guard reads it. It used to live nowhere: any of these could open at any time
  and the desk decided which button to show, which produced three wrong games —
  the final opened at the first intermission abandoned every round after it; the
  last round going straight to `ended` left the compulsory final unreachable
  from the host's own screen; and a tie-break offered before the survey settled
  the game on scores the survey was about to change.
- **Everyone plays the final, and every bet has a floor.** A side may stake
  1000, or the size of its own score when that is larger — the *size*, so a team
  on -2500 may stake 2500. Nobody is excluded for being broke. The old rule shut
  out anyone on nothing, which ended their night a round early and was
  self-reinforcing: the only round that could have got them back was the one
  they were barred from. The nitro uses the same rule, with the round's top tile
  as an additional floor.
- **Tie-break** — sudden death when the game ends level: the tied sides only,
  first correct answer wins, nothing scored. Optional clue written beside the
  final; the host can rerun it or award it by hand if nobody takes it.
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

- Nothing ranked. The three that were here — operator attribution, presence
  between operators, and password reset — all shipped; see below.

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
- **Board library.** Duplicate and delete shipped. Still missing: rename without
  opening the board, and folders once there are more than a dozen.
- **Spectator view.** A read-only `/display` variant for people watching from
  another room.
- **Persisted game history.** Who won, what was missed, which clues nobody got.

## Audio notes

Two mistakes account for nearly every synthesised cue that sounds like a fault
rather than a sound, and both were in this codebase:

- **Noise through a stationary filter is static.** The ear reads *movement*,
  not position, so no choice of centre frequency turns a fixed bandpass into a
  whoosh — the band has to sweep. The board going up and a new round starting
  both used a fixed 900Hz band at Q 0.4, which is so wide it barely filtered at
  all, and both sounded like an untuned radio.
- **A gain that starts at full value clicks.** The noise buffer's first sample
  is already at amplitude, so setting the envelope flat steps from silence to
  maximum in one sample. Milliseconds of attack fix it and cost nothing.

`tests/audio-stub.js` is the reason these stay fixed. Node has no
`AudioContext`, so without it every cue returns at its first line and a test
that calls all of them proves only that the module loads — which is exactly how
a `ReferenceError` three lines past that guard survived a green suite and
silenced half the cues in the app. The stub makes no sound and models no DSP;
it exists to make the bodies run, and to be strict where real Web Audio is
strict: `exponentialRampToValueAtTime` rejects a target of zero, and scheduling
times must be finite.

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
  Hosting, resuming and controlling are all gated; joining is not. Streamer mode
  and the ultrasonic join narrow *how the code spreads*; neither turns joining
  into something that checks who you are, and treating them as if they did would
  be the mistake this note exists to prevent.
- Ultrasonic join is proximity by convenience, not attestation. Sound goes
  through doors and walls, a phone in the next room can hear the tone, and
  anything with a speaker can transmit a payload that passes CRC — which is why
  `/api/knock` validates what it is handed rather than trusting it.
- No rate limiting on the login route, and now `/auth/forgot` is a second one
  with the same property. On a LAN that is fine; on a public URL a patient
  attacker can grind both. scrypt makes each attempt expensive, and a recovery
  code is 20 characters from a 32-symbol alphabet — roughly 100 bits, so
  guessing it is not the worry. Expensive is still not the same as blocked.
- Saved rooms are never expired. A machine that has hosted a hundred quizzes
  accumulates a hundred rows; the front page shows the most recent and the rest
  just sit there.
- The big screen assumes a landscape display and a room that can see it.
- The end-of-round and final-scores lists on the big screen show the top eight.
  With more players than that the rest are on `/scores` rather than the TV.

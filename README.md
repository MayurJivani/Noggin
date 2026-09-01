# NOGGIN’

A quiz-board game show for a room with a TV and a pile of phones.

Write the board in the afternoon, put the big screen on the projector, let
everyone scan a QR, and run the night from one desk. Categories, point ladders,
image and audio clues, daily doubles, a real buzzer race with millisecond
ordering, and a Phone a Friend lifeline.

```sh
npm install
npm run dev
```

Open the host desk at the **LAN address printed on startup** — not `localhost`,
or nothing else in the room can reach it.

## The screens

| Where | Who | What |
| :--- | :--- | :--- |
| `/` | everyone | Front door — pick a role, or resume a saved game |
| `/host` | host | Build the quiz, then run it |
| `/display` | the TV | The board, the clue, the scores — read-only |
| `/play` | every player | A room code, a name, and one enormous button |

`npm run dev` starts two processes:

| Port | What |
| :--- | :--- |
| 4331 | Astro — the pages above |
| 4332 | Relay — WebSocket game state, media upload/streaming, storage |

Both bind to `0.0.0.0` so anything on the same wifi can reach them.

## Saving a game for later

A quiz rarely finishes in one sitting. **Save game** on the host desk freezes
the room — the board with its spent tiles, everyone's name and score, which
round you were on — under its own room code. It comes back from the front page,
or from `/host?code=XXXX`.

The relay also autosaves a few seconds after every change and again when the
last person leaves, so a closed laptop or a Ctrl-C mid-round is recoverable
rather than fatal. What is deliberately *not* saved is transient: the buzzer
race, a running countdown, an in-flight lifeline. A game resumes at rest, never
with a clock that expired on Tuesday.

A live room always beats its own saved copy — resuming can never clobber a game
that is currently being played.

## The host desk

Two halves, one page, because on the night you flip between them constantly.

**Build** works with nothing else running. Click a tile to write it: clue text,
an answer only you ever see, points, and optionally an image or a sound. Mark
tiles as daily doubles by hand or hit **✦ Scatter** to place them the way the
show does. Everything autosaves to the relay — closing the tab at 1am doesn't
cost you the quiz. Export drops a `.noggin.json` you can mail to someone.

**Run** is the desk during the show:

- The mini board on the left is how you pick. The big screen follows.
- **Arm** opens the buzzer. First press wins; everyone else's press is still
  recorded with its margin, so a photo finish can be settled by eye.
- **Correct** / **Wrong** rules on the player holding the floor. A miss deducts
  and reopens the buzzer for everyone who hasn't answered yet.
- Any score can be corrected by clicking it. Hosts make mistakes and arguing
  with software in front of an audience is not an option.
- ☎ grants Phone a Friend. Players can ask from their phone; you still decide.

Keys, because the other hand is holding a microphone:

| | |
| :--- | :--- |
| <kbd>space</kbd> | arm / lock the buzzer |
| <kbd>y</kbd> <kbd>n</kbd> | correct / wrong |
| <kbd>r</kbd> | reveal the answer |
| <kbd>enter</kbd> | next clue |
| <kbd>esc</kbd> | reset the buzzer race |

## How the buzzer is fair

The relay is the referee. A phone never decides anything — it sends "I pressed"
and the server timestamps arrival. On a LAN that's a couple of milliseconds of
jitter against human reaction times of two hundred.

Pressing **before** the host arms costs a short lockout (500ms by default), so
mashing the button from the moment a clue appears gains nothing. Losing the race
by 60ms is *not* the same offence and costs nothing.

Answers are never sent to a client that shouldn't have them. The big screen and
the players' phones both receive the board with every unplayed clue's text,
answer and daily-double flag stripped out; the live clue's answer arrives only
when the host reveals it. Opening devtools on the TV gets you nothing.

## Media

Drop an image or an audio file onto a clue in the builder. It uploads to the
relay so every device streams from one place, and the board only ever stores a
path — a phone resolves it against a host it can actually reach. Audio clues get
a visualiser on the big screen so the room can tell something is happening.

Uploads cap at 25MB (`NOGGIN_MAX_UPLOAD`).

## Reconnection

Everything survives a reload. The room owns the game state, not the host tab.

- A player who locks their screen or drops off wifi comes back to the same seat,
  name and score for five minutes.
- The big screen holds no state at all and can be reloaded mid-clue.
- The host desk rejoins the room code it opened last, rather than minting a new
  one that's already on a projector and in five phones.

## Sound

Cues are synthesised in the browser — no assets, no loading state on the one
page that must never be loading. Browsers won't start audio without a gesture,
so the big screen arms itself on the first click anywhere.

## Tests

```sh
npm test
```

`tests/game.test.js` drives the rules engine directly — buzzer ordering,
penalties, scoring, daily doubles, round rollover, and what each role is allowed
to see. `tests/relay.test.js` boots a real relay and runs a round over real
sockets with a host, a big screen and two phones.

## Storage

Boards and saved rooms go to **Postgres if `DATABASE_URL` is set, JSON files
otherwise**. The file backend is not a hedge — it's the difference between
"clone it and run a quiz tonight" and "clone it, install Postgres, then run a
quiz". The relay never knows which one it got.

To use Postgres, create the two tables first:

```bash
psql "$DATABASE_URL" -f server/schema.sql
```

Then start as usual with `DATABASE_URL` in the environment:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/noggin npm run dev
```

The relay prints which backend it chose at boot. If `DATABASE_URL` is set but
the tables are missing, it says so loudly and falls back to files rather than
failing halfway through a game.

`server/schema.sql` is two tables of `jsonb` and is safe to re-run. Boards and
rooms are documents — always read and written whole, by one host at a time — so
shredding them into category and clue tables would buy joins nobody performs and
cost a migration every time a clue grows a field. The columns beside `data`
exist so the pickers can list and sort without parsing every document.

## Notes

- `package.json` pins an `overrides.vite` entry. Astro and `@tailwindcss/vite`
  otherwise resolve two different major versions of Vite and the CSS build
  fails; forcing one copy fixes it.
- Everything in `src/styles/global.css` lives inside `@layer base`. Tailwind 4
  declares `@layer theme, base, components, utilities`, and an *unlayered* rule
  beats every layered one regardless of specificity — so a bare
  `* { padding: 0 }` out there silently defeats every spacing utility in the
  app. Keep new global rules in a layer.
- With no `DATABASE_URL`, boards live in `data/boards/`, saved rooms in
  `data/rooms/`, uploads in `uploads/`. All gitignored.
- `PLAN.md` covers what's next — chiefly the remote controller at `/control`.

## Configuration

| Variable | Default | |
| :--- | :--- | :--- |
| `DATABASE_URL` | — | Postgres connection string; unset means file storage |
| `NOGGIN_PORT` | 4332 | relay port |
| `NOGGIN_UPLOAD_DIR` | `./uploads` | clue media |
| `NOGGIN_DATA_DIR` | `./data/boards` | saved boards (file backend) |
| `NOGGIN_ROOM_DIR` | `./data/rooms` | saved games (file backend) |
| `NOGGIN_PLAYER_GRACE_MS` | 300000 | how long a dropped player keeps their seat |
| `NOGGIN_MAX_UPLOAD` | 26214400 | upload ceiling in bytes |
| `PUBLIC_WS_URL` | — | override the relay origin (tunnels, reverse proxies) |

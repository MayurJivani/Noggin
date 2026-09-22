# NOGGIN’

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fnoggin.futile.studio&label=noggin.futile.studio&style=flat-square)](https://noggin.futile.studio)
![Astro](https://img.shields.io/badge/Astro-5-BC52EE?style=flat-square&logo=astro&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-optional-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-345%20passing-success?style=flat-square)
[![Stars](https://img.shields.io/github/stars/MayurJivani/Noggin?style=flat-square)](https://github.com/MayurJivani/Noggin/stargazers)
[![Issues](https://img.shields.io/github/issues/MayurJivani/Noggin?style=flat-square)](https://github.com/MayurJivani/Noggin/issues)
![Code size](https://img.shields.io/github/languages/code-size/MayurJivani/Noggin?style=flat-square)
[![Last commit](https://img.shields.io/github/last-commit/MayurJivani/Noggin?style=flat-square)](https://github.com/MayurJivani/Noggin/commits/main)
![buzzer](https://img.shields.io/badge/buzzer-millisecond%20ordered-e6b800?style=flat-square)
![arguments](https://img.shields.io/badge/arguments-settled%20by%20undo-8e44ad?style=flat-square)
![host hands](https://img.shields.io/badge/host%20hands-one%2C%20holding%20a%20mic-16a085?style=flat-square)

A quiz-board game show for a room with a TV and a pile of phones.

Write the board in the afternoon, put the big screen on the projector, let
everyone scan a QR, and run the night from one desk. Play solo or in **teams**.

```sh
npm install
npm run dev
```

Open the host desk at the **LAN address printed on startup**, not `localhost`,
or nothing else in the room can reach it.

Every screen, every rule and the reasoning behind each one is in
**[HOW-IT-WORKS.md](HOW-IT-WORKS.md)**. This page is the short version.

## The screens

| Where | Who | What |
| :--- | :--- | :--- |
| `/` | everyone | Front door: pick a role, or resume one of your saved games |
| `/host` | host | Build the quiz, then run it. Needs an account |
| `/display` | the TV | The board, the clue, the scores. Read-only |
| `/play` | every player | A room code, a name, and one enormous button |
| `/cards` | host, on a tablet | Cue cards: the clue, the answer, the verdict. Host-issued link |
| `/control` | second operator | The in-depth controller. Account or host-issued link |
| `/scores` | a second monitor | Every player at once: score, who's in, bets, call timer |
| `/podium` | one player's booth | Their name and their score, filling the screen |

`npm run dev` starts two processes:

| Port | What |
| :--- | :--- |
| 4331 | Astro, the pages above |
| 4332 | Relay: WebSocket game state, media upload/streaming, storage |

Both bind to `0.0.0.0` so anything on the same wifi can reach them.

## What it does

| | |
| :--- | :--- |
| [Buzzer race](HOW-IT-WORKS.md#how-the-buzzer-is-fair) | Server-timestamped, millisecond ordering, margins shown behind the winner |
| [Even out connections](HOW-IT-WORKS.md#evening-out-connections) | Optional: judge on reaction rather than broadband |
| [The host desk](HOW-IT-WORKS.md#the-host-desk) | Build and run on one page, with undo and editable scores |
| [Cue cards](HOW-IT-WORKS.md#the-cue-cards) | The clue, the hidden answer and the verdict, on a tablet |
| [Remote controller](HOW-IT-WORKS.md#the-remote-controller) | A second pair of hands, by link and QR |
| [Teams](HOW-IT-WORKS.md#teams) | Several phones, one score, one buzz |
| [Nitro tiles](HOW-IT-WORKS.md#the-host-desk) | Found rather than announced; stake before you see the clue |
| [The final clue](HOW-IT-WORKS.md#the-final-clue) | Blind bets, a written answer, poorest revealed first |
| [Tie-breaks](HOW-IT-WORKS.md#when-it-ends-level) | Sudden death that records a winner without inventing points |
| [The survey round](HOW-IT-WORKS.md#the-survey-round) | "We asked a hundred people", with a public page to actually ask them |
| [Media clues](HOW-IT-WORKS.md#media) | Image, audio and video, streamed from the relay |
| [CSV import](HOW-IT-WORKS.md#importing-from-a-spreadsheet) | Paste a spreadsheet instead of clicking forty tiles |
| [Saving and resuming](HOW-IT-WORKS.md#saving-a-game-for-later) | Autosaved, and a live room always beats its saved copy |
| [Reconnection](HOW-IT-WORKS.md#reconnection) | Same seat, name and score after a lock screen or a dead wifi |
| [Podium and scoreboard](HOW-IT-WORKS.md#podium-and-scoreboard-screens) | Read-only views for spare screens |

## Accounts

Hosting needs one; **playing never does**. A room full of people typing a four
letter code should not have to sign up first, so players stay anonymous and only
the person running the game has an account. What an account buys is ownership:
your boards and saved games are yours, and two hosts on the same server never
see each other's work.

**Signups close after the first account**, because this can be put on the open
internet and an open registration form there is an invitation. After that it
takes `NOGGIN_ALLOW_SIGNUP=1` to let anyone else register.

Sessions are an HttpOnly cookie holding a random token, stored only as its
SHA-256. Passwords go through scrypt from node's own crypto.

There is no password-reset email, so signing up hands you a **recovery code**,
once. It is spent on use, and using it turns out every session the account had.
If it is lost, issue a new one on the server:

```bash
node scripts/recovery-code.js you@example.com
```

## Storage

Boards and saved rooms go to **Postgres if `DATABASE_URL` is set, JSON files
otherwise**. The file backend is not a hedge: it's the difference between
"clone it and run a quiz tonight" and "clone it, install Postgres, then run a
quiz". The relay never knows which one it got, and prints its choice at boot.

```bash
psql "$DATABASE_URL" -f server/schema.sql        # create the tables first
DATABASE_URL=postgres://user:pass@localhost:5432/noggin npm run dev
```

`server/schema.sql` covers accounts, sessions, boards and rooms, and is safe to
re-run, including on a database created before accounts existed. If
`DATABASE_URL` is set but the tables are missing, the relay says so loudly and
falls back to files rather than failing halfway through a game.

## Tests

```sh
npm test
```

`tests/game.test.js` drives the rules engine directly: buzzer ordering,
penalties, scoring, Nitro wagers, round rollover, and what each role is allowed
to see. `tests/relay.test.js` boots a real relay and runs a round over real
sockets with a host, a big screen and two phones, then proves the parts that
matter once this is on a public URL: a stranger cannot list, read, resume or
delete your games, signed-out clients get nothing privileged, and a controller
key works until the host revokes it.

## Configuration

| Variable | Default | |
| :--- | :--- | :--- |
| `DATABASE_URL` | unset | Postgres connection string; unset means file storage |
| `NOGGIN_ALLOW_SIGNUP` | unset | `1` reopens registration after the first account |
| `NOGGIN_USER_DIR` | `./data/users` | accounts and sessions (file backend) |
| `NOGGIN_PORT` | 4332 | relay port |
| `NOGGIN_UPLOAD_DIR` | `./uploads` | clue media |
| `NOGGIN_DATA_DIR` | `./data/boards` | saved boards (file backend) |
| `NOGGIN_ROOM_DIR` | `./data/rooms` | saved games (file backend) |
| `NOGGIN_PLAYER_GRACE_MS` | 300000 | how long a dropped player keeps their seat |
| `NOGGIN_MAX_UPLOAD` | 26214400 | upload ceiling in bytes |
| `PUBLIC_WS_URL` | unset | override the relay origin (tunnels, reverse proxies) |

## Notes

- `package.json` pins an `overrides.vite` entry. Astro and `@tailwindcss/vite`
  otherwise resolve two different major versions of Vite and the CSS build
  fails; forcing one copy fixes it.
- Everything in `src/styles/global.css` lives inside `@layer base`. Tailwind 4
  declares `@layer theme, base, components, utilities`, and an *unlayered* rule
  beats every layered one regardless of specificity, so a bare
  `* { padding: 0 }` out there silently defeats every spacing utility in the
  app. Keep new global rules in a layer.
- With no `DATABASE_URL`, boards live in `data/boards/`, saved rooms in
  `data/rooms/`, uploads in `uploads/`. All gitignored.
- `PLAN.md` covers what's next, chiefly the remote controller at `/control`.

<div align="center">

<img src=".github/assets/noggin-d.webp" alt="Noggin's board on the TV: round one with Capitals, Planets, Elements, Instruments and Oceans, 200 to 1000 each, and three players at zero" width="100%">

# NOGGIN’

**A quiz show for a room full of phones. One TV, a real buzzer race.**

[Play it](https://noggin.futile.studio) · [How it works](HOW-IT-WORKS.md) · [Futile Studio](https://futile.studio)

[![live](https://img.shields.io/badge/live-noggin.futile.studio-0d0d0d?style=flat-square&labelColor=0b0b0b)](https://noggin.futile.studio)
![Astro](https://img.shields.io/badge/Astro-7-0b0b0b?style=flat-square&logo=astro)
![React](https://img.shields.io/badge/React-19-0b0b0b?style=flat-square&logo=react)
![Node](https://img.shields.io/badge/Node-22-0b0b0b?style=flat-square&logo=nodedotjs)
[![last commit](https://img.shields.io/github/last-commit/MayurJivani/Noggin?style=flat-square&labelColor=0b0b0b&color=0d0d0d)](https://github.com/MayurJivani/Noggin/commits/main)

</div>

> **Futile Studio · FS-002** · Games, party game · Live, 2026 · also in Futile Lab

## Overview

A quiz-board game show for a room with a TV and a pile of phones.

Write the board in the afternoon, put the big screen on the projector, let everyone scan a QR, and run the night from one desk. Play solo or in **teams**.

Every screen, every rule and the reasoning behind each one is in **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)**. This page is the short version.

<p align="center"><img src=".github/assets/noggin-d.webp" width="70%" alt="The board on the TV in room CXUQ, with Asha, Ben and Mira at zero"> <img src=".github/assets/noggin-m.webp" width="24%" alt="A player's phone: one big Buzz button and a Phone a Friend lifeline below"></p>

## The screens

| Where | Who | What |
| :--- | :--- | :--- |
| `/` | everyone | Front door: pick a role, or resume one of your saved games |
| `/host` | host | Build the quiz, then run it. Needs an account |
| `/display` | the TV | The board, the clue, the scores. Read-only |
| `/play` | every player | A room code, a name, and one enormous button. `?code=&name=` links join straight in |
| `/cards` | host, on a tablet | Cue cards: the clue, the answer, the verdict. Host-issued link |
| `/control` | second operator | The in-depth controller. Account or host-issued link |
| `/scores` | a second monitor | Every player at once: score, who's in, bets, call timer |
| `/podium` | one player's booth | Their name and their score, filling the screen |
| `/watch` | someone not in the room | The same stage as the TV, without the wake lock or the join tone |
| `/survey` | the public | The page for actually asking people the survey round questions |
| `/admin` | the one admin account | Password reset links, without a shell |

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
| [Media clues](HOW-IT-WORKS.md#media) | Image, audio and video, streamed from the relay. Deezer previews and YouTube clips by link, optional pause on buzz |
| [CSV import](HOW-IT-WORKS.md#importing-from-a-spreadsheet) | Paste a spreadsheet instead of clicking forty tiles |
| [Saving and resuming](HOW-IT-WORKS.md#saving-a-game-for-later) | Autosaved, and a live room always beats its saved copy |
| [Reconnection](HOW-IT-WORKS.md#reconnection) | Same seat, name and score after a lock screen or a dead wifi |
| [Podium and scoreboard](HOW-IT-WORKS.md#podium-and-scoreboard-screens) | Read-only views for spare screens |
| [Sound](HOW-IT-WORKS.md#sound) | Synthesised buzz, verdict and countdown. Sample soundboard is off until you add MP3s, see [public/sfx/README.md](public/sfx/README.md) |

## Stack

- [Astro](https://astro.build) 7 with React 19 islands and Tailwind 4 for the pages
- A Node relay (`server/index.js`) on [`ws`](https://github.com/websockets/ws): WebSocket game state, the API, media upload and streaming, storage
- Postgres via [`postgres`](https://github.com/porsager/postgres) when `DATABASE_URL` is set, JSON files otherwise
- `qrcode` for the join QR
- Tests on `node --test`, no extra test framework

## Running it locally

Needs Node 22.12 or newer (see `engines` in `package.json`).

```sh
npm install
npm run dev
```

Open the host desk at the **LAN address printed on startup**, not `localhost`, or nothing else in the room can reach it.

`npm run dev` starts two processes:

| Port | What |
| :--- | :--- |
| 4331 | Astro, the pages above |
| 4332 | Relay: WebSocket game state, media upload/streaming, storage |

Both bind to `0.0.0.0` so anything on the same wifi can reach them. `npm run dev:web` and `npm run dev:relay` start them one at a time.

In production the relay also serves the built site from `dist/`, so the whole app is one process on one port:

```sh
npm run build
node server/index.js
```

Or with Docker, which does the same thing in one container on port 4332:

```sh
docker compose up -d --build
```

## Accounts

Hosting needs one; **playing never does**. A room full of people typing a four letter code should not have to sign up first, so players stay anonymous and only the person running the game has an account. What an account buys is ownership: your boards and saved games are yours, and two hosts on the same server never see each other's work.

**Signups close after the first account**, because this can be put on the open internet and an open registration form there is an invitation. After that it takes `NOGGIN_ALLOW_SIGNUP=1` to let anyone else register.

Sessions are an HttpOnly cookie holding a random token, stored only as its SHA-256. Passwords go through scrypt from node's own crypto.

There is no password-reset email, so signing up hands you a **recovery code**, once. It is spent on use, and using it turns out every session the account had. If it is lost, issue a new one on the server:

```bash
node scripts/recovery-code.js you@example.com
```

In the Docker image that is `docker compose exec noggin node scripts/recovery-code.js you@example.com`. The admin account (hardcoded in `server/index.js`) can also mint a reset link for someone at `/admin`.

## Storage

Boards and saved rooms go to **Postgres if `DATABASE_URL` is set, JSON files otherwise**. The file backend is not a hedge: it's the difference between "clone it and run a quiz tonight" and "clone it, install Postgres, then run a quiz". The relay never knows which one it got, and prints its choice at boot.

```bash
psql "$DATABASE_URL" -f server/schema.sql        # create the tables first
DATABASE_URL=postgres://user:pass@localhost:5432/noggin npm run dev
```

`server/schema.sql` covers accounts, sessions, boards and rooms, and is safe to re-run, including on a database created before accounts existed. If `DATABASE_URL` is set but the tables are missing, the relay says so loudly and falls back to files rather than failing halfway through a game.

With no `DATABASE_URL`, boards live in `data/boards/`, saved rooms in `data/rooms/`, uploads in `uploads/`. All gitignored. Saved games are swept after 30 days by default.

## Configuration

Copy `.env.example` to `.env`. Everything is optional: with nothing set, Noggin runs on file storage and default ports.

| Variable | Default | |
| :--- | :--- | :--- |
| `DATABASE_URL` | unset | Postgres connection string; unset means file storage |
| `NOGGIN_ALLOW_SIGNUP` | unset | `1` reopens registration after the first account |
| `NOGGIN_PORT` | 4332 | relay port |
| `NOGGIN_PLAYER_GRACE_MS` | 300000 | how long a dropped player keeps their seat |
| `NOGGIN_MAX_UPLOAD` | 26214400 | upload ceiling in bytes |
| `NOGGIN_ROOM_TTL_MS` | 30 days | how long a saved game is kept; `0` keeps everything |
| `NOGGIN_TRUST_PROXY` | unset | `1` reads `X-Forwarded-For` for rate limiting (only behind a proxy you control) |
| `NOGGIN_UPLOAD_DIR` | `./uploads` | clue media |
| `NOGGIN_DATA_DIR` | `./data/boards` | saved boards (file backend) |
| `NOGGIN_ROOM_DIR` | `./data/rooms` | saved games (file backend) |
| `NOGGIN_RESULT_DIR` | `./data/results` | results (file backend) |
| `NOGGIN_CLUE_DIR` | `./data/clues` | clues (file backend) |
| `NOGGIN_USER_DIR` | `./data/users` | accounts and sessions (file backend) |
| `NOGGIN_DIST_DIR` | `./dist` | built site the relay serves in production |
| `PUBLIC_WS_URL` | unset | override the relay origin (tunnels, reverse proxies) |

## Tests

```sh
npm test
```

`tests/game.test.js` drives the rules engine directly: buzzer ordering, penalties, scoring, Nitro wagers, round rollover, and what each role is allowed to see. `tests/relay.test.js` boots a real relay and runs a round over real sockets with a host, a big screen and two phones, then proves the parts that matter once this is on a public URL: a stranger cannot list, read, resume or delete your games, signed-out clients get nothing privileged, and a controller key works until the host revokes it.

There is also a load test: one host and N phones in one room against a real relay, reporting join time, state fan-out, buzz round trips and the relay's CPU and memory.

```sh
npm run loadtest -- 1000
```

## Deployment

The live site runs the GHCR image built by `.github/workflows/image.yml` on every push to `main`. `deploy/` holds the compose file, Caddy site block and the box-side `deploy.sh` for that setup.

## Notes

- `package.json` pins an `overrides.vite` entry. Astro and `@tailwindcss/vite` otherwise resolve two different major versions of Vite and the CSS build fails; forcing one copy fixes it.
- Everything in `src/styles/global.css` lives inside `@layer base`. Tailwind 4 declares `@layer theme, base, components, utilities`, and an *unlayered* rule beats every layered one regardless of specificity, so a bare `* { padding: 0 }` out there silently defeats every spacing utility in the app. Keep new global rules in a layer.

## Roadmap

[PLAN.md](PLAN.md) has everything shipped so far and the ideas list. Nothing is ranked as next. Unranked ideas written down there: team chat for remote quizzes, typed answers judged by the host, and multiple choice clues on the phones.

## Licence

No licence file yet, all rights reserved.

---

<p align="center"><sub>Built by <a href="https://github.com/MayurJivani">Mayur Jivani</a> at <a href="https://futile.studio">Futile Studio</a>. Everything is futile. Do it anyway.</sub></p>

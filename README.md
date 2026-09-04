# NOGGIN’

A quiz-board game show for a room with a TV and a pile of phones.

Write the board in the afternoon, put the big screen on the projector, let
everyone scan a QR, and run the night from one desk. Categories, point ladders,
image, audio and video clues, Noggin’ Nitro tiles, a real buzzer race with
millisecond ordering, a Phone a Friend lifeline, and a soundboard for the bits
between the questions. Play solo or in **teams**.

```sh
npm install
npm run dev
```

Open the host desk at the **LAN address printed on startup** — not `localhost`,
or nothing else in the room can reach it.

## The screens

| Where | Who | What |
| :--- | :--- | :--- |
| `/` | everyone | Front door — pick a role, or resume one of your saved games |
| `/host` | host | Build the quiz, then run it. Needs an account |
| `/display` | the TV | The board, the clue, the scores — read-only |
| `/play` | every player | A room code, a name, and one enormous button |
| `/control` | second operator | The in-depth controller. Account or host-issued link |
| `/scores` | a second monitor | Every player at once: score, who's in, bets, call timer |
| `/podium` | one player's booth | Their name and their score, filling the screen |

`npm run dev` starts two processes:

| Port | What |
| :--- | :--- |
| 4331 | Astro — the pages above |
| 4332 | Relay — WebSocket game state, media upload/streaming, storage |

Both bind to `0.0.0.0` so anything on the same wifi can reach them.

## Accounts

Hosting needs one; **playing never does**. A room full of people typing a four
letter code should not have to sign up first, so players stay anonymous and only
the person running the game has an account.

What an account buys is ownership. Your saved games and your boards are yours:
nobody who wanders onto the URL can list them, resume them, read your clues, or
take the host seat. Two hosts on the same server never see each other's work.

**Signups close after the first account.** This thing can be put on the open
internet, and an open registration form there is an invitation. The first person
through the door gets in; after that it takes `NOGGIN_ALLOW_SIGNUP=1` to let
anyone else register.

Sessions are an HttpOnly cookie holding a random token; only its SHA-256 is
stored, so a leaked database does not hand over live sessions. Passwords go
through scrypt from node's own crypto — no native module to build.

## The remote controller

One person cannot comfortably read a clue aloud, watch five faces, and drive a
board at the same time. `/control` is the second pair of hands: the host keeps
the questions and the verdict, and whoever holds the controller runs the grid,
the buzzer, the scores, the lifelines and the clock.

It is laid out for a phone or tablet held in one hand — big targets, no hover,
and the two urgent controls (arm the buzzer, rule on whoever is holding it)
pinned under the thumb.

Two ways in:

- **You**, signed into your own account, opening `/control` and typing the code.
- **Someone else**, via a link (and QR) the host generates from the desk. The key is
  minted on demand, lives only in the relay's memory, and dies with the room —
  it works tonight and not next Tuesday. **Create a controller link** on the
  host desk copies it; **revoke** kicks any controller using it.

## Podium and scoreboard screens

Two read-only views for spare screens, both joining as viewers — so they are
under exactly the same redaction as the big screen and never learn an unplayed
clue or a blind final wager.

**`/podium`** is the screen that stands in front of a contestant: their name
banded across the top, their score filling the middle. Everything else it knows
how to say — buzzed in, on the phone with the clock running, what they staked —
is said by lighting the whole panel, because from across a room a badge is
invisible and a colour is not. Open one per seat from the **▭** button beside
each player on the host desk; it remembers which player it is showing, so a
reload doesn't mean re-picking five tablets.

**`/scores`** is all of them at once, for a control desk or a second monitor:
ranked cards, who is in and by what margin, whose phone call is running, and who
has bet what.

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
tiles as **Noggin’ Nitro** by hand, or hit **✦ Scatter Nitro** to place them the
way the show does. A Nitro tile is found rather than announced: whoever picks it
stakes part of their score before seeing the clue, alone, with no buzzer race.
Win and you gain the wager, miss and you lose it — so staking everything is what
doubles your score, which is the whole appeal of finding one. Everything autosaves to the relay — closing the tab at 1am doesn't
cost you the quiz. Export drops a `.noggin.json` you can mail to someone.

Boards can be opened, **duplicated** (⧉ — next month's quiz usually starts as
this month's skeleton, with fresh ids so the copy is its own record) or deleted.
Rounds are deleted from an ✕ on the round tab you're looking at; the last
remaining round has no ✕, since a board with no rounds is not a board.

**Run** is the desk during the show:

- The mini board on the left is how you pick. The big screen follows.
- **Arm** opens the buzzer. First press wins; everyone else's press is still
  recorded with its margin, so a photo finish can be settled by eye.
- **Correct** / **Wrong** rules on the player holding the floor. A miss deducts
  and reopens the buzzer for everyone who hasn't answered yet.
- **↻ Everyone again** appears once people are out, and turns gold when *all*
  of them are. Arming cannot help at that point — a player who has answered is
  out for the rest of the clue, so the buzzer would open with nobody able to
  press it. This clears who is out and opens it in one move.
- **▸** beside a score opens that player's history: every change, what it was
  for, and the running total. "Why am I on 400?" now has an answer.
- Any score can be corrected by clicking it. Hosts make mistakes and arguing
  with software in front of an audience is not an option.
- ☎ grants Phone a Friend. Players can ask from their phone; you still decide.
- **↩ Undo** takes back the last ruling — the score, the spent player, the
  buzzer and the tile all go back to where they were. ✓ and ✕ are two adjacent
  buttons pressed under pressure while talking, and fixing a mis-tap by hand
  means editing three things separately in front of an audience.

The **Room** menu in the header switches between your games, starts new ones,
and deletes any of them — not only the one you are on. Deleting ends the live
game and removes the saved copy: everyone in it is disconnected and told why.
The same ✕ is on each game on the front page.

Keys, because the other hand is holding a microphone:

| | |
| :--- | :--- |
| <kbd>space</kbd> | arm / lock the buzzer |
| <kbd>y</kbd> <kbd>n</kbd> | correct / wrong |
| <kbd>r</kbd> | reveal the answer |
| <kbd>p</kbd> | pause / resume the room |
| <kbd>enter</kbd> | next clue |
| <kbd>esc</kbd> | reset the buzzer race |
| <kbd>⌘/ctrl</kbd>+<kbd>z</kbd> | undo the last ruling |

## The final clue

Off by default; switch it on from the **✦ Final** tab in the builder. It plays
the way the show does, and nothing like the rest of the game:

1. **Bets.** The category goes up, the clue does not. Everyone still in the
   black stakes part of their score on their phone. A bet is blind — the relay
   never shows one player another's, and neither does the big screen.
2. **Writing.** The clue appears and a clock runs. Answers are typed and locked
   when the host stops the clock or the time runs out.
3. **The reveal.** The host turns players over one at a time, poorest first,
   because revealing the leader early spoils the arithmetic for the room. Each
   ruling pays or docks that player's own bet.

Anyone on a non-positive score sits it out — there is nothing to stake — and
anyone who never bets is staked at nothing rather than holding the room up.

## Importing from a spreadsheet

Almost nobody writes forty clues by clicking forty tiles. **CSV** in the builder
takes a paste or a file:

```
category,value,clue,answer,daily
STONE,200,"Black, veined with gold",marble,
STONE,400,Formed under pressure,diamond,yes
METALS,200,Au,gold,
```

Categories become columns in the order they first appear and values become rows,
low to high. A header row is optional, tabs work as well as commas (which is
what a spreadsheet paste gives you), and quoted commas inside a clue survive.
Bad rows are reported by line number rather than failing the file — you get told
which two of forty are wrong. Nothing is replaced until you confirm the preview.

## How the buzzer is fair

The relay is the referee. A phone never decides anything — it sends "I pressed"
and the server timestamps arrival, over an open WebSocket. Nothing on that path
polls or waits for an interval. On a LAN that's a couple of milliseconds of
jitter against human reaction times of two hundred.

The transport is tuned for it: Nagle's algorithm is off (it would hold a press
back up to 40ms waiting for data that never comes), compression is off (deflate
costs more than it saves on a 300-byte frame), and the relay serialises each
state once per *view* rather than once per socket.

The race list shows margins behind the winner — `+40ms` — rather than time since
the buzzer opened, which is mostly a measure of how long the host talked.

**A press is never silently lost.** If the socket happens to be down, the buzz is
queued and sent the moment it reconnects, and dropped if two seconds pass —
arriving late would enter a race that is already over. The button says so rather
than looking dead.

**It works on the browsers people actually have.** Pointer *and* touch are both
handled, since the in-app browsers links open in do not all implement Pointer
Events. Nothing the buzzer needs depends on `localStorage`, which Safari lets
you read and then refuses to write in Private Browsing — storage here only
remembers a seat, so it degrades to a no-op instead of taking the page down.

Pressing **before** the host arms costs a short lockout (500ms by default), so
mashing the button from the moment a clue appears gains nothing. Losing the race
by 60ms is *not* the same offence and costs nothing.

**Arm the buzzer automatically** opens it with the clue instead of waiting for
you. Pair it with a **reading time** so the room hears the question before the
race starts — at zero it opens the instant the clue appears, which rewards
whoever is fastest rather than whoever knows it.

Answers are never sent to a client that shouldn't have them. The big screen and
the players' phones both receive the board with every unplayed clue's text,
answer and daily-double flag stripped out; the live clue's answer arrives only
when the host reveals it. Opening devtools on the TV gets you nothing.

## Teams

Turn on **Play in teams** in the builder's game rules. Several phones then share
one score, one lifeline purse and — the part that matters — **one buzz**.

The rule that keeps it honest is that the buzzer thinks in *sides*, not seats. A
team gets one entry in the race however many phones it fields, and a wrong
answer puts the whole team out of the clue rather than letting them work through
their members until someone guesses right. Otherwise the biggest team simply
wins.

- Two teams appear when you switch it on, and phones are seated on the smallest
  as they arrive — nobody is ever left unable to buzz for anyone.
- **⇄ Even up** deals everyone out in the order they joined. Deliberately not a
  shuffle: you are looking at the roster while you press it, and a reshuffle
  that moves people you already placed reads as the button having gone wrong.
- Rename a team by clicking its name. Move someone with the dropdown on their
  chip — no drag, because half of this is driven on a tablet.
- Deleting a team leaves its players in the game, off the sheet until you give
  them a side.
- Switching team mode on mid-game carries what people have already won onto the
  side they now play for. Switching it off and on again does not re-add it.
- The final is played by sides too: one blind bet, one answer slip, one reveal
  per team, and any member can write it — but only their own team sees it before
  the host turns them over.

Every screen follows: the big screen, the podiums and the scoreboard show teams
with their members listed underneath, and a player's own phone shows the team
name above the score so they know whose number is moving.

## Pause

<kbd>p</kbd>, or **❚❚ Pause** on the desk and **❚❚ Hold** on the controller.
Quizzes stop — someone gets a drink, an argument breaks out, the pizza arrives.

The buzzer shuts, the big screen covers the board with a PAUSED card, and any
running countdown is **banked rather than cancelled**: resuming gives back
exactly the time that was left, so a break doesn't quietly cost whoever had
buzzed the seconds they were owed. Putting a new clue up counts as resuming.

## Media

Drop an image, an audio file or a video clip onto a clue in the builder. It
uploads to the relay so every device streams from one place, and the board only
ever stores a path — a phone resolves it against a host it can actually reach.

Audio clues get a visualiser on the big screen so the room can tell something is
happening. Video autoplays on the big screen with its controls left on, so the
host can replay a clip the room asks to see again. It does *not* autoplay on
players' phones: everyone is looking at the TV, and a dozen handsets each a
second out of step is the worst possible outcome. Files are served with range
support, so scrubbing works and Safari will play them at all.

Uploads cap at 25MB (`NOGGIN_MAX_UPLOAD`).

On the big screen the clue **fits, always, without scrolling** — nobody scrolls
a projector. The words and the answer take the height they need and the picture
takes whatever is left, so revealing an answer shrinks the image rather than
pushing it off the bottom. Sizing media in `vh` was the bug: it knows the height
of the window, not the height of the gap between a three-line clue and a
revealed answer.

## The buzzer screen

Fixed to the window, never scrolled. A phone that has to be scrolled to reach
the buzzer is a phone that loses the race, so the header, the mirrored clue and
the footer take only what they need and the button gets the rest.

The mirrored clue has a **hide** toggle (and a *show clue* link in the footer to
bring it back). It is per-device and remembered: the person at the back who
can't see the TV wants it, everyone else would rather have the extra inch of
buzzer, and the button grows when it is off. It costs nobody anything to turn
on, because what a phone receives is already redacted — an answer only appears
there once the host has put it on the big screen and the whole room can see it.

## Reconnection

Everything survives a reload, and everything survives the network going away.
The room owns the game state, not the host tab.

A phone that walks out of range does not get a close event — the socket simply
stops carrying anything, and a browser can sit on that for minutes. So the
client pings every 5s and treats 12s of silence as death, rather than trusting a
socket that still claims to be open. On a buzzer, "connected" being a lie is the
worst failure there is, because the player has no reason to doubt it.

Coming back is immediate rather than backed off: the first retry has no delay,
and `online`, `pageshow` and the tab becoming visible all trigger a reconnect at
once — each is a better signal than a timer, and each is the moment someone is
about to look at their buzzer again. Players see their round-trip time, so
"is it me or the wifi?" has an answer.

- A player who locks their screen or drops off wifi comes back to the same seat,
  name and score for five minutes. That works from the id their phone remembers,
  and failing that from their **name** — a cleared browser, a private tab or a
  different phone entirely still gets them their score back, because a name
  matching a seat nobody is sitting in is that person returning. A seat someone
  is *currently* holding is never handed over; a second real Alice becomes
  "Alice 2" rather than inheriting the first one's points.
- The host desk reopens the game it was last on. Its address carries the room
  code, so a reload rejoins rather than starting again — new games only ever
  come from **+ Start a new game**.
- The big screen holds no state at all and can be reloaded mid-clue.
- The host desk rejoins the room code it opened last, rather than minting a new
  one that's already on a projector and in five phones.

## Sound

Two layers, and the split is deliberate.

**Samples** are what the room hears. Real recordings in `public/sfx/`, all CC0 —
applause, ovation, crowd, drumroll, fanfare, airhorn, ta-da, ding, gong, sad
trombone, boo, laugh, crickets, whoosh, wrong-buzzer, and a bossa-nova music
bed. Oscillators can imitate a bell but not a crowd; a synthesised "round of
applause" is static with ambitions. Provenance is in
[`public/sfx/CREDITS.md`](public/sfx/CREDITS.md).

**Synthesis** covers the tight, latency-critical cues — the buzz-in, the
early-press reject, the countdown tick — where the sound has to land with the
press and a decode is a risk not worth taking. It is also the fallback for every
sample: **delete the whole `sfx/` folder and the game still makes all its
noises**, just plainer.

Three things come out of it:

- **Game cues** fire themselves: the tile, the buzz, the verdict, the clock,
  the Nitro fanfare, the gong into the final, an ovation when the game ends.
- **The soundboard** is fired by hand from the desk or the controller — fifteen
  buttons for the bits between the questions.
- **The music bed** (♪) fills the lobby and the dead air, and ducks under a clue
  rather than stopping, so it doesn't restart on every tile. It is the one file
  fetched lazily: a room that never turns music on never pays the megabyte.

Cues play on the **big screen** — that is where the speakers the room can hear
are, and a cue coming out of the host's laptop is a cue only the host enjoys. A
cue is a broadcast and changes nothing about the game; the music is *state*, so
a display that reloads mid-round comes back with it still playing.

Browsers won't start audio without a gesture, so the big screen arms itself on
the first click anywhere and preloads every short sample then.

**Swapping a sound**: drop an MP3 into `public/sfx/` with the same filename. It
wins, and nothing else changes.

## Tests

```sh
npm test
```

`tests/game.test.js` drives the rules engine directly — buzzer ordering,
penalties, scoring, Nitro wagers, round rollover, and what each role is allowed
to see. `tests/relay.test.js` boots a real relay and runs a round over real
sockets with a host, a big screen and two phones, then proves the parts that
matter once this is on a public URL: a stranger cannot list, read, resume or
delete your games, signed-out clients get nothing privileged, and a controller
key works until the host revokes it.

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

`server/schema.sql` covers accounts, sessions, boards and rooms, and is safe to
re-run — including on a database created before accounts existed, which it
upgrades in place. Boards and
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
| `NOGGIN_ALLOW_SIGNUP` | — | `1` reopens registration after the first account |
| `NOGGIN_USER_DIR` | `./data/users` | accounts and sessions (file backend) |
| `NOGGIN_PORT` | 4332 | relay port |
| `NOGGIN_UPLOAD_DIR` | `./uploads` | clue media |
| `NOGGIN_DATA_DIR` | `./data/boards` | saved boards (file backend) |
| `NOGGIN_ROOM_DIR` | `./data/rooms` | saved games (file backend) |
| `NOGGIN_PLAYER_GRACE_MS` | 300000 | how long a dropped player keeps their seat |
| `NOGGIN_MAX_UPLOAD` | 26214400 | upload ceiling in bytes |
| `PUBLIC_WS_URL` | — | override the relay origin (tunnels, reverse proxies) |

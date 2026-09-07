# Sounds

Empty on purpose. The soundboard and the music bed are **off** until someone
chooses what they should sound like — see `SAMPLES_ENABLED` at the top of
`src/lib/sfx.js`.

Nothing is broken in the meantime. Every sample has a synthesised stand-in, so
the game still makes its own noises: the buzz-in, the early-press reject, the
verdict, the countdown, the Nitro. Those are oscillators and always were, and
the fast ones will stay that way — a buzz-in has to land *with* the press, and a
decode is a risk not worth taking there.

## Turning it on

1. Drop MP3s in this folder, named for the ids below.
2. Set `SAMPLES_ENABLED = true` in `src/lib/sfx.js`.

That is the whole change. The soundboard reappears on the host desk and the
controller, and the ♪ bed becomes available.

| id | where it plays |
| :--- | :--- |
| `applause` | soundboard · end of a round |
| `ovation` | soundboard · end of the game |
| `cheer` | soundboard |
| `drumroll` | soundboard |
| `fanfare` | soundboard · Noggin' Nitro |
| `airhorn` | soundboard |
| `tada` | soundboard · correct answer |
| `ding` | soundboard |
| `gong` | soundboard · into the final |
| `trombone` | soundboard |
| `boo` | soundboard |
| `laugh` | soundboard |
| `crickets` | soundboard |
| `whoosh` | soundboard · board opening, round starting |
| `buzzer` | soundboard · wrong answer |
| `music` | the bed — loops, ducks under a clue, fetched only when turned on |

Ids are the keys of `SAMPLES` in `src/lib/sfx.js`, which is also the soundboard
roster. Adding a row there and a matching file is enough to add a button.

A missing file is not an error: it falls back to the stand-in, and is only asked
for once. So a partial set is fine — ship the four you care about and leave the
rest synthesised.

## Licensing

Whatever goes in here ships with the app and is served to every device in the
room, so it needs to be something you have the right to distribute. CC0 or
public domain avoids the question entirely.

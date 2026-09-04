# Sound credits

Every file in this folder is **CC0 1.0 Universal** (public domain dedication):
no attribution required, free for commercial use. Credited here anyway, because
knowing where a file came from is the difference between being able to replace
it and having to guess.

| File | Source | Item |
| :--- | :--- | :--- |
| `applause.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Applause* |
| `ovation.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *long applause* |
| `cheer.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Crowd* |
| `drumroll.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *drumming intro* |
| `fanfare.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *trumpet intro* |
| `tada.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Tada!* |
| `ding.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *dinnerbell* |
| `gong.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Gong* |
| `trombone.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Trombones* |
| `boo.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *boo! 1* |
| `laugh.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *LargeLaugh* |
| `crickets.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *crickets* |
| `whoosh.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Whoosh* |
| `buzzer.mp3` | archive.org | [`Sound_Effects`](https://archive.org/details/Sound_Effects) — *Wrong* |
| `airhorn.mp3` | archive.org | [`bbt_sfx`](https://archive.org/details/bbt_sfx) — *mode_campaign_airhorn* |
| `music.mp3` | archive.org | [`8bitBossa`](https://archive.org/details/8bitBossa) — *8bit Bossa* |

The CC0 dedication here is the one declared by the uploader on archive.org.
That is the strongest signal available without a chain of custody for each
recording — fine for a quiz night, worth checking yourself before putting any
of it in something commercial.

## Replacing any of them

Drop an MP3 in with the same filename and it wins — nothing else needs
changing, and the file is fetched from `/sfx/<id>.mp3` at runtime. The ids are
the keys of `SAMPLES` in `src/lib/sfx.js`, which is also the soundboard roster.

Delete a file and the game keeps working: every sample has a synthesised
stand-in behind it, so a missing file costs you the recording, not the cue.

`music.mp3` is the bed and is expected to loop seamlessly-ish; it is fetched
only when someone actually turns the music on.

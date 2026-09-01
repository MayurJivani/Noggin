-- Noggin schema.
--
--   psql "$DATABASE_URL" -f server/schema.sql
--
-- Safe to re-run: everything is IF NOT EXISTS.
--
-- Both tables keep the interesting parts in jsonb rather than shredding a board
-- into category and clue tables. A board is always read and written whole — it
-- is one document that one host edits — so normalising it would buy joins
-- nobody performs and cost a migration every time a clue grows a field. The
-- columns alongside `data` exist only so the pickers can list and sort without
-- parsing every document.

CREATE TABLE IF NOT EXISTS noggin_boards (
  id          text PRIMARY KEY,
  title       text        NOT NULL DEFAULT 'Untitled Game',
  data        jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noggin_boards_updated_at_idx
  ON noggin_boards (updated_at DESC);

-- A saved room is a game paused mid-flight: the board as it stood, who was
-- playing, what they had scored, and which tiles were already spent. Buzzer and
-- timer state is deliberately not stored — a game resumes at rest, never with a
-- countdown that expired three days ago.
CREATE TABLE IF NOT EXISTS noggin_rooms (
  code        text PRIMARY KEY,
  title       text        NOT NULL DEFAULT 'Untitled Game',
  phase       text        NOT NULL DEFAULT 'lobby',
  round_index integer     NOT NULL DEFAULT 0,
  players     integer     NOT NULL DEFAULT 0,
  data        jsonb       NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noggin_rooms_saved_at_idx
  ON noggin_rooms (saved_at DESC);

-- Noggin schema.
--
--   psql "$DATABASE_URL" -f server/schema.sql
--
-- Safe to re-run: everything is IF NOT EXISTS.
--
-- Boards and rooms keep the interesting parts in jsonb rather than shredding a
-- board into category and clue tables. A board is always read and written whole
-- — it is one document that one host edits — so normalising it would buy joins
-- nobody performs and cost a migration every time a clue grows a field. The
-- columns alongside `data` exist only so the pickers can list and sort without
-- parsing every document.

-- Host accounts. Players never have one: asking a room full of people to sign
-- up before pressing a buzzer would ruin the thing this is for.
CREATE TABLE IF NOT EXISTS noggin_users (
  id            text PRIMARY KEY,
  email         text        NOT NULL UNIQUE,
  name          text        NOT NULL DEFAULT '',
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only the SHA-256 of each token is stored, so a leaked table does not hand
-- over live sessions.
CREATE TABLE IF NOT EXISTS noggin_sessions (
  token_hash text        PRIMARY KEY,
  user_id    text        NOT NULL REFERENCES noggin_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noggin_sessions_user_idx    ON noggin_sessions (user_id);
CREATE INDEX IF NOT EXISTS noggin_sessions_expires_idx ON noggin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS noggin_boards (
  id          text PRIMARY KEY,
  owner_id    text        REFERENCES noggin_users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT 'Untitled Game',
  data        jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noggin_boards_updated_at_idx ON noggin_boards (updated_at DESC);
CREATE INDEX IF NOT EXISTS noggin_boards_owner_idx      ON noggin_boards (owner_id);

-- A saved room is a game paused mid-flight: the board as it stood, who was
-- playing, what they had scored, and which tiles were already spent. Buzzer and
-- timer state is deliberately not stored — a game resumes at rest, never with a
-- countdown that expired three days ago.
CREATE TABLE IF NOT EXISTS noggin_rooms (
  code        text PRIMARY KEY,
  owner_id    text        REFERENCES noggin_users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT 'Untitled Game',
  phase       text        NOT NULL DEFAULT 'lobby',
  round_index integer     NOT NULL DEFAULT 0,
  players     integer     NOT NULL DEFAULT 0,
  data        jsonb       NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noggin_rooms_saved_at_idx ON noggin_rooms (saved_at DESC);
CREATE INDEX IF NOT EXISTS noggin_rooms_owner_idx    ON noggin_rooms (owner_id);

-- Upgrading a database created before accounts existed.
ALTER TABLE noggin_boards ADD COLUMN IF NOT EXISTS owner_id text REFERENCES noggin_users(id) ON DELETE CASCADE;
ALTER TABLE noggin_rooms  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES noggin_users(id) ON DELETE CASCADE;

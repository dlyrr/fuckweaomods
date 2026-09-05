-- Idempotent on purpose: re-running this never drops your comments.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT    NOT NULL
);

-- newest-first listing + keyset cursor
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at DESC, id DESC);

-- rate limit lookup: most recent row for one hash
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  name_lower TEXT    NOT NULL UNIQUE,
  pass_hash  TEXT    NOT NULL,
  salt       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT    NOT NULL
);

-- signup throttle: how many accounts this hash made recently
CREATE INDEX IF NOT EXISTS idx_users_ip ON users (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,   -- sha-256 of the cookie value, never the value itself
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

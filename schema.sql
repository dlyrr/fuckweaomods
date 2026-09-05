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

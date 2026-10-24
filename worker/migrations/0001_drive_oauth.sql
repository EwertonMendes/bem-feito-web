-- One connection per Firebase UID, scoped to this environment's D1 database.
CREATE TABLE IF NOT EXISTS drive_connections (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  google_subject TEXT NOT NULL,
  google_email TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  encrypted_access_token TEXT,
  access_token_expires_at INTEGER NOT NULL DEFAULT 0,
  access_token_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected','reconnect_required','revocation_pending')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  refresh_lease_id TEXT,
  refresh_lease_until INTEGER NOT NULL DEFAULT 0,
  refresh_retry_after INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  firebase_email TEXT NOT NULL,
  firebase_google_sub TEXT NOT NULL,
  encrypted_state TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  launch_hash TEXT UNIQUE,
  browser_hash TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tx_uid ON oauth_transactions(owner_uid,created_at);
CREATE INDEX IF NOT EXISTS oauth_tx_expiry ON oauth_transactions(expires_at);

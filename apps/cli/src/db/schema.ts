/** SQLite schema generation 1 — Phase 1 vertical slice. */

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  issuer TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_sessions (
  client_session_id TEXT PRIMARY KEY NOT NULL,
  device_public_key_pem TEXT NOT NULL,
  device_public_key_fingerprint TEXT NOT NULL,
  label TEXT,
  scopes_json TEXT NOT NULL,
  refresh_family_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_sessions_refresh_hash
  ON client_sessions(refresh_hash);

CREATE TABLE IF NOT EXISTS refresh_reuse_log (
  refresh_hash TEXT PRIMARY KEY NOT NULL,
  client_session_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_tickets (
  ticket_id TEXT PRIMARY KEY NOT NULL,
  ticket_hash TEXT NOT NULL UNIQUE,
  client_session_id TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  proof_thumbprint TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_session_id) REFERENCES client_sessions(client_session_id)
);

CREATE TABLE IF NOT EXISTS idempotency_receipts (
  client_identity TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_payload_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client_identity, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS environment_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  timestamp INTEGER NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  causation_request_id TEXT,
  environment_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terminals (
  terminal_id TEXT PRIMARY KEY NOT NULL,
  cwd TEXT NOT NULL,
  title TEXT,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  exited_at INTEGER,
  exit_code INTEGER
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  repo_identity TEXT,
  opened_at INTEGER,
  last_active_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  transcript_json TEXT NOT NULL,
  pending_interaction_json TEXT,
  provider_resume TEXT,
  cwd TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS control_leases (
  resource_key TEXT PRIMARY KEY NOT NULL,
  lease_id TEXT NOT NULL,
  resource_json TEXT NOT NULL,
  holder_client_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  epoch TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collaboration_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  environment_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT,
  mailbox TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Phase 3: Harness installation catalog (intent + readiness; secrets by ref only).
CREATE TABLE IF NOT EXISTS harness_installations (
  harness_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'disabled',
  runtime_version TEXT,
  command TEXT,
  config_json TEXT,
  secret_ref TEXT,
  diagnostic_code TEXT,
  diagnostic_message TEXT,
  last_probed_at INTEGER,
  updated_at INTEGER NOT NULL
);
`

export const SCHEMA_GENERATION = 1

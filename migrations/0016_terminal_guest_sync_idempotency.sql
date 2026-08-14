-- terminal guest sync idempotency claims
-- Existing guests are left untouched; new requests claim a venue-scoped key.

CREATE TABLE terminal_guest_sync_requests (
  venue_id TEXT NOT NULL REFERENCES venues(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  guest_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (venue_id, request_id)
);

CREATE INDEX idx_terminal_guest_sync_requests_created
  ON terminal_guest_sync_requests(created_at);

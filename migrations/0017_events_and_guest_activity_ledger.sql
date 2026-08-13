-- Event foundation and immutable guest activity ledger.
-- Existing date-based rows remain nullable and are linked by an explicit dry-run/backfill step.

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  business_date TEXT NOT NULL,
  name TEXT NOT NULL,
  door_opens_at TEXT,
  guest_cutoff_at TEXT,
  capacity INTEGER,
  target_guests INTEGER,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'open', 'closed', 'archived')),
  template_source_event_id TEXT REFERENCES events(id),
  compatibility_key TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  updated_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (capacity IS NULL OR capacity > 0),
  CHECK (target_guests IS NULL OR target_guests >= 0),
  CHECK (capacity IS NULL OR target_guests IS NULL OR target_guests <= capacity)
);

CREATE INDEX idx_events_venue_business_date
  ON events(venue_id, business_date);

CREATE INDEX idx_events_venue_state_business_date
  ON events(venue_id, state, business_date);

CREATE UNIQUE INDEX idx_events_compatibility_key
  ON events(compatibility_key);

ALTER TABLE external_dj_links
  ADD COLUMN event_id TEXT REFERENCES events(id);

ALTER TABLE guests
  ADD COLUMN event_id TEXT REFERENCES events(id);

ALTER TABLE guest_limit_requests
  ADD COLUMN event_id TEXT REFERENCES events(id);

DROP INDEX IF EXISTS idx_guest_limit_requests_one_pending;

CREATE UNIQUE INDEX idx_guest_limit_requests_pending_event
  ON guest_limit_requests(user_id, event_id)
  WHERE status = 'pending' AND event_id IS NOT NULL;

CREATE UNIQUE INDEX idx_guest_limit_requests_pending_legacy_date
  ON guest_limit_requests(user_id, date)
  WHERE status = 'pending' AND event_id IS NULL;

CREATE INDEX idx_external_links_event
  ON external_dj_links(event_id);

CREATE INDEX idx_guests_event_status
  ON guests(event_id, status);

CREATE INDEX idx_guest_limit_requests_event_status
  ON guest_limit_requests(event_id, status);

CREATE TABLE guest_activity_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  event_id TEXT REFERENCES events(id),
  guest_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN (
      'add', 'update', 'delete', 'restore',
      'check_in', 'cancel_check_in', 're_entry', 'permanent_delete'
    )),
  actor_user_id TEXT REFERENCES users(id),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('user', 'external_link', 'terminal', 'system')),
  channel TEXT NOT NULL
    CHECK (channel IN ('admin', 'door', 'guest', 'external_link', 'terminal', 'system')),
  request_id TEXT NOT NULL,
  idempotency_key TEXT,
  payload_hash TEXT,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('applied', 'replayed', 'conflict', 'rejected')),
  previous_status TEXT,
  next_status TEXT,
  device_key_hash TEXT,
  session_key_hash TEXT,
  occurred_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_guest_activity_venue_request
  ON guest_activity_ledger(venue_id, request_id);

CREATE INDEX idx_guest_activity_event_occurred
  ON guest_activity_ledger(event_id, occurred_at);

CREATE INDEX idx_guest_activity_guest_occurred
  ON guest_activity_ledger(guest_id, occurred_at);

CREATE INDEX idx_guest_activity_venue_occurred
  ON guest_activity_ledger(venue_id, occurred_at);

CREATE TRIGGER guest_activity_ledger_no_update
BEFORE UPDATE ON guest_activity_ledger
BEGIN
  SELECT RAISE(ABORT, 'guest activity ledger is immutable');
END;

CREATE TRIGGER guest_activity_ledger_no_delete
BEFORE DELETE ON guest_activity_ledger
BEGIN
  SELECT RAISE(ABORT, 'guest activity ledger is immutable');
END;

CREATE TABLE guest_activity_requests (
  venue_id TEXT NOT NULL REFERENCES venues(id),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  activity_id TEXT NOT NULL UNIQUE,
  guest_id TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'claimed'
    CHECK (outcome IN ('claimed', 'applied', 'rejected')),
  result_status TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (venue_id, idempotency_key)
);

CREATE INDEX idx_guest_activity_requests_created
  ON guest_activity_requests(created_at);

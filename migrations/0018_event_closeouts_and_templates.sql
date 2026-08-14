-- Night closeout confirmation and reusable contributor/link limit templates.
-- Existing events remain valid; template rows are opt-in and fall back to user limits.

ALTER TABLE events
  ADD COLUMN opened_at TEXT;

CREATE TABLE event_contributor_limits (
  event_id TEXT NOT NULL REFERENCES events(id),
  venue_id TEXT NOT NULL REFERENCES venues(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  guest_limit INTEGER,
  source_event_id TEXT REFERENCES events(id),
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CHECK (guest_limit IS NULL OR guest_limit >= 0)
);

CREATE INDEX idx_event_contributor_limits_venue_event
  ON event_contributor_limits(venue_id, event_id);

CREATE TABLE event_closeouts (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
  venue_id TEXT NOT NULL REFERENCES venues(id),
  confirmed_by_user_id TEXT NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  registered_count INTEGER NOT NULL,
  checked_in_count INTEGER NOT NULL,
  source_activity_count INTEGER NOT NULL,
  CHECK (length(report_hash) = 64),
  CHECK (registered_count >= 0),
  CHECK (checked_in_count >= 0 AND checked_in_count <= registered_count),
  CHECK (source_activity_count >= 0)
);

CREATE INDEX idx_event_closeouts_venue_confirmed
  ON event_closeouts(venue_id, confirmed_at);

CREATE TRIGGER event_closeouts_no_update
BEFORE UPDATE ON event_closeouts
BEGIN
  SELECT RAISE(ABORT, 'event closeout is immutable');
END;

CREATE TRIGGER event_closeouts_no_delete
BEFORE DELETE ON event_closeouts
BEGIN
  SELECT RAISE(ABORT, 'event closeout is immutable');
END;

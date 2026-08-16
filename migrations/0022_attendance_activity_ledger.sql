-- Immutable, visitor-anonymous attendance activities for Door walk-in counts.

CREATE TABLE attendance_activity_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  business_date TEXT NOT NULL,
  event_id TEXT REFERENCES events(id),
  action TEXT NOT NULL
    CHECK (action IN ('walk_in', 'reversal', 'manual_adjustment')),
  delta INTEGER NOT NULL
    CHECK (delta BETWEEN -500 AND 500 AND delta <> 0),
  reverses_activity_id TEXT REFERENCES attendance_activity_ledger(id),
  adjustment_reason TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL
    CHECK (channel IN ('door', 'admin')),
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  device_key_hash TEXT,
  device_sequence INTEGER,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    (action = 'walk_in' AND delta = 1 AND channel = 'door'
      AND reverses_activity_id IS NULL AND adjustment_reason IS NULL
      AND device_key_hash IS NOT NULL AND device_sequence > 0)
    OR
    (action = 'reversal' AND delta = -1 AND channel = 'door'
      AND reverses_activity_id IS NOT NULL AND adjustment_reason IS NULL
      AND device_key_hash IS NOT NULL AND device_sequence > 0)
    OR
    (action = 'manual_adjustment' AND channel = 'admin'
      AND reverses_activity_id IS NULL AND device_key_hash IS NULL
      AND device_sequence IS NULL
      AND length(trim(adjustment_reason)) BETWEEN 1 AND 500)
  )
);

CREATE UNIQUE INDEX idx_attendance_activity_venue_idempotency
  ON attendance_activity_ledger(venue_id, idempotency_key);

CREATE UNIQUE INDEX idx_attendance_activity_reversal_once
  ON attendance_activity_ledger(reverses_activity_id)
  WHERE reverses_activity_id IS NOT NULL;

CREATE UNIQUE INDEX idx_attendance_activity_device_sequence
  ON attendance_activity_ledger(
    venue_id, actor_user_id, device_key_hash, device_sequence
  )
  WHERE device_key_hash IS NOT NULL;

CREATE INDEX idx_attendance_activity_venue_date
  ON attendance_activity_ledger(venue_id, business_date, event_id);

CREATE INDEX idx_attendance_activity_event_occurred
  ON attendance_activity_ledger(event_id, occurred_at);

CREATE INDEX idx_attendance_activity_actor_scope
  ON attendance_activity_ledger(
    actor_user_id, venue_id, business_date, event_id,
    device_key_hash, device_sequence, occurred_at
  );

CREATE TRIGGER attendance_activity_event_scope_guard
BEFORE INSERT ON attendance_activity_ledger
WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM events
  WHERE id = NEW.event_id
    AND venue_id = NEW.venue_id
    AND business_date = NEW.business_date
)
BEGIN
  SELECT RAISE(ABORT, 'attendance event scope is invalid');
END;

CREATE TRIGGER attendance_activity_reversal_guard
BEFORE INSERT ON attendance_activity_ledger
WHEN NEW.action = 'reversal' AND NOT EXISTS (
  SELECT 1 FROM attendance_activity_ledger original
  WHERE original.id = NEW.reverses_activity_id
    AND original.action = 'walk_in'
    AND original.venue_id = NEW.venue_id
    AND original.business_date = NEW.business_date
    AND original.event_id IS NEW.event_id
    AND original.actor_user_id = NEW.actor_user_id
    AND original.device_key_hash IS NEW.device_key_hash
    AND original.device_sequence < NEW.device_sequence
)
BEGIN
  SELECT RAISE(ABORT, 'attendance reversal target is invalid');
END;

CREATE TRIGGER attendance_activity_nonnegative_guard
BEFORE INSERT ON attendance_activity_ledger
WHEN NEW.delta < 0 AND (
  SELECT coalesce(sum(delta), 0) + NEW.delta
  FROM attendance_activity_ledger
  WHERE venue_id = NEW.venue_id
    AND business_date = NEW.business_date
    AND event_id IS NEW.event_id
) < 0
BEGIN
  SELECT RAISE(ABORT, 'attendance total cannot be negative');
END;

CREATE TRIGGER attendance_activity_ledger_no_update
BEFORE UPDATE ON attendance_activity_ledger
BEGIN
  SELECT RAISE(ABORT, 'attendance activity ledger is immutable');
END;

CREATE TRIGGER attendance_activity_ledger_no_delete
BEFORE DELETE ON attendance_activity_ledger
BEGIN
  SELECT RAISE(ABORT, 'attendance activity ledger is immutable');
END;

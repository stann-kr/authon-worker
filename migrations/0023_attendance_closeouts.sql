-- Immutable, exact-scope Door attendance finalization snapshots.
-- This deliberately does not alter guest event_closeouts or their report hash contract.

CREATE TABLE attendance_closeouts (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  business_date TEXT NOT NULL,
  event_id TEXT REFERENCES events(id),
  target_total_attendance INTEGER NOT NULL CHECK (target_total_attendance >= 0),
  checked_in_guests INTEGER NOT NULL CHECK (checked_in_guests >= 0),
  pre_adjustment_walk_ins INTEGER NOT NULL CHECK (pre_adjustment_walk_ins >= 0),
  final_walk_ins INTEGER NOT NULL CHECK (final_walk_ins >= 0),
  adjustment_delta INTEGER NOT NULL CHECK (adjustment_delta BETWEEN -500 AND 500),
  source_activity_count INTEGER NOT NULL CHECK (source_activity_count >= 0),
  adjustment_activity_id TEXT UNIQUE REFERENCES attendance_activity_ledger(id),
  adjustment_reason TEXT NOT NULL CHECK (length(trim(adjustment_reason)) BETWEEN 1 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_total_attendance = checked_in_guests + final_walk_ins),
  CHECK (final_walk_ins = pre_adjustment_walk_ins + adjustment_delta),
  CHECK (
    (adjustment_delta = 0 AND adjustment_activity_id IS NULL)
    OR
    (adjustment_delta <> 0 AND adjustment_activity_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_attendance_closeouts_named_scope
  ON attendance_closeouts(venue_id, business_date, event_id)
  WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX idx_attendance_closeouts_general_scope
  ON attendance_closeouts(venue_id, business_date)
  WHERE event_id IS NULL;

CREATE UNIQUE INDEX idx_attendance_closeouts_venue_idempotency
  ON attendance_closeouts(venue_id, idempotency_key);

CREATE INDEX idx_attendance_closeouts_venue_finalized
  ON attendance_closeouts(venue_id, finalized_at);

CREATE TRIGGER attendance_closeouts_named_event_guard
BEFORE INSERT ON attendance_closeouts
WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM events
  WHERE id = NEW.event_id
    AND venue_id = NEW.venue_id
    AND business_date = NEW.business_date
    AND compatibility_key IS NULL
    AND state IN ('closed', 'archived')
)
BEGIN
  SELECT RAISE(ABORT, 'attendance closeout Event scope is not finalizable');
END;

CREATE TRIGGER attendance_activity_closeout_guard
BEFORE INSERT ON attendance_activity_ledger
WHEN EXISTS (
  SELECT 1 FROM attendance_closeouts
  WHERE venue_id = NEW.venue_id
    AND business_date = NEW.business_date
    AND event_id IS NEW.event_id
)
AND NOT EXISTS (
  SELECT 1 FROM attendance_closeouts
  WHERE venue_id = NEW.venue_id
    AND business_date = NEW.business_date
    AND event_id IS NEW.event_id
    AND adjustment_activity_id = NEW.id
    AND NEW.action = 'manual_adjustment'
)
BEGIN
  SELECT RAISE(ABORT, 'attendance scope is closed');
END;

CREATE TRIGGER attendance_activity_closeout_idempotency_guard
BEFORE INSERT ON attendance_activity_ledger
WHEN EXISTS (
  SELECT 1 FROM attendance_closeouts
  WHERE venue_id = NEW.venue_id
    AND idempotency_key = NEW.idempotency_key
)
AND NOT EXISTS (
  SELECT 1 FROM attendance_closeouts
  WHERE venue_id = NEW.venue_id
    AND idempotency_key = NEW.idempotency_key
    AND adjustment_activity_id = NEW.id
    AND NEW.action = 'manual_adjustment'
)
BEGIN
  SELECT RAISE(ABORT, 'attendance idempotency key conflicts with closeout');
END;

CREATE TRIGGER attendance_closeouts_idempotency_guard
BEFORE INSERT ON attendance_closeouts
WHEN EXISTS (
  SELECT 1 FROM attendance_activity_ledger
  WHERE venue_id = NEW.venue_id
    AND idempotency_key = NEW.idempotency_key
)
BEGIN
  SELECT RAISE(ABORT, 'attendance closeout idempotency key conflicts with activity');
END;

-- The attendance snapshot owns check-in finality. Lifecycle deletion remains
-- allowed so retention/cleanup does not mutate the frozen attendance total.
CREATE TRIGGER attendance_closeout_guest_checkin_guard
BEFORE UPDATE ON guests
WHEN (
  (OLD.status = 'pending' AND NEW.status = 'checked')
  OR (OLD.status = 'checked' AND NEW.status = 'pending')
  OR (
    OLD.status = 'checked'
    AND NEW.status = 'checked'
    AND (
      NEW.check_in_time IS NOT OLD.check_in_time
      OR NEW.venue_id IS NOT OLD.venue_id
      OR NEW.date IS NOT OLD.date
      OR NEW.event_id IS NOT OLD.event_id
    )
  )
)
AND (
  EXISTS (
    SELECT 1
    FROM attendance_closeouts closeout
    LEFT JOIN events compatibility_event
      ON compatibility_event.id = OLD.event_id
      AND compatibility_event.venue_id = OLD.venue_id
      AND compatibility_event.business_date = OLD.date
    WHERE closeout.venue_id = OLD.venue_id
      AND closeout.business_date = OLD.date
      AND (
        closeout.event_id = OLD.event_id
        OR (
          closeout.event_id IS NULL
          AND (
            OLD.event_id IS NULL
            OR compatibility_event.compatibility_key IS NOT NULL
          )
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM attendance_closeouts closeout
    LEFT JOIN events compatibility_event
      ON compatibility_event.id = NEW.event_id
      AND compatibility_event.venue_id = NEW.venue_id
      AND compatibility_event.business_date = NEW.date
    WHERE closeout.venue_id = NEW.venue_id
      AND closeout.business_date = NEW.date
      AND (
        closeout.event_id = NEW.event_id
        OR (
          closeout.event_id IS NULL
          AND (
            NEW.event_id IS NULL
            OR compatibility_event.compatibility_key IS NOT NULL
          )
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'attendance guest check-in scope is closed');
END;

CREATE TRIGGER attendance_closeout_guest_checked_insert_guard
BEFORE INSERT ON guests
WHEN NEW.status = 'checked'
AND EXISTS (
  SELECT 1
  FROM attendance_closeouts closeout
  LEFT JOIN events compatibility_event
    ON compatibility_event.id = NEW.event_id
    AND compatibility_event.venue_id = NEW.venue_id
    AND compatibility_event.business_date = NEW.date
  WHERE closeout.venue_id = NEW.venue_id
    AND closeout.business_date = NEW.date
    AND (
      closeout.event_id = NEW.event_id
      OR (
        closeout.event_id IS NULL
        AND (
          NEW.event_id IS NULL
          OR compatibility_event.compatibility_key IS NOT NULL
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'attendance guest check-in scope is closed');
END;

CREATE TRIGGER attendance_closeouts_append_adjustment
AFTER INSERT ON attendance_closeouts
WHEN NEW.adjustment_delta <> 0
BEGIN
  INSERT INTO attendance_activity_ledger (
    id, venue_id, business_date, event_id, action, delta,
    reverses_activity_id, adjustment_reason, actor_user_id, channel,
    request_id, idempotency_key, payload_hash, device_key_hash,
    device_sequence, occurred_at, created_at
  ) VALUES (
    NEW.adjustment_activity_id, NEW.venue_id, NEW.business_date, NEW.event_id,
    'manual_adjustment', NEW.adjustment_delta, NULL, NEW.adjustment_reason,
    NEW.actor_user_id, 'admin', NEW.request_id, NEW.idempotency_key,
    NEW.payload_hash, NULL, NULL, NEW.finalized_at, NEW.created_at
  );
END;

CREATE TRIGGER attendance_closeouts_no_update
BEFORE UPDATE ON attendance_closeouts
BEGIN
  SELECT RAISE(ABORT, 'attendance closeout is immutable');
END;

CREATE TRIGGER attendance_closeouts_no_delete
BEFORE DELETE ON attendance_closeouts
BEGIN
  SELECT RAISE(ABORT, 'attendance closeout is immutable');
END;

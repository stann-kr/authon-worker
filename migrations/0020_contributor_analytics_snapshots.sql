-- Canonical venue contributors and immutable closeout-time aggregate snapshots.
-- Existing closeouts remain unchanged and require a separate verified backfill.

CREATE TABLE venue_contributors (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dj',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  CHECK (kind IN ('dj')),
  CHECK (active IN (0, 1))
);

CREATE INDEX idx_venue_contributors_venue_active
  ON venue_contributors(venue_id, active);

ALTER TABLE users
  ADD COLUMN contributor_id TEXT REFERENCES venue_contributors(id);

CREATE INDEX idx_users_contributor
  ON users(contributor_id);

ALTER TABLE external_dj_links
  ADD COLUMN contributor_id TEXT REFERENCES venue_contributors(id);

CREATE INDEX idx_external_links_contributor
  ON external_dj_links(contributor_id);

CREATE TABLE contributor_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  contributor_id TEXT REFERENCES venue_contributors(id),
  actor_user_id TEXT REFERENCES users(id),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  CHECK (source_kind IN ('contributor', 'user', 'external_link')),
  CHECK (action IN ('created', 'updated', 'mapped', 'unmapped'))
);

CREATE INDEX idx_contributor_audit_venue_created
  ON contributor_audit_events(venue_id, created_at DESC);

CREATE INDEX idx_contributor_audit_contributor_created
  ON contributor_audit_events(contributor_id, created_at DESC);

CREATE TRIGGER contributor_audit_scope_insert
BEFORE INSERT ON contributor_audit_events
WHEN
  (
    NEW.contributor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM venue_contributors
      WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
    )
  )
  OR NOT (
    (
      NEW.source_kind = 'contributor'
      AND NEW.action IN ('created', 'updated')
      AND NEW.contributor_id = NEW.source_id
      AND EXISTS (
        SELECT 1 FROM venue_contributors
        WHERE id = NEW.source_id AND venue_id = NEW.venue_id
      )
    )
    OR (
      NEW.source_kind = 'user'
      AND NEW.action IN ('mapped', 'unmapped')
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = NEW.source_id
          AND venue_id = NEW.venue_id
          AND deleted_at IS NULL
          AND contributor_id IS NEW.contributor_id
      )
    )
    OR (
      NEW.source_kind = 'external_link'
      AND NEW.action IN ('mapped', 'unmapped')
      AND EXISTS (
        SELECT 1 FROM external_dj_links
        WHERE id = NEW.source_id
          AND venue_id = NEW.venue_id
          AND deleted_at IS NULL
          AND contributor_id IS NEW.contributor_id
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'contributor audit scope mismatch');
END;

CREATE TRIGGER contributor_audit_events_no_update
BEFORE UPDATE ON contributor_audit_events
BEGIN
  SELECT RAISE(ABORT, 'contributor audit event is immutable');
END;

CREATE TRIGGER contributor_audit_events_no_delete
BEFORE DELETE ON contributor_audit_events
BEGIN
  SELECT RAISE(ABORT, 'contributor audit event is immutable');
END;

CREATE TABLE event_closeout_contributor_metrics (
  event_id TEXT NOT NULL REFERENCES event_closeouts(event_id),
  venue_id TEXT NOT NULL REFERENCES venues(id),
  contributor_id TEXT REFERENCES venue_contributors(id),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  registered_count INTEGER NOT NULL,
  checked_in_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, source_kind, source_id),
  CHECK (source_kind IN ('user', 'external_link', 'unattributed')),
  CHECK (
    (source_kind = 'unattributed' AND source_id = 'unattributed' AND contributor_id IS NULL)
    OR (source_kind != 'unattributed' AND length(source_id) > 0)
  ),
  CHECK (registered_count >= 0),
  CHECK (checked_in_count >= 0 AND checked_in_count <= registered_count)
);

CREATE INDEX idx_closeout_contributor_metrics_venue_event
  ON event_closeout_contributor_metrics(venue_id, event_id);

CREATE INDEX idx_closeout_contributor_metrics_contributor_event
  ON event_closeout_contributor_metrics(contributor_id, event_id);

CREATE TRIGGER venue_contributors_identity_no_update
BEFORE UPDATE OF id, venue_id ON venue_contributors
WHEN NEW.id != OLD.id OR NEW.venue_id != OLD.venue_id
BEGIN
  SELECT RAISE(ABORT, 'contributor identity is immutable');
END;

CREATE TRIGGER users_contributor_same_venue_insert
BEFORE INSERT ON users
WHEN NEW.contributor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM venue_contributors
  WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
)
BEGIN
  SELECT RAISE(ABORT, 'user contributor venue mismatch');
END;

CREATE TRIGGER users_contributor_same_venue_update
BEFORE UPDATE OF contributor_id, venue_id ON users
WHEN NEW.contributor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM venue_contributors
  WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
)
BEGIN
  SELECT RAISE(ABORT, 'user contributor venue mismatch');
END;

CREATE TRIGGER external_links_contributor_same_venue_insert
BEFORE INSERT ON external_dj_links
WHEN NEW.contributor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM venue_contributors
  WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
)
BEGIN
  SELECT RAISE(ABORT, 'external link contributor venue mismatch');
END;

CREATE TRIGGER external_links_contributor_same_venue_update
BEFORE UPDATE OF contributor_id, venue_id ON external_dj_links
WHEN NEW.contributor_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM venue_contributors
  WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
)
BEGIN
  SELECT RAISE(ABORT, 'external link contributor venue mismatch');
END;

CREATE TRIGGER closeout_contributor_metrics_scope_insert
BEFORE INSERT ON event_closeout_contributor_metrics
WHEN
  NOT EXISTS (
    SELECT 1 FROM event_closeouts
    WHERE event_id = NEW.event_id AND venue_id = NEW.venue_id
  )
  OR (
    NEW.contributor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM venue_contributors
      WHERE id = NEW.contributor_id AND venue_id = NEW.venue_id
    )
  )
  OR NOT (
    (
      NEW.source_kind = 'user' AND EXISTS (
        SELECT 1 FROM users
        WHERE id = NEW.source_id
          AND venue_id = NEW.venue_id
          AND contributor_id IS NEW.contributor_id
      )
    )
    OR (
      NEW.source_kind = 'external_link' AND EXISTS (
        SELECT 1 FROM external_dj_links
        WHERE id = NEW.source_id
          AND venue_id = NEW.venue_id
          AND contributor_id IS NEW.contributor_id
      )
    )
    OR (
      NEW.source_kind = 'unattributed'
      AND NEW.source_id = 'unattributed'
      AND NEW.contributor_id IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'closeout contributor scope mismatch');
END;

CREATE TRIGGER event_closeout_contributor_metrics_no_update
BEFORE UPDATE ON event_closeout_contributor_metrics
BEGIN
  SELECT RAISE(ABORT, 'event closeout contributor metric is immutable');
END;

CREATE TRIGGER event_closeout_contributor_metrics_no_delete
BEFORE DELETE ON event_closeout_contributor_metrics
BEGIN
  SELECT RAISE(ABORT, 'event closeout contributor metric is immutable');
END;

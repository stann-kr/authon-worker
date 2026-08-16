-- Stable external-DJ directory keys and audited archived-link backfill support.

ALTER TABLE venue_contributors
  ADD COLUMN name_key TEXT;

CREATE UNIQUE INDEX idx_venue_contributors_venue_name_key
  ON venue_contributors(venue_id, name_key)
  WHERE name_key IS NOT NULL;

DROP TRIGGER contributor_audit_scope_insert;

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
          AND contributor_id IS NEW.contributor_id
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'contributor audit scope mismatch');
END;

-- Preserve external link creation order for recent-link views and migration.

ALTER TABLE external_dj_links ADD COLUMN created_at TEXT;

UPDATE external_dj_links
SET created_at = CASE
  WHEN date IS NOT NULL AND length(date) = 10
    THEN date || 'T00:00:00.000Z'
  WHEN expires_at IS NOT NULL
    THEN expires_at
  ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
END
WHERE created_at IS NULL;

-- Before cutover, run migration:generate:cutover-overlays and execute the
-- generated private backfill SQL to restore exact source timestamps.

CREATE INDEX IF NOT EXISTS idx_external_links_venue_created
  ON external_dj_links(venue_id, created_at DESC);

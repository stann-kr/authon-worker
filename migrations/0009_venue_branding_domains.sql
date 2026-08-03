-- Resolve venue branding and canonical application URLs from the request host.

ALTER TABLE venues ADD COLUMN description TEXT;
ALTER TABLE venues ADD COLUMN brand_name TEXT;
ALTER TABLE venues ADD COLUMN brand_tagline TEXT;
ALTER TABLE venues ADD COLUMN brand_description TEXT;
ALTER TABLE venues ADD COLUMN brand_footer TEXT;

CREATE TABLE venue_domains (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  venue_id TEXT REFERENCES venues(id),
  scope TEXT NOT NULL DEFAULT 'venue' CHECK (scope IN ('platform', 'venue')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK (
    (scope = 'platform' AND venue_id IS NULL)
    OR (scope = 'venue' AND venue_id IS NOT NULL)
  )
);

CREATE INDEX idx_venue_domains_venue
  ON venue_domains(venue_id, active);

CREATE UNIQUE INDEX idx_venue_domains_primary
  ON venue_domains(venue_id)
  WHERE is_primary = 1 AND active = 1 AND venue_id IS NOT NULL;

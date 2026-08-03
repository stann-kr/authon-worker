ALTER TABLE users ADD COLUMN preferred_locale TEXT
  CHECK (preferred_locale IS NULL OR preferred_locale IN ('en', 'ko'));

ALTER TABLE venue_domains ADD COLUMN default_locale TEXT
  CHECK (default_locale IS NULL OR default_locale IN ('en', 'ko'));

ALTER TABLE external_dj_links ADD COLUMN locale_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (locale_mode IN ('auto', 'en', 'ko'));

UPDATE venue_domains
SET default_locale = 'ko'
WHERE hostname = 'guest.faustseoul.kr';

-- Separate multi-guest contributor links from single-owner self RSVP links.
-- Ownership capabilities live outside guest rows so their hashes never enter roster responses.

ALTER TABLE external_dj_links
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'contributor'
  CHECK (kind IN ('contributor', 'self_rsvp'));

CREATE TABLE external_guest_owners (
  guest_id TEXT PRIMARY KEY NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  external_link_id TEXT NOT NULL REFERENCES external_dj_links(id),
  owner_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT,
  CHECK (length(owner_key_hash) = 64)
);

CREATE INDEX idx_external_guest_owners_link
  ON external_guest_owners(external_link_id);

CREATE UNIQUE INDEX idx_external_guest_owners_active_key
  ON external_guest_owners(external_link_id, owner_key_hash)
  WHERE released_at IS NULL;

CREATE TRIGGER external_guest_owners_release_after_guest_delete
AFTER UPDATE OF status ON guests
WHEN NEW.status = 'deleted' AND OLD.status != 'deleted'
BEGIN
  UPDATE external_guest_owners
  SET released_at = NEW.updated_at
  WHERE guest_id = NEW.id AND released_at IS NULL;
END;

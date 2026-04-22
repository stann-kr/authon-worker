-- migrations/0001_init.sql

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('club','bar','lounge','festival','private')),
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','venue_admin','door_staff','staff','dj')),
  venue_id TEXT REFERENCES venues(id),
  guest_limit INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE djs (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  event TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE external_dj_links (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  token TEXT NOT NULL UNIQUE,
  dj_name TEXT NOT NULL,
  event TEXT,
  date TEXT,
  max_guests INTEGER NOT NULL DEFAULT 10,
  used_guests INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  email TEXT,
  instagram TEXT,
  dj_id TEXT REFERENCES djs(id),
  external_link_id TEXT REFERENCES external_dj_links(id),
  terminal_request_id TEXT,
  source TEXT NOT NULL DEFAULT 'authon' CHECK (source IN ('authon', 'terminal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','checked','deleted')),
  check_in_time TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE check_ins (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests(id),
  checked_by TEXT REFERENCES users(id),
  checked_at TEXT NOT NULL
);

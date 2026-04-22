import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const venues = sqliteTable('venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'club', 'bar', 'lounge', 'festival', 'private'
  address: text('address'),
  active: integer('active').notNull().default(1),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(), // 'super_admin', 'venue_admin', 'door_staff', 'staff', 'dj'
  venueId: text('venue_id').references(() => venues.id),
  guestLimit: integer('guest_limit'),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const djs = sqliteTable('djs', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  event: text('event'),
  active: integer('active').notNull().default(1),
});

export const externalDjLinks = sqliteTable('external_dj_links', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  token: text('token').notNull().unique(),
  djName: text('dj_name').notNull(),
  event: text('event'),
  date: text('date'),
  maxGuests: integer('max_guests').notNull().default(10),
  usedGuests: integer('used_guests').notNull().default(0),
  active: integer('active').notNull().default(1),
  expiresAt: text('expires_at'),
  createdBy: text('created_by').references(() => users.id),
});

export const guests = sqliteTable('guests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  email: text('email'),
  instagram: text('instagram'),
  djId: text('dj_id').references(() => djs.id),
  externalLinkId: text('external_link_id').references(() => externalDjLinks.id),
  terminalRequestId: text('terminal_request_id'),
  source: text('source').notNull().default('authon'), // 'authon' or 'terminal'
  status: text('status').notNull().default('pending'), // 'pending', 'checked', 'deleted'
  checkInTime: text('check_in_time'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const checkIns = sqliteTable('check_ins', {
  id: text('id').primaryKey(),
  guestId: text('guest_id').notNull().references(() => guests.id),
  checkedBy: text('checked_by').references(() => users.id),
  checkedAt: text('checked_at').notNull(),
});

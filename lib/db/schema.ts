import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const venues = sqliteTable('venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'club', 'bar', 'lounge', 'festival', 'private'
  address: text('address'),
  description: text('description'),
  brandName: text('brand_name'),
  brandTagline: text('brand_tagline'),
  brandDescription: text('brand_description'),
  brandFooter: text('brand_footer'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const venueDomains = sqliteTable('venue_domains', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull().unique(),
  venueId: text('venue_id').references(() => venues.id),
  scope: text('scope').notNull().default('venue'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  defaultLocale: text('default_locale'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_venue_domains_venue').on(t.venueId, t.active),
  uniqueIndex('idx_venue_domains_primary').on(t.venueId).where(
    sql`${t.isPrimary} = 1 AND ${t.active} = 1 AND ${t.venueId} IS NOT NULL`,
  ),
]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  legacyAuthUserId: text('legacy_auth_user_id'),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  venueId: text('venue_id').references(() => venues.id),
  guestLimit: integer('guest_limit'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(0),
  migrationStatus: text('migration_status').notNull().default('native'),
  migratedAt: text('migrated_at'),
  passwordSetAt: text('password_set_at'),
  preferredLocale: text('preferred_locale'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_users_venue').on(t.venueId)]);

export const externalDjLinks = sqliteTable('external_dj_links', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  token: text('token').notNull().unique(),
  djName: text('dj_name').notNull(),
  event: text('event'),
  date: text('date'),
  maxGuests: integer('max_guests').notNull().default(10),
  usedGuests: integer('used_guests').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  expiresAt: text('expires_at'),
  createdBy: text('created_by').references(() => users.id),
  localeMode: text('locale_mode').notNull().default('auto'),
  createdAt: text('created_at'),
}, (t) => [
  index('idx_external_dj_links_venue').on(t.venueId),
  index('idx_external_links_venue_created').on(t.venueId, t.createdAt),
]);

export const guests = sqliteTable('guests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  email: text('email'),
  instagram: text('instagram'),
  externalLinkId: text('external_link_id').references(() => externalDjLinks.id),
  createdByUserId: text('created_by_user_id').references(() => users.id),
  terminalRequestId: text('terminal_request_id'),
  source: text('source').notNull().default('authon'),
  status: text('status').notNull().default('pending'),
  checkInTime: text('check_in_time'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_guests_venue_date').on(t.venueId, t.date),
  index('idx_guests_external_link').on(t.externalLinkId),
  index('idx_guests_created_by').on(t.createdByUserId),
]);

export const checkIns = sqliteTable('check_ins', {
  id: text('id').primaryKey(),
  guestId: text('guest_id').notNull().references(() => guests.id),
  checkedBy: text('checked_by').references(() => users.id),
  checkedAt: text('checked_at').notNull(),
});

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

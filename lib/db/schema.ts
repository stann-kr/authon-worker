import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

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
  timezone: text('timezone').notNull().default('Asia/Seoul'),
  openingTime: text('opening_time').notNull().default('22:00'),
  closingTime: text('closing_time').notNull().default('06:00'),
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
  accountKind: text('account_kind').notNull().default('personal'),
  doorAccessEnabled: integer('door_access_enabled', { mode: 'boolean' }).notNull().default(false),
  venueId: text('venue_id').references(() => venues.id),
  guestLimit: integer('guest_limit'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(0),
  migrationStatus: text('migration_status').notNull().default('native'),
  migratedAt: text('migrated_at'),
  passwordSetAt: text('password_set_at'),
  preferredLocale: text('preferred_locale'),
  lastLoginAt: text('last_login_at'),
  deletedAt: text('deleted_at'),
  deletedBy: text('deleted_by').references((): AnySQLiteColumn => users.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_users_venue').on(t.venueId),
  index('idx_users_venue_active_deleted').on(t.venueId, t.active, t.deletedAt),
]);

export const userAuditEvents = sqliteTable('user_audit_events', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').references(() => venues.id),
  actorUserId: text('actor_user_id').references(() => users.id),
  targetUserId: text('target_user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_user_audit_events_target_created').on(t.targetUserId, t.createdAt),
  index('idx_user_audit_events_venue_created').on(t.venueId, t.createdAt),
]);

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
  deletedAt: text('deleted_at'),
  deletedBy: text('deleted_by').references(() => users.id),
}, (t) => [
  index('idx_external_dj_links_venue').on(t.venueId),
  index('idx_external_links_venue_created').on(t.venueId, t.createdAt),
  index('idx_external_links_venue_deleted_created').on(
    t.venueId,
    t.deletedAt,
    t.createdAt,
  ),
]);

export const guests = sqliteTable('guests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  email: text('email'),
  instagram: text('instagram'),
  externalLinkId: text('external_link_id').references(() => externalDjLinks.id),
  createdByUserId: text('created_by_user_id').references(() => users.id),
  registeredByName: text('registered_by_name'),
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

export const terminalGuestSyncRequests = sqliteTable('terminal_guest_sync_requests', {
  venueId: text('venue_id').notNull().references(() => venues.id),
  requestId: text('request_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  guestId: text('guest_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.venueId, t.requestId] }),
  index('idx_terminal_guest_sync_requests_created').on(t.createdAt),
]);

export const checkIns = sqliteTable('check_ins', {
  id: text('id').primaryKey(),
  guestId: text('guest_id').notNull().references(() => guests.id),
  checkedBy: text('checked_by').references(() => users.id),
  checkedAt: text('checked_at').notNull(),
});

export const guestLimitRequests = sqliteTable('guest_limit_requests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  requestedExtra: integer('requested_extra').notNull(),
  approvedExtra: integer('approved_extra').notNull().default(0),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  decidedByUserId: text('decided_by_user_id').references(() => users.id),
  decidedAt: text('decided_at'),
  decisionNote: text('decision_note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_guest_limit_requests_venue_status_date').on(t.venueId, t.status, t.date),
  index('idx_guest_limit_requests_user_date').on(t.userId, t.date),
  uniqueIndex('idx_guest_limit_requests_one_pending').on(t.userId, t.date).where(
    sql`${t.status} = 'pending'`,
  ),
]);

export const passwordResetRequests = sqliteTable('password_reset_requests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').references(() => venues.id),
  userId: text('user_id').notNull().references(() => users.id),
  source: text('source').notNull().default('self_service'),
  status: text('status').notNull().default('pending'),
  setupMethod: text('setup_method'),
  decidedByUserId: text('decided_by_user_id').references(() => users.id),
  decidedAt: text('decided_at'),
  expiresAt: text('expires_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_password_reset_requests_venue_status_created').on(
    t.venueId,
    t.status,
    t.createdAt,
  ),
  index('idx_password_reset_requests_user_created').on(t.userId, t.createdAt),
  uniqueIndex('idx_password_reset_requests_one_open').on(t.userId).where(
    sql`${t.status} IN ('pending', 'approved')`,
  ),
]);

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

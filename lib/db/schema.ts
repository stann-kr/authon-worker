import { desc, sql } from 'drizzle-orm';
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

export const venueContributors = sqliteTable('venue_contributors', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  displayName: text('display_name').notNull(),
  nameKey: text('name_key'),
  kind: text('kind').notNull().default('dj'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_venue_contributors_venue_active').on(t.venueId, t.active),
  uniqueIndex('idx_venue_contributors_venue_name_key')
    .on(t.venueId, t.nameKey)
    .where(sql`${t.nameKey} IS NOT NULL`),
]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  legacyAuthUserId: text('legacy_auth_user_id'),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  contributorId: text('contributor_id').references(() => venueContributors.id),
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
  index('idx_users_contributor').on(t.contributorId),
]);

export const contributorAuditEvents = sqliteTable('contributor_audit_events', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  contributorId: text('contributor_id').references(() => venueContributors.id),
  actorUserId: text('actor_user_id').references(() => users.id),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_contributor_audit_venue_created').on(t.venueId, desc(t.createdAt)),
  index('idx_contributor_audit_contributor_created').on(
    t.contributorId,
    desc(t.createdAt),
  ),
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

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  businessDate: text('business_date').notNull(),
  name: text('name').notNull(),
  doorOpensAt: text('door_opens_at'),
  guestCutoffAt: text('guest_cutoff_at'),
  capacity: integer('capacity'),
  targetGuests: integer('target_guests'),
  state: text('state').notNull().default('draft'),
  templateSourceEventId: text('template_source_event_id').references(
    (): AnySQLiteColumn => events.id,
  ),
  compatibilityKey: text('compatibility_key'),
  createdByUserId: text('created_by_user_id').references(() => users.id),
  updatedByUserId: text('updated_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  openedAt: text('opened_at'),
  closedAt: text('closed_at'),
}, (t) => [
  index('idx_events_venue_business_date').on(t.venueId, t.businessDate),
  index('idx_events_venue_state_business_date').on(t.venueId, t.state, t.businessDate),
  uniqueIndex('idx_events_compatibility_key').on(t.compatibilityKey),
]);

export const externalDjLinks = sqliteTable('external_dj_links', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  token: text('token').notNull().unique(),
  djName: text('dj_name').notNull(),
  contributorId: text('contributor_id').references(() => venueContributors.id),
  event: text('event'),
  date: text('date'),
  eventId: text('event_id').references(() => events.id),
  maxGuests: integer('max_guests').notNull().default(10),
  usedGuests: integer('used_guests').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  expiresAt: text('expires_at'),
  createdBy: text('created_by').references(() => users.id),
  localeMode: text('locale_mode').notNull().default('auto'),
  kind: text('kind').notNull().default('contributor'),
  createdAt: text('created_at'),
  deletedAt: text('deleted_at'),
  deletedBy: text('deleted_by').references(() => users.id),
}, (t) => [
  index('idx_external_dj_links_venue').on(t.venueId),
  index('idx_external_links_venue_created').on(t.venueId, desc(t.createdAt)),
  index('idx_external_links_venue_deleted_created').on(
    t.venueId,
    t.deletedAt,
    t.createdAt,
  ),
  index('idx_external_links_event').on(t.eventId),
  index('idx_external_links_contributor').on(t.contributorId),
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
  eventId: text('event_id').references(() => events.id),
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
  index('idx_guests_event_status').on(t.eventId, t.status),
]);

export const externalGuestOwners = sqliteTable('external_guest_owners', {
  guestId: text('guest_id').primaryKey().references(() => guests.id, { onDelete: 'cascade' }),
  externalLinkId: text('external_link_id').notNull().references(() => externalDjLinks.id),
  ownerKeyHash: text('owner_key_hash').notNull(),
  createdAt: text('created_at').notNull(),
  releasedAt: text('released_at'),
}, (t) => [
  index('idx_external_guest_owners_link').on(t.externalLinkId),
  uniqueIndex('idx_external_guest_owners_active_key')
    .on(t.externalLinkId, t.ownerKeyHash)
    .where(sql`${t.releasedAt} IS NULL`),
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

export const guestActivityLedger = sqliteTable('guest_activity_ledger', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  eventId: text('event_id').references(() => events.id),
  guestId: text('guest_id').notNull(),
  action: text('action').notNull(),
  actorUserId: text('actor_user_id').references(() => users.id),
  actorType: text('actor_type').notNull(),
  channel: text('channel').notNull(),
  requestId: text('request_id').notNull(),
  idempotencyKey: text('idempotency_key'),
  payloadHash: text('payload_hash'),
  outcome: text('outcome').notNull(),
  previousStatus: text('previous_status'),
  nextStatus: text('next_status'),
  deviceKeyHash: text('device_key_hash'),
  sessionKeyHash: text('session_key_hash'),
  occurredAt: text('occurred_at').notNull(),
}, (t) => [
  uniqueIndex('idx_guest_activity_venue_request').on(t.venueId, t.requestId),
  index('idx_guest_activity_event_occurred').on(t.eventId, t.occurredAt),
  index('idx_guest_activity_guest_occurred').on(t.guestId, t.occurredAt),
  index('idx_guest_activity_venue_occurred').on(t.venueId, t.occurredAt),
]);

export const guestActivityRequests = sqliteTable('guest_activity_requests', {
  venueId: text('venue_id').notNull().references(() => venues.id),
  idempotencyKey: text('idempotency_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  activityId: text('activity_id').notNull().unique(),
  guestId: text('guest_id').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome').notNull().default('claimed'),
  resultStatus: text('result_status'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (t) => [
  primaryKey({ columns: [t.venueId, t.idempotencyKey] }),
  index('idx_guest_activity_requests_created').on(t.createdAt),
]);

export const attendanceActivityLedger = sqliteTable('attendance_activity_ledger', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  businessDate: text('business_date').notNull(),
  eventId: text('event_id').references(() => events.id),
  action: text('action').notNull(),
  delta: integer('delta').notNull(),
  reversesActivityId: text('reverses_activity_id').references(
    (): AnySQLiteColumn => attendanceActivityLedger.id,
  ),
  adjustmentReason: text('adjustment_reason'),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  channel: text('channel').notNull(),
  requestId: text('request_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  deviceKeyHash: text('device_key_hash'),
  deviceSequence: integer('device_sequence'),
  occurredAt: text('occurred_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_attendance_activity_venue_idempotency').on(
    t.venueId,
    t.idempotencyKey,
  ),
  uniqueIndex('idx_attendance_activity_reversal_once')
    .on(t.reversesActivityId)
    .where(sql`${t.reversesActivityId} IS NOT NULL`),
  uniqueIndex('idx_attendance_activity_device_sequence')
    .on(t.venueId, t.actorUserId, t.deviceKeyHash, t.deviceSequence)
    .where(sql`${t.deviceKeyHash} IS NOT NULL`),
  index('idx_attendance_activity_venue_date').on(
    t.venueId,
    t.businessDate,
    t.eventId,
  ),
  index('idx_attendance_activity_event_occurred').on(t.eventId, t.occurredAt),
  index('idx_attendance_activity_actor_scope').on(
    t.actorUserId,
    t.venueId,
    t.businessDate,
    t.eventId,
    t.deviceKeyHash,
    t.deviceSequence,
    t.occurredAt,
  ),
]);

export const attendanceCloseouts = sqliteTable('attendance_closeouts', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  businessDate: text('business_date').notNull(),
  eventId: text('event_id').references(() => events.id),
  targetTotalAttendance: integer('target_total_attendance').notNull(),
  checkedInGuests: integer('checked_in_guests').notNull(),
  preAdjustmentWalkIns: integer('pre_adjustment_walk_ins').notNull(),
  finalWalkIns: integer('final_walk_ins').notNull(),
  adjustmentDelta: integer('adjustment_delta').notNull(),
  sourceActivityCount: integer('source_activity_count').notNull(),
  adjustmentActivityId: text('adjustment_activity_id').references(
    () => attendanceActivityLedger.id,
  ),
  adjustmentReason: text('adjustment_reason').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  requestId: text('request_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  reportHash: text('report_hash').notNull(),
  finalizedAt: text('finalized_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_attendance_closeouts_named_scope')
    .on(t.venueId, t.businessDate, t.eventId)
    .where(sql`${t.eventId} IS NOT NULL`),
  uniqueIndex('idx_attendance_closeouts_general_scope')
    .on(t.venueId, t.businessDate)
    .where(sql`${t.eventId} IS NULL`),
  uniqueIndex('idx_attendance_closeouts_venue_idempotency').on(
    t.venueId,
    t.idempotencyKey,
  ),
  index('idx_attendance_closeouts_venue_finalized').on(t.venueId, t.finalizedAt),
]);

export const eventContributorLimits = sqliteTable('event_contributor_limits', {
  eventId: text('event_id').notNull().references(() => events.id),
  venueId: text('venue_id').notNull().references(() => venues.id),
  userId: text('user_id').notNull().references(() => users.id),
  guestLimit: integer('guest_limit'),
  sourceEventId: text('source_event_id').references(() => events.id),
  createdByUserId: text('created_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.eventId, t.userId] }),
  index('idx_event_contributor_limits_venue_event').on(t.venueId, t.eventId),
]);

export const eventCloseouts = sqliteTable('event_closeouts', {
  eventId: text('event_id').primaryKey().references(() => events.id),
  venueId: text('venue_id').notNull().references(() => venues.id),
  confirmedByUserId: text('confirmed_by_user_id').notNull().references(() => users.id),
  confirmedAt: text('confirmed_at').notNull(),
  reportHash: text('report_hash').notNull(),
  registeredCount: integer('registered_count').notNull(),
  checkedInCount: integer('checked_in_count').notNull(),
  sourceActivityCount: integer('source_activity_count').notNull(),
}, (t) => [
  index('idx_event_closeouts_venue_confirmed').on(t.venueId, t.confirmedAt),
]);

export const eventCloseoutContributorMetrics = sqliteTable(
  'event_closeout_contributor_metrics',
  {
    eventId: text('event_id').notNull().references(() => eventCloseouts.eventId),
    venueId: text('venue_id').notNull().references(() => venues.id),
    contributorId: text('contributor_id').references(() => venueContributors.id),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    registeredCount: integer('registered_count').notNull(),
    checkedInCount: integer('checked_in_count').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.sourceKind, t.sourceId] }),
    index('idx_closeout_contributor_metrics_venue_event').on(t.venueId, t.eventId),
    index('idx_closeout_contributor_metrics_contributor_event').on(
      t.contributorId,
      t.eventId,
    ),
  ],
);

export const guestLimitRequests = sqliteTable('guest_limit_requests', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  eventId: text('event_id').references(() => events.id),
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
  uniqueIndex('idx_guest_limit_requests_pending_event').on(t.userId, t.eventId).where(
    sql`${t.status} = 'pending' AND ${t.eventId} IS NOT NULL`,
  ),
  uniqueIndex('idx_guest_limit_requests_pending_legacy_date').on(t.userId, t.date).where(
    sql`${t.status} = 'pending' AND ${t.eventId} IS NULL`,
  ),
  index('idx_guest_limit_requests_event_status').on(t.eventId, t.status),
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

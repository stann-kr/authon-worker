import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import type { PasswordResetReceiptStatusRecord } from "./password-reset-receipt.ts";
import {
  CANCEL_BROWSER_PASSWORD_RESET_REQUEST_SQL,
  CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL,
  INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
  SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
} from "./password-reset-request-sql.ts";
import { users, venues } from "../db/schema.ts";

export interface PublicPasswordResetUserRecord {
  id: string;
  venueId: string | null;
  role: string;
  venueActive: boolean | null;
  active: boolean;
  deletedAt: string | null;
}

export interface PasswordResetPublicPersistence {
  findUserByEmail(email: string): Promise<PublicPasswordResetUserRecord | null>;
  createOrSelectBrowserRequest(input: {
    requestId: string;
    existingReceiptRequestId: string | null;
    eligibleUserId: string;
    expiresAt: string;
    nowIso: string;
    tenantScope: "platform" | "venue";
    tenantVenueId: string | null;
  }): Promise<{ insertedRequestId: string | null; existingRequestId: string | null }>;
  loadReceiptStatus(requestId: string): Promise<PasswordResetReceiptStatusRecord | null>;
  cancelExpiredApprovedRequest(input: {
    requestId: string;
    nowIso: string;
  }): Promise<void>;
  cancelBrowserRequest(input: {
    requestId: string;
    nowIso: string;
    tenantScope: "platform" | "venue";
    tenantVenueId: string | null;
  }): Promise<void>;
}

const SELECT_PUBLIC_PASSWORD_RESET_RECEIPT_STATUS_SQL = `
  SELECT pr.venue_id AS venueId,
         u.role AS userRole,
         pr.status AS status,
         pr.setup_method AS setupMethod,
         pr.expires_at AS expiresAt
  FROM password_reset_requests pr
  JOIN users u ON u.id = pr.user_id
  WHERE pr.id = ?
    AND pr.source = 'self_service'
    AND pr.venue_id IS u.venue_id
    AND u.active = 1
    AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM venues request_venue
      WHERE request_venue.id = u.venue_id
        AND request_venue.active = 1
    )
    AND u.account_kind = 'personal'
    AND u.role IN ('door_staff', 'staff', 'dj')
    AND EXISTS (
      SELECT 1
      FROM users reset_actor
      WHERE reset_actor.id = pr.decided_by_user_id
        AND reset_actor.active = 1
        AND reset_actor.deleted_at IS NULL
        AND reset_actor.id <> u.id
        AND (
          reset_actor.role = 'super_admin'
          OR (
            reset_actor.role = 'venue_admin'
            AND reset_actor.venue_id IS NOT NULL
            AND reset_actor.venue_id = u.venue_id
            AND u.role IN ('door_staff', 'staff', 'dj')
          )
        )
    )
  LIMIT 1
`;

const CANCEL_EXPIRED_APPROVED_BROWSER_REQUEST_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled',
      updated_at = ?
  WHERE id = ?
    AND source = 'self_service'
    AND status = 'approved'
    AND setup_method = 'admin_approved'
`;

export function createPasswordResetPublicPersistence(
  database: D1Database,
): PasswordResetPublicPersistence {
  const db = drizzle(database);

  return {
    async findUserByEmail(email) {
      const [user] = await db
        .select({
          id: users.id,
          venueId: users.venueId,
          role: users.role,
          venueActive: venues.active,
          active: users.active,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .leftJoin(venues, eq(users.venueId, venues.id))
        .where(eq(users.email, email))
        .limit(1);
      return user ?? null;
    },

    async createOrSelectBrowserRequest(input) {
      const [, insertResult, existingResult] = await database.batch<{ id: string }>([
        database.prepare(CANCEL_EXPIRED_OPEN_PASSWORD_RESET_REQUESTS_SQL).bind(
          input.nowIso,
          input.eligibleUserId,
          input.nowIso,
        ),
        database.prepare(
          INSERT_SELF_SERVICE_PASSWORD_RESET_REQUEST_WITH_EXPIRY_SQL,
        ).bind(
          input.requestId,
          input.expiresAt,
          input.nowIso,
          input.nowIso,
          input.eligibleUserId,
          input.tenantScope,
          input.tenantVenueId,
        ),
        database.prepare(
          SELECT_EXISTING_BROWSER_PASSWORD_RESET_REQUEST_SQL,
        ).bind(
          input.existingReceiptRequestId ?? crypto.randomUUID(),
          input.eligibleUserId,
          input.nowIso,
          input.tenantScope,
          input.tenantVenueId,
        ),
      ]);
      return {
        insertedRequestId:
          (insertResult.results?.[0] as { id?: string } | undefined)?.id ?? null,
        existingRequestId:
          (existingResult.results?.[0] as { id?: string } | undefined)?.id ?? null,
      };
    },

    async loadReceiptStatus(requestId) {
      return database
        .prepare(SELECT_PUBLIC_PASSWORD_RESET_RECEIPT_STATUS_SQL)
        .bind(requestId)
        .first<PasswordResetReceiptStatusRecord>();
    },

    async cancelExpiredApprovedRequest({ requestId, nowIso }) {
      await database.prepare(CANCEL_EXPIRED_APPROVED_BROWSER_REQUEST_SQL)
        .bind(nowIso, requestId)
        .run();
    },

    async cancelBrowserRequest({
      requestId,
      nowIso,
      tenantScope,
      tenantVenueId,
    }) {
      await database.prepare(CANCEL_BROWSER_PASSWORD_RESET_REQUEST_SQL)
        .bind(nowIso, requestId, tenantScope, tenantVenueId)
        .run();
    },
  };
}

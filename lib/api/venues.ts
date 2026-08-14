"use server";

import { reportServerError } from "@/lib/observability/structured-log";

import { and, asc, eq, inArray } from "drizzle-orm";
import { venueDomains, venues } from "../db/schema";
import { type Venue, type ApiResponse } from "./types";
import { requireRole } from "../auth/server";
import { getDb } from "../db/client";
import { isPlatformHostname, normalizeHostname } from "../tenant/host";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { isInactiveVenueRecoveryUpdate } from "@/lib/tenant/active-policy";
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  DEFAULT_VENUE_TIMEZONE,
  isValidTimeValue,
  isValidTimeZone,
} from "@/lib/date";

type Db = ReturnType<typeof getDb>;
type VenueRow = typeof venues.$inferSelect;

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parsePrimaryDomain(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  const normalized = normalizeHostname(trimmed);
  if (!normalized || !DOMAIN_PATTERN.test(normalized) || isPlatformHostname(normalized)) {
    throw new Error("Invalid hostname");
  }
  return normalized;
}

function isHostnameError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("hostname");
}

function assertVenueTimeSettings(settings: {
  timezone: string;
  openingTime: string;
  closingTime: string;
}): void {
  if (!isValidTimeZone(settings.timezone)) throw new Error("INVALID_TIMEZONE");
  if (
    !isValidTimeValue(settings.openingTime) ||
    !isValidTimeValue(settings.closingTime) ||
    settings.openingTime === settings.closingTime
  ) {
    throw new Error("INVALID_OPERATING_HOURS");
  }
}

function isVenueTimeError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message === "INVALID_TIMEZONE" ||
    error.message === "INVALID_OPERATING_HOURS"
  );
}

function toVenue(
  row: VenueRow,
  primaryDomain: string | null = null,
  defaultLocale: Locale | null = null,
): Venue {
  return { ...row, type: row.type as Venue["type"], primaryDomain, defaultLocale };
}

async function loadVenue(db: Db, id: string): Promise<Venue | null> {
  const [row] = await db.select().from(venues).where(eq(venues.id, id)).limit(1);
  if (!row) return null;
  const [domain] = await db
    .select({ hostname: venueDomains.hostname, defaultLocale: venueDomains.defaultLocale })
    .from(venueDomains)
    .where(
      and(
        eq(venueDomains.venueId, id),
        eq(venueDomains.isPrimary, true),
        eq(venueDomains.active, true),
      ),
    )
    .limit(1);
  return toVenue(
    row,
    domain?.hostname || null,
    isLocale(domain?.defaultLocale) ? domain.defaultLocale : null,
  );
}

async function setPrimaryDomain(
  db: Db,
  venueId: string,
  value: string | null | undefined,
  defaultLocale: Locale = DEFAULT_LOCALE,
) {
  const hostname = parsePrimaryDomain(value);
  const existingForHost = hostname
    ? await db
        .select({ id: venueDomains.id, venueId: venueDomains.venueId })
        .from(venueDomains)
        .where(eq(venueDomains.hostname, hostname))
        .limit(1)
    : [];

  if (existingForHost[0] && existingForHost[0].venueId !== venueId) {
    throw new Error("Hostname is already assigned to another venue");
  }

  await db
    .update(venueDomains)
    .set({ isPrimary: false })
    .where(eq(venueDomains.venueId, venueId));

  if (!hostname) return;

  if (existingForHost[0]) {
    await db
      .update(venueDomains)
      .set({ venueId, scope: "venue", isPrimary: true, active: true, defaultLocale })
      .where(eq(venueDomains.id, existingForHost[0].id));
    return;
  }

  await db.insert(venueDomains).values({
    id: crypto.randomUUID(),
    hostname,
    venueId,
    scope: "venue",
    isPrimary: true,
    active: true,
    defaultLocale,
    createdAt: new Date().toISOString(),
  });
}

export async function fetchVenues(includeInactive = false): Promise<ApiResponse<Venue[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();
    let query = db.select().from(venues).$dynamic();
    if (actor.role !== "super_admin") {
      if (!actor.venueId) throw new Error("Forbidden");
      query = query.where(
        includeInactive
          ? eq(venues.id, actor.venueId)
          : and(eq(venues.id, actor.venueId), eq(venues.active, true)),
      );
    } else if (!includeInactive) {
      query = query.where(eq(venues.active, true));
    }

    const rows = await query.orderBy(asc(venues.name));
    const venueIds = rows.map((row) => row.id);
    const domains = venueIds.length
      ? await db
          .select({
            venueId: venueDomains.venueId,
            hostname: venueDomains.hostname,
            defaultLocale: venueDomains.defaultLocale,
          })
          .from(venueDomains)
          .where(
            and(
              inArray(venueDomains.venueId, venueIds),
              eq(venueDomains.isPrimary, true),
              eq(venueDomains.active, true),
            ),
          )
      : [];
    const domainByVenue = new Map(domains.map((domain) => [domain.venueId, domain]));

    return {
      data: rows.map((row) => {
        const domain = domainByVenue.get(row.id);
        return toVenue(
          row,
          domain?.hostname || null,
          isLocale(domain?.defaultLocale) ? domain.defaultLocale : null,
        );
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("venue.list", error);
    return { data: null, error: "Unable to load venues right now." };
  }
}

export async function createVenue(venue: {
  name: string;
  type: Venue["type"];
  address?: string;
  description?: string;
  brandName?: string;
  brandTagline?: string;
  brandDescription?: string;
  brandFooter?: string;
  primaryDomain?: string;
  defaultLocale?: Locale;
  timezone?: string;
  openingTime?: string;
  closingTime?: string;
}): Promise<ApiResponse<Venue>> {
  try {
    await requireRole(["super_admin"]);
    const db = getDb();
    const id = crypto.randomUUID();
    const timeSettings = {
      timezone: venue.timezone?.trim() || DEFAULT_VENUE_TIMEZONE,
      openingTime: venue.openingTime || DEFAULT_OPENING_TIME,
      closingTime: venue.closingTime || DEFAULT_CLOSING_TIME,
    };
    assertVenueTimeSettings(timeSettings);
    const primaryDomain = parsePrimaryDomain(venue.primaryDomain);
    if (primaryDomain) {
      const assigned = await db
        .select({ id: venueDomains.id })
        .from(venueDomains)
        .where(eq(venueDomains.hostname, primaryDomain))
        .limit(1);
      if (assigned[0]) throw new Error("Hostname is already assigned to another venue");
    }
    await db.insert(venues).values({
      id,
      name: venue.name.trim(),
      type: venue.type,
      address: venue.address?.trim() || null,
      description: venue.description?.trim() || null,
      brandName: venue.brandName?.trim() || null,
      brandTagline: venue.brandTagline?.trim() || null,
      brandDescription: venue.brandDescription?.trim() || null,
      brandFooter: venue.brandFooter?.trim() || null,
      ...timeSettings,
      active: true,
    });
    if (primaryDomain) {
      await setPrimaryDomain(
        db,
        id,
        primaryDomain,
        isLocale(venue.defaultLocale) ? venue.defaultLocale : DEFAULT_LOCALE,
      );
    }
    return { data: await loadVenue(db, id), error: null };
  } catch (error: unknown) {
    await reportServerError("venue.create", error);
    const message = isHostnameError(error)
      ? "Enter a valid, unused venue domain."
      : isVenueTimeError(error)
        ? error.message
        : "Unable to create venue right now.";
    return { data: null, error: message };
  }
}

export async function updateVenue(
  id: string,
  updates: Partial<Pick<Venue,
    | "name"
    | "type"
    | "address"
    | "description"
    | "brandName"
    | "brandTagline"
    | "brandDescription"
    | "brandFooter"
    | "primaryDomain"
    | "defaultLocale"
    | "timezone"
    | "openingTime"
    | "closingTime"
    | "active"
  >>,
): Promise<ApiResponse<Venue>> {
  try {
    await requireRole(["super_admin"]);
    const db = getDb();
    const currentVenue = await loadVenue(db, id);
    if (!currentVenue) throw new Error("Venue not found");
    if (!isInactiveVenueRecoveryUpdate(currentVenue.active, updates)) {
      throw new Error("Inactive venue can only be reactivated");
    }
    const timeSettings = {
      timezone: updates.timezone?.trim() || currentVenue.timezone,
      openingTime: updates.openingTime || currentVenue.openingTime,
      closingTime: updates.closingTime || currentVenue.closingTime,
    };
    assertVenueTimeSettings(timeSettings);
    const primaryDomain = updates.primaryDomain !== undefined
      ? parsePrimaryDomain(updates.primaryDomain)
      : undefined;
    if (primaryDomain) {
      const [assigned] = await db
        .select({ venueId: venueDomains.venueId })
        .from(venueDomains)
        .where(eq(venueDomains.hostname, primaryDomain))
        .limit(1);
      if (assigned && assigned.venueId !== id) {
        throw new Error("Hostname is already assigned to another venue");
      }
    }
    const dbUpdates: Partial<typeof venues.$inferInsert> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.address !== undefined) dbUpdates.address = updates.address?.trim() || null;
    if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;
    if (updates.brandName !== undefined) dbUpdates.brandName = updates.brandName?.trim() || null;
    if (updates.brandTagline !== undefined) dbUpdates.brandTagline = updates.brandTagline?.trim() || null;
    if (updates.brandDescription !== undefined) dbUpdates.brandDescription = updates.brandDescription?.trim() || null;
    if (updates.brandFooter !== undefined) dbUpdates.brandFooter = updates.brandFooter?.trim() || null;
    if (updates.timezone !== undefined) dbUpdates.timezone = timeSettings.timezone;
    if (updates.openingTime !== undefined) dbUpdates.openingTime = timeSettings.openingTime;
    if (updates.closingTime !== undefined) dbUpdates.closingTime = timeSettings.closingTime;
    if (updates.active !== undefined) dbUpdates.active = updates.active;

    if (Object.keys(dbUpdates).length > 0) {
      await db.update(venues).set(dbUpdates).where(eq(venues.id, id));
    }
    if (primaryDomain !== undefined || updates.defaultLocale !== undefined) {
      const [currentDomain] = await db
        .select({ hostname: venueDomains.hostname })
        .from(venueDomains)
        .where(
          and(
            eq(venueDomains.venueId, id),
            eq(venueDomains.isPrimary, true),
            eq(venueDomains.active, true),
          ),
        )
        .limit(1);
      await setPrimaryDomain(
        db,
        id,
        primaryDomain !== undefined ? primaryDomain : currentDomain?.hostname,
        isLocale(updates.defaultLocale) ? updates.defaultLocale : DEFAULT_LOCALE,
      );
    }
    return { data: await loadVenue(db, id), error: null };
  } catch (error: unknown) {
    await reportServerError("venue.update", error);
    const message = isHostnameError(error)
      ? "Enter a valid, unused venue domain."
      : isVenueTimeError(error)
        ? error.message
        : "Unable to update venue right now.";
    return { data: null, error: message };
  }
}

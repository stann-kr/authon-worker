import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { externalDjLinks as links, guests } from "../db/schema";

import type { LinkListCursor, LinkListOptions } from "./list-types";

export function buildLinkGuestQuery(venueId: string, linkId: string, cursor?: LinkListCursor | null) {
  return {
    join: and(eq(guests.externalLinkId, links.id), eq(guests.venueId, links.venueId)),
    where: and(eq(links.venueId, venueId), eq(links.id, linkId), isNull(links.deletedAt),
      inArray(guests.status, ["pending", "checked"]),
      cursor ? or(lt(guests.createdAt, cursor.value), and(eq(guests.createdAt, cursor.value), lt(guests.id, cursor.id))) : undefined),
    order: [desc(guests.createdAt), desc(guests.id)],
  };
}

export function buildLinkListQuery(venueId: string, options: LinkListOptions, eventId: string | null, includeLegacy: boolean) {
  const scope = and(eq(links.venueId, venueId), isNull(links.deletedAt),
    options.date ? eq(links.date, options.date) : undefined,
    options.date
      ? eventId
        ? includeLegacy ? or(eq(links.eventId, eventId), isNull(links.eventId)) : eq(links.eventId, eventId)
        : isNull(links.eventId)
      : undefined);
  const expired = sql`coalesce(julianday(${links.expiresAt}) <= julianday('now'), 0)`;
  const expiring = sql`coalesce(julianday(${links.expiresAt}) <= julianday('now', '+1 day'), 0)`;
  const active = sql`(${links.active} = 1 AND NOT (${expired}))`;
  const attention = sql`(${links.active} = 0 OR (${expiring}) OR ${links.usedGuests} >= ${links.maxGuests})`;
  const value = options.sort === "djName" ? sql<string>`lower(${links.djName})`
    : options.sort === "expiresSoonest" ? sql<string>`coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${links.expiresAt}), '9999')`
      : sql<string>`coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${links.createdAt}), '')`;
  const compare = options.sort === "newest" ? lt : gt;
  const order = options.sort === "newest" ? desc : asc;
  const cursor = options.cursor;
  return {
    scope,
    stats: {
      total: sql<number>`count(*)`.mapWith(Number),
      active: sql<number>`coalesce(sum(CASE WHEN ${active} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
      attention: sql<number>`coalesce(sum(CASE WHEN ${attention} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
    },
    where: and(scope,
      options.filter === "active" ? active : options.filter === "attention" ? attention : undefined,
      cursor ? or(compare(value, cursor.value), and(eq(value, cursor.value), compare(links.id, cursor.id))) : undefined),
    order: [order(value), order(links.id)],
    value,
  };
}

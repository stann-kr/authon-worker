import { and, desc, eq, isNull, ne, type SQL } from "drizzle-orm";
import type { getDb } from "../db/client";
import { guests } from "../db/schema";
import type { Guest } from "../guests/types";

export async function loadSnapshotGuests(
  db: ReturnType<typeof getDb>,
  scope: {
    venueId: string;
    date: string;
    eventId: string | null;
    includeLegacyDateRows: boolean;
    createdByUserId?: string;
  },
): Promise<Guest[]> {
  const selectScope = (condition: SQL) => db
    .select()
    .from(guests)
    .where(and(
      eq(guests.venueId, scope.venueId),
      condition,
      ne(guests.status, "deleted"),
      scope.createdByUserId ? eq(guests.createdByUserId, scope.createdByUserId) : undefined,
    ));
  const legacyScope = and(isNull(guests.eventId), eq(guests.date, scope.date))!;
  const query = scope.eventId
    ? selectScope(eq(guests.eventId, scope.eventId))
    : selectScope(legacyScope);

  // The two sets are disjoint. UNION ALL lets each use its own event/date
  // index without narrowing historic Event rows by their legacy date value.
  const rows = await (scope.eventId && scope.includeLegacyDateRows
    ? query.unionAll(selectScope(legacyScope))
    : query
  ).orderBy(desc(guests.createdAt));
  return rows.map((guest) => ({ ...guest, status: guest.status as Guest["status"] }));
}

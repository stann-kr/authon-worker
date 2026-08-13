import { createHash } from "node:crypto";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_TABLES = ["guests", "external_dj_links", "guest_limit_requests"];

function isBusinessDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function scopeKey(venueId, businessDate) {
  return `${venueId}\u0000${businessDate}`;
}

function compatibilityKey(venueId, businessDate) {
  return `legacy:${venueId}:${businessDate}`;
}

export function planEventBackfill({ sources, events }) {
  const scopes = new Map();
  const invalidRows = [];

  for (const table of SOURCE_TABLES) {
    for (const row of sources[table] ?? []) {
      if (row.eventId !== null && row.eventId !== undefined) continue;
      if (
        typeof row.venueId !== "string" ||
        row.venueId.length === 0 ||
        !isBusinessDate(row.businessDate)
      ) {
        invalidRows.push({ table, rowId: String(row.id ?? "") });
        continue;
      }
      const key = scopeKey(row.venueId, row.businessDate);
      const scope = scopes.get(key) ?? {
        venueId: row.venueId,
        businessDate: row.businessDate,
        compatibilityKey: compatibilityKey(row.venueId, row.businessDate),
        counts: {
          guests: 0,
          external_dj_links: 0,
          guest_limit_requests: 0,
        },
      };
      scope.counts[table] += 1;
      scopes.set(key, scope);
    }
  }

  const compatibilityEvents = new Map();
  const explicitEventCounts = new Map();
  const invalidCompatibilityEvents = [];
  for (const event of events ?? []) {
    const key = scopeKey(event.venueId, event.businessDate);
    if (event.compatibilityKey) {
      if (event.compatibilityKey !== compatibilityKey(event.venueId, event.businessDate)) {
        invalidCompatibilityEvents.push(String(event.id));
      } else {
        compatibilityEvents.set(key, event);
      }
    } else {
      explicitEventCounts.set(key, (explicitEventCounts.get(key) ?? 0) + 1);
    }
  }

  const targets = [...scopes.values()]
    .sort((left, right) =>
      left.venueId.localeCompare(right.venueId) ||
      left.businessDate.localeCompare(right.businessDate),
    )
    .map((scope) => ({
      ...scope,
      existingEventId:
        compatibilityEvents.get(scopeKey(scope.venueId, scope.businessDate))?.id ?? null,
      needsCompatibilityEvent: !compatibilityEvents.has(
        scopeKey(scope.venueId, scope.businessDate),
      ),
      explicitEventsOnDate:
        explicitEventCounts.get(scopeKey(scope.venueId, scope.businessDate)) ?? 0,
    }));

  return {
    targets,
    invalidRows,
    invalidCompatibilityEvents,
    totals: {
      scopes: targets.length,
      compatibilityEventsToCreate: targets.filter(
        (target) => target.needsCompatibilityEvent,
      ).length,
      rowsToLink: targets.reduce(
        (total, target) =>
          total +
          target.counts.guests +
          target.counts.external_dj_links +
          target.counts.guest_limit_requests,
        0,
      ),
      invalidRows: invalidRows.length,
      invalidCompatibilityEvents: invalidCompatibilityEvents.length,
    },
  };
}

function hashScope(venueId, businessDate) {
  return createHash("sha256")
    .update(`${venueId}\u0000${businessDate}`)
    .digest("hex")
    .slice(0, 12);
}

export function toSafeEventBackfillReport(plan) {
  return {
    mode: "dry-run",
    writesPerformed: 0,
    totals: plan.totals,
    targets: plan.targets.map((target) => ({
      scope: hashScope(target.venueId, target.businessDate),
      businessDate: target.businessDate,
      needsCompatibilityEvent: target.needsCompatibilityEvent,
      explicitEventsOnDate: target.explicitEventsOnDate,
      counts: target.counts,
    })),
    invalid: {
      rows: plan.invalidRows.map((row) => ({
        table: row.table,
        row: createHash("sha256").update(row.rowId).digest("hex").slice(0, 12),
      })),
      compatibilityEvents: plan.invalidCompatibilityEvents.map((id) =>
        createHash("sha256").update(id).digest("hex").slice(0, 12),
      ),
    },
  };
}

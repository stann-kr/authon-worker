"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import {
  contributorAuditEvents,
  externalDjLinks,
  users,
  venueContributors,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { requireRole, type SessionUser } from "@/lib/auth/server";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import { reportServerError } from "@/lib/observability/structured-log";
import {
  isContributorKind,
  prepareContributorInput,
} from "@/lib/contributors/domain";
import type {
  ApiResponse,
  ContributorSourceMapping,
  VenueContributor,
} from "@/lib/api/types";

type ContributorActionErrorCode =
  | "CONTRIBUTOR_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "SOURCE_NOT_FOUND"
  | "UPDATE_FAILED";

class ContributorActionError extends Error {
  constructor(readonly code: ContributorActionErrorCode) {
    super(code);
  }
}

function toContributor(
  row: typeof venueContributors.$inferSelect,
): VenueContributor {
  if (!isContributorKind(row.kind)) {
    throw new ContributorActionError("INVALID_INPUT");
  }
  return { ...row, kind: row.kind };
}

async function requireManagedVenueId(
  actor: SessionUser,
  requestedVenueId: string,
): Promise<string> {
  const venueId = actor.role === "super_admin" ? requestedVenueId : actor.venueId;
  if (!venueId || venueId !== requestedVenueId) {
    throw new ContributorActionError("FORBIDDEN");
  }
  return requireActiveVenueId(venueId);
}

function contributorError(error: unknown): string {
  return error instanceof ContributorActionError ? error.code : "UPDATE_FAILED";
}

export async function fetchVenueContributors(
  venueId: string,
): Promise<ApiResponse<VenueContributor[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = await requireManagedVenueId(actor, venueId);
    const rows = await getDb()
      .select()
      .from(venueContributors)
      .where(eq(venueContributors.venueId, effectiveVenueId))
      .orderBy(asc(venueContributors.displayName), asc(venueContributors.id));
    return { data: rows.map(toContributor), error: null };
  } catch (error: unknown) {
    await reportServerError("contributor.list", error);
    return { data: null, error: contributorError(error) };
  }
}

export async function fetchContributorSourceMappings(
  venueId: string,
): Promise<ApiResponse<ContributorSourceMapping[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const effectiveVenueId = await requireManagedVenueId(actor, venueId);
    const db = getDb();
    const [userRows, linkRows] = await Promise.all([
      db
        .select({
          sourceId: users.id,
          contributorId: users.contributorId,
        })
        .from(users)
        .where(
          and(
            eq(users.venueId, effectiveVenueId),
            isNull(users.deletedAt),
          ),
        ),
      db
        .select({
          sourceId: externalDjLinks.id,
          contributorId: externalDjLinks.contributorId,
        })
        .from(externalDjLinks)
        .where(
          and(
            eq(externalDjLinks.venueId, effectiveVenueId),
            isNull(externalDjLinks.deletedAt),
          ),
        ),
    ]);
    return {
      data: [
        ...userRows.map((row) => ({
          sourceKind: "user" as const,
          sourceId: row.sourceId,
          contributorId: row.contributorId,
        })),
        ...linkRows.map((row) => ({
          sourceKind: "external_link" as const,
          sourceId: row.sourceId,
          contributorId: row.contributorId,
        })),
      ],
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("contributor.source_list", error);
    return { data: null, error: contributorError(error) };
  }
}

export async function createVenueContributor(params: {
  venueId: string;
  displayName: string;
  kind?: "dj";
}): Promise<ApiResponse<VenueContributor>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const venueId = await requireManagedVenueId(actor, params.venueId);
    const prepared = prepareContributorInput(params);
    if (prepared.error) throw new ContributorActionError("INVALID_INPUT");

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const db = getDb();
    await db.batch([
      db.insert(venueContributors).values({
        id,
        venueId,
        displayName: prepared.contributor.displayName,
        kind: prepared.contributor.kind,
        active: true,
        createdAt,
        updatedAt: createdAt,
      }),
      db.insert(contributorAuditEvents).values({
        id: crypto.randomUUID(),
        venueId,
        contributorId: id,
        actorUserId: actor.id,
        sourceKind: "contributor",
        sourceId: id,
        action: "created",
        details: JSON.stringify({ kind: prepared.contributor.kind }),
        createdAt,
      }),
    ]);
    return {
      data: {
        id,
        venueId,
        displayName: prepared.contributor.displayName,
        kind: prepared.contributor.kind,
        active: true,
        createdAt,
        updatedAt: createdAt,
      },
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("contributor.create", error);
    return { data: null, error: contributorError(error) };
  }
}

export async function updateVenueContributor(params: {
  contributorId: string;
  venueId: string;
  displayName?: string;
  active?: boolean;
}): Promise<ApiResponse<VenueContributor>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const venueId = await requireManagedVenueId(actor, params.venueId);
    const db = getDb();
    const [current] = await db
      .select()
      .from(venueContributors)
      .where(
        and(
          eq(venueContributors.id, params.contributorId),
          eq(venueContributors.venueId, venueId),
        ),
      )
      .limit(1);
    if (!current) throw new ContributorActionError("CONTRIBUTOR_NOT_FOUND");

    const prepared = prepareContributorInput({
      displayName: params.displayName ?? current.displayName,
      kind: current.kind,
    });
    if (prepared.error || (params.active !== undefined && typeof params.active !== "boolean")) {
      throw new ContributorActionError("INVALID_INPUT");
    }
    const nextActive = params.active ?? current.active;
    const changedFields = [
      ...(prepared.contributor.displayName !== current.displayName ? ["displayName"] : []),
      ...(nextActive !== current.active ? ["active"] : []),
    ];
    if (changedFields.length === 0) {
      return { data: toContributor(current), error: null };
    }

    const updatedAt = new Date().toISOString();
    await db.batch([
      db
        .update(venueContributors)
        .set({
          displayName: prepared.contributor.displayName,
          active: nextActive,
          updatedAt,
        })
        .where(
          and(
            eq(venueContributors.id, current.id),
            eq(venueContributors.venueId, venueId),
          ),
        ),
      db.insert(contributorAuditEvents).values({
        id: crypto.randomUUID(),
        venueId,
        contributorId: current.id,
        actorUserId: actor.id,
        sourceKind: "contributor",
        sourceId: current.id,
        action: "updated",
        details: JSON.stringify({ changedFields }),
        createdAt: updatedAt,
      }),
    ]);
    return {
      data: toContributor({
        ...current,
        displayName: prepared.contributor.displayName,
        active: nextActive,
        updatedAt,
      }),
      error: null,
    };
  } catch (error: unknown) {
    await reportServerError("contributor.update", error);
    return { data: null, error: contributorError(error) };
  }
}

export async function setContributorSourceMapping(params: {
  venueId: string;
  sourceKind: "user" | "external_link";
  sourceId: string;
  contributorId: string | null;
}): Promise<ApiResponse<ContributorSourceMapping>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const venueId = await requireManagedVenueId(actor, params.venueId);
    if (
      (params.sourceKind !== "user" && params.sourceKind !== "external_link") ||
      !params.sourceId ||
      (params.contributorId !== null && !params.contributorId)
    ) {
      throw new ContributorActionError("INVALID_INPUT");
    }
    const db = getDb();

    if (params.contributorId) {
      const [contributor] = await db
        .select({ id: venueContributors.id })
        .from(venueContributors)
        .where(
          and(
            eq(venueContributors.id, params.contributorId),
            eq(venueContributors.venueId, venueId),
            eq(venueContributors.active, true),
          ),
        )
        .limit(1);
      if (!contributor) throw new ContributorActionError("CONTRIBUTOR_NOT_FOUND");
    }

    const source =
      params.sourceKind === "user"
        ? (
            await db
              .select({ contributorId: users.contributorId })
              .from(users)
              .where(
                and(
                  eq(users.id, params.sourceId),
                  eq(users.venueId, venueId),
                  isNull(users.deletedAt),
                ),
              )
              .limit(1)
          )[0]
        : (
            await db
              .select({ contributorId: externalDjLinks.contributorId })
              .from(externalDjLinks)
              .where(
                and(
                  eq(externalDjLinks.id, params.sourceId),
                  eq(externalDjLinks.venueId, venueId),
                  isNull(externalDjLinks.deletedAt),
                ),
              )
              .limit(1)
          )[0];
    if (!source) throw new ContributorActionError("SOURCE_NOT_FOUND");
    if (source.contributorId === params.contributorId) {
      return { data: params, error: null };
    }

    const createdAt = new Date().toISOString();
    const mappingUpdate =
      params.sourceKind === "user"
        ? db
            .update(users)
            .set({ contributorId: params.contributorId })
            .where(
              and(
                eq(users.id, params.sourceId),
                eq(users.venueId, venueId),
                isNull(users.deletedAt),
              ),
            )
        : db
            .update(externalDjLinks)
            .set({ contributorId: params.contributorId })
            .where(
              and(
                eq(externalDjLinks.id, params.sourceId),
                eq(externalDjLinks.venueId, venueId),
                isNull(externalDjLinks.deletedAt),
              ),
            );
    await db.batch([
      mappingUpdate,
      db.insert(contributorAuditEvents).values({
        id: crypto.randomUUID(),
        venueId,
        contributorId: params.contributorId,
        actorUserId: actor.id,
        sourceKind: params.sourceKind,
        sourceId: params.sourceId,
        action: params.contributorId ? "mapped" : "unmapped",
        details: JSON.stringify({ previousContributorId: source.contributorId }),
        createdAt,
      }),
    ]);
    return { data: params, error: null };
  } catch (error: unknown) {
    await reportServerError("contributor.map_source", error);
    return { data: null, error: contributorError(error) };
  }
}

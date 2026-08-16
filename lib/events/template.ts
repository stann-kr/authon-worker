export interface EventTemplateSourceLink {
  id: string;
  token: string;
  djName: string;
  contributorId: string | null;
  maxGuests: number;
  localeMode: string;
  kind: string;
}

export interface EventTemplateSourceContributor {
  userId: string;
  guestLimit: number | null;
}

export function buildEventTemplateClonePlan(params: {
  eventId: string;
  venueId: string;
  sourceEventId: string;
  eventName: string;
  businessDate: string;
  actorUserId: string;
  createdAt: string;
  contributors: readonly EventTemplateSourceContributor[];
  links: readonly EventTemplateSourceLink[];
  createOpaqueId: () => string;
}) {
  const expiresAt = new Date(`${params.businessDate}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("INVALID_TEMPLATE_DATE");
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
  const seenTokens = new Set<string>();
  const links = params.links.map((source) => {
    if (source.kind !== "self_rsvp" && !source.contributorId) {
      throw new Error("INVALID_TEMPLATE_CONTRIBUTOR");
    }
    const id = params.createOpaqueId();
    const token = params.createOpaqueId();
    if (!id || !token || token === source.token || seenTokens.has(token)) {
      throw new Error("INVALID_TEMPLATE_CREDENTIAL");
    }
    seenTokens.add(token);
    return {
      id,
      venueId: params.venueId,
      token,
      djName: source.djName,
      contributorId:
        source.kind === "self_rsvp" ? null : source.contributorId,
      event: params.eventName,
      date: params.businessDate,
      eventId: params.eventId,
      maxGuests: source.maxGuests,
      usedGuests: 0,
      active: false,
      expiresAt: expiresAt.toISOString(),
      createdBy: params.actorUserId,
      localeMode: source.localeMode,
      kind: source.kind === "self_rsvp" ? "self_rsvp" as const : "contributor" as const,
      createdAt: params.createdAt,
    };
  });
  return {
    contributors: params.contributors.map((contributor) => ({
      eventId: params.eventId,
      venueId: params.venueId,
      userId: contributor.userId,
      guestLimit: contributor.guestLimit,
      sourceEventId: params.sourceEventId,
      createdByUserId: params.actorUserId,
      createdAt: params.createdAt,
    })),
    links,
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import { buildEventTemplateClonePlan } from "./template.ts";

test("template clone preserves contributor limits but creates inert links with new credentials", () => {
  const ids = ["new-link", "new-token"];
  const plan = buildEventTemplateClonePlan({
    eventId: "target",
    venueId: "venue-a",
    sourceEventId: "source",
    eventName: "Next Night",
    businessDate: "2026-08-20",
    actorUserId: "admin-a",
    createdAt: "2026-08-13T15:00:00.000Z",
    contributors: [{ userId: "dj-a", guestLimit: 12 }],
    links: [{
      id: "old-link",
      token: "old-token",
      djName: "DJ A",
      maxGuests: 8,
      localeMode: "ko",
    }],
    createOpaqueId: () => ids.shift(),
  });

  assert.deepEqual(plan.contributors[0], {
    eventId: "target",
    venueId: "venue-a",
    userId: "dj-a",
    guestLimit: 12,
    sourceEventId: "source",
    createdByUserId: "admin-a",
    createdAt: "2026-08-13T15:00:00.000Z",
  });
  assert.deepEqual(
    {
      id: plan.links[0].id,
      token: plan.links[0].token,
      usedGuests: plan.links[0].usedGuests,
      active: plan.links[0].active,
      eventId: plan.links[0].eventId,
      date: plan.links[0].date,
      event: plan.links[0].event,
    },
    {
      id: "new-link",
      token: "new-token",
      usedGuests: 0,
      active: false,
      eventId: "target",
      date: "2026-08-20",
      event: "Next Night",
    },
  );
  assert.notEqual(plan.links[0].token, "old-token");
});

test("template clone rejects accidental token reuse", () => {
  assert.throws(
    () => buildEventTemplateClonePlan({
      eventId: "target",
      venueId: "venue-a",
      sourceEventId: "source",
      eventName: "Next Night",
      businessDate: "2026-08-20",
      actorUserId: "admin-a",
      createdAt: "2026-08-13T15:00:00.000Z",
      contributors: [],
      links: [{
        id: "old-link",
        token: "old-token",
        djName: "DJ A",
        maxGuests: 8,
        localeMode: "auto",
      }],
      createOpaqueId: () => "old-token",
    }),
    /INVALID_TEMPLATE_CREDENTIAL/,
  );
});

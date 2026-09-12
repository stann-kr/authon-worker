import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuestBatch,
  deleteManagedGuest,
  listAllGuests,
  listGuestsByDate,
  restoreManagedGuest,
  updateManagedGuest,
  updateManagedGuestStatus,
} from "./service.ts";

const NOW = "2026-08-20T12:00:00.000Z";

function actor(overrides = {}) {
  return {
    id: "staff-a",
    role: "staff",
    venueId: "venue-a",
    guestLimit: 3,
    accountKind: "personal",
    doorAccessEnabled: false,
    sessionVersion: 1,
    ...overrides,
  };
}

function guest(overrides = {}) {
  return {
    id: "guest-a",
    venueId: "venue-a",
    name: "Guest A",
    externalLinkId: null,
    createdByUserId: "staff-a",
    eventId: "event-a",
    date: "2026-08-20",
    status: "pending",
    ...overrides,
  };
}

function fullGuest(overrides = {}) {
  const current = guest(overrides);
  return {
    ...current,
    email: null,
    instagram: null,
    registeredByName: null,
    checkInTime: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function event(overrides = {}) {
  return {
    id: "event-a",
    venueId: "venue-a",
    businessDate: "2026-08-20",
    templateSourceEventId: null,
    ...overrides,
  };
}

function createFakePersistence(current = guest()) {
  const calls = [];
  const persistence = {
    async listByDate(input) {
      calls.push(["listByDate", input]);
      return [];
    },
    async listAll(input) {
      calls.push(["listAll", input]);
      return [];
    },
    async loadGuest(id) {
      calls.push(["loadGuest", id]);
      return current?.id === id ? current : null;
    },
    async readGuest(id, venueId) {
      calls.push(["readGuest", { id, venueId }]);
      return fullGuest({ ...current, id, venueId });
    },
    async listExistingNames(input) {
      calls.push(["listExistingNames", input]);
      return [];
    },
    async createBulk(input) {
      calls.push(["createBulk", input]);
      return input.pending.map((item) => ({
        id: item.id,
        guest: fullGuest({ id: item.id, name: item.name }),
        concurrentDuplicate: false,
      }));
    },
    async findStatusRequest(input) {
      calls.push(["findStatusRequest", input]);
      return null;
    },
    async hasPreviousEntry(input) {
      calls.push(["hasPreviousEntry", input]);
      return false;
    },
    async persistStatusActivity(input) {
      calls.push(["persistStatusActivity", input]);
      return {
        outcome: "applied",
        guestId: input.guestId,
        status: "checked",
        checkInTime: NOW,
        activityId: "activity-a",
      };
    },
    async softDelete(input) {
      calls.push(["softDelete", input]);
      return fullGuest({ ...current, status: "deleted" });
    },
    async permanentlyDelete(input) {
      calls.push(["permanentlyDelete", input]);
    },
    async updateDetails(input) {
      calls.push(["updateDetails", input]);
      return fullGuest({
        ...current,
        venueId: input.nextVenueId,
        name: input.nextName,
        date: input.nextDate,
        eventId: input.eventId,
      });
    },
    async restore(input) {
      calls.push(["restore", input]);
      return fullGuest({ ...current, status: "pending" });
    },
  };
  return { persistence, calls };
}

function createDependencies(persistence, overrides = {}) {
  let nextId = 0;
  return {
    persistence,
    requireActiveVenueId: async (venueId) => venueId,
    loadEventForRosterReadById: async () => event(),
    findCompatibilityEvent: async () => event(),
    resolveEventForRosterRead: async () => event(),
    resolveEventForRosterWrite: async () => event(),
    eventIncludesLegacyDateRows: () => true,
    getOrCreateEventContributorGuestLimit: async ({ actor: currentActor }) =>
      currentActor.guestLimit,
    now: () => new Date(NOW),
    createId: () => `id-${nextId++}`,
    ...overrides,
  };
}

test("list scope uses exact explicit Events and compatibility legacy rows", async () => {
  const explicit = createFakePersistence();
  await listGuestsByDate(
    {
      actor: actor({ role: "super_admin", venueId: null }),
      date: "2026-08-20",
      eventId: "event-a",
    },
    createDependencies(explicit.persistence),
  );
  assert.deepEqual(explicit.calls.at(-1), [
    "listByDate",
    {
      date: "2026-08-20",
      venueId: "venue-a",
      eventId: "event-a",
      includeLegacyDateRows: false,
    },
  ]);

  const compatibility = createFakePersistence();
  await listGuestsByDate(
    { actor: actor({ role: "door_staff" }), date: "2026-08-20" },
    createDependencies(compatibility.persistence),
  );
  assert.equal(
    compatibility.calls.at(-1)[1].includeLegacyDateRows,
    true,
  );
});

test("service rechecks roster and status access before persistence I/O", async () => {
  const { persistence, calls } = createFakePersistence();
  const dependencies = createDependencies(persistence);

  await assert.rejects(
    listGuestsByDate(
      { actor: actor(), date: "2026-08-20" },
      dependencies,
    ),
    /Forbidden/,
  );
  await assert.rejects(
    listAllGuests(
      {
        actor: actor({ role: "door_staff" }),
        requestedVenueId: "venue-a",
      },
      dependencies,
    ),
    /Forbidden/,
  );
  await assert.rejects(
    updateManagedGuestStatus(
      {
        actor: actor(),
        guestId: "guest-a",
        status: "checked",
        idempotencyKey: "unauthorized",
        sessionKeyHash: null,
      },
      dependencies,
    ),
    /Forbidden/,
  );
  assert.deepEqual(calls, []);
});

test("bulk creation uses Guest Limits and maps duplicate and quota outcomes", async () => {
  const { persistence, calls } = createFakePersistence();
  persistence.listExistingNames = async () => ["Alice"];
  persistence.createBulk = async (input) => {
    calls.push(["createBulk", input]);
    return input.pending.map((item) => ({
      id: item.id,
      guest: item.name === "BOB" ? fullGuest({ id: item.id, name: item.name }) : null,
      concurrentDuplicate: item.name === "CAROL",
    }));
  };
  const quotaCalls = [];
  const result = await createGuestBatch(
    {
      actor: actor(),
      venueId: "venue-a",
      date: "2026-08-20",
      items: [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Carol" },
        { name: "Dan", allowDuplicate: true },
      ],
    },
    createDependencies(persistence, {
      getOrCreateEventContributorGuestLimit: async (input) => {
        quotaCalls.push(input);
        return 3;
      },
    }),
  );

  assert.deepEqual(
    result.data.items.map((item) => item.status),
    [
      "duplicate_requires_confirmation",
      "created",
      "duplicate_requires_confirmation",
      "limit_reached",
    ],
  );
  assert.equal(quotaCalls.length, 1);
  assert.equal(quotaCalls[0].event.id, "event-a");
  assert.equal(calls.find(([name]) => name === "createBulk")[1].baseGuestLimit, 3);
});

test("shared account bulk creation requires the operator display name", async () => {
  const { persistence } = createFakePersistence();
  const result = await createGuestBatch(
    {
      actor: actor({ accountKind: "shared" }),
      venueId: "venue-a",
      date: "2026-08-20",
      items: [{ name: "Guest" }],
    },
    createDependencies(persistence),
  );
  assert.deepEqual(result, { data: null, error: "REGISTERED_BY_REQUIRED" });
});

test("new status changes use the writable Event once and reject closed Events before persisting", async () => {
  for (const closed of [false, true]) {
    const fake = createFakePersistence();
    let eventReads = 0;
    const dependencies = createDependencies(fake.persistence, {
      resolveEventForRosterRead: async () => {
        assert.fail("A new mutation must resolve the writable Event directly");
      },
      resolveEventForRosterWrite: async (input) => {
        eventReads += 1;
        assert.equal(input.venueId, "venue-a");
        assert.equal(input.eventId, "event-a");
        assert.equal(input.purpose, "check_in");
        if (closed) throw new Error("EVENT_NOT_ACTIVE");
        return event();
      },
    });
    const pending = updateManagedGuestStatus({
      actor: actor({ role: "door_staff" }),
      guestId: "guest-a", status: "checked",
      idempotencyKey: "new-status", sessionKeyHash: null,
    }, dependencies);
    if (closed) {
      await assert.rejects(pending, /EVENT_NOT_ACTIVE/);
      assert.equal(fake.calls.some(([name]) => name === "persistStatusActivity"), false);
    } else {
      assert.equal((await pending).data.status, "checked");
    }
    assert.equal(eventReads, 1);
  }
});

test("status replay preserves the original action and ledger outcome mapping", async () => {
  const { persistence, calls } = createFakePersistence();
  persistence.findStatusRequest = async () => ({
    guestId: "guest-a",
    action: "re_entry",
  });
  const result = await updateManagedGuestStatus(
    {
      actor: actor({ role: "door_staff" }),
      guestId: "guest-a",
      status: "checked",
      idempotencyKey: "retry-a",
      sessionKeyHash: "session-hash",
    },
    createDependencies(persistence, {
      resolveEventForRosterRead: async () => event({ state: "closed" }),
      resolveEventForRosterWrite: async () => {
        assert.fail("Replaying a saved request must not require an open Event");
      },
    }),
  );
  const write = calls.find(([name]) => name === "persistStatusActivity")[1];
  assert.equal(write.action, "re_entry");
  assert.equal(write.channel, "door");
  assert.equal(result.data.status, "checked");

  persistence.persistStatusActivity = async () => ({
    outcome: "conflict",
    guestId: null,
    status: null,
    checkInTime: null,
    activityId: "conflict-a",
  });
  const conflict = await updateManagedGuestStatus(
    {
      actor: actor({ role: "door_staff" }),
      guestId: "guest-a",
      status: "checked",
      idempotencyKey: "retry-b",
      sessionKeyHash: null,
    },
    createDependencies(persistence),
  );
  assert.deepEqual(conflict, { data: null, error: "IDEMPOTENCY_CONFLICT" });
});

test("guest ownership and external-link scope remain enforced before writes", async () => {
  const foreign = createFakePersistence(guest({ createdByUserId: "staff-b" }));
  await assert.rejects(
    deleteManagedGuest(
      { actor: actor(), guestId: "guest-a", sessionKeyHash: null },
      createDependencies(foreign.persistence),
    ),
    /Forbidden/,
  );

  const external = createFakePersistence(guest({ externalLinkId: "link-a" }));
  const result = await updateManagedGuest(
    {
      actor: actor({ role: "venue_admin" }),
      guestId: "guest-a",
      updates: { date: "2026-08-21" },
      sessionKeyHash: null,
    },
    createDependencies(external.persistence),
  );
  assert.deepEqual(result, {
    data: null,
    error: "EXTERNAL_GUEST_SCOPE_LOCKED",
  });

  const restore = await restoreManagedGuest(
    {
      actor: actor({ role: "venue_admin" }),
      guestId: "guest-a",
      sessionKeyHash: null,
    },
    createDependencies(external.persistence),
  );
  assert.deepEqual(restore, {
    data: null,
    error: "EXTERNAL_GUEST_RESTORE_UNSUPPORTED",
  });
});

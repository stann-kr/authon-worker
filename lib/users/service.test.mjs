import assert from "node:assert/strict";
import test from "node:test";

import { UserOperationError } from "./errors.ts";
import {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  listUserDirectory,
  loadManagedUserForCredentialOperation,
  updateManagedUserProfile,
} from "./service.ts";

const NOW = "2026-08-20T12:00:00.000Z";

function user(overrides = {}) {
  return {
    id: "staff-a",
    venueId: "venue-a",
    email: "staff@example.com",
    name: "Staff A",
    role: "staff",
    accountKind: "personal",
    doorAccessEnabled: false,
    guestLimit: 10,
    active: true,
    migrationStatus: "active",
    preferredLocale: "ko",
    passwordSetAt: NOW,
    createdAt: NOW,
    lastLoginAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function actor(overrides = {}) {
  return {
    id: "admin-a",
    role: "venue_admin",
    venueId: "venue-a",
    ...overrides,
  };
}

function createFakePersistence(initialUser = user()) {
  let currentUser = initialUser;
  const calls = [];
  const persistence = {
    async listDirectory(input) {
      calls.push(["listDirectory", input]);
      return [];
    },
    async listManaged(input) {
      calls.push(["listManaged", input]);
      return [];
    },
    async listAuditEvents(input) {
      calls.push(["listAuditEvents", input]);
      return [];
    },
    async loadUser(userId) {
      calls.push(["loadUser", userId]);
      return currentUser?.id === userId ? currentUser : null;
    },
    async hasEmail(email) {
      calls.push(["hasEmail", email]);
      return false;
    },
    async hasAnotherActiveSuperAdmin(targetId) {
      calls.push(["hasAnotherActiveSuperAdmin", targetId]);
      return true;
    },
    async updateProfile(input) {
      calls.push(["updateProfile", input]);
      currentUser = { ...currentUser, ...input.values };
    },
    async createUser(input) {
      calls.push(["createUser", input]);
    },
    async deleteUser(input) {
      calls.push(["deleteUser", input]);
    },
  };
  return { persistence, calls };
}

function assertUserError(code) {
  return (error) => error instanceof UserOperationError && error.code === code;
}

test("directory and managed lists derive tenant scope from the actor", async () => {
  const { persistence, calls } = createFakePersistence();
  await listUserDirectory(
    { actor: actor(), requestedVenueId: "venue-b" },
    persistence,
  );
  await listUserDirectory(
    {
      actor: actor({ id: "super", role: "super_admin", venueId: null }),
      requestedVenueId: "venue-b",
    },
    persistence,
  );
  await listManagedUsers({ actor: actor() }, persistence);

  assert.deepEqual(calls.slice(0, 3), [
    [
      "listDirectory",
      { venueId: "venue-a", excludeSuperAdmins: true },
    ],
    [
      "listDirectory",
      { venueId: "venue-b", excludeSuperAdmins: false },
    ],
    [
      "listManaged",
      {
        venueId: "venue-a",
        roles: ["door_staff", "staff", "dj"],
      },
    ],
  ]);
});

test("profile transitions preserve self, tenant, session, credential, and audit rules", async () => {
  const { persistence, calls } = createFakePersistence();
  const activeVenues = [];
  const updated = await updateManagedUserProfile(
    {
      actor: actor(),
      userId: "staff-a",
      updates: { role: "dj", active: false },
    },
    {
      persistence,
      requireActiveVenueId: async (venueId) => {
        activeVenues.push(venueId);
        return venueId;
      },
      now: () => new Date(NOW),
      createId: () => "audit-a",
    },
  );
  assert.equal(updated.role, "dj");
  assert.equal(updated.active, false);
  assert.deepEqual(activeVenues, ["venue-a"]);

  const write = calls.find(([name]) => name === "updateProfile")[1];
  assert.deepEqual(write.values, { role: "dj", active: false });
  assert.equal(write.incrementsSessionVersion, true);
  assert.equal(write.invalidatesCredentials, true);
  assert.equal(write.audit.action, "user_updated");
  assert.deepEqual(write.audit.details, {
    fields: ["role", "active"],
    previousRole: "staff",
    nextRole: "dj",
  });

  const self = createFakePersistence(user({ id: "admin-a" }));
  await assert.rejects(
    updateManagedUserProfile(
      {
        actor: actor(),
        userId: "admin-a",
        updates: { active: false },
      },
      {
        persistence: self.persistence,
        requireActiveVenueId: async (venueId) => venueId,
      },
    ),
    assertUserError("CANNOT_MANAGE_SELF"),
  );

  const crossVenue = createFakePersistence(user({ venueId: "venue-b" }));
  await assert.rejects(
    updateManagedUserProfile(
      { actor: actor(), userId: "staff-a", updates: { name: "Changed" } },
      {
        persistence: crossVenue.persistence,
        requireActiveVenueId: async (venueId) => venueId,
      },
    ),
    assertUserError("FORBIDDEN"),
  );
});

test("the last active super admin cannot be deactivated", async () => {
  const target = user({
    id: "super-target",
    venueId: null,
    role: "super_admin",
  });
  const { persistence } = createFakePersistence(target);
  persistence.hasAnotherActiveSuperAdmin = async () => false;

  await assert.rejects(
    updateManagedUserProfile(
      {
        actor: actor({ id: "super-actor", role: "super_admin", venueId: null }),
        userId: target.id,
        updates: { active: false },
      },
      {
        persistence,
        requireActiveVenueId: async (venueId) => venueId,
      },
    ),
    assertUserError("LAST_SUPER_ADMIN"),
  );
});

test("user creation normalizes identity and obtains invitation credentials from Auth", async () => {
  const { persistence, calls } = createFakePersistence();
  const ids = ["user-new", "audit-new"];
  const result = await createManagedUser(
    {
      actor: actor(),
      params: {
        email: "  NEW@Example.COM ",
        name: "  Shared Door  ",
        role: "staff",
        accountKind: "shared",
        doorAccessEnabled: true,
        guestLimit: 12,
        preferredLocale: "ko",
      },
    },
    {
      persistence,
      requireActiveVenueId: async (venueId) => venueId,
      prepareAccountInvitation: async () => ({
        passwordHash: "inactive-password-hash",
        invitation: {
          id: "invite-new",
          tokenHash: "invite-token-hash",
          expiresAt: "2026-08-27T12:00:00.000Z",
          url: "https://example.com/setup",
        },
      }),
      now: () => new Date(NOW),
      createId: () => ids.shift(),
    },
  );

  assert.deepEqual(result, {
    id: "user-new",
    invitationUrl: "https://example.com/setup",
    expiresAt: "2026-08-27T12:00:00.000Z",
  });
  const write = calls.find(([name]) => name === "createUser")[1];
  assert.equal(write.user.email, "new@example.com");
  assert.equal(write.user.name, "Shared Door");
  assert.equal(write.user.accountKind, "shared");
  assert.equal(write.user.doorAccessEnabled, true);
  assert.equal(write.invitation.tokenHash, "invite-token-hash");
});

test("credential and deletion operations retain managed-target and inactive-only gates", async () => {
  const active = createFakePersistence();
  await loadManagedUserForCredentialOperation(
    { actor: actor(), userId: "staff-a" },
    {
      persistence: active.persistence,
      requireActiveVenueId: async (venueId) => venueId,
    },
  );
  await assert.rejects(
    deleteManagedUser(
      { actor: actor(), userId: "staff-a" },
      {
        persistence: active.persistence,
        requireActiveVenueId: async (venueId) => venueId,
        createDeletedPasswordHash: async () => "deleted-hash",
      },
    ),
    assertUserError("USER_MUST_BE_INACTIVE"),
  );

  const inactive = createFakePersistence(user({ active: false }));
  await deleteManagedUser(
    { actor: actor(), userId: "staff-a" },
    {
      persistence: inactive.persistence,
      requireActiveVenueId: async (venueId) => venueId,
      createDeletedPasswordHash: async () => "deleted-hash",
      now: () => new Date(NOW),
      createId: () => "delete-audit",
    },
  );
  const write = inactive.calls.find(([name]) => name === "deleteUser")[1];
  assert.equal(write.passwordHash, "deleted-hash");
  assert.equal(write.tombstoneEmail, "deleted+staff-a@deleted.invalid");
  assert.equal(write.deletedAt, NOW);
});

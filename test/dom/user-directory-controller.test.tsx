import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import {
  useUserDirectoryController,
  type UserDirectoryControllerActions,
} from "@/app/admin/components/useUserDirectoryController";
import type { User } from "@/lib/users/types";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

const USER_A: User = {
  id: "user-a",
  venueId: "venue-a",
  email: "alpha@example.com",
  name: "Alpha Admin",
  role: "venue_admin",
  accountKind: "personal",
  doorAccessEnabled: false,
  guestLimit: null,
  active: true,
  migrationStatus: "native",
  preferredLocale: "en",
  passwordSetAt: "2026-08-20T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  lastLoginAt: null,
  deletedAt: null,
};

const USER_B: User = {
  ...USER_A,
  id: "user-b",
  venueId: "venue-b",
  email: "beta@example.com",
  name: "Beta Door",
  role: "door_staff",
  accountKind: "shared",
  doorAccessEnabled: true,
  migrationStatus: "pending_reset",
  passwordSetAt: null,
};

const USER_INACTIVE: User = {
  ...USER_A,
  id: "user-inactive",
  email: "inactive@example.com",
  name: "Inactive Staff",
  role: "staff",
  active: false,
};

const USER_DELETED: User = {
  ...USER_A,
  id: "user-deleted",
  email: "old@example.com",
  name: "Old Shared DJ",
  role: "dj",
  accountKind: "shared",
  deletedAt: "2026-08-22T00:00:00.000Z",
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createActions(
  overrides: Partial<UserDirectoryControllerActions> = {},
): UserDirectoryControllerActions {
  return {
    fetchManagedUsersByVenue: async () => ({ data: [], error: null }),
    fetchUserAuditEvents: async () => ({ data: [], error: null }),
    updateUserProfile: async () => ({ data: USER_A, error: null }),
    deleteUserViaEdge: async () => ({ error: null }),
    issueManagedPasswordLinkViaEdge: async () => ({
      data: {
        linkKind: "password_reset",
        passwordUrl: "https://example.com/reset",
        expiresAt: "2026-08-24T00:00:00.000Z",
      },
      error: null,
    }),
    ...overrides,
  };
}

interface HarnessProps {
  actions: UserDirectoryControllerActions;
  effectiveVenueId?: string;
  isSuperAdmin?: boolean;
  onController?: (
    controller: ReturnType<typeof useUserDirectoryController>,
  ) => void;
}

function UserDirectoryHarness({
  actions,
  effectiveVenueId = "venue-a",
  isSuperAdmin = false,
  onController,
}: HarnessProps) {
  const controller = useUserDirectoryController({
    actions,
    effectiveVenueId,
    isActive: true,
    isSuperAdmin,
  });
  onController?.(controller);

  return (
    <main id="directory-test-main">
      <output data-testid="state">{controller.listState}</output>
      <output data-testid="loading">
        {String(controller.isCurrentScopeLoading)}
      </output>
      <output data-testid="users">
        {controller.scopedUsers.map((user) => user.name).join(",")}
      </output>
      <output data-testid="filtered">
        {controller.filteredUsers.map((user) => user.name).join(",")}
      </output>
      <output data-testid="current-count">{controller.currentUsers.length}</output>
      <output data-testid="audit-count">
        {controller.scopedAuditEvents.length}
      </output>
      <output data-testid="load-error">{controller.loadError}</output>
      <output data-testid="busy">{controller.busyUserId ?? ""}</output>
      <output data-testid="feedback-type">
        {controller.scopedFeedback?.type ?? ""}
      </output>
      <output data-testid="feedback">
        {controller.scopedFeedback?.message ?? ""}
      </output>
      <output data-testid="pending">
        {controller.pendingUserAction?.kind ?? ""}
      </output>
      {controller.scopedPasswordLink && (
        <section
          ref={controller.passwordLinkPanelRef}
          data-testid="password-link-panel"
          tabIndex={-1}
        >
          {controller.scopedPasswordLink.passwordUrl}
        </section>
      )}
    </main>
  );
}

function harnessTree(props: HarnessProps) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>
        <UserDirectoryHarness {...props} />
      </RouteTransitionProvider>
    </NextIntlClientProvider>
  );
}

function renderHarness(props: HarnessProps) {
  return render(harnessTree(props));
}

afterEach(cleanup);

test("super-admin user and audit loads start in parallel and retain a partial result", async () => {
  const usersRequest = createDeferred<{
    data: User[];
    error: null;
  }>();
  const auditRequest = createDeferred<{
    data: null;
    error: string;
  }>();
  const started: string[] = [];
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => {
        started.push("users");
        return usersRequest.promise;
      },
      fetchUserAuditEvents: async () => {
        started.push("audit");
        return auditRequest.promise;
      },
    }),
    isSuperAdmin: true,
  });

  await waitFor(() => assert.deepEqual(started, ["users", "audit"]));
  await act(async () => {
    usersRequest.resolve({ data: [USER_A], error: null });
    auditRequest.resolve({ data: null, error: "AUDIT_FAILED" });
    await Promise.all([usersRequest.promise, auditRequest.promise]);
  });

  assert.equal(screen.getByTestId("users").textContent, USER_A.name);
  assert.equal(screen.getByTestId("audit-count").textContent, "0");
  assert.equal(screen.getByTestId("state").textContent, "partial");
  assert.equal(
    screen.getByTestId("load-error").textContent,
    "Users loaded, but recent account activity is unavailable. Please refresh.",
  );
});

test("an A-scope response cannot replace the loaded B-scope directory", async () => {
  const venueARequest = createDeferred<{ data: User[]; error: null }>();
  const venueBRequest = createDeferred<{ data: User[]; error: null }>();
  const actions = createActions({
    fetchManagedUsersByVenue: async (venueId) =>
      venueId === "venue-a" ? venueARequest.promise : venueBRequest.promise,
  });
  const view = renderHarness({ actions, effectiveVenueId: "venue-a" });

  view.rerender(harnessTree({ actions, effectiveVenueId: "venue-b" }));
  await act(async () => {
    venueBRequest.resolve({ data: [USER_B], error: null });
    await venueBRequest.promise;
  });
  assert.equal(screen.getByTestId("users").textContent, USER_B.name);

  await act(async () => {
    venueARequest.resolve({ data: [USER_A], error: null });
    await venueARequest.promise;
  });
  assert.equal(screen.getByTestId("users").textContent, USER_B.name);
  assert.equal(screen.getByTestId("loading").textContent, "false");
});

test("a same-tick mutation duplicate is synchronously latched and refreshes once", async () => {
  const mutationRequest = createDeferred<{ data: User; error: null }>();
  const updateCalls: Array<{
    userId: string;
    updates: Parameters<UserDirectoryControllerActions["updateUserProfile"]>[1];
  }> = [];
  let loadCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const actions = createActions({
    fetchManagedUsersByVenue: async () => {
      loadCalls += 1;
      return { data: [USER_A], error: null };
    },
    updateUserProfile: async (userId, updates) => {
      updateCalls.push({ userId, updates });
      return mutationRequest.promise;
    },
  });
  renderHarness({
    actions,
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() => assert.equal(loadCalls, 1));

  const updates = {
    name: "Alpha Updated",
    guestLimit: 12,
    role: "venue_admin" as const,
    accountKind: "personal" as const,
    doorAccessEnabled: true,
  };
  let firstResult!: Promise<boolean>;
  let duplicateResult!: Promise<boolean>;
  await act(async () => {
    firstResult = controller!.handleUserUpdate(USER_A.id, updates);
    duplicateResult = controller!.handleUserUpdate(USER_A.id, updates);
    await Promise.resolve();
  });

  assert.deepEqual(updateCalls, [{ userId: USER_A.id, updates }]);
  assert.equal(await duplicateResult, false);
  assert.equal(screen.getByTestId("busy").textContent, USER_A.id);

  await act(async () => {
    mutationRequest.resolve({ data: { ...USER_A, ...updates }, error: null });
    assert.equal(await firstResult, true);
  });
  assert.equal(loadCalls, 2);
  assert.equal(screen.getByTestId("busy").textContent, "");
  assert.equal(screen.getByTestId("feedback-type").textContent, "success");
  assert.equal(
    screen.getByTestId("feedback").textContent,
    "User information updated.",
  );
});

test("credential confirmation issues the exact user link, refreshes, and focuses it", async () => {
  const issuedUserIds: string[] = [];
  let loadCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const actions = createActions({
    fetchManagedUsersByVenue: async () => {
      loadCalls += 1;
      return { data: [USER_A], error: null };
    },
    issueManagedPasswordLinkViaEdge: async (userId) => {
      issuedUserIds.push(userId);
      return {
        data: {
          linkKind: "password_reset",
          passwordUrl: "https://example.com/reset-user-a",
          expiresAt: "2026-08-24T00:00:00.000Z",
        },
        error: null,
      };
    },
  });
  renderHarness({
    actions,
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() => assert.equal(loadCalls, 1));

  act(() => {
    controller!.setPendingUserAction({
      kind: "reset-password",
      user: USER_A,
    });
  });
  await act(async () => {
    await controller!.confirmPendingUserAction();
  });

  assert.deepEqual(issuedUserIds, [USER_A.id]);
  assert.equal(loadCalls, 2);
  assert.equal(screen.getByTestId("pending").textContent, "");
  assert.equal(
    screen.getByTestId("password-link-panel").textContent,
    "https://example.com/reset-user-a",
  );
  assert.equal(
    screen.getByTestId("feedback").textContent,
    "Previous reset credentials revoked and a new one-time link issued.",
  );
  await waitFor(() =>
    assert.equal(
      document.activeElement === screen.getByTestId("password-link-panel"),
      true,
    ),
  );
});

test("confirm error mapping and directory filters preserve the derived list state", async () => {
  const deletedUserIds: string[] = [];
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => ({
        data: [USER_A, USER_B, USER_INACTIVE, USER_DELETED],
        error: null,
      }),
      deleteUserViaEdge: async (userId) => {
        deletedUserIds.push(userId);
        return { error: "USER_MUST_BE_INACTIVE" };
      },
    }),
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("state").textContent, "success-data"),
  );
  assert.equal(screen.getByTestId("current-count").textContent, "3");

  act(() => {
    controller!.setSearchQuery("old");
    controller!.setRoleFilter("shared");
    controller!.setStatusFilter("deleted");
  });
  assert.equal(screen.getByTestId("filtered").textContent, USER_DELETED.name);
  assert.equal(screen.getByTestId("state").textContent, "success-data");

  act(() => {
    controller!.setPendingUserAction({ kind: "delete", user: USER_A });
  });
  assert.equal(screen.getByTestId("pending").textContent, "delete");
  await act(async () => {
    await controller!.confirmPendingUserAction();
  });

  assert.deepEqual(deletedUserIds, [USER_A.id]);
  assert.equal(screen.getByTestId("pending").textContent, "");
  assert.equal(screen.getByTestId("feedback-type").textContent, "error");
  assert.equal(
    screen.getByTestId("feedback").textContent,
    "Deactivate the account before deleting it.",
  );
});

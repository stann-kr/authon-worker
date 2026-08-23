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
import ConfirmDialog from "@/components/ConfirmDialog";
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

const SETUP_MAIN_CONTENT = document.getElementById("main-content");

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

function installClipboard(writeText: (url: string) => Promise<void>) {
  const descriptors = {
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    canShare: Object.getOwnPropertyDescriptor(navigator, "canShare"),
  };
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  return () => {
    for (const key of ["clipboard", "share", "canShare"] as const) {
      const descriptor = descriptors[key];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
  };
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
  onSnapshot?: (
    scopeKey: string,
    controller: ReturnType<typeof useUserDirectoryController>,
  ) => void;
}

function UserDirectoryHarness({
  actions,
  effectiveVenueId = "venue-a",
  isSuperAdmin = false,
  onController,
  onSnapshot,
}: HarnessProps) {
  const controller = useUserDirectoryController({
    actions,
    effectiveVenueId,
    isActive: true,
    isSuperAdmin,
  });
  onController?.(controller);
  onSnapshot?.(effectiveVenueId, controller);
  const deleteTarget = controller.scopedUsers.find(
    (user) => user.id === USER_INACTIVE.id,
  );

  return (
    <main id="main-content">
      <input
        ref={controller.directoryFocusFallbackRef}
        data-testid="directory-focus-fallback"
        type="text"
        aria-label="Directory fallback"
      />
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
      <output data-testid="mutation-pending">
        {String(controller.isUserMutationPending)}
      </output>
      <output data-testid="feedback-type">
        {controller.scopedFeedback?.type ?? ""}
      </output>
      <output data-testid="feedback">
        {controller.scopedFeedback?.message ?? ""}
      </output>
      <output data-testid="pending">
        {controller.pendingUserAction?.kind ?? ""}
      </output>
      <output data-testid="sharing">
        {String(controller.isSharingPasswordLink)}
      </output>
      {deleteTarget && (
        <button
          data-testid="delete-opener"
          type="button"
          onClick={() =>
            controller.setPendingUserAction({
              kind: "delete",
              user: deleteTarget,
            })
          }
        >
          Delete user
        </button>
      )}
      {controller.pendingUserAction && (
        <ConfirmDialog
          open
          title="Confirm user action"
          description="Confirm the pending user action."
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={() => void controller.confirmPendingUserAction()}
          onCancel={() => controller.setPendingUserAction(null)}
          isLoading={
            controller.busyUserId === controller.pendingUserAction.user.id
          }
        />
      )}
      {controller.scopedPasswordLink && (
        <section
          ref={controller.passwordLinkPanelRef}
          data-testid="password-link-panel"
          tabIndex={-1}
        >
          <span data-testid="password-link-url">
            {controller.scopedPasswordLink.passwordUrl}
          </span>
          <button
            data-testid="share-password-link"
            type="button"
            disabled={controller.isSharingPasswordLink}
            onClick={() => void controller.sharePasswordLink()}
          >
            Share
          </button>
          <button
            data-testid="close-password-link"
            type="button"
            onClick={controller.closePasswordLink}
          >
            Close
          </button>
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
  SETUP_MAIN_CONTENT?.removeAttribute("id");
  return render(harnessTree(props));
}

afterEach(() => {
  cleanup();
  SETUP_MAIN_CONTENT?.setAttribute("id", "main-content");
});

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

test("a rejected optional audit request keeps the super-admin user directory", async () => {
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => ({ data: [USER_A], error: null }),
      fetchUserAuditEvents: async () => {
        throw new Error("audit transport failed");
      },
    }),
    isSuperAdmin: true,
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("users").textContent, USER_A.name);
    assert.equal(screen.getByTestId("state").textContent, "partial");
  });
  assert.equal(screen.getByTestId("audit-count").textContent, "0");
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

test("a scope-wide mutation lease rejects another user's pending action", async () => {
  const mutationRequest = createDeferred<{ data: User; error: null }>();
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => ({
        data: [USER_A, USER_B],
        error: null,
      }),
      updateUserProfile: async () => mutationRequest.promise,
    }),
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("state").textContent, "success-data"),
  );

  let updatePromise!: Promise<boolean>;
  act(() => {
    updatePromise = controller!.handleUserUpdate(USER_A.id, {
      name: "Alpha Updated",
    });
    controller!.setPendingUserAction({ kind: "toggle", user: USER_B });
  });

  assert.equal(screen.getByTestId("mutation-pending").textContent, "true");
  assert.equal(screen.getByTestId("pending").textContent, "");

  await act(async () => {
    mutationRequest.resolve({ data: USER_A, error: null });
    await updatePromise;
  });
  assert.equal(screen.getByTestId("mutation-pending").textContent, "false");
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
    screen.getByTestId("password-link-url").textContent,
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

test("same-act password-link sharing has one synchronous owner and rendered disabled state", async () => {
  const copyRequest = createDeferred<void>();
  let copyCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const restoreClipboard = installClipboard(async () => {
    copyCalls += 1;
    return copyRequest.promise;
  });

  try {
    renderHarness({
      actions: createActions({
        fetchManagedUsersByVenue: async () => ({
          data: [USER_A],
          error: null,
        }),
      }),
      onController: (nextController) => {
        controller = nextController;
      },
    });
    await waitFor(() =>
      assert.equal(screen.getByTestId("state").textContent, "success-data"),
    );

    act(() => {
      controller!.setPendingUserAction({
        kind: "reset-password",
        user: USER_A,
      });
    });
    await act(async () => {
      await controller!.confirmPendingUserAction();
    });

    let firstShare!: Promise<void>;
    let duplicateShare!: Promise<void>;
    await act(async () => {
      firstShare = controller!.sharePasswordLink();
      duplicateShare = controller!.sharePasswordLink();
      await Promise.resolve();
    });
    const callsWhilePending = copyCalls;
    const disabledWhilePending = (
      screen.getByTestId("share-password-link") as HTMLButtonElement
    ).disabled;

    await act(async () => {
      copyRequest.resolve();
      await Promise.all([firstShare, duplicateShare]);
    });

    assert.equal(callsWhilePending, 1);
    assert.equal(disabledWhilePending, true);
    assert.equal(copyCalls, 1);
    assert.equal(screen.getByTestId("sharing").textContent, "false");
    assert.equal(
      screen.getByTestId("feedback").textContent,
      "One-time link copied.",
    );
  } finally {
    restoreClipboard();
  }
});

test("a stale share finally cannot release the active share owner in the next scope", async () => {
  const venueAShare = createDeferred<void>();
  const venueBShare = createDeferred<void>();
  const copiedUrls: string[] = [];
  const restoreClipboard = installClipboard(async (url) => {
    copiedUrls.push(url);
    return url.endsWith("venue-a") ? venueAShare.promise : venueBShare.promise;
  });
  let issueCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const actions = createActions({
    fetchManagedUsersByVenue: async (venueId) => ({
      data: [venueId === "venue-b" ? USER_B : USER_A],
      error: null,
    }),
    issueManagedPasswordLinkViaEdge: async () => {
      issueCalls += 1;
      return {
        data: {
          linkKind: "password_reset" as const,
          passwordUrl: `https://example.com/${
            issueCalls === 1 ? "venue-a" : "venue-b"
          }`,
          expiresAt: "2026-08-24T00:00:00.000Z",
        },
        error: null,
      };
    },
  });

  try {
    const view = renderHarness({
      actions,
      effectiveVenueId: "venue-a",
      onController: (nextController) => {
        controller = nextController;
      },
    });
    await waitFor(() =>
      assert.equal(screen.getByTestId("state").textContent, "success-data"),
    );
    act(() => {
      controller!.setPendingUserAction({
        kind: "reset-password",
        user: USER_A,
      });
    });
    await act(async () => {
      await controller!.confirmPendingUserAction();
    });
    let firstShare!: Promise<void>;
    act(() => {
      firstShare = controller!.sharePasswordLink();
    });
    await waitFor(() => assert.deepEqual(copiedUrls, ["https://example.com/venue-a"]));

    view.rerender(
      harnessTree({
        actions,
        effectiveVenueId: "venue-b",
        onController: (nextController) => {
          controller = nextController;
        },
      }),
    );
    await waitFor(() =>
      assert.equal(screen.getByTestId("state").textContent, "success-data"),
    );
    act(() => {
      controller!.setPendingUserAction({
        kind: "reset-password",
        user: USER_B,
      });
    });
    await act(async () => {
      await controller!.confirmPendingUserAction();
    });
    let secondShare!: Promise<void>;
    act(() => {
      secondShare = controller!.sharePasswordLink();
    });
    await waitFor(() =>
      assert.deepEqual(copiedUrls, [
        "https://example.com/venue-a",
        "https://example.com/venue-b",
      ]),
    );

    await act(async () => {
      venueAShare.resolve();
      await firstShare;
    });
    const nextScopeStillOwnsShare =
      screen.getByTestId("sharing").textContent === "true" &&
      (screen.getByTestId("share-password-link") as HTMLButtonElement).disabled;

    await act(async () => {
      venueBShare.resolve();
      await secondShare;
    });
    assert.equal(nextScopeStillOwnsShare, true);
    assert.equal(screen.getByTestId("sharing").textContent, "false");
  } finally {
    restoreClipboard();
  }
});

test("A to B to A first commits expose a neutral scope instead of prior error, dialog, or users", async () => {
  const venueBUsers = createDeferred<{ data: User[]; error: null }>();
  const venueBAudit = createDeferred<{ data: []; error: null }>();
  const nextVenueAUsers = createDeferred<{ data: User[]; error: null }>();
  const nextVenueAAudit = createDeferred<{ data: []; error: null }>();
  let venueAUserCalls = 0;
  let venueAAuditCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const snapshots: Array<{
    scopeKey: string;
    loadError: string;
    pending: string;
    users: string;
  }> = [];
  const actions = createActions({
    fetchManagedUsersByVenue: async (venueId) => {
      if (venueId === "venue-b") return venueBUsers.promise;
      venueAUserCalls += 1;
      if (venueAUserCalls === 1) return { data: [USER_A], error: null };
      return nextVenueAUsers.promise;
    },
    fetchUserAuditEvents: async (venueId) => {
      if (venueId === "venue-b") return venueBAudit.promise;
      venueAAuditCalls += 1;
      if (venueAAuditCalls === 1) {
        return { data: null, error: "AUDIT_FAILED" };
      }
      return nextVenueAAudit.promise;
    },
  });
  const onSnapshot: NonNullable<HarnessProps["onSnapshot"]> = (
    scopeKey,
    nextController,
  ) => {
    snapshots.push({
      scopeKey,
      loadError: nextController.loadError,
      pending: nextController.pendingUserAction?.kind ?? "",
      users: nextController.scopedUsers.map((user) => user.name).join(","),
    });
  };
  const view = renderHarness({
    actions,
    effectiveVenueId: "venue-a",
    isSuperAdmin: true,
    onController: (nextController) => {
      controller = nextController;
    },
    onSnapshot,
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("state").textContent, "partial"),
  );
  act(() => {
    controller!.setPendingUserAction({ kind: "delete", user: USER_A });
  });
  assert.equal(screen.getByTestId("pending").textContent, "delete");

  snapshots.length = 0;
  view.rerender(
    harnessTree({
      actions,
      effectiveVenueId: "venue-b",
      isSuperAdmin: true,
      onController: (nextController) => {
        controller = nextController;
      },
      onSnapshot,
    }),
  );
  view.rerender(
    harnessTree({
      actions,
      effectiveVenueId: "venue-a",
      isSuperAdmin: true,
      onController: (nextController) => {
        controller = nextController;
      },
      onSnapshot,
    }),
  );

  const firstVenueB = snapshots.find(
    (snapshot) => snapshot.scopeKey === "venue-b",
  );
  const firstNewVenueA = snapshots.find(
    (snapshot) => snapshot.scopeKey === "venue-a",
  );
  assert.deepEqual(firstVenueB, {
    scopeKey: "venue-b",
    loadError: "",
    pending: "",
    users: "",
  });
  assert.deepEqual(firstNewVenueA, {
    scopeKey: "venue-a",
    loadError: "",
    pending: "",
    users: "",
  });
});

test("a deferred failed update refresh cannot publish mutation success", async () => {
  const refreshRequest = createDeferred<{ data: null; error: string }>();
  let loadCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => {
        loadCalls += 1;
        if (loadCalls === 1) return { data: [USER_A], error: null };
        return refreshRequest.promise;
      },
    }),
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() => assert.equal(loadCalls, 1));

  let updateResult!: Promise<boolean>;
  act(() => {
    updateResult = controller!.handleUserUpdate(USER_A.id, {
      name: "Alpha Updated",
    });
  });
  await waitFor(() => assert.equal(loadCalls, 2));
  await act(async () => {
    refreshRequest.resolve({ data: null, error: "LOAD_FAILED" });
    assert.equal(await updateResult, false);
  });

  assert.equal(screen.getByTestId("feedback-type").textContent, "");
  assert.equal(screen.getByTestId("feedback").textContent, "");
  assert.equal(
    screen.getByTestId("load-error").textContent,
    "Unable to load users. Please try again.",
  );
});

test("a deferred stale mutation refresh cannot publish success or release new-scope state", async () => {
  const staleVenueARefresh = createDeferred<{ data: User[]; error: null }>();
  const venueBLoad = createDeferred<{ data: User[]; error: null }>();
  const venueBUpdate = createDeferred<{ data: User; error: null }>();
  let venueALoadCalls = 0;
  let venueBUpdateCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const actions = createActions({
    fetchManagedUsersByVenue: async (venueId) => {
      if (venueId === "venue-b") return venueBLoad.promise;
      venueALoadCalls += 1;
      if (venueALoadCalls === 1) return { data: [USER_A], error: null };
      return staleVenueARefresh.promise;
    },
    updateUserProfile: async (userId) => {
      if (userId === USER_A.id) return { data: USER_A, error: null };
      venueBUpdateCalls += 1;
      return venueBUpdate.promise;
    },
  });
  const view = renderHarness({
    actions,
    effectiveVenueId: "venue-a",
    onController: (nextController) => {
      controller = nextController;
    },
  });
  await waitFor(() => assert.equal(venueALoadCalls, 1));

  let updateResult!: Promise<boolean>;
  act(() => {
    updateResult = controller!.handleUserUpdate(USER_A.id, {
      name: "Alpha Updated",
    });
  });
  await waitFor(() => assert.equal(venueALoadCalls, 2));
  view.rerender(
    harnessTree({
      actions,
      effectiveVenueId: "venue-b",
      onController: (nextController) => {
        controller = nextController;
      },
    }),
  );

  await act(async () => {
    venueBLoad.resolve({ data: [USER_B], error: null });
    await venueBLoad.promise;
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("users").textContent, USER_B.name),
  );

  let venueBUpdateResult!: Promise<boolean>;
  let sameTickDuplicate!: Promise<boolean>;
  act(() => {
    venueBUpdateResult = controller!.handleUserUpdate(USER_B.id, {
      name: "Beta Updated",
    });
    sameTickDuplicate = controller!.handleUserUpdate(USER_B.id, {
      name: "Ignored Duplicate",
    });
  });
  assert.equal(await sameTickDuplicate, false);
  assert.equal(venueBUpdateCalls, 1);
  assert.equal(screen.getByTestId("busy").textContent, USER_B.id);

  await act(async () => {
    staleVenueARefresh.resolve({ data: [USER_A], error: null });
    assert.equal(await updateResult, false);
  });
  assert.equal(screen.getByTestId("feedback").textContent, "");
  assert.equal(screen.getByTestId("busy").textContent, USER_B.id);

  let duplicateAfterStaleFinally!: Promise<boolean>;
  act(() => {
    duplicateAfterStaleFinally = controller!.handleUserUpdate(USER_B.id, {
      name: "Still Ignored",
    });
  });
  assert.equal(await duplicateAfterStaleFinally, false);
  assert.equal(venueBUpdateCalls, 1);
  assert.equal(screen.getByTestId("busy").textContent, USER_B.id);

  await act(async () => {
    venueBUpdate.resolve({ data: USER_B, error: null });
    assert.equal(await venueBUpdateResult, true);
  });
  assert.equal(screen.getByTestId("busy").textContent, "");
  assert.equal(screen.getByTestId("users").textContent, USER_B.name);
});

test("a failed credential refresh retains the issued link without false success and close restores focus", async () => {
  const refreshRequest = createDeferred<{ data: null; error: string }>();
  let loadCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  renderHarness({
    actions: createActions({
      fetchManagedUsersByVenue: async () => {
        loadCalls += 1;
        if (loadCalls === 1) return { data: [USER_A], error: null };
        return refreshRequest.promise;
      },
      issueManagedPasswordLinkViaEdge: async () => ({
        data: {
          linkKind: "password_reset",
          passwordUrl: "https://example.com/failed-refresh-link",
          expiresAt: "2026-08-24T00:00:00.000Z",
        },
        error: null,
      }),
    }),
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

  let confirmation!: Promise<void>;
  act(() => {
    confirmation = controller!.confirmPendingUserAction();
  });
  await waitFor(() => assert.equal(loadCalls, 2));
  await act(async () => {
    refreshRequest.resolve({ data: null, error: "LOAD_FAILED" });
    await confirmation;
  });

  assert.equal(
    screen.getByTestId("password-link-panel").textContent?.includes(
      "https://example.com/failed-refresh-link",
    ),
    true,
  );
  assert.equal(screen.getByTestId("feedback-type").textContent, "");
  assert.equal(screen.getByTestId("feedback").textContent, "");
  await waitFor(() =>
    assert.equal(
      document.activeElement === screen.getByTestId("password-link-panel"),
      true,
    ),
  );

  const closeButton = screen.getByTestId("close-password-link");
  closeButton.focus();
  act(() => {
    closeButton.click();
  });
  await waitFor(() =>
    assert.equal(
      document.activeElement === screen.getByTestId("directory-focus-fallback"),
      true,
    ),
  );
});

test("a deleted disconnected opener falls back to directory focus without false refresh success", async () => {
  const refreshRequest = createDeferred<{ data: null; error: string }>();
  let loadCalls = 0;
  let controller: ReturnType<typeof useUserDirectoryController> | undefined;
  const requestAnimationFrame = window.requestAnimationFrame;
  const cancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    callback(performance.now());
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  try {
    renderHarness({
      actions: createActions({
        fetchManagedUsersByVenue: async () => {
          loadCalls += 1;
          if (loadCalls === 1) {
            return { data: [USER_INACTIVE], error: null };
          }
          return refreshRequest.promise;
        },
        deleteUserViaEdge: async () => ({ error: null }),
      }),
      onController: (nextController) => {
        controller = nextController;
      },
    });
    await waitFor(() => assert.equal(loadCalls, 1));

    const deleteOpener = screen.getByTestId("delete-opener");
    deleteOpener.focus();
    act(() => {
      deleteOpener.click();
    });
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    confirmButton.focus();
    let confirmation!: Promise<void>;
    act(() => {
      confirmation = controller!.confirmPendingUserAction();
    });
    await waitFor(() => assert.equal(loadCalls, 2));
    await act(async () => {
      refreshRequest.resolve({ data: null, error: "LOAD_FAILED" });
      await confirmation;
    });

    assert.equal(screen.queryByTestId("delete-opener"), null);
    assert.equal(screen.getByTestId("feedback-type").textContent, "");
    assert.equal(screen.getByTestId("feedback").textContent, "");
    assert.equal(
      document.getElementById("main-content")?.hasAttribute("inert"),
      false,
    );
    await waitFor(() =>
      assert.equal(
        document.activeElement ===
          screen.getByTestId("directory-focus-fallback"),
        true,
      ),
    );
  } finally {
    window.requestAnimationFrame = requestAnimationFrame;
    window.cancelAnimationFrame = cancelAnimationFrame;
  }
});

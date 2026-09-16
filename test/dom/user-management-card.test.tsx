import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import type { User } from "@/lib/users/types";
import type { PasswordResetRequestView } from "@/lib/auth/password-reset-request-types";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

const passwordResetTestState = globalThis as typeof globalThis & {
  adminPasswordResetActions?: {
    fetch: () => Promise<{ data: PasswordResetRequestView[]; error: null }>;
    approve: () => Promise<{ data: null; error: string }>;
    reject: () => Promise<{ error: string | null }>;
  };
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("lib/api/password-reset-requests")) {
      return { url: "mock:user-management-password-reset", shortCircuit: true };
    }
    if (specifier.endsWith("components/VenueSelector")) {
      return { url: "mock:user-management-venue-selector", shortCircuit: true };
    }
    if (specifier.endsWith("lib/api/users")) {
      return { url: "mock:user-management-actions", shortCircuit: true };
    }
    if (specifier.endsWith("lib/api/venues")) {
      return { url: "mock:user-management-venues", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "mock:user-management-password-reset") {
      return {
        format: "module",
        source: `
          export const fetchPasswordResetRequests = () => globalThis.adminPasswordResetActions.fetch();
          export const startManagedPasswordReset = () => globalThis.adminPasswordResetActions.approve();
          export const rejectPasswordResetRequest = () => globalThis.adminPasswordResetActions.reject();
        `,
        shortCircuit: true,
      };
    }
    if (url === "mock:user-management-venue-selector") {
      return {
        format: "module",
        source: `
          export const useVenueSelector = () => ({ venues: [], currentVenue: null });
          export default function VenueSelector() { return null; }
        `,
        shortCircuit: true,
      };
    }
    if (url === "mock:user-management-actions") {
      return {
        format: "module",
        source: `
          export const fetchManagedUsersByVenue = async () => ({ data: [], error: null });
          export const fetchUserAuditEvents = async () => ({ data: [], error: null });
          export const updateUserProfile = async () => ({ data: null, error: null });
          export const deleteUserViaEdge = async () => ({ error: null });
          export const issueManagedPasswordLinkViaEdge = async () => ({ data: null, error: null });
          export const createUserViaEdge = async () => ({ data: null, error: null });
        `,
        shortCircuit: true,
      };
    }
    if (url === "mock:user-management-venues") {
      return {
        format: "module",
        source:
          "export const fetchVenues = async () => ({ data: [], error: null });",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

afterEach(() => {
  cleanup();
  delete passwordResetTestState.adminPasswordResetActions;
});

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
  email: "beta@example.com",
  name: "Beta Door",
  role: "door_staff",
};

test("password approval keeps its proof form and rejection confirms inline with focus recovery", async () => {
  const request: PasswordResetRequestView = {
    id: "request-a", userId: USER_A.id, venueId: "venue-a",
    userName: USER_A.name, userEmail: USER_A.email, userRole: USER_A.role,
    userAccountKind: "personal", venueName: "Test venue", codeFreeEligible: true,
    source: "self_service", status: "pending", setupMethod: null,
    decidedByUserId: null, decidedAt: null, expiresAt: null, completedAt: null,
    createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
  };
  const rejection = createDeferred<{ error: string | null }>();
  let isRejected = false;
  let rejectCalls = 0;
  passwordResetTestState.adminPasswordResetActions = {
    fetch: async () => ({ data: isRejected ? [] : [request], error: null }),
    approve: async () => ({ data: null, error: "VERIFICATION_FAILED" }),
    reject: async () => {
      rejectCalls += 1;
      if (rejectCalls === 1) return { error: "FORBIDDEN" };
      const result = await rejection.promise;
      isRejected = !result.error;
      return result;
    },
  };
  const { default: PasswordResetRequestManagement } = await import(
    "@/app/admin/components/PasswordResetRequestManagement"
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>
        <PasswordResetRequestManagement />
      </RouteTransitionProvider>
    </NextIntlClientProvider>,
  );
  const process = await screen.findByRole("button", { name: messages.PasswordResetAdmin.process });
  fireEvent.click(process);
  const dialog = screen.getByRole("dialog");
  assert.equal(screen.queryByRole("alertdialog"), null);
  const approve = within(dialog).getByRole("button", { name: messages.PasswordResetAdmin.approve });
  assert.equal((approve as HTMLButtonElement).disabled, true);
  fireEvent.click(within(dialog).getByRole("radio", { name: messages.PasswordResetAdmin.verification_in_person }));
  const challenge = within(dialog).getByLabelText(messages.PasswordResetAdmin.verificationChallenge);
  fireEvent.change(challenge, { target: { value: "1234" } });
  assert.equal((approve as HTMLButtonElement).disabled, true);
  fireEvent.click(within(dialog).getByRole("checkbox"));
  assert.equal((approve as HTMLButtonElement).disabled, false);
  fireEvent.click(approve);
  await waitFor(() => assert.equal(document.activeElement === challenge, true));
  assert.equal(within(dialog).getByRole("alert").textContent?.includes(messages.PasswordResetAdmin.verificationFailed), true);
  fireEvent.click(within(dialog).getByRole("button", { name: messages.Common.cancel }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));

  const getReject = () => screen.getByRole("button", { name: messages.PasswordResetAdmin.reject });
  fireEvent.click(getReject());
  const confirmation = screen.getByRole("group");
  assert.equal(screen.queryByRole("dialog"), null);
  const cancel = within(confirmation).getByRole("button", { name: messages.Common.cancel });
  await waitFor(() => assert.equal(document.activeElement === cancel, true));
  fireEvent.keyDown(cancel, { key: "Escape" });
  await waitFor(() => assert.equal(document.activeElement === getReject(), true));
  assert.equal(rejectCalls, 0);

  fireEvent.click(getReject());
  fireEvent.click(getReject());
  const failure = await screen.findByRole("alert");
  assert.equal(failure.textContent?.includes(messages.PasswordResetAdmin.forbidden), true);
  assert.ok(screen.getByRole("group"));
  fireEvent.click(getReject());
  fireEvent.click(getReject());
  assert.equal(rejectCalls, 2);
  assert.equal((screen.getByRole("button", { name: messages.Common.cancel }) as HTMLButtonElement).disabled, true);
  await act(async () => {
    rejection.resolve({ error: null });
    await rejection.promise;
  });
  await waitFor(() => assert.equal(screen.queryByRole("group"), null));
  const panel = screen.getByRole("region", {
    name: (name) => name.startsWith(messages.PasswordResetAdmin.title),
  });
  await waitFor(() => assert.equal(document.activeElement === panel, true));
  assert.ok(screen.getByText(messages.PasswordResetAdmin.rejected).closest('[role="status"]'));
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let modulePromise:
  | ReturnType<typeof importUserManagementModule>
  | null = null;

function importUserManagementModule() {
  return import("@/app/admin/components/UserManagement");
}

function loadUserManagementModule() {
  modulePromise ??= importUserManagementModule();
  return modulePromise;
}

async function renderUserCard({
  user = USER_A,
  isBusy = false,
  actionsDisabled = false,
  onUpdate = async () => true,
}: {
  user?: User;
  isBusy?: boolean;
  actionsDisabled?: boolean;
  onUpdate?: (id: string, updates: object) => Promise<boolean>;
} = {}) {
  const { UserCard } = await loadUserManagementModule();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <UserCard
        user={user}
        actorRole="super_admin"
        currentUserId="actor"
        timeZone="Asia/Seoul"
        isBusy={isBusy}
        actionsDisabled={actionsDisabled}
        onUpdate={onUpdate}
        onToggleActive={async () => {}}
        onResetPassword={async () => {}}
        onDelete={async () => {}}
      />
    </NextIntlClientProvider>,
  );
  if (!actionsDisabled) fireEvent.click(screen.getByRole("button", { name: new RegExp(user.name) }));
  return { ...view, UserCard };
}

test("UserCard moves focus across edit subtree replacement", async () => {
  await renderUserCard();
  let editButton = screen.getByRole("button", {
    name: messages.UserAdmin.edit,
  });
  editButton.focus();
  fireEvent.click(editButton);

  let nameInput = screen.getByLabelText(messages.UserAdmin.name);
  assert.equal(document.activeElement === nameInput, true);

  const cancelButton = screen.getByRole("button", {
    name: messages.Common.cancel,
  });
  cancelButton.focus();
  fireEvent.click(cancelButton);
  editButton = screen.getByRole("button", {
    name: messages.UserAdmin.edit,
  });
  assert.equal(document.activeElement === editButton, true);

  editButton.focus();
  fireEvent.click(editButton);
  nameInput = screen.getByLabelText(messages.UserAdmin.name);
  assert.equal(document.activeElement === nameInput, true);
  const saveButton = screen.getByRole("button", {
    name: messages.UserAdmin.save,
  });
  saveButton.focus();
  await act(async () => {
    fireEvent.click(saveButton);
    await Promise.resolve();
  });
  editButton = screen.getByRole("button", {
    name: messages.UserAdmin.edit,
  });
  assert.equal(document.activeElement === editButton, true);
});

test("UserCard does not steal focus moved outside while save is pending", async () => {
  const saveRequest = createDeferred<boolean>();
  await renderUserCard({ onUpdate: async () => saveRequest.promise });
  const externalButton = document.createElement("button");
  externalButton.textContent = "External target";
  document.body.append(externalButton);

  try {
    const editButton = screen.getByRole("button", {
      name: messages.UserAdmin.edit,
    });
    editButton.focus();
    fireEvent.click(editButton);
    const saveButton = screen.getByRole("button", {
      name: messages.UserAdmin.save,
    });
    saveButton.focus();
    fireEvent.click(saveButton);
    externalButton.focus();

    await act(async () => {
      saveRequest.resolve(true);
      await saveRequest.promise;
    });
    assert.equal(document.activeElement === externalButton, true);
  } finally {
    externalButton.remove();
  }
});

test("a scope-wide disabled state removes every user card action", async () => {
  const { UserCard } = await loadUserManagementModule();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <section data-testid="user-a-card">
        <UserCard
          user={USER_A}
          actorRole="super_admin"
          currentUserId="actor"
          isBusy
          actionsDisabled
          onUpdate={async () => true}
          onToggleActive={async () => {}}
          onResetPassword={async () => {}}
          onDelete={async () => {}}
        />
      </section>
      <section data-testid="user-b-card">
        <UserCard
          user={USER_B}
          actorRole="super_admin"
          currentUserId="actor"
          isBusy={false}
          actionsDisabled
          onUpdate={async () => true}
          onToggleActive={async () => {}}
          onResetPassword={async () => {}}
          onDelete={async () => {}}
        />
      </section>
    </NextIntlClientProvider>,
  );

  for (const cardId of ["user-a-card", "user-b-card"]) {
    const card = within(screen.getByTestId(cardId));
    const openButton = card.getByRole("button") as HTMLButtonElement;
    assert.equal(openButton.disabled, true);
    fireEvent.click(openButton);
    assert.equal(screen.queryByRole("dialog"), null);
  }
});

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
  within,
} from "@testing-library/react";

import messages from "@/messages/en.json";
import type { User } from "@/lib/users/types";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("lib/api/users")) {
      return { url: "mock:user-management-actions", shortCircuit: true };
    }
    if (specifier.endsWith("lib/api/venues")) {
      return { url: "mock:user-management-venues", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
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

afterEach(cleanup);

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
    const editButton = card.getByRole("button", {
      name: messages.UserAdmin.edit,
    }) as HTMLButtonElement;
    const deactivateButton = card.getByRole("button", {
      name: messages.UserAdmin.deactivate,
    }) as HTMLButtonElement;
    assert.equal(editButton.disabled, true);
    assert.equal(deactivateButton.disabled, true);
  }
});

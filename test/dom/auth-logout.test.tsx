import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { AdminLogoutControl } from "@/app/admin/components/AdminHeader";
import { logout, type LogoutResult } from "@/lib/auth";

afterEach(cleanup);

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, value);
    },
  };
}

function installLogoutBrowser(fetchImpl: typeof fetch) {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const localStorage = createMemoryStorage({ user: "cached-user" });
  const sessionStorage = createMemoryStorage({
    "shared-operator:user-1": "Operator",
    "unrelated-preference": "keep",
  });
  const testWindow = {
    location: { href: "/current" },
    sessionStorage,
  } as unknown as Window & typeof globalThis;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: testWindow,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: fetchImpl,
  });

  return {
    localStorage,
    sessionStorage,
    testWindow,
    restore() {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
      if (originalLocalStorage) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    },
  };
}

test("pending logout preserves cached identity, operator state, and location", async () => {
  const browser = installLogoutBrowser(async () =>
    new Response(
      JSON.stringify({
        ok: false,
        code: "SESSION_REVOCATION_PENDING",
        revocationPending: true,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ),
  );

  try {
    assert.deepEqual(await logout(), {
      success: false,
      code: "SESSION_REVOCATION_PENDING",
      revocationPending: true,
      status: 503,
    });
    assert.equal(browser.localStorage.getItem("user"), "cached-user");
    assert.equal(
      browser.sessionStorage.getItem("shared-operator:user-1"),
      "Operator",
    );
    assert.equal(browser.testWindow.location.href, "/current");
  } finally {
    browser.restore();
  }
});

test("logout requires an explicit successful body before client cleanup", async () => {
  const browser = installLogoutBrowser(async () =>
    new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  try {
    assert.deepEqual(await logout(), {
      success: false,
      code: "LOGOUT_REQUEST_FAILED",
      revocationPending: false,
      status: 200,
    });
    assert.equal(browser.localStorage.getItem("user"), "cached-user");
    assert.equal(browser.testWindow.location.href, "/current");
  } finally {
    browser.restore();
  }
});

test("network logout failure returns a typed result without client cleanup", async () => {
  const browser = installLogoutBrowser(async () => {
    throw new Error("offline");
  });

  try {
    assert.deepEqual(await logout(), {
      success: false,
      code: "LOGOUT_NETWORK_ERROR",
      revocationPending: false,
    });
    assert.equal(browser.localStorage.getItem("user"), "cached-user");
    assert.equal(browser.testWindow.location.href, "/current");
  } finally {
    browser.restore();
  }
});

test("successful logout clears scoped client state and redirects to login", async () => {
  const browser = installLogoutBrowser(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  try {
    assert.deepEqual(await logout(), { success: true });
    assert.equal(browser.localStorage.getItem("user"), null);
    assert.equal(
      browser.sessionStorage.getItem("shared-operator:user-1"),
      null,
    );
    assert.equal(
      browser.sessionStorage.getItem("unrelated-preference"),
      "keep",
    );
    assert.equal(browser.testWindow.location.href, "/auth/login");
  } finally {
    browser.restore();
  }
});

test("Admin logout blocks duplicate clicks and exposes a retryable live error", async () => {
  let resolveFirstLogout: ((result: LogoutResult) => void) | undefined;
  let calls = 0;
  const firstLogout = new Promise<LogoutResult>((resolve) => {
    resolveFirstLogout = resolve;
  });
  const retryLogout = new Promise<LogoutResult>(() => {});
  const failure: LogoutResult = {
    success: false,
    code: "SESSION_REVOCATION_PENDING",
    revocationPending: true,
    status: 503,
  };
  const onLogout = async () => {
    calls += 1;
    return calls === 1 ? firstLogout : retryLogout;
  };

  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        Common: {
          logout: "Log out",
          logoutInProgress: "Logging out…",
          logoutFailed: "Log out failed. Your session is still active; try again.",
        },
      }}
    >
      <AdminLogoutControl onLogout={onLogout} />
    </NextIntlClientProvider>,
  );

  const button = screen.getByRole("button", { name: "Log out" });
  fireEvent.click(button);
  fireEvent.click(button);
  assert.equal(calls, 1);
  assert.equal(button.hasAttribute("disabled"), true);
  assert.equal(button.getAttribute("aria-busy"), "true");

  await act(async () => {
    resolveFirstLogout?.(failure);
    await firstLogout;
  });

  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /session is still active/i);
  assert.equal(alert.getAttribute("aria-live"), "assertive");
  await waitFor(() => assert.equal(button.hasAttribute("disabled"), false));

  fireEvent.click(button);
  assert.equal(calls, 2);
  assert.equal(screen.queryByRole("alert"), null);
});

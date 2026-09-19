import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import Sheet from "@/components/overlays/Sheet";
import { confirmWorkspaceNavigation, installNavigationProtection, registerNavigationGuard, withApprovedNavigation } from "@/components/overlays/navigation-guard";
import messages from "@/messages/en.json";

afterEach(cleanup);

test("page drafts and one-time results protect navigation and unload; busy work cannot leave", () => {
  const originalConfirm = window.confirm;
  let allow = false;
  let confirmations = 0;
  window.confirm = () => { confirmations++; return allow; };
  const uninstall = installNavigationProtection();
  const frame = (busy = false, warning?: string) => <NextIntlClientProvider locale="en" messages={messages}>
    <Sheet title="Create record" presentation="page" onClose={() => {}} protectEdits busy={busy} closeWarning={warning}>
      <label>Name<input name="name" defaultValue="" /></label>
    </Sheet>
  </NextIntlClientProvider>;
  const unload = () => {
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    const view = render(frame());
    assert.ok(screen.getByRole("region", { name: "Create record" }));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal(confirmWorkspaceNavigation(), true);
    assert.equal(unload(), false);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Keep draft" } });
    assert.equal(confirmWorkspaceNavigation(), false);
    assert.equal(input.value, "Keep draft");
    assert.equal(unload(), true);
    allow = true;
    assert.equal(confirmWorkspaceNavigation(), true);
    const beforeBusy = confirmations;
    view.rerender(frame(true));
    assert.equal(confirmWorkspaceNavigation(), false);
    assert.equal(confirmations, beforeBusy);
    view.rerender(frame(false, "Save this single-use result before leaving"));
    fireEvent.change(input, { target: { value: "" } });
    allow = false;
    assert.equal(confirmWorkspaceNavigation(), false);
    assert.equal(unload(), true);
    view.unmount();
    assert.equal(confirmWorkspaceNavigation(), true);
    assert.equal(unload(), false);
  } finally { cleanup(); uninstall(); window.confirm = originalConfirm; }
});

test("discarding a page through its return control does not ask again during the task change", () => {
  const originalConfirm = window.confirm;
  window.confirm = () => { throw new Error("The inline discard was already accepted"); };
  function Form() {
    const [open, setOpen] = useState(true);
    return <Sheet title="Create record" presentation="page" open={open} dirty onClose={() => {
      if (confirmWorkspaceNavigation()) setOpen(false);
    }}><input aria-label="Draft" defaultValue="Retain me" /></Sheet>;
  }
  try {
    render(<NextIntlClientProvider locale="en" messages={messages}><Form /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: messages.Sheet.backToList }));
    fireEvent.click(screen.getByRole("button", { name: messages.Sheet.continue }));
    assert.equal((screen.getByLabelText("Draft") as HTMLInputElement).value, "Retain me");
    fireEvent.click(screen.getByRole("button", { name: messages.Sheet.backToList }));
    fireEvent.click(screen.getByRole("button", { name: messages.Sheet.discard }));
    assert.equal(screen.queryByRole("region", { name: "Create record" }), null);
  } finally { cleanup(); window.confirm = originalConfirm; }
});

test("cancelled back and forward restore the current URL before the router sees a popstate", async () => {
  window.history.replaceState({ routerData: "preserved" }, "", "/guard-a");
  const uninstall = installNavigationProtection();
  let allow = false;
  let confirmed = 0;
  const remove = registerNavigationGuard({ hasPendingWork: () => true, confirmLeave: () => { confirmed++; return allow; } });
  const destinations: string[] = [];
  const onPopState = () => destinations.push(window.location.pathname);
  window.addEventListener("popstate", onPopState);
  try {
    assert.equal(window.history.state.routerData, "preserved");
    window.history.pushState({ routerData: "next" }, "", "/guard-b");
    window.history.back();
    await waitFor(() => {
      assert.equal(confirmed, 1);
      assert.equal(window.location.pathname, "/guard-b");
    });
    assert.deepEqual(destinations, []);
    assert.equal(window.history.state.routerData, "next");
    allow = true;
    window.history.back();
    await waitFor(() => assert.deepEqual(destinations, ["/guard-a"]));
    allow = false;
    window.history.forward();
    await waitFor(() => {
      assert.equal(confirmed, 3);
      assert.equal(window.location.pathname, "/guard-a");
    });
    assert.deepEqual(destinations, ["/guard-a"]);
    allow = true;
    window.history.forward();
    await waitFor(() => assert.deepEqual(destinations, ["/guard-a", "/guard-b"]));
  } finally { remove(); uninstall(); window.removeEventListener("popstate", onPopState); }
});

test("an approved asynchronous departure releases its bypass after a failed request", async () => {
  const remove = registerNavigationGuard({ hasPendingWork: () => true, confirmLeave: () => false });
  try {
    await assert.rejects(withApprovedNavigation(async () => {
      assert.equal(confirmWorkspaceNavigation(), true);
      throw new Error("offline");
    }), /offline/);
    assert.equal(confirmWorkspaceNavigation(), false);
  } finally { remove(); }
});

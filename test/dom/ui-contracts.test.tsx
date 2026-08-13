import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import AdminTaskSwitcher from "@/app/admin/components/AdminTaskSwitcher";
import AsyncListContent from "@/components/AsyncListContent";
import ConfirmDialog from "@/components/ConfirmDialog";
import OperationalSectionNav from "@/components/OperationalSectionNav";

afterEach(() => {
  cleanup();
  document.getElementById("main-content")?.removeAttribute("inert");
});

test("full error hides empty copy and retry success restores it", () => {
  const { rerender } = render(
    <AsyncListContent
      state="error"
      loading={<p>LOADING</p>}
      empty={<p>EMPTY</p>}
    >
      <p>DATA</p>
    </AsyncListContent>,
  );

  assert.equal(screen.queryByText("EMPTY"), null);
  assert.equal(screen.queryByText("DATA"), null);

  rerender(
    <AsyncListContent
      state="success-empty"
      loading={<p>LOADING</p>}
      empty={<p>EMPTY</p>}
    >
      <p>DATA</p>
    </AsyncListContent>,
  );
  assert.ok(screen.getByText("EMPTY"));
});

test("task and section controls expose current state and respect busy locks", () => {
  let nextTask = "";
  const { rerender } = render(
    <AdminTaskSwitcher
      label="Admin sections"
      groupLabels={{
        guests: "Guests",
        events: "Events",
        links: "Links",
        users: "Users",
        venues: "Venues",
      }}
      options={[
        { id: "guest-list", group: "guests", label: "Guest list" },
        { id: "link-create", group: "links", label: "Create link" },
      ]}
      value="guest-list"
      onChange={(task) => {
        nextTask = task;
      }}
    />,
  );

  const activeLinks = screen.getAllByRole("link", { name: /Guest list/i });
  assert.ok(activeLinks.every((link) => link.getAttribute("aria-current") === "page"));
  fireEvent.click(screen.getAllByRole("link", { name: /Create link/i })[0]);
  assert.equal(nextTask, "link-create");

  rerender(
    <AdminTaskSwitcher
      label="Admin sections"
      groupLabels={{
        guests: "Guests",
        events: "Events",
        links: "Links",
        users: "Users",
        venues: "Venues",
      }}
      options={[
        { id: "guest-list", group: "guests", label: "Guest list" },
        { id: "link-create", group: "links", label: "Create link" },
      ]}
      value="guest-list"
      onChange={() => {}}
      disabled
    />,
  );
  assert.ok(
    screen
      .getAllByRole("link")
      .every((link) => link.getAttribute("aria-disabled") === "true"),
  );

  cleanup();
  render(
    <OperationalSectionNav
      label="Link section"
      items={[
        { id: "create", label: "Create", icon: "add" },
        { id: "manage", label: "Manage", icon: "link" },
      ]}
      activeId="create"
      onChange={() => {}}
      disabled
    />,
  );
  assert.equal(
    screen.getByRole("button", { name: "Create" }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(screen.getByRole("button", { name: "Manage" }).hasAttribute("disabled"), true);
});

test("dialog traps the interaction, Escape closes it, and focus returns", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <ConfirmDialog
          open={open}
          title="Confirm action"
          description="Check before continuing"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open dialog" });
  opener.focus();
  fireEvent.click(opener);

  const dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById("main-content")?.hasAttribute("inert"), true);
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Cancel" }));

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("alertdialog"), null));
  assert.equal(document.activeElement, opener);
});

test("busy dialog reports aria-busy and ignores Escape", () => {
  let cancelled = false;
  render(
    <NextIntlClientProvider locale="en" messages={{ Common: { loading: "Loading" } }}>
      <ConfirmDialog
        open
        title="Busy action"
        description="Please wait"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
        isLoading
      />
    </NextIntlClientProvider>,
  );

  const dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"), true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(cancelled, false);
  assert.ok(screen.getByRole("alertdialog"));
});

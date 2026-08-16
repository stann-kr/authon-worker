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
import AnalyticsContributors from "@/app/admin/components/analytics/AnalyticsContributors";
import AnalyticsPeriodBar from "@/app/admin/components/analytics/AnalyticsPeriodBar";
import AsyncListContent from "@/components/AsyncListContent";
import ConfirmDialog from "@/components/ConfirmDialog";
import GuestListCard from "@/components/GuestListCard";
import OperationalSectionNav from "@/components/OperationalSectionNav";
import GuestBulkEntry from "@/components/GuestBulkEntry";
import { EMPTY_ANALYTICS_DTO_FIXTURE } from "@/lib/analytics/test-fixtures";

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
        analytics: "Analytics",
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
        analytics: "Analytics",
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

test("analytics period controls expose selection and keyboard-native navigation", () => {
  let previousAnchor = "";
  let nextGranularity = "";
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        AdminAnalytics: {
          refresh: "Refresh",
          period: {
            granularity: "Period unit",
            selected: "Selected period",
            month: "Month",
            quarter: "Quarter",
            year: "Year",
            previous: "Previous period",
            next: "Next period",
            inProgress: "In progress",
            loading: "Preparing period",
            comparison: "Compared with {start}-{end}",
          },
          coverage: {
            summary: "{confirmed} confirmed, {days} days, {unconfirmed} unconfirmed",
          },
        },
      }}
    >
      <AnalyticsPeriodBar
        granularity="month"
        view={EMPTY_ANALYTICS_DTO_FIXTURE}
        isLoading={false}
        onGranularityChange={(value) => {
          nextGranularity = value;
        }}
        onAnchorDateChange={(value) => {
          previousAnchor = value;
        }}
        onRefresh={() => {}}
      />
    </NextIntlClientProvider>,
  );

  assert.equal(
    screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed"),
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
  assert.equal(nextGranularity, "quarter");
  fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
  assert.equal(previousAnchor, "2026-07-01");
});

test("unmapped contributor labels expose the source name and mapping status", () => {
  render(
    <NextIntlClientProvider
      locale="ko"
      messages={{
        AdminAnalytics: {
          contributors: {
            title: "DJ·기여자별 게스트",
            description: "미연결 출처는 이름과 상태를 함께 표시합니다.",
            name: "DJ·기여자",
            operatingDays: "등록 영업일",
            sort: "정렬 기준",
            ascending: "오름차순",
            descending: "내림차순",
            deleted: "삭제된 기여자",
            unmappedLink: "미연결 외부 링크",
            unmappedLinkWithName: "{name} · 미연결 외부 링크",
            unmappedUser: "미연결 내부 계정",
            unmappedUserWithName: "{name} · 미연결 내부 계정",
            unattributed: "귀속되지 않은 등록",
          },
          summary: {
            registered: "등록 게스트",
            checkedIn: "입장 게스트",
            entryRatePercent: "입장률",
          },
        },
      }}
    >
      <AnalyticsContributors
        rows={[
          {
            contributorId: null,
            displayName: "DJ Nova",
            sourceStatus: "unmapped",
            source: { kind: "external_link", id: "link-nova" },
            operatingDays: 2,
            registered: 12,
            checkedIn: 9,
            entryRatePercent: 75,
            registeredPerOperatingDay: 6,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );

  const labels = screen.getAllByText("DJ Nova · 미연결 외부 링크");
  assert.equal(labels.length, 3);
  assert.ok(screen.getByRole("columnheader", { name: "DJ·기여자" }));
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

test("guest deletion dialog explains that analytics will change", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        Common: {
          waitingStatus: "Status: waiting.",
          delete: "Delete",
          deleteGuest: "Delete guest",
          removeGuestConfirm:
            "Deleting this guest registration removes it from the guest list and analytics. Continue?",
          cancel: "Cancel",
        },
      }}
    >
      <GuestListCard
        guest={{ id: "guest-a", name: "Guest A", status: "pending" }}
        index={0}
        onDelete={() => {}}
      />
    </NextIntlClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete guest" });
  const descriptionId = dialog.getAttribute("aria-describedby");
  assert.ok(descriptionId);
  assert.equal(
    document.getElementById(descriptionId)?.textContent,
    "Deleting this guest registration removes it from the guest list and analytics. Continue?",
  );
});

test("CSV mapping and line preview controls keep native labels and file boundaries", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        BulkGuestEntry: {
          title: "Paste multiple names",
          optional: "Optional",
          fieldLabel: "Names to paste",
          placeholder: "One name per line",
          helper: "Review names",
          csv: {
            fileLabel: "Import a CSV file",
            helper: "Choose the name column",
          },
        },
      }}
    >
      <GuestBulkEntry
        existingNames={[]}
        remaining={10}
        onSubmitChunk={async () => ({ data: { items: [] }, error: null })}
      />
    </NextIntlClientProvider>,
  );

  const fileInput = screen.getByLabelText("Import a CSV file");
  assert.equal(fileInput.getAttribute("type"), "file");
  assert.match(fileInput.getAttribute("accept") ?? "", /text\/csv/);
  assert.equal(screen.getByLabelText("Names to paste").tagName, "TEXTAREA");
});

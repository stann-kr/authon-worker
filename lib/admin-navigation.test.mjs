import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminGroupDefaultTasks,
  getAdminShortcutTask,
  getAdminTaskSearch,
  isAdminTaskAvailable,
  parseAdminTask,
} from "./admin-navigation.ts";

function params(value) {
  return new URLSearchParams(value);
}

test("legacy and current admin query parameters resolve to focused tasks", () => {
  assert.equal(parseAdminTask(params("tab=requests")), "guest-requests");
  assert.equal(
    parseAdminTask(params("tab=guests&view=requests")),
    "guest-requests",
  );
  assert.equal(parseAdminTask(params("tab=links")), "link-create");
  assert.equal(
    parseAdminTask(params("tab=links&view=manage")),
    "link-manage",
  );
  assert.equal(
    parseAdminTask(params("tab=users&view=migrate")),
    "user-create",
  );
  assert.equal(
    parseAdminTask(params("tab=users&view=password-requests")),
    "password-requests",
  );
  assert.equal(parseAdminTask(params("")), null);
});

test("admin shortcuts use number keys and never consume Escape for navigation", () => {
  assert.equal(getAdminShortcutTask("1", false), "guest-list");
  assert.equal(getAdminShortcutTask("4", false), null);
  assert.equal(getAdminShortcutTask("4", true), "venue-list");
  assert.equal(getAdminShortcutTask("Escape", true), null);
});

test("admin tasks serialize to stable deep links", () => {
  assert.equal(
    getAdminTaskSearch("guest-list"),
    "?tab=guests&view=list",
  );
  assert.equal(
    getAdminTaskSearch("venue-create"),
    "?tab=venues&view=create",
  );
  assert.equal(
    getAdminTaskSearch("user-list"),
    "?tab=users&view=directory",
  );
});

test("every canonical admin deep link round-trips to the same task", () => {
  const tasks = [
    "guest-list",
    "guest-requests",
    "link-create",
    "link-manage",
    "user-create",
    "user-list",
    "password-requests",
    "venue-list",
    "venue-create",
  ];

  for (const task of tasks) {
    assert.equal(parseAdminTask(params(getAdminTaskSearch(task))), task);
  }
});

test("super admin-only tasks stay unavailable to venue admins", () => {
  assert.equal(isAdminTaskAvailable("venue-list", false), false);
  assert.equal(isAdminTaskAvailable("link-manage", false), true);
  assert.deepEqual(getAdminGroupDefaultTasks(false), [
    "guest-list",
    "link-create",
    "user-create",
  ]);
  assert.deepEqual(getAdminGroupDefaultTasks(true), [
    "guest-list",
    "link-create",
    "user-create",
    "venue-list",
  ]);
});

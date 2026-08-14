export type AdminTask =
  | "guest-list"
  | "guest-requests"
  | "event-manage"
  | "link-create"
  | "link-manage"
  | "user-create"
  | "user-list"
  | "password-requests"
  | "analytics"
  | "venue-list"
  | "venue-create";

export type AdminTaskGroup =
  | "guests"
  | "events"
  | "links"
  | "users"
  | "analytics"
  | "venues";

const SUPER_ADMIN_TASKS = new Set<AdminTask>([
  "venue-list",
  "venue-create",
]);

export function isAdminTaskAvailable(
  task: AdminTask,
  isSuperAdmin: boolean,
): boolean {
  return isSuperAdmin || !SUPER_ADMIN_TASKS.has(task);
}

export function parseAdminTask(
  searchParams: Pick<URLSearchParams, "get">,
): AdminTask | null {
  const tab = searchParams.get("tab");
  const view = searchParams.get("view");

  if (tab === "requests") return "guest-requests";
  if (tab === "guests") {
    return view === "requests" ? "guest-requests" : "guest-list";
  }
  if (tab === "events") return "event-manage";
  if (tab === "links") {
    return view === "manage" ? "link-manage" : "link-create";
  }
  if (tab === "users") {
    if (
      view === "password-requests" ||
      view === "password-reset-requests" ||
      view === "reset-requests"
    ) {
      return "password-requests";
    }
    if (view === "users" || view === "list" || view === "directory") {
      return "user-list";
    }
    return "user-create";
  }
  if (tab === "venues") {
    return view === "create" ? "venue-create" : "venue-list";
  }
  if (tab === "analytics") return "analytics";

  return null;
}

export function getAdminTaskSearch(task: AdminTask): string {
  const taskSearch: Record<AdminTask, string> = {
    "guest-list": "?tab=guests&view=list",
    "guest-requests": "?tab=guests&view=requests",
    "event-manage": "?tab=events&view=manage",
    "link-create": "?tab=links&view=create",
    "link-manage": "?tab=links&view=manage",
    "user-create": "?tab=users&view=create",
    "user-list": "?tab=users&view=directory",
    "password-requests": "?tab=users&view=password-requests",
    analytics: "?tab=analytics",
    "venue-list": "?tab=venues&view=list",
    "venue-create": "?tab=venues&view=create",
  };
  return taskSearch[task];
}

export function getAdminGroupDefaultTasks(
  isSuperAdmin: boolean,
): AdminTask[] {
  return [
    "guest-list",
    "link-create",
    "user-create",
    "analytics",
    ...(isSuperAdmin ? (["venue-list"] as const) : []),
  ];
}

/** Escape belongs to the currently focused control/dialog, never navigation. */
export function getAdminShortcutTask(
  key: string,
  isSuperAdmin: boolean,
): AdminTask | null {
  if (!/^[1-9]$/.test(key)) return null;
  return getAdminGroupDefaultTasks(isSuperAdmin)[Number.parseInt(key, 10) - 1] ?? null;
}

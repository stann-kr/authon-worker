export type AdminTask =
  | "guest-list"
  | "guest-requests"
  | "link-create"
  | "link-manage"
  | "user-create"
  | "user-list"
  | "user-migrate"
  | "venue-list"
  | "venue-create";

export type AdminTaskGroup = "guests" | "links" | "users" | "venues";

const SUPER_ADMIN_TASKS = new Set<AdminTask>([
  "user-migrate",
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
  if (tab === "links") {
    return view === "manage" ? "link-manage" : "link-create";
  }
  if (tab === "users") {
    if (view === "users" || view === "list" || view === "directory") {
      return "user-list";
    }
    if (view === "migrate" || view === "migration") return "user-migrate";
    return "user-create";
  }
  if (tab === "venues") {
    return view === "create" ? "venue-create" : "venue-list";
  }

  return null;
}

export function getAdminTaskSearch(task: AdminTask): string {
  const taskSearch: Record<AdminTask, string> = {
    "guest-list": "?tab=guests&view=list",
    "guest-requests": "?tab=guests&view=requests",
    "link-create": "?tab=links&view=create",
    "link-manage": "?tab=links&view=manage",
    "user-create": "?tab=users&view=create",
    "user-list": "?tab=users&view=directory",
    "user-migrate": "?tab=users&view=migration",
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
    ...(isSuperAdmin ? (["venue-list"] as const) : []),
  ];
}

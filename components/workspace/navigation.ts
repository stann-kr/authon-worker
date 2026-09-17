import { getAdminTaskSearch, type AdminTask } from "@/lib/admin-navigation";
import { hasAccess, type AccessSubject } from "@/lib/users/policy";

export type WorkspaceGroup = "preparation" | "operations" | "records" | "management";
export type WorkspaceItem = {
  id: string;
  label: string;
  href: string;
  group?: WorkspaceGroup;
  task?: AdminTask;
  activeTasks?: AdminTask[];
};

export const workspaceGroups: WorkspaceGroup[] = [
  "preparation", "operations", "records", "management",
];

function adminItem(
  id: string, label: string, group: WorkspaceGroup, task: AdminTask,
  activeTasks: AdminTask[] = [task],
): WorkspaceItem {
  return { id, label, group, task, activeTasks, href: `/admin${getAdminTaskSearch(task)}` };
}

/** Presentation only: actual routes/services still enforce access and ownership. */
export function getWorkspaceItems(user: AccessSubject): WorkspaceItem[] {
  const admin = hasAccess(user, ["admin"]);
  return [
    { id: "home", label: "home", href: "/" },
    ...(admin ? [adminItem("events", "events", "preparation", "event-manage")] : []),
    { id: "guest", label: "myRoster", href: "/guest", group: "operations" },
    ...(hasAccess(user, ["door"])
      ? [{ id: "door", label: "door", href: "/door", group: "operations" } as const]
      : []),
    ...(admin ? [
      adminItem("links", "links", "operations", "link-manage", ["link-create", "link-manage"]),
      adminItem("requests", "requests", "operations", "guest-requests"),
      adminItem("analytics", "analytics", "records", "analytics"),
      adminItem("users", "users", "management", "user-list", ["user-create", "user-list"]),
      adminItem("password-requests", "passwordRequests", "management", "password-requests"),
    ] : []),
    ...(hasAccess(user, ["venue"])
      ? [adminItem("venues", "venues", "management", "venue-list", ["venue-create", "venue-list"])]
      : []),
    { id: "profile", label: "profile", href: "/profile" },
  ];
}

export function getWorkspaceActiveId(
  pathname: string, task: AdminTask | undefined, items: WorkspaceItem[],
): string | undefined {
  if (pathname === "/admin" && (!task || task === "guest-list")) return items.find((item) => item.id === "door")?.id;
  return items.find((item) => pathname === "/admin"
    ? item.activeTasks?.includes(task ?? "guest-list")
    : item.href === pathname)?.id;
}

export function getWorkspacePrimaryItems(items: WorkspaceItem[], activeId?: string) {
  const preferred = items.some((item) => item.id === "events")
    ? ["home", "door", "guest"]
    : ["home", "guest", "door"];
  const primary = preferred.flatMap((id) => items.filter((item) => item.id === id));
  const active = items.find((item) => item.id === activeId);
  if (active && active.id !== "events" && !primary.includes(active)) {
    if (primary.length >= 4) primary[primary.length - 1] = active;
    else primary.push(active);
  }
  return primary;
}

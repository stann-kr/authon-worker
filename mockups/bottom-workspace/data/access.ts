import { hasAccess, canRequestGuestLimit, type AccessScope } from "../../../lib/users/policy";
import { needsVenue } from "./scope";
import type { MockState, MockUser, View } from "./types";

const viewAccess: Record<View, AccessScope | "public" | "profile" | "request"> = {
  home: "guest", roster: "guest", door: "door", attendance: "door",
  events: "admin", artists: "admin", bookings: "admin", schedule: "admin",
  preparation: "admin", report: "admin", links: "admin", users: "admin",
  "password-requests": "admin", requests: "request", venues: "venue",
  analytics: "admin", profile: "profile", auth: "public", external: "public",
};

const subject = (user: MockUser) => ({ ...user, doorAccessEnabled: user.doorAccess });
export function permissionsFor(user: MockUser) {
  const active = user.active && !user.deleted;
  return {
    isSuper: active && hasAccess(subject(user), ["venue"]),
    isAdmin: active && hasAccess(subject(user), ["admin"]),
    canDoor: active && hasAccess(subject(user), ["door"]),
    canRegister: active && hasAccess(subject(user), ["guest"]),
    canRequestQuota: active && canRequestGuestLimit(subject(user)),
  };
}

export function canOpenView(user: MockUser, view: View) {
  const access = viewAccess[view];
  if (access === "public") return true;
  if (!user.active || user.deleted) return false;
  if (access === "profile") return true;
  if (access === "request") {
    const p = permissionsFor(user);
    return p.isAdmin || p.canRequestQuota;
  }
  return hasAccess(subject(user), [access]);
}

export function assertCapability(data: MockState, actorId: string, access: AccessScope, venueId?: string) {
  const actor = data.users.find((u) => u.id === actorId && u.active && !u.deleted);
  if (!actor || !hasAccess(subject(actor), [access]) || (venueId !== undefined && (
    !data.venues.some((v) => v.id === venueId && v.active) ||
    (actor.role !== "super_admin" && actor.venueId !== venueId)
  ))) throw Error("이 작업을 수행할 권한이 없습니다.");
  return actor;
}

export function assertViewAccess(data: MockState, actorId: string, view: View, venueId: string) {
  if (viewAccess[view] === "public") return;
  const actor = data.users.find((u) => u.id === actorId && u.active && !u.deleted);
  if (!actor || !canOpenView(actor, view)) throw Error("이 작업을 수행할 권한이 없습니다.");
  if (needsVenue(view)) assertCapability(data, actorId, "guest", venueId);
}

export function requireGuestAction(data: MockState, actorId: string, eventId: string, guestId: string, action: "check" | "delete") {
  const event = data.events.find((e) => e.id === eventId);
  if (!event) throw Error("이 작업을 수행할 권한이 없습니다.");
  const actor = assertCapability(data, actorId, action === "check" ? "door" : "guest", event.venueId);
  const guest = data.guests.find((g) => g.id === guestId && g.eventId === event.id && g.venueId === event.venueId && g.status !== "deleted");
  if (!guest || (action === "delete" && !permissionsFor(actor).canDoor &&
    (guest.ownerId !== actor.id || guest.externalLinkId !== null)))
    throw Error("이 작업을 수행할 권한이 없습니다.");
  return guest;
}

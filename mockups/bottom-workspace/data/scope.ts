import { MOCK_DATE, type MockEvent, type MockState, type MockUser, type MockVenue, type View } from "./types";

// Empty scope values contain no real tenant data and are never stored as records.
const emptyVenue: MockVenue = {
  id: "", name: "", brandName: "", address: "", description: "", tagline: "",
  domain: "", type: "club", locale: "ko", timezone: "Asia/Seoul",
  opening: "23:00", closing: "07:00", active: false,
};

export function availableVenues(data: MockState, user: MockUser) {
  if (!user.active || user.deleted) return [];
  return data.venues.filter((v) => v.active &&
    (user.role === "super_admin" || v.id === user.venueId));
}

export function needsVenue(view: View) {
  return !["auth", "external", "profile", "venues"].includes(view);
}

export function needsEvent(view: View) {
  return ["home", "roster", "door", "attendance", "requests", "report", "preparation"].includes(view);
}

export function resolveScope(data: MockState, user: MockUser, venueId: string,
  eventId: string, date = MOCK_DATE) {
  const venues = availableVenues(data, user);
  const venue = venues.find((v) => v.id === venueId) ?? venues[0] ?? emptyVenue;
  const events = venue.id ? data.events.filter((e) =>
    e.venueId === venue.id && e.date === date && e.state !== "archived") : [];
  const event: MockEvent = events.find((e) => e.id === eventId) ??
    events.find((e) => !e.general) ?? events[0] ?? {
      id: "", venueId: venue.id, date, name: "", state: "closed",
      capacity: null, target: null, createdAt: "", openedAt: null,
      closedAt: null, templateId: null,
    };
  const inactiveAssignment = user.role !== "super_admin" &&
    data.venues.some((v) => v.id === user.venueId && !v.active);
  const status = !venue.id
    ? inactiveAssignment ? "inactive-venue" : "no-venue"
    : !event.id ? "no-event" : "ready";
  return { venues, venue, event, status } as const;
}

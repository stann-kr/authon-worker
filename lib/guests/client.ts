import { readApi } from "../api/read-client";
import type { Guest } from "./types";

export function fetchGuestsByDate(date: string, venueId?: string, eventId?: string | null, allEvents = false) {
  return readApi<Guest[]>("/api/guests/list", { date, venueId, eventId, ...(allEvents ? { allEvents } : {}) });
}

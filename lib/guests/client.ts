import { readApi } from "../api/read-client";
import type { Guest } from "./types";

export function fetchGuestsByDate(date: string, venueId?: string, eventId?: string | null) {
  return readApi<Guest[]>("/api/guests/list", { date, venueId, eventId });
}

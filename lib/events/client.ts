import { readApi } from "../api/read-client";
import type { Event } from "./types";

export function fetchEvents(params: {
  venueId?: string | null;
  businessDate?: string | null;
  includeArchived?: boolean;
} = {}) {
  return readApi<Event[]>("/api/events/list", params);
}

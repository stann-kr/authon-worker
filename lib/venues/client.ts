import { readApi } from "../api/read-client";
import type { Venue } from "./types";

export function fetchVenues(includeInactive = false) {
  return readApi<Venue[]>("/api/venues/list", { includeInactive });
}

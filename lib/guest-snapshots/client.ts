import { readApi } from "../api/read-client";
import type { GuestOperationsSnapshot, GuestWorkspaceSnapshot } from "./types";

export function fetchGuestOperationsSnapshot(date: string, venueId: string, eventId?: string | null) {
  return readApi<GuestOperationsSnapshot>("/api/guest-snapshots/operations", { date, venueId, eventId });
}

export function fetchGuestWorkspaceSnapshot(date: string, venueId: string, eventId?: string | null) {
  return readApi<GuestWorkspaceSnapshot>("/api/guest-snapshots/workspace", { date, venueId, eventId });
}

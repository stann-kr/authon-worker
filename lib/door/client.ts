import { readApi } from "../api/read-client";
import type { OfflineDoorGuest, OfflineDoorScope } from "./offline-domain";

export function fetchOfflineDoorRoster(scope: OfflineDoorScope) {
  return readApi<OfflineDoorGuest[]>("/api/door/roster", { ...scope });
}

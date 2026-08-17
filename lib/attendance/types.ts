export interface DoorAttendanceSummary {
  venueId: string;
  businessDate: string;
  eventId: string | null;
  checkedInGuests: number;
  walkIns: number;
  totalAttendance: number;
  sourceActivityCount: number;
  isFinalized: boolean;
  finalizedAt: string | null;
  canFinalize: boolean;
  lastUndoableIdempotencyKey: string | null;
  canRecord: boolean;
  unavailableReason: "past_date" | "event_inactive" | "scope_closed" | null;
  serverUpdatedAt: string;
}

export interface AttendanceSyncResult {
  idempotencyKey: string;
  state: "confirmed" | "replayed" | "conflict" | "scope_closed" | "rejected";
  activityId: string | null;
}

export interface AttendanceSyncResponse {
  items: AttendanceSyncResult[];
  summary: DoorAttendanceSummary;
}

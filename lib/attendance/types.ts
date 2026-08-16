export interface DoorAttendanceSummary {
  venueId: string;
  businessDate: string;
  eventId: string | null;
  checkedInGuests: number;
  walkIns: number;
  totalAttendance: number;
  lastUndoableIdempotencyKey: string | null;
  canRecord: boolean;
  unavailableReason: "past_date" | "event_inactive" | null;
  serverUpdatedAt: string;
}

export interface AttendanceSyncResult {
  idempotencyKey: string;
  state: "confirmed" | "replayed" | "conflict" | "rejected";
  activityId: string | null;
}

export interface AttendanceSyncResponse {
  items: AttendanceSyncResult[];
  summary: DoorAttendanceSummary;
}

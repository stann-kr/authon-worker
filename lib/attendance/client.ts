import { readApi } from "../api/read-client";
import type { AttendanceScope } from "./domain";
import type { DoorAttendanceSummary } from "./types";

export function fetchDoorAttendanceSummary(params: {
  scope: AttendanceScope;
  deviceId?: string | null;
}) {
  return readApi<DoorAttendanceSummary>("/api/attendance/summary", {
    ...params.scope,
    deviceId: params.deviceId,
  });
}

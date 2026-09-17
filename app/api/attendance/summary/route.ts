import { fetchDoorAttendanceSummary } from "@/lib/api/attendance";
import { createReadHandler, readString } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchDoorAttendanceSummary({
  scope: {
    venueId: readString(params, "venueId") ?? "",
    businessDate: readString(params, "businessDate") ?? "",
    eventId: readString(params, "eventId"),
  },
  deviceId: readString(params, "deviceId"),
}));

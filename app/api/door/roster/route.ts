import { fetchOfflineDoorRoster } from "@/lib/api/offline-door";
import { createReadHandler, readString } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchOfflineDoorRoster({
  venueId: readString(params, "venueId") ?? "",
  businessDate: readString(params, "businessDate") ?? "",
  eventId: readString(params, "eventId") ?? "",
}));

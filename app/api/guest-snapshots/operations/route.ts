import { fetchGuestOperationsSnapshot } from "@/lib/api/guest-snapshots";
import { createReadHandler, readBoolean, readString } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchGuestOperationsSnapshot(
  readString(params, "date") ?? "",
  readString(params, "venueId") ?? "",
  readString(params, "eventId"),
  readBoolean(params, "allEvents"),
));

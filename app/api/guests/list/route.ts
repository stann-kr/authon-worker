import { fetchGuestsByDate } from "@/lib/api/guests";
import { createReadHandler, readBoolean, readString } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchGuestsByDate(
  readString(params, "date") ?? "",
  readString(params, "venueId") ?? undefined,
  readString(params, "eventId"),
  readBoolean(params, "allEvents"),
));

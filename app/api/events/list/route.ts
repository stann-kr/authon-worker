import { fetchEvents } from "@/lib/api/events";
import { createReadHandler, readBoolean, readString } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchEvents({
  venueId: readString(params, "venueId"),
  businessDate: readString(params, "businessDate"),
  includeArchived: readBoolean(params, "includeArchived"),
}));

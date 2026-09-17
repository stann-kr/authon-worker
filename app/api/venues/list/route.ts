import { fetchVenues } from "@/lib/api/venues";
import { createReadHandler, readBoolean } from "@/lib/api/read-handler";

export const POST = createReadHandler((params) => fetchVenues(readBoolean(params, "includeInactive")));

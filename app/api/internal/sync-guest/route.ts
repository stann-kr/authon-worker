import { getRequestContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { guests } from "@/lib/db/schema";

export async function POST(request: Request) {
  try {
    const { env } = getRequestContext() as unknown as { env: { DB: D1Database; TERMINAL_VENUE_ID: string } };
    const db = drizzle(env.DB);
    const data = await request.json();

    const venueId = env.TERMINAL_VENUE_ID;

    if (!venueId) {
       return Response.json({ ok: false, error: "TERMINAL_VENUE_ID is not configured" }, { status: 500 });
    }

    await db.insert(guests).values({
      id: crypto.randomUUID(),
      venueId,
      name: data.name,
      email: data.email,
      instagram: data.instagram,
      terminalRequestId: data.terminalRequestId,
      source: "terminal",
      status: "pending",
      date: data.date,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.createdAt || new Date().toISOString(),
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Sync guest error:", error);
    return Response.json({ ok: false, error: "Failed to sync guest" }, { status: 500 });
  }
}

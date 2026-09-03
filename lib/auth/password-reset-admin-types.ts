import type { Role } from "../users/policy.ts";

export interface PasswordResetAdminActor {
  id: string;
  role: Extract<Role, "super_admin" | "venue_admin">;
  venueId: string | null;
  sessionVersion: number | null;
}

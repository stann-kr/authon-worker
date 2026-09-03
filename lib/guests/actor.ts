import type { AccountKind, Role } from "../users/policy.ts";

/**
 * The authenticated identity captured by the Server Action. Persistence uses
 * this only to compare against the authoritative user row at write time.
 */
export interface GuestWriteActor {
  id: string;
  role: Role;
  venueId: string | null;
  guestLimit: number | null;
  accountKind: AccountKind;
  doorAccessEnabled: boolean;
  sessionVersion: number;
}

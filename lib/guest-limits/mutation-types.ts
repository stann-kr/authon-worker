import type { AccountKind, Role } from "../users/policy.ts";

export interface GuestLimitMutationActor {
  id: string;
  role: Role;
  accountKind: AccountKind;
  doorAccessEnabled: boolean;
  venueId: string | null;
  guestLimit: number | null;
  sessionVersion: number;
}

export type GuestLimitEventTarget =
  | {
      kind: "exact";
      eventId: string;
      venueId: string;
      businessDate: string;
    }
  | {
      kind: "compatibility";
      proposedEventId: string;
      compatibilityKey: string;
      venueId: string;
      businessDate: string;
    };

export type GuestLimitMutationErrorCode =
  | "REQUEST_NOT_ALLOWED"
  | "INVALID_DATE"
  | "INVALID_EXTRA"
  | "INVALID_REASON"
  | "REQUEST_FAILED"
  | "FORBIDDEN"
  | "INVALID_DECISION"
  | "REQUEST_ALREADY_DECIDED"
  | "EVENT_NOT_ACTIVE"
  | "INVALID_APPROVED_EXTRA"
  | "INVALID_DECISION_NOTE";

export class GuestLimitMutationError extends Error {
  readonly code: GuestLimitMutationErrorCode;

  constructor(code: GuestLimitMutationErrorCode) {
    super(code);
    this.code = code;
    this.name = "GuestLimitMutationError";
  }
}

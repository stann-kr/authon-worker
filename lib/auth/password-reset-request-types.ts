import type {
  PasswordResetRequestSource,
  PasswordResetRequestStatus,
  PasswordResetSetupMethod,
} from "./password-reset-request-policy";
import type { User } from "@/lib/users/types";

export type {
  PasswordResetRequestSource,
  PasswordResetRequestStatus,
  PasswordResetSetupMethod,
  PasswordResetVerificationMethod,
} from "./password-reset-request-policy";

export interface PasswordResetRequest {
  id: string;
  venueId: string | null;
  userId: string;
  source: PasswordResetRequestSource;
  status: PasswordResetRequestStatus;
  setupMethod: PasswordResetSetupMethod | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetRequestView extends PasswordResetRequest {
  userName: string;
  userEmail: string;
  userRole: User["role"];
  userAccountKind: User["accountKind"];
  venueName: string | null;
  codeFreeEligible: boolean;
}

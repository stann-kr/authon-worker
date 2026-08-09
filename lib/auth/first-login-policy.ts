export type FirstLoginSetupMethod = "setup_code" | "admin_approved";

interface FirstLoginAccountState {
  migrationStatus: string;
  passwordSetAt: string | null;
  adminApprovedReset?: boolean;
}

export function getFirstLoginSetupMethod(
  account: FirstLoginAccountState,
): FirstLoginSetupMethod | null {
  if (account.migrationStatus !== "pending_reset" || account.passwordSetAt) {
    return null;
  }

  return account.adminApprovedReset ? "admin_approved" : "setup_code";
}

export function canStartFirstLoginSetup(
  method: FirstLoginSetupMethod,
  setupCodeMatches: boolean,
): boolean {
  return method === "admin_approved" || setupCodeMatches;
}

export function isFirstLoginSetupMethod(
  value: unknown,
): value is FirstLoginSetupMethod {
  return value === "setup_code" || value === "admin_approved";
}

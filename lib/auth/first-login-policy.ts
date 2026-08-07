export type FirstLoginSetupMethod = "migration" | "setup_code";
export type FirstLoginResetControlAction =
  | "password_reset_required"
  | "password_reset_cancelled";

interface FirstLoginAccountState {
  latestResetControlAction: FirstLoginResetControlAction | null;
  migrationStatus: string;
  migratedAt: string | null;
  passwordSetAt: string | null;
}

export function getFirstLoginSetupMethod(
  account: FirstLoginAccountState,
): FirstLoginSetupMethod | null {
  if (account.migrationStatus !== "pending_reset" || account.passwordSetAt) {
    return null;
  }

  return account.migratedAt &&
    account.latestResetControlAction !== "password_reset_required"
    ? "migration"
    : "setup_code";
}

export function canStartFirstLoginSetup(
  method: FirstLoginSetupMethod,
  setupCodeMatches: boolean,
): boolean {
  return method === "migration" || setupCodeMatches;
}

export function isFirstLoginSetupMethod(
  value: unknown,
): value is FirstLoginSetupMethod {
  return value === "migration" || value === "setup_code";
}

export function isFirstLoginResetControlAction(
  value: unknown,
): value is FirstLoginResetControlAction {
  return value === "password_reset_required" || value === "password_reset_cancelled";
}

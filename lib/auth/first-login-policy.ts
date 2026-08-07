export type FirstLoginSetupMethod = "migration" | "setup_code";

interface FirstLoginAccountState {
  hasAdministratorReset: boolean;
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

  return account.migratedAt && !account.hasAdministratorReset
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

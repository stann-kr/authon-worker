export type FirstLoginSetupMethod = "setup_code";

interface FirstLoginAccountState {
  migrationStatus: string;
  passwordSetAt: string | null;
}

export function getFirstLoginSetupMethod(
  account: FirstLoginAccountState,
): FirstLoginSetupMethod | null {
  if (account.migrationStatus !== "pending_reset" || account.passwordSetAt) {
    return null;
  }

  return "setup_code";
}

export function canStartFirstLoginSetup(
  method: FirstLoginSetupMethod,
  setupCodeMatches: boolean,
): boolean {
  return method === "setup_code" && setupCodeMatches;
}

export function isFirstLoginSetupMethod(
  value: unknown,
): value is FirstLoginSetupMethod {
  return value === "setup_code";
}

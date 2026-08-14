export const EXTERNAL_OWNER_KEY_MIN_LENGTH = 32;
export const EXTERNAL_OWNER_KEY_MAX_LENGTH = 128;

export function isValidExternalOwnerKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= EXTERNAL_OWNER_KEY_MIN_LENGTH &&
    value.length <= EXTERNAL_OWNER_KEY_MAX_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function createExternalOwnerKey(
  createUuid: () => string = () => crypto.randomUUID(),
): string {
  const key = createUuid();
  if (!isValidExternalOwnerKey(key)) {
    throw new Error("INVALID_EXTERNAL_OWNER_KEY_GENERATOR");
  }
  return key;
}

export function externalOwnerStorageKey(token: string): string {
  if (
    typeof token !== "string" ||
    token.length < 8 ||
    token.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error("INVALID_EXTERNAL_LINK_TOKEN");
  }
  return `authon:self-rsvp-owner:${token}`;
}

export function canUseContributorRoster(kind: "contributor" | "self_rsvp"): boolean {
  return kind === "contributor";
}

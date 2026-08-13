export const VENUE_MUTATION_ERROR_KEYS = {
  INVALID_TIMEZONE: "invalidTimezone",
  INVALID_OPERATING_HOURS: "invalidOperatingHours",
} as const;

export const GUEST_CREATE_ERROR_KEYS = {
  GUEST_LIMIT_REACHED: "limitReachedServer",
  REGISTERED_BY_REQUIRED: "registeredByRequired",
  DUPLICATE_REQUIRES_CONFIRMATION: "duplicateRequiresConfirmation",
  INVALID_GUEST_NAME: "registerFailed",
} as const;

export function selectDomainMessageKey<
  const TMapping extends Readonly<Record<string, string>>,
  const TFallback extends string,
>(
  code: unknown,
  mapping: TMapping,
  fallback: TFallback,
): TMapping[keyof TMapping] | TFallback {
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(mapping, code)
  ) {
    return mapping[code] as TMapping[keyof TMapping];
  }
  return fallback;
}

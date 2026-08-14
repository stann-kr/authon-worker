export interface VenueAccessSubject {
  role: string | null | undefined;
  venueId: string | null | undefined;
  venueActive: boolean | null | undefined;
}

export function hasActiveVenueAccess(subject: VenueAccessSubject): boolean {
  if (subject.role === "super_admin") return true;
  return Boolean(subject.venueId && subject.venueActive === true);
}

export function isInactiveVenueRecoveryUpdate(
  currentActive: boolean,
  updates: Record<string, unknown>,
): boolean {
  if (currentActive) return true;

  const definedKeys = Object.entries(updates)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

  return (
    definedKeys.length === 1 &&
    definedKeys[0] === "active" &&
    updates.active === true
  );
}

/** Captures the primitive form values used by an async submission. */
export function captureImmutableDraft<T extends Record<string, unknown>>(
  value: T,
): Readonly<T> {
  return Object.freeze({ ...value });
}

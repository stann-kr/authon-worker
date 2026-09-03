export function shouldInvalidateManagedUserCredentials(input: {
  changedFields: readonly string[];
  nextActive: boolean;
}): boolean {
  return (
    input.changedFields.includes("role") ||
    input.changedFields.includes("accountKind") ||
    (input.changedFields.includes("active") && !input.nextActive)
  );
}

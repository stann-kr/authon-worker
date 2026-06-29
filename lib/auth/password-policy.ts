export const PASSWORD_POLICY_HINT = "Minimum 8 characters, including letters and numbers.";

export function getPasswordPolicyError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include both letters and numbers.";
  }
  return null;
}

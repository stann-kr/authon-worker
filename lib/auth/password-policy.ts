export const PASSWORD_POLICY_HINT = "Minimum 8 characters, including letters and numbers.";

export type PasswordPolicyErrorCode =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS";

export function getPasswordPolicyErrorCode(password: string): PasswordPolicyErrorCode | null {
  if (password.length < 8) return "PASSWORD_TOO_SHORT";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS";
  }
  return null;
}

export function getPasswordPolicyError(password: string): string | null {
  const code = getPasswordPolicyErrorCode(password);
  if (code === "PASSWORD_TOO_SHORT") return "Password must be at least 8 characters.";
  if (code === "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS") {
    return "Password must include both letters and numbers.";
  }
  return null;
}

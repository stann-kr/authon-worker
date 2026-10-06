export type ProfilePasswordErrorTarget =
  | "form"
  | "currentPassword"
  | "newPassword"
  | "confirmPassword";

export type ProfilePasswordErrorMessageKey =
  | "currentPasswordIncorrect"
  | "passwordRateLimited"
  | "passwordAccountChanged"
  | "sessionUnavailable"
  | "passwordUpdateFailed";

/**
 * Maps a `/api/profile/password` error `code` to Profile message copy and the
 * field that should receive focus. Unknown codes fall back to a generic error.
 */
export function selectProfilePasswordError(code: unknown): {
  key: ProfilePasswordErrorMessageKey;
  target: ProfilePasswordErrorTarget;
} {
  switch (code) {
    case "PASSWORD_MISMATCH":
      return { key: "currentPasswordIncorrect", target: "currentPassword" };
    case "RATE_LIMITED":
      return { key: "passwordRateLimited", target: "form" };
    case "ACCOUNT_STATE_CHANGED":
      return { key: "passwordAccountChanged", target: "form" };
    case "UNAUTHORIZED":
    case "USER_NOT_FOUND":
      return { key: "sessionUnavailable", target: "form" };
    default:
      return { key: "passwordUpdateFailed", target: "form" };
  }
}

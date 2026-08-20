export type UserOperationErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "EMAIL_ALREADY_EXISTS"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_ROLE"
  | "LAST_SUPER_ADMIN"
  | "USER_DELETED"
  | "USER_INACTIVE"
  | "USER_MUST_BE_INACTIVE"
  | "USER_NOT_FOUND"
  | "UPDATE_FAILED";

export class UserOperationError extends Error {
  readonly code: UserOperationErrorCode;

  constructor(code: UserOperationErrorCode) {
    super(code);
    this.code = code;
    this.name = "UserOperationError";
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_APPROVED_RESET_TTL_MS,
  PASSWORD_RESET_APPROVAL_TTL_MS,
  PASSWORD_RESET_VERIFICATION_METHODS,
  canUseAdminApprovedReset,
  getAdminApprovedResetPolicyError,
  getAllowedPasswordResetSetupMethods,
  getManagedPasswordResetDecisionExpiry,
  getPasswordResetTargetError,
  getAdminApprovedResetExpiry,
  getPasswordResetApprovalExpiry,
  isOpenPasswordResetRequestStatus,
  isPasswordResetRequestSource,
  isPasswordResetRequestStatus,
  isPasswordResetSetupMethod,
  isPasswordResetVerificationMethod,
  isUsableAdminApprovedResetGrant,
  isUsablePasswordResetApproval,
  shouldCreatePasswordResetRequest,
} from "./password-reset-request-policy.ts";

const NOW_MS = Date.parse("2026-08-09T06:00:00.000Z");

test("기본 short-lived approval expiry는 정확히 15분이다", () => {
  assert.equal(PASSWORD_RESET_APPROVAL_TTL_MS, 15 * 60 * 1000);
  assert.equal(ADMIN_APPROVED_RESET_TTL_MS, PASSWORD_RESET_APPROVAL_TTL_MS);
  assert.equal(
    getAdminApprovedResetExpiry(NOW_MS),
    new Date(NOW_MS + PASSWORD_RESET_APPROVAL_TTL_MS).toISOString(),
  );
  for (const setupMethod of ["admin_approved", "setup_code"]) {
    assert.equal(
      getPasswordResetApprovalExpiry(setupMethod, NOW_MS),
      new Date(NOW_MS + PASSWORD_RESET_APPROVAL_TTL_MS).toISOString(),
    );
  }
  assert.throws(
    () => getPasswordResetApprovalExpiry("email", NOW_MS),
    /INVALID_SETUP_METHOD/,
  );
});

test("browser 승인은 요청 24시간 만료를 유지하고 setup code만 15분으로 줄인다", () => {
  const requestExpiresAt = new Date(NOW_MS + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    getManagedPasswordResetDecisionExpiry(
      "admin_approved",
      requestExpiresAt,
      NOW_MS,
    ),
    requestExpiresAt,
  );
  assert.equal(
    getManagedPasswordResetDecisionExpiry(
      "setup_code",
      requestExpiresAt,
      NOW_MS,
    ),
    new Date(NOW_MS + PASSWORD_RESET_APPROVAL_TTL_MS).toISOString(),
  );
  assert.equal(
    getManagedPasswordResetDecisionExpiry(
      "admin_approved",
      new Date(NOW_MS).toISOString(),
      NOW_MS,
    ),
    new Date(NOW_MS + PASSWORD_RESET_APPROVAL_TTL_MS).toISOString(),
  );
});

test("코드 없는 승인은 승인 상태·방식·만료 시각을 모두 만족해야 한다", () => {
  const expiresAt = getAdminApprovedResetExpiry(NOW_MS);
  const grant = {
    status: "approved",
    setupMethod: "admin_approved",
    expiresAt,
  };

  assert.equal(isUsableAdminApprovedResetGrant(grant, NOW_MS), true);
  assert.equal(
    isUsableAdminApprovedResetGrant(grant, Date.parse(expiresAt)),
    false,
  );
  assert.equal(
    isUsableAdminApprovedResetGrant({ ...grant, status: "completed" }, NOW_MS),
    false,
  );
  assert.equal(
    isUsableAdminApprovedResetGrant({ ...grant, setupMethod: "setup_code" }, NOW_MS),
    false,
  );
  assert.equal(
    isUsableAdminApprovedResetGrant({ ...grant, expiresAt: null }, NOW_MS),
    false,
  );
});

test("direct와 setup code 승인 모두 상태·방식·15분 만료를 검증한다", () => {
  for (const setupMethod of ["admin_approved", "setup_code"]) {
    const expiresAt = getPasswordResetApprovalExpiry(setupMethod, NOW_MS);
    const approval = { status: "approved", setupMethod, expiresAt };

    assert.equal(isUsablePasswordResetApproval(approval, NOW_MS), true);
    assert.equal(
      isUsablePasswordResetApproval(approval, Date.parse(expiresAt)),
      false,
    );
  }

  assert.equal(
    isUsablePasswordResetApproval({
      status: "pending",
      setupMethod: "setup_code",
      expiresAt: getPasswordResetApprovalExpiry("setup_code", NOW_MS),
    }, NOW_MS),
    false,
  );
  assert.equal(
    isUsablePasswordResetApproval({
      status: "approved",
      setupMethod: "email",
      expiresAt: getPasswordResetApprovalExpiry("setup_code", NOW_MS),
    }, NOW_MS),
    false,
  );
  assert.equal(
    isUsablePasswordResetApproval({
      status: "approved",
      setupMethod: "setup_code",
      expiresAt: null,
    }, NOW_MS),
    false,
  );
});

test("요청 상태와 입력 discriminator는 알려진 값만 허용한다", () => {
  for (const status of [
    "pending",
    "approved",
    "rejected",
    "completed",
    "cancelled",
  ]) {
    assert.equal(isPasswordResetRequestStatus(status), true);
  }
  assert.equal(isPasswordResetRequestStatus("expired"), false);
  assert.equal(isPasswordResetSetupMethod("setup_code"), true);
  assert.equal(isPasswordResetSetupMethod("admin_approved"), true);
  assert.equal(isPasswordResetSetupMethod("email"), false);
  assert.equal(isPasswordResetRequestSource("self_service"), true);
  assert.equal(isPasswordResetRequestSource("admin"), true);
  assert.equal(isPasswordResetRequestSource("audit"), false);
  assert.deepEqual(PASSWORD_RESET_VERIFICATION_METHODS, [
    "in_person",
    "registered_phone",
    "verified_messenger",
  ]);
  for (const method of PASSWORD_RESET_VERIFICATION_METHODS) {
    assert.equal(isPasswordResetVerificationMethod(method), true);
  }
  assert.equal(isPasswordResetVerificationMethod("email"), false);
  assert.equal(isPasswordResetVerificationMethod(""), false);
  assert.equal(isPasswordResetVerificationMethod(null), false);
});

const directApprovalBase = {
  isSelf: false,
  isManageable: true,
  isExactRequest: true,
  hasSignedReceipt: true,
  requestSource: "self_service",
  targetRole: "staff",
  targetAccountKind: "personal",
  verificationMethod: "in_person",
};

test("개인 하위 역할은 exact self-service request와 signed receipt 검증 후 direct 승인을 허용한다", () => {
  for (const targetRole of ["door_staff", "staff", "dj"]) {
    for (const verificationMethod of PASSWORD_RESET_VERIFICATION_METHODS) {
      const input = {
        ...directApprovalBase,
        targetRole,
        verificationMethod,
      };
      assert.equal(canUseAdminApprovedReset(input), true);
      assert.equal(getAdminApprovedResetPolicyError(input), null);
      assert.deepEqual(getAllowedPasswordResetSetupMethods(input), [
        "setup_code",
        "admin_approved",
      ]);
    }
  }
});

test("manual·부정확 request 또는 signed receipt 없는 요청은 direct 승인을 거부한다", () => {
  const deniedCases = [
    {
      input: { ...directApprovalBase, requestSource: "admin" },
      error: "EXACT_SELF_SERVICE_REQUEST_REQUIRED",
    },
    {
      input: { ...directApprovalBase, isExactRequest: false },
      error: "EXACT_SELF_SERVICE_REQUEST_REQUIRED",
    },
    {
      input: { ...directApprovalBase, hasSignedReceipt: false },
      error: "SIGNED_RECEIPT_REQUIRED",
    },
    {
      input: { ...directApprovalBase, verificationMethod: null },
      error: "VERIFICATION_REQUIRED",
    },
    {
      input: { ...directApprovalBase, verificationMethod: "email" },
      error: "VERIFICATION_REQUIRED",
    },
  ];

  for (const { input, error } of deniedCases) {
    assert.equal(canUseAdminApprovedReset(input), false);
    assert.equal(getAdminApprovedResetPolicyError(input), error);
    assert.deepEqual(getAllowedPasswordResetSetupMethods(input), ["setup_code"]);
  }
});

test("shared·venue admin·super admin 대상은 setup code만 허용한다", () => {
  const deniedCases = [
    { ...directApprovalBase, targetAccountKind: "shared" },
    { ...directApprovalBase, targetRole: "venue_admin" },
    { ...directApprovalBase, targetRole: "super_admin" },
    { ...directApprovalBase, targetRole: "unknown" },
  ];

  for (const input of deniedCases) {
    assert.equal(canUseAdminApprovedReset(input), false);
    assert.equal(
      getAdminApprovedResetPolicyError(input),
      "DIRECT_RESET_NOT_ALLOWED",
    );
    assert.deepEqual(getAllowedPasswordResetSetupMethods(input), ["setup_code"]);
  }
});

test("자기 자신 또는 관리 권한 밖의 대상은 어떤 관리자 reset 방식도 허용하지 않는다", () => {
  const self = { ...directApprovalBase, isSelf: true };
  const forbidden = { ...directApprovalBase, isManageable: false };

  assert.equal(getAdminApprovedResetPolicyError(self), "CANNOT_MANAGE_SELF");
  assert.equal(getAdminApprovedResetPolicyError(forbidden), "FORBIDDEN");
  assert.deepEqual(getAllowedPasswordResetSetupMethods(self), []);
  assert.deepEqual(getAllowedPasswordResetSetupMethods(forbidden), []);
});

test("대기와 승인 상태만 열린 요청으로 취급한다", () => {
  assert.equal(isOpenPasswordResetRequestStatus("pending"), true);
  assert.equal(isOpenPasswordResetRequestStatus("approved"), true);
  assert.equal(isOpenPasswordResetRequestStatus("rejected"), false);
  assert.equal(isOpenPasswordResetRequestStatus("completed"), false);
  assert.equal(isOpenPasswordResetRequestStatus("cancelled"), false);
});

test("공개 요청 대상 판정은 계정 존재 여부와 tenant 경계를 서버 안에서만 구분한다", () => {
  const venueUser = {
    venueId: "venue-a",
    role: "staff",
    active: true,
    deletedAt: null,
  };
  const base = {
    tenantResolved: true,
    tenantScope: "venue",
    tenantVenueId: "venue-a",
  };

  assert.equal(shouldCreatePasswordResetRequest({ ...base, user: venueUser }), true);
  assert.equal(
    shouldCreatePasswordResetRequest({
      ...base,
      tenantVenueId: "venue-b",
      user: venueUser,
    }),
    false,
  );
  assert.equal(
    shouldCreatePasswordResetRequest({ ...base, user: { ...venueUser, active: false } }),
    false,
  );
  assert.equal(
    shouldCreatePasswordResetRequest({
      ...base,
      user: { ...venueUser, deletedAt: NOW_MS.toString() },
    }),
    false,
  );
  assert.equal(shouldCreatePasswordResetRequest({ ...base, user: null }), false);
  assert.equal(
    shouldCreatePasswordResetRequest({
      ...base,
      tenantResolved: false,
      user: venueUser,
    }),
    false,
  );
  assert.equal(
    shouldCreatePasswordResetRequest({
      ...base,
      tenantScope: "platform",
      tenantVenueId: null,
      user: venueUser,
    }),
    true,
  );
  assert.equal(
    shouldCreatePasswordResetRequest({
      ...base,
      tenantVenueId: "venue-b",
      user: { ...venueUser, role: "super_admin", venueId: null },
    }),
    true,
  );
});

test("관리자 재설정 대상은 기존 role·venue·생명주기 경계를 유지한다", () => {
  const manageableTarget = {
    isSelf: false,
    isDeleted: false,
    isManageable: true,
    isActive: true,
  };

  assert.equal(getPasswordResetTargetError(manageableTarget), null);
  assert.equal(
    getPasswordResetTargetError({ ...manageableTarget, isSelf: true }),
    "CANNOT_MANAGE_SELF",
  );
  assert.equal(
    getPasswordResetTargetError({ ...manageableTarget, isManageable: false }),
    "FORBIDDEN",
  );
  assert.equal(
    getPasswordResetTargetError({ ...manageableTarget, isActive: false }),
    "USER_INACTIVE",
  );
  assert.equal(
    getPasswordResetTargetError({ ...manageableTarget, isDeleted: true }),
    "USER_DELETED",
  );
  assert.equal(
    getPasswordResetTargetError({
      ...manageableTarget,
      isManageable: false,
      isDeleted: true,
    }),
    "FORBIDDEN",
  );
});

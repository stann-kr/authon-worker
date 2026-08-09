import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_APPROVED_RESET_TTL_MS,
  getPasswordResetTargetError,
  getAdminApprovedResetExpiry,
  isOpenPasswordResetRequestStatus,
  isPasswordResetRequestSource,
  isPasswordResetRequestStatus,
  isPasswordResetSetupMethod,
  isUsableAdminApprovedResetGrant,
  shouldCreatePasswordResetRequest,
} from "./password-reset-request-policy.ts";

const NOW_MS = Date.parse("2026-08-09T06:00:00.000Z");

test("관리자 코드 없는 승인은 정확히 24시간 유효하도록 발급한다", () => {
  assert.equal(
    getAdminApprovedResetExpiry(NOW_MS),
    new Date(NOW_MS + ADMIN_APPROVED_RESET_TTL_MS).toISOString(),
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

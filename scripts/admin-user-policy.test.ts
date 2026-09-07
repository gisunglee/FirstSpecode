import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeSuspension,
  canGrantSystemAdmin,
  isSystemAdminWithdrawalBlocked,
} from "../src/lib/memberLifecyclePolicy";
import { resolveEffectivePlan } from "../src/lib/permissions";

test("시스템 관리자는 역할 해임 전 스스로 탈퇴할 수 없다", () => {
  assert.equal(isSystemAdminWithdrawalBlocked("SUPER_ADMIN"), true);
  assert.equal(isSystemAdminWithdrawalBlocked(null), false);
});

test("시스템 관리자 임명은 활성 계정에만 허용한다", () => {
  assert.equal(canGrantSystemAdmin("ACTIVE"), true);
  for (const status of ["UNVERIFIED", "SUSPENDED", "WITHDRAWN", null]) {
    assert.equal(canGrantSystemAdmin(status), false, String(status));
  }
});

test("시스템 관리자 계정은 역할 해임 전 정지 상태를 변경할 수 없다", () => {
  assert.equal(canChangeSuspension("SUPER_ADMIN"), false);
  assert.equal(canChangeSuspension(null), true);
});

test("만료된 유료 플랜은 권한 판정에서 FREE로 내려간다", () => {
  const now = new Date("2026-09-06T00:00:00.000Z");

  assert.equal(resolveEffectivePlan("PRO", new Date("2026-09-05T23:59:59.999Z"), now), "FREE");
  assert.equal(resolveEffectivePlan("TEAM", now, now), "FREE");
  assert.equal(resolveEffectivePlan("PRO", new Date("2026-09-06T00:00:00.001Z"), now), "PRO");
  assert.equal(resolveEffectivePlan("ENTERPRISE", null, now), "ENTERPRISE");
  assert.equal(resolveEffectivePlan("INVALID", null, now), "FREE");
});

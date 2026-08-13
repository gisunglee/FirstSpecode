import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission } from "../src/lib/permissions";
import {
  decideSpecContentWrite,
  type SpecResourcePolicyFacts,
} from "../src/lib/specContentPolicyCore";
import {
  checkSpecChangedFields,
  checkSpecCreateFields,
} from "../src/lib/specContentFieldPolicy";

const PROJECT_ID = "project-1";
const CREATED_AT = new Date("2026-08-09T00:00:00.000Z");

const member = {
  mberId: "member-1",
  systemRole: null,
  role: "MEMBER" as const,
  job: "DEV" as const,
};

function resource(overrides: Partial<SpecResourcePolicyFacts> = {}): SpecResourcePolicyFacts {
  return {
    projectId: PROJECT_ID,
    resourceName: "기능",
    creatorId: "creator-1",
    modifierId: null,
    createdAt: CREATED_AT,
    assigneeChain: [null, null],
    ...overrides,
  };
}

test("VIEWER는 PM 직무가 있어도 쓰기 권한을 우회하지 못한다", () => {
  const viewerPm = { role: "VIEWER" as const, job: "PM" as const, plan: "PRO" as const };
  assert.equal(hasPermission(viewerPm, "weeklyReport.manage"), false);
  assert.equal(hasPermission(viewerPm, "requirement.update"), false);
  assert.equal(hasPermission(viewerPm, "content.read"), true);
});

test("관리자는 담당자와 생성 시각에 관계없이 수정·삭제할 수 있다", () => {
  const manager = { ...member, role: "ADMIN" as const };
  const facts = resource();
  assert.deepEqual(decideSpecContentWrite(manager, PROJECT_ID, facts, "UPDATE", CREATED_AT), {
    allowed: true,
    grant: "MANAGER",
    effectiveAssigneeId: null,
    creatorWindowExpiresAt: null,
  });
  assert.equal(decideSpecContentWrite(manager, PROJECT_ID, facts, "DELETE", CREATED_AT).allowed, true);
});

test("직접 담당자가 없으면 가장 가까운 상위 담당자를 적용한다", () => {
  const facts = resource({ assigneeChain: [null, member.mberId, "far-parent"] });
  const decision = decideSpecContentWrite(member, PROJECT_ID, facts, "UPDATE", CREATED_AT);
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.equal(decision.grant, "ASSIGNEE");
    assert.equal(decision.effectiveAssigneeId, member.mberId);
  }
});

test("생성자는 29분에는 수정할 수 있지만 정확히 30분부터 차단된다", () => {
  const creator = { ...member, mberId: "creator-1" };
  const facts = resource();
  const beforeExpiry = new Date(CREATED_AT.getTime() + 29 * 60 * 1000);
  const atExpiry = new Date(CREATED_AT.getTime() + 30 * 60 * 1000);

  const allowed = decideSpecContentWrite(creator, PROJECT_ID, facts, "UPDATE", beforeExpiry);
  assert.equal(allowed.allowed, true);
  if (allowed.allowed) assert.equal(allowed.grant, "CREATOR_WINDOW");

  const denied = decideSpecContentWrite(creator, PROJECT_ID, facts, "UPDATE", atExpiry);
  assert.equal(denied.allowed, false);
  if (!denied.allowed) assert.equal(denied.code, "CREATOR_WINDOW_EXPIRED");
});

test("다른 사용자가 먼저 수정하면 30분 전이라도 생성자 보정 창이 닫힌다", () => {
  const creator = { ...member, mberId: "creator-1" };
  const facts = resource({ modifierId: "another-member" });
  const decision = decideSpecContentWrite(
    creator,
    PROJECT_ID,
    facts,
    "UPDATE",
    new Date(CREATED_AT.getTime() + 5 * 60 * 1000),
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "FORBIDDEN_CREATOR_WINDOW_CLOSED");
});

test("일반 멤버와 담당자는 삭제할 수 없다", () => {
  const decision = decideSpecContentWrite(
    member,
    PROJECT_ID,
    resource({ assigneeChain: [member.mberId] }),
    "DELETE",
    CREATED_AT,
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "FORBIDDEN_DELETE_MANAGER_ONLY");
});

test("생성자 보정은 내용 필드만, 담당자는 운영 필드까지 수정할 수 있다", () => {
  assert.equal(checkSpecChangedFields("FUNCTION", "CREATOR_WINDOW", ["name", "description"]), null);
  assert.equal(
    checkSpecChangedFields("FUNCTION", "CREATOR_WINDOW", ["assignMemberId"])?.code,
    "FORBIDDEN_CREATOR_FIELD",
  );
  assert.equal(checkSpecChangedFields("FUNCTION", "ASSIGNEE", ["complexity", "effort"]), null);
  assert.equal(
    checkSpecChangedFields("FUNCTION", "ASSIGNEE", ["areaId"])?.code,
    "FORBIDDEN_MANAGER_ONLY_FIELD",
  );
});

test("일반 멤버는 생성 시 담당자·표시 ID 같은 관리 필드를 지정할 수 없다", () => {
  assert.equal(checkSpecCreateFields("FUNCTION", false, ["areaId", "name", "description"]), null);
  const denied = checkSpecCreateFields("FUNCTION", false, ["name", "assignMemberId", "displayId"]);
  assert.deepEqual(denied?.restrictedFields, ["assignMemberId", "displayId"]);
  assert.equal(checkSpecCreateFields("FUNCTION", true, ["assignMemberId", "displayId"]), null);
});

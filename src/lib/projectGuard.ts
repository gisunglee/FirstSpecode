/**
 * projectGuard — 프로젝트 soft-delete 게이트 (한 곳에 모은 가드 헬퍼)
 *
 * 역할:
 *   - 프로젝트가 "삭제 예정"(del_yn='Y') 인 경우 일반 사용자에게 노출되지
 *     않도록 막아 주는 헬퍼들을 모아 둔다.
 *   - 권한 가드(`requirePermission`) 가 커버하지 못하는 경로(목록 조회,
 *     공개 메타 조회 등)에서 사용한다.
 *
 * 설계:
 *   - 단순한 상수 + 한두 줄 함수만 둔다. 비대해지면 안 된다.
 *   - SUPER_ADMIN(시스템 관리자) 가 삭제 예정 프로젝트를 조회해야 하는
 *     특수 경로는 본 헬퍼를 사용하지 않고, where 절에 명시적으로 다른
 *     조건을 쓴다. (의도가 코드에 분명히 드러나도록)
 */

import type { Prisma } from "@prisma/client";

// ─── 활성 프로젝트만 거르는 where 조각 ────────────────────────────────────
//
// 사용 예 :
//   prisma.tbPjProject.findMany({
//     where: { ...ACTIVE_PROJECT_WHERE, creat_mber_id: mberId },
//   });
//
// 일반 사용자 화면(프로젝트 목록·내 프로젝트·LNB 등) 모든 조회 경로에서
// 이 조각을 그대로 펼쳐 사용한다. 누락 시 "삭제된 프로젝트가 다시 보이는"
// 버그가 나므로, where 가 있는 모든 프로젝트 조회 경로에서 import 하는
// 것이 안전하다.
export const ACTIVE_PROJECT_WHERE = {
  del_yn: "N",
} satisfies Prisma.TbPjProjectWhereInput;

// ─── tbPjProjectMember 조회용 — 활성 프로젝트의 멤버만 ──────────────────
//
// 멤버십 조회 시 프로젝트가 살아있는지를 함께 검증하고 싶을 때 사용.
// 사용 예 :
//   prisma.tbPjProjectMember.findFirst({
//     where: { mber_id: x, project: ACTIVE_PROJECT_RELATION_WHERE },
//   });
export const ACTIVE_PROJECT_RELATION_WHERE = {
  del_yn: "N",
} satisfies Prisma.TbPjProjectWhereInput;

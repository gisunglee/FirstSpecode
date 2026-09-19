/**
 * projectLifecycle — 프로젝트 보관 삭제(soft delete) 공통 로직
 *
 * 역할:
 *   - 보관 기간 결정 (시스템 설정 PROJECT_SOFT_DELETE_DAYS → 기본 14일)
 *   - 프로젝트를 "삭제 예정" 상태로 마크하고 멤버들에게 제거 안내를 남기는
 *     트랜잭션 본체
 *
 * 왜 분리했나:
 *   같은 보관 삭제가 두 경로에서 일어난다.
 *     (1) OWNER 가 프로젝트를 직접 삭제    — DELETE /api/projects/[id]
 *     (2) 회원 탈퇴 시 소유 프로젝트 정리   — DELETE /api/member/me
 *   과거 (2) 는 CASCADE 로 즉시 물리 삭제했다. 결제 도입 후 "실수로 탈퇴했다,
 *   돈 냈는데 프로젝트가 사라졌다" 는 분쟁을 막으려면 (2) 도 (1) 과 같은
 *   보관 흐름을 타야 한다. 두 곳이 조금씩 다르게 굴러가면 복구 배치·관리자
 *   화면이 한쪽만 알게 되므로 한 함수로 묶는다.
 *
 * 실제 영구 삭제는 별도 배치(project-hard-delete)가 hard_del_dt 를 보고 수행.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

// 보관 기간 기본값(일). 시스템 설정 템플릿에 값이 없거나 깨졌을 때만 사용.
export const SOFT_DELETE_DEFAULT_DAYS = 14;

// 트랜잭션 안에서도 밖에서도 쓸 수 있게 클라이언트 타입을 느슨하게 받는다.
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 보관 기간(일)을 시스템 설정에서 읽는다.
 * 운영자가 TbSysConfigTemplate.PROJECT_SOFT_DELETE_DAYS 로 조정할 수 있고,
 * 값이 없거나 숫자가 아니면 기본값으로 떨어진다.
 */
export async function resolveSoftDeleteRetentionDays(db: Db): Promise<number> {
  const tmpl = await db.tbSysConfigTemplate.findUnique({
    where:  { config_key: "PROJECT_SOFT_DELETE_DAYS" },
    select: { default_value: true },
  });
  const n = parseInt(tmpl?.default_value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : SOFT_DELETE_DEFAULT_DAYS;
}

export type SoftDeleteProjectParams = {
  projectId:   string;
  projectName: string;
  /** 삭제를 요청한 회원 (감사 추적용 del_mber_id) */
  actorMberId: string;
  /**
   * 요청자 본인의 멤버십을 ACTIVE 로 남길지.
   *   - OWNER 가 직접 삭제: true  — 보관 기간 동안 복구(restore)하려면 멤버십이 살아 있어야 함
   *   - 회원 탈퇴:          false — 탈퇴자는 돌아오지 않으므로 함께 REMOVED 처리
   */
  keepActorActive: boolean;
  now:          Date;
  hardDeleteAt: Date;
};

/**
 * 프로젝트 보관 삭제 트랜잭션 본체.
 * 호출자가 prisma.$transaction 안에서 tx 를 넘겨 실행한다.
 *
 *   ① 프로젝트를 del_yn='Y' 로 마크 (복구 가능 상태)
 *   ② 활성 멤버에게 제거 안내를 남기고 상태를 REMOVED 로 변경
 *      — 다른 멤버의 GNB/LNB/대시보드에서 즉시 사라져야 하기 때문
 *      — restore 는 "sttus_chg_dt >= del_dt 인 REMOVED" 를 되살리므로
 *        여기서 찍는 now 가 del_dt 와 같은 값이어야 한다
 */
export async function softDeleteProject(
  tx: Prisma.TransactionClient,
  p:  SoftDeleteProjectParams,
): Promise<void> {
  // ① 삭제 예정 마크
  await tx.tbPjProject.update({
    where: { prjct_id: p.projectId },
    data: {
      del_yn:      "Y",
      del_dt:      p.now,
      del_mber_id: p.actorMberId,
      hard_del_dt: p.hardDeleteAt,
    },
  });

  // ② 상태를 바꿀 멤버 선정 — 요청자 본인은 keepActorActive 에 따라 제외
  const activeMembers = await tx.tbPjProjectMember.findMany({
    where: {
      prjct_id:        p.projectId,
      mber_sttus_code: "ACTIVE",
      ...(p.keepActorActive ? { mber_id: { not: p.actorMberId } } : {}),
    },
    select: { mber_id: true },
  });
  if (activeMembers.length === 0) return;

  // 제거 안내는 "남아 있는 다른 사람" 에게만 의미가 있다.
  // 탈퇴자 본인(keepActorActive=false 로 함께 REMOVED 되는 경우)에게는 남기지 않는다.
  const noticeTargets = activeMembers.filter((m) => m.mber_id !== p.actorMberId);
  if (noticeTargets.length > 0) {
    await tx.tbPjMemberRemovalNotice.createMany({
      data: noticeTargets.map((m) => ({
        mber_id:  m.mber_id,
        prjct_id: p.projectId,
        prjct_nm: p.projectName,
      })),
    });
  }

  await tx.tbPjProjectMember.updateMany({
    where: {
      prjct_id: p.projectId,
      mber_id:  { in: activeMembers.map((m) => m.mber_id) },
    },
    data: {
      mber_sttus_code: "REMOVED",
      sttus_chg_dt:    p.now,
    },
  });
}

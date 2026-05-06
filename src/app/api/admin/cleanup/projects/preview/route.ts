/**
 * GET /api/admin/cleanup/projects/preview
 *   - 정보 삭제 화면용 — soft-deleted 프로젝트 목록 (어드민 전용)
 *
 * 노출 범위:
 *   del_yn='Y' 인 모든 프로젝트.
 *   hard_del_dt 도래 여부에 따라 expired 플래그를 부여 — UI 가 배지로 분기.
 *
 *   - expired=true  : 보관기간 만료(즉시 영구 삭제 가능). UI 빨간 배지.
 *   - expired=false : 보관기간 중(아직 OWNER 가 복구할 수 있는 상태).
 *                     어드민이 강제 삭제하면 OWNER 의 복구권을 침해하므로
 *                     UI 에서 추가 경고를 띄워야 한다.
 *
 * 페이징:
 *   ?page=1&pageSize=50    (기본값) — 수백 건 누적 시 응답 비대화 방지.
 *   summary 의 카운트는 페이지가 아닌 "전체 soft-deleted" 기준으로 항상
 *   정확하게 반환한다.
 *
 * 임팩트 카운트:
 *   각 프로젝트가 영구 삭제될 때 함께 사라지는 자식 도메인의 행 수를 함께
 *   반환한다 (요구사항/화면/영역/기능/단위업무/AI 태스크/DB 테이블/첨부파일).
 *   운영자가 무게감을 즉시 가늠할 수 있도록 _count 에 한 번에 묶어 조회.
 *
 * 정렬:
 *   1) expired=true 먼저 (만료 임박 → 정리 시급)
 *   2) hard_del_dt 오래된 것 우선
 *
 * 부수효과:
 *   조회만 — 잡 로그 남기지 않음.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const page     = Math.max(1, parseInt(searchParams.get("page")     ?? "1",  10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  const where = { del_yn: "Y" } as const;

  try {
    // 전체 카운트(요약용) + 페이지 데이터 병렬 조회
    const [allDelDts, projects, totalCount] = await Promise.all([
      // summary 정확도를 위해 전체 hard_del_dt 만 가볍게 조회
      prisma.tbPjProject.findMany({
        where,
        select: { hard_del_dt: true },
      }),
      prisma.tbPjProject.findMany({
        where,
        select: {
          prjct_id:    true,
          prjct_nm:    true,
          client_nm:   true,
          del_dt:      true,
          hard_del_dt: true,
          del_mber_id: true,
          // 삭제 요청한 OWNER — 운영자가 누가 지운 건지 빠르게 식별
          members: {
            where:  { role_code: "OWNER" },
            select: {
              mber_id: true,
              member:  { select: { email_addr: true, mber_nm: true } },
            },
            take: 1,
          },
          // 영구 삭제 시 함께 사라질 자식 도메인 수 — UI 임팩트 미리보기
          _count: {
            select: {
              requirements: true,
              screens:      true,
              areas:        true,
              functions:    true,
              unitWorks:    true,
              tasks:        true,
              aiTasks:      true,
              dbTables:     true,
              attachFiles:  true,
            },
          },
        },
        // expired 가 자연스럽게 위로 모이도록 hard_del_dt 오름차순. NULL 은
        // PostgreSQL 기본이 NULLS LAST 라 페이지 끝으로 밀린다 — 의도와 일치.
        orderBy: { hard_del_dt: "asc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
      prisma.tbPjProject.count({ where }),
    ]);

    const now = new Date();

    const items = projects
      .map((p) => {
        const expired = !!(p.hard_del_dt && p.hard_del_dt <= now);
        return {
          projectId:    p.prjct_id,
          name:         p.prjct_nm,
          clientName:   p.client_nm ?? null,
          deletedAt:    p.del_dt?.toISOString()      ?? null,
          hardDeleteAt: p.hard_del_dt?.toISOString() ?? null,
          expired,
          // 잔여 보관 시간(시간 단위) — UI 에서 D-Day 계산
          remainingHours: p.hard_del_dt
            ? Math.max(0, Math.round((p.hard_del_dt.getTime() - now.getTime()) / 3_600_000))
            : null,
          deletedBy: p.del_mber_id ?? null,
          owner:     p.members[0]?.member
            ? {
                mberId: p.members[0].mber_id,
                email:  p.members[0].member.email_addr,
                name:   p.members[0].member.mber_nm,
              }
            : null,
          // 영구 삭제 시 함께 사라지는 자식 도메인 카운트 — UI 임팩트 컬럼
          impact: {
            requirements: p._count.requirements,
            screens:      p._count.screens,
            areas:        p._count.areas,
            functions:    p._count.functions,
            unitWorks:    p._count.unitWorks,
            tasks:        p._count.tasks,
            aiTasks:      p._count.aiTasks,
            dbTables:     p._count.dbTables,
            attachFiles:  p._count.attachFiles,
          },
          // 자식 행 수 합계 — UI 정렬/요약에 활용
          impactTotal:
            p._count.requirements + p._count.screens + p._count.areas +
            p._count.functions    + p._count.unitWorks + p._count.tasks +
            p._count.aiTasks      + p._count.dbTables + p._count.attachFiles,
        };
      })
      // 페이지 내에서 expired 가 위로 모이도록 한 번 더 안정화
      .sort((a, b) => {
        if (a.expired !== b.expired) return a.expired ? -1 : 1;
        const aT = a.hardDeleteAt ? new Date(a.hardDeleteAt).getTime() : Number.POSITIVE_INFINITY;
        const bT = b.hardDeleteAt ? new Date(b.hardDeleteAt).getTime() : Number.POSITIVE_INFINITY;
        return aT - bT;
      });

    // 요약은 페이지가 아니라 "전체 soft-deleted" 기준
    const summary = allDelDts.reduce(
      (acc, p) => {
        if (p.hard_del_dt && p.hard_del_dt <= now) acc.expiredCnt++;
        else                                       acc.retainedCnt++;
        return acc;
      },
      { expiredCnt: 0, retainedCnt: 0 }
    );

    return apiSuccess({
      items,
      summary,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/cleanup/projects/preview] DB 오류:", err);
    return apiError("DB_ERROR", "삭제 대상 프로젝트 조회에 실패했습니다.", 500);
  }
}

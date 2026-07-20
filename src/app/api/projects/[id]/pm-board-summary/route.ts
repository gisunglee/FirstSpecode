/**
 * GET /api/projects/[id]/pm-board-summary
 *   — "PM 현황"(/pm-board) 전용 요약. PM 진단(pm-summary)과는 완전히 별도 엔드포인트.
 *
 * 역할:
 *   - 7개 카테고리(요구사항 분석 / 단위업무·화면·기능 × 설계·구현)를 한 라운드트립으로.
 *   - PM 진단은 전부 "멤버 기준"인데, 이건 "항목 기준" — 카테고리마다 진척률 4구간 분포 +
 *     마감 임박 순 목록을 보여준다("전체적으로 잘 굴러가나"를 한눈에 보려는 화면).
 *   - 요구사항을 뺀 6개 카테고리는 lib/pm/fetchDeadlineItems.ts(entity × progressKind)를
 *     그대로 재사용 — 다른 세션이 만든 마감 임박 위젯들과 같은 원본 조회·같은 날짜 규칙을 쓴다.
 *     (화면 구현도 화면 설계와 똑같이 design_bgng_de/design_end_de 를 쓴다 — 화면엔 구현 전용
 *      날짜 필드가 없기 때문. 기능도 설계/구현 둘 다 impl_bgng_de/impl_end_de 를 그대로 씀.
 *      이 규칙은 fetchDeadlineItems 가 이미 확립해둔 것을 그대로 따른 것 — 새로 만들지 않음)
 *   - fetchDeadlineItems 는 계층 부모 이름(단위업무명, 화면명)을 안 주므로, 화면/기능용으로
 *     가벼운 보강 조회를 별도로 한다("화면 = 단위업무+화면", "기능 = 단위업무+화면+기능명" 표시용).
 *
 * Query:
 *   asOf — yyyy-MM-dd (선택 — 없으면 실제 오늘)
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchDeadlineItems, type RawDeadlineItem } from "@/lib/pm/fetchDeadlineItems";
import { buildBoardCategory, type BoardItemInput } from "@/lib/pm/boardStatus";
import type { BoardCategory, BoardCategoryKind, PmBoardSummaryResponse } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

// 카드 하나에 표까지 다 보여줄 상한 — PM 진단의 pm-delay-detail/pm-deadline-list 와 동일 기준.
const ROW_LIMIT = 100;
const HARD_LIMIT = 2000;

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const asOfParam = new URL(request.url).searchParams.get("asOf");
  const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);

  try {
    // ── 요구사항을 뺀 6개 카테고리 원본 — 기존 공용 조회 재사용 (DB 조회 로직 중복 없음) ──
    const [uwDesign, uwImpl, scrDesign, scrImpl, fnDesign, fnImpl] = await Promise.all([
      fetchDeadlineItems(projectId, "UNIT_WORK", "DESIGN"),
      fetchDeadlineItems(projectId, "UNIT_WORK", "IMPL"),
      fetchDeadlineItems(projectId, "SCREEN", "DESIGN"),
      fetchDeadlineItems(projectId, "SCREEN", "IMPL"),
      fetchDeadlineItems(projectId, "FUNCTION", "DESIGN"),
      fetchDeadlineItems(projectId, "FUNCTION", "IMPL"),
    ]);

    // ── 요구사항 분석 원본 ─────────────────────────────────────────────────
    const requirements = await prisma.tbRqRequirement.findMany({
      where:  { prjct_id: projectId },
      select: {
        req_id: true, req_display_id: true, req_nm: true, asign_mber_id: true,
        anls_bgng_de: true, anls_end_de: true, progrs_rt: true,
      },
      take: HARD_LIMIT,
    });

    // ── 계층 부모 이름 보강 조회 — 화면=[단위업무], 기능=[단위업무, 화면] ───────
    const screensWithParent = await prisma.tbDsScreen.findMany({
      where:  { prjct_id: projectId },
      select: { scrn_id: true, unitWork: { select: { unit_work_nm: true } } },
      take: HARD_LIMIT,
    });
    const screenParentMap = new Map(
      screensWithParent.map((s) => [s.scrn_id, s.unitWork?.unit_work_nm ?? null])
    );

    const functionsWithParent = await prisma.tbDsFunction.findMany({
      where:  { prjct_id: projectId },
      select: {
        func_id: true,
        area: { select: { screen: { select: { scrn_nm: true, unitWork: { select: { unit_work_nm: true } } } } } },
      },
      take: HARD_LIMIT,
    });
    const functionParentMap = new Map(
      functionsWithParent.map((f) => [
        f.func_id,
        {
          unitWorkName: f.area?.screen?.unitWork?.unit_work_nm ?? null,
          screenName:   f.area?.screen?.scrn_nm ?? null,
        },
      ])
    );

    // ── 멤버 이름 일괄 조회 (N+1 방지) — 6개 카테고리 + 요구사항 담당자 전부 ─────
    const memberIds = [
      ...new Set(
        [
          ...uwDesign, ...uwImpl, ...scrDesign, ...scrImpl, ...fnDesign, ...fnImpl,
        ].map((it) => it.mberId)
          .concat(requirements.map((r) => r.asign_mber_id))
          .filter((v): v is string => !!v)
      ),
    ];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    // ── 변환 헬퍼들 ──────────────────────────────────────────────────────
    const withMemberName = (mberId: string | null) => (mberId ? (nameMap.get(mberId) ?? mberId) : null);

    // 단위업무 항목 — 부모 없음(자기 자신이 최상위)
    const toUnitWorkInput = (r: RawDeadlineItem): BoardItemInput => ({
      id: r.id, displayId: r.displayId, name: r.name, href: r.href,
      parentNames: [],
      mberId: r.mberId, memberName: withMemberName(r.mberId),
      startDate: r.startDate, endDate: r.endDate, progress: r.progress,
    });
    // 화면 항목 — 부모 1개(단위업무)
    const toScreenInput = (r: RawDeadlineItem): BoardItemInput => ({
      id: r.id, displayId: r.displayId, name: r.name, href: r.href,
      parentNames: [screenParentMap.get(r.id) ?? "미분류"],
      mberId: r.mberId, memberName: withMemberName(r.mberId),
      startDate: r.startDate, endDate: r.endDate, progress: r.progress,
    });
    // 기능 항목 — 부모 2개(단위업무, 화면)
    const toFunctionInput = (r: RawDeadlineItem): BoardItemInput => {
      const parent = functionParentMap.get(r.id);
      return {
        id: r.id, displayId: r.displayId, name: r.name, href: r.href,
        parentNames: [parent?.unitWorkName ?? "미분류", parent?.screenName ?? "미분류"],
        mberId: r.mberId, memberName: withMemberName(r.mberId),
        startDate: r.startDate, endDate: r.endDate, progress: r.progress,
      };
    };

    const categoryDefs: { kind: BoardCategoryKind; label: string; inputs: BoardItemInput[] }[] = [
      {
        kind: "REQUIREMENT_ANALYSIS", label: "요구사항 분석",
        inputs: requirements.map((r) => ({
          id: r.req_id, displayId: r.req_display_id, name: r.req_nm,
          href: `/projects/${projectId}/requirements/${r.req_id}`,
          parentNames: [],
          mberId: r.asign_mber_id, memberName: withMemberName(r.asign_mber_id),
          startDate: r.anls_bgng_de, endDate: r.anls_end_de, progress: r.progrs_rt,
        })),
      },
      { kind: "UNIT_WORK_DESIGN", label: "단위업무 설계", inputs: uwDesign.map(toUnitWorkInput) },
      { kind: "SCREEN_DESIGN",    label: "화면 설계",     inputs: scrDesign.map(toScreenInput) },
      { kind: "FUNCTION_DESIGN",  label: "기능 설계",     inputs: fnDesign.map(toFunctionInput) },
      { kind: "UNIT_WORK_IMPL",   label: "단위업무 구현", inputs: uwImpl.map(toUnitWorkInput) },
      { kind: "SCREEN_IMPL",      label: "화면 구현",     inputs: scrImpl.map(toScreenInput) },
      { kind: "FUNCTION_IMPL",    label: "기능 구현",     inputs: fnImpl.map(toFunctionInput) },
    ];

    const categories: BoardCategory[] = categoryDefs.map(({ kind, label, inputs }) => {
      const category = buildBoardCategory(kind, label, inputs, todayStr);
      // buckets/totalCount 는 전체 기준으로 이미 계산됨 — 표에 내려줄 목록만 상한을 건다.
      return { ...category, items: category.items.slice(0, ROW_LIMIT) };
    });

    const response: PmBoardSummaryResponse = {
      categories,
      generatedAt: new Date().toISOString(),
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-board-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "PM 현황 데이터 조회에 실패했습니다.", 500);
  }
}

/**
 * GET  /api/projects/[id]/standard-guides — 표준 가이드 목록 조회
 * POST /api/projects/[id]/standard-guides — 표준 가이드 신규 등록
 *
 * 역할:
 *   - 프로젝트별 표준 가이드 목록 (카테고리 필터 + 제목/본문 검색 + 페이지네이션)
 *   - 소프트 삭제된 건(use_yn='N')은 목록에서 제외
 *   - 향후 MCP tool 노출과 /run-ai-task 프롬프트 주입의 데이터 소스
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { isGuideCategory } from "@/constants/codes";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 표준 가이드 목록 조회 ──────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url       = new URL(request.url);
  const category  = url.searchParams.get("category")?.trim() ?? "";
  const search    = url.searchParams.get("search")?.trim() ?? "";
  // 사용여부 필터: "Y"=사용중만, "N"=미사용만, ""=전체 (기본)
  const useFilter = url.searchParams.get("use")?.trim() ?? "";
  // 기본값: page 1, pageSize 50 — 50건 넘으면 페이지네이션 필요
  const pageRaw     = parseInt(url.searchParams.get("page")     ?? "1",  10);
  const pageSizeRaw = parseInt(url.searchParams.get("pageSize") ?? "50", 10);
  const page        = Number.isFinite(pageRaw)     && pageRaw     >= 1   ? pageRaw     : 1;
  // pageSize 상한 100 — 과도한 스캔 방지
  const pageSize    = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 && pageSizeRaw <= 100
                    ? pageSizeRaw : 50;

  // category 파라미터가 있으면 반드시 enum에 속해야 함 — 오타 방어
  if (category && !isGuideCategory(category)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 카테고리입니다.", 400);
  }

  // use 파라미터는 빈 값(전체) 또는 Y/N 만 허용
  if (useFilter && useFilter !== "Y" && useFilter !== "N") {
    return apiError("VALIDATION_ERROR", "사용여부 필터는 Y 또는 N 이어야 합니다.", 400);
  }

  try {
    // 삭제는 물리 삭제이므로 use_yn 기본 필터는 적용하지 않는다
    // (use_yn='N'은 "미사용" 상태이지 삭제가 아님)
    const where: Record<string, unknown> = {
      prjct_id: projectId,
    };
    if (useFilter) {
      where.use_yn = useFilter;
    }
    if (category) {
      where.guide_ctgry_code = category;
    }
    if (search) {
      // 제목 또는 본문 부분일치
      where.OR = [
        { guide_sj: { contains: search, mode: "insensitive" } },
        { guide_cn: { contains: search, mode: "insensitive" } },
      ];
    }

    // 총 건수와 페이지 데이터 병렬 조회 — 페이지네이션 계산용
    const [total, guides] = await Promise.all([
      prisma.tbSgStdGuide.count({ where }),
      prisma.tbSgStdGuide.findMany({
        where,
        // 수정일 우선(최근 변경 위로) → 없으면 작성일
        orderBy: [{ mdfcn_dt: "desc" }, { creat_dt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 작성자 이름 조회 (고유 mber_id 수집)
    const mberIds = [...new Set(guides.map((g) => g.creat_mber_id))];
    const members = mberIds.length
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true },
        })
      : [];
    const mberMap = new Map(members.map((m) => [m.mber_id, m.mber_nm]));

    const items = guides.map((g) => ({
      guideId:       g.guide_id,
      category:      g.guide_ctgry_code,
      subject:       g.guide_sj,
      useYn:         g.use_yn,
      creatMberId:   g.creat_mber_id,
      creatMberName: mberMap.get(g.creat_mber_id) ?? "",
      creatDt:       g.creat_dt,
      mdfcnDt:       g.mdfcn_dt,
    }));

    return apiSuccess({
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/standard-guides]`, err);
    return apiError("DB_ERROR", "표준 가이드 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 표준 가이드 신규 등록 ─────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: { category?: string; subject?: string; content?: string; useYn?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // 카테고리 필수 + enum 검증
  if (!isGuideCategory(body.category)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 카테고리입니다.", 400);
  }

  // 제목 trim 후 빈 값이면 거부 — DB에 공백만 들어가는 것 방지
  const subject = body.subject?.trim() ?? "";
  if (!subject) {
    return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  }

  // 사용여부 — 생략 시 기본 Y(사용중), 'Y'/'N' 외엔 거부
  const useYn = body.useYn === "N" ? "N" : "Y";

  try {
    const guide = await prisma.tbSgStdGuide.create({
      data: {
        prjct_id:         projectId,
        guide_ctgry_code: body.category,
        guide_sj:         subject,
        guide_cn:         body.content ?? "",
        use_yn:           useYn,
        creat_mber_id:    gate.mberId,
      },
    });

    return apiSuccess({ guideId: guide.guide_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/standard-guides]`, err);
    return apiError("DB_ERROR", "표준 가이드 저장에 실패했습니다.", 500);
  }
}

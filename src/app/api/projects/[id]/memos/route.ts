/**
 * GET  /api/projects/[id]/memos — 메모 목록 조회
 * POST /api/projects/[id]/memos — 메모 생성
 *
 * 역할:
 *   - 본인 메모 전체 + visblty_code가 PRIVATE가 아닌 타인 메모 조회
 *   - refType/refId 필터, search 키워드 검색 지원
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchProjectMemos } from "@/lib/exports/memos-data";
import { checkMemoSheetSize } from "@/lib/memoSheetLimits";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 메모 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url       = new URL(request.url);
  const refType   = url.searchParams.get("refType") ?? undefined;
  const refId     = url.searchParams.get("refId") ?? undefined;
  const search    = url.searchParams.get("search")?.trim() ?? undefined;
  const visibility = url.searchParams.get("visibility") ?? undefined; // "mine" | "team" | undefined(전체)
  const purpose   = url.searchParams.get("purpose") ?? undefined;     // "GENERAL" | "MEETING" | undefined(전체)

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectMemos({
      projectId,
      mberId: gate.mberId,
      refType, refId, search, visibility, purpose,
    });
    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/memos]`, err);
    return apiError("DB_ERROR", "메모 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 메모 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: {
    subject?: string; content?: string; sheetData?: unknown;
    memoTyCode?: string; visbltyCode?: string; purposeCode?: string; refTyCode?: string; refId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const subject = body.subject?.trim() ?? "";
  if (!subject) {
    return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  }

  // refTyCode 유효성 검증 — 엔티티 상세화면에서 연결 진입 가능한 6종
  const validRefTypes = ["REQUIREMENT", "TASK", "UNIT_WORK", "SCREEN", "AREA", "FUNCTION"];
  if (body.refTyCode && !validRefTypes.includes(body.refTyCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 연결 유형입니다.", 400);
  }

  // memoTyCode — 작성 시 확정, 이후 불변(PUT에서 변경 불가)
  const memoTyCode = body.memoTyCode === "EXCEL" ? "EXCEL" : "WEB";
  if (memoTyCode === "EXCEL" && (body.sheetData === undefined || body.sheetData === null)) {
    return apiError("VALIDATION_ERROR", "엑셀형 메모는 표 데이터가 필요합니다.", 400);
  }
  // 이미지가 base64로 그대로 jsonb에 들어가므로 우회 방지용으로 서버에서도 검사
  if (memoTyCode === "EXCEL") {
    const sizeCheck = checkMemoSheetSize(body.sheetData);
    if (!sizeCheck.ok) {
      return apiError("VALIDATION_ERROR", sizeCheck.message, 400);
    }
  }

  const validVisibility = ["PRIVATE", "TEAM_READ", "TEAM_EDIT"];
  const visbltyCode = validVisibility.includes(body.visbltyCode ?? "") ? body.visbltyCode! : "PRIVATE";

  const validPurpose = ["GENERAL", "MEETING"];
  const purposeCode = validPurpose.includes(body.purposeCode ?? "") ? body.purposeCode! : "GENERAL";

  try {
    const memo = await prisma.tbDsMemo.create({
      data: {
        prjct_id:        projectId,
        memo_sj:         subject,
        memo_cn:         memoTyCode === "WEB" ? (body.content ?? "") : null,
        memo_ty_code:    memoTyCode,
        sheet_data:      memoTyCode === "EXCEL" ? (body.sheetData as object) : undefined,
        visblty_code:    visbltyCode,
        memo_purps_code: purposeCode,
        ref_ty_code:     body.refTyCode ?? null,
        ref_id:          body.refId ?? null,
        creat_mber_id:   gate.mberId,
      },
    });

    return apiSuccess({ memoId: memo.memo_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/memos]`, err);
    return apiError("DB_ERROR", "메모 생성에 실패했습니다.", 500);
  }
}


/**
 * GET  /api/projects/[id]/memos — 메모 목록 조회
 * POST /api/projects/[id]/memos — 메모 생성
 *
 * 역할:
 *   - 본인 메모 전체 + share_yn="Y"인 타인 메모 조회
 *   - refType/refId 필터, search 키워드 검색 지원
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 메모 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url      = new URL(request.url);
  const refType  = url.searchParams.get("refType") ?? undefined;
  const refId    = url.searchParams.get("refId") ?? undefined;
  const search   = url.searchParams.get("search")?.trim() ?? undefined;
  const shareFilter = url.searchParams.get("share") ?? undefined; // "mine" | "shared" | undefined(전체)

  try {
    // 조회 범위: 본인 메모 + 공유 메모
    const where: Record<string, unknown> = {
      prjct_id: projectId,
      OR: [
        { creat_mber_id: auth.mberId },
        { share_yn: "Y" },
      ],
    };

    // refType + refId 필터 (상세 페이지에서 연결 메모만 볼 때)
    if (refType && refId) {
      where.ref_ty_code = refType;
      where.ref_id = refId;
    }

    // 검색 키워드
    if (search) {
      where.memo_sj = { contains: search, mode: "insensitive" };
    }

    // 공유 필터
    if (shareFilter === "mine") {
      // 내 메모만 — OR 조건 제거
      delete where.OR;
      where.creat_mber_id = auth.mberId;
    } else if (shareFilter === "shared") {
      // 공유 메모만
      delete where.OR;
      where.share_yn = "Y";
    }

    const memos = await prisma.tbDsMemo.findMany({
      where,
      orderBy: { creat_dt: "desc" },
      take: 200,
    });

    // 작성자 이름 조회 (고유 mber_id 수집)
    const mberIds = [...new Set(memos.map((m) => m.creat_mber_id))];
    const members = await prisma.tbCmMember.findMany({
      where: { mber_id: { in: mberIds } },
      select: { mber_id: true, mber_nm: true },
    });
    const mberMap = new Map(members.map((m) => [m.mber_id, m.mber_nm]));

    // 연결 엔티티 이름 조회 (ref_ty_code별 일괄)
    const refNameMap = await resolveRefNames(memos);

    const items = memos.map((m) => ({
      memoId:       m.memo_id,
      subject:      m.memo_sj,
      shareYn:      m.share_yn,
      refTyCode:    m.ref_ty_code,
      refId:        m.ref_id,
      refName:      m.ref_id ? (refNameMap.get(m.ref_id) ?? "") : "",
      viewCnt:      m.view_cnt,
      creatMberId:  m.creat_mber_id,
      creatMberName: mberMap.get(m.creat_mber_id) ?? "",
      isMine:       m.creat_mber_id === auth.mberId,
      creatDt:      m.creat_dt,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/memos]`, err);
    return apiError("DB_ERROR", "메모 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 메모 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { subject?: string; content?: string; shareYn?: string; refTyCode?: string; refId?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const subject = body.subject?.trim() ?? "";
  if (!subject) {
    return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  }

  // refTyCode 유효성 검증
  const validRefTypes = ["FUNCTION", "AREA", "SCREEN", "UNIT_WORK"];
  if (body.refTyCode && !validRefTypes.includes(body.refTyCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 연결 유형입니다.", 400);
  }

  try {
    const memo = await prisma.tbDsMemo.create({
      data: {
        prjct_id:      projectId,
        memo_sj:       subject,
        memo_cn:       body.content ?? "",
        share_yn:      body.shareYn === "Y" ? "Y" : "N",
        ref_ty_code:   body.refTyCode ?? null,
        ref_id:        body.refId ?? null,
        creat_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ memoId: memo.memo_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/memos]`, err);
    return apiError("DB_ERROR", "메모 생성에 실패했습니다.", 500);
  }
}

// ── 연결 엔티티 이름 일괄 조회 유틸 ──────────────────────────────────────────
async function resolveRefNames(
  memos: { ref_ty_code: string | null; ref_id: string | null }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // ref_ty_code별로 ID 수집
  const groups: Record<string, string[]> = {};
  for (const m of memos) {
    if (!m.ref_ty_code || !m.ref_id) continue;
    if (!groups[m.ref_ty_code]) groups[m.ref_ty_code] = [];
    groups[m.ref_ty_code].push(m.ref_id);
  }

  // 각 타입별 일괄 조회
  const queries: Promise<void>[] = [];

  if (groups.FUNCTION?.length) {
    queries.push(
      prisma.tbDsFunction.findMany({
        where: { func_id: { in: groups.FUNCTION } },
        select: { func_id: true, func_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.func_id, r.func_nm)))
    );
  }
  if (groups.AREA?.length) {
    queries.push(
      prisma.tbDsArea.findMany({
        where: { area_id: { in: groups.AREA } },
        select: { area_id: true, area_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.area_id, r.area_nm)))
    );
  }
  if (groups.SCREEN?.length) {
    queries.push(
      prisma.tbDsScreen.findMany({
        where: { scrn_id: { in: groups.SCREEN } },
        select: { scrn_id: true, scrn_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.scrn_id, r.scrn_nm)))
    );
  }
  if (groups.UNIT_WORK?.length) {
    queries.push(
      prisma.tbDsUnitWork.findMany({
        where: { unit_work_id: { in: groups.UNIT_WORK } },
        select: { unit_work_id: true, unit_work_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.unit_work_id, r.unit_work_nm)))
    );
  }

  await Promise.all(queries);
  return map;
}

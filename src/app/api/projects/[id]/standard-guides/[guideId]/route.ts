/**
 * GET    /api/projects/[id]/standard-guides/[guideId] — 단건 조회
 * PUT    /api/projects/[id]/standard-guides/[guideId] — 수정 (사용여부 토글 포함)
 * DELETE /api/projects/[id]/standard-guides/[guideId] — 물리 삭제
 *
 * 역할:
 *   - 편집 모드의 상세 화면 데이터 소스
 *   - 표준 가이드는 팀 공용 지식 베이스 → 수정은 content.update 권한자 누구나
 *     삭제는 작성자 본인 또는 PM/PL 직무만 (책임자 한정)
 *
 * 사용여부(use_yn) 의미:
 *   - Y = 사용 중 (AI가 이 가이드를 참조)
 *   - N = 미사용 (보관만, AI에게 전달 안 함) — 삭제가 아닌 "비활성화" 상태
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { isGuideCategory } from "@/constants/codes";

type RouteParams = { params: Promise<{ id: string; guideId: string }> };

// ── GET: 단건 조회 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, guideId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const guide = await prisma.tbSgStdGuide.findUnique({
      where: { guide_id: guideId },
    });

    // 존재 여부 + 프로젝트 일치 체크
    // (다른 프로젝트 ID를 파라미터로 넣어도 NOT_FOUND 반환 — 정보 노출 방지)
    // use_yn='N'(미사용)은 유효한 상태이므로 여기서 거르지 않음
    if (!guide || guide.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "표준 가이드를 찾을 수 없습니다.", 404);
    }

    // 작성자 이름 조회 (단건이므로 findUnique)
    const creator = await prisma.tbCmMember.findUnique({
      where:  { mber_id: guide.creat_mber_id },
      select: { mber_nm: true },
    });

    // 삭제 가능 여부 — UI에서 [삭제] 버튼 노출 조건 판단용
    // DELETE 라우트와 동일 규칙 적용 (작성자 본인 OR PM/PL)
    const canDelete = guide.creat_mber_id === gate.mberId
                   || gate.job === "PM" || gate.job === "PL";

    return apiSuccess({
      guideId:       guide.guide_id,
      category:      guide.guide_ctgry_code,
      subject:       guide.guide_sj,
      content:       guide.guide_cn ?? "",
      useYn:         guide.use_yn,
      creatMberId:   guide.creat_mber_id,
      creatMberName: creator?.mber_nm ?? "",
      creatDt:       guide.creat_dt,
      mdfcnDt:       guide.mdfcn_dt,
      canDelete,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/standard-guides/${guideId}]`, err);
    return apiError("DB_ERROR", "표준 가이드 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 수정 ───────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, guideId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  const guide = await prisma.tbSgStdGuide.findUnique({ where: { guide_id: guideId } });
  if (!guide || guide.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "표준 가이드를 찾을 수 없습니다.", 404);
  }

  let body: { category?: string; subject?: string; content?: string; useYn?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // 부분 수정 — 전달된 필드만 업데이트
  // 제목은 undefined(미전달)와 빈 문자열(지우려 함)을 구분해서 처리
  const subject = body.subject?.trim();
  if (subject !== undefined && !subject) {
    return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  }

  // category가 전달됐다면 반드시 enum 값
  if (body.category !== undefined && !isGuideCategory(body.category)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 카테고리입니다.", 400);
  }

  // useYn이 전달됐다면 반드시 Y/N
  if (body.useYn !== undefined && body.useYn !== "Y" && body.useYn !== "N") {
    return apiError("VALIDATION_ERROR", "사용여부는 Y 또는 N 이어야 합니다.", 400);
  }

  try {
    await prisma.tbSgStdGuide.update({
      where: { guide_id: guideId },
      data: {
        ...(subject !== undefined       && { guide_sj:         subject }),
        ...(body.category !== undefined && { guide_ctgry_code: body.category }),
        ...(body.content !== undefined  && { guide_cn:         body.content }),
        ...(body.useYn !== undefined    && { use_yn:           body.useYn }),
        mdfr_mber_id: gate.mberId,
        mdfcn_dt:     new Date(),
      },
    });

    return apiSuccess({ guideId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/standard-guides/${guideId}]`, err);
    return apiError("DB_ERROR", "표준 가이드 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 물리 삭제 ───────────────────────────────────────────────────────
// 삭제 권한 정책:
//   - 기본 content.delete 권한 통과 (VIEWER 차단)
//   - 그 위에 "작성자 본인" OR "직무 PL/PM" 한정 (팀 공용 자산이지만 삭제는 책임자 한정)
// use_yn은 "사용 여부" 비즈니스 속성이므로 여기서 건드리지 않고 실제로 row를 제거
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, guideId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  const guide = await prisma.tbSgStdGuide.findUnique({ where: { guide_id: guideId } });
  if (!guide || guide.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "표준 가이드를 찾을 수 없습니다.", 404);
  }

  // 작성자 본인 또는 PL/PM 직무만 삭제 가능
  const isAuthor = guide.creat_mber_id === gate.mberId;
  const isLeader = gate.job === "PM" || gate.job === "PL";
  if (!isAuthor && !isLeader) {
    return apiError("FORBIDDEN", "표준 가이드는 작성자 또는 PM/PL 직무만 삭제할 수 있습니다.", 403);
  }

  try {
    await prisma.tbSgStdGuide.delete({ where: { guide_id: guideId } });
    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/standard-guides/${guideId}]`, err);
    return apiError("DB_ERROR", "표준 가이드 삭제에 실패했습니다.", 500);
  }
}

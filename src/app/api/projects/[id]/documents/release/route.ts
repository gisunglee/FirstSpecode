/**
 * /api/projects/[id]/documents/release
 *
 * POST  — 산출물 1건을 새 버전으로 "발행" (TbDsDocumentRelease 행 생성 + 스냅샷 박제)
 * GET   — 특정 산출물의 발행 이력 목록 조회
 *
 * doc_kind:
 *   "REQUIREMENT" 만 우선 지원. 단위업무·화면 등은 추후 같은 모델로 확장.
 *   허용값을 화이트리스트로 검증 (DB 측 CHECK 제약 미설정 — 확장 부담 ↓).
 *
 * 권한:
 *   - POST: "content.export" — 발행은 출력 가능 권한자만 (지원 세션에서 자동 차단됨)
 *   - GET : "content.read"   — 멤버 누구나 발행 이력 열람 가능
 *
 * 스냅샷:
 *   POST 시 buildRequirementExportInput() 으로 만든 양식 입력 객체 통째를
 *   snapshot_data(JSON) 에 박제. 이후 데이터(요구사항 본문/담당자/발주처명) 가
 *   바뀌어도 그 시점의 docx 를 그대로 복원 가능 (시점 일관성).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  buildRequirementExportInput,
  REQUIREMENT_EXPORT_FALLBACK,
} from "@/lib/exports/requirement-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── 산출물 종류 화이트리스트 ────────────────────────────────
// 향후 단위업무/화면 추가 시 이 배열에 추가 + 각 종류별 스냅샷 빌더 분기 필요.
const SUPPORTED_DOC_KINDS = ["REQUIREMENT"] as const;
type DocKind = (typeof SUPPORTED_DOC_KINDS)[number];

function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (SUPPORTED_DOC_KINDS as readonly string[]).includes(v);
}

// ─── 입력 검증 상수 ──────────────────────────────────────────
const MAX_VRSN_NO    = 50;
const MAX_CHANGE_CN  = 2000;
const MAX_AUTHOR     = 100;
const MAX_APPROVER   = 100;

// ─── POST: 새 발행 등록 ─────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    docKind, refId, vrsnNo,
    changeCn, authorNm, approverNm,
  } = body as {
    docKind?:    string;
    refId?:      string;
    vrsnNo?:     string;
    changeCn?:   string | null;
    authorNm?:   string | null;
    approverNm?: string | null;
  };

  // ── 입력 검증 ──────────────────────────────────────────────
  if (!isDocKind(docKind)) {
    return apiError("VALIDATION_ERROR", `지원하지 않는 산출물 종류입니다. (허용: ${SUPPORTED_DOC_KINDS.join(", ")})`, 400);
  }
  if (!refId || typeof refId !== "string" || !refId.trim()) {
    return apiError("VALIDATION_ERROR", "산출물 ID(refId) 가 필요합니다.", 400);
  }
  if (!vrsnNo || typeof vrsnNo !== "string" || !vrsnNo.trim()) {
    return apiError("VALIDATION_ERROR", "발행 버전(vrsnNo) 을 입력해 주세요.", 400);
  }
  if (vrsnNo.length > MAX_VRSN_NO) {
    return apiError("VALIDATION_ERROR", `발행 버전은 ${MAX_VRSN_NO}자 이내로 입력해 주세요.`, 400);
  }
  if (changeCn && changeCn.length > MAX_CHANGE_CN) {
    return apiError("VALIDATION_ERROR", `변경 내용은 ${MAX_CHANGE_CN}자 이내로 입력해 주세요.`, 400);
  }
  if (authorNm && authorNm.length > MAX_AUTHOR) {
    return apiError("VALIDATION_ERROR", `작성자명은 ${MAX_AUTHOR}자 이내로 입력해 주세요.`, 400);
  }
  if (approverNm && approverNm.length > MAX_APPROVER) {
    return apiError("VALIDATION_ERROR", `승인자명은 ${MAX_APPROVER}자 이내로 입력해 주세요.`, 400);
  }

  try {
    // ── 양식 입력 객체 조립 (현재 시점 데이터로) ─────────────────
    // doc_kind 별 분기 — 현재는 REQUIREMENT 만, 추후 UNIT_WORK 등 추가 시 switch 확장
    const result = await buildRequirementExportInput(projectId, refId);
    if (!result.ok) {
      return apiError(result.code, result.message, result.httpStatus);
    }
    const input = result.input;

    // ── 사용자 입력으로 일부 덮어쓰기 ────────────────────────────
    // 발행 시 사용자가 모달에서 변경한 값 우선. 비워두면 양식 입력 객체의 fallback 값 유지.
    const finalAuthor   = authorNm?.trim()   || input.authorName;
    const finalApprover = approverNm?.trim() || input.approverName;
    const finalChange   = changeCn?.trim()   || REQUIREMENT_EXPORT_FALLBACK.historyChange;

    input.documentVersion = vrsnNo.trim();
    input.authorName      = finalAuthor;
    input.approverName    = finalApprover;
    // 발행 시점 history 는 의미 없음 (이 발행 자체가 새 history 행이 됨) — 빈 배열로 박제하면
    // 미래에 이 스냅샷을 복원해도 history 표가 깨끗. 단, 표 자체가 비면 양식이 어색하니
    // "이 발행" 한 줄만 기록.
    input.history = [{
      version:  input.documentVersion,
      date:     new Date().toISOString().slice(0, 10),
      change:   finalChange,
      author:   finalAuthor,
      approver: finalApprover,
    }];

    // ── DB 저장 — release 행 생성 + snapshot_data 에 input 통째 박제 ──
    // Prisma 의 Json 타입은 plain object 를 그대로 받음. RequirementExportInput 은
    // 모두 직렬화 가능한 원시 타입이라 안전.
    const release = await prisma.tbDsDocumentRelease.create({
      data: {
        prjct_id:        projectId,
        doc_kind:        docKind,
        ref_id:          refId,
        vrsn_no:         input.documentVersion,
        change_cn:       finalChange,
        author_nm:       finalAuthor,
        approver_nm:     finalApprover,
        release_mber_id: gate.mberId,
        // RequirementExportInput → JsonValue 캐스팅. Prisma 가 직렬화 검증.
        snapshot_data:   input as unknown as object,
      },
      select: {
        release_id: true, vrsn_no: true, released_dt: true,
      },
    });

    return apiSuccess({
      releaseId:   release.release_id,
      vrsnNo:      release.vrsn_no,
      releasedAt:  release.released_dt,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/documents/release] 오류:`, err);
    return apiError("DB_ERROR", "발행에 실패했습니다.", 500);
  }
}

// ─── GET: 발행 이력 목록 ────────────────────────────────────
// /api/projects/[id]/documents/release?docKind=REQUIREMENT&refId=xxx
// 특정 산출물에 묶인 발행 이력 전체 (최신이 위) 반환.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url     = new URL(request.url);
  const docKind = url.searchParams.get("docKind");
  const refId   = url.searchParams.get("refId");

  if (!isDocKind(docKind)) {
    return apiError("VALIDATION_ERROR", `지원하지 않는 산출물 종류입니다.`, 400);
  }
  if (!refId) {
    return apiError("VALIDATION_ERROR", "산출물 ID(refId) 가 필요합니다.", 400);
  }

  try {
    const releases = await prisma.tbDsDocumentRelease.findMany({
      where:   { prjct_id: projectId, doc_kind: docKind, ref_id: refId },
      orderBy: { released_dt: "desc" },
      select: {
        release_id:      true,
        vrsn_no:         true,
        change_cn:       true,
        author_nm:       true,
        approver_nm:     true,
        release_mber_id: true,
        released_dt:     true,
      },
    });

    return apiSuccess({
      releases: releases.map((r) => ({
        releaseId:    r.release_id,
        version:      r.vrsn_no,
        change:       r.change_cn   ?? "",
        author:       r.author_nm   ?? "",
        approver:     r.approver_nm ?? "",
        releasedById: r.release_mber_id ?? null,
        releasedAt:   r.released_dt,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/documents/release] 오류:`, err);
    return apiError("DB_ERROR", "발행 이력 조회에 실패했습니다.", 500);
  }
}

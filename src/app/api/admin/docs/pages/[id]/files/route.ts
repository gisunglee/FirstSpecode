/**
 * GET  /api/admin/docs/pages/[id]/files — 페이지의 첨부 목록 (편집기용)
 * POST /api/admin/docs/pages/[id]/files — 첨부 업로드 (form: file + kind)
 *
 * 권한: SUPER_ADMIN 전용
 *
 * 첨부 구분 (form field "kind"):
 *   - INLINE → Markdown 본문에 삽입할 이미지 전용
 *   - ATTACH → 페이지 하단 별첨 다운로드 파일
 *
 * 저장 경로:
 *   uploads/docs/{pageId}/{uuid}.{ext}
 *
 * 정책:
 *   INLINE — 이미지만 허용, 최대 5MB
 *   ATTACH — 광범위 허용 (실행파일류 차단), 최대 50MB
 *
 * 응답:
 *   POST 성공 시 { fileId, viewUrl, kind, ... } — 클라이언트는 viewUrl 을
 *   markdown 본문의 ![](viewUrl) 로 즉시 사용 가능.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import {
  abortStorageUploads,
  completeStorageUploads,
  prepareStorageUploads,
  type UploadFileInput,
} from "@/lib/storageUpload";
import { removeStorageObjects } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 인라인 이미지 — 이미지만, 5MB 까지
const INLINE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const INLINE_MAX  = 5 * 1024 * 1024;

// 별첨 — 차단할 위험 확장자 (실행 파일류). SVG 도 XSS 위험 있어 제외.
const ATTACH_BLOCKED = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "vbs", "js", "jar",
  "sh", "ps1", "dll", "app", "deb", "rpm", "svg",
]);
const ATTACH_MAX = 50 * 1024 * 1024;

// ── GET: 페이지의 첨부 목록 ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: pageId } = await params;
  if (!UUID_PATTERN.test(pageId)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 페이지 ID입니다.", 400);
  }

  try {
    const rows = await prisma.tbSysAttachFile.findMany({
      where: {
        ref_tbl_nm: "tb_sys_docs_page",
        ref_id:     pageId,
        use_yn:     "Y",
      },
      orderBy: [{ attach_div_code: "asc" }, { sort_ordr: "asc" }, { creat_dt: "asc" }],
    });

    const items = rows.map((r) => ({
      fileId:    r.attach_id,
      kind:      r.attach_div_code,            // INLINE | ATTACH
      fileName:  r.orgnl_file_nm,
      // BigInt 직렬화 — JSON.stringify 가 BigInt 를 못 다루므로 Number 변환
      // (정상 운영 범위 50MB ≈ 5e7 → Number 안전 구간)
      fileSize:  Number(r.file_sz),
      extension: r.file_extsn_nm,
      mimeType:  r.mime_ty,
      viewUrl:   `/api/docs/files/${r.attach_id}/view`,
      uploadedAt:r.creat_dt,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error("[GET /api/admin/docs/pages/[id]/files]", err);
    return apiError("DB_ERROR", "첨부 목록 조회에 실패했습니다.", 500);
  }
}

// ── POST: 첨부 업로드 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: pageId } = await params;
  if (!UUID_PATTERN.test(pageId)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 페이지 ID입니다.", 400);
  }

  // 페이지 존재 확인 — 잘못된 pageId 로 임의 업로드 막기
  const exists = await prisma.tbSysDocsPage.findUnique({
    where:  { page_id: pageId },
    select: { page_id: true },
  });
  if (!exists) return apiError("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

  let body: { action?: unknown; kind?: unknown; files?: unknown; completionTokens?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "업로드 요청 형식이 올바르지 않습니다.", 400);
  }

  const kind = body.kind === "INLINE" ? "INLINE" : "ATTACH";

  try {
    if (body.action === "prepare") {
      const uploads = await prepareStorageUploads({
        memberId: gate.mberId,
        refTable: "tb_sys_docs_page",
        refId: pageId,
        relativeDir: `docs/${pageId}`,
        files: body.files as UploadFileInput[],
        maxFileCount: 1,
        maxFileSize: kind === "INLINE" ? INLINE_MAX : ATTACH_MAX,
        allowedExtensions: kind === "INLINE" ? INLINE_EXTS : undefined,
        blockedExtensions: kind === "ATTACH" ? ATTACH_BLOCKED : undefined,
        metadata: { kind },
      });
      return apiSuccess({ uploads });
    }

    if (body.action === "abort") {
      await abortStorageUploads(body.completionTokens as string[], gate.mberId);
      return apiSuccess({ aborted: true });
    }

    if (body.action !== "complete") {
      return apiError("VALIDATION_ERROR", "지원하지 않는 업로드 작업입니다.", 400);
    }

    const completed = await completeStorageUploads({
      completionTokens: body.completionTokens as string[],
      memberId: gate.mberId,
      refTable: "tb_sys_docs_page",
      refId: pageId,
    });
    const upload = completed[0];
    if (!upload || upload.metadata.kind !== kind) {
      return apiError("VALIDATION_ERROR", "첨부파일 구분이 일치하지 않습니다.", 400);
    }

    try {
      const record = await prisma.tbSysAttachFile.create({
        data: {
          ref_tbl_nm: "tb_sys_docs_page",
          ref_id: pageId,
          attach_div_code: kind,
          orgnl_file_nm: upload.originalName,
          stor_file_nm: upload.storedName,
          file_path_nm: upload.storagePath,
          file_sz: BigInt(upload.size),
          file_extsn_nm: upload.extension,
          mime_ty: upload.mimeType,
          creat_mber_id: gate.mberId,
        },
      });
      return apiSuccess({
        fileId: record.attach_id,
        kind,
        fileName: record.orgnl_file_nm,
        fileSize: Number(record.file_sz),
        extension: record.file_extsn_nm,
        mimeType: record.mime_ty,
        viewUrl: `/api/docs/files/${record.attach_id}/view`,
      }, 201);
    } catch (error) {
      await removeStorageObjects([upload.storagePath]).catch(() => undefined);
      throw error;
    }
  } catch (err) {
    console.error("[POST /api/admin/docs/pages/[id]/files]", err);
    return apiError(
      "FILE_UPLOAD_ERROR",
      err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다.",
      400,
    );
  }
}

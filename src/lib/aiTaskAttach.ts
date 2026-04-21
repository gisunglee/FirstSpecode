/**
 * aiTaskAttach — AI 태스크 요청 공통 유틸
 *
 * 역할:
 *   - AI 요청 API( /api/projects/[id]/{functions|areas|unit-works}/[refId]/ai ,
 *     /api/projects/[id]/impl-request/submit )의 요청 본문을
 *     multipart/form-data 와 application/json 둘 다 수용하도록 파싱
 *   - AI 태스크(tb_ai_task)에 첨부 이미지를 저장 (디스크 + tb_cm_attach_file)
 *
 * 하위 호환:
 *   - MCP 도구나 외부 JSON 호출자는 기존대로 application/json으로 호출 → files = []
 *   - 브라우저 FE는 multipart/form-data로 파일 동봉 → 서버에서 Content-Type으로 자동 분기
 *
 * 주요 기술:
 *   - Next.js Web Request.formData() 내장 파싱
 *   - Buffer/Blob 변환: File.arrayBuffer()
 */

import path from "path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { saveFile, deleteFile } from "@/lib/fileStorage";

// ── 제약 ────────────────────────────────────────────────────────────────────

// 이미지로 분류할 확장자 집합 — 이외는 "FILE" 타입으로 저장
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

// 개별 파일 최대 크기 (10MB)
// Claude 멀티모달 처리 비용과 저장소 부하를 고려한 보수적 상한
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 태스크당 최대 파일 개수 (10장)
const MAX_FILE_COUNT = 10;

// ── AI 요청 본문 파싱 ───────────────────────────────────────────────────────

/**
 * parseAiRequest — AI 요청 본문을 파싱해 text 필드와 첨부 파일을 분리 반환
 *
 * @returns
 *   raw   : 모든 text 필드를 { [key]: string } 으로 (taskType, coment_cn 등)
 *   files : multipart 요청의 "files" 필드 값(File[]). JSON 요청이면 빈 배열
 *   json  : JSON 요청일 때 원본 객체 — functionIds 같은 복합 타입 필드 필요 시 이것을 사용
 *
 * 호출부 예시:
 *   const { raw, files, json } = await parseAiRequest(request);
 *   const taskType = raw.taskType;
 *   const functionIds = json?.functionIds ?? JSON.parse(raw.functionIds ?? "[]");
 */
export type ParsedAiRequest = {
  raw:   Record<string, string>;
  files: File[];
  json:  Record<string, unknown> | null;
};

export async function parseAiRequest(request: NextRequest): Promise<ParsedAiRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  // multipart/form-data — 브라우저 FE 요청
  if (contentType.includes("multipart/form-data")) {
    const fd = await request.formData();
    const raw: Record<string, string> = {};
    const files: File[] = [];
    for (const [key, value] of fd.entries()) {
      if (value instanceof File) {
        // "files" 키의 값만 첨부로 처리 (다른 키에 오는 파일은 무시)
        if (key === "files") files.push(value);
      } else {
        raw[key] = value;
      }
    }
    return { raw, files, json: null };
  }

  // application/json fallback — MCP, 외부 호출자
  const body = (await request.json()) as Record<string, unknown>;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    // 문자열 필드만 raw에 담는다. 복합 타입(배열/객체)은 json에서 꺼내 쓸 것
    if (typeof value === "string") raw[key] = value;
  }
  return { raw, files: [], json: body };
}

// ── 첨부 파일 저장 ──────────────────────────────────────────────────────────

/**
 * saveAiTaskAttachments — AI 태스크(tb_ai_task)에 첨부 이미지 저장
 *
 * 동작:
 *   1. 제약 검증 (개수/크기) — 실패 시 즉시 throw (디스크 쓰기 전)
 *   2. 각 파일을 uploads/ai-tasks/{projectId}/{taskId}/{UUID}.{ext} 로 저장
 *   3. tb_cm_attach_file 레코드 생성 (ref_tbl_nm="tb_ai_task", req_ref_yn="Y")
 *   4. 중간 실패 시 이미 저장된 파일·레코드를 자동 롤백하고 throw 전파
 *
 * 주의:
 *   - 이 함수 실패 시 호출자는 tb_ai_task 레코드도 함께 삭제해야 한다
 *     (태스크만 남고 첨부가 없는 어색한 상태 방지)
 *   - Prisma 트랜잭션 밖에서 호출 — 디스크 IO가 트랜잭션에 묶이면 롤백 시
 *     파일이 남기 때문에 수동 정리가 더 안전하다
 */
export async function saveAiTaskAttachments(opts: {
  projectId: string;
  taskId:    string;
  files:     File[];
}): Promise<number> {
  const { projectId, taskId, files } = opts;
  if (files.length === 0) return 0;

  // 제약 검증 — 태스크 생성 후이므로 여기서 걸리면 호출자가 태스크 롤백해야 함
  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`첨부 파일은 최대 ${MAX_FILE_COUNT}장까지 업로드할 수 있습니다.`);
  }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`파일 "${file.name}" 크기가 ${MAX_FILE_SIZE / 1024 / 1024}MB를 초과합니다.`);
    }
  }

  // 부분 저장 추적 — 중간 실패 시 롤백 대상
  const savedPaths:     string[] = [];
  const createdFileIds: string[] = [];

  try {
    for (const file of files) {
      const originalName = file.name;
      const ext          = path.extname(originalName).replace(".", "").toLowerCase();
      const storeName    = `${crypto.randomUUID()}.${ext || "bin"}`;
      // 저장 경로: ai-tasks/{projectId}/{taskId}/{storeName}
      // 기존 areas/functions/requirements 첨부와 동일한 디렉터리 규약
      const subPath      = `ai-tasks/${projectId}/${taskId}/${storeName}`;

      const arrayBuffer  = await file.arrayBuffer();
      const buffer       = Buffer.from(arrayBuffer);
      const fileType     = IMAGE_EXTS.includes(ext) ? "IMAGE" : "FILE";

      // 디스크 저장 — 실패 시 savedPaths에 쌓인 것들 전부 롤백
      saveFile(subPath, buffer);
      savedPaths.push(subPath);

      // DB 레코드 생성
      const record = await prisma.tbCmAttachFile.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ai_task",
          ref_id:        taskId,
          file_ty_code:  fileType,
          orgnl_file_nm: originalName,
          stor_file_nm:  storeName,
          file_path_nm:  subPath,
          file_sz:       buffer.length,
          file_extsn_nm: ext || "bin",
          // AI 태스크 첨부는 기본적으로 AI 참조 대상 (워커가 이미지를 Claude에 전달)
          req_ref_yn:    "Y",
        },
      });
      createdFileIds.push(record.attach_file_id);
    }
    return files.length;
  } catch (err) {
    // 롤백 — best-effort. 이미 실패 경로이므로 추가 에러는 로그만 남기고 무시
    for (const p of savedPaths) {
      try { deleteFile(p); } catch { /* 디스크 정리 실패는 치명적이지 않음 */ }
    }
    if (createdFileIds.length > 0) {
      await prisma.tbCmAttachFile.deleteMany({
        where: { attach_file_id: { in: createdFileIds } },
      }).catch(() => { /* 정리 실패는 로그만 — 원 에러를 사용자에게 전달하는 것이 우선 */ });
    }
    throw err;
  }
}

// ── 첨부 파일 일괄 삭제 ─────────────────────────────────────────────────────

/**
 * deleteAiTaskAttachments — 특정 AI 태스크에 연결된 모든 첨부 삭제 (디스크 + DB)
 *
 * 용도:
 *   - 태스크 생성 후 첨부 저장이 부분 실패했을 때의 롤백
 *   - 태스크 자체가 삭제될 때의 정리 (별도 이슈에서 tb_ai_task DELETE 경로에 추가)
 */
export async function deleteAiTaskAttachments(taskId: string): Promise<void> {
  const files = await prisma.tbCmAttachFile.findMany({
    where:  { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
    select: { attach_file_id: true, file_path_nm: true },
  });
  for (const f of files) {
    try { deleteFile(f.file_path_nm); } catch { /* 디스크 정리 실패는 로그만 */ }
  }
  if (files.length > 0) {
    await prisma.tbCmAttachFile.deleteMany({
      where: { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
    });
  }
}

/**
 * POST /api/projects/[id]/areas/[areaId]/ai — 영역 AI 태스크 요청
 *
 * Body (둘 중 하나):
 *   - application/json  : { taskType: "INSPECT", coment_cn? }             ← MCP·외부
 *   - multipart/form-data: 동일 필드 + files[]                             ← 브라우저 FE
 *
 * INSPECT 프롬프트 조립:
 *   <시스템프롬프트>
 *   <전체설계>  단위업무 + 화면 + 같은 화면의 다른 영역들 (기능 상세 제외)
 *   <코멘트>    (있을 때만)
 *   <점검내용>  현재 영역 정보 + 현재 영역의 기능 전체
 *
 * 첨부 이미지는 태스크 생성 후 tb_cm_attach_file에 저장 (aiTaskAttach.ts)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { expandTableScripts } from "@/lib/dbTableScript";
import { parseAiRequest, saveAiTaskAttachments } from "@/lib/aiTaskAttach";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // multipart 또는 JSON 둘 다 수용
  let raw: Record<string, string>;
  let files: File[];
  try {
    const parsed = await parseAiRequest(request);
    raw   = parsed.raw;
    files = parsed.files;
  } catch {
    return apiError("VALIDATION_ERROR", "요청 본문을 파싱할 수 없습니다.", 400);
  }

  const { taskType, comment, coment_cn } = raw;

  if (!taskType || taskType !== "INSPECT") {
    return apiError("VALIDATION_ERROR", "taskType은 INSPECT 이어야 합니다.", 400);
  }

  try {
    // 영역 조회 + 하위 기능을 한 번에 가져옴 (이중 쿼리 방지)
    const area = await prisma.tbDsArea.findUnique({
      where:   { area_id: areaId },
      include: { functions: { orderBy: { sort_ordr: "asc" } } },
    });
    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    const commentPart = (coment_cn || comment)?.trim() ?? "";

    if (!area.area_dc?.trim()) {
      return apiError("VALIDATION_ERROR", "설명(description)을 먼저 작성해 주세요.", 400);
    }

    // ── 프롬프트 템플릿 + 화면 컨텍스트 병렬 조회 ──────────────────────────
    // screen과 otherAreas는 area.scrn_id만 알면 되므로 promptTmpl과 함께 병렬 실행
    const [promptTmpl, screen, otherAreas] = await Promise.all([
      prisma.tbAiPromptTemplate.findFirst({
        where: {
          AND: [
            // 프로젝트 전용 또는 시스템 공통
            { OR: [{ prjct_id: projectId }, { prjct_id: null }] },
            // AREA 전용 템플릿 우선, 없으면 ref_ty_code가 null인 공용 템플릿
            // ref_ty_code 미지정 시 UNIT_WORK 등 다른 용도 템플릿이 걸리는 문제 방지
            { OR: [{ ref_ty_code: "AREA" }, { ref_ty_code: null }] },
          ],
          task_ty_code: taskType,
          use_yn:       "Y",
        },
        orderBy: [
          { default_yn: "desc" },
          // AREA 전용(non-null)을 공용(null)보다 우선
          { ref_ty_code: { sort: "desc", nulls: "last" } },
          { prjct_id:    { sort: "desc", nulls: "last" } },
          { creat_dt:    "desc" },
        ],
      }),
      area.scrn_id
        ? prisma.tbDsScreen.findUnique({ where: { scrn_id: area.scrn_id } })
        : Promise.resolve(null),
      area.scrn_id
        ? prisma.tbDsArea.findMany({
            where:   { scrn_id: area.scrn_id, area_id: { not: areaId } },
            orderBy: { sort_ordr: "asc" },
          })
        : Promise.resolve([]),
    ]);

    const sysPrompt = promptTmpl?.sys_prompt_cn?.trim() ?? "";

    // screen이 있어야 단위업무를 조회할 수 있으므로 순차 실행
    const unitWork = screen?.unit_work_id
      ? await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: screen.unit_work_id } })
      : null;

    // ── 점검내용: 현재 영역 정보 + 영역 내 기능 전체 ────────────────────────
    const functions = area.functions;
    const 점검내용Lines: string[] = [];
    점검내용Lines.push("[영역]");
    점검내용Lines.push(`ID: ${area.area_display_id}`);
    점검내용Lines.push(`명칭: ${area.area_nm}`);
    if (area.area_dc?.trim()) {
      점검내용Lines.push("설명:");
      점검내용Lines.push(area.area_dc.trim());
    }
    점검내용Lines.push("");

    if (functions.length > 0) {
      점검내용Lines.push(`[기능 목록 (총 ${functions.length}개)]`);
      for (const f of functions) {
        점검내용Lines.push("---");
        점검내용Lines.push(`기능 ID: ${f.func_display_id}`);
        점검내용Lines.push(`기능명: ${f.func_nm}`);
        if (f.func_dc?.trim()) {
          점검내용Lines.push("설명:");
          점검내용Lines.push(f.func_dc.trim());
        }
      }
      점검내용Lines.push("---");
    }

    // ── 전체설계: 단위업무 + 화면 + 같은 화면의 다른 영역들 (기능 상세 제외) ─

    const 전체설계Lines: string[] = [];
    if (unitWork) {
      전체설계Lines.push("[단위업무]");
      전체설계Lines.push(`ID: ${unitWork.unit_work_display_id}`);
      전체설계Lines.push(`명칭: ${unitWork.unit_work_nm}`);
      if (unitWork.unit_work_dc?.trim()) 전체설계Lines.push(`설명: ${unitWork.unit_work_dc.trim()}`);
      전체설계Lines.push("");
    }
    if (screen) {
      전체설계Lines.push("[화면]");
      전체설계Lines.push(`ID: ${screen.scrn_display_id}`);
      전체설계Lines.push(`명칭: ${screen.scrn_nm}`);
      if (screen.scrn_dc?.trim()) 전체설계Lines.push(`설명: ${screen.scrn_dc.trim()}`);
      전체설계Lines.push("");
    }
    if (otherAreas.length > 0) {
      전체설계Lines.push(`[같은 화면의 다른 영역 (총 ${otherAreas.length}개, 기능 상세 제외)]`);
      for (const oa of otherAreas) {
        전체설계Lines.push("---");
        전체설계Lines.push(`영역 ID: ${oa.area_display_id}`);
        전체설계Lines.push(`영역명: ${oa.area_nm}`);
        if (oa.area_dc?.trim()) {
          전체설계Lines.push("설명:");
          전체설계Lines.push(oa.area_dc.trim());
        }
      }
      전체설계Lines.push("---");
    }

    // ── 프롬프트 조립 ────────────────────────────────────────────────────────
    // 순서: 시스템프롬프트 → 전체설계 → 코멘트 → 점검내용
    const parts: string[] = [];

    if (sysPrompt) {
      parts.push(`<시스템프롬프트>\n${sysPrompt}\n</시스템프롬프트>`);
    }
    if (전체설계Lines.length > 0) {
      parts.push(`<전체설계>\n${전체설계Lines.join("\n")}\n</전체설계>`);
    }
    if (commentPart) {
      parts.push(`<코멘트>\n${commentPart}\n</코멘트>`);
    }
    if (점검내용Lines.length > 0) {
      parts.push(`<점검내용>\n${점검내용Lines.join("\n")}\n</점검내용>`);
    }

    // <TABLE_SCRIPT:tb_xxx> 플레이스홀더 치환 (brief 모드 — 컬럼명 목록)
    // 점검 대상 설명이나 설계 컨텍스트에 테이블 참조가 포함된 경우 AI가 구조를 파악할 수 있도록 치환
    // 미등록 테이블은 원본 플레이스홀더 그대로 유지
    const finalReqCn = await expandTableScripts(projectId, parts.join("\n\n"), "brief");

    // ── 사용 횟수 증가 ───────────────────────────────────────────────────────
    if (promptTmpl) {
      await prisma.tbAiPromptTemplate.update({
        where: { tmpl_id: promptTmpl.tmpl_id },
        data:  { use_cnt: { increment: 1 } },
      });
    }

    // ── AI 태스크 생성 ───────────────────────────────────────────────────────
    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:          projectId,
        ref_ty_code:       "AREA",
        ref_id:            areaId,
        task_ty_code:      taskType,
        coment_cn:         commentPart || null,
        req_cn:            finalReqCn,
        req_snapshot_data: {
          areaId:          areaId,
          areaName:        area.area_nm,
          areaType:        area.area_ty_code,
          functionCount:   functions.length,
          otherAreaCount:  otherAreas.length,
          promptTmplId:    promptTmpl?.tmpl_id  ?? null,
          promptTmplNm:    promptTmpl?.tmpl_nm  ?? null,
        },
        req_mber_id:       auth.mberId,
        task_sttus_code:   "PENDING",
        retry_cnt:         0,
      },
    });

    // ── 첨부 이미지 저장 (multipart 요청에만 존재) ───────────────────────────
    let attachmentCount = 0;
    if (files.length > 0) {
      try {
        attachmentCount = await saveAiTaskAttachments({
          projectId,
          taskId: task.ai_task_id,
          files,
        });
      } catch (attachErr) {
        await prisma.tbAiTask.delete({ where: { ai_task_id: task.ai_task_id } })
          .catch((e) => console.error("[AI Task] 롤백 실패:", e));
        const msg = attachErr instanceof Error ? attachErr.message : "첨부 저장 실패";
        return apiError("UPLOAD_ERROR", msg, 500);
      }
    }

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING", taskType, attachmentCount }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas/${areaId}/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}

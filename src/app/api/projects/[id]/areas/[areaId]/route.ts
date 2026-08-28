/**
 * GET    /api/projects/[id]/areas/[areaId] — 영역 상세 조회 (FID-00153)
 * PUT    /api/projects/[id]/areas/[areaId] — 영역 수정 + 이력 (FID-00154)
 * DELETE /api/projects/[id]/areas/[areaId] — 영역 삭제 + 이력 (FID-00166)
 *
 * DELETE Query: deleteChildren=true|false (기본 true)
 *   - true:  하위 기능 전체 삭제
 *   - false: 영역만 삭제 (기능의 area_id NULL 처리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
  getSpecContentCapabilities,
  creatorWindowConflict,
} from "@/lib/specContentWritePolicy";
import { isCreatorWindowConflict, lockAndAssertCreatorWindow } from "@/lib/specContentWriteConcurrency";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { areaUpdateSchema } from "@/lib/specContentSchemas";
import { applyTemplateVars } from "@/lib/templateVars";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

// ─── GET: 영역 상세 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const [area, aiTaskRows, implSnapshotRows] = await Promise.all([
      prisma.tbDsArea.findUnique({
        where:   { area_id: areaId },
        include: {
          screen: {
            select: {
              scrn_id: true, scrn_nm: true, scrn_display_id: true, unit_work_id: true,
              // 영역 자체에는 담당자가 없어 부모 화면의 담당자를 영역 담당자로 간주.
              // 프론트에서 [삭제]/[저장] 버튼 노출 판정에 사용.
              asign_mber_id: true,
              unitWork: { select: { unit_work_display_id: true, unit_work_nm: true } },
            },
          },
          // 하단 기능 목록 (AR-00074, FID-00163) — sort_ordr 오름차순
          functions: {
            orderBy: { sort_ordr: "asc" },
            select: {
              func_id:         true,
              func_display_id: true,
              func_nm:         true,
              priort_code:     true,
              sort_ordr:       true,
            },
          },
        },
      }),
      // 영역용 AI 태스크 최신 상태 조회 (타입별 최신 1건)
      prisma.tbAiTask.findMany({
        where: {
          prjct_id:    projectId,
          ref_ty_code: "AREA",
          ref_id:      areaId,
        },
        orderBy: { req_dt: "desc" },
        select: { ai_task_id: true, task_ty_code: true, task_sttus_code: true },
      }),
      // IMPLEMENT — 스냅샷 경유: 이 영역이 포함된 구현요청 태스크 조회
      prisma.tbSpImplSnapshot.findMany({
        where: { ref_tbl_nm: "tb_ds_area", ref_id: areaId },
        select: { ai_task_id: true },
        orderBy: { creat_dt: "desc" },
        distinct: ["ai_task_id"],
      }),
    ]);

    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }
    const permissions = await getSpecContentCapabilities(request, projectId, "AREA", areaId, gate);

    // 타입별 최신 1건만 추출
    const aiTasks: Record<string, { aiTaskId: string; status: string }> = {};
    for (const t of aiTaskRows) {
      if (!aiTasks[t.task_ty_code]) {
        aiTasks[t.task_ty_code] = { aiTaskId: t.ai_task_id, status: t.task_sttus_code };
      }
    }

    // IMPLEMENT — 스냅샷에서 찾은 ai_task_id로 최신 태스크 1건 조회
    if (!aiTasks["IMPLEMENT"] && implSnapshotRows.length > 0) {
      const implTask = await prisma.tbAiTask.findFirst({
        where: {
          ai_task_id:   { in: implSnapshotRows.map((s) => s.ai_task_id) },
          task_ty_code: "IMPLEMENT",
        },
        orderBy: { req_dt: "desc" },
      });
      if (implTask) {
        aiTasks["IMPLEMENT"] = { aiTaskId: implTask.ai_task_id, status: implTask.task_sttus_code };
      }
    }

    // 기능 수 (AR-00073 요약)
    const total = area.functions.length;

    // 기능별 진척률 조회 — tb_cm_progress에서 한번에 가져오기
    const funcIds = area.functions.map(f => f.func_id);
    let progressMap = new Map<string, { designRt: number; implRt: number }>();
    if (funcIds.length > 0) {
      const progressRows = await prisma.tbCmProgress.findMany({
        where: { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
        select: { ref_id: true, design_rt: true, impl_rt: true },
      });
      progressMap = new Map(progressRows.map(r => [r.ref_id, {
        designRt: r.design_rt,
        implRt:   r.impl_rt,
      }]));
    }

    return apiSuccess({
      permissions,
      areaId:      area.area_id,
      displayId:   area.area_display_id,
      name:        area.area_nm,
      description: area.area_dc ?? "",
      type:        area.area_ty_code,
      displayFormCode: area.display_form_code,
      sortOrder:   area.sort_ordr,
      layoutData:  area.layer_data_dc ?? null,
      commentCn:   area.coment_cn ?? "",
      docStatus:   area.dsgn_doc_sttus_code,
      screenId:    area.scrn_id ?? null,
      // 부모 화면의 담당자 — 프론트 권한 판정에 사용 (영역 자체 담당자 컬럼이 없으므로)
      screenAssigneeId:  area.screen?.asign_mber_id ?? null,
      screenName:        area.screen?.scrn_nm ?? "미분류",
      screenDisplayId:   area.screen?.scrn_display_id ?? null,
      unitWorkId:        area.screen?.unit_work_id ?? null,
      unitWorkDisplayId: area.screen?.unitWork?.unit_work_display_id ?? null,
      unitWorkName:      area.screen?.unitWork?.unit_work_nm ?? "미분류",
      excalidrawData:  area.excaldw_data ?? null,
      aiTasks,
      // 요약 정보 (AR-00073)
      summary: {
        functionCount: total,
      },
      // 하단 기능 목록 (AR-00074)
      functions: area.functions.map((f) => {
        const prog = progressMap.get(f.func_id);
        return {
          funcId:    f.func_id,
          displayId: f.func_display_id,
          name:      f.func_nm,
          priority:  f.priort_code,
          sortOrder: f.sort_ordr,
          designRt:  prog?.designRt ?? 0,
          implRt:    prog?.implRt ?? 0,
        };
      }),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 영역 수정 + 이력 ────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 부모 화면 담당자만 수정 가능
  const gate = await requireSpecContentWrite(request, projectId, "AREA", areaId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, areaUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const { screenId, name, type, displayFormCode, description, sortOrder, layoutData, commentCn, saveHistory, displayId, docStatus } = parsed.data;

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",        name],
    ["displayId",   displayId],
    ["description", description],
    ["comment",     commentCn],
  ]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }
    const changedFields = [
      ...(screenId !== undefined && (screenId || null) !== existing.scrn_id ? ["screenId"] : []),
      ...(name.trim() !== existing.area_nm ? ["name"] : []),
      ...(type !== undefined && type !== existing.area_ty_code ? ["type"] : []),
      ...(displayFormCode !== undefined && displayFormCode !== existing.display_form_code ? ["displayFormCode"] : []),
      ...(description !== undefined && (description.trim() || null) !== existing.area_dc ? ["description"] : []),
      ...(sortOrder !== undefined && sortOrder !== existing.sort_ordr ? ["sortOrder"] : []),
      ...(layoutData !== undefined && (layoutData || null) !== existing.layer_data_dc ? ["layoutData"] : []),
      ...(commentCn !== undefined && (commentCn || null) !== existing.coment_cn ? ["commentCn"] : []),
      ...(displayId !== undefined && displayId.trim() !== existing.area_display_id ? ["displayId"] : []),
      ...(docStatus !== undefined && docStatus !== existing.dsgn_doc_sttus_code ? ["docStatus"] : []),
    ];
    const fieldError = requireSpecChangedFields(gate, "AREA", changedFields);
    if (fieldError) return fieldError;

    if (screenId !== undefined && screenId !== existing.scrn_id && screenId) {
      const targetScreen = await prisma.tbDsScreen.findFirst({
        where: { scrn_id: screenId, prjct_id: projectId },
        select: { scrn_id: true },
      });
      if (!targetScreen) return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    // 템플릿 플레이스홀더({{displayId}}/{{name}}) 안전망 — MCP 등 "템플릿 삽입" 버튼을
    // 거치지 않는 경로로 저장될 때도 실제 값으로 치환되도록 저장 직전에 한 번 더 통과시킴.
    const finalDisplayId = displayId?.trim() || existing.area_display_id;
    const trimmedDescription = description?.trim() || null;
    const newDescription = trimmedDescription
      ? applyTemplateVars(trimmedDescription, { displayId: finalDisplayId, name: name.trim() })
      : trimmedDescription;

    // 수정 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction(async (tx) => {
      await lockAndAssertCreatorWindow(tx, "AREA", areaId, gate);
      await tx.tbDsArea.update({
        where: { area_id: areaId },
        data: {
          scrn_id:      screenId !== undefined ? (screenId || null) : existing.scrn_id,
          area_display_id: finalDisplayId,
          area_nm:      name.trim(),
          // 유형 — 미전송 시 기존값 유지 (부분 수정 안전, displayFormCode와 동일 패턴)
          area_ty_code: type || existing.area_ty_code,
          // 표시 형태 — 클라이언트가 안 보내면 기존값 유지 (부분 수정 안전)
          display_form_code: displayFormCode ?? existing.display_form_code,
          // description 미전송 시 기존값 유지 — 예전엔 무조건 덮어써서 부분 수정(PUT) 호출이
          // description을 안 보내면 null로 지워지던 버그였음 (다른 필드들과 다르게 이 필드만
          // undefined 체크가 빠져 있었음)
          area_dc:      description !== undefined ? newDescription : existing.area_dc,
          sort_ordr:    sortOrder ?? existing.sort_ordr,
          layer_data_dc: layoutData !== undefined ? layoutData : existing.layer_data_dc,
          coment_cn:     commentCn  !== undefined ? (commentCn || null) : existing.coment_cn,
          dsgn_doc_sttus_code: docStatus || existing.dsgn_doc_sttus_code,
          mdfcn_dt:     new Date(),
          mdfcn_mber_id: gate.mberId,
        },
      });
      await tx.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_area",
          ref_id:        areaId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    "영역 수정",
          snapshot_data: {
            areaId:    areaId,
            displayId: finalDisplayId,
            name:      name.trim(),
            type:      type || "LIST",
          },
          chg_mber_id: gate.mberId,
        },
      });
      if (saveHistory) {
        // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
        await tx.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "영역 설명",
            snapshot_data: {
              before: existing.area_dc ?? null,
              after:  newDescription,
            },
            chg_mber_id: gate.mberId,
          },
        });
      }
    });

    return apiSuccess({ areaId });
  } catch (err) {
    if (isCreatorWindowConflict(err)) return creatorWindowConflict();
    console.error(`[PUT /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 영역 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;
  const url            = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 부모 화면 담당자만 삭제 가능
  const gate = await requireSpecContentWrite(request, projectId, "AREA", areaId, "DELETE");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    if (deleteChildren) {
      // 하위 기능 전체 삭제 후 영역 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsFunction.deleteMany({ where: { area_id: areaId } }),
        prisma.tbDsArea.delete({ where: { area_id: areaId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_type_code: "DELETE",
            chg_rsn_cn:    "영역 삭제",
            snapshot_data: {
              areaId:    areaId,
              displayId: existing.area_display_id,
              name:      existing.area_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: gate.mberId,
          },
        }),
      ]);
    } else {
      // 기능의 area_id NULL 처리 (미분류) 후 영역만 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsFunction.updateMany({
          where: { area_id: areaId },
          data:  { area_id: null },
        }),
        prisma.tbDsArea.delete({ where: { area_id: areaId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_type_code: "DELETE",
            chg_rsn_cn:    "영역 삭제 (기능 미분류 유지)",
            snapshot_data: {
              areaId:    areaId,
              displayId: existing.area_display_id,
              name:      existing.area_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: gate.mberId,
          },
        }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}

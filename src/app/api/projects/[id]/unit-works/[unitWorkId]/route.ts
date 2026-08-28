/**
 * GET    /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 상세 조회 (FID-00130 조회)
 * PUT    /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 수정 (FID-00130 수정)
 * DELETE /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 삭제 (FID-00131)
 *
 * DELETE Query: deleteChildren=true|false (기본 true)
 *   - true:  하위 화면 전체 삭제
 *   - false: 단위업무만 삭제 (화면은 unit_work_id = null 처리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { fetchOneUnitWorkProgress, combinePhaseProgress } from "@/lib/pm/progressRollup";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
  getSpecContentCapabilities,
  creatorWindowConflict,
} from "@/lib/specContentWritePolicy";
import { isCreatorWindowConflict, lockAndAssertCreatorWindow } from "@/lib/specContentWriteConcurrency";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { unitWorkUpdateSchema } from "@/lib/specContentSchemas";
import { applyTemplateVars } from "@/lib/templateVars";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

// ─── GET: 단위업무 상세 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, unitWorkId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const uw = await prisma.tbDsUnitWork.findUnique({
      where:   { unit_work_id: unitWorkId },
      include: {
        requirement: { select: { req_id: true, req_display_id: true, req_nm: true } },
        screens: {
          orderBy: { sort_ordr: "asc" },
          select: {
            scrn_id:         true,
            scrn_display_id: true,
            scrn_nm:         true,
            scrn_ty_code:    true,
            url_path:        true,
          },
        },
      },
    });

    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }
    const permissions = await getSpecContentCapabilities(request, projectId, "UNIT_WORK", unitWorkId, gate);

    // AI 태스크 최신 상태 + IMPLEMENT 스냅샷 + 담당자 이름 + 실적 진행률(롤업) 병렬 조회
    const [aiTasks, implSnapshotRows, assignee, phaseProgress] = await Promise.all([
      prisma.tbAiTask.findMany({
        where:   { ref_ty_code: "UNIT_WORK", ref_id: unitWorkId },
        orderBy: { req_dt: "desc" },
      }),
      prisma.tbSpImplSnapshot.findMany({
        where: { ref_tbl_nm: "tb_ds_unit_work", ref_id: unitWorkId },
        select: { ai_task_id: true },
        orderBy: { creat_dt: "desc" },
        distinct: ["ai_task_id"],
      }),
      // 담당자 이름 조회 — asign_mber_id가 있을 때만
      uw.asign_mber_id
        ? prisma.tbCmMember.findUnique({
            where:  { mber_id: uw.asign_mber_id },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
            select: { mber_nm: true, email_addr: true },
          })
        : Promise.resolve(null),
      // 실적 진행률 — 사람이 직접 입력하지 않고 하위 화면·기능에서 항상 재계산(단일 소스)
      fetchOneUnitWorkProgress(unitWorkId),
    ]);
    // taskType별 최신 1건만 유지
    const aiTaskMap: Record<string, { aiTaskId: string; status: string }> = {};
    for (const t of aiTasks) {
      if (!aiTaskMap[t.task_ty_code]) {
        aiTaskMap[t.task_ty_code] = { aiTaskId: t.ai_task_id, status: t.task_sttus_code };
      }
    }
    // IMPLEMENT — 스냅샷에서 찾은 ai_task_id로 최신 태스크 1건 조회
    // (이 단위업무 하위 어느 계층이든 포함된 구현요청 태스크가 여기서 잡힘)
    if (!aiTaskMap["IMPLEMENT"] && implSnapshotRows.length > 0) {
      const implTask = await prisma.tbAiTask.findFirst({
        where: {
          ai_task_id:   { in: implSnapshotRows.map((s) => s.ai_task_id) },
          task_ty_code: "IMPLEMENT",
        },
        orderBy: { req_dt: "desc" },
      });
      if (implTask) {
        aiTaskMap["IMPLEMENT"] = { aiTaskId: implTask.ai_task_id, status: implTask.task_sttus_code };
      }
    }

    return apiSuccess({
      permissions,
      unitWorkId:       uw.unit_work_id,
      displayId:        uw.unit_work_display_id,
      name:             uw.unit_work_nm,
      description:      uw.unit_work_dc ?? "",
      comment:          (uw as unknown as Record<string, unknown>).coment_cn as string ?? "",
      assignMemberId:   uw.asign_mber_id ?? null,
      // 담당자 이름 — mber_nm 우선, 없으면 email, 없으면 null (퇴장 멤버 포함)
      assignMemberName: assignee ? (assignee.mber_nm || assignee.email_addr || null) : null,
      // 계획설계 일정/공수 — PM이 잡는 상위 마일스톤(목표치)
      planStartDate:  uw.plan_dsgn_bgng_de ?? null,
      planEndDate:    uw.plan_dsgn_end_de ?? null,
      planEffort:     uw.plan_dsgn_efrt_val ?? null,
      docStatus:      uw.dsgn_doc_sttus_code,
      // 실적 진행률 — 화면(설계)·기능(구현) 롤업 자동계산, 수정 불가(읽기전용)
      designProgress: phaseProgress.designRt,
      implProgress:   phaseProgress.implRt,
      progress:       combinePhaseProgress(phaseProgress),
      sortOrder:      uw.sort_ordr,
      reqId:          uw.req_id,
      reqDisplayId:   uw.requirement.req_display_id,
      reqName:        uw.requirement.req_nm,
      aiTasks:        aiTaskMap,
      screens: uw.screens.map((s) => ({
        screenId:    s.scrn_id,
        displayId:   s.scrn_display_id,
        name:        s.scrn_nm,
        type:        s.scrn_ty_code,
        urlPath:     s.url_path ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "단위업무 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 단위업무 수정 ──────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, unitWorkId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자만 수정 가능
  const gate = await requireSpecContentWrite(request, projectId, "UNIT_WORK", unitWorkId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, unitWorkUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const { name, displayId, description, comment, assignMemberId, planStartDate, planEndDate, planEffort, docStatus, sortOrder, saveHistory } = parsed.data;

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",        name],
    ["displayId",   displayId],
    ["description", description],
    ["comment",     comment],
  ]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }
    const changedFields = [
      ...(name.trim() !== existing.unit_work_nm ? ["name"] : []),
      ...(displayId !== undefined && displayId.trim() !== existing.unit_work_display_id ? ["displayId"] : []),
      ...(description !== undefined && (description.trim() || null) !== existing.unit_work_dc ? ["description"] : []),
      ...(comment !== undefined && (comment.trim() || null) !== existing.coment_cn ? ["comment"] : []),
      ...(assignMemberId !== undefined && (assignMemberId || null) !== existing.asign_mber_id ? ["assignMemberId"] : []),
      ...(planStartDate !== undefined && (planStartDate.trim() || null) !== existing.plan_dsgn_bgng_de ? ["planStartDate"] : []),
      ...(planEndDate !== undefined && (planEndDate.trim() || null) !== existing.plan_dsgn_end_de ? ["planEndDate"] : []),
      ...(planEffort !== undefined && (planEffort.trim() || null) !== existing.plan_dsgn_efrt_val ? ["planEffort"] : []),
      ...(docStatus !== undefined && docStatus !== existing.dsgn_doc_sttus_code ? ["docStatus"] : []),
      ...(sortOrder !== undefined && sortOrder !== existing.sort_ordr ? ["sortOrder"] : []),
    ];
    const fieldError = requireSpecChangedFields(gate, "UNIT_WORK", changedFields);
    if (fieldError) return fieldError;

    // 템플릿 플레이스홀더({{displayId}}/{{name}}) 안전망 — MCP 등 "템플릿 삽입" 버튼을
    // 거치지 않는 경로로 저장될 때도 실제 값으로 치환되도록 저장 직전에 한 번 더 통과시킴.
    const finalDisplayId = displayId?.trim() || existing.unit_work_display_id;
    const trimmedDescription = description?.trim() || null;
    const newDescription = trimmedDescription
      ? applyTemplateVars(trimmedDescription, { displayId: finalDisplayId, name: name.trim() })
      : trimmedDescription;

    // 담당자 변경 감지 — 값이 실제로 바뀌었을 때만 이력 저장 (no-op 스킵)
    // SettingsHistoryDialog의 itemName과 정확히 일치해야 필터됨
    const CHG_REASON_ASSIGNEE = "담당자";
    const prevAssignee     = existing.asign_mber_id ?? null;
    const nextAssignee     = assignMemberId !== undefined ? (assignMemberId || null) : prevAssignee;
    const assigneeChanged  = assignMemberId !== undefined && prevAssignee !== nextAssignee;

    // 공통 update data — 미전송 필드는 기존 값 유지
    const updateData = {
      unit_work_display_id: finalDisplayId,
      unit_work_nm:  name.trim(),
      unit_work_dc:  description !== undefined ? newDescription : existing.unit_work_dc,
      coment_cn:     comment !== undefined ? (comment?.trim() || null) : existing.coment_cn,
      asign_mber_id: nextAssignee,
      plan_dsgn_bgng_de:  planStartDate !== undefined ? (planStartDate?.trim() || null) : existing.plan_dsgn_bgng_de,
      plan_dsgn_end_de:   planEndDate   !== undefined ? (planEndDate?.trim()   || null) : existing.plan_dsgn_end_de,
      plan_dsgn_efrt_val: planEffort    !== undefined ? (planEffort?.trim()    || null) : existing.plan_dsgn_efrt_val,
      dsgn_doc_sttus_code: docStatus || existing.dsgn_doc_sttus_code,
      sort_ordr:     sortOrder ?? existing.sort_ordr,
      mdfcn_dt:      new Date(),
      mdfcn_mber_id: gate.mberId,
    };

    // 담당자 이력 저장 시 이름도 함께 기록 → 멤버 탈퇴 후에도 이력 뷰 보존
    // (담당자 변경이 실제로 일어났을 때만 조회 — 쿼리 불필요한 경우 스킵)
    let assigneeNames: { before: string | null; after: string | null } = { before: null, after: null };
    if (assigneeChanged) {
      const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
      const members = ids.length > 0
        ? await prisma.tbCmMember.findMany({
            where:  { mber_id: { in: ids } },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 이력에서 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : [];
      const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
      assigneeNames = {
        before: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
        after:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
      };
    }

    await prisma.$transaction(async (tx) => {
      await lockAndAssertCreatorWindow(tx, "UNIT_WORK", unitWorkId, gate);
      await tx.tbDsUnitWork.update({
        where: { unit_work_id: unitWorkId },
        data: updateData,
      });

      if (saveHistory) {
        // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
        await tx.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_unit_work",
            ref_id:        unitWorkId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "단위업무 설명",
            snapshot_data: {
              before: existing.unit_work_dc ?? null,
              after:  newDescription,
            },
            chg_mber_id: gate.mberId,
          },
        });
      }

      if (assigneeChanged) {
        // 담당자 변경 이력 — 자동 저장 (saveHistory와 무관).
        // snapshot에 ID와 이름을 함께 저장 → 멤버가 퇴장해도 이력 뷰가 살아있음
        await tx.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_unit_work",
            ref_id:        unitWorkId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    CHG_REASON_ASSIGNEE,
            snapshot_data: {
              before:     prevAssignee,
              after:      nextAssignee,
              beforeName: assigneeNames.before,
              afterName:  assigneeNames.after,
            },
            chg_mber_id: gate.mberId,
          },
        });
      }
    });

    return apiSuccess({ unitWorkId });
  } catch (err) {
    if (isCreatorWindowConflict(err)) return creatorWindowConflict();
    console.error(`[PUT /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 단위업무 삭제 ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, unitWorkId } = await params;
  const url            = new URL(request.url);
  // deleteChildren 기본 true — 기본적으로 하위 화면까지 삭제
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false";

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자만 삭제 가능
  const gate = await requireSpecContentWrite(request, projectId, "UNIT_WORK", unitWorkId, "DELETE");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    if (deleteChildren) {
      // 하위 화면 전체 삭제 후 단위업무 삭제 (트랜잭션)
      await prisma.$transaction([
        prisma.tbDsScreen.deleteMany({ where: { unit_work_id: unitWorkId } }),
        prisma.tbDsUnitWork.delete({ where: { unit_work_id: unitWorkId } }),
      ]);
    } else {
      // 화면의 unit_work_id를 null로 처리 (미분류) 후 단위업무만 삭제
      await prisma.$transaction([
        prisma.tbDsScreen.updateMany({
          where: { unit_work_id: unitWorkId },
          data:  { unit_work_id: null },
        }),
        prisma.tbDsUnitWork.delete({ where: { unit_work_id: unitWorkId } }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}

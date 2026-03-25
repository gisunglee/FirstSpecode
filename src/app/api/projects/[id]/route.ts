/**
 * GET    /api/projects/[id] — 프로젝트 상세 조회 (FID-00058)
 * PUT    /api/projects/[id] — 프로젝트 수정 (FID-00059)
 * DELETE /api/projects/[id] — 프로젝트 삭제 (FID-00062)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 프로젝트 상세 조회 ──────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  try {
    // 내 멤버십 확인 (접근 권한 체크 겸)
    const membership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    });

    if (!membership || membership.mber_sttus_code !== "ACTIVE") {
      return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
    }

    const project = await prisma.tbPjProject.findUnique({
      where: { prjct_id: projectId },
    });

    if (!project) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      projectId:   project.prjct_id,
      name:        project.prjct_nm,
      description: project.prjct_dc  ?? null,
      startDate:   project.bgng_de   ?? null,
      endDate:     project.end_de    ?? null,
      clientName:  project.client_nm ?? null,
      myRole:      membership.role_code,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}] DB 오류:`, err);
    return apiError("DB_ERROR", "프로젝트 정보 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 프로젝트 수정 ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // OWNER/ADMIN 권한 확인 (UW-00012: 기본정보 수정은 OWNER/ADMIN 가능)
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!["OWNER", "ADMIN"].includes(membership.role_code)) {
    return apiError("FORBIDDEN", "OWNER 또는 관리자만 수정할 수 있습니다.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { name, description, startDate, endDate, clientName } = body as {
    name?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    clientName?: string;
  };

  if (!name || !name.trim()) {
    return apiError("VALIDATION_ERROR", "프로젝트명을 입력해 주세요.", 400);
  }
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    return apiError("VALIDATION_ERROR", "종료일은 시작일 이후여야 합니다.", 400);
  }

  try {
    // 변경 이력 기록을 위해 현재값 조회
    const current = await prisma.tbPjProject.findUnique({
      where: { prjct_id: projectId },
      select: { prjct_nm: true, client_nm: true, bgng_de: true, end_de: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.tbPjProject.update({
        where: { prjct_id: projectId },
        data: {
          prjct_nm:  name.trim(),
          prjct_dc:  description?.trim() || null,
          bgng_de:   startDate ? new Date(startDate) : null,
          end_de:    endDate   ? new Date(endDate)   : null,
          client_nm: clientName?.trim() || null,
          mdfcn_dt:  new Date(),
        },
      });

      // 변경된 항목만 이력 기록
      const historyEntries: {
        prjct_id: string; chg_mber_id: string;
        chg_item_nm: string; bfr_val_cn?: string; aftr_val_cn?: string;
      }[] = [];

      if (current) {
        const newName = name.trim();
        if (current.prjct_nm !== newName) {
          historyEntries.push({
            prjct_id: projectId, chg_mber_id: auth.mberId,
            chg_item_nm: "프로젝트명",
            bfr_val_cn: current.prjct_nm,
            aftr_val_cn: newName,
          });
        }
        const newClient = clientName?.trim() || null;
        if ((current.client_nm ?? null) !== newClient) {
          historyEntries.push({
            prjct_id: projectId, chg_mber_id: auth.mberId,
            chg_item_nm: "발주처",
            bfr_val_cn: current.client_nm ?? undefined,
            aftr_val_cn: newClient ?? undefined,
          });
        }
        const newStart = startDate || null;
        const prevStart = current.bgng_de?.toISOString().slice(0, 10) ?? null;
        if (prevStart !== newStart) {
          historyEntries.push({
            prjct_id: projectId, chg_mber_id: auth.mberId,
            chg_item_nm: "시작일",
            bfr_val_cn: prevStart ?? undefined,
            aftr_val_cn: newStart ?? undefined,
          });
        }
        const newEnd = endDate || null;
        const prevEnd = current.end_de?.toISOString().slice(0, 10) ?? null;
        if (prevEnd !== newEnd) {
          historyEntries.push({
            prjct_id: projectId, chg_mber_id: auth.mberId,
            chg_item_nm: "종료일",
            bfr_val_cn: prevEnd ?? undefined,
            aftr_val_cn: newEnd ?? undefined,
          });
        }
      }

      if (historyEntries.length > 0) {
        await tx.tbPjSettingsHistory.createMany({ data: historyEntries });
      }
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 프로젝트 삭제 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  try {
    // OWNER 권한 확인
    const membership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    });
    if (!membership || membership.role_code !== "OWNER") {
      return apiError("FORBIDDEN", "OWNER만 삭제할 수 있습니다.", 403);
    }

    const project = await prisma.tbPjProject.findUnique({
      where: { prjct_id: projectId },
      select: { prjct_nm: true },
    });
    if (!project) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction(async (tx) => {
      // 참여 멤버(본인 제외)에게 제거 안내 기록
      const activeMembers = await tx.tbPjProjectMember.findMany({
        where: {
          prjct_id: projectId,
          mber_id: { not: auth.mberId },
          mber_sttus_code: "ACTIVE",
        },
        select: { mber_id: true },
      });

      if (activeMembers.length > 0) {
        await tx.tbPjMemberRemovalNotice.createMany({
          data: activeMembers.map((m) => ({
            mber_id:  m.mber_id,
            prjct_id: projectId,
            prjct_nm: project.prjct_nm,
          })),
        });
      }

      // 설정 먼저 삭제 (FK: prjct_id → tb_pj_project)
      await tx.tbPjProjectSettings.deleteMany({ where: { prjct_id: projectId } });
      // 멤버 삭제
      await tx.tbPjProjectMember.deleteMany({ where: { prjct_id: projectId } });
      // 프로젝트 삭제
      await tx.tbPjProject.delete({ where: { prjct_id: projectId } });
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}

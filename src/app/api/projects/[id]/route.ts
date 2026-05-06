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
  const auth = await requireAuth(request);
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

    // 삭제 예정(soft-deleted) 프로젝트는 일반 사용자에게 노출하지 않는다.
    // SUPER_ADMIN 어드민 조회는 별도 엔드포인트(/api/admin/projects/...) 사용.
    if (project.del_yn === "Y") {
      return apiError("FORBIDDEN_PROJECT_DELETED", "이 프로젝트는 삭제 처리되었습니다.", 403);
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
  const auth = await requireAuth(request);
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
    // 변경 이력 기록을 위해 현재값 조회 — del_yn 도 함께 확인
    const current = await prisma.tbPjProject.findUnique({
      where: { prjct_id: projectId },
      select: { prjct_nm: true, client_nm: true, bgng_de: true, end_de: true, del_yn: true },
    });

    // 삭제 예정 프로젝트는 수정 불가 — 복구 후에 수정해야 한다.
    if (current?.del_yn === "Y") {
      return apiError("FORBIDDEN_PROJECT_DELETED", "이 프로젝트는 삭제 처리되었습니다. 먼저 복구해 주세요.", 403);
    }

    await prisma.$transaction(async (tx) => {
      await tx.tbPjProject.update({
        where: { prjct_id: projectId },
        data: {
          prjct_nm:  name.trim(),
          ...(description !== undefined ? { prjct_dc: description?.trim() || null } : {}),
          ...(startDate !== undefined ? { bgng_de: startDate ? new Date(startDate) : null } : {}),
          ...(endDate !== undefined ? { end_de: endDate ? new Date(endDate) : null } : {}),
          ...(clientName !== undefined ? { client_nm: clientName?.trim() || null } : {}),
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

// ─── DELETE: 프로젝트 삭제 (soft delete) ─────────────────────────────────
//
// 동작 (2026-05-06 부터 변경):
//   - 즉시 hard delete 하지 않고 다음 4개 컬럼만 세팅한다.
//       del_yn='Y', del_dt=now(), del_mber_id=OWNER, hard_del_dt=now()+N일
//   - 본 OWNER 외 활성 멤버에게는 즉시 제거 안내(TbPjMemberRemovalNotice)를
//     발송하고, 멤버 행은 mber_sttus_code='REMOVED' 로 일괄 변경한다.
//     → 멤버들의 GNB/LNB/대시보드에서 즉시 사라진다.
//   - 보관 기간(N일) 동안은 OWNER 가 복구(restore) 가능. 기간이 지나면
//     별도 배치(project-hard-delete)가 실제 삭제를 수행한다.
//
// 안전장치:
//   - 다중 확인은 UI 에서 처리. API 는 본문에 confirm:'DELETE' 토큰을 요구해
//     "실수로 DELETE 가 발사되는" 사고를 1차 차단한다.
//   - 이미 del_yn='Y' 인 프로젝트에 다시 DELETE 가 오면 idempotent — 200 OK.
//
// 보관기간:
//   TbSysConfigTemplate.PROJECT_SOFT_DELETE_DAYS (기본 14) 를 읽어 사용.
//   값이 누락되면 SOFT_DELETE_DEFAULT_DAYS 로 fallback.
const SOFT_DELETE_DEFAULT_DAYS = 14;

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 안전 토큰 검증 — UI 가 다중 확인을 통과한 뒤에만 본문에 'DELETE' 를 실어준다.
  let body: { confirm?: unknown } = {};
  try {
    // 본문이 비어 있어도 허용(과거 호출 호환). 실제 검증은 confirm 값으로.
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }
  if (body.confirm !== "DELETE") {
    return apiError(
      "VALIDATION_ERROR",
      "프로젝트 삭제는 본문에 confirm:'DELETE' 토큰이 필요합니다.",
      400
    );
  }

  try {
    // OWNER 권한 확인
    const membership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    });
    if (!membership || membership.role_code !== "OWNER") {
      return apiError("FORBIDDEN", "OWNER만 삭제할 수 있습니다.", 403);
    }

    const project = await prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { prjct_nm: true, del_yn: true, hard_del_dt: true },
    });
    if (!project) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    // 이미 soft-deleted 면 멱등 처리 — 호출자에게는 동일하게 200 OK.
    if (project.del_yn === "Y") {
      return apiSuccess({ ok: true, alreadyDeleted: true, hardDeleteAt: project.hard_del_dt });
    }

    // 보관기간 결정 — 시스템 템플릿에서 읽고, 없거나 파싱 실패 시 기본값.
    const retentionTmpl = await prisma.tbSysConfigTemplate.findUnique({
      where:  { config_key: "PROJECT_SOFT_DELETE_DAYS" },
      select: { default_value: true },
    });
    const retentionDays = (() => {
      const n = parseInt(retentionTmpl?.default_value ?? "", 10);
      return Number.isFinite(n) && n > 0 ? n : SOFT_DELETE_DEFAULT_DAYS;
    })();

    const now = new Date();
    const hardDeleteAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      // ① 프로젝트를 "삭제 예정" 상태로 마크.
      await tx.tbPjProject.update({
        where: { prjct_id: projectId },
        data: {
          del_yn:      "Y",
          del_dt:      now,
          del_mber_id: auth.mberId,
          hard_del_dt: hardDeleteAt,
        },
      });

      // ② 본인 제외 활성 멤버에게 제거 안내 발송 + 상태를 REMOVED 로 변경.
      //    상태 변경 이유: 다른 멤버의 GNB/LNB/대시보드에서 즉시 사라져야 한다.
      //    OWNER 본인은 ACTIVE 유지 — 보관 기간 동안 복구하려면 멤버십이 살아있어야 함.
      const activeMembers = await tx.tbPjProjectMember.findMany({
        where: {
          prjct_id:        projectId,
          mber_id:         { not: auth.mberId },
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

        await tx.tbPjProjectMember.updateMany({
          where: {
            prjct_id:        projectId,
            mber_id:         { in: activeMembers.map((m) => m.mber_id) },
          },
          data: {
            mber_sttus_code: "REMOVED",
            sttus_chg_dt:    now,
          },
        });
      }
    });

    return apiSuccess({
      ok: true,
      // UI 안내용 — "N일 후 영구 삭제됩니다" 메시지 표시에 활용
      hardDeleteAt: hardDeleteAt.toISOString(),
      retentionDays,
    });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 처리 중 오류가 발생했습니다.", 500);
  }
}

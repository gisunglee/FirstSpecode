/**
 * /api/admin/support-session — 시스템 관리자 지원 세션 관리
 *
 * POST   : 지정 프로젝트에 대한 30분짜리 읽기 전용 지원 세션 개설
 * GET    : 현재 활성 세션 목록 (배너·관리 페이지용)
 * DELETE : 세션 조기 종료 (body.sessId 또는 ?sessId=)
 *
 * 동작:
 *   - requireSystemAdmin() 으로 SUPER_ADMIN 확인 (MCP 키 거부)
 *   - 같은 프로젝트에 이미 활성 세션이 있으면 그걸 반환 (중복 발급 방지)
 *   - tb_sys_admin_audit 에 SUPPORT_SESSION_OPEN / SUPPORT_SESSION_END 기록
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { logAdminAction } from "@/lib/audit";

// 지원 세션 유효 시간 — 30분
// 너무 길면 관리자가 세션 연 걸 잊고 방치 위험 / 너무 짧으면 실제 조사 시간 부족
const SUPPORT_SESSION_DURATION_MS = 30 * 60 * 1000;

// ─── POST: 지원 세션 개설 ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { projectId, memo } = (body ?? {}) as {
    projectId?: string;
    memo?:      string;
  };

  if (!projectId || typeof projectId !== "string") {
    return apiError("VALIDATION_ERROR", "projectId 가 필요합니다.", 400);
  }

  // 존재하는 프로젝트인지 확인 — 없는 프로젝트에 세션 발급 방지
  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: projectId },
    select: { prjct_id: true, prjct_nm: true },
  });
  if (!project) {
    return apiError("NOT_FOUND", "존재하지 않는 프로젝트입니다.", 404);
  }

  const now = new Date();

  // 중복 세션 방지 — 기존 활성 세션이 있으면 그걸 그대로 반환.
  // (관리자가 여러 번 버튼 눌러도 세션 인플레이션 안 남)
  const existing = await prisma.tbSysAdminSupportSession.findFirst({
    where: {
      admin_mber_id: gate.mberId,
      prjct_id:      projectId,
      expires_dt:    { gt: now },
      ended_dt:      null,
    },
  });

  if (existing) {
    return apiSuccess({
      sessId:      existing.sess_id,
      projectId:   existing.prjct_id,
      projectName: project.prjct_nm,
      expiresAt:   existing.expires_dt.toISOString(),
      memo:        existing.memo,
      alreadyOpen: true,
    });
  }

  // 신규 발급
  const expiresAt = new Date(now.getTime() + SUPPORT_SESSION_DURATION_MS);

  const created = await prisma.tbSysAdminSupportSession.create({
    data: {
      admin_mber_id: gate.mberId,
      prjct_id:      projectId,
      memo:          memo?.trim() || null,
      expires_dt:    expiresAt,
    },
  });

  await logAdminAction({
    adminMberId: gate.mberId,
    actionType:  "SUPPORT_SESSION_OPEN",
    targetType:  "PROJECT",
    targetId:    projectId,
    memo:        memo?.trim() || null,
    ipAddr:      gate.ipAddr,
    userAgent:   gate.userAgent,
  });

  return apiSuccess({
    sessId:      created.sess_id,
    projectId:   created.prjct_id,
    projectName: project.prjct_nm,
    expiresAt:   created.expires_dt.toISOString(),
    memo:        created.memo,
    alreadyOpen: false,
  }, 201);
}

// ─── GET: 내 활성 세션 목록 ────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const filterProjectId  = searchParams.get("projectId") ?? undefined;

  const now = new Date();
  const sessions = await prisma.tbSysAdminSupportSession.findMany({
    where: {
      admin_mber_id: gate.mberId,
      expires_dt:    { gt: now },
      ended_dt:      null,
      ...(filterProjectId ? { prjct_id: filterProjectId } : {}),
    },
    orderBy: { creat_dt: "desc" },
    select: {
      sess_id:    true,
      prjct_id:   true,
      memo:       true,
      expires_dt: true,
      creat_dt:   true,
    },
  });

  return apiSuccess({
    items: sessions.map((s) => ({
      sessId:    s.sess_id,
      projectId: s.prjct_id,
      memo:      s.memo,
      expiresAt: s.expires_dt.toISOString(),
      createdAt: s.creat_dt.toISOString(),
    })),
  });
}

// ─── DELETE: 지원 세션 조기 종료 ────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  let sessId = searchParams.get("sessId") ?? undefined;

  // body 에서도 받을 수 있게 지원 (beacon API 등에서는 body 가 편함)
  if (!sessId) {
    try {
      const body = await request.json() as { sessId?: string };
      sessId = body.sessId;
    } catch {
      // 본문 없음은 정상 케이스 — sessId 필수 체크에서 걸러짐
    }
  }

  if (!sessId) {
    return apiError("VALIDATION_ERROR", "sessId 가 필요합니다.", 400);
  }

  // 본인 소유 세션만 종료 가능 — 다른 관리자 세션은 건드릴 수 없음
  const session = await prisma.tbSysAdminSupportSession.findUnique({
    where:  { sess_id: sessId },
    select: { sess_id: true, admin_mber_id: true, prjct_id: true, ended_dt: true },
  });

  if (!session || session.admin_mber_id !== gate.mberId) {
    return apiError("NOT_FOUND", "세션을 찾을 수 없습니다.", 404);
  }

  if (session.ended_dt) {
    // 이미 종료된 세션 — 멱등성 유지 위해 200 OK
    return apiSuccess({ sessId, alreadyEnded: true });
  }

  await prisma.tbSysAdminSupportSession.update({
    where: { sess_id: sessId },
    data:  { ended_dt: new Date() },
  });

  await logAdminAction({
    adminMberId: gate.mberId,
    actionType:  "SUPPORT_SESSION_END",
    targetType:  "PROJECT",
    targetId:    session.prjct_id,
    ipAddr:      gate.ipAddr,
    userAgent:   gate.userAgent,
  });

  return apiSuccess({ sessId, alreadyEnded: false });
}

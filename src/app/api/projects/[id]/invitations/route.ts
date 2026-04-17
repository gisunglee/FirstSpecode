/**
 * GET  /api/projects/[id]/invitations — 초대 현황 조회 (FID-00066)
 * POST /api/projects/[id]/invitations — 초대 발송 (FID-00065)
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { sendInvitationEmail } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string }> };

// OWNER/ADMIN 권한 확인 헬퍼
async function requireOwnerOrAdmin(projectId: string, mberId: string) {
  const m = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: mberId } },
  });
  if (!m || m.mber_sttus_code !== "ACTIVE") return null;
  if (m.role_code !== "OWNER" && m.role_code !== "ADMIN") return null;
  return m;
}

// ─── GET: 초대 현황 조회 ──────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const m = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!m || m.mber_sttus_code !== "ACTIVE" || (m.role_code !== "OWNER" && m.role_code !== "ADMIN")) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 만료 자동 처리: PENDING이고 expiry_dt ≤ NOW() → EXPIRED
    await prisma.tbPjProjectInvitation.updateMany({
      where: {
        prjct_id: projectId,
        invt_sttus_code: "PENDING",
        expiry_dt: { lte: new Date() },
      },
      data: { invt_sttus_code: "EXPIRED" },
    });

    const invitations = await prisma.tbPjProjectInvitation.findMany({
      where: { prjct_id: projectId },
      orderBy: { invt_dt: "desc" },
    });

    const items = invitations.map((inv) => ({
      invitationId: inv.invt_id,
      email:        inv.email_addr,
      role:         inv.role_code,
      status:       inv.invt_sttus_code,
      invitedAt:    inv.invt_dt,
      expiresAt:    inv.expiry_dt,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/invitations] DB 오류:`, err);
    return apiError("DB_ERROR", "초대 현황 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 초대 발송 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const member = await requireOwnerOrAdmin(projectId, auth.mberId);
  if (!member) return apiError("FORBIDDEN", "초대 권한이 없습니다.", 403);

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { invitations } = body as {
    invitations?: Array<{ email: string; role: string }>;
  };

  if (!Array.isArray(invitations) || invitations.length === 0) {
    return apiError("VALIDATION_ERROR", "초대할 이메일 목록이 필요합니다.", 400);
  }

  // 이메일 형식 검증
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const inv of invitations) {
    if (!emailRegex.test(inv.email)) {
      return apiError("VALIDATION_ERROR", `올바른 이메일 형식이 아닙니다: ${inv.email}`, 400);
    }
    if (!["ADMIN", "MEMBER"].includes(inv.role)) {
      return apiError("VALIDATION_ERROR", "역할은 ADMIN 또는 MEMBER이어야 합니다.", 400);
    }
  }

  // 프로젝트 정보 + 초대자 이메일 조회
  const [project, inviter] = await Promise.all([
    prisma.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { prjct_nm: true } }),
    prisma.tbCmMember.findUnique({ where: { mber_id: auth.mberId }, select: { email_addr: true } }),
  ]);

  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const inv of invitations) {
    try {
      // 이미 멤버인지 확인
      const existingMember = await prisma.tbCmMember.findUnique({
        where: { email_addr: inv.email },
        select: { mber_id: true },
      });
      if (existingMember) {
        const isMember = await prisma.tbPjProjectMember.findUnique({
          where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: existingMember.mber_id } },
        });
        if (isMember && isMember.mber_sttus_code === "ACTIVE") {
          results.push({ email: inv.email, ok: false, error: "이미 프로젝트에 속한 멤버입니다." });
          continue;
        }
      }

      // 이미 PENDING 초대가 있는지 확인
      const pendingInvitation = await prisma.tbPjProjectInvitation.findFirst({
        where: { prjct_id: projectId, email_addr: inv.email, invt_sttus_code: "PENDING" },
      });
      if (pendingInvitation) {
        results.push({ email: inv.email, ok: false, error: "이미 초대 중인 이메일입니다." });
        continue;
      }

      // 초대 토큰 생성 + INSERT
      const token   = randomBytes(32).toString("hex");
      const expiry  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

      await prisma.tbPjProjectInvitation.create({
        data: {
          prjct_id:        projectId,
          email_addr:      inv.email,
          role_code:       inv.role,
          invt_token_val:  token,
          invtr_mber_id:   auth.mberId,
          invt_sttus_code: "PENDING",
          expiry_dt:       expiry,
        },
      });

      // 초대 메일 발송 (실패해도 DB 기록은 유지)
      await sendInvitationEmail(
        inv.email,
        token,
        project?.prjct_nm ?? "",
        inviter?.email_addr ?? auth.email
      ).catch((e) => console.error("[초대 메일 발송 실패]", e));

      results.push({ email: inv.email, ok: true });
    } catch (err) {
      console.error(`[초대 발송 오류] ${inv.email}:`, err);
      results.push({ email: inv.email, ok: false, error: "초대 발송 중 오류가 발생했습니다." });
    }
  }

  return apiSuccess({ results });
}

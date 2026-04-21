/**
 * GET  /api/projects/[id]/invitations — 초대 현황 조회 (FID-00066)
 * POST /api/projects/[id]/invitations — 초대 발송      (FID-00065)
 *
 * 역할·직무:
 *   - 초대 시 역할(ADMIN/MEMBER)과 직무(PM/PL/DBA/DEV/DESIGNER/QA/ETC) 함께 지정
 *   - 직무 미지정 시 ETC 로 기본값 저장
 *   - OWNER 초대는 불가 (OWNER 는 양도로만 변경)
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { sendInvitationEmail } from "@/lib/auth";
import { isJobCode, JOB_CODES } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

// 초대 가능한 역할 — OWNER 는 양도로만 변경되므로 초대 불가
const INVITABLE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

// ─── GET: 초대 현황 조회 ──────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // member.read 권한 + OWNER/ADMIN 만 초대현황을 본다 → member.invite 권한으로 가드
  const gate = await requirePermission(request, projectId, "member.invite");
  if (gate instanceof Response) return gate;

  try {
    // 만료 자동 처리: PENDING이고 expiry_dt ≤ NOW() → EXPIRED
    await prisma.tbPjProjectInvitation.updateMany({
      where: {
        prjct_id:        projectId,
        invt_sttus_code: "PENDING",
        expiry_dt:       { lte: new Date() },
      },
      data: { invt_sttus_code: "EXPIRED" },
    });

    const invitations = await prisma.tbPjProjectInvitation.findMany({
      where:   { prjct_id: projectId },
      orderBy: { invt_dt: "desc" },
    });

    const items = invitations.map((inv) => ({
      invitationId: inv.invt_id,
      email:        inv.email_addr,
      role:         inv.role_code,
      job:          inv.job_title_code,  // 신규
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
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "member.invite");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // role 외에 job 도 받음 (선택 — 없으면 ETC)
  const { invitations } = body as {
    invitations?: Array<{ email: string; role: string; job?: string }>;
  };

  if (!Array.isArray(invitations) || invitations.length === 0) {
    return apiError("VALIDATION_ERROR", "초대할 이메일 목록이 필요합니다.", 400);
  }

  // 형식 검증 — 먼저 전체를 훑어서 하나라도 틀리면 400
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const inv of invitations) {
    if (!emailRegex.test(inv.email)) {
      return apiError("VALIDATION_ERROR", `올바른 이메일 형식이 아닙니다: ${inv.email}`, 400);
    }
    if (!(INVITABLE_ROLES as readonly string[]).includes(inv.role)) {
      return apiError(
        "VALIDATION_ERROR",
        `역할은 ${INVITABLE_ROLES.join("/")} 중 하나여야 합니다.`,
        400
      );
    }
    // job 은 선택 — 제공되면 검증, 안 하면 ETC
    if (inv.job !== undefined && !isJobCode(inv.job)) {
      return apiError(
        "VALIDATION_ERROR",
        `직무는 ${JOB_CODES.join("/")} 중 하나여야 합니다.`,
        400
      );
    }
  }

  // 프로젝트 정보 + 초대자 이메일 조회
  const [project, inviter] = await Promise.all([
    prisma.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { prjct_nm: true } }),
    prisma.tbCmMember.findUnique({ where: { mber_id: gate.mberId }, select: { email_addr: true } }),
  ]);

  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const inv of invitations) {
    try {
      // 이미 멤버인지 확인
      const existingMember = await prisma.tbCmMember.findUnique({
        where:  { email_addr: inv.email },
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
      const token  = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

      await prisma.tbPjProjectInvitation.create({
        data: {
          prjct_id:        projectId,
          email_addr:      inv.email,
          role_code:       inv.role,
          job_title_code:  inv.job ?? "ETC",   // 신규 — 미지정 시 ETC
          invt_token_val:  token,
          invtr_mber_id:   gate.mberId,
          invt_sttus_code: "PENDING",
          expiry_dt:       expiry,
        },
      });

      // 초대 메일 발송 (실패해도 DB 기록은 유지)
      await sendInvitationEmail(
        inv.email,
        token,
        project?.prjct_nm ?? "",
        inviter?.email_addr ?? gate.email
      ).catch((e) => console.error("[초대 메일 발송 실패]", e));

      results.push({ email: inv.email, ok: true });
    } catch (err) {
      console.error(`[초대 발송 오류] ${inv.email}:`, err);
      results.push({ email: inv.email, ok: false, error: "초대 발송 중 오류가 발생했습니다." });
    }
  }

  return apiSuccess({ results });
}

/**
 * GET  /api/projects — 내 프로젝트 목록 조회 (FID-00053)
 * POST /api/projects — 프로젝트 생성 (FID-00056)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// ─── GET: 내 프로젝트 목록 ─────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    // 내가 ACTIVE 상태로 참여 중인 프로젝트만 조회
    const memberships = await prisma.tbPjProjectMember.findMany({
      where: {
        mber_id: auth.mberId,
        mber_sttus_code: "ACTIVE",
      },
      include: {
        project: {
          select: {
            prjct_id:  true,
            prjct_nm:  true,
            client_nm: true,
            bgng_de:   true,
            end_de:    true,
            mdfcn_dt:  true,
            creat_dt:  true,
          },
        },
      },
      orderBy: { join_dt: "desc" },
    });

    const items = memberships
      // 최근 수정일 기준 내림차순 정렬
      .sort((a, b) => {
        const aTime = (a.project.mdfcn_dt ?? a.project.creat_dt).getTime();
        const bTime = (b.project.mdfcn_dt ?? b.project.creat_dt).getTime();
        return bTime - aTime;
      })
      .map((m) => ({
        projectId:  m.project.prjct_id,
        name:       m.project.prjct_nm,
        clientName: m.project.client_nm ?? null,
        startDate:  m.project.bgng_de   ?? null,
        endDate:    m.project.end_de    ?? null,
        myRole:     m.role_code,
      }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/projects] DB 오류:", err);
    return apiError("DB_ERROR", "프로젝트 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 프로젝트 생성 ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

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

  // 프로젝트명 필수 검증
  if (!name || !name.trim()) {
    return apiError("VALIDATION_ERROR", "프로젝트명을 입력해 주세요.", 400);
  }

  // 날짜 검증 — 종료일이 시작일 이전인지 확인
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    return apiError("VALIDATION_ERROR", "종료일은 시작일 이후여야 합니다.", 400);
  }

  try {
    // 트랜잭션: 프로젝트 + 멤버(OWNER) + 설정 동시 생성
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.tbPjProject.create({
        data: {
          prjct_nm:      name.trim(),
          prjct_dc:      description?.trim() || null,
          bgng_de:       startDate  ? new Date(startDate)  : null,
          end_de:        endDate    ? new Date(endDate)     : null,
          client_nm:     clientName?.trim() || null,
          creat_mber_id: auth.mberId,
        },
      });

      // 생성자 자동 OWNER 등록
      await tx.tbPjProjectMember.create({
        data: {
          prjct_id:       created.prjct_id,
          mber_id:        auth.mberId,
          role_code:      "OWNER",
          mber_sttus_code: "ACTIVE",
        },
      });

      // 기본 프로젝트 설정 생성 (DIRECT 방식, FREE 플랜)
      await tx.tbPjProjectSettings.create({
        data: {
          prjct_id:          created.prjct_id,
          ai_call_mthd_code: "DIRECT",
          plan_code:         "FREE",
        },
      });

      return created;
    });

    return apiSuccess({ projectId: project.prjct_id }, 201);
  } catch (err) {
    console.error("[POST /api/projects] DB 오류:", err);
    return apiError("DB_ERROR", "프로젝트 생성 중 오류가 발생했습니다.", 500);
  }
}

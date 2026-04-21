/**
 * POST /api/projects/[id]/copy — 프로젝트 복사 (FID-00060)
 *
 * 역할:
 *   - 프로젝트 기본 정보 + 설정 복사
 *   - 복사자만 OWNER로 등록 (원본 멤버 미복사)
 *   - 구조 데이터(요구사항·설계 등)는 해당 기능 구현 시 추가 예정
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  try {
    // 원본 프로젝트 + 설정 조회 (내 멤버십 확인 겸)
    const membership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    });
    if (!membership || membership.mber_sttus_code !== "ACTIVE") {
      return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
    }

    const original = await prisma.tbPjProject.findUnique({
      where: { prjct_id: projectId },
      include: { settings: true },
    });
    if (!original) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    // 트랜잭션: 복사본 프로젝트 + 멤버(OWNER) + 설정 생성
    const newProject = await prisma.$transaction(async (tx) => {
      const copy = await tx.tbPjProject.create({
        data: {
          prjct_nm:      `${original.prjct_nm} (복사본)`,
          prjct_dc:      original.prjct_dc,
          bgng_de:       original.bgng_de,
          end_de:        original.end_de,
          client_nm:     original.client_nm,
          creat_mber_id: auth.mberId,
        },
      });

      // 복사자만 OWNER (원본 멤버 미복사)
      await tx.tbPjProjectMember.create({
        data: {
          prjct_id:        copy.prjct_id,
          mber_id:         auth.mberId,
          role_code:       "OWNER",
          mber_sttus_code: "ACTIVE",
        },
      });

      // 원본 설정값 복사 (settings 는 1:1 nullable 관계)
      const origSettings = original.settings;
      await tx.tbPjProjectSettings.create({
        data: {
          prjct_id:          copy.prjct_id,
          ai_call_mthd_code: origSettings?.ai_call_mthd_code ?? "DIRECT",
          plan_code:         origSettings?.plan_code         ?? "FREE",
        },
      });

      // TODO: 구조 데이터(요구사항·설계) 복사 — 해당 기능 구현 시 추가

      return copy;
    });

    return apiSuccess({ newProjectId: newProject.prjct_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/copy] DB 오류:`, err);
    return apiError("DB_ERROR", "프로젝트 복사 중 오류가 발생했습니다.", 500);
  }
}

/**
 * HealthCheckRoute — 서버 상태 확인 API (/api/health)
 *
 * 역할:
 *   - 서버 정상 동작 여부 확인 (배포 후 첫 확인용)
 *   - DB 연결 상태 확인
 *
 * 사용법:
 *   GET /api/health
 */

import { NextRequest } from "next/server";
import { prisma }      from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET(_req: NextRequest) {
  try {
    // DB 연결 확인 — 간단한 쿼리로 연결 상태 점검
    await prisma.$queryRaw`SELECT 1`;

    return apiSuccess({ status: "ok", db: "connected" });
  } catch (err) {
    // DB 연결 실패 — 상세 에러는 서버 로그에만 기록 (클라이언트에 DB 정보 노출 금지)
    console.error("[health] DB 연결 실패:", err);
    return apiError("DB_ERROR", "데이터베이스 연결에 실패했습니다.", 500);
  }
}

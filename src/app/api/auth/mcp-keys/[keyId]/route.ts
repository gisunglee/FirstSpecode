/**
 * DELETE /api/auth/mcp-keys/[keyId] — MCP 키 폐기 (소프트 삭제)
 *
 * 역할:
 *   - 로그인한 사용자 본인의 MCP 키만 폐기 가능
 *   - revoke_dt를 현재 시각으로 설정 (물리 삭제 아님)
 *   - 폐기된 키로 인증 시도하면 requireAuth에서 거부
 *
 * 과거 경로: /api/auth/api-keys/[keyId] (2026-04-24 rename)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ keyId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { keyId } = await params;

  try {
    const mcpKey = await prisma.tbCmMcpKey.findUnique({
      where: { api_key_id: keyId },
    });

    // 키가 없거나 다른 사용자의 키인 경우 (보안: 타인 키 폐기 차단)
    if (!mcpKey || mcpKey.mber_id !== auth.mberId) {
      return apiError("NOT_FOUND", "MCP 키를 찾을 수 없습니다.", 404);
    }

    // 이미 폐기된 키
    if (mcpKey.revoke_dt) {
      return apiError("ALREADY_REVOKED", "이미 폐기된 MCP 키입니다.", 400);
    }

    // 소프트 삭제 — revoke_dt 설정
    await prisma.tbCmMcpKey.update({
      where: { api_key_id: keyId },
      data: { revoke_dt: new Date() },
    });

    return apiSuccess({ revoked: true });
  } catch (err) {
    console.error(`[DELETE /api/auth/mcp-keys/${keyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "MCP 키 폐기에 실패했습니다.", 500);
  }
}

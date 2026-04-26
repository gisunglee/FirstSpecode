/**
 * requireAuth — API 라우트 인증 헬퍼
 *
 * 역할:
 *   - Authorization: Bearer <AT> 또는 Bearer <API키> 헤더 검증
 *   - JWT 토큰: 기존 방식 (verifyAccessToken으로 즉시 검증)
 *   - API 키 (spk_ prefix): DB에서 해시 조회 → 사용자 매핑
 *   - 유효하면 페이로드({ mberId, email, allowedPrjctId? }) 반환
 *   - 무효/누락이면 401 Response 반환
 *   - MCP "프로젝트 고정 키"가 다른 프로젝트 URL을 찌르면 403 자동 차단 (URL 기반)
 *
 * 사용법:
 *   const auth = await requireAuth(request);
 *   if (auth instanceof Response) return auth;   ← 401/403 즉시 반환
 *   // auth.mberId, auth.email 사용 가능
 */

import { NextRequest } from "next/server";
import { verifyAccessToken, hashApiKey } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { MCP_KEY_GLOBAL_SCOPE } from "@/lib/mcpKeyScope";

/**
 * sesnId는 JWT 경로에서만 채워진다(= 로그인·소셜·이메일 인증·토큰 갱신).
 *   - API 키 인증 경로는 세션 개념이 없어 undefined.
 *   - 30분 만료 이전에 배포된 구(舊) AT에도 없을 수 있으므로 optional.
 * 민감 API에서만 존재 여부를 확인해 세션 활성 검증에 사용한다.
 *
 * allowedPrjctId는 MCP 키 중 "프로젝트 고정" 키일 때만 값이 있다.
 *   - undefined: JWT 인증이거나, 전역 MCP 키 → 모든 멤버십 프로젝트 허용
 *   - 값 있음  : 해당 프로젝트 외 접근 시 URL 기반 scope 가드로 자동 차단
 *   → 수동 검증 헬퍼(명시적 호출용): src/lib/mcpKeyScope.ts
 */
export type AuthPayload = {
  mberId: string;
  email:  string;
  sesnId?:         string;
  allowedPrjctId?: string;
};

// ─── URL 기반 scope 가드 ──────────────────────────────────────────
// /api/projects/[id]/** 경로에서 [id]를 추출해 auth.allowedPrjctId와 대조.
// 불일치면 403 FORBIDDEN_SCOPE 반환 → 72개 프로젝트 라우트 전체 자동 보호.
//
// EXCLUDED_PATHS는 프로젝트 ID가 URL segment에 없거나 목록/필터 방식으로
// scope가 적용되는 경로 — 이 경로는 라우트 내부 로직이 auth.allowedPrjctId
// 를 직접 참고해 필터링한다(예: /api/projects, /api/projects/my).
const EXCLUDED_SCOPE_PATHS: RegExp[] = [
  /^\/api\/projects\/?$/,      // GET /api/projects (목록)
  /^\/api\/projects\/my\b/,    // GET /api/projects/my (내 프로젝트 목록)
  /^\/api\/mcp\b/,             // MCP 진입점 자체 (내부 API 호출 시 전파된 토큰이 해당 route에서 검증됨)
];

const PROJECT_URL_RE = /^\/api\/projects\/([^/]+)(?:\/|$)/;

/**
 * URL에서 projectId를 추출해 scope 키와 대조. 불일치면 403 반환.
 */
function checkUrlScope(request: NextRequest, allowedPrjctId: string): Response | null {
  const path = request.nextUrl.pathname;

  // 예외 경로는 검사 생략 (라우트 내부에서 별도 처리)
  if (EXCLUDED_SCOPE_PATHS.some((re) => re.test(path))) return null;

  const match = PROJECT_URL_RE.exec(path);
  if (!match) return null;  // 프로젝트 경로가 아니면 검사 생략

  const urlProjectId = match[1];
  if (urlProjectId !== allowedPrjctId) {
    return apiError(
      "FORBIDDEN_SCOPE",
      "이 API 키는 다른 프로젝트 전용입니다. 해당 프로젝트의 키를 사용해 주세요.",
      403
    );
  }
  return null;
}

/**
 * AT 또는 API 키 검증 — 성공 시 페이로드, 실패 시 401/403 Response 반환
 *
 * API 키 인증 흐름:
 *   1. "spk_" prefix 감지
 *   2. SHA-256 해시 → DB의 key_hash와 비교
 *   3. 폐기 여부(revoke_dt) 확인
 *   4. last_used_dt 비동기 갱신 (응답 차단 안 함)
 *   5. 연결된 회원의 mberId/email + allowedPrjctId 반환
 *   6. "프로젝트 고정 키"이면 URL에서 projectId 추출해 scope 검증
 */
export async function requireAuth(request: NextRequest): Promise<AuthPayload | Response> {
  const authHeader = request.headers.get("Authorization");

  // Authorization 헤더 누락 또는 형식 불일치
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  }

  const token = authHeader.slice(7); // "Bearer " 이후 토큰 추출

  // ── MCP 키 인증 (spk_ prefix) ────────────────────────────────────
  if (token.startsWith("spk_")) {
    const keyHash = hashApiKey(token);

    const mcpKey = await prisma.tbCmMcpKey.findUnique({
      where: { key_hash: keyHash },
      include: { member: { select: { mber_id: true, email_addr: true } } },
    });

    // 키가 존재하지 않거나 폐기된 경우
    if (!mcpKey || mcpKey.revoke_dt) {
      return apiError("INVALID_API_KEY", "유효하지 않은 API 키입니다.", 401);
    }

    // [2026-04-26] 키 용도 검증 — Claude Code MCP / 일반 API 호출에는 'CLIENT' 만 허용
    // 워커용 'WORKER' 키가 이 경로로 들어오면 거부 (채널 혼용 방지).
    // 'WORKER' 키는 /api/worker/* 의 X-Mcp-Key 헤더로만 사용해야 함.
    if (mcpKey.key_use_se_code === "WORKER") {
      return apiError(
        "WRONG_KEY_PURPOSE",
        "이 키는 워커(run-ai-tasks) 전용입니다. " +
        "Claude Code 등 일반 API 호출에는 'Claude Code (MCP 도구)' 용도 키를 사용하세요.",
        403,
      );
    }

    // last_used_dt 비동기 갱신 — 응답 지연 없이 fire-and-forget
    prisma.tbCmMcpKey.update({
      where: { api_key_id: mcpKey.api_key_id },
      data: { last_used_dt: new Date() },
    }).catch(() => {});

    // 프로젝트 고정 키면 URL scope 검증 — 72개 프로젝트 라우트 일괄 보호
    // 'ALL' sentinel(전역 키)은 검증 생략, 실제 UUID만 대상
    const isGlobal = mcpKey.prjct_id === MCP_KEY_GLOBAL_SCOPE;
    if (!isGlobal) {
      const scopeErr = checkUrlScope(request, mcpKey.prjct_id);
      if (scopeErr) return scopeErr;
    }

    return {
      mberId: mcpKey.member.mber_id,
      email:  mcpKey.member.email_addr ?? "",
      // 'ALL' → undefined (app 레이어에서는 "scope 제한 없음"으로 통일)
      // mcpKeyScope.enforceMcpKeyScope, scopeWhere도 이 값 기준으로 동작
      allowedPrjctId: isGlobal ? undefined : mcpKey.prjct_id,
    };
  }

  // ── 기존 JWT 인증 ────────────────────────────────────────────────
  const payload = verifyAccessToken(token);

  // 토큰 만료 또는 서명 불일치
  if (!payload) {
    return apiError("TOKEN_EXPIRED", "인증이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }

  return {
    mberId: payload.mberId,
    email:  payload.email,
    sesnId: payload.sesnId,
  };
}

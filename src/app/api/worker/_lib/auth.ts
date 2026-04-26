/**
 * Worker API 인증 헬퍼
 *
 * 역할:
 *   - 외부 AI 워커(/run-ai-tasks 등) 요청을 개인 MCP 키(`spk_`)로만 인증.
 *   - 화면용 세션 인증(requireAuth)과는 별도 — 워커는 세션이 없음.
 *
 * 인증 모델:
 *   X-Mcp-Key 헤더(`spk_...`) 단일 채널. 키 = 사용자 1:1 매핑.
 *   → 사칭 차단의 핵심: 워커가 mberId 를 명시적으로 보내지 못함. 서버가 키에서 결정.
 *
 * 보안 가드:
 *   1. 키 해시 매칭 실패 또는 폐기된 키 → 401
 *   2. 키 용도가 'WORKER' 가 아닌 경우 → 403 (Claude Code 키 오용 방지)
 *   3. 전역 키('ALL' scope) 거부 → 403 (워커는 단일 프로젝트 컨텍스트 전용)
 *   4. 키 소유자가 그 프로젝트의 ACTIVE 멤버가 아닌 경우 → 403 (강퇴/탈퇴 즉시 효과)
 *
 * 부수 효과:
 *   - last_used_dt 비동기 갱신 (응답 차단 안 함)
 *
 * 변경 이력:
 *   - [2026-04-26] 1차: SHARED(WORKER_API_KEY) + PERSONAL(MCP 키) 더블 모드로 도입
 *   - [2026-04-26] 2차: key_use_se_code='WORKER' 가드 추가
 *   - [2026-04-26] 4차: SHARED 모드 폐기 — PERSONAL 단일 채널만 허용
 *                       이유: 공유 키는 노출 시 영향 범위 폭발 + 책임추적성 흐려짐.
 *                            "공통 워커" 시나리오는 향후 서버 사이드 워커 또는
 *                            운영 공용 회원 가입 방식으로 풀 것 (YAGNI).
 */

import { NextRequest } from "next/server";
import { hashApiKey } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { isGlobalMcpKey } from "@/lib/mcpKeyScope";

// ── 인증 결과 타입 ──────────────────────────────────────────────────
// 키 해시 매칭으로 자동 결정 — 워커가 헤더로 직접 보낼 수 없는 값들.
export type WorkerAuth = {
  mberId:     string;
  mberNm:     string | null;
  email:      string | null;
  // 'ALL' 거부 가드 통과 후이므로 항상 실제 프로젝트 UUID
  prjctId:    string;
  prjctNm:    string | null;
  keyName:    string;
  apiKeyId:   string;
  // 응답 메타에 노출 — 사용자가 어떤 키로 동작 중인지 즉시 인지하도록
  lastUsedAt: Date | null;
};

/**
 * 워커 인증 진입점.
 * 성공 시 인증 정보 반환, 실패 시 NextResponse(401/403) 반환.
 *
 * 사용법:
 *   const auth = await requireWorkerAuth(request);
 *   if (auth instanceof Response) return auth;
 *   // auth.mberId, auth.prjctId 등 직접 접근 (분기 불필요)
 */
export async function requireWorkerAuth(
  request: NextRequest,
): Promise<WorkerAuth | Response> {
  // .env.local 의 끝 공백/줄바꿈으로 사용자가 디버깅 어려워지는 것 방지
  const rawKey = request.headers.get("X-Mcp-Key")?.trim();

  // 헤더 미존재 또는 잘못된 prefix → 401
  if (!rawKey || !rawKey.startsWith("spk_")) {
    return apiError(
      "UNAUTHORIZED",
      "워커 인증이 필요합니다. SPECODE > 설정 > MCP 키 에서 '워커(run-ai-tasks)' 용 키를 발급받아 " +
      "X-Mcp-Key 헤더로 전송하세요.",
      401,
    );
  }

  const keyHash = hashApiKey(rawKey);

  // 키 + 회원 정보 동시 조회
  const mcpKey = await prisma.tbCmMcpKey.findUnique({
    where:   { key_hash: keyHash },
    include: {
      member: {
        select: { mber_id: true, mber_nm: true, email_addr: true },
      },
    },
  });

  // 1. 키 미존재 또는 폐기 — 같은 메시지로 통합 (정보 노출 최소화)
  if (!mcpKey || mcpKey.revoke_dt !== null) {
    return apiError(
      "INVALID_MCP_KEY",
      "유효하지 않은 MCP 키입니다. 키가 폐기되었거나 존재하지 않습니다.",
      401,
    );
  }

  // 2. 키 용도 검증 — 'WORKER' 만 워커 인증 허용
  // 이유: Claude Code MCP 용 키('CLIENT')를 실수로 워커에 박는 사고 차단.
  // 발급 단계(api/auth/mcp-keys POST)에서도 막지만, 서버 진입에서 한 번 더 확인.
  if (mcpKey.key_use_se_code !== "WORKER") {
    return apiError(
      "WRONG_KEY_PURPOSE",
      "이 키는 Claude Code MCP 용입니다. " +
      "SPECODE > 설정 > MCP 키 에서 '워커 (run-ai-tasks) 용' 키를 발급하세요.",
      403,
    );
  }

  // 3. 전역 키('ALL') 거부 — 워커는 프로젝트 경계 안에서만 동작
  // 이유: 여러 프로젝트의 PENDING 이 섞여 들어오면 사용자가 의도한 컨텍스트와 어긋남.
  // 발급 단계에서 'WORKER' + 'ALL' 조합 차단되지만 이중 방어.
  if (isGlobalMcpKey(mcpKey.prjct_id)) {
    return apiError(
      "WORKER_REQUIRES_PROJECT_SCOPE",
      "워커 인증은 프로젝트 scope 키만 허용합니다. " +
      "SPECODE > 설정 > MCP 키 에서 특정 프로젝트로 scope 고정된 키를 발급하세요.",
      403,
    );
  }

  // 4. ACTIVE 멤버십 검증 — 강퇴/탈퇴 즉시 차단
  // 키 발급 시점에는 멤버였더라도 운영 중 변경되면 그 시점부터 거부.
  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: mcpKey.prjct_id, mber_id: mcpKey.mber_id } },
    select: { mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError(
      "FORBIDDEN_MEMBERSHIP",
      "이 키의 소유자는 해당 프로젝트의 활성 멤버가 아닙니다.",
      403,
    );
  }

  // 5. 프로젝트명 조회 (응답 meta.auth 표시용)
  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: mcpKey.prjct_id },
    select: { prjct_nm: true },
  });

  // 6. last_used_dt 비동기 갱신 — 응답 지연 없이 fire-and-forget
  // 실패해도 무시(키 사용 추적이 끊겨도 본 요청 처리에는 지장 없음).
  prisma.tbCmMcpKey.update({
    where: { api_key_id: mcpKey.api_key_id },
    data:  { last_used_dt: new Date() },
  }).catch(() => {});

  return {
    mberId:     mcpKey.member.mber_id,
    mberNm:     mcpKey.member.mber_nm,
    email:      mcpKey.member.email_addr,
    prjctId:    mcpKey.prjct_id,
    prjctNm:    project?.prjct_nm ?? null,
    keyName:    mcpKey.key_nm,
    apiKeyId:   mcpKey.api_key_id,
    lastUsedAt: mcpKey.last_used_dt,
  };
}

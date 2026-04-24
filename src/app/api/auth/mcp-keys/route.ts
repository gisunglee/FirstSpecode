/**
 * GET  /api/auth/mcp-keys — MCP 키 목록 조회
 * POST /api/auth/mcp-keys — MCP 키 생성
 *
 * 역할:
 *   - 로그인한 사용자의 MCP 인증 키(spk_...) 관리
 *   - 생성 시 원문(rawKey)은 응답에서 1회만 반환 (이후 조회 불가 — SHA-256 해시로 저장)
 *   - 목록에서는 prefix(앞 12자)만 표시
 *   - prjctId 지정 시 해당 프로젝트로 scope 고정 (다른 프로젝트 접근 시 403)
 *
 * 제한:
 *   - 사용자당 활성 키 최대 10개
 *
 * 과거 경로: /api/auth/api-keys (2026-04-24 mcp-keys로 rename — 용도 명확화)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { generateApiKey, hashApiKey, getApiKeyPrefix } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { MCP_KEY_GLOBAL_SCOPE, isGlobalMcpKey } from "@/lib/mcpKeyScope";

// 사용자당 활성 MCP 키 최대 개수
const MAX_MCP_KEYS_PER_USER = 10;

// ─── GET: MCP 키 목록 조회 ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const keys = await prisma.tbCmMcpKey.findMany({
      where: { mber_id: auth.mberId, revoke_dt: null },
      orderBy: { creat_dt: "desc" },
      select: {
        api_key_id:   true,
        key_prefix:   true,
        key_nm:       true,
        prjct_id:     true,
        creat_dt:     true,
        last_used_dt: true,
      },
    });

    // 프로젝트명 manual join — FK가 없어서 include 불가('ALL' sentinel 때문)
    //   scope 키의 prjct_id UUID만 수집해 한 번의 쿼리로 조회 → 맵 룩업
    const scopedPrjctIds = Array.from(
      new Set(keys.filter((k) => !isGlobalMcpKey(k.prjct_id)).map((k) => k.prjct_id))
    );
    const projectNameMap = new Map<string, string>();
    if (scopedPrjctIds.length > 0) {
      const projects = await prisma.tbPjProject.findMany({
        where:  { prjct_id: { in: scopedPrjctIds } },
        select: { prjct_id: true, prjct_nm: true },
      });
      for (const p of projects) projectNameMap.set(p.prjct_id, p.prjct_nm);
    }

    const items = keys.map((k) => {
      const global = isGlobalMcpKey(k.prjct_id);
      return {
        apiKeyId:   k.api_key_id,
        keyPrefix:  k.key_prefix,
        keyName:    k.key_nm,
        // UI 호환: 전역이면 null (기존 UI가 prjctId null 체크로 배지 분기)
        prjctId:    global ? null : k.prjct_id,
        prjctNm:    global ? null : projectNameMap.get(k.prjct_id) ?? null,
        createdAt:  k.creat_dt,
        lastUsedAt: k.last_used_dt,
      };
    });

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/auth/mcp-keys] DB 오류:", err);
    return apiError("DB_ERROR", "MCP 키 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: MCP 키 생성 ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { keyName, prjctId } = body as { keyName?: string; prjctId?: string };

  // ── 키 이름 검증 ───────────────────────────────────────────────
  if (!keyName?.trim()) {
    return apiError("VALIDATION_ERROR", "키 이름을 입력해 주세요.", 400);
  }
  if (keyName.trim().length > 100) {
    return apiError("VALIDATION_ERROR", "키 이름은 100자 이하여야 합니다.", 400);
  }

  // ── 프로젝트 scope 요청 시 멤버십 검증 ─────────────────────────
  // 비멤버 프로젝트로 scope 고정 시도 차단 (보안: 발급 시점에 원천 차단)
  if (prjctId) {
    const membership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: prjctId, mber_id: auth.mberId } },
      select: { mber_sttus_code: true },
    });
    if (!membership || membership.mber_sttus_code !== "ACTIVE") {
      return apiError(
        "FORBIDDEN",
        "해당 프로젝트의 활성 멤버가 아닙니다.",
        403
      );
    }
  }

  try {
    // ── 활성 키 개수 제한 확인 ───────────────────────────────────
    const activeCount = await prisma.tbCmMcpKey.count({
      where: { mber_id: auth.mberId, revoke_dt: null },
    });
    if (activeCount >= MAX_MCP_KEYS_PER_USER) {
      return apiError(
        "LIMIT_EXCEEDED",
        `MCP 키는 최대 ${MAX_MCP_KEYS_PER_USER}개까지 생성할 수 있습니다. 기존 키를 폐기한 후 다시 시도해 주세요.`,
        400
      );
    }

    // ── 키 생성 (원문은 응답에만, DB엔 해시만) ────────────────────
    const rawKey    = generateApiKey();
    const keyHash   = hashApiKey(rawKey);
    const keyPrefix = getApiKeyPrefix(rawKey);

    // fail-secure: prjctId 미지정 시 명시적 sentinel('ALL')로 저장. null 금지.
    const scopeValue = prjctId ?? MCP_KEY_GLOBAL_SCOPE;

    const created = await prisma.tbCmMcpKey.create({
      data: {
        mber_id:    auth.mberId,
        prjct_id:   scopeValue,
        key_hash:   keyHash,
        key_prefix: keyPrefix,
        key_nm:     keyName.trim(),
      },
    });

    // 프로젝트명 조회 (scope 키인 경우만)
    const prjctNm = isGlobalMcpKey(created.prjct_id)
      ? null
      : (await prisma.tbPjProject.findUnique({
          where:  { prjct_id: created.prjct_id },
          select: { prjct_nm: true },
        }))?.prjct_nm ?? null;

    // rawKey는 이 응답에서만 1회 반환 — 이후 조회 불가
    return apiSuccess(
      {
        apiKeyId: created.api_key_id,
        keyName:  created.key_nm,
        keyPrefix,
        rawKey,
        // UI 호환: 전역이면 null
        prjctId:  isGlobalMcpKey(created.prjct_id) ? null : created.prjct_id,
        prjctNm,
      },
      201
    );
  } catch (err) {
    console.error("[POST /api/auth/mcp-keys] DB 오류:", err);
    return apiError("DB_ERROR", "MCP 키 생성에 실패했습니다.", 500);
  }
}

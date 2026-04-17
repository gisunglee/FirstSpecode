/**
 * GET  /api/auth/api-keys — API 키 목록 조회
 * POST /api/auth/api-keys — API 키 생성
 *
 * 역할:
 *   - 로그인한 사용자의 API 키를 관리
 *   - 생성 시 원문(rawKey)은 응답에서 1회만 반환 (이후 조회 불가)
 *   - 목록에서는 prefix(앞 12자)만 표시
 *
 * 제한:
 *   - 사용자당 활성 키 최대 10개
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { generateApiKey, hashApiKey, getApiKeyPrefix } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// 사용자당 활성 API 키 최대 개수
const MAX_API_KEYS_PER_USER = 10;

// ─── GET: API 키 목록 조회 ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const keys = await prisma.tbCmApiKey.findMany({
      where: { mber_id: auth.mberId, revoke_dt: null },
      orderBy: { creat_dt: "desc" },
      select: {
        api_key_id: true,
        key_prefix: true,
        key_nm: true,
        creat_dt: true,
        last_used_dt: true,
      },
    });

    const items = keys.map((k) => ({
      apiKeyId: k.api_key_id,
      keyPrefix: k.key_prefix,
      keyName: k.key_nm,
      createdAt: k.creat_dt,
      lastUsedAt: k.last_used_dt,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/auth/api-keys] DB 오류:", err);
    return apiError("DB_ERROR", "API 키 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: API 키 생성 ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { keyName } = body as { keyName?: string };

  if (!keyName?.trim()) {
    return apiError("VALIDATION_ERROR", "키 이름을 입력해 주세요.", 400);
  }
  if (keyName.trim().length > 100) {
    return apiError("VALIDATION_ERROR", "키 이름은 100자 이하여야 합니다.", 400);
  }

  try {
    // 활성 키 개수 제한 확인
    const activeCount = await prisma.tbCmApiKey.count({
      where: { mber_id: auth.mberId, revoke_dt: null },
    });
    if (activeCount >= MAX_API_KEYS_PER_USER) {
      return apiError(
        "LIMIT_EXCEEDED",
        `API 키는 최대 ${MAX_API_KEYS_PER_USER}개까지 생성할 수 있습니다. 기존 키를 폐기한 후 다시 시도해 주세요.`,
        400
      );
    }

    // API 키 생성
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getApiKeyPrefix(rawKey);

    const created = await prisma.tbCmApiKey.create({
      data: {
        mber_id: auth.mberId,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        key_nm: keyName.trim(),
      },
    });

    // rawKey는 이 응답에서만 1회 반환 — 이후 조회 불가
    return apiSuccess(
      {
        apiKeyId: created.api_key_id,
        keyName: created.key_nm,
        keyPrefix,
        rawKey,
      },
      201
    );
  } catch (err) {
    console.error("[POST /api/auth/api-keys] DB 오류:", err);
    return apiError("DB_ERROR", "API 키 생성에 실패했습니다.", 500);
  }
}

/**
 * idPrefix.ts — 표시 ID prefix 조회 헬퍼
 *
 * 역할:
 *   - 요구사항/스토리/과업/단위업무/화면/영역/기능 의 displayId 채번 시
 *     사용할 prefix 를 프로젝트 환경설정(tb_pj_project_config)에서 조회.
 *   - 미설정 시(레거시 프로젝트, 마이그레이션 누락 등) 하드코딩 fallback 사용.
 *
 * 사용 예:
 *   const prefix = await getIdPrefix(projectId, "REQUIREMENT");
 *   const displayId = `${prefix}-${String(seq).padStart(5, "0")}`;
 *
 * 성능:
 *   - bulk-import 처럼 같은 요청 안에서 여러 prefix 를 반복 조회하는 경우를
 *     대비해 요청 단위 메모이제이션을 제공한다(`createIdPrefixCache`).
 *   - 일반 API(단건 채번)에서는 캐시 없이 `getIdPrefix` 만 호출해도 충분.
 */

import { prisma } from "@/lib/prisma";

// ── 엔티티 종류 — 환경설정 키와 1:1 매핑 ─────────────────────────────────────
export type EntityKind =
  | "REQUIREMENT"
  | "USER_STORY"
  | "TASK"
  | "UNIT_WORK"
  | "SCREEN"
  | "AREA"
  | "FUNCTION";

// 엔티티 → 환경설정 키
const CONFIG_KEY: Record<EntityKind, string> = {
  REQUIREMENT: "PREFIX_REQUIREMENT",
  USER_STORY:  "PREFIX_USER_STORY",
  TASK:        "PREFIX_TASK",
  UNIT_WORK:   "PREFIX_UNIT_WORK",
  SCREEN:      "PREFIX_SCREEN",
  AREA:        "PREFIX_AREA",
  FUNCTION:    "PREFIX_FUNCTION",
};

// 환경설정 누락 시 사용할 fallback — 기존 하드코딩 prefix 와 동일하게 유지
// 마이그레이션이 누락된 레거시 프로젝트에서도 기존 동작이 그대로 보장된다.
const FALLBACK_PREFIX: Record<EntityKind, string> = {
  REQUIREMENT: "REQ",
  USER_STORY:  "STR",
  TASK:        "SFR",
  UNIT_WORK:   "UW",
  SCREEN:      "SCR",
  AREA:        "AR",
  FUNCTION:    "FN",
};

/**
 * 단건 prefix 조회 — 일반 API 라우트에서 사용.
 *
 * 동작:
 *   1) tb_pj_project_config 에서 (prjct_id, config_key) 로 조회
 *   2) config_value 가 비어 있지 않으면 그대로 반환 (trim)
 *   3) 없거나 비어 있으면 FALLBACK_PREFIX 반환
 */
export async function getIdPrefix(
  projectId: string,
  kind: EntityKind,
): Promise<string> {
  const cfg = await prisma.tbPjProjectConfig.findUnique({
    where: {
      prjct_id_config_key: {
        prjct_id:   projectId,
        config_key: CONFIG_KEY[kind],
      },
    },
    select: { config_value: true },
  });
  const value = cfg?.config_value?.trim();
  return value || FALLBACK_PREFIX[kind];
}

/**
 * 요청 단위 캐시 — bulk-import 처럼 같은 prefix 를 반복 조회하는 경우 사용.
 *
 * 사용 예:
 *   const cache = createIdPrefixCache(projectId);
 *   const reqPrefix = await cache.get("REQUIREMENT");
 *   const strPrefix = await cache.get("USER_STORY");
 *   // 두 번째 호출부터는 DB 조회 없이 메모리에서 반환
 */
export function createIdPrefixCache(projectId: string) {
  const memo = new Map<EntityKind, string>();
  return {
    async get(kind: EntityKind): Promise<string> {
      const cached = memo.get(kind);
      if (cached !== undefined) return cached;
      const value = await getIdPrefix(projectId, kind);
      memo.set(kind, value);
      return value;
    },
  };
}

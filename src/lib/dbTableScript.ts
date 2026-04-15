/**
 * dbTableScript — DB 테이블 정보를 AI 프롬프트용 마크다운으로 직렬화
 *
 * 역할:
 *   - 프로젝트 등록 테이블(tb_ds_db_table)을 조회해서 마크다운으로 반환
 *   - 모드별 컨텍스트 길이 조절 (brief / full)
 *   - <TABLE_SCRIPT:tb_xxx> 플레이스홀더를 일괄 치환하는 헬퍼 제공
 *
 * 사용처:
 *   - GET /api/projects/[id]/db-tables/info — 외부 노출
 *   - 구현요청 build API — 프롬프트 내 플레이스홀더 자동 치환
 */

import { prisma } from "@/lib/prisma";

export type TableScriptMode = "brief" | "full";

/**
 * 단일 테이블을 마크다운으로 직렬화
 *
 * brief: 테이블명/논리명/설명 1~2줄 + 컬럼명·논리명만 콤마 나열
 * full:  테이블명/논리명/설명 + 컬럼표(컬럼명, 속성명, 타입, 설명)
 *
 * @param projectId 프로젝트 ID
 * @param tableName 테이블 물리명 (대소문자 무시)
 * @param mode      brief | full
 * @returns 마크다운 문자열 (테이블 미등록 시 null)
 */
export async function buildTableScript(
  projectId: string,
  tableName: string,
  mode: TableScriptMode
): Promise<string | null> {
  // 대소문자 무시 매칭 (PostgreSQL ILIKE 대신 mode: insensitive)
  const table = await prisma.tbDsDbTable.findFirst({
    where: {
      prjct_id: projectId,
      tbl_physcl_nm: { equals: tableName, mode: "insensitive" },
    },
    include: { columns: { orderBy: { sort_ordr: "asc" } } },
  });

  if (!table) return null;

  const lines: string[] = [];
  const physcl = table.tbl_physcl_nm;
  const lgcl = (table.tbl_lgcl_nm ?? "").trim();
  const dc = (table.tbl_dc ?? "").trim();

  // 헤더 — 두 모드 공통
  lines.push(`**[${physcl}]${lgcl ? ` ${lgcl}` : ""}**`);
  if (dc) lines.push(dc);

  if (table.columns.length === 0) {
    lines.push("(컬럼 정보 없음)");
    return lines.join("\n");
  }

  if (mode === "brief") {
    // 컬럼명(속성명) 콤마 나열
    const colList = table.columns
      .map((c) => {
        const lgcl = (c.col_lgcl_nm ?? "").trim();
        return lgcl ? `${c.col_physcl_nm}(${lgcl})` : c.col_physcl_nm;
      })
      .join(", ");
    lines.push(`컬럼: ${colList}`);
  } else {
    // full: 표 형식
    lines.push("");
    lines.push("| 컬럼 | 속성명 | 타입 | 설명 |");
    lines.push("|------|--------|------|------|");
    for (const c of table.columns) {
      const lgcl = (c.col_lgcl_nm ?? "").trim() || "—";
      const ty = (c.data_ty_nm ?? "").trim() || "—";
      const dc = (c.col_dc ?? "").trim().replace(/\|/g, "\\|") || "—";
      lines.push(`| ${c.col_physcl_nm} | ${lgcl} | ${ty} | ${dc} |`);
    }
  }

  return lines.join("\n");
}

// ── 플레이스홀더 치환 ────────────────────────────────────────────────────────

/** <TABLE_SCRIPT:xxx> 형식 매칭 */
const TABLE_SCRIPT_RE = /<TABLE_SCRIPT:([^>]+)>/g;

/**
 * diff 블록 내 "삭제된 라인"인지 판정.
 *
 * 이유: DIFF 모드 렌더링 시 삭제된 라인은 `- [삭제]` prefix로 표시되어 AI에게
 *       "이전에는 있었던 내용"을 보여준다. 해당 라인의 플레이스홀더는 현재 문서에
 *       존재하지 않으므로 치환/경고 대상에서 제외해야 한다.
 */
function isDeletedDiffLine(line: string): boolean {
  return line.startsWith("- [삭제]");
}

/** 텍스트 내에 치환 필요한(= 삭제 라인 제외) TABLE_SCRIPT 플레이스홀더가 있는지 */
export function hasActiveTableScript(md: string): boolean {
  // 전역 플래그 regex의 lastIndex 상태 문제 회피: 매 호출마다 새 regex 생성
  const re = /<TABLE_SCRIPT:[^>]+>/;
  return md.split("\n").some((line) => !isDeletedDiffLine(line) && re.test(line));
}

/**
 * 마크다운 텍스트 내 모든 <TABLE_SCRIPT:tb_xxx> 플레이스홀더를
 * buildTableScript 결과로 일괄 치환한다.
 *
 * 동작:
 *   - 등록된 테이블 → 마크다운으로 치환
 *   - 미등록 테이블 → 원본 플레이스홀더 그대로 유지 (변경 없음)
 *   - 동일 테이블이 여러 번 나오면 캐싱하여 1회만 조회
 *
 * @param projectId 프로젝트 ID
 * @param md        원본 마크다운
 * @param mode      brief | full
 * @returns 치환된 마크다운
 */
export async function expandTableScripts(
  projectId: string,
  md: string,
  mode: TableScriptMode
): Promise<string> {
  // 라인 단위 처리 — 삭제 라인(`- [삭제]`)은 과거 기록이므로 치환 제외
  const lines = md.split("\n");

  // 치환 대상 라인에서만 테이블명 수집 (중복 제거)
  const names = new Set<string>();
  for (const line of lines) {
    if (isDeletedDiffLine(line)) continue;
    for (const m of line.matchAll(TABLE_SCRIPT_RE)) {
      names.add(m[1].trim());
    }
  }
  if (names.size === 0) return md;

  // 병렬 조회 + 캐시 맵 구성 (대소문자 정규화 키)
  const cache = new Map<string, string>();
  await Promise.all(
    [...names].map(async (name) => {
      const built = await buildTableScript(projectId, name, mode);
      if (built !== null) cache.set(name.toLowerCase(), built);
    })
  );

  // 라인 단위 치환 — 삭제 라인은 그대로, 그 외는 캐시 적용 (미등록은 원본 유지)
  return lines
    .map((line) => {
      if (isDeletedDiffLine(line)) return line;
      return line.replace(TABLE_SCRIPT_RE, (orig, name: string) => {
        const hit = cache.get(name.trim().toLowerCase());
        return hit ?? orig;
      });
    })
    .join("\n");
}

/**
 * GET /api/projects/[id]/settings/artifact-meta — 산출물별 문서 메타 오버라이드 조회
 * PUT /api/projects/[id]/settings/artifact-meta — 산출물별 문서 메타 오버라이드 저장
 *
 * 역할:
 *   - 산출물 종류별 단계/활동/작업/문서코드 의 "프로젝트 오버라이드" 를 관리한다.
 *   - 기본값은 카탈로그(doc-meta-catalog.ts). 방법론이 다른 프로젝트만 여기서 덮어씀.
 *   - 저장 형태: tb_pj_project_settings.artifact_meta_json
 *       { "TASK_MATRIX": { phase, activity, work, docCode }, ... }
 *     비어 있는 필드/키는 저장하지 않음 → 해석 시 카탈로그 기본값으로 fallback.
 *
 * 권한: project.settings (OWNER/ADMIN). 지원 세션은 PUT 자동 차단.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DOC_META_CATALOG, type DocMetaKey } from "@/lib/exports/doc-meta-catalog";

type RouteParams = { params: Promise<{ id: string }> };

// 메타 한 필드 최대 길이 (단계/활동/작업/문서코드)
const MAX_META_FIELD_LEN = 50;

// 카탈로그에 정의된 유효한 문서 key 집합 — 알 수 없는 key 는 저장 거부(무시)
const VALID_KEYS = new Set<string>(DOC_META_CATALOG.map((d) => d.key));

// 오버라이드 한 건의 필드
type MetaOverride = { phase?: string; activity?: string; work?: string; docCode?: string };
type OverrideMap  = Partial<Record<DocMetaKey, MetaOverride>>;

// ─── GET ────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "project.settings");
  if (gate instanceof Response) return gate;

  try {
    const settings = await prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: { artifact_meta_json: true },
    });
    // 저장된 오버라이드 그대로 반환 (없으면 빈 객체). UI 가 카탈로그 기본값과 머지해 표시.
    const overrides = (settings?.artifact_meta_json ?? {}) as OverrideMap;
    return apiSuccess({ overrides });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/settings/artifact-meta] DB 오류:`, err);
    return apiError("DB_ERROR", "산출물 메타 조회에 실패했습니다.", 500);
  }
}

// ─── PUT ────────────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "project.settings");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const rawOverrides = (body as { overrides?: unknown })?.overrides;
  if (rawOverrides !== undefined && (typeof rawOverrides !== "object" || rawOverrides === null)) {
    return apiError("VALIDATION_ERROR", "overrides 형식이 올바르지 않습니다.", 400);
  }

  // ── 정규화 — 유효 key + 비어있지 않은 필드만 추림, 길이 검증 ──
  const clean: OverrideMap = {};
  const FIELD_LABELS: Record<keyof MetaOverride, string> = {
    phase: "단계", activity: "활동", work: "작업", docCode: "문서코드",
  };
  for (const [key, val] of Object.entries((rawOverrides ?? {}) as Record<string, unknown>)) {
    if (!VALID_KEYS.has(key)) continue;                 // 알 수 없는 산출물 → 무시
    if (typeof val !== "object" || val === null) continue;

    const entry: MetaOverride = {};
    for (const field of ["phase", "activity", "work", "docCode"] as (keyof MetaOverride)[]) {
      const raw = (val as Record<string, unknown>)[field];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;                            // 빈 필드 → 저장 안 함(카탈로그 fallback)
      if (trimmed.length > MAX_META_FIELD_LEN) {
        return apiError("VALIDATION_ERROR", `${FIELD_LABELS[field]}은(는) ${MAX_META_FIELD_LEN}자 이내로 입력해 주세요.`, 400);
      }
      entry[field] = trimmed;
    }
    // 필드가 하나라도 있으면 채택
    if (Object.keys(entry).length > 0) clean[key as DocMetaKey] = entry;
  }

  const hasAny = Object.keys(clean).length > 0;

  try {
    const current = await prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: { artifact_meta_json: true },
    });
    if (!current) {
      return apiError("NOT_FOUND", "프로젝트 설정이 존재하지 않습니다.", 404);
    }

    // 변경 여부 — JSON 직렬화 비교 (키 순서 영향 최소화 위해 단순 비교)
    const beforeJson = JSON.stringify(current.artifact_meta_json ?? {});
    const afterJson  = JSON.stringify(clean);
    const changed    = beforeJson !== afterJson;

    await prisma.$transaction(async (tx) => {
      await tx.tbPjProjectSettings.update({
        where: { prjct_id: projectId },
        data: {
          // 오버라이드가 하나도 없으면 컬럼을 NULL 로 (카탈로그 기본값만 사용)
          artifact_meta_json: hasAny ? (clean as Prisma.InputJsonValue) : Prisma.DbNull,
          mdfcn_dt:           new Date(),
        },
      });

      // 변경이력 — 상세 diff 대신 "변경됨" 한 줄 (JSON 이라 before/after 전문은 과함)
      if (changed) {
        await tx.tbPjSettingsHistory.create({
          data: {
            prjct_id:    projectId,
            chg_mber_id: gate.mberId,
            chg_item_nm: "산출물 문서 메타",
            bfr_val_cn:  `${Object.keys(JSON.parse(beforeJson)).length}개 산출물`,
            aftr_val_cn: `${Object.keys(clean).length}개 산출물`,
          },
        });
      }
    });

    return apiSuccess({ overrides: clean });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/settings/artifact-meta] DB 오류:`, err);
    return apiError("DB_ERROR", "산출물 메타 저장 중 오류가 발생했습니다.", 500);
  }
}

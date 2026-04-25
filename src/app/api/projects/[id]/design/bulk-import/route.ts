/**
 * POST /api/projects/[id]/design/bulk-import — 설계 데이터 일괄 등록/수정
 *
 * 역할:
 *   - Claude에서 설계한 단위업무·화면·영역·기능을 JSON으로 한 번에 등록
 *   - systemId 있음 → UUID로 조회 후 UPDATE
 *   - systemId 없음 → 신규 CREATE (displayId 자동 채번)
 *   - requirementId는 선택 (req_id nullable) — 있으면 연결, 없으면 null
 *
 * Request Body:
 *   {
 *     unitWorks: [
 *       {
 *         systemId?: string,        // 수정 시 단위업무 UUID. 없으면 신규
 *         requirementId?: string,   // 연결할 요구사항 UUID. 없으면 null (선택)
 *         name: string,
 *         description?: string,
 *         screens: [
 *           {
 *             systemId?: string,
 *             name: string,
 *             displayCode?: string,
 *             screenType?: string,  // LIST | DETAIL | GRID | TAB | FULL_SCREEN
 *             categoryL?: string,
 *             categoryM?: string,
 *             categoryS?: string,
 *             description?: string,
 *             areas: [
 *               {
 *                 systemId?: string,
 *                 name: string,
 *                 areaType?: string,
 *                 description?: string,
 *                 functions: [
 *                   {
 *                     systemId?: string,
 *                     name: string,
 *                     description?: string,
 *                     priority?: string,   // HIGH | MEDIUM | LOW
 *                     complexity?: string, // HIGH | MEDIUM | LOW
 *                   }
 *                 ]
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// Prisma 인터랙티브 트랜잭션 클라이언트 타입
// 채번 헬퍼에 tx를 넘겨야 트랜잭션 내 미커밋 데이터를 읽을 수 있음
// (전역 prisma 사용 시 동일 임포트에서 신규 항목 2개 이상이면 중복 displayId 발생)
type TxClient = Prisma.TransactionClient;

type RouteParams = { params: Promise<{ id: string }> };

// ── 코드 화이트리스트 ────────────────────────────────────────────────────────
// [2026-04-25] D5: 단일 CRUD UI(screens/[screenId]/page.tsx, areas/[areaId]/page.tsx,
//                   functions/[functionId]/page.tsx)와 동일한 허용값.
//                   변경 시 두 곳 동시 수정 필요.
//                   Claude 출력 또는 사용자가 직접 수정한 JSON에 잘못된 값이 들어와도
//                   DB에 저장되어 UI 라벨/배지 매칭이 깨지는 사고를 막기 위한 안전망.
const ALLOWED_SCREEN_TYPES   = ["LIST", "DETAIL", "INPUT", "POPUP", "TAB", "REPORT"]                                  as const;
const ALLOWED_AREA_TYPES     = ["SEARCH", "GRID", "FORM", "INFO_CARD", "TAB", "FULL_SCREEN"]                          as const;
const ALLOWED_FUNCTION_TYPES = ["SEARCH", "SAVE", "DELETE", "DOWNLOAD", "UPLOAD", "NAVIGATE", "VALIDATE", "OTHER"]    as const;
const ALLOWED_PRIORITIES     = ["HIGH", "MEDIUM", "LOW"]                                                              as const;
const ALLOWED_COMPLEXITIES   = ["HIGH", "MEDIUM", "LOW"]                                                              as const;

function pickAllowed(
  value:    string | undefined | null,
  allowed:  readonly string[],
  fallback: string,
): string {
  // value가 화이트리스트에 있으면 그대로, 아니면 fallback.
  //   - 신규: fallback = 안전한 default (예: "LIST", "GRID", "OTHER", "MEDIUM")
  //   - 수정: fallback = existing 컬럼 값 (이미 DB에 저장된 값을 흔들지 않음)
  return value && allowed.includes(value) ? value : fallback;
}

// ── 입력 타입 ────────────────────────────────────────────────────────────────

type FunctionInput = {
  systemId?:     string;
  name:          string;
  description?:  string;
  functionType?: string;   // [2026-04-25] D3: 기능 유형 (SEARCH/SAVE/DELETE 등)
  priority?:     string;
  complexity?:   string;
};

type AreaInput = {
  systemId?:    string;
  name:         string;
  areaType?:    string;
  description?: string;
  functions?:   FunctionInput[];
};

type ScreenInput = {
  systemId?:    string;
  name:         string;
  displayCode?: string;
  screenType?:  string;
  categoryL?:   string;
  categoryM?:   string;
  categoryS?:   string;
  description?: string;
  areas?:       AreaInput[];
};

type UnitWorkInput = {
  systemId?:       string;
  requirementId?:  string;
  name:            string;
  description?:    string;
  screens?:        ScreenInput[];
};

// ── displayId 채번 헬퍼 ──────────────────────────────────────────────────────
// 반드시 트랜잭션 클라이언트(tx)를 받아서 호출해야 함
// → 동일 트랜잭션 내 미커밋 INSERT를 읽어야 중복 displayId를 막을 수 있음

async function nextUnitWorkDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbDsUnitWork.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { unit_work_display_id: "desc" },
    select:  { unit_work_display_id: true },
  });
  const seq = max ? (parseInt(max.unit_work_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `UW-${String(seq).padStart(5, "0")}`;
}

async function nextScreenDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbDsScreen.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { scrn_display_id: "desc" },
    select:  { scrn_display_id: true },
  });
  const seq = max ? (parseInt(max.scrn_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `SCR-${String(seq).padStart(5, "0")}`;
}

async function nextAreaDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbDsArea.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { area_display_id: "desc" },
    select:  { area_display_id: true },
  });
  const seq = max ? (parseInt(max.area_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `AR-${String(seq).padStart(5, "0")}`;
}

async function nextFunctionDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbDsFunction.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { func_display_id: "desc" },
    select:  { func_display_id: true },
  });
  const seq = max ? (parseInt(max.func_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `FN-${String(seq).padStart(5, "0")}`;
}

// 프로젝트 내 최대 sort_ordr + 1
// reqId가 null이면 프로젝트 전체 기준으로 순서 계산 (req_id nullable 대응)
async function nextUnitWorkSortOrder(projectId: string, reqId: string | null, tx: TxClient): Promise<number> {
  const max = await tx.tbDsUnitWork.findFirst({
    where:   reqId ? { prjct_id: projectId, req_id: reqId } : { prjct_id: projectId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

async function nextScreenSortOrder(projectId: string, tx: TxClient): Promise<number> {
  const max = await tx.tbDsScreen.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

async function nextAreaSortOrder(projectId: string, tx: TxClient): Promise<number> {
  const max = await tx.tbDsArea.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

async function nextFunctionSortOrder(projectId: string, tx: TxClient): Promise<number> {
  const max = await tx.tbDsFunction.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

// ── POST 핸들러 ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { unitWorks } = body as { unitWorks?: UnitWorkInput[] };
  if (!Array.isArray(unitWorks) || unitWorks.length === 0) {
    return apiError("VALIDATION_ERROR", "unitWorks 배열이 비어 있습니다.", 400);
  }

  const result = {
    created: { unitWorks: 0, screens: 0, areas: 0, functions: 0 },
    updated: { unitWorks: 0, screens: 0, areas: 0, functions: 0 },
    skipped: { unitWorks: 0, screens: 0, areas: 0, functions: 0 },
  };

  try {
    await prisma.$transaction(async (tx) => {
      for (const uwInput of unitWorks) {
        if (!uwInput.name?.trim()) continue;

        let unitWorkId: string;

        if (uwInput.systemId) {
          // ── 단위업무 수정 ────────────────────────────────────────────────
          const existing = await tx.tbDsUnitWork.findUnique({
            where: { unit_work_id: uwInput.systemId },
          });
          if (!existing || existing.prjct_id !== projectId) {
            result.skipped.unitWorks++;
            continue;
          }
          await tx.tbDsUnitWork.update({
            where: { unit_work_id: uwInput.systemId },
            data: {
              unit_work_nm: uwInput.name.trim(),
              unit_work_dc: uwInput.description?.trim() ?? existing.unit_work_dc,
              mdfcn_dt:     new Date(),
            },
          });
          unitWorkId = uwInput.systemId;
          result.updated.unitWorks++;
        } else {
          // ── 단위업무 신규 등록 ───────────────────────────────────────────
          // TbDsUnitWork.req_id 는 non-null → 유효한 요구사항이 없으면 skip
          let resolvedReqId: string | null = null;
          if (uwInput.requirementId) {
            const req = await tx.tbRqRequirement.findUnique({
              where: { req_id: uwInput.requirementId },
            });
            // 요구사항이 존재하지 않거나 다른 프로젝트 소속이면 null (보안)
            resolvedReqId = req?.prjct_id === projectId ? uwInput.requirementId : null;
          }
          if (!resolvedReqId) {
            result.skipped.unitWorks++;
            continue;
          }
          const displayId  = await nextUnitWorkDisplayId(projectId, tx);
          const sortOrder  = await nextUnitWorkSortOrder(projectId, resolvedReqId, tx);
          const created    = await tx.tbDsUnitWork.create({
            data: {
              prjct_id:            projectId,
              req_id:              resolvedReqId,
              unit_work_display_id: displayId,
              unit_work_nm:        uwInput.name.trim(),
              unit_work_dc:        uwInput.description?.trim() || null,
              sort_ordr:           sortOrder,
            },
          });
          unitWorkId = created.unit_work_id;
          result.created.unitWorks++;
        }

        // ── 화면 처리 ──────────────────────────────────────────────────────
        for (const scInput of uwInput.screens ?? []) {
          if (!scInput.name?.trim()) continue;

          let screenId: string;

          if (scInput.systemId) {
            const existing = await tx.tbDsScreen.findUnique({
              where: { scrn_id: scInput.systemId },
            });
            if (!existing || existing.prjct_id !== projectId) {
              result.skipped.screens++;
              continue;
            }
            await tx.tbDsScreen.update({
              where: { scrn_id: scInput.systemId },
              data: {
                unit_work_id: unitWorkId,
                scrn_nm:      scInput.name.trim(),
                scrn_dc:      scInput.description?.trim() ?? existing.scrn_dc,
                // [2026-04-25] D5: 화이트리스트 미통과 시 기존 값 유지 (UI 라벨 매칭 보호)
                scrn_ty_code: pickAllowed(scInput.screenType, ALLOWED_SCREEN_TYPES, existing.scrn_ty_code),
                dsply_code:   scInput.displayCode?.trim() ?? existing.dsply_code,
                ctgry_l_nm:   scInput.categoryL?.trim()  ?? existing.ctgry_l_nm,
                ctgry_m_nm:   scInput.categoryM?.trim()  ?? existing.ctgry_m_nm,
                ctgry_s_nm:   scInput.categoryS?.trim()  ?? existing.ctgry_s_nm,
                mdfcn_dt:     new Date(),
              },
            });
            screenId = scInput.systemId;
            result.updated.screens++;
          } else {
            const displayId = await nextScreenDisplayId(projectId, tx);
            const sortOrder = await nextScreenSortOrder(projectId, tx);
            const created   = await tx.tbDsScreen.create({
              data: {
                prjct_id:       projectId,
                unit_work_id:   unitWorkId,
                scrn_display_id: displayId,
                scrn_nm:        scInput.name.trim(),
                scrn_dc:        scInput.description?.trim()  || null,
                // [2026-04-25] D5: 화이트리스트 미통과 시 default "LIST"
                scrn_ty_code:   pickAllowed(scInput.screenType, ALLOWED_SCREEN_TYPES, "LIST"),
                dsply_code:     scInput.displayCode?.trim()  || null,
                ctgry_l_nm:     scInput.categoryL?.trim()    || null,
                ctgry_m_nm:     scInput.categoryM?.trim()    || null,
                ctgry_s_nm:     scInput.categoryS?.trim()    || null,
                sort_ordr:      sortOrder,
              },
            });
            screenId = created.scrn_id;
            result.created.screens++;
          }

          // ── 영역 처리 ──────────────────────────────────────────────────
          for (const arInput of scInput.areas ?? []) {
            if (!arInput.name?.trim()) continue;

            let areaId: string;

            if (arInput.systemId) {
              const existing = await tx.tbDsArea.findUnique({
                where: { area_id: arInput.systemId },
              });
              if (!existing || existing.prjct_id !== projectId) {
                result.skipped.areas++;
                continue;
              }
              await tx.tbDsArea.update({
                where: { area_id: arInput.systemId },
                data: {
                  scrn_id:      screenId,
                  area_nm:      arInput.name.trim(),
                  area_dc:      arInput.description?.trim() ?? existing.area_dc,
                  // [2026-04-25] D5: 화이트리스트 미통과 시 기존 값 유지
                  area_ty_code: pickAllowed(arInput.areaType, ALLOWED_AREA_TYPES, existing.area_ty_code),
                  mdfcn_dt:     new Date(),
                },
              });
              areaId = arInput.systemId;
              result.updated.areas++;
            } else {
              const displayId = await nextAreaDisplayId(projectId, tx);
              const sortOrder = await nextAreaSortOrder(projectId, tx);
              const created   = await tx.tbDsArea.create({
                data: {
                  prjct_id:       projectId,
                  scrn_id:        screenId,
                  area_display_id: displayId,
                  area_nm:        arInput.name.trim(),
                  area_dc:        arInput.description?.trim() || null,
                  // [2026-04-25] D5: 화이트리스트 미통과 시 default "GRID"
                  area_ty_code:   pickAllowed(arInput.areaType, ALLOWED_AREA_TYPES, "GRID"),
                  sort_ordr:      sortOrder,
                },
              });
              areaId = created.area_id;
              result.created.areas++;
            }

            // ── 기능 처리 ────────────────────────────────────────────────
            for (const fnInput of arInput.functions ?? []) {
              if (!fnInput.name?.trim()) continue;

              if (fnInput.systemId) {
                const existing = await tx.tbDsFunction.findUnique({
                  where: { func_id: fnInput.systemId },
                });
                if (!existing || existing.prjct_id !== projectId) {
                  result.skipped.functions++;
                  continue;
                }
                await tx.tbDsFunction.update({
                  where: { func_id: fnInput.systemId },
                  data: {
                    area_id:      areaId,
                    func_nm:      fnInput.name.trim(),
                    func_dc:      fnInput.description?.trim() ?? existing.func_dc,
                    // [2026-04-25] D3+D5: functionType 채널 지원 + 화이트리스트
                    func_ty_code: pickAllowed(fnInput.functionType, ALLOWED_FUNCTION_TYPES, existing.func_ty_code),
                    priort_code:  pickAllowed(fnInput.priority,     ALLOWED_PRIORITIES,     existing.priort_code),
                    cmplx_code:   pickAllowed(fnInput.complexity,   ALLOWED_COMPLEXITIES,   existing.cmplx_code),
                    mdfcn_dt:     new Date(),
                  },
                });
                result.updated.functions++;
              } else {
                const displayId = await nextFunctionDisplayId(projectId, tx);
                const sortOrder = await nextFunctionSortOrder(projectId, tx);
                await tx.tbDsFunction.create({
                  data: {
                    prjct_id:        projectId,
                    area_id:         areaId,
                    func_display_id: displayId,
                    func_nm:         fnInput.name.trim(),
                    func_dc:         fnInput.description?.trim() || null,
                    // [2026-04-25] D3+D5: functionType 채널 지원 + 화이트리스트 미통과 시 안전한 default
                    func_ty_code:    pickAllowed(fnInput.functionType, ALLOWED_FUNCTION_TYPES, "OTHER"),
                    priort_code:     pickAllowed(fnInput.priority,     ALLOWED_PRIORITIES,     "MEDIUM"),
                    cmplx_code:      pickAllowed(fnInput.complexity,   ALLOWED_COMPLEXITIES,   "MEDIUM"),
                    sort_ordr:       sortOrder,
                  },
                });
                result.created.functions++;
              }
            }
          }
        }
      }
    }, { timeout: 30000 });

    return apiSuccess({
      result,
      summary:
        `단위업무 ${result.created.unitWorks + result.updated.unitWorks}개 ` +
        `(신규 ${result.created.unitWorks}, 수정 ${result.updated.unitWorks}), ` +
        `화면 ${result.created.screens + result.updated.screens}개 ` +
        `(신규 ${result.created.screens}, 수정 ${result.updated.screens}), ` +
        `영역 ${result.created.areas + result.updated.areas}개 ` +
        `(신규 ${result.created.areas}, 수정 ${result.updated.areas}), ` +
        `기능 ${result.created.functions + result.updated.functions}개 ` +
        `(신규 ${result.created.functions}, 수정 ${result.updated.functions}) 처리 완료`,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/design/bulk-import] DB 오류:`, err);
    return apiError("DB_ERROR", "일괄 등록 중 오류가 발생했습니다.", 500);
  }
}

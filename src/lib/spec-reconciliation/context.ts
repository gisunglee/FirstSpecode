/**
 * 변경 경로와 선택한 UW에 맞는 4계층 스펙 컨텍스트 조회.
 *
 * Worker API와 사용자/MCP API가 같은 후보·fallback 규칙을 공유한다.
 */

import { prisma } from "@/lib/prisma";
import { hashOf } from "@/lib/impl-request/diff/normalizer";

export async function getReconciliationContext(input: {
  projectId: string;
  unitWorkRef: string | null;
  includeProjectIndex: boolean;
  paths: string[];
}) {
  const paths = input.paths.slice(0, 200);
  const [unitWorks, links] = await Promise.all([
    prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: input.projectId,
        ...(input.unitWorkRef
          ? {
              OR: [
                { unit_work_id: input.unitWorkRef },
                { unit_work_display_id: input.unitWorkRef },
              ],
            }
          : input.includeProjectIndex
            ? {}
            : { unit_work_id: "__NO_DIRECT_TREE__" }),
      },
      orderBy: { sort_ordr: "asc" },
      take: input.includeProjectIndex ? 500 : 1,
      select: {
        unit_work_id: true,
        unit_work_display_id: true,
        unit_work_nm: true,
        unit_work_dc: true,
        screens: {
          orderBy: { sort_ordr: "asc" },
          select: {
            scrn_id: true,
            scrn_display_id: true,
            scrn_nm: true,
            scrn_dc: true,
            areas: {
              orderBy: { sort_ordr: "asc" },
              select: {
                area_id: true,
                area_display_id: true,
                area_nm: true,
                area_dc: true,
                functions: {
                  orderBy: { sort_ordr: "asc" },
                  select: {
                    func_id: true,
                    func_display_id: true,
                    func_nm: true,
                    func_dc: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    paths.length === 0
      ? Promise.resolve([])
      : prisma.tbSpSpecSourceLink.findMany({
          where: {
            prjct_id: input.projectId,
            source_path: { in: paths },
            use_yn: "Y",
          },
          orderBy: { mdfcn_dt: "desc" },
          take: 1_000,
        }),
  ]);

  return {
    projectId: input.projectId,
    unitWorks: unitWorks.map((unitWork) => ({
      id: unitWork.unit_work_id,
      displayId: unitWork.unit_work_display_id,
      name: unitWork.unit_work_nm,
      description: unitWork.unit_work_dc ?? "",
      descriptionHash: hashOf(unitWork.unit_work_dc ?? "").hash,
      screens: unitWork.screens.map((screen) => ({
        id: screen.scrn_id,
        displayId: screen.scrn_display_id,
        name: screen.scrn_nm,
        description: screen.scrn_dc ?? "",
        descriptionHash: hashOf(screen.scrn_dc ?? "").hash,
        areas: screen.areas.map((area) => ({
          id: area.area_id,
          displayId: area.area_display_id,
          name: area.area_nm,
          description: area.area_dc ?? "",
          descriptionHash: hashOf(area.area_dc ?? "").hash,
          functions: area.functions.map((fn) => ({
            id: fn.func_id,
            displayId: fn.func_display_id,
            name: fn.func_nm,
            description: fn.func_dc ?? "",
            descriptionHash: hashOf(fn.func_dc ?? "").hash,
          })),
        })),
      })),
    })),
    sourceLinkCandidates: links.map((link) => ({
      targetRefType: link.target_ref_ty_code,
      targetRefId: link.target_ref_id,
      sourceKind: link.source_kind_code,
      path: link.source_path,
      symbol: link.source_symbol,
      relationType: link.relation_ty_code,
      confidence: link.confidence_code,
      lastReceiptId: link.last_receipt_id,
    })),
    fallbackRequired:
      links.length === 0 &&
      !input.unitWorkRef &&
      !input.includeProjectIndex,
  };
}


/**
 * GET /api/projects/[id]/test-specs/[specId]/xlsx
 *   — 테스트 명세서(단위/통합) 운영 양식 Excel 다운로드
 *
 * 시트:
 *   표지 · 변경 이력 · 테스트케이스 · 증적(추후)
 *
 * 결과·결함 매핑:
 *   - 명세서의 가장 최근 회차(round_no 최대) 결과 1세트만 사용 — 운영 템플릿이 1회차 컬럼 구조
 *   - 회차가 없으면 결과·결함 컬럼은 빈 칸으로 출력 (명세 자체 다운로드는 가능)
 *   - 결함은 여러 건이면 본문은 "1. ... 2. ..." 로 결합, 조치일자/조치결과는 조치 완료된 첫 결함의 값
 *
 * 권한: content.export — 시스템 관리자 지원 세션 자동 차단
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildTestSpecXlsx,
  type TestSpecXlsxCase,
  type TestSpecDocKind,
} from "@/lib/exports/xlsx/test-spec";
import { filenameSafe } from "@/lib/exports/filename";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// 결과 코드 → 한글 라벨
const RESULT_LABEL: Record<string, string> = {
  PASS:    "적합",
  FAIL:    "부적합",
  NA:      "N/A",
  BLOCKED: "차단",
};

// Date → 'YYYY-MM-DD'
function ymd(d: Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// 결함 N건 → 한 셀에 들어갈 본문 (1. ... 2. ... 형태)
function joinDefects(defects: { defect_cn: string }[]): string {
  const cleaned = defects.map((d) => d.defect_cn?.trim()).filter(Boolean) as string[];
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  return cleaned.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;

  // ① 권한
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  // ?kind=spec|result — 누락/오타는 result 로 fallback
  const url = new URL(request.url);
  const kindQ = url.searchParams.get("kind");
  const docKind: TestSpecDocKind = kindQ === "spec" ? "spec" : "result";

  try {
    // ② 명세서 + 케이스 + (최신 회차 1개 + 결과 + 결함) 조회
    const spec = await prisma.tbQaTestSpec.findUnique({
      where:   { test_spec_id: specId },
      include: {
        project:  { select: { prjct_nm: true, prjct_abrv: true } },
        uwLinks: {
          include: { unitWork: { select: { unit_work_display_id: true, unit_work_nm: true } } },
          orderBy: { sort_ordr: "asc" },
        },
        screenLinks: {
          include: { screen: { select: { scrn_display_id: true, scrn_nm: true } } },
          orderBy: { sort_ordr: "asc" },
        },
        cases:   { orderBy: [{ ctgry_code: "asc" }, { case_no: "asc" }] },
        rounds: {
          orderBy: { round_no: "desc" },
          take:    1,
          include: {
            results: {
              include: { defects: { orderBy: { creat_dt: "asc" } } },
            },
          },
        },
      },
    });
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    // ③ result 인덱스 — testCaseId → result(+defects)
    //    (담당자 이름 조회는 표지에서 사용 안 함 — 사용자 양식 따라 시스템명/단계/테스트ID 3행만 노출)
    const latestRound = spec.rounds[0];
    const resultByCaseId = new Map<
      string,
      { result_code: string; test_dt: Date | null; defects: { defect_cn: string; fix_dt: Date | null; fix_cn: string | null }[] }
    >();
    if (latestRound) {
      for (const r of latestRound.results) {
        resultByCaseId.set(r.test_case_id, {
          result_code: r.result_code,
          test_dt:     r.test_dt,
          defects:     r.defects.map((d) => ({
            defect_cn: d.defect_cn,
            fix_dt:    d.fix_dt,
            fix_cn:    d.fix_cn,
          })),
        });
      }
    }

    // ④ 케이스 → 출력 케이스로 매핑
    const toCase = (
      c: typeof spec.cases[number],
      idx: number,
    ): TestSpecXlsxCase => {
      const res = resultByCaseId.get(c.test_case_id);
      // 조치 완료된(fix_dt 또는 fix_cn 보유) 첫 결함 — 1조치 컬럼 단순화
      const fixed = res?.defects.find((d) => d.fix_dt || (d.fix_cn?.trim()));
      return {
        no:          idx + 1,
        group:       c.grp_nm,
        scenario:    c.scenario_cn,
        expected:    c.expected_cn,
        testedDate:  ymd(res?.test_dt ?? null),
        resultLabel: res ? (RESULT_LABEL[res.result_code] ?? res.result_code) : "",
        defectText:  res ? joinDefects(res.defects) : "",
        fixDate:     ymd(fixed?.fix_dt ?? null),
        fixResult:   fixed?.fix_cn?.trim() ?? "",
      };
    };

    const checklist:  TestSpecXlsxCase[] = [];
    const functional: TestSpecXlsxCase[] = [];
    spec.cases.forEach((c) => {
      if (c.ctgry_code === "CHECKLIST") {
        checklist.push(toCase(c, checklist.length));
      } else {
        functional.push(toCase(c, functional.length));
      }
    });

    // ⑤ 상단 박스용 텍스트
    //   "프로그램 ID" 는 실제 테스트한 화면들의 displayId 가 우선 — 감리 시
    //   "어떤 화면을 테스트했냐" 에 답할 수 있어야 함 (사용자 양식 기준).
    //   화면 매핑이 없으면(주로 통합 테스트) 단위업무 displayId 로 fallback.
    const screenIds = spec.screenLinks.map((s) => s.screen?.scrn_display_id ?? "").filter(Boolean);
    const screenNms = spec.screenLinks.map((s) => s.screen?.scrn_nm ?? "").filter(Boolean);
    const uwIds     = spec.uwLinks.map((u) => u.unitWork?.unit_work_display_id ?? "").filter(Boolean);
    const uwNms     = spec.uwLinks.map((u) => u.unitWork?.unit_work_nm ?? "").filter(Boolean);

    const programIds = (screenIds.length > 0 ? screenIds : uwIds).join(", ");
    const subtitle   = (screenNms.length > 0 ? screenNms : uwNms).join(", ");

    // ⑥ 빌더 호출 — testKindLabel 은 종류만("단위 테스트"/"통합 테스트"),
    //    "명세서"/"결과서" 어미는 빌더가 docKind 로 자동 부착.
    const testKindBase = spec.test_kind_code === "UNIT" ? "단위 테스트" : "통합 테스트";
    const projectAbbr = spec.project?.prjct_abrv ?? null;
    const buffer = await buildTestSpecXlsx({
      docKind,
      projectName:    spec.project?.prjct_nm ?? "프로젝트",
      projectAbbr,
      displayId:      spec.test_spec_display_id,
      testSpecNm:     spec.test_spec_nm,
      testKindLabel:  testKindBase,
      programIds,
      testTaskNm:     spec.test_spec_nm,
      subtitle,
      checklist,
      functional,
    });

    // ⑦ 파일명 — "[<ABBR>_]<문서종류>_<표시ID>_<테스트명>.xlsx"
    //   예) "GBMS_단위 테스트 명세서_TS-00003_게시판 관리.xlsx"
    //   문서종류를 앞에 두는 이유: 폴더 정렬 시 "명세서끼리, 결과서끼리" 그룹지어 보이도록.
    //   (이름·약어가 비면 해당 토큰 생략)
    const docSuffix  = docKind === "spec" ? "명세서" : "결과서";
    const docFull    = `${testKindBase} ${docSuffix}`;
    const safeName   = filenameSafe(spec.test_spec_nm);
    const abbrPrefix = filenameSafe(projectAbbr);
    const corePart   = safeName
      ? `${docFull}_${spec.test_spec_display_id}_${safeName}`
      : `${docFull}_${spec.test_spec_display_id}`;
    const filename = abbrPrefix
      ? `${abbrPrefix}_${corePart}.xlsx`
      : `${corePart}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_XLSX,
        "Content-Length":      buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/test-specs/${specId}/xlsx] 오류:`, err);
    return apiError("EXPORT_ERROR", "테스트 명세서(엑셀) 생성에 실패했습니다.", 500);
  }
}

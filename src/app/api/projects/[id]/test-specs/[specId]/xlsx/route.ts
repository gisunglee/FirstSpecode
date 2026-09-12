/**
 * GET /api/projects/[id]/test-specs/[specId]/xlsx
 *   — 테스트 명세서(단위/통합) 운영 양식 Excel 다운로드
 *
 * 시트:
 *   명세서(?kind=spec)   표지 · 변경 이력 · 테스트케이스
 *   결과서(?kind=result) 표지 · 변경 이력(회차 목록) · 테스트케이스(회차별 판정 요약)
 *                        · N차 결과(회차마다 1시트) · 증적(추후)
 *
 * 결과·결함 매핑:
 *   - 결과서는 수행한 **모든 회차**를 각각 시트로 출력한다. 회차를 하나만 싣던 이전
 *     방식은 재테스트 기록이 사라져 감리 대응이 되지 않았다.
 *   - 회차가 없으면 회차 시트 없이 명세만 출력 (결과서 다운로드 자체는 가능)
 *   - 회차 생성 후 추가된 케이스는 그 회차에 결과 row 가 없어 해당 회차 시트에서 제외된다.
 *     회차별 대상 건수를 시트 상단과 변경 이력에 함께 표기해 누락으로 오해되지 않게 한다.
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
  type TestSpecXlsxRound,
  type TestSpecDocKind,
} from "@/lib/exports/xlsx/test-spec";
import { filenameSafe } from "@/lib/exports/filename";
import { resolveDocMeta, type DocMetaSettings } from "@/lib/exports/doc-meta";
import { findDocMeta, type DocMetaKey } from "@/lib/exports/doc-meta-catalog";
import { displayIdToSeq } from "@/lib/exports/doc-number";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// 결과 코드 → 한글 라벨
const RESULT_LABEL: Record<string, string> = {
  PASS:    "적합",
  FAIL:    "부적합",
  NA:      "N/A",
  BLOCKED: "차단",
};

// 회차 상태 코드 → 한글 라벨
const ROUND_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "진행중",
  DONE:        "완료",
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
    //   문서번호 생성에 필요한 프로젝트 설정도 병렬로 함께 조회 (의존 없음)
    const [spec, settings] = await Promise.all([
      prisma.tbQaTestSpec.findUnique({
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
          // 결과서는 모든 회차를 시트로 출력하므로 take 제한 없이 오름차순 전부 가져온다.
          // (명세서일 때는 아래에서 rounds 를 빈 배열로 버린다 — 쿼리 분기보다 단순)
          rounds: {
            orderBy: { round_no: "asc" },
            include: {
              results: {
                include: { defects: { orderBy: { creat_dt: "asc" } } },
              },
            },
          },
        },
      }),
      prisma.tbPjProjectSettings.findUnique({
        where:  { prjct_id: projectId },
        select: {
          system_nm:          true,
          system_code:        true,
          doc_no_template:    true,
          artifact_meta_json: true,
        },
      }),
    ]);
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    // ③ 출력 대상 회차 결정
    //    명세서(spec)는 설계 시점 산출물이라 결과를 싣지 않는다 — 회차를 통째로 버린다.
    //    결과서(result)는 수행한 모든 회차를 각각 시트로 출력한다.
    const rounds = docKind === "result" ? spec.rounds : [];

    // 회차 → (케이스ID → 결과) 인덱스. 회차마다 하나씩 만들어 둔다.
    //    (담당자 이름 조회는 표지에서 사용 안 함 — 사용자 양식 따라 시스템명/단계/테스트ID 3행만 노출)
    type ResultEntry = {
      result_code: string;
      test_dt:     Date | null;
      defects:     { defect_cn: string; fix_dt: Date | null; fix_cn: string | null }[];
    };
    const resultIndexByRound: Map<string, ResultEntry>[] = rounds.map((rd) => {
      const map = new Map<string, ResultEntry>();
      for (const r of rd.results) {
        map.set(r.test_case_id, {
          result_code: r.result_code,
          test_dt:     r.test_dt,
          defects:     r.defects.map((d) => ({
            defect_cn: d.defect_cn,
            fix_dt:    d.fix_dt,
            fix_cn:    d.fix_cn,
          })),
        });
      }
      return map;
    });

    // ④ 케이스 → 출력 케이스 매핑
    //    resultIndex 를 주면 그 회차의 결과가 채워지고, 주지 않으면 명세 정보만 담긴다.
    const toCase = (
      c: typeof spec.cases[number],
      idx: number,
      resultIndex?: Map<string, ResultEntry>,
    ): TestSpecXlsxCase => {
      const res = resultIndex?.get(c.test_case_id);
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

    // ⑤ "테스트케이스" 조망 시트용 — 명세 기준 전체 케이스 + 회차별 판정만 부착.
    //    그 회차에 결과 row 가 없으면(회차 시작 후 추가된 케이스) 빈 문자열로 둔다.
    const verdictsOf = (caseId: string): string[] =>
      resultIndexByRound.map((idx) => {
        const res = idx.get(caseId);
        return res ? (RESULT_LABEL[res.result_code] ?? res.result_code) : "";
      });

    const checklist:  TestSpecXlsxCase[] = [];
    const functional: TestSpecXlsxCase[] = [];
    spec.cases.forEach((c) => {
      const target = c.ctgry_code === "CHECKLIST" ? checklist : functional;
      target.push({
        ...toCase(c, target.length),
        roundVerdicts: verdictsOf(c.test_case_id),
      });
    });

    // ⑥ 회차별 상세 시트용 — 그 회차가 실제로 다룬 케이스만 (결과 row 가 있는 것만).
    //    회차 생성 시점에 존재하던 케이스만 결과 row 를 가지므로, 회차마다 건수가 다를 수 있다.
    const xlsxRounds: TestSpecXlsxRound[] = rounds.map((rd, i) => {
      const resultIndex = resultIndexByRound[i];
      const rdChecklist:  TestSpecXlsxCase[] = [];
      const rdFunctional: TestSpecXlsxCase[] = [];
      const summary: Record<string, number> = {};

      for (const c of spec.cases) {
        // 이 회차에 결과가 없는 케이스는 이 회차의 산출물이 아니다 — 건너뛴다
        const res = resultIndex.get(c.test_case_id);
        if (!res) continue;

        const target = c.ctgry_code === "CHECKLIST" ? rdChecklist : rdFunctional;
        target.push(toCase(c, target.length, resultIndex));

        const label = RESULT_LABEL[res.result_code] ?? res.result_code;
        summary[label] = (summary[label] ?? 0) + 1;
      }

      return {
        roundNo:     rd.round_no,
        envirLabel:  rd.envir_code,
        bldVrsnNm:   rd.bld_vrsn_nm ?? "",
        bgngDate:    ymd(rd.bgng_dt),
        endDate:     ymd(rd.end_dt),
        statusLabel: ROUND_STATUS_LABEL[rd.sttus_code] ?? rd.sttus_code,
        checklist:   rdChecklist,
        functional:  rdFunctional,
        summary,
      };
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

    // ⑥ 문서번호 — 테스트 종류(UNIT/INTEGRATION)에 따라 문서코드(기본 I501/T601)가 갈림.
    //    명세서·결과서는 같은 테스트 명세서라 동일 문서번호를 공유한다(종류별 1코드).
    //    끝자리 순번은 표시ID(TS-00003)의 끝 세 자리.
    const artifactKey: DocMetaKey =
      spec.test_kind_code === "UNIT" ? "UNIT_TEST" : "INTEGRATION_TEST";
    const docMeta = resolveDocMeta({
      catalogMeta: findDocMeta(artifactKey),
      artifactKey,
      settings: {
        systemNm:      settings?.system_nm,
        systemCode:    settings?.system_code,
        docNoTemplate: settings?.doc_no_template,
        artifactMeta:  (settings?.artifact_meta_json ?? null) as DocMetaSettings["artifactMeta"],
      },
      project: {
        projectName: spec.project?.prjct_nm ?? "프로젝트",
        projectAbbr: spec.project?.prjct_abrv ?? null,
      },
      year: new Date().getFullYear(),
      seq:  displayIdToSeq(spec.test_spec_display_id),
    });

    // ⑦ 빌더 호출 — testKindLabel 은 종류만("단위 테스트"/"통합 테스트"),
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
      docNo:          docMeta.docNo,
      programIds,
      testTaskNm:     spec.test_spec_nm,
      subtitle,
      checklist,
      functional,
      rounds: xlsxRounds,
    });

    // ⑧ 파일명 — "[<ABBR>_]<문서종류>_<표시ID>_<테스트명>.xlsx"
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

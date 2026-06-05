/**
 * exports/unit-work-data.ts — 프로그램 사양서(단위업무) 출력 양식의 입력 데이터 조립
 *
 * 역할:
 *   - DB 에서 단위업무 1건과 그 하위 트리(화면 → 영역 → 기능 + 컬럼 매핑) 를 모아
 *     UnitWorkExportInput 객체로 반환한다.
 *   - 두 곳에서 사용:
 *       1) GET  /unit-works/[unitWorkId]/export/docx       — 현재 시점 docx
 *       2) POST /documents/release (docKind=UNIT_WORK)     — 발행 시점 스냅샷
 *
 * 책임 분리:
 *   - 본 모듈 : DB → 양식 입력 객체 매핑 (HTTP 무관)
 *   - 라우트  : 권한·요청 검증·HTTP 응답
 *   - 빌더    : 양식 객체 → docx Buffer (lib/exports/docx/unit-work.ts)
 */

import { prisma } from "@/lib/prisma";
import {
  buildUnitWorkDocx,
  type UnitWorkExportInput,
  type ColMappingRow,
  type FunctionItem,
  type AreaSection,
  type ScreenSection,
  type ScreenSummaryRow,
} from "@/lib/exports/docx/unit-work";
import { bumpMinorVersion } from "@/lib/exports/version";
import { buildDocxFilename } from "@/lib/exports/filename";
import { resolveDocMeta, type DocMetaSettings } from "@/lib/exports/doc-meta";
import { findDocMeta } from "@/lib/exports/doc-meta-catalog";

// ─── 코드 → 라벨 매핑 ────────────────────────────────────────
// 화면(unit-works/[unitWorkId]/page.tsx 등) 과 동일한 라벨.
// 향후 공통 코드 테이블로 옮기면 한 곳에서 관리.
const SCREEN_TYPE_LABELS: Record<string, string> = {
  LIST:        "목록",
  DETAIL:      "상세",
  GRID:        "그리드",
  TAB:         "탭",
  FULL_SCREEN: "전체화면",
  INPUT:       "입력",
  POPUP:       "팝업",
  REPORT:      "리포트",
};

const AREA_TYPE_LABELS: Record<string, string> = {
  FILTER:  "조회 조건",
  LIST:    "데이터 목록",
  FORM:    "데이터 양식",
  DETAIL:  "상세 정보",
  GENERAL: "일반 콘텐츠",
};

const DISPLAY_FORM_LABELS: Record<string, string> = {
  STATIC:    "고정",
  MODAL:     "모달",
  POPOVER:   "팝오버",
  DRAWER:    "드로어",
  TABS:      "탭 전환",
  ACCORDION: "아코디언",
};

const FUNC_TYPE_LABELS: Record<string, string> = {
  SEARCH:   "검색/조회",
  SAVE:     "저장",
  DELETE:   "삭제",
  DOWNLOAD: "다운로드",
  UPLOAD:   "업로드",
  NAVIGATE: "이동",
  VALIDATE: "유효성검증",
  OTHER:    "기타",
};

const PRIORITY_LABELS: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};

const COMPLEXITY_LABELS: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};

// I/O 코드 → 양식 표기
const IO_LABELS: Record<string, string> = {
  INPUT:  "I",
  OUTPUT: "O",
  INOUT:  "I/O",
};

// ─── DB 미정비 영역 기본값 ──────────────────────────────────
export const UNIT_WORK_EXPORT_FALLBACK = {
  copyright:       "Copyright ⓒ SPECODE",
  documentVersion: "v1.0",
  authorName:      "(미지정)",
  approverName:    "(미지정)",
  historyChange:   "최초 작성",
  unassigned:      "(미지정)",
} as const;

// ─── 본문 필드 — 변경이력 표 분기에 사용 ────────────────────
// snapshot 과 현재 input 비교 시 양식 본문에 영향 가는 필드만 본다.
// 메타(저작권/문서버전/작성정보)·변경이력 자체는 비교 제외.
//
// keyof UnitWorkExportInput 잠금 — 필드 추가 시 컴파일 시 발견 강제.
export const UNIT_WORK_CONTENT_FIELDS: readonly (keyof UnitWorkExportInput)[] = [
  "ordererName",
  "projectName",
  "projectAbbr",
  "unitWorkDisplayId",
  "unitWorkName",
  "unitWorkDescription",
  "parentRequirement",
  "assigneeName",
  "startDate",
  "endDate",
  "progressRate",
  "sortOrder",
  "screens",
  "screenSummary",
] as const;

/**
 * 직전 발행 snapshot 과 현재 input 의 본문 필드 비교.
 * 객체/배열은 JSON 직렬화 비교 (트리 깊이가 깊어 필드별 순회 비효율).
 */
export function hasUnitWorkContentChanged(
  snapshot: Partial<UnitWorkExportInput>,
  current:  UnitWorkExportInput,
): boolean {
  for (const field of UNIT_WORK_CONTENT_FIELDS) {
    if (!(field in snapshot)) continue;
    if (!(field in current))  continue;

    const a = snapshot[field];
    const b = current[field];

    if (typeof a === "object" && a !== null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    } else {
      if (a !== b) return true;
    }
  }
  return false;
}

// ─── 결과 타입 ──────────────────────────────────────────────
export type UnitWorkExportDataResult =
  | { ok: true;  input: UnitWorkExportInput }
  | { ok: false; httpStatus: number; code: string; message: string };

// ─── 헬퍼 ───────────────────────────────────────────────────
function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "";
  return map[code] ?? code;
}

function dashIfEmpty(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s ? s : "-";
}

/**
 * 컬럼매핑 1건 → 양식 표 행.
 * col_id 가 비어있는 매핑(=화면 항목인데 DB 컬럼 미연결)도 빈 셀로 표현 가능.
 */
function toMappingRow(
  no:      number,
  mapping: {
    col_id:       string | null;
    io_se_code:   string | null;
    ui_ty_code:   string | null;
    use_purps_cn: string | null;
    col_dc:       string | null;
  },
  colInfo: {
    tableLogical:  string;
    tablePhysical: string;
    colLogical:    string;
    colPhysical:   string;
  } | null,
): ColMappingRow {
  // 항목명 — 사용목적 → 컬럼 설명 → 컬럼 한글명 → 물리명
  const itemName =
    mapping.use_purps_cn?.trim() ||
    mapping.col_dc?.trim()       ||
    colInfo?.colLogical          ||
    colInfo?.colPhysical         ||
    "";

  return {
    no,
    itemName,
    io:            label(IO_LABELS, mapping.io_se_code) || "",
    uiType:        mapping.ui_ty_code ?? "",
    colLogical:    colInfo?.colLogical    ?? "",
    colPhysical:   colInfo?.colPhysical   ?? "",
    tableLogical:  colInfo?.tableLogical  ?? "",
    tablePhysical: colInfo?.tablePhysical ?? "",
  };
}

/**
 * DB 에서 단위업무 1건의 양식 입력 객체를 조립한다.
 */
export async function buildUnitWorkExportInput(
  projectId:  string,
  unitWorkId: string,
): Promise<UnitWorkExportDataResult> {
  // ── ① 단위업무 + 부모 요구사항 ─────────────────────────────
  const unitWork = await prisma.tbDsUnitWork.findUnique({
    where: { unit_work_id: unitWorkId },
    select: {
      unit_work_id:         true,
      prjct_id:             true,
      unit_work_display_id: true,
      unit_work_nm:         true,
      unit_work_dc:         true,
      asign_mber_id:        true,
      bgng_de:              true,
      end_de:               true,
      progrs_rt:            true,
      sort_ordr:            true,
      requirement: {
        select: { req_display_id: true, req_nm: true },
      },
    },
  });
  if (!unitWork || unitWork.prjct_id !== projectId) {
    return {
      ok: false, httpStatus: 404, code: "NOT_FOUND",
      message: "단위업무를 찾을 수 없습니다.",
    };
  }

  // ── ② 프로젝트 + 설정 ──────────────────────────────────────
  const [project, settings] = await Promise.all([
    prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { prjct_nm: true, prjct_abrv: true, client_nm: true },
    }),
    prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: {
        copyright_holder:    true,
        doc_version_default: true,
        approver_nm:         true,
        system_nm:           true,
        system_code:         true,
        doc_no_template:     true,
        artifact_meta_json:  true,
      },
    }),
  ]);

  if (!project) {
    return {
      ok: false, httpStatus: 404, code: "NOT_FOUND",
      message: "프로젝트를 찾을 수 없습니다.",
    };
  }

  // ── ③ 화면 → 영역 → 기능 트리 ──────────────────────────────
  const screens = await prisma.tbDsScreen.findMany({
    where:   { prjct_id: projectId, unit_work_id: unitWorkId },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      scrn_id:         true,
      scrn_display_id: true,
      scrn_nm:         true,
      scrn_dc:         true,
      scrn_ty_code:    true,
      url_path:        true,
      ctgry_l_nm:      true,
      ctgry_m_nm:      true,
      ctgry_s_nm:      true,
      asign_mber_id:   true,
    },
  });
  const screenIds = screens.map((s) => s.scrn_id);

  const areas = screenIds.length === 0 ? [] : await prisma.tbDsArea.findMany({
    where:   { prjct_id: projectId, scrn_id: { in: screenIds } },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      area_id:           true,
      scrn_id:           true,
      area_display_id:   true,
      area_nm:           true,
      area_dc:           true,
      area_ty_code:      true,
      display_form_code: true,
    },
  });
  const areaIds = areas.map((a) => a.area_id);

  const functions = areaIds.length === 0 ? [] : await prisma.tbDsFunction.findMany({
    where:   { prjct_id: projectId, area_id: { in: areaIds } },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      func_id:         true,
      area_id:         true,
      func_display_id: true,
      func_nm:         true,
      func_dc:         true,
      func_ty_code:    true,
      priort_code:     true,
      cmplx_code:      true,
      efrt_val:        true,
      asign_mber_id:   true,
    },
  });
  const funcIds = functions.map((f) => f.func_id);

  // ── ④ 컬럼 매핑 (영역 + 기능) ──────────────────────────────
  const refIdsToCheck: { ref_ty_code: string; ref_id: { in: string[] } }[] = [];
  if (areaIds.length > 0) refIdsToCheck.push({ ref_ty_code: "AREA",     ref_id: { in: areaIds } });
  if (funcIds.length > 0) refIdsToCheck.push({ ref_ty_code: "FUNCTION", ref_id: { in: funcIds } });
  // 화면 단위 매핑은 양식상 표현 위치가 애매해 1차 버전에서 제외 — 영역 또는 기능에 매핑하도록 권장

  const mappings = refIdsToCheck.length === 0 ? [] : await prisma.tbDsColMapping.findMany({
    where:   { OR: refIdsToCheck },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      mapping_id:   true,
      ref_ty_code:  true,
      ref_id:       true,
      col_id:       true,
      io_se_code:   true,
      ui_ty_code:   true,
      use_purps_cn: true,
      col_dc:       true,
    },
  });

  // ── ⑤ 컬럼 + 테이블 정보 ───────────────────────────────────
  const colIds = Array.from(new Set(
    mappings.map((m) => m.col_id).filter((id): id is string => !!id)
  ));

  const cols = colIds.length === 0 ? [] : await prisma.tbDsDbTableColumn.findMany({
    where:  { col_id: { in: colIds } },
    select: {
      col_id:        true,
      tbl_id:        true,
      col_physcl_nm: true,
      col_lgcl_nm:   true,
    },
  });

  const tblIds = Array.from(new Set(cols.map((c) => c.tbl_id)));
  const tables = tblIds.length === 0 ? [] : await prisma.tbDsDbTable.findMany({
    where:  { tbl_id: { in: tblIds } },
    select: {
      tbl_id:        true,
      tbl_physcl_nm: true,
      tbl_lgcl_nm:   true,
    },
  });

  // ── ⑥ 멤버명 일괄 조회 (단위업무/화면/기능 담당자들) ────────
  const memberIds = [
    unitWork.asign_mber_id,
    ...screens.map((s) => s.asign_mber_id),
    ...functions.map((f) => f.asign_mber_id),
  ].filter((id): id is string => !!id);
  const uniqMemberIds = Array.from(new Set(memberIds));

  const members = uniqMemberIds.length === 0 ? [] : await prisma.tbCmMember.findMany({
    where:  { mber_id: { in: uniqMemberIds } },
    select: { mber_id: true, mber_nm: true, email_addr: true },
  });
  const memberMap = new Map(members.map((m) => [m.mber_id, m]));
  function memberName(id: string | null | undefined): string {
    if (!id) return UNIT_WORK_EXPORT_FALLBACK.unassigned;
    const m = memberMap.get(id);
    if (!m) return UNIT_WORK_EXPORT_FALLBACK.unassigned;
    return m.mber_nm?.trim() || m.email_addr || UNIT_WORK_EXPORT_FALLBACK.unassigned;
  }

  // ── ⑦ 메모리 lookup map ────────────────────────────────────
  const colInfoByColId = new Map<string, {
    tableLogical:  string;
    tablePhysical: string;
    colLogical:    string;
    colPhysical:   string;
  }>();
  const tblInfoByTblId = new Map<string, { logical: string; physical: string }>();
  for (const t of tables) {
    tblInfoByTblId.set(t.tbl_id, {
      logical:  t.tbl_lgcl_nm?.trim() || t.tbl_physcl_nm,
      physical: t.tbl_physcl_nm,
    });
  }
  for (const c of cols) {
    const tbl = tblInfoByTblId.get(c.tbl_id);
    colInfoByColId.set(c.col_id, {
      tableLogical:  tbl?.logical  ?? "",
      tablePhysical: tbl?.physical ?? "",
      colLogical:    c.col_lgcl_nm?.trim() || c.col_physcl_nm,
      colPhysical:   c.col_physcl_nm,
    });
  }

  // ref 별 매핑 그룹화
  const mappingsByRef = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const key = `${m.ref_ty_code}::${m.ref_id}`;
    if (!mappingsByRef.has(key)) mappingsByRef.set(key, []);
    mappingsByRef.get(key)!.push(m);
  }

  // 영역별 기능 그룹화
  const funcsByAreaId = new Map<string, typeof functions>();
  for (const f of functions) {
    if (!f.area_id) continue;
    if (!funcsByAreaId.has(f.area_id)) funcsByAreaId.set(f.area_id, []);
    funcsByAreaId.get(f.area_id)!.push(f);
  }

  // 화면별 영역 그룹화
  const areasByScreenId = new Map<string, typeof areas>();
  for (const a of areas) {
    if (!a.scrn_id) continue;
    if (!areasByScreenId.has(a.scrn_id)) areasByScreenId.set(a.scrn_id, []);
    areasByScreenId.get(a.scrn_id)!.push(a);
  }

  // ── ⑧ 트리 조립 ──────────────────────────────────────────
  const screenSections: ScreenSection[] = screens.map((sc) => {
    const screenAreas = areasByScreenId.get(sc.scrn_id) ?? [];

    const areaSections: AreaSection[] = screenAreas.map((ar) => {
      // 영역 직접 매핑
      const directRaw = mappingsByRef.get(`AREA::${ar.area_id}`) ?? [];
      const directMappings: ColMappingRow[] = directRaw.map((m, idx) => {
        const info = m.col_id ? (colInfoByColId.get(m.col_id) ?? null) : null;
        return toMappingRow(idx + 1, m, info);
      });

      // 영역 하위 기능들
      const areaFuncs = funcsByAreaId.get(ar.area_id) ?? [];
      const functionItems: FunctionItem[] = areaFuncs.map((f) => {
        const fnRaw = mappingsByRef.get(`FUNCTION::${f.func_id}`) ?? [];
        const fnMappings: ColMappingRow[] = fnRaw.map((m, idx) => {
          const info = m.col_id ? (colInfoByColId.get(m.col_id) ?? null) : null;
          return toMappingRow(idx + 1, m, info);
        });
        return {
          displayId:    f.func_display_id,
          name:         f.func_nm ?? "",
          description:  f.func_dc ?? "",
          funcType:     label(FUNC_TYPE_LABELS, f.func_ty_code),
          priority:     label(PRIORITY_LABELS,  f.priort_code),
          complexity:   label(COMPLEXITY_LABELS, f.cmplx_code),
          effort:       f.efrt_val ?? "",
          assigneeName: memberName(f.asign_mber_id),
          mappings:     fnMappings,
        };
      });

      return {
        displayId:        ar.area_display_id,
        name:             ar.area_nm ?? "",
        description:      ar.area_dc ?? "",
        areaType:         label(AREA_TYPE_LABELS, ar.area_ty_code),
        displayForm:      label(DISPLAY_FORM_LABELS, ar.display_form_code),
        directMappings,
        functions:        functionItems,
      };
    });

    // 카테고리 — L > M > S 가 모두 있으면 " > " 로 합쳐 표시
    const categoryParts = [sc.ctgry_l_nm, sc.ctgry_m_nm, sc.ctgry_s_nm]
      .map((v) => v?.trim())
      .filter((v): v is string => !!v);
    const category = categoryParts.length > 0 ? categoryParts.join(" > ") : "";

    return {
      displayId:    sc.scrn_display_id,
      name:         sc.scrn_nm ?? "",
      description:  sc.scrn_dc ?? "",
      screenType:   label(SCREEN_TYPE_LABELS, sc.scrn_ty_code),
      urlPath:      sc.url_path ?? "",
      category,
      assigneeName: memberName(sc.asign_mber_id),
      areas:        areaSections,
    };
  });

  // ── ⑨ 화면 요약 표 (2. 화면 목록) ───────────────────────
  const screenSummary: ScreenSummaryRow[] = screenSections.map((sc, i) => ({
    no:         i + 1,
    displayId:  sc.displayId,
    name:       sc.name,
    screenType: sc.screenType,
    areaCount:  sc.areas.length,
    funcCount:  sc.areas.reduce((sum, a) => sum + a.functions.length, 0),
  }));

  // ── ⑩ 메타 정리 ─────────────────────────────────────────
  const ordererName     = project.client_nm?.trim() || "발주처 미지정";
  const copyrightText   = settings?.copyright_holder?.trim()    || UNIT_WORK_EXPORT_FALLBACK.copyright;
  const documentVersion = settings?.doc_version_default?.trim() || UNIT_WORK_EXPORT_FALLBACK.documentVersion;
  const approverName    = settings?.approver_nm?.trim()         || UNIT_WORK_EXPORT_FALLBACK.approverName;

  const assigneeName = memberName(unitWork.asign_mber_id);
  const authorName   = assigneeName !== UNIT_WORK_EXPORT_FALLBACK.unassigned
    ? assigneeName
    : UNIT_WORK_EXPORT_FALLBACK.authorName;

  const now       = new Date();
  const writtenAt = now.toISOString().slice(0, 10);

  // 문서 메타/번호 — 카탈로그(프로그램 사양서 기본값) ← 설정 오버라이드 머지 후 문서번호 생성
  const docMeta = resolveDocMeta({
    catalogMeta: findDocMeta("UNIT_WORK"),
    artifactKey: "UNIT_WORK",
    settings: {
      systemNm:      settings?.system_nm,
      systemCode:    settings?.system_code,
      docNoTemplate: settings?.doc_no_template,
      artifactMeta:  (settings?.artifact_meta_json ?? null) as DocMetaSettings["artifactMeta"],
    },
    project: { projectName: project.prjct_nm, projectAbbr: project.prjct_abrv },
    year:    now.getFullYear(),
  });

  // 부모 요구사항 표시 — "REQ-XXXXX 요구사항명"
  const parentRequirement = unitWork.requirement
    ? `${unitWork.requirement.req_display_id} ${unitWork.requirement.req_nm}`
    : "-";

  // ── ⑪ 입력 객체 ─────────────────────────────────────────
  const input: UnitWorkExportInput = {
    ordererName,
    copyright:   copyrightText,
    projectName: project.prjct_nm,
    projectAbbr: project.prjct_abrv ?? null,

    unitWorkDisplayId:   unitWork.unit_work_display_id,
    unitWorkName:        unitWork.unit_work_nm?.trim() || unitWork.unit_work_display_id,
    unitWorkDescription: unitWork.unit_work_dc ?? "",
    parentRequirement,
    assigneeName,
    startDate:           dashIfEmpty(unitWork.bgng_de),
    endDate:             dashIfEmpty(unitWork.end_de),
    progressRate:        unitWork.progrs_rt ?? 0,
    sortOrder:           unitWork.sort_ordr ?? 0,

    screens:       screenSections,
    screenSummary,

    documentVersion,
    writtenAt,
    authorName,
    approverName,
    docMeta,
    history: [{
      version:  documentVersion,
      date:     writtenAt,
      change:   UNIT_WORK_EXPORT_FALLBACK.historyChange,
      author:   authorName,
      approver: approverName,
    }],
  };

  return { ok: true, input };
}

// ─── 헬퍼: input → 변경이력 표 구성 → docx Buffer ──────────
/**
 * 단위업무 1건의 프로그램 사양서 docx Buffer 와 다운로드 파일명을 한 번에 만든다.
 *
 * 동일 흐름이 단일 export route 와 zip 일괄 다운로드 route 양쪽에서 필요.
 * 요건정의서의 buildRequirementDocxWithHistory() 와 1:1 대응.
 */
export async function buildUnitWorkDocxWithHistory(
  projectId:  string,
  unitWorkId: string,
): Promise<
  | { ok: true; buffer: Buffer; filename: string; displayId: string }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const result = await buildUnitWorkExportInput(projectId, unitWorkId);
  if (!result.ok) return result;
  const input = result.input;

  // 발행 이력 조회
  const releases = await prisma.tbDsDocumentRelease.findMany({
    where:   { prjct_id: projectId, doc_kind: "UNIT_WORK", ref_id: unitWorkId },
    orderBy: { released_dt: "desc" },
    select: {
      vrsn_no:       true,
      change_cn:     true,
      author_nm:     true,
      approver_nm:   true,
      released_dt:   true,
      snapshot_data: true,
    },
  });

  let showCurrentRow = true;
  if (releases.length > 0) {
    const lastSnapshot = releases[0].snapshot_data as Partial<UnitWorkExportInput>;
    showCurrentRow = hasUnitWorkContentChanged(lastSnapshot, input);
  }

  const releaseRows = releases.map((r) => ({
    version:  r.vrsn_no,
    date:     r.released_dt.toISOString().slice(0, 10),
    change:   r.change_cn   ?? "",
    author:   r.author_nm   ?? "",
    approver: r.approver_nm ?? "",
  }));

  if (showCurrentRow) {
    const today = new Date().toISOString().slice(0, 10);
    const currentVersion = releases.length > 0
      ? bumpMinorVersion(releases[0].vrsn_no)
      : input.documentVersion;
    const currentChange = releases.length > 0
      ? "(현재 작업 중)"
      : UNIT_WORK_EXPORT_FALLBACK.historyChange;
    input.history = [
      {
        version:  currentVersion,
        date:     today,
        change:   currentChange,
        author:   input.authorName,
        approver: input.approverName,
      },
      ...releaseRows,
    ];
  } else {
    input.history = releaseRows;
  }

  const buffer   = await buildUnitWorkDocx(input);
  // 파일명: [<ABBR>_]<UW-ID>_<단위업무명>_프로그램사양서.docx
  //   - 약어 있으면 prefix, 없으면 기존 형식. 이름 비면 두 번째 부분 생략.
  const filename = buildDocxFilename(
    input.unitWorkDisplayId, input.unitWorkName, "프로그램사양서",
    { projectAbbr: input.projectAbbr },
  );

  return {
    ok:        true,
    buffer,
    filename,
    displayId: input.unitWorkDisplayId,
  };
}

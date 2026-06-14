/**
 * exports/task-matrix-data.ts — 과업대비표 입력 데이터 조립
 *
 * 역할:
 *   - DB 에서 프로젝트의 모든 과업(SFR) + 매핑된 요구사항(REF) 을 모아
 *     TaskMatrixExportInput 으로 매핑한다.
 *   - 매핑유형(1:1/1:N) · 반영여부(반영/미반영) 는 여기서 파생한다 → 빌더는 그대로 출력.
 *   - 옵션(includeTaskContent/includeReqContent) 에 따라 본문 필드를 조건부로 채운다.
 *
 * 구조 제약 (DB):
 *   - 요구사항은 task_id 단일 FK → 한 요구사항은 최대 1개 과업에 속함.
 *     따라서 매핑은 1:1 또는 1:N(과업→요구사항 다수) 만 가능, N:1 은 구조상 불가.
 *   - 과업 없이 존재하는 요구사항(task_id=NULL) 은 "(과업 미지정)" 그룹으로 맨 끝에 모음.
 *
 * 옵션 정책:
 *   - includeTaskContent=false : taskContent 미포함 (dtl_cn 조회는 어차피 findMany 에 포함)
 *   - includeReqContent=false  : reqContent 미포함
 *
 * 책임 분리:
 *   - 본 모듈 : DB → input 매핑 + 파생/옵션 처리 (HTTP 무관)
 *   - 라우트  : 권한·옵션 파싱·HTTP 응답
 *   - 빌더    : input → docx/xlsx Buffer
 */

import { prisma } from "@/lib/prisma";
import {
  buildTaskMatrixDocx,
  type TaskMatrixExportInput,
  type MatrixTaskGroup,
  type MatrixRequirement,
} from "@/lib/exports/docx/task-matrix";
import { buildTaskMatrixXlsx } from "@/lib/exports/xlsx/task-matrix";
import { filenameSafe, docNoFilenamePrefix } from "@/lib/exports/filename";
import { resolveDocMeta, type DocMetaSettings } from "@/lib/exports/doc-meta";
import { findDocMeta } from "@/lib/exports/doc-meta-catalog";

// ─── DB 미정비 영역 기본값 (요구사항 정의서와 동일 정책) ────
const TASK_MATRIX_FALLBACK = {
  copyright:       "Copyright ⓒ SPECODE",
  documentVersion: "v1.0",
  approverName:    "(미지정)",
  historyChange:   "최초 작성",
} as const;

// ─── 옵션 ────────────────────────────────────────────────────
export type TaskMatrixOptions = {
  /** 과업 본문(dtl_cn) 컬럼 포함 */
  includeTaskContent: boolean;
  /** 요구사항 본문(현행본 curncy_cn) 컬럼 포함 */
  includeReqContent:  boolean;
};

// ─── 결과 타입 ──────────────────────────────────────────────
export type TaskMatrixDataResult =
  | { ok: true;  input: TaskMatrixExportInput }
  | { ok: false; httpStatus: number; code: string; message: string };

/**
 * 프로젝트의 모든 과업 + 매핑 요구사항을 input 으로 조립.
 */
export async function buildTaskMatrixExportInput(
  projectId: string,
  opts:      TaskMatrixOptions,
): Promise<TaskMatrixDataResult> {
  // ── ① 프로젝트 + 설정 ──────────────────────────────────────
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

  // ── ② 과업 + 요구사항 병렬 조회 ─────────────────────────────
  // 과업: 표시 순서대로. 요구사항: 과업별 그룹화 위해 task_id 포함, 정렬 순서대로.
  const [tasks, requirements] = await Promise.all([
    prisma.tbRqTask.findMany({
      where:   { prjct_id: projectId },
      orderBy: [{ sort_ordr: "asc" }, { task_display_id: "asc" }],
      select: {
        task_id: true, task_display_id: true, task_nm: true,
        rfp_page_no: true, output_info_cn: true, dtl_cn: true,
      },
    }),
    prisma.tbRqRequirement.findMany({
      where:   { prjct_id: projectId },
      orderBy: [{ sort_ordr: "asc" }, { req_display_id: "asc" }],
      select: {
        req_id: true, task_id: true,
        req_display_id: true, req_nm: true, curncy_cn: true,
      },
    }),
  ]);

  // ── ③ 요구사항을 task_id 별로 그룹화 ────────────────────────
  // task_id=null 인 요구사항은 "(과업 미지정)" 그룹으로 별도 수집.
  const reqsByTaskId = new Map<string, typeof requirements>();
  const unassignedReqs: typeof requirements = [];
  for (const r of requirements) {
    if (!r.task_id) {
      unassignedReqs.push(r);
      continue;
    }
    if (!reqsByTaskId.has(r.task_id)) reqsByTaskId.set(r.task_id, []);
    reqsByTaskId.get(r.task_id)!.push(r);
  }

  // 요구사항 raw → MatrixRequirement 변환.
  // 본문은 원본(HTML/마크다운) 그대로 전달 — Word 빌더는 renderMarkdown 으로 서식 렌더,
  // Excel 빌더는 htmlToPlainText 로 평문화. (변환을 각 빌더 책임으로)
  function toMatrixReq(r: (typeof requirements)[number]): MatrixRequirement {
    return {
      reqDisplayId: r.req_display_id,
      reqName:      r.req_nm,
      reqContent:   opts.includeReqContent ? (r.curncy_cn ?? "") : undefined,
    };
  }

  // ── ④ 과업 → MatrixTaskGroup ───────────────────────────────
  let reflectedTasks = 0;
  const taskGroups: MatrixTaskGroup[] = tasks.map((t) => {
    const linked = reqsByTaskId.get(t.task_id) ?? [];
    const reqCount = linked.length;

    // 반영여부: 매핑된 요구사항이 1건 이상이면 "반영", 없으면 "미반영"
    const reflected = reqCount >= 1;
    if (reflected) reflectedTasks += 1;

    // 매핑유형: 1건=1:1, 2건 이상=1:N, 0건=미반영이라 "-"
    const mappingType = reqCount === 0 ? "-" : reqCount === 1 ? "1:1" : "1:N";

    return {
      taskDisplayId: t.task_display_id,
      taskName:      t.task_nm,
      rfpSource:     t.rfp_page_no ?? "",
      outputInfo:    t.output_info_cn ?? "",
      taskContent:   opts.includeTaskContent ? (t.dtl_cn ?? "") : undefined,
      mappingType,
      reflectStatus: reflected ? "반영" : "미반영",
      requirements:  linked.map(toMatrixReq),
    };
  });

  // ── ⑤ "(과업 미지정)" 그룹 — 과업 없이 존재하는 요구사항이 있을 때만 맨 끝에 추가
  if (unassignedReqs.length > 0) {
    taskGroups.push({
      taskDisplayId: "-",
      taskName:      "(과업 미지정)",
      rfpSource:     "",
      outputInfo:    "",
      taskContent:   opts.includeTaskContent ? "" : undefined,
      mappingType:   "-",
      reflectStatus: "-",
      requirements:  unassignedReqs.map(toMatrixReq),
      isUnassigned:  true,
    });
  }

  // ── ⑥ 메타 정리 ────────────────────────────────────────────
  const ordererName     = project.client_nm?.trim() || "발주처 미지정";
  const copyrightText   = settings?.copyright_holder?.trim()    || TASK_MATRIX_FALLBACK.copyright;
  const documentVersion = settings?.doc_version_default?.trim() || TASK_MATRIX_FALLBACK.documentVersion;
  const approverName    = settings?.approver_nm?.trim()         || TASK_MATRIX_FALLBACK.approverName;
  const now       = new Date();
  const writtenAt = now.toISOString().slice(0, 10);

  // 문서 메타/번호 — 카탈로그(과업대비표 기본값) ← 설정 오버라이드 머지 후 문서번호 생성
  const docMetaSettings: DocMetaSettings = {
    systemNm:      settings?.system_nm,
    systemCode:    settings?.system_code,
    docNoTemplate: settings?.doc_no_template,
    artifactMeta:  (settings?.artifact_meta_json ?? null) as DocMetaSettings["artifactMeta"],
  };
  const docMeta = resolveDocMeta({
    catalogMeta: findDocMeta("TASK_MATRIX"),
    artifactKey: "TASK_MATRIX",
    settings:    docMetaSettings,
    project:     { projectName: project.prjct_nm, projectAbbr: project.prjct_abrv },
    year:        now.getFullYear(),
  });

  // ── ⑦ input 조립 ──────────────────────────────────────────
  const input: TaskMatrixExportInput = {
    ordererName,
    copyright:   copyrightText,
    projectName: project.prjct_nm,
    projectAbbr: project.prjct_abrv ?? null,

    tasks: taskGroups,

    includeTaskContent: opts.includeTaskContent,
    includeReqContent:  opts.includeReqContent,

    docMeta,

    summary: {
      totalTasks:        tasks.length, // "(과업 미지정)" 의사그룹은 과업 수에서 제외
      reflectedTasks,
      unreflectedTasks:  tasks.length - reflectedTasks,
      totalRequirements: requirements.length,
    },

    history: [{
      version:  documentVersion,
      date:     writtenAt,
      change:   TASK_MATRIX_FALLBACK.historyChange,
      author:   approverName,
      approver: approverName,
    }],
  };

  return { ok: true, input };
}

// ─── 파일명 suffix — 옵션 켜진 항목 표기 ────────────────────
function buildOptionSuffix(opts: TaskMatrixOptions): string {
  const tags: string[] = [];
  if (opts.includeTaskContent) tags.push("과업본문");
  if (opts.includeReqContent)  tags.push("요구사항본문");
  return tags.length > 0 ? `(${tags.join("·")})` : "";
}

// ─── 헬퍼: input → docx Buffer + filename ───────────────────
export async function buildTaskMatrixDocxWithData(
  projectId: string,
  opts:      TaskMatrixOptions,
): Promise<
  | { ok: true; buffer: Buffer; filename: string; projectName: string }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const result = await buildTaskMatrixExportInput(projectId, opts);
  if (!result.ok) return result;
  const input = result.input;

  const buffer = await buildTaskMatrixDocx(input);
  // 파일명 prefix 우선순위: 문서번호(끝 일련번호 제외) → 약어 → 프로젝트명 → "프로젝트"
  //   문서번호 "GBMS_D406_001" → "GBMS_D406" 까지를 파일명에 사용 (요청: 두번째 코드까지 포함)
  const prefix =
    docNoFilenamePrefix(input.docMeta.docNo) ||
    filenameSafe(input.projectAbbr) ||
    filenameSafe(input.projectName) ||
    "프로젝트";
  const filename = `${prefix}_과업대비표${buildOptionSuffix(opts)}.docx`;

  return { ok: true, buffer, filename, projectName: input.projectName };
}

// ─── 헬퍼: input → xlsx Buffer + filename ───────────────────
export async function buildTaskMatrixXlsxWithData(
  projectId: string,
  opts:      TaskMatrixOptions,
): Promise<
  | { ok: true; buffer: Buffer; filename: string; projectName: string }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const result = await buildTaskMatrixExportInput(projectId, opts);
  if (!result.ok) return result;
  const input = result.input;

  const buffer = await buildTaskMatrixXlsx(input);
  // docx 와 동일 정책 — 문서번호(끝 일련번호 제외) 우선
  const prefix =
    docNoFilenamePrefix(input.docMeta.docNo) ||
    filenameSafe(input.projectAbbr) ||
    filenameSafe(input.projectName) ||
    "프로젝트";
  const filename = `${prefix}_과업대비표${buildOptionSuffix(opts)}.xlsx`;

  return { ok: true, buffer, filename, projectName: input.projectName };
}

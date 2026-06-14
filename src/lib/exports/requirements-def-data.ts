/**
 * exports/requirements-def-data.ts — 요구사항 정의서 입력 데이터 조립
 *
 * 역할:
 *   - DB 에서 프로젝트의 모든 요구사항 + 부모 과업 + 담당자 + (옵션) 변경이력을 모아
 *     RequirementsDefExportInput 으로 매핑한다.
 *   - 옵션(includeOriginal/includeHistory)에 따라 input 의 필드를 조건부로 채운다 →
 *     빌더는 분기 없이 input 에 들어온 필드만 출력하면 됨.
 *
 * 옵션 정책:
 *   - includeOriginal=false : originalContent 미포함 (변경 여부도 무관)
 *   - includeOriginal=true  : 자동 필터 — orgnl ≠ curncy 인 요구사항만 originalContent 채움
 *   - includeHistory=false  : histories 미포함, DB 조회 X (불필요 쿼리 회피)
 *   - includeHistory=true   : 모든 요구사항의 변경 이력 일괄 조회 후 분배
 *
 * 책임 분리:
 *   - 본 모듈 : DB → input 매핑 + 옵션 처리 (HTTP 무관)
 *   - 라우트  : 권한·옵션 파싱·HTTP 응답
 *   - 빌더    : input → docx Buffer
 */

import { prisma } from "@/lib/prisma";
import {
  buildRequirementsDefDocx,
  type RequirementsDefExportInput,
  type RequirementItem,
  type RequirementHistoryEntry,
} from "@/lib/exports/docx/requirements-def";
import { buildRequirementsDefXlsx } from "@/lib/exports/xlsx/requirements-def";
import { filenameSafe, docNoFilenamePrefix } from "@/lib/exports/filename";
import { resolveDocMeta, type DocMetaSettings } from "@/lib/exports/doc-meta";
import { findDocMeta } from "@/lib/exports/doc-meta-catalog";

// ─── 코드 → 라벨 매핑 ───────────────────────────────────────
const PRIORITY_LABELS: Record<string, string> = {
  HIGH:   "높음 (HIGH)",
  MEDIUM: "중간 (MEDIUM)",
  LOW:    "낮음 (LOW)",
};
const SOURCE_LABELS: Record<string, string> = {
  RFP:    "RFP",
  ADD:    "추가",
  CHANGE: "변경",
};

// ─── DB 미정비 영역 기본값 ──────────────────────────────────
export const REQUIREMENTS_DEF_FALLBACK = {
  copyright:       "Copyright ⓒ SPECODE",
  documentVersion: "v1.0",
  authorName:      "(미지정)",
  approverName:    "(미지정)",
  historyChange:   "최초 작성",
  unassigned:      "(미지정)",
  noTask:          "미분류",
} as const;

// ─── 옵션 ────────────────────────────────────────────────────
export type RequirementsDefOptions = {
  /** 원본(orgnl_cn) 포함 — true 면 변경된(orgnl ≠ curncy) 요구사항에만 originalContent 채움 */
  includeOriginal: boolean;
  /** 변경 이력 포함 — true 면 TbRqRequirementHistory 일괄 조회해 각 요구사항에 분배 */
  includeHistory:  boolean;
};

// ─── 결과 타입 ──────────────────────────────────────────────
export type RequirementsDefDataResult =
  | { ok: true;  input: RequirementsDefExportInput }
  | { ok: false; httpStatus: number; code: string; message: string };

/** 원본/현행본이 다른지 판정 — 둘 다 있고 trim 결과가 다를 때만 "수정됨". */
function isModified(orgnl: string | null | undefined, curncy: string | null | undefined): boolean {
  const o = (orgnl ?? "").trim();
  const c = (curncy ?? "").trim();
  // 둘 다 비면 수정 X. 한쪽만 있어도 수정으로 간주.
  if (!o && !c) return false;
  return o !== c;
}

/**
 * 프로젝트의 모든 요구사항 + 옵션 데이터를 input 으로 조립.
 */
export async function buildRequirementsDefExportInput(
  projectId: string,
  opts:      RequirementsDefOptions,
): Promise<RequirementsDefDataResult> {
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

  // ── ② 요구사항 + 부모 과업 (현행본/원본 포함 select) ───────
  const requirements = await prisma.tbRqRequirement.findMany({
    where:   { prjct_id: projectId },
    orderBy: [{ sort_ordr: "asc" }, { req_display_id: "asc" }],
    include: { task: { select: { task_nm: true } } },
  });

  const reqIds = requirements.map((r) => r.req_id);

  // ── ③ 변경 이력 raw 조회 (옵션 ON 시만) ─────────────────────
  // 멤버명 lookup 까지 끝낸 뒤 한 번에 RequirementHistoryEntry[] 로 가공하기 위해
  // 일단 raw 만 가져온 뒤 ⑤에서 그룹화한다.
  const rawHistories = (opts.includeHistory && reqIds.length > 0)
    ? await prisma.tbRqRequirementHistory.findMany({
        where:   { req_id: { in: reqIds } },
        select: {
          req_id: true, vrsn_no: true, creat_dt: true,
          vrsn_coment_cn: true, chg_mber_id: true,
        },
        orderBy: [{ creat_dt: "asc" }],
      })
    : [];

  // ── ④ 멤버명 일괄 조회 (담당자 + 변경 이력 작성자) ──────────
  const memberIds = Array.from(new Set([
    ...requirements.map((r) => r.asign_mber_id),
    ...rawHistories.map((h) => h.chg_mber_id),
  ].filter((id): id is string => !!id)));

  const members = memberIds.length === 0 ? [] : await prisma.tbCmMember.findMany({
    where:  { mber_id: { in: memberIds } },
    select: { mber_id: true, mber_nm: true, email_addr: true },
  });
  const memberMap = new Map(members.map((m) => [m.mber_id, m]));
  function memberName(id: string | null | undefined): string {
    if (!id) return REQUIREMENTS_DEF_FALLBACK.unassigned;
    const m = memberMap.get(id);
    if (!m) return REQUIREMENTS_DEF_FALLBACK.unassigned;
    return m.mber_nm?.trim() || m.email_addr || REQUIREMENTS_DEF_FALLBACK.unassigned;
  }

  // 변경이력 → req_id 별 그룹화 (멤버명까지 채운 최종 형태)
  const historiesByReqId = new Map<string, RequirementHistoryEntry[]>();
  for (const h of rawHistories) {
    if (!historiesByReqId.has(h.req_id)) historiesByReqId.set(h.req_id, []);
    historiesByReqId.get(h.req_id)!.push({
      version:     h.vrsn_no,
      date:        h.creat_dt.toISOString().slice(0, 10),
      comment:     h.vrsn_coment_cn ?? "",
      changerName: memberName(h.chg_mber_id),
    });
  }

  // ── ⑤ 요구사항 → RequirementItem ───────────────────────────
  const items: RequirementItem[] = requirements.map((r) => {
    const orgnl  = r.orgnl_cn ?? "";
    const curncy = r.curncy_cn ?? "";
    const modified = isModified(r.orgnl_cn, r.curncy_cn);

    // 원본은 옵션 ON + 변경된 경우만 채움
    const originalContent = (opts.includeOriginal && modified) ? orgnl : undefined;

    // 이력은 옵션 ON 시 항상 (빈 배열도 그대로 — 빌더가 "(이력 없음)" 안내)
    const histories = opts.includeHistory ? (historiesByReqId.get(r.req_id) ?? []) : undefined;

    return {
      displayId:      r.req_display_id,
      name:           r.req_nm,
      parentTaskName: r.task?.task_nm ?? REQUIREMENTS_DEF_FALLBACK.noTask,
      priorityLabel:  PRIORITY_LABELS[r.priort_code] ?? r.priort_code,
      sourceLabel:    SOURCE_LABELS[r.src_code]      ?? r.src_code,
      rfpPage:        r.rfp_page_no ?? "",
      assigneeName:   memberName(r.asign_mber_id),
      sortOrder:      r.sort_ordr ?? 0,

      currentContent:  curncy,
      originalContent,
      wasModified:     modified,
      histories,
    };
  });

  // ── ⑥ 메타 정리 ────────────────────────────────────────────
  const ordererName     = project.client_nm?.trim() || "발주처 미지정";
  const copyrightText   = settings?.copyright_holder?.trim()    || REQUIREMENTS_DEF_FALLBACK.copyright;
  const documentVersion = settings?.doc_version_default?.trim() || REQUIREMENTS_DEF_FALLBACK.documentVersion;
  const approverName    = settings?.approver_nm?.trim()         || REQUIREMENTS_DEF_FALLBACK.approverName;
  const now       = new Date();
  const writtenAt = now.toISOString().slice(0, 10);

  // 문서 메타/번호 — 카탈로그(요구사항정의서 기본값) ← 설정 오버라이드 머지 후 문서번호 생성
  const docMetaSettings: DocMetaSettings = {
    systemNm:      settings?.system_nm,
    systemCode:    settings?.system_code,
    docNoTemplate: settings?.doc_no_template,
    artifactMeta:  (settings?.artifact_meta_json ?? null) as DocMetaSettings["artifactMeta"],
  };
  const docMeta = resolveDocMeta({
    catalogMeta: findDocMeta("REQUIREMENTS_DEF"),
    artifactKey: "REQUIREMENTS_DEF",
    settings:    docMetaSettings,
    project:     { projectName: project.prjct_nm, projectAbbr: project.prjct_abrv },
    year:        now.getFullYear(),
  });

  // ── ⑦ input 조립 ──────────────────────────────────────────
  const input: RequirementsDefExportInput = {
    ordererName,
    copyright:   copyrightText,
    projectName: project.prjct_nm,
    projectAbbr: project.prjct_abrv ?? null,

    requirements: items,

    includeOriginal: opts.includeOriginal,
    includeHistory:  opts.includeHistory,

    documentVersion,
    writtenAt,
    // 작성·승인 모두 PM(설정의 기본 승인자)으로 통일. 발행/이력 시스템이 이 값을 사용.
    authorName:   approverName,
    approverName,
    docMeta,
    history: [{
      version:  documentVersion,
      date:     writtenAt,
      change:   REQUIREMENTS_DEF_FALLBACK.historyChange,
      author:   approverName,
      approver: approverName,
    }],
  };

  return { ok: true, input };
}

// ─── 파일명 suffix — 옵션 켜진 항목 표기 ────────────────────
function buildOptionSuffix(opts: RequirementsDefOptions): string {
  const tags: string[] = [];
  if (opts.includeOriginal) tags.push("원본");
  if (opts.includeHistory)  tags.push("이력");
  return tags.length > 0 ? `(${tags.join("·")})` : "";
}

// ─── 헬퍼: input → docx Buffer + filename ───────────────────
/**
 * 요구사항 정의서 docx Buffer + 다운로드 파일명을 한 번에.
 * 옵션은 호출부에서 query param 으로 받아 전달.
 */
export async function buildRequirementsDefDocxWithHistory(
  projectId: string,
  opts:      RequirementsDefOptions,
): Promise<
  | { ok: true; buffer: Buffer; filename: string; projectName: string }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const result = await buildRequirementsDefExportInput(projectId, opts);
  if (!result.ok) return result;
  const input = result.input;

  const buffer = await buildRequirementsDefDocx(input);
  // 파일명 prefix 우선순위: 문서번호(끝 일련번호 제외) → 약어 → 프로젝트명 → "프로젝트"
  //   문서번호 "GBMS_A301_001" → "GBMS_A301" 까지를 파일명에 사용 (요청: 두번째 코드까지 포함)
  const prefix =
    docNoFilenamePrefix(input.docMeta.docNo) ||
    filenameSafe(input.projectAbbr) ||
    filenameSafe(input.projectName) ||
    "프로젝트";
  const filename = `${prefix}_요구사항정의서${buildOptionSuffix(opts)}.docx`;

  return {
    ok: true,
    buffer,
    filename,
    projectName: input.projectName,
  };
}

// ─── 헬퍼: input → xlsx Buffer + filename ───────────────────
/**
 * 요구사항 정의서 xlsx Buffer + 다운로드 파일명을 한 번에.
 * 시트 3개 (표지·변경이력·요구사항). 데이터 매핑은 docx 와 100% 동일.
 */
export async function buildRequirementsDefXlsxWithHistory(
  projectId: string,
  opts:      RequirementsDefOptions,
): Promise<
  | { ok: true; buffer: Buffer; filename: string; projectName: string }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const result = await buildRequirementsDefExportInput(projectId, opts);
  if (!result.ok) return result;
  const input = result.input;

  const buffer = await buildRequirementsDefXlsx(input);
  // docx 와 동일 정책 — 문서번호(끝 일련번호 제외) 우선
  const prefix =
    docNoFilenamePrefix(input.docMeta.docNo) ||
    filenameSafe(input.projectAbbr) ||
    filenameSafe(input.projectName) ||
    "프로젝트";
  const filename = `${prefix}_요구사항정의서${buildOptionSuffix(opts)}.xlsx`;

  return {
    ok: true,
    buffer,
    filename,
    projectName: input.projectName,
  };
}

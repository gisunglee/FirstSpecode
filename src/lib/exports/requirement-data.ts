/**
 * exports/requirement-data.ts — 요구사항 출력 양식의 입력 데이터 조립
 *
 * 역할:
 *   - DB(요구사항·과업·프로젝트·설정·멤버) 에서 docx 양식이 필요로 하는 모든 데이터를
 *     모아서 RequirementExportInput 객체로 반환한다.
 *   - 동일 로직이 두 곳에서 필요하기 때문에 함수로 분리:
 *       1) GET  /requirements/[reqId]/export/docx       — 현재 시점 데이터로 docx 빌드
 *       2) POST /documents/release                       — 발행 시점 스냅샷에 박제
 *   - 변경이력(history) 은 fallback 1행으로 채워서 반환한다.
 *     호출부가 발행 이력(TbDsDocumentRelease) 을 조회해서 덮어쓸 수 있도록 함.
 *
 * 책임 분리:
 *   - 본 모듈 : DB → 양식 입력 객체 매핑 (HTTP 무관)
 *   - 라우트  : 권한·요청 검증·HTTP 응답
 *   - 빌더    : 양식 객체 → docx Buffer (lib/exports/docx/requirement.ts)
 *
 * 에러:
 *   Response 를 직접 반환하지 않고 Result 객체로 분리.
 *   라우트 측이 apiError 로 변환해서 응답.
 */

import { prisma } from "@/lib/prisma";
import type { RequirementExportInput } from "@/lib/exports/docx/requirement";

// ─── 코드 → 라벨 매핑 ────────────────────────────────────────
// 화면(requirements/page.tsx) 와 동일한 라벨. 향후 공통 코드 테이블로 옮기면 한 곳에서 관리.
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
// 프로젝트 설정에 값이 없을 때 사용하는 코드 fallback.
// 외부에 노출 — 발행 API 측에서도 동일 fallback 정책을 쓰기 위해 export.
export const REQUIREMENT_EXPORT_FALLBACK = {
  copyright:       "Copyright ⓒ SPECODE",
  documentVersion: "v1.0",
  authorName:      "(미지정)",
  approverName:    "(미지정)",
  historyChange:   "최초 작성",
} as const;

// ─── 변경이력 표 분기에 쓰이는 "본문" 필드 목록 ──────────────
// [Word 출력] 시 직전 발행본 snapshot 과 현재 input 을 비교해 본문 변경 여부를 판정한다.
// 비교 대상은 "양식 본문 영역에 직접 영향 가는 필드" 만 — 메타(저작권/문서버전/작성정보)나
// 변경이력 자체는 제외해야 자기 참조 무한루프나 무의미한 변경 감지를 피한다.
//
// keyof RequirementExportInput 타입 잠금 — 새 필드 추가 시 이 배열에도 등록하도록 컴파일 시
// 강제 (양식이 진화해도 비교 누락이 없게 함).
export const REQUIREMENT_CONTENT_FIELDS: readonly (keyof RequirementExportInput)[] = [
  "ordererName",
  "projectName",
  "reqDisplayId",
  "reqName",
  "parentTaskName",
  "priorityLabel",
  "sourceLabel",
  "rfpPage",
  "assigneeName",
  "sortOrder",
  "detailSpec",
] as const;

/**
 * 직전 발행 시점 snapshot 과 현재 input 을 비교해 본문이 변경됐는지 판정.
 *
 * 양식 진화 호환:
 *   - snapshot 에 없는 필드 (이후 추가된 컬럼) 는 비교 스킵 — 옛 박제본을 부당하게 "변경됨"
 *     으로 잘못 판정하지 않는다.
 *   - current 에 없는 필드 (양식에서 제거된 컬럼) 도 비교 스킵.
 *   - 결과: 양식이 진화해도 옛 박제본과 정상 비교 가능.
 *
 * @param snapshot  TbDsDocumentRelease.snapshot_data 에서 복원된 부분 객체
 * @param current   현재 시점에서 buildRequirementExportInput() 으로 만든 input
 * @returns         본문 변경 있으면 true (= "현재 작업 중" 행 표시 필요)
 */
export function hasContentChanged(
  snapshot: Partial<RequirementExportInput>,
  current:  RequirementExportInput,
): boolean {
  for (const field of REQUIREMENT_CONTENT_FIELDS) {
    if (!(field in snapshot)) continue;  // 옛 박제본 호환 — 추가된 필드 비교 스킵
    if (!(field in current))  continue;  // 양식에서 제거된 필드 비교 스킵
    if (snapshot[field] !== current[field]) return true;
  }
  return false;
}

// ─── 결과 타입 ──────────────────────────────────────────────
export type RequirementExportDataResult =
  | { ok: true;  input: RequirementExportInput }
  | { ok: false; httpStatus: number; code: string; message: string };

/**
 * DB 에서 요구사항 1건의 양식 입력 객체를 조립한다.
 *
 * @param projectId  프로젝트 ID (URL 검증 + 경계 일관성용)
 * @param reqId      요구사항 ID
 * @returns          성공 시 input, 실패 시 httpStatus + code + message
 */
export async function buildRequirementExportInput(
  projectId: string,
  reqId: string
): Promise<RequirementExportDataResult> {
  // ① 요구사항 + 상위 과업 — 과업의 asign_mber_id 도 같이 가져와 작성자 fallback chain 에 사용
  const req = await prisma.tbRqRequirement.findUnique({
    where:   { req_id: reqId },
    include: { task: { select: { task_nm: true, asign_mber_id: true } } },
  });
  if (!req || req.prjct_id !== projectId) {
    return {
      ok: false, httpStatus: 404, code: "NOT_FOUND",
      message: "요구사항을 찾을 수 없습니다.",
    };
  }

  // ② 프로젝트 / 출력 설정 / 관련 멤버명 병렬 조회
  //   멤버는 요구사항 담당자 + 과업 담당자(있을 시) 를 한 번의 findMany 로 가져온다
  const memberIds = [req.asign_mber_id, req.task?.asign_mber_id ?? null]
    .filter((id): id is string => !!id);

  const [project, settings, members] = await Promise.all([
    prisma.tbPjProject.findUnique({
      where:  { prjct_id: projectId },
      select: { prjct_nm: true, client_nm: true },
    }),
    prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: {
        copyright_holder:    true,
        doc_version_default: true,
        approver_nm:         true,
      },
    }),
    memberIds.length
      ? prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          // mber_nm 비어있을 때를 위한 email_addr fallback 까지 한 번에 조회
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : Promise.resolve([]),
  ]);

  if (!project) {
    return {
      ok: false, httpStatus: 404, code: "NOT_FOUND",
      message: "프로젝트를 찾을 수 없습니다.",
    };
  }

  // ③ 멤버 ID → 표시 이름 lookup (mber_nm 우선, 없으면 email_addr)
  const memberMap = new Map(members.map((m) => [m.mber_id, m]));
  function memberDisplayName(id: string | null | undefined): string | null {
    if (!id) return null;
    const m = memberMap.get(id);
    if (!m) return null;
    return m.mber_nm?.trim() || m.email_addr || null;
  }

  // ④ 양식 입력 데이터 조립
  // 발주처: 프로젝트의 client_nm — 비어있으면 "발주처 미지정"
  const ordererName = project.client_nm?.trim() || "발주처 미지정";

  // 메타 표의 "담당자" 컬럼 — 요구사항 자신의 담당자만 사용
  const assigneeName = memberDisplayName(req.asign_mber_id) ?? "미지정";

  // 표지/변경이력 표의 "작성자" 컬럼 — 우선순위 기반 fallback chain
  //   요구사항 담당자 → 부모 과업 담당자 → 코드 기본값 "(미지정)"
  const authorName = memberDisplayName(req.asign_mber_id)
                  ?? memberDisplayName(req.task?.asign_mber_id)
                  ?? REQUIREMENT_EXPORT_FALLBACK.authorName;

  // 출력 설정값 — 미입력 시 코드 fallback
  const copyrightText   = settings?.copyright_holder?.trim()    || REQUIREMENT_EXPORT_FALLBACK.copyright;
  const documentVersion = settings?.doc_version_default?.trim() || REQUIREMENT_EXPORT_FALLBACK.documentVersion;
  // 승인자: 프로젝트 설정 "기본 승인자(PM)" → 미입력 시 fallback "(미지정)"
  // (발행 이력의 approver_nm 가 따로 있으면 호출부에서 history 항목에 그 값을 사용)
  const approverName    = settings?.approver_nm?.trim()         || REQUIREMENT_EXPORT_FALLBACK.approverName;

  const writtenAt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const input: RequirementExportInput = {
    ordererName,
    copyright:   copyrightText,
    projectName: project.prjct_nm,

    reqDisplayId:   req.req_display_id,
    reqName:        req.req_nm,
    parentTaskName: req.task?.task_nm ?? "미분류",
    priorityLabel:  PRIORITY_LABELS[req.priort_code] ?? req.priort_code,
    sourceLabel:    SOURCE_LABELS[req.src_code]      ?? req.src_code,
    rfpPage:        req.rfp_page_no ?? "",
    assigneeName,
    sortOrder:      req.sort_ordr ?? 0,
    detailSpec:     req.spec_cn ?? "",

    documentVersion,
    writtenAt,
    authorName,
    approverName,
    // 변경이력 fallback 1행 — 발행이력이 있는 경우 호출부에서 덮어씀
    history: [{
      version:  documentVersion,
      date:     writtenAt,
      change:   REQUIREMENT_EXPORT_FALLBACK.historyChange,
      author:   authorName,
      approver: approverName,
    }],
  };

  return { ok: true, input };
}

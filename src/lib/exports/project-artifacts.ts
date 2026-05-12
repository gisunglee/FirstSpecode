/**
 * exports/project-artifacts.ts — 프로젝트 단위 산출물 카탈로그
 *
 * 역할:
 *   - 문서실(/document-library) 상단 "프로젝트 산출물" 영역에 노출되는 카드 메타데이터.
 *   - 새 산출물 추가 = 배열에 1줄만 추가 (페이지·다이얼로그 코드 수정 X).
 *
 * 한 산출물의 다중 출력 형식:
 *   - 한 산출물(예: 요구사항 정의서) 이 docx + xlsx 동시에 제공될 수 있음.
 *   - formats 배열에 형식별로 1줄씩 — 카드에는 각 형식 버튼이 자동 노출.
 *
 * 옵션:
 *   - 카탈로그에 options 가 있으면 카드 클릭 시 옵션 다이얼로그 오픈.
 *   - 옵션 값은 query string 으로 전달 (?key=true&...).
 */

export type ProjectArtifactKey =
  | "REQUIREMENTS_DEF"   // 요구사항 정의서
  | "TASK_MATRIX"        // 과업대비표
  | "TRACE_MATRIX";      // 요구사항 추적표

/** 산출물 출력 형식. 향후 PDF 추가 시 union 에 한 줄 추가. */
export type ArtifactFormat = "docx" | "xlsx";

/** 한 형식의 다운로드 정보 — API 경로 + 폴백 파일명. */
export type ArtifactFormatSpec = {
  type:             ArtifactFormat;
  /** 카드 버튼 라벨 (예: "Word ↓", "Excel ↓") */
  label:            string;
  apiPath:          (projectId: string) => string;
  /** 폴백 파일명 — 서버 disposition 가 없을 때만 사용 */
  fallbackFilename: (projectName: string) => string;
};

/** 옵션 다이얼로그가 묻는 boolean 토글 1개 정의. */
export type ArtifactOption = {
  key:           string;       // query param 키 (예: "includeOriginal")
  label:         string;       // 체크박스 라벨
  description?:  string;       // 라벨 아래 작은 설명
  defaultValue:  boolean;      // 다이얼로그 초기 체크 상태
};

export type ProjectArtifact = {
  key:         ProjectArtifactKey;
  title:       string;
  description: string;
  icon:        string;
  enabled:     boolean;
  /** 형식별 다운로드 정의. 하나 이상 필수 — 카드는 형식별 버튼을 모두 표시. */
  formats:     ArtifactFormatSpec[];
  /** 다운로드 옵션 — 있으면 카드 클릭 시 다이얼로그 오픈. 없으면 즉시 다운로드. */
  options?:    ArtifactOption[];
  /**
   * 발행 이력 보기 지원 시 그 산출물의 ReleaseDocKind.
   * 있으면 카드에 [이력] 버튼 노출 → ReleaseHistoryDialog 오픈.
   * 없으면 발행/이력 시스템 미연결 산출물.
   */
  historyDocKind?: "REQUIREMENT" | "UNIT_WORK" | "REQUIREMENTS_DEF";
};

export const PROJECT_ARTIFACTS: ProjectArtifact[] = [
  {
    key:         "REQUIREMENTS_DEF",
    title:       "요구사항 정의서",
    description: "고객 협의 결과(현행본) + 원본·변경이력 옵션",
    icon:        "📋",
    enabled:     true,
    formats: [
      {
        type:             "docx",
        label:            "Word ↓",
        apiPath:          (id) => `/api/projects/${id}/artifacts/requirements-def/docx`,
        fallbackFilename: (name) => `${name}_요구사항정의서.docx`,
      },
      {
        type:             "xlsx",
        label:            "Excel ↓",
        apiPath:          (id) => `/api/projects/${id}/artifacts/requirements-def/xlsx`,
        fallbackFilename: (name) => `${name}_요구사항정의서.xlsx`,
      },
    ],
    options: [
      {
        key:          "includeOriginal",
        label:        "원본 포함",
        description:  "원본과 현행본이 다른 요구사항만 자동 포함됩니다.",
        defaultValue: false,
      },
      {
        key:          "includeHistory",
        label:        "변경 이력 포함",
        description:  "협의 과정의 모든 버전 변화를 요구사항별로 기록합니다.",
        defaultValue: false,
      },
    ],
    // 정의서는 발행 시스템 연결됨 — 카드에 [이력] 버튼 노출
    historyDocKind: "REQUIREMENTS_DEF",
  },
  {
    key:         "TASK_MATRIX",
    title:       "과업대비표",
    description: "과업 × 요구사항/단위업무 매트릭스",
    icon:        "📊",
    enabled:     false,
    formats: [
      {
        type:             "docx",
        label:            "Word ↓",
        apiPath:          (id) => `/api/projects/${id}/artifacts/task-matrix/docx`,
        fallbackFilename: (name) => `${name}_과업대비표.docx`,
      },
    ],
  },
  {
    key:         "TRACE_MATRIX",
    title:       "요구사항 추적표",
    description: "요구사항 → 단위업무 → 화면 → 기능 추적",
    icon:        "🔗",
    enabled:     false,
    formats: [
      {
        type:             "docx",
        label:            "Word ↓",
        apiPath:          (id) => `/api/projects/${id}/artifacts/trace-matrix/docx`,
        fallbackFilename: (name) => `${name}_요구사항추적표.docx`,
      },
    ],
  },
];

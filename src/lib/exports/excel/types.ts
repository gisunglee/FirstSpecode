/**
 * 엑셀 다운로드 — 공통 타입 정의
 *
 * 역할:
 *   - 모든 entity 의 export 모듈이 공유하는 타입 (ExcelColumn, ExportConfig)
 *   - 한 번에 export 가능한 행 상한선(MAX_EXPORT_ROWS) 같은 글로벌 상수
 *
 * 설계 의도:
 *   - 컬럼 메타와 데이터 fetch 만 entity 별로 다르고, 그 외 동작은 모두 공통
 *   - 그래서 entity 모듈은 "ExportConfig 한 덩어리" 만 export 하면 끝
 */

import type { NextRequest } from "next/server";

// ─── 컬럼 한 칸의 메타 ───────────────────────────────────────────────────────

/**
 * ExcelColumn — 워크시트 한 컬럼의 정의
 *
 *   - key    : 디버깅·로깅용 식별자. 셀 값의 기본 소스이기도 함 (format 미지정 시 row[key])
 *   - header : 시트에 표시될 한글 라벨 ("과업 ID" 등)
 *   - width  : 글자 수 기준 너비. 미지정 시 16
 *   - format : row → 셀 값 변환기. 객체 join, 라벨 매핑, Date 그대로 등에 사용
 */
export type ExcelColumn<T> = {
  key:     string;
  header:  string;
  width?:  number;
  format?: (row: T) => string | number | Date | boolean | null;
};

// ─── entity 별 export 설정 (createExportRoute 의 단일 입력) ─────────────────

/**
 * ExportConfig — entity 1개당 1개씩 작성하는 설정 객체
 *
 *   - permission   : 검사할 권한 키. 보통 "content.export"
 *   - resolveScope : URL params → 권한 체크 대상 식별. projectId 가 있으면 해당
 *                    프로젝트 권한 체크, 없으면 시스템 레벨로 분기
 *   - fetchData    : 검색·필터·정렬을 적용한 "전체" 행 조회.
 *                    페이지네이션은 적용하지 말 것 — export 의 핵심은 전량.
 *                    화면 GET 과 동일 결과를 보장하기 위해 같은 service 함수를 호출.
 *                    ctx.mberId 는 권한 체크 통과 후의 인증 사용자 — "내 담당"
 *                    같은 동적 필터 처리에 사용.
 *   - sheetName    : 워크시트 이름. 한글 OK
 *   - entityKey    : 다운로드 파일명 prefix. 영문 ("tasks", "requirements" 등)
 *   - columns      : ExcelColumn<T>[]. 시트 헤더와 셀 값 정의
 */
export type ExportConfig<T, P> = {
  permission:   string;
  resolveScope: (params: P) => { projectId?: string };
  fetchData:    (ctx: { req: NextRequest; params: P; mberId: string }) => Promise<T[]>;
  sheetName:    string;
  entityKey:    string;
  columns:      ExcelColumn<T>[];
};

// ─── 글로벌 상수 ──────────────────────────────────────────────────────────────

/**
 * 한 번의 다운로드로 export 가능한 최대 행 수.
 *
 * 메모리·응답시간 보호를 위한 상한선. 운영 데이터가 늘어나서 정상 사용자가 자주
 * 걸리면 재검토. 초과 시 EXPORT_TOO_LARGE 400 으로 응답하여 필터를 좁히도록 안내.
 */
export const MAX_EXPORT_ROWS = 10_000;

/**
 * 엑셀 다운로드 — 파일명 규칙
 *
 * 역할:
 *   - "<entityKey>_YYYYMMDD_HHmm.xlsx" 형태의 파일명 생성
 *   - 한글 entity 라벨이 아닌 영문 키만 사용 (Content-Disposition 인코딩 회피)
 */

/**
 * buildExportFilename — 다운로드 파일명 생성
 *
 *   예) buildExportFilename("tasks") → "tasks_20260508_1432.xlsx"
 *
 * 영문 entity 키 + 타임스탬프만 쓰는 이유:
 *   Content-Disposition 헤더에 한글이 들어가면 RFC 5987 인코딩이 필요하고
 *   브라우저별로 깨짐 가능성이 있다. 사용자가 시트 안에서 한글 라벨을 보면
 *   엑셀이라는 점은 충분히 인지되므로, 파일명 자체는 단순하게 유지.
 */
export function buildExportFilename(entityKey: string, now: Date = new Date()): string {
  const pad   = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${entityKey}_${stamp}.xlsx`;
}

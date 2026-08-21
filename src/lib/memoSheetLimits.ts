/**
 * memoSheetLimits.ts — 엑셀형 메모(sheet_data) 용량 제한
 *
 * 왜 필요한가:
 *   Fortune-sheet에 이미지를 삽입하면 base64 문자열 그대로 셀 데이터에 박혀서 그대로
 *   DB(jsonb 컬럼)에 저장된다. 웹 에디터(RichEditor)는 이미지 삽입 시점에 800px/JPEG로
 *   자동 축소하지만, Fortune-sheet는 삽입 경로를 가로챌 수 있는 훅이 없어(라이브러리
 *   자체 파일선택 input이 내부에 숨어있음) 같은 방식을 쓸 수 없다. 그래서 대신 저장
 *   시점에 용량을 검사해서, 너무 크면 아예 저장을 막는다.
 *
 * 프론트(MemoDetailPanel 저장 직전)와 백엔드(POST/PUT API) 양쪽에서 동일하게 검사한다 —
 * 프론트는 즉시 피드백용, 백엔드는 우회 방지용 방어선.
 *
 * 값이 타이트한 이유: Supabase 무료 티어 DB 용량 한도 때문에 — 이 데이터가 그대로
 * jsonb 컬럼에 누적되므로, 메모 하나하나를 최대한 가볍게 유지한다(2026-08-21 확정).
 */

export const MEMO_SHEET_MAX_IMAGE_BYTES = 700 * 1024;        // 이미지 1개당(base64 문자열 길이 기준) — 캡처 스샷 기준 2배 여유
export const MEMO_SHEET_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024; // 시트 전체 JSON 기준 — 이미지 제외 텍스트/셀 데이터는 사실상 ~800KB까지

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

export type MemoSheetSizeCheck = { ok: true } | { ok: false; message: string };

export function checkMemoSheetSize(sheetData: unknown): MemoSheetSizeCheck {
  if (!Array.isArray(sheetData)) return { ok: true };

  for (const sheet of sheetData) {
    const images = (sheet as { images?: unknown })?.images;
    if (!Array.isArray(images)) continue;
    for (const img of images) {
      const src = (img as { src?: unknown })?.src;
      if (typeof src === "string" && src.length > MEMO_SHEET_MAX_IMAGE_BYTES) {
        return {
          ok: false,
          message: `삽입한 이미지 용량이 너무 큽니다(약 ${formatBytes(src.length)}). ${formatBytes(MEMO_SHEET_MAX_IMAGE_BYTES)} 이하 이미지로 다시 삽입해 주세요.`,
        };
      }
    }
  }

  const totalSize = JSON.stringify(sheetData).length;
  if (totalSize > MEMO_SHEET_MAX_TOTAL_BYTES) {
    return {
      ok: false,
      message: `표 전체 용량이 너무 큽니다(약 ${formatBytes(totalSize)}). 이미지를 줄이거나 내용을 줄여서 다시 저장해 주세요.`,
    };
  }

  return { ok: true };
}

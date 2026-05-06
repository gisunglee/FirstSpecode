/**
 * standard-info 화면 전용 공유 상수·타입·헬퍼.
 *
 * 분리 의도:
 *   - page.tsx 가 690 → 300줄대로 줄어듦
 *   - 모달/상세 다이얼로그가 이 상수들을 같이 임포트해서 정의 1회 유지
 *
 * 명명 이력:
 *   - 2026-05-05 BUS_DIV 6종 고정 코드 → biz_ctgry_nm 자유 텍스트로 전환.
 *     색상도 hardcoded 매핑 → 텍스트 해시 자동 매핑(getCategoryColor) 으로 변경.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type StdInfo = {
  stdInfoId:     string;
  stdInfoCode:   string;
  stdBgngDe:     string;
  stdEndDe:      string | null;
  stdInfoNm:     string;
  bizCtgryNm:    string;       // 업무 카테고리명 (자유 텍스트)
  stdDataTyCode: string;
  mainStdVal:    string | null;
  subStdVal:     string | null;
  stdInfoDc:     string | null;
  useYn:         string;
  creatDt:       string;
  mdfcnDt:       string | null;
};

// ── 자료 유형 옵션 (이건 시스템 고정값) ──────────────────────────────────────

export const DATA_TYPE_OPTIONS = [
  { value: "STRING", label: "문자열" },
  { value: "NUMBER", label: "숫자" },
  { value: "YN",     label: "Y/N" },
  { value: "DATE",   label: "일자" },
  { value: "CODE",   label: "코드" },
  { value: "JSON",   label: "JSON" },
] as const;

export const DATA_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DATA_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// ── 카테고리 색상 — 텍스트 해시 기반 자동 매핑 ───────────────────────────────
//
// 5색 팔레트 중 하나를 텍스트 해시로 결정. 같은 카테고리명은 어느 화면에서도
// 항상 같은 색으로 표시되어 시각 인식이 일관된다.
//
// 운영 부담 0 — 운영자가 색을 등록하지 않아도 자동 부여.
// 충돌(같은 색이 다른 분류에 배정) 가능성은 있지만 텍스트가 다르므로 식별 가능.

const COLOR_PALETTE = ["brand", "info", "success", "warning", "error"] as const;

// djb2 단순 해시 — 같은 입력은 항상 같은 인덱스로 환원
function hashIdx(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h) % COLOR_PALETTE.length;
}

export function getCategoryColor(name: string): { bg: string; text: string } {
  // 빈 문자열은 무채색 톤 — 데이터 누락 시각화
  if (!name) {
    return {
      bg:   "var(--color-bg-muted)",
      text: "var(--color-text-tertiary)",
    };
  }
  const tone = COLOR_PALETTE[hashIdx(name)];
  return {
    bg:   `var(--color-${tone}-subtle)`,
    text: `var(--color-${tone})`,
  };
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

// YYYYMMDD → YYYY-MM-DD (다른 형식이면 원본 그대로 반환)
export function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const s = d.replace(/-/g, "");
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return d;
}

// 오늘 날짜 YYYYMMDD — 모달 신규 등록 시 시작일 기본값
export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ── 카테고리 distinct 추출 — 자동완성 옵션 소스 ──────────────────────────────
// 빈 문자열은 제거, 정렬 후 반환 — 모달 datalist / 필터 select 양쪽에서 사용.
export function distinctCategories(items: { bizCtgryNm: string }[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const v = it.bizCtgryNm?.trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

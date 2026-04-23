"use client";

/**
 * TableInsightBadges — DB 테이블 매핑 인사이트의 공통 배지/상수 집합
 *
 * 역할:
 *   - IO_META:           IN/OUT/INOUT 한 곳에서만 정의 (색·라벨·아이콘)
 *   - REF_TYPE_META:     FUNCTION/AREA/SCREEN 한 곳에서만 정의
 *   - IoProfileIcon:     IO 프로필(READ_HEAVY/WRITE_HEAVY/MIXED/NONE) 아이콘 배지
 *   - CoverageText:      컬럼 활용률 "80%(12/15)" 텍스트
 *   - RefTypeBadge:      FUNCTION/AREA/SCREEN 타입 배지 — 3개 컴포넌트가 공유
 *   - IoBadge:           IN/OUT/INOUT 카운트 배지 (UsageSection, ColumnUsageDialog 공유)
 *   - USAGE_STALE_TIME:  db-table-usage / db-column-usage 쿼리 공통 staleTime
 *
 * 설계 원칙:
 *   - 색상은 모두 semantic 토큰 (--color-info/success/warning/error/brand) 사용.
 *     3테마(light/dark/dark-purple)에서 자동 대응되며, DS 토큰 변경 시 한 파일만 바뀜.
 *   - IO/RefType 의 색·라벨이 여러 파일에 퍼지지 않도록 여기를 단일 진실의 원천(SSOT)으로 둔다.
 */

import type { IoProfile } from "@/lib/dbTableUsage";

// ── 공통 상수 ────────────────────────────────────────────────────────────────

/**
 * useQuery.staleTime — usage 계열 쿼리가 공유하는 기본값.
 *   · 편집 중에도 카드/배지가 급격히 깜빡이지 않도록 30초 유지
 *   · 저장 시점에는 상세 페이지가 invalidateQueries 로 직접 갱신
 */
export const USAGE_STALE_TIME = 30 * 1000;

// ── IO 메타 (IN/OUT/INOUT) ───────────────────────────────────────────────────

export type IoSe = "INPUT" | "OUTPUT" | "INOUT" | "";

/**
 * IO 유형별 시각·의미 매핑.
 *   - token/tokenBorder:  semantic 토큰 (3테마 자동 대응)
 *   - icon:               이모지. 스택 바·라벨에 함께 쓰인다
 *   - label:              사용자에게 보이는 한글 명칭
 *
 * 의미 매핑 근거:
 *   · INPUT  (저장) → info   — "입력" 은 데이터가 들어가는 이벤트, DB 관점에서 기록/수정
 *   · OUTPUT (조회) → success — 가장 흔한 동작이며 "정상 흐름" 느낌의 녹색
 *   · INOUT  (입출력) → warning — 양방향은 주의·특수 케이스라 강조색
 *   · "" (미지정)    → 중립 — 토큰 없이 기본 텍스트 색
 */
export const IO_META: Record<IoSe, {
  label: string; icon: string;
  // 배지 배경 / 글자 / 테두리 — 모두 CSS var 문자열
  bg: string; fg: string; border: string;
}> = {
  INPUT:  {
    label: "저장", icon: "✏️",
    bg: "var(--color-info-subtle)",
    fg: "var(--color-info)",
    border: "var(--color-info-border)",
  },
  OUTPUT: {
    label: "조회", icon: "🔍",
    bg: "var(--color-success-subtle)",
    fg: "var(--color-success)",
    border: "var(--color-success-border)",
  },
  INOUT:  {
    label: "입출력", icon: "🔄",
    bg: "var(--color-warning-subtle)",
    fg: "var(--color-warning)",
    border: "var(--color-warning-border)",
  },
  "": {
    label: "미지정", icon: "·",
    bg: "var(--color-bg-muted)",
    fg: "var(--color-text-secondary)",
    border: "var(--color-border)",
  },
};

// ── IoProfileIcon ────────────────────────────────────────────────────────────

/**
 * 테이블 전체 IO 프로필 아이콘 (목록 페이지).
 *   · NONE 은 opacity 낮춰 존재감만 유지
 */
const IO_PROFILE_META: Record<IoProfile, { icon: string; label: string; tip: string }> = {
  READ_HEAVY:  { icon: IO_META.OUTPUT.icon, label: "조회 위주",  tip: "OUTPUT 매핑이 65% 이상 — 조회 중심 테이블" },
  WRITE_HEAVY: { icon: IO_META.INPUT.icon,  label: "저장 위주",  tip: "INPUT/INOUT 매핑이 65% 이상 — 저장/수정 중심" },
  MIXED:       { icon: IO_META.INOUT.icon,  label: "혼합",      tip: "조회와 저장이 고르게 사용됨" },
  NONE:        { icon: "·",                  label: "미사용",    tip: "아직 어떤 매핑도 없는 테이블" },
};

export function IoProfileIcon({ profile }: { profile: IoProfile }) {
  const m = IO_PROFILE_META[profile];
  const isNone = profile === "NONE";
  return (
    <span
      title={`${m.label} — ${m.tip}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, lineHeight: 1,
        opacity: isNone ? 0.35 : 1,
        // emoji 가로 폭 안정화를 위한 고정 크기
        width: 20, height: 20,
      }}
    >
      {m.icon}
    </span>
  );
}

// ── CoverageText ──────────────────────────────────────────────────────────────

/**
 * usedColCount / totalColCount 를 "80%(12/15)" 로 표시한다.
 *   - totalColCount === 0 → "—" (컬럼 자체가 없음)
 *   - 0% 는 tertiary, 70%+ 는 brand 로 강조
 */
export function CoverageText({ used, total }: { used: number; total: number }) {
  if (total === 0) {
    return <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>—</span>;
  }
  const pct = Math.round((used / total) * 100);
  const strong = pct >= 70;
  return (
    <span
      title={`매핑된 컬럼 ${used}개 / 전체 ${total}개`}
      style={{
        fontSize:   12,
        fontWeight: strong ? 700 : 500,
        color: pct === 0
          ? "var(--color-text-tertiary)"
          : strong
            ? "var(--color-brand)"
            : "var(--color-text-primary)",
      }}
    >
      {pct}% <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}>({used}/{total})</span>
    </span>
  );
}

// ── RefType 배지 (FUNCTION/AREA/SCREEN) ─────────────────────────────────────

/**
 * 참조 유형별 시각 매핑.
 *   - FUNCTION → info   (파랑, 가장 자주 보이므로 중립 정보색)
 *   - AREA     → brand  (보라, 프로젝트 식별 색)
 *   - SCREEN   → success (녹색, 최상위 계층)
 */
const REF_TYPE_META: Record<string, { label: string; bg: string; fg: string }> = {
  FUNCTION: { label: "기능", bg: "var(--color-info-subtle)",    fg: "var(--color-info)"    },
  AREA:     { label: "영역", bg: "var(--color-brand-subtle)",   fg: "var(--color-brand)"   },
  SCREEN:   { label: "화면", bg: "var(--color-success-subtle)", fg: "var(--color-success)" },
};

/**
 * FUNCTION/AREA/SCREEN 구분 배지.
 *   · sizeMode="sm" 은 드릴다운 팝업처럼 조밀한 곳에서 사용
 */
export function RefTypeBadge({ refType, sizeMode = "md" }: { refType: string; sizeMode?: "sm" | "md" }) {
  const m = REF_TYPE_META[refType] ?? { label: refType, bg: "var(--color-bg-muted)", fg: "var(--color-text-secondary)" };
  const fontSize = sizeMode === "sm" ? 10 : 11;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 10,
      background: m.bg, color: m.fg,
      fontSize, fontWeight: 700,
    }}>
      {m.label}
    </span>
  );
}

// ── IoBadge (IN/OUT/INOUT 카운트) ────────────────────────────────────────────

/**
 * "IN 3" "OUT 8" 처럼 카운트와 함께 표시하는 작은 pill.
 *   · io === "" 이거나 count === 0 이면 렌더하지 않는다 (호출부가 필터)
 */
export function IoBadge({ io, count }: { io: Exclude<IoSe, "">; count: number }) {
  const m = IO_META[io];
  // 목록/UsageSection 에서 "IN" / "OUT" / "INOUT" 로 영문 노출이 가독성 더 좋아 레이블은 별도 표기
  const englishLabel = io === "INPUT" ? "IN" : io === "OUTPUT" ? "OUT" : "INOUT";
  return (
    <span style={{
      padding: "1px 6px", borderRadius: 8,
      background: m.bg, color: m.fg,
      fontSize: 10, fontWeight: 700,
    }}>
      {englishLabel} {count}
    </span>
  );
}

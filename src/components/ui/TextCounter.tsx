"use client";

/**
 * TextCounter — 입력 필드 우하단에 "현재 / 최대" 글자수를 표시하는 작은 컴포넌트
 *
 * 역할:
 *   - 한도 정책(textLimits.ts) 기준 카운터 표시
 *   - 비율에 따라 색상 변경 (≥80% 주황, ≥100% 빨강)
 *   - textarea/input 의 maxLength 는 호출처에서 별도 지정 (이 컴포넌트는 표시 전용)
 *
 * 사용:
 *   <textarea value={x} onChange={...} maxLength={TEXT_LIMITS.taskDefinition} />
 *   <TextCounter field="taskDefinition" value={x} />
 *
 *   또는 인라인 import 한 줄:
 *   import { TEXT_LIMITS } from "@/lib/constants/textLimits";
 */

import { useMemo } from "react";
import {
  TEXT_LIMITS, countChars,
  type TextLimitField,
} from "@/lib/constants/textLimits";

type Props = {
  field: TextLimitField;
  value: string;
  /** 우측 정렬 외 다른 정렬이 필요한 드문 케이스용 (기본 right). */
  align?: "left" | "right";
};

export default function TextCounter({ field, value, align = "right" }: Props) {
  const max     = TEXT_LIMITS[field];
  const current = useMemo(() => countChars(value ?? ""), [value]);
  const ratio   = current / max;

  // 한도 임박/초과를 시각적으로 명확히 — 디자인 토큰 변수 우선, 폴백 색상.
  const color =
    ratio >= 1   ? "var(--color-error, #e53935)" :
    ratio >= 0.8 ? "#e57c00" :
                   "var(--color-text-tertiary)";

  return (
    <div style={{
      marginTop:  4,
      fontSize:   11,
      color,
      textAlign:  align,
      fontVariantNumeric: "tabular-nums",
    }}>
      {current.toLocaleString()} / {max.toLocaleString()}
    </div>
  );
}

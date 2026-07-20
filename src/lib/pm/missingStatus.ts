/**
 * pm/missingStatus — 담당자/일정/공수 입력 누락 집계 (순수 함수)
 *
 * lib/pm/delayStatus.ts 와 같은 격리 원칙 — prisma·React 무관.
 * "지연"이 아니라 "애초에 입력이 안 된 것"을 잡아내는 게 목적이라 별도 파일로 둔다.
 *
 * 사용처: pm-summary(PM 진단의 "미지정 현황" 위젯) + dashboard manage-summary
 * (관리뷰 미지정 배너 — 합계 숫자만 필요해 동일 계산을 그대로 재사용).
 */

import { parseEffortHours } from "@/lib/effort";
import type { MissingEntityKind, MissingStat } from "@/types/pm";

export type MissingItemInput = {
  asignMberId: string | null;
  startDate:   string | null;
  endDate:     string | null;
  /** 공수 필드가 없는 엔티티(요구사항/단위업무) 호출 시에는 생략 */
  effortRaw?:  string | null;
};

// hasEffort=false 인 엔티티는 effortRaw 를 넘겨도 무시하고 effortMissing=null 로 고정
// (요구사항/단위업무는 공수 개념 자체가 없음 — DB 컬럼도 없음)
export function buildMissingStat(
  entity: MissingEntityKind,
  entityLabel: string,
  items: MissingItemInput[],
  hasEffort: boolean
): MissingStat {
  let assigneeMissing = 0;
  let dateMissing = 0;
  let effortMissing = 0;

  for (const it of items) {
    if (!it.asignMberId) assigneeMissing++;
    // 시작일·종료일 중 하나라도 없으면 "일정 미입력" — 반쯤 채운 것도 놓치지 않기 위해
    if (!it.startDate || !it.endDate) dateMissing++;
    // parseEffortHours: 빈 값/파싱 불가/음수는 0 — lib/effort.ts 의 기존 "0 이하 = 미입력" 관례 재사용
    if (hasEffort && parseEffortHours(it.effortRaw) <= 0) effortMissing++;
  }

  return {
    entity,
    entityLabel,
    total: items.length,
    assigneeMissing,
    dateMissing,
    effortMissing: hasEffort ? effortMissing : null,
  };
}

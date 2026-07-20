/**
 * wbsZoom.ts — WBS 간트의 확대/축소 단계 정의
 *
 * "좁게 보기" on/off 2단이던 걸 일/주/월 3단으로 교체. cellWidth 뿐 아니라 타임스케일
 * 단위(scales)까지 같이 바뀌어야 실제로 "주 단위로 본다"는 느낌이 남 — 그래서 레벨 하나에
 * cellWidth+scales 를 묶어서 정의한다. 나중에 "분기" 같은 레벨을 더 넣고 싶으면 이 배열에
 * 한 항목만 추가하면 된다(다른 파일은 안 건드려도 됨).
 *
 * scales의 format 토큰은 라이브러리 공식 예제에서 실제로 쓰인 것만 그대로 가져다 씀
 * (검증 안 된 포맷 문자열은 런타임에 깨질 수 있어 피함).
 */

import type { IScaleConfig } from "@svar-ui/react-gantt";

export type WbsZoomLevelKey = "day" | "day-narrow" | "week" | "month";

export type WbsZoomLevel = {
  key:       WbsZoomLevelKey;
  label:     string;
  cellWidth: number;
  scales:    IScaleConfig[];
};

export const WBS_ZOOM_LEVELS: WbsZoomLevel[] = [
  {
    key:       "month",
    label:     "월",
    cellWidth: 90,
    scales:    [{ unit: "year", step: 1, format: "%Y" }, { unit: "month", step: 1, format: "%F" }],
  },
  {
    key:       "week",
    label:     "주",
    cellWidth: 60,
    scales:    [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "week", step: 1, format: "'week' %W" }],
  },
  {
    key:       "day",
    label:     "일",
    cellWidth: 30,
    scales:    [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "day", step: 1, format: "%j" }],
  },
  {
    // 예전 "좁게 보기" 토글의 재구현 — 일 단위는 그대로 두고 칸 폭만 더 줄인 버전.
    // 다른 레벨과 달리 시간 단위(scales)는 "day"와 동일, cellWidth만 다름.
    key:       "day-narrow",
    label:     "좁게",
    cellWidth: 14,
    scales:    [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "day", step: 1, format: "%j" }],
  },
];

export const WBS_ZOOM_DEFAULT: WbsZoomLevelKey = "day";

export function getWbsZoomLevel(key: WbsZoomLevelKey): WbsZoomLevel {
  return WBS_ZOOM_LEVELS.find((l) => l.key === key) ?? WBS_ZOOM_LEVELS[WBS_ZOOM_LEVELS.length - 1];
}

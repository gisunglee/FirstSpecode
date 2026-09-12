"use client";

/**
 * ModifiedCell — 최종 수정 시각 + 수정 경로 표시 (목록 그리드 한 칸)
 *
 * 역할:
 *   - "방금 전 / 12초 전 / 3분 전 / 24일 전 / 2개월 전" 상대시간 표시
 *   - MCP·스펙동기화로 수정된 건에 배지를 붙여 구분
 *   - 최근(10분 내) 수정은 진하게 강조
 *   - 정확한 시각과 수정 경로는 title 툴팁으로 제공
 *
 * 왜 공용 컴포넌트인가:
 *   요구사항·단위업무·화면·영역·기능 다섯 목록이 같은 칸을 갖는다. 페이지마다
 *   따로 쓰면 강조 기준(10분)이나 배지 규칙이 금방 어긋난다.
 *
 * 왜 이 칸이 필요한가:
 *   MCP 도구로 설계를 수정하는 일이 늘면서, 의도하지 않은 항목이 수정됐는지
 *   목록에서 바로 알아챌 수단이 필요해졌다. mdfcn_mber_id 는 MCP 키 소유자와
 *   웹 로그인 사용자가 같은 사람이라 경로 구분에 쓸 수 없다 → mdfcn_src_code.
 *
 * 주의 — 상대시간 갱신:
 *   초 단위 표시는 렌더 시점에 계산된 값이라 화면을 열어둔 채 두면 멈춘다.
 *   이 컴포넌트를 쓰는 페이지는 주기적으로 리렌더해야 한다
 *   (useRelativeTimeTick 훅 사용).
 */

import { formatRelativeKo, formatDateTimeKo } from "@/lib/utils";
import { MDFCN_SRC } from "@/lib/mdfcnSource";

// 최근 수정 강조 기준. 이 시간 안에 바뀐 행은 진하게 표시한다.
// 10분으로 잡은 이유 — MCP 작업 한 턴을 마치고 화면으로 돌아와 확인하는 시간은
// 넉넉히 덮으면서, 어제 수정분까지 강조되지는 않는 범위이기 때문.
const RECENT_MODIFY_MS = 10 * 60 * 1000;

// 수정 경로 코드 → 툴팁 문구
const SOURCE_LABELS: Record<string, string> = {
  [MDFCN_SRC.WEB]:  "웹 화면에서 수정",
  [MDFCN_SRC.MCP]:  "MCP 도구가 수정",
  [MDFCN_SRC.SYNC]: "스펙 동기화로 수정",
};

// 경로 배지 — 웹 수정(WEB)은 배지를 달지 않는다. 전부 표시하면 모든 행에 배지가
// 떠서 정작 찾아야 할 MCP·SYNC 가 묻힌다.
const SOURCE_BADGE_CLASS: Record<string, string> = {
  [MDFCN_SRC.MCP]:  "sp-badge sp-badge-warning",
  [MDFCN_SRC.SYNC]: "sp-badge sp-badge-info",
};

// 좁은 컬럼(80px)에 상대시간과 나란히 들어가도록 기본 sp-badge 보다 작게
const badgeStyle: React.CSSProperties = {
  fontSize:   10,
  padding:    "0 4px",
  flexShrink: 0,
};

type Props = {
  /** 최종 수정 일시(ISO). 수정 이력이 없으면 생성 일시 */
  modifiedAt:       string;
  /** true면 modifiedAt 이 생성 일시 — 등록 후 한 번도 수정되지 않음 */
  modifiedIsCreate: boolean;
  /** WEB | MCP | SYNC. 컬럼 추가(2026-09-12) 이전 수정분은 null */
  modifiedSource:   string | null;
};

export function ModifiedCell({ modifiedAt, modifiedIsCreate, modifiedSource }: Props) {
  const ms       = Date.parse(modifiedAt);
  const isRecent = !Number.isNaN(ms) && Date.now() - ms < RECENT_MODIFY_MS;

  // 생성 일시로 폴백된 행은 경로 배지를 달지 않는다 — 수정된 적이 없으므로
  // mdfcn_src_code 도 비어 있고, 배지를 달면 "수정됨"으로 오해된다.
  const badgeClass = modifiedIsCreate ? undefined : SOURCE_BADGE_CLASS[modifiedSource ?? ""];

  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        gap:            4,
        overflow:       "hidden",
      }}
      title={buildTitle(modifiedAt, modifiedIsCreate, modifiedSource)}
    >
      <span
        style={{
          fontSize:     12,
          whiteSpace:   "nowrap",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          // 최근에 바뀐 행은 진하게 — 목록을 훑을 때 바로 눈에 띄어야
          // "내가 안 건드렸는데 방금 수정됨" 을 알아챌 수 있다.
          color:      isRecent ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          fontWeight: isRecent ? 600 : 400,
        }}
      >
        {/* withSeconds — 호출 페이지의 주기 리렌더가 있어서 초 표시가 거짓이 되지 않음
            withMonths  — 오래된 항목은 정확한 날짜보다 "오래됐다"는 신호가 중요.
                          정확한 시각은 아래 title 툴팁에 있다. */}
        {formatRelativeKo(modifiedAt, { withSeconds: true, withMonths: true })}
      </span>

      {badgeClass && (
        <span className={badgeClass} style={badgeStyle}>{modifiedSource}</span>
      )}
    </div>
  );
}

// 툴팁 문구 — 상대시간("3분 전")만으로는 시점을 특정할 수 없다.
// MCP가 엉뚱한 항목을 건드렸는지 추적할 때는 정확한 시각이 필요하므로 함께 담는다.
function buildTitle(
  modifiedAt:       string,
  modifiedIsCreate: boolean,
  modifiedSource:   string | null,
): string {
  const at = formatDateTimeKo(modifiedAt);
  if (modifiedIsCreate) return `등록 후 수정 없음 · 등록 ${at}`;
  // mdfcn_src_code 컬럼 추가(2026-09-12) 이전 수정분은 경로를 알 수 없다 → "수정"
  const label = SOURCE_LABELS[modifiedSource ?? ""] ?? "수정";
  return `${label} · ${at}`;
}

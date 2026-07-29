"use client";

/**
 * TeamActivityCard — 관리뷰: 팀 활동 (최근 7일) + 팀 부하 신호
 *
 * 역할:
 *   - 최근 7일간 한 번 이상 변경 활동을 한 멤버 수
 *   - Top 기여자 3명 (변경 건수 내림차순)
 *   - 하단에 "부하 1위" 멤버 한 줄 추가 — "활동량"(변경 이벤트 수)과 "부하"(밀린 담당
 *     업무량)는 다른 신호다. 팀 부하 매트릭스 전체는 PM 진단(/pm)에서, 여기선 가장 급한
 *     사람 하나만 미리 보여준다.
 *
 * 데이터 출처:
 *   - tb_ds_design_change groupBy(chg_mber_id) 7일 윈도우 (manage-summary)
 *   - "활동" 정의: 설계 변경 이벤트가 발생한 것. 팀의 작업량 시그널.
 *   - "부하"(topLoadMember) 정의: 담당 단위업무의 진행중+임박+지연 합 — PM 진단의
 *     팀 부하 매트릭스와 동일한 정의를 1위만 축약.
 */

import DashboardCard from "../DashboardCard";
import HelpButton from "@/components/common/HelpButton";

type Contributor = {
  mberId:      string;
  displayName: string;
  count:       number;
};

type Props = {
  data: {
    activeMemberCount: number;
    topContributors:   Contributor[];
    topLoadMember: { displayName: string; activeLoad: number } | null;
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function TeamActivityCard({ data, isLoading, error }: Props) {
  // 최근 활동이 없어도 부하 신호가 있으면(활동 없이 방치된 과부하자) 빈 상태로 숨기지 않는다
  const isEmpty = !!data && data.activeMemberCount === 0 && !data.topLoadMember;

  // Top 기여자 막대 길이 계산 — 1위 대비 비율
  const maxCount = data?.topContributors[0]?.count ?? 0;

  return (
    <DashboardCard
      icon={<TeamIcon />}
      title="팀 활동 (최근 7일)"
      badge={
        data && data.activeMemberCount > 0 ? (
          <span className="sp-badge sp-badge-info">
            <span className="dot" />
            {data.activeMemberCount}명
          </span>
        ) : null
      }
      help={
        <HelpButton title="팀 활동 · 부하 상위 기준">
          <p><b>활동</b> — 최근 7일간 설계 변경(단위업무·화면·영역·기능 등 설계 엔티티의 생성/수정/삭제)
            이벤트가 발생한 건수만 셉니다. 댓글·리뷰·진행률 변경 등 다른 활동은 포함되지 않습니다.</p>
          <p><b>TOP 기여자</b> — 위 활동 건수 내림차순으로 최대 3명까지 보여줍니다. 최근 7일간
            활동한 멤버 자체가 적으면(상단 배지 인원수) 그만큼만 표시됩니다 — 목록이 짧다고 오류는 아닙니다.</p>
          <p><b>부하 상위</b> — "활동"과 다른 지표입니다. 담당 중인 미완료(진행률&lt;100%) 단위업무마다
            기본 1점, 그중 설계 종료 예정일이 이미 지났으면(지연) +1점, 아직 안 지났지만 7일 이내면(임박)
            +1점을 더해 합산 — 가장 점수가 높은 멤버 1명만 보여줍니다(PM 진단 팀 부하 매트릭스와 동일 정의).</p>
        </HelpButton>
      }
      linkHref="/pm?focus=teamLoad"
      linkLabel="PM 진단에서 팀 부하 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="최근 7일간 활동 기록이 없습니다."
    >
      {data && data.topContributors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Top 기여자
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", opacity: 0.8 }}>
              최근 7일 설계 변경 건수 기준
            </div>
          </div>
          {data.topContributors.map((c, idx) => {
            const pct = maxCount > 0 ? Math.round((c.count / maxCount) * 100) : 0;
            return (
              <div
                key={c.mberId}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <span title={c.displayName}>{c.displayName}</span>
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {c.count}건
                  </span>
                </div>
                {/* 막대 게이지 — 1위 기준 비율 */}
                <div
                  style={{
                    height: 4,
                    borderRadius: "var(--radius-full)",
                    background: "var(--color-border-subtle)",
                    overflow: "hidden",
                  }}
                  aria-hidden
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--color-brand)",
                      transition: "width 200ms ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 부하 1위 — "활동"과 다른 신호. 담당 업무가 밀린 사람이 없으면 표시 안 함 */}
      {data?.topLoadMember && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px dashed var(--color-border-subtle)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-secondary)",
          }}
        >
          ⚠ 부하 상위: <strong>{data.topLoadMember.displayName}</strong> ({data.topLoadMember.activeLoad}건)
          <div style={{ opacity: 0.8, marginTop: 2 }}>
            담당 미완료 단위업무 수 + 그중 지연·임박 가중치 합산 1위
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

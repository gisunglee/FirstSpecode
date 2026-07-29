"use client";

/**
 * StalledCard — 관리뷰: 정체된 일 (설계·구현 중 한 phase 라도 마감 지났는데 그 phase 미완료)
 *
 * 역할:
 *   - 설계 종료 예정일 또는 구현 종료 예정일 "둘 중 하나라도" 지났는데 그 phase 진척률이
 *     100% 미만인 단위업무. 두 phase 를 평균 내지 않고 각각 판정 — 설계는 제때 끝났는데
 *     구현이 아직 시작 전(기간도 안 지남)인 경우까지 정체로 잘못 잡히는 걸 막기 위함.
 *   - Top 5 미리보기 + 전체 건수. 각 행에 설계/구현 날짜·진척률을 두 줄로 분리 표시,
 *     지연을 유발한 phase만 강조색으로 표시.
 *   - 상단에 설계(단위업무 기준)/구현(기능 기준) 지연 카운트도 함께 표기 — 단위업무만
 *     보면 놓치는 설계·구현 단계 지연을 놓치지 않도록. 목록은 그대로 단위업무만(전체 상세는 PM 진단에서).
 *   - 각 행 클릭 → 단위업무 상세로 이동
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import HelpButton from "@/components/common/HelpButton";

type PhaseInfo = { endDate: string | null; progress: number; overdue: boolean };

type StalledItem = {
  unitWorkId:       string;
  displayId:        string;
  name:             string;
  assignMemberName: string | null;
  design:           PhaseInfo;
  impl:             PhaseInfo;
};

type Props = {
  data: {
    count: number;
    items: StalledItem[];
    designDelayedCount:   number;
    functionDelayedCount: number;
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function StalledCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;

  // "Top 5만 보여주는데 전체가 더 많을 때" 카운트 배지로 알림
  const moreCount = data ? Math.max(0, data.count - data.items.length) : 0;

  return (
    <DashboardCard
      icon={<AlertIcon />}
      title="정체된 일"
      badge={
        data && data.count > 0 ? (
          <span className="sp-badge sp-badge-error">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      help={
        <HelpButton title="정체된 일 기준">
          <p>설계·구현 중 <b>하나라도</b> 종료 예정일이 지났는데 그 진척률이 100% 미만이면 정체입니다. (기간이 안 지난 phase는 진척률이 낮아도 정체 아님)</p>
          <p><b>설계</b> — 단위업무의 설계 종료 예정일 · 설계 진척률.<br /><b>구현</b> — 하위 화면의 구현 종료 예정일(최댓값) · 구현 진척률.</p>
          <p>빨간색으로 표시된 줄이 실제로 정체를 유발한 phase입니다.</p>
          <p><b>설계 N · 구현 N</b> — 목록과 별개로, 설계 지연 단위업무 수 / 구현 지연 기능 수.</p>
        </HelpButton>
      }
      linkHref="/pm?focus=delay"
      linkLabel="PM 진단에서 설계·구현 지연 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="🎉 정체된 항목이 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* 엔티티별 지연 카운트 — 단위업무 외에도 지연이 있으면 바로 눈에 띄도록 */}
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              paddingBottom: 4,
            }}
          >
            단위업무 {data.count} · 설계 {data.designDelayedCount} · 구현 {data.functionDelayedCount}
          </div>
          {data.items.map((it) => (
            <Link
              key={it.unitWorkId}
              href={`/projects/${projectId}/unit-works/${it.unitWorkId}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--color-text-primary)",
                textDecoration: "none",
                gap: 8,
              }}
              className="sp-dashboard-row"
            >
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  // 담당자가 있을 때 1행에 [ID] 이름 + 2행에 담당자명 표시
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
                title={it.assignMemberName ? `${it.name} · 담당: ${it.assignMemberName}` : it.name}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-tertiary)",
                      marginRight: 6,
                    }}
                  >
                    {it.displayId}
                  </span>
                  {it.name}
                </span>
                {it.assignMemberName && (
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    담당: {it.assignMemberName}
                  </span>
                )}
              </span>
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 1,
                  fontSize: "var(--text-xs)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: it.design.overdue ? "var(--color-error)" : "var(--color-text-tertiary)" }}>
                  설계{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {it.design.endDate ?? "-"}·{it.design.progress}%
                  </span>
                </span>
                <span style={{ color: it.impl.overdue ? "var(--color-error)" : "var(--color-text-tertiary)" }}>
                  구현{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {it.impl.endDate ?? "-"}·{it.impl.progress}%
                  </span>
                </span>
              </span>
            </Link>
          ))}

          {moreCount > 0 && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                padding: "4px 8px",
              }}
            >
              외 {moreCount}건
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

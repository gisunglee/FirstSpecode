"use client";

/**
 * MyTasksCard — 개발자뷰: 내 과업
 *
 * 역할:
 *   - 내가 담당한 과업 총 건수 + 카테고리별 분포 + 미리보기 3건
 *   - 과업 테이블에는 진행 상태(status) 컬럼이 없으므로
 *     "진행중/완료" 분류 없이 담당 전체로 노출.
 *   - 클릭 → 과업 목록(내 담당 필터)으로 이동
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";

type TaskItem = {
  taskId:    string;
  displayId: string;
  name:      string;
  category:  string;
};

type Props = {
  data: {
    count:      number;
    byCategory: Record<string, number>;
    items:      TaskItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

// 카테고리 코드 → 한글 라벨. 코드가 추가되면 여기에 등록.
// 미등록 코드는 코드 자체를 그대로 노출(흐림 색).
const CATEGORY_LABEL: Record<string, string> = {
  NEW_DEV: "신규",
  ENHANCE: "개선",
  FIX:     "수정",
  TEST:    "테스트",
  DOC:     "문서",
};

export default function MyTasksCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;

  return (
    <DashboardCard
      icon={<TaskIcon />}
      title="내 과업"
      badge={
        data && data.count > 0 ? (
          <span className="sp-badge sp-badge-brand">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      // assignedTo=me 필터 URL — 과업 목록 페이지가 querystring 받으면 자동 적용
      linkHref={`/projects/${projectId}/tasks?assignedTo=me`}
      linkLabel="내 담당 과업 모두 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="담당 과업이 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* 카테고리 분포 — pill 배지 가로 나열 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(data.byCategory).map(([code, n]) => (
              <span
                key={code}
                className="sp-badge sp-badge-neutral"
                style={{ fontSize: "var(--text-xs)" }}
                title={code}
              >
                {CATEGORY_LABEL[code] ?? code} {n}
              </span>
            ))}
          </div>

          {/* 미리보기 — 3건 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              borderTop: "1px dashed var(--color-border-subtle)",
              paddingTop: 8,
            }}
          >
            {data.items.map((t) => (
              <Link
                key={t.taskId}
                href={`/projects/${projectId}/tasks/${t.taskId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 6px",
                  borderRadius: "var(--radius-sm)",
                  textDecoration: "none",
                  color: "var(--color-text-primary)",
                  fontSize: "var(--text-sm)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  {t.displayId}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={t.name}
                >
                  {t.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

function TaskIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

"use client";

/**
 * RecentChangesCard — 관리뷰: 설계 변경 이력 (최근 5건)
 *
 * 역할:
 *   - tb_ds_design_change 최신 5건 미리보기
 *   - 변경 유형(CREATE/UPDATE/DELETE) 배지 + 변경자 + 시간
 *   - 클릭 → 변경 이력 페이지(추후 구현 예정 시 링크 활성)
 */

import DashboardCard from "../DashboardCard";
import { formatRelativeKo } from "@/lib/utils";

type ChangeItem = {
  chgId:        string;
  refTblNm:     string;
  refId:        string;
  chgTypeCode:  string;
  chgRsnCn:     string | null;
  chgMberEmail: string | null;
  chgDt:        string;
};

type Props = {
  data: ChangeItem[] | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

// ref_tbl_nm → 사용자 친화 라벨 매핑
// DB 테이블 명을 그대로 노출하면 비개발자에게 의미 전달 안 됨.
const REF_LABEL: Record<string, string> = {
  tb_ds_unit_work: "단위업무",
  tb_ds_screen:    "화면",
  tb_ds_area:      "영역",
  tb_ds_function:  "기능",
  tb_rq_requirement: "요구사항",
  tb_rq_user_story:  "스토리",
};

const CHG_TYPE_LABEL: Record<string, string> = {
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
};

const CHG_TYPE_BADGE: Record<string, string> = {
  CREATE: "sp-badge-success",
  UPDATE: "sp-badge-info",
  DELETE: "sp-badge-error",
};

export default function RecentChangesCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.length === 0;

  return (
    <DashboardCard
      icon={<HistoryIcon />}
      title="최근 변경"
      linkHref={`/projects/${projectId}/design-changes`}
      linkLabel="전체 이력 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="아직 변경 이력이 없습니다."
    >
      {data && data.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((c) => (
            <div
              key={c.chgId}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                paddingBottom: 6,
                borderBottom: "1px dashed var(--color-border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  className={`sp-badge ${CHG_TYPE_BADGE[c.chgTypeCode] ?? "sp-badge-neutral"}`}
                  style={{ fontSize: "var(--text-xs)" }}
                >
                  {CHG_TYPE_LABEL[c.chgTypeCode] ?? c.chgTypeCode}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {REF_LABEL[c.refTblNm] ?? c.refTblNm}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-tertiary)",
                    marginLeft: "auto",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {formatRelativeKo(c.chgDt)}
                </span>
              </div>
              {(c.chgRsnCn || c.chgMberEmail) && (
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={c.chgRsnCn ?? undefined}
                >
                  {c.chgMberEmail && <span style={{ color: "var(--color-text-tertiary)" }}>{c.chgMberEmail} · </span>}
                  {c.chgRsnCn ?? "변경 사유 없음"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 12a9 9 0 1 0 9-9c-2.4 0-4.6 1-6.2 2.6L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

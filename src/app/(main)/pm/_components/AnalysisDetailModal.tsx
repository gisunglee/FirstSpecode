"use client";

/**
 * AnalysisDetailModal — 분석 현황 상세 팝업 (드릴다운)
 *
 * 역할:
 *   - "분석 현황" 위젯 제목을 클릭하면 필터 없이 열림
 *   - 요약 표에서 멤버 이름을 클릭하면 그 멤버로 필터가 걸린 채 열림 (initialMberId)
 *   - 요구사항명·담당자·시작일·종료일·진척률을 한 행에 보여줌
 *   - 필터: 멤버 선택("미할당" 포함), 지연된 것만 보기
 *   - 페이징 없이 최대 100건만 표시 (서버가 이미 자름) — /api/projects/[id]/pm-analysis-detail
 *
 * DelayDetailModal.tsx 와 거의 동일한 구조 — kind 필터만 없음(요구사항 하나뿐이라 불필요).
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { UNASSIGNED_MBER_KEY } from "@/lib/pm/delayStatus";
import type { AnalysisDetailItem } from "@/types/pm";

type ProjectMember = { memberId: string; name: string | null; email: string };

type Props = {
  projectId: string;
  onClose:   () => void;
  /** 요약 표의 멤버를 클릭해서 열었을 때 미리 걸어줄 필터 — mberId 값 또는 UNASSIGNED_MBER_KEY */
  initialMberId?: string;
};

export default function AnalysisDetailModal({ projectId, onClose, initialMberId }: Props) {
  const [mberId, setMberId]       = useState(initialMberId ?? "");
  const [delayOnly, setDelayOnly] = useState(false);

  // 담당자 콤보박스 — 다른 상세 페이지들과 동일한 멤버 목록 엔드포인트 재사용
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: ProjectMember[] } }>(`/api/projects/${projectId}/members`)
        .then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const members = memberData?.members ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-analysis-detail", projectId, mberId, delayOnly],
    queryFn: () =>
      authFetch<{ data: { items: AnalysisDetailItem[]; total: number } }>(
        `/api/projects/${projectId}/pm-analysis-detail?mberId=${mberId}&delayOnly=${delayOnly}`
      ).then((r) => r.data),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 95vw)", maxHeight: "85vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>분석 현황 상세</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 필터 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
          <div className="sp-select-wrap" style={{ width: 180 }}>
            <select value={mberId} onChange={(e) => setMberId(e.target.value)} className="sp-input">
              <option value="">전체 멤버</option>
              <option value={UNASSIGNED_MBER_KEY}>미할당</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>{m.name ?? m.email}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-lg)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={delayOnly} onChange={(e) => setDelayOnly(e.target.checked)} style={{ cursor: "pointer" }} />
            지연된 것만 보기
          </label>
        </div>

        {/* 본문 — 표 */}
        <div style={{ overflow: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ padding: 20, color: "var(--color-text-tertiary)", fontSize: 15 }}>불러오는 중...</div>
          ) : error ? (
            <div style={{ padding: 20, color: "var(--color-error)", fontSize: 15 }}>⚠ {(error as Error).message}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 15 }}>조건에 맞는 항목이 없습니다.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
                  <Th>요구사항</Th>
                  <Th>담당자</Th>
                  <Th>시작일</Th>
                  <Th>종료일</Th>
                  <Th align="right">진척률</Th>
                  <Th align="center">지연</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.reqId} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <Td>
                      {/* 링크 색은 일반 텍스트(검정) — 표 전체가 파랗게 보이는 걸 방지.
                          이름이 길면(10자 초과) 폰트를 줄여 그 컬럼 하나 때문에 표가 안 벌어지게 */}
                      <Link
                        href={`/projects/${projectId}/requirements/${it.reqId}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontSize: it.reqName.length > 10 ? 11 : undefined }}
                      >
                        {it.reqName}
                      </Link>
                    </Td>
                    <Td>{it.memberName ?? <Muted>미할당</Muted>}</Td>
                    <Td mono>{it.startDate ?? <Muted>-</Muted>}</Td>
                    <Td mono>{it.endDate ?? <Muted>-</Muted>}</Td>
                    <Td align="right" mono>{it.progress}%</Td>
                    <Td align="center">
                      {it.isDelayed ? (
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-error)" }}>지연</span>
                      ) : (
                        <Muted>-</Muted>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: "8px 20px", fontSize: 14, color: "var(--color-text-tertiary)", borderTop: "1px solid var(--color-border)" }}>
          {total > items.length
            ? `총 ${total}건 중 ${items.length}건 표시 (최대 100건 — 필터로 좁혀보세요)`
            : `총 ${total}건`}
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th style={{
      textAlign: align, padding: "8px 12px", fontSize: "var(--text-base)", fontWeight: 600,
      color: "var(--color-text-tertiary)", whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function Td({ children, align = "left", mono = false }: { children: React.ReactNode; align?: "left" | "right" | "center"; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align, padding: "7px 12px", color: "var(--color-text-primary)",
      fontFamily: mono ? "var(--font-mono)" : undefined,
      whiteSpace: "nowrap",
    }}>
      {children}
    </td>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--color-text-tertiary)" }}>{children}</span>;
}

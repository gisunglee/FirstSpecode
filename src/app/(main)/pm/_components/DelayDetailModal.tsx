"use client";

/**
 * DelayDetailModal — 지연 현황 상세 팝업 (드릴다운)
 *
 * 역할:
 *   - "지연 현황" 위젯 제목을 클릭하면 필터 없이 열림
 *   - 요약 표에서 멤버 이름을 클릭하면 그 멤버로 필터가 걸린 채 열림 (initialMberId)
 *   - 멤버 · 단위업무 · 화면 · 영역 · 기능을 계층 순서로 한 행에 보여주고, 행마다 진척률 표시
 *   - 필터: 멤버 선택("미할당" 포함), 지연된 것만 보기, 설계 지연/구현 지연 구분
 *   - 페이징 없이 최대 100건만 표시 (서버가 이미 자름) — /api/projects/[id]/pm-delay-detail
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { UNASSIGNED_MBER_KEY } from "@/lib/pm/delayStatus";
import type { DelayDetailItem } from "@/types/pm";

type ProjectMember = { memberId: string; name: string | null; email: string };

type Props = {
  projectId: string;
  onClose:   () => void;
  /** 요약 표의 멤버를 클릭해서 열었을 때 미리 걸어줄 필터 — mberId 값 또는 UNASSIGNED_MBER_KEY */
  initialMberId?: string;
  /** DelayStatusMatrix 에서 고른 지연 기준일(yyyy-MM-dd) — 없으면(undefined) 오늘 기준.
      위젯 숫자와 상세 목록이 같은 기준일을 봐야 하므로 그대로 전달받는다. */
  asOf?: string;
};

type KindFilter = "all" | "design" | "impl";

export default function DelayDetailModal({ projectId, onClose, initialMberId, asOf }: Props) {
  const [kind, setKind]           = useState<KindFilter>("all");
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
    queryKey: ["pm-delay-detail", projectId, kind, mberId, delayOnly, asOf],
    queryFn: () =>
      authFetch<{ data: { items: DelayDetailItem[]; total: number } }>(
        `/api/projects/${projectId}/pm-delay-detail?kind=${kind}&mberId=${mberId}&delayOnly=${delayOnly}${asOf ? `&asOf=${asOf}` : ""}`
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
          width: "min(1180px, 95vw)", maxHeight: "85vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
            지연 현황 상세
            {asOf && (
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand)", background: "var(--color-brand-subtle)", padding: "2px 8px", borderRadius: "var(--radius-sm)" }}>
                기준일 {asOf}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 필터 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
          <div className="sp-select-wrap" style={{ width: 140 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className="sp-input">
              <option value="all">전체</option>
              <option value="design">설계 지연</option>
              <option value="impl">구현 지연</option>
            </select>
          </div>
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
                  <Th>유형</Th>
                  <Th>멤버</Th>
                  <Th>단위업무</Th>
                  <Th>화면</Th>
                  <Th>영역</Th>
                  <Th>기능</Th>
                  <Th>시작일</Th>
                  <Th>종료일</Th>
                  <Th align="right">진척률</Th>
                  <Th align="center">지연</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.kind}-${it.itemId}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <Td>
                      <span style={{
                        fontSize: 13, fontWeight: 700, padding: "1px 7px", borderRadius: "var(--radius-sm)",
                        background: it.kind === "DESIGN" ? "var(--color-brand-subtle)" : "var(--color-bg-elevated)",
                        color: it.kind === "DESIGN" ? "var(--color-brand)" : "var(--color-text-secondary)",
                      }}>
                        {it.kind === "DESIGN" ? "설계" : "구현"}
                      </span>
                    </Td>
                    <Td>{it.memberName ?? <Muted>미할당</Muted>}</Td>
                    <Td>
                      <HierLink
                        href={it.unitWorkId && `/projects/${projectId}/unit-works/${it.unitWorkId}`}
                        name={it.unitWorkName}
                      />
                    </Td>
                    <Td>
                      <HierLink
                        href={it.screenId && `/projects/${projectId}/screens/${it.screenId}`}
                        name={it.screenName}
                      />
                    </Td>
                    <Td>
                      <HierLink
                        href={it.areaId && `/projects/${projectId}/areas/${it.areaId}`}
                        name={it.areaName}
                      />
                    </Td>
                    <Td>
                      <HierLink
                        href={it.functionId && `/projects/${projectId}/functions/${it.functionId}`}
                        name={it.functionName}
                      />
                    </Td>
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

// 단위업무/화면/영역/기능 이름 → 해당 상세 페이지 링크. ID나 이름이 없으면(DESIGN 행의 영역/기능처럼) "-"
// 색은 일반 텍스트와 동일(검정) — 링크 색만 튀면 표 전체가 파랗게 보여 오히려 산만하다.
// 이름이 길면(10자 초과) 폰트를 살짝 줄여서 그 컬럼 하나 때문에 표 전체가 벌어지지 않게 한다.
function HierLink({ href, name }: { href: string | null | false; name: string | null }) {
  if (!href || !name) return <Muted>-</Muted>;
  return (
    <Link href={href} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontSize: name.length > 10 ? 11 : undefined }}>
      {name}
    </Link>
  );
}

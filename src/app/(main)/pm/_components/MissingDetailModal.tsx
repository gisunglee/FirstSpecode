"use client";

/**
 * MissingDetailModal — 미지정 현황 상세 팝업 (드릴다운)
 *
 * 역할:
 *   - "미지정 현황" 매트릭스의 한 셀(엔티티 × 담당자/일정/공수)을 클릭하면 그 조합으로
 *     열림 — entity/missing 셀렉트로 다른 조합도 바로 전환 가능(모달을 닫았다 열 필요 없음).
 *   - 항목명은 상세 페이지로 바로가기 링크.
 *   - 페이징 없이 최대 100건만 표시(서버가 이미 자름) — /api/projects/[id]/pm-missing-detail
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { MISSING_ENTITY_LABELS } from "@/types/pm";
import type { MissingDetailItem, MissingEntityKind } from "@/types/pm";

type MissingKind = "assignee" | "date" | "effort";

type Props = {
  projectId: string;
  onClose:   () => void;
  initialEntity:  MissingEntityKind;
  initialMissing: MissingKind;
};

const MISSING_LABELS: Record<MissingKind, string> = {
  assignee: "담당자 미지정",
  date:     "일정 미입력",
  effort:   "공수 미입력",
};

// 요구사항/단위업무는 공수 필드가 없음 — 셀렉트에서 조합 자체를 숨겨서 항상 유효한 요청만 나가게 함
const ENTITY_ORDER: MissingEntityKind[] = ["REQUIREMENT", "UNIT_WORK", "SCREEN", "FUNCTION"];
const HAS_EFFORT: Record<MissingEntityKind, boolean> = {
  REQUIREMENT: false, UNIT_WORK: false, SCREEN: true, FUNCTION: true,
};

export default function MissingDetailModal({ projectId, onClose, initialEntity, initialMissing }: Props) {
  const [entity, setEntity]   = useState<MissingEntityKind>(initialEntity);
  const [missing, setMissing] = useState<MissingKind>(initialMissing);

  const missingOptions: MissingKind[] = HAS_EFFORT[entity]
    ? ["assignee", "date", "effort"]
    : ["assignee", "date"];

  function handleEntityChange(next: MissingEntityKind) {
    setEntity(next);
    // 공수 없는 엔티티로 바꿨는데 missing이 effort로 남아있으면 400 나므로 assignee로 되돌림
    if (missing === "effort" && !HAS_EFFORT[next]) setMissing("assignee");
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-missing-detail", projectId, entity, missing],
    queryFn: () =>
      authFetch<{ data: { items: MissingDetailItem[]; total: number } }>(
        `/api/projects/${projectId}/pm-missing-detail?entity=${entity}&missing=${missing}`
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
          width: "min(760px, 95vw)", maxHeight: "85vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>미지정 현황 상세</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 필터 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
          <div className="sp-select-wrap" style={{ width: 130 }}>
            <select value={entity} onChange={(e) => handleEntityChange(e.target.value as MissingEntityKind)} className="sp-input">
              {ENTITY_ORDER.map((k) => (
                <option key={k} value={k}>{MISSING_ENTITY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="sp-select-wrap" style={{ width: 150 }}>
            <select value={missing} onChange={(e) => setMissing(e.target.value as MissingKind)} className="sp-input">
              {missingOptions.map((k) => (
                <option key={k} value={k}>{MISSING_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 본문 — 표 */}
        <div style={{ overflow: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ padding: 20, color: "var(--color-text-tertiary)", fontSize: 15 }}>불러오는 중...</div>
          ) : error ? (
            <div style={{ padding: 20, color: "var(--color-error)", fontSize: 15 }}>⚠ {(error as Error).message}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 15 }}>조건에 맞는 항목이 없습니다. 🎉</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
                  <Th>항목</Th>
                  <Th>담당자</Th>
                  <Th>시작일</Th>
                  <Th>종료일</Th>
                  {HAS_EFFORT[entity] && <Th align="right">공수</Th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <Td>
                      {/* 링크 색은 일반 텍스트(검정) — 표 전체가 파랗게 보이는 걸 방지.
                          이름이 길면(10자 초과) 폰트를 줄여 그 컬럼 하나 때문에 표가 안 벌어지게 */}
                      <Link
                        href={it.href}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontSize: it.name.length > 10 ? 11 : undefined }}
                      >
                        {it.name || <Muted>(이름 없음)</Muted>}
                      </Link>
                    </Td>
                    <Td>{it.memberName ?? <Muted>미지정</Muted>}</Td>
                    <Td mono>{it.startDate ?? <Muted>-</Muted>}</Td>
                    <Td mono>{it.endDate ?? <Muted>-</Muted>}</Td>
                    {HAS_EFFORT[entity] && <Td align="right" mono>{it.effort ?? <Muted>-</Muted>}</Td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: "8px 20px", fontSize: 14, color: "var(--color-text-tertiary)", borderTop: "1px solid var(--color-border)" }}>
          {total > items.length
            ? `총 ${total}건 중 ${items.length}건 표시 (최대 100건)`
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

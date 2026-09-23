"use client";

/**
 * SeatBreakdown — "좌석에 누가 포함되나요?" 펼치기 (정책 §1-4)
 *
 * 역할:
 *   - 좌석 숫자만 보면 "왜 4명?"이 생긴다. 사람을 행으로, 그 사람이 속한 소유 프로젝트·역할을 칩으로 보여 줘
 *     "같은 사람이 세 프로젝트에 있어도 1좌석"을 그대로 드러낸다.
 *   - 좌석 차감(편집 역할) / 무료(뷰어) 두 묶음. 본인은 항상 첫 줄.
 *   - 초대 중인 편집 멤버가 있으면 "수락 시 좌석을 더 씁니다" 한 줄 — 딱 맞게 사서 수락이 막히는 민원 방지.
 *   - 역할 변경은 여기서 하지 않는다. 프로젝트 칩 → 그 프로젝트의 멤버 관리로 보낸다.
 *
 * 기본 접힘, 펼칠 때 /api/billing/seats/breakdown 을 부른다(개요 API 를 무겁게 하지 않기 위해).
 * 구독 시작 카드·플랜 카드·좌석 축소 모달 세 곳에서 같은 컴포넌트를 쓴다.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { SeatBreakdown as SeatBreakdownData, SeatMemberRow } from "@/lib/billing/seats";

type Props = {
  /** 헤더에 쓰는 사용 좌석 수 (개요 API 값 — 펼치기 전에도 보이게) */
  usedSeats: number;
  /** 모달 안처럼 처음부터 펼쳐 둘 때 */
  defaultOpen?: boolean;
};

export default function SeatBreakdown({ usedSeats, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const q = useQuery({
    queryKey: ["billing", "seat-breakdown"],
    queryFn:  () => authFetch<{ data: SeatBreakdownData }>("/api/billing/seats/breakdown").then((r) => r.data),
    enabled:  open,
    staleTime: 30 * 1000,
  });
  const d = q.data;

  return (
    <div style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--color-bg-elevated)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: "var(--text-sm)", textAlign: "left" }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>좌석 {usedSeats}</span>
        <span>= 편집 멤버 {usedSeats}명{d ? ` (소유 프로젝트 ${d.projectCount}개, 중복 제거)` : ""}</span>
        <span style={{ marginLeft: "auto", color: "var(--color-brand)" }}>{open ? "접기 ▲" : "누가 포함되나요? ▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "grid", gap: 12, fontSize: "var(--text-sm)" }}>
          {q.isLoading && <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중…</div>}
          {q.isError && <div className="sp-hint is-err">{(q.error as Error).message}</div>}
          {d && (
            <>
              <Group title={`좌석 차감 (${d.editors.length})`} rows={d.editors} emptyText="편집 멤버가 없습니다." />
              <Group title={`무료 — 뷰어 (${d.viewers.length})`} rows={d.viewers} emptyText="뷰어가 없습니다." muted />

              <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-xs)", lineHeight: 1.6 }}>
                {d.pendingEditorInvites > 0 && (
                  <div style={{ color: "var(--color-warning)" }}>
                    ℹ 초대 중인 편집 멤버 {d.pendingEditorInvites}명은 수락하면 좌석을 {d.pendingEditorInvites}개 더 씁니다. 딱 맞게 사면 수락이 막힙니다.
                  </div>
                )}
                <div>내가 소유한 프로젝트만 셉니다. 좌석을 줄이려면 편집 멤버를 뷰어로 바꾸거나 제외하세요 — 프로젝트 이름을 누르면 멤버 관리로 갑니다.</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, rows, emptyText, muted }: { title: string; rows: SeatMemberRow[]; emptyText: string; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)", marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: "var(--color-text-tertiary)" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <div key={r.mberId} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", opacity: muted ? 0.8 : 1 }}>
              <span style={{ minWidth: 140, color: "var(--color-text-primary)", fontWeight: r.isSelf ? 600 : 400 }}>
                {r.name ?? r.email ?? r.mberId.slice(0, 8)}
                {r.isSelf && <span style={{ color: "var(--color-brand)", marginLeft: 4, fontSize: "var(--text-xs)" }}>(본인)</span>}
                {r.name && r.email && <span style={{ color: "var(--color-text-tertiary)", marginLeft: 6, fontSize: "var(--text-xs)" }}>{r.email}</span>}
              </span>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {r.projects.map((p) => (
                  <Link
                    key={p.projectId}
                    href={`/projects/${p.projectId}/members`}
                    className="sp-badge sp-badge-neutral"
                    title={`${p.name} 멤버 관리로 이동`}
                    style={{ textDecoration: "none" }}
                  >
                    {p.name} <span style={{ opacity: 0.7, marginLeft: 3 }}>{p.role}</span>
                  </Link>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

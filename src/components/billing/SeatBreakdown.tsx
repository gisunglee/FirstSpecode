"use client";

/**
 * SeatBreakdown — "좌석에 누가 포함되나요?" 펼치기 (정책 §1-4)
 *
 * 역할:
 *   - 좌석 숫자만 보면 "왜 4명?"이 생긴다. 위에는 좌석 차감 멤버 이름을 한 줄로 나열(중복 제거된 그 사람들),
 *     아래에는 프로젝트별 표(프로젝트 | 편집 멤버 | 뷰어)로 "누가 어디에 있나"를 보여 준다.
 *   - 같은 이름이 여러 프로젝트 행에 나오지만 위 한 줄에는 한 번만 — 중복 제거가 그대로 드러난다.
 *   - 초대 중인 편집 멤버가 있으면 "수락 시 좌석을 더 씁니다" 한 줄 — 딱 맞게 사서 수락이 막히는 민원 방지.
 *   - 역할 변경은 여기서 하지 않는다. 프로젝트 이름 → 그 프로젝트의 멤버 관리로 보낸다.
 *
 * 부차 정보이므로 자기 테두리를 갖지 않는다(카드 안 박스 중첩 방지). 접힘 라벨도 한 줄 —
 * 좌석 수·계산식은 이 컴포넌트를 부르는 카드 본문이 이미 말하고 있어 여기서 반복하지 않는다.
 * 기본 접힘, 펼칠 때 /api/billing/seats/breakdown 을 부른다. 시작 카드·플랜 카드·좌석 변경 모달 세 곳 공용.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { ROLE_LABEL, isRoleCode } from "@/lib/permissions";
import type { SeatBreakdown as SeatBreakdownData, SeatMemberRow } from "@/lib/billing/seats";

type Props = {
  /** 모달 안처럼 처음부터 펼쳐 둘 때 */
  defaultOpen?: boolean;
};

type ProjectRow = {
  projectId: string;
  name:      string;
  editors:   Array<{ label: string; email: string | null; role: string }>;
  viewers:   Array<{ label: string; email: string | null }>;
};

/** 사람 기준 응답을 프로젝트 행으로 뒤집는다. 프로젝트 순서는 처음 등장한 순(서버가 생성일 순으로 준다) */
function toProjectRows(d: SeatBreakdownData): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  const push = (person: SeatMemberRow, kind: "editor" | "viewer") => {
    for (const p of person.projects) {
      const row = rows.get(p.projectId) ?? { projectId: p.projectId, name: p.name, editors: [], viewers: [] };
      const label = displayName(person);
      if (kind === "editor") row.editors.push({ label, email: person.email, role: p.role });
      else row.viewers.push({ label, email: person.email });
      rows.set(p.projectId, row);
    }
  };
  d.editors.forEach((e) => push(e, "editor"));
  d.viewers.forEach((v) => push(v, "viewer"));
  return [...rows.values()];
}

function displayName(r: SeatMemberRow): string {
  return (r.name ?? r.email ?? r.mberId.slice(0, 8)) + (r.isSelf ? " (본인)" : "");
}

/** 역할 꼬리표 — 소유자·관리자만 붙인다. MEMBER 는 기본이라 생략해 표를 조용하게 */
function roleTag(role: string): string {
  if (role === "OWNER" || role === "ADMIN") return isRoleCode(role) ? ROLE_LABEL[role] : role;
  return "";
}

/**
 * 이름 한 개 — 이름 중간에서 줄바꿈되지 않게 묶는다.
 * 여러 명은 가운뎃점(·)으로만 구분한다(쉼표와 섞으면 역할 꼬리표와 헷갈린다).
 */
function NameChip({ label, email, role }: { label: string; email: string | null; role?: string }) {
  const tag = role ? roleTag(role) : "";
  return (
    <span title={email ?? undefined} style={{ whiteSpace: "nowrap" }}>
      {label}
      {tag && <span style={{ color: "var(--color-text-tertiary)", marginLeft: 4 }}>{tag}</span>}
    </span>
  );
}

/** 이름들을 · 로 이어 준다. 줄바꿈은 이름 사이에서만 일어난다 */
function NameList({ children }: { children: React.ReactNode[] }) {
  return (
    <>
      {children.map((node, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: "var(--color-text-tertiary)" }}> · </span>}
          {node}
        </span>
      ))}
    </>
  );
}

export default function SeatBreakdown({ defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const q = useQuery({
    queryKey: ["billing", "seat-breakdown"],
    queryFn:  () => authFetch<{ data: SeatBreakdownData }>("/api/billing/seats/breakdown").then((r) => r.data),
    enabled:  open,
    staleTime: 30 * 1000,
  });
  const d = q.data;
  const projectRows = d ? toProjectRows(d) : [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: 0, background: "none", border: "none", cursor: "pointer", color: "var(--color-brand)", fontSize: "var(--text-sm)" }}
      >
        좌석에 누가 포함되나요? {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
          {q.isLoading && <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중…</div>}
          {q.isError && <div className="sp-hint is-err">{(q.error as Error).message}</div>}
          {d && (
            <>
              {/* 위: 좌석 차감 멤버 이름 한 줄 — 중복 제거된 사람들 그 자체 */}
              <div style={{ lineHeight: 1.8, color: "var(--color-text-primary)" }}>
                <span style={{ color: "var(--color-text-tertiary)", marginRight: 8 }}>좌석 차감 {d.editors.length}명</span>
                {d.editors.length === 0 ? (
                  <span style={{ color: "var(--color-text-tertiary)" }}>없음</span>
                ) : (
                  <NameList>
                    {d.editors.map((e) => (
                      <span key={e.mberId} style={{ fontWeight: e.isSelf ? 600 : 400 }}>
                        <NameChip label={displayName(e)} email={e.email} />
                      </span>
                    ))}
                  </NameList>
                )}
                <span style={{ color: "var(--color-text-tertiary)", marginLeft: 12 }}>
                  뷰어(무료) {d.viewers.length}명{d.viewers.length > 0 && `: ${d.viewers.map(displayName).join(" · ")}`}
                </span>
              </div>

              {/* 아래: 프로젝트 행 표 — 누가 어디에 있나 */}
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead>
                    <tr><th style={{ width: "38%" }}>프로젝트</th><th>편집 멤버 (좌석)</th><th style={{ width: "22%" }}>뷰어 (무료)</th></tr>
                  </thead>
                  <tbody>
                    {projectRows.length === 0 && <tr><td colSpan={3} className="is-muted" style={{ textAlign: "center" }}>소유한 프로젝트가 없습니다.</td></tr>}
                    {projectRows.map((p) => (
                      <tr key={p.projectId}>
                        <td>
                          <Link href={`/projects/${p.projectId}/members`} title="멤버 관리로 이동" style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>
                            {p.name}
                          </Link>
                        </td>
                        <td style={{ lineHeight: 1.7 }}>
                          <NameList>
                            {p.editors.map((e, i) => <NameChip key={i} label={e.label} email={e.email} role={e.role} />)}
                          </NameList>
                        </td>
                        <td className={p.viewers.length ? undefined : "is-muted"} style={{ lineHeight: 1.7 }}>
                          {p.viewers.length
                            ? <NameList>{p.viewers.map((v, i) => <NameChip key={i} label={v.label} email={v.email} />)}</NameList>
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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

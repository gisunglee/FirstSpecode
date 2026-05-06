"use client";

/**
 * ProjectCleanupSection — 정보 삭제 화면의 "프로젝트" 섹션
 *
 * 흐름:
 *   [대상 조회] → preview API → 표 노출 (모든 soft-deleted, 만료 배지로 구분)
 *   체크박스 / [만료된 것만 선택] / [전체 선택] → [영구 삭제 N건]
 *   → ConfirmDeleteDialog 가 동적 키워드("DELETE N") 강제 → execute API
 *   → 결과 메시지 + jobId 링크
 *
 * 휴먼 에러 방어:
 *   - 만료/보관 중을 시각 구분 + 별도 "만료된 것만 선택" 버튼
 *   - 보관 중 항목이 선택에 섞여 있으면 모달이 빨간 경고로 분리 표시
 *   - 키워드는 건수 포함 동적 ("DELETE 5") — 무의식 입력 차단
 *
 * 비대화 방지:
 *   행/배지/잔여시간 도우미만 두고, 모달은 별도 파일.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

// ─── API 응답 타입 ─────────────────────────────────────────────────────────
type ImpactCounts = {
  requirements: number;
  screens:      number;
  areas:        number;
  functions:    number;
  unitWorks:    number;
  tasks:        number;
  aiTasks:      number;
  dbTables:     number;
  attachFiles:  number;
};

type PreviewItem = {
  projectId:       string;
  name:            string;
  clientName:      string | null;
  deletedAt:       string | null;
  hardDeleteAt:    string | null;
  expired:         boolean;
  remainingHours:  number | null;
  deletedBy:       string | null;
  owner: { mberId: string; email: string | null; name: string | null } | null;
  impact:          ImpactCounts;
  impactTotal:     number;
};

type PreviewResponse = {
  data: {
    items:      PreviewItem[];
    summary:    { expiredCnt: number; retainedCnt: number };
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

type ExecuteResponse = {
  data: {
    jobId:          string;
    trgtCnt:        number;
    successCnt:     number;
    failCnt:        number;
    skipCnt:        number;
    ttusCode:       string;
    requestedCnt:   number;
    filteredOutCnt: number;
  };
};

// 한 번의 호출당 최대 처리 건수 — 서버 MAX_BATCH 와 동일하게 유지
const MAX_BATCH = 20;

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────
export function ProjectCleanupSection() {
  const qc = useQueryClient();
  const [page,      setPage]      = useState(1);
  const [enabled,   setEnabled]   = useState(false);
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [dialogOn,  setDialogOn]  = useState(false);
  // 결과는 string 메시지가 아닌 구조화된 데이터로 보관 — 정규식 추출 같은
  // fragile 한 패턴을 쓰지 않는다.
  const [lastResult, setLastResult] = useState<ExecuteResponse["data"] | null>(null);
  const [lastError,  setLastError]  = useState<string | null>(null);

  const preview = useQuery<PreviewResponse["data"]>({
    queryKey: ["admin", "cleanup", "projects", page],
    queryFn:  () =>
      authFetch<PreviewResponse>(
        `/api/admin/cleanup/projects/preview?page=${page}&pageSize=50`
      ).then((r) => r.data),
    enabled,
  });

  const items   = preview.data?.items   ?? [];
  const summary = preview.data?.summary;
  const pagi    = preview.data?.pagination;

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.projectId)),
    [items, selected]
  );
  const selectedExpiredCnt  = selectedItems.filter((i) =>  i.expired).length;
  const selectedRetainedCnt = selectedItems.filter((i) => !i.expired).length;
  const overBatch           = selected.size > MAX_BATCH;

  // 동적 키워드 — 휴먼 에러 방어. 0 건이면 모달 자체를 못 연다.
  const dialogKeyword = `DELETE ${selected.size}`;

  // ─── 실행 mutation ──────────────────────────────────────────────────────
  const executeMut = useMutation<ExecuteResponse["data"], Error, void>({
    mutationFn: () =>
      authFetch<ExecuteResponse>("/api/admin/cleanup/projects/execute", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          projectIds: Array.from(selected),
          confirm:    "DELETE",
        }),
      }).then((r) => r.data),
    onSuccess: (r) => {
      setDialogOn(false);
      setSelected(new Set());
      setLastResult(r);
      setLastError(null);
      qc.invalidateQueries({ queryKey: ["admin", "cleanup", "projects"] });
    },
    onError: (err) => {
      setLastError(err.message);
      setLastResult(null);
    },
  });

  // ─── 선택 조작 ──────────────────────────────────────────────────────────
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.projectId));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else            setSelected(new Set(items.map((i) => i.projectId)));
  };
  const selectExpiredOnly = () => {
    // 현재 페이지의 만료 항목만 선택 — 보관 중을 실수로 끼우는 사고 방어.
    setSelected(new Set(items.filter((i) => i.expired).map((i) => i.projectId)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  };

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--color-text-heading)" }}>
          프로젝트 영구 삭제
        </h2>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          OWNER 가 삭제 요청한 모든 프로젝트가 표시됩니다. 보관 만료는 빨간 배지로 구분됩니다.
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            onClick={() => {
              setEnabled(true);
              if (enabled) preview.refetch();
              setSelected(new Set());
              setLastResult(null);
              setLastError(null);
            }}
            disabled={preview.isFetching}
          >
            {preview.isFetching ? "조회 중…" : (enabled ? "다시 조회" : "대상 조회")}
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            onClick={selectExpiredOnly}
            disabled={items.length === 0 || items.every((i) => !i.expired)}
            title="현재 페이지의 보관 만료 항목만 선택"
          >
            만료된 것만 선택
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-danger"
            onClick={() => setDialogOn(true)}
            disabled={selected.size === 0 || overBatch || executeMut.isPending}
            title={overBatch ? `한 번에 최대 ${MAX_BATCH}건까지` : ""}
          >
            선택한 {selected.size}건 영구 삭제
          </button>
        </div>
      </header>

      {/* 요약 */}
      {summary && (
        <div style={{ display: "flex", gap: 16, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
          <span>총 <strong>{(summary.expiredCnt + summary.retainedCnt).toLocaleString()}</strong>건</span>
          <span style={{ color: "var(--color-danger, #dc2626)" }}>
            보관 만료 <strong>{summary.expiredCnt.toLocaleString()}</strong>건
          </span>
          <span>보관 중 <strong>{summary.retainedCnt.toLocaleString()}</strong>건</span>
          {overBatch && (
            <span style={{ color: "var(--color-warning, #d97706)" }}>
              ⚠ 한 번에 최대 {MAX_BATCH}건 — 현재 선택 {selected.size}건. 줄여 주세요.
            </span>
          )}
        </div>
      )}

      {/* 결과 메시지 */}
      {lastResult && (
        <ResultBanner result={lastResult} />
      )}
      {lastError && (
        <div style={{
          padding: "8px 12px", fontSize: "var(--text-sm)",
          background: "var(--color-danger-bg, #fee2e2)", color: "var(--color-danger, #dc2626)",
          border: "1px solid var(--color-danger-border, #fca5a5)", borderRadius: "var(--radius-sm)",
        }}>
          실패: {lastError}
        </div>
      )}

      {/* 표 */}
      <div style={{
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)", overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr style={{ background: "var(--color-bg-elevated)", borderBottom: "1px solid var(--color-border)" }}>
              <Th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={items.length === 0}
                  aria-label="전체 선택"
                />
              </Th>
              <Th>상태</Th>
              <Th>프로젝트</Th>
              <Th>OWNER</Th>
              <Th>삭제 요청</Th>
              <Th>보관 만료 / 잔여</Th>
              <Th>임팩트(자식 행 수)</Th>
            </tr>
          </thead>
          <tbody>
            {!enabled && (
              <tr><Td colSpan={7} align="center" muted>
                상단의 [대상 조회] 버튼을 눌러 목록을 불러오세요.
              </Td></tr>
            )}
            {enabled && preview.isLoading && (
              <tr><Td colSpan={7} align="center">불러오는 중…</Td></tr>
            )}
            {enabled && !preview.isLoading && items.length === 0 && (
              <tr><Td colSpan={7} align="center" muted>
                삭제 대기 중인 프로젝트가 없습니다.
              </Td></tr>
            )}
            {items.map((p) => (
              <tr key={p.projectId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Td>
                  <input
                    type="checkbox"
                    checked={selected.has(p.projectId)}
                    onChange={() => toggleOne(p.projectId)}
                  />
                </Td>
                <Td><StatusBadge expired={p.expired} /></Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {p.projectId.slice(0, 8)}…
                  </code>
                  {p.clientName && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                      {p.clientName}
                    </div>
                  )}
                </Td>
                <Td>
                  {p.owner ? (
                    <>
                      <div>{p.owner.name ?? p.owner.email ?? "(이름 없음)"}</div>
                      {p.owner.email && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                          {p.owner.email}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </Td>
                <Td>
                  {p.deletedAt
                    ? new Date(p.deletedAt).toLocaleString("ko-KR")
                    : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                </Td>
                <Td>
                  {p.hardDeleteAt ? (
                    <>
                      <div>{new Date(p.hardDeleteAt).toLocaleString("ko-KR")}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                        {formatRemaining(p.expired, p.remainingHours)}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </Td>
                <Td>
                  <ImpactSummary impact={p.impact} total={p.impactTotal} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {pagi && pagi.totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pagi.page <= 1}
          >
            이전
          </button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: "0 12px" }}>
            {pagi.page} / {pagi.totalPages}
          </span>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.min(pagi.totalPages, p + 1))}
            disabled={pagi.page >= pagi.totalPages}
          >
            다음
          </button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={dialogOn && selected.size > 0}
        title="프로젝트 영구 삭제"
        keyword={dialogKeyword}
        description={
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0 }}>
              <strong>{selected.size}건</strong> 의 프로젝트를 영구 삭제합니다.
              {" "}
              <strong>이 동작은 되돌릴 수 없습니다.</strong>
            </p>
            {selectedRetainedCnt > 0 && (
              <p style={{ margin: 0, color: "var(--color-danger, #dc2626)" }}>
                ⚠ 그 중 <strong>{selectedRetainedCnt}건</strong> 은 아직 보관 기간 중입니다.
                OWNER 의 복구권을 침해하게 됩니다.
              </p>
            )}
            {selectedExpiredCnt > 0 && (
              <p style={{ margin: 0, color: "var(--color-text-tertiary)" }}>
                보관 만료 {selectedExpiredCnt}건은 정상 정리 대상입니다.
              </p>
            )}
          </div>
        }
        onConfirm={async () => { await executeMut.mutateAsync(); }}
        onCancel={() => setDialogOn(false)}
      />
    </section>
  );
}

// ─── 작은 도우미들 ─────────────────────────────────────────────────────────

function ResultBanner({ result }: { result: ExecuteResponse["data"] }) {
  const partial = result.failCnt > 0 || result.filteredOutCnt > 0;
  return (
    <div style={{
      padding:      "8px 12px",
      background:   partial ? "var(--color-warning-bg, #fef3c7)" : "var(--color-success-bg, #dcfce7)",
      border:       "1px solid var(--color-border)",
      borderRadius: "var(--radius-sm)",
      fontSize:     "var(--text-sm)",
      color:        "var(--color-text-secondary)",
      display:      "flex",
      gap:          12,
      alignItems:   "center",
      flexWrap:     "wrap",
    }}>
      <strong>잡 {result.ttusCode}</strong>
      <span>성공 {result.successCnt}</span>
      <span>실패 {result.failCnt}</span>
      <span>스킵 {result.skipCnt}</span>
      {result.filteredOutCnt > 0 && (
        <span>요청 {result.requestedCnt}건 중 {result.filteredOutCnt}건은 활성 프로젝트로 판정되어 제외됨</span>
      )}
      <Link
        href={`/admin/batch/${result.jobId}`}
        style={{ marginLeft: "auto", color: "var(--color-brand)" }}
      >
        항목별 상세 →
      </Link>
    </div>
  );
}

function StatusBadge({ expired }: { expired: boolean }) {
  const c = expired
    ? { bg: "var(--color-danger-bg, #fee2e2)", fg: "var(--color-danger, #dc2626)", label: "보관 만료" }
    : { bg: "var(--color-bg-elevated)",         fg: "var(--color-text-secondary)", label: "보관 중" };
  return (
    <span
      style={{
        display:      "inline-block",
        padding:      "2px 8px",
        borderRadius: "var(--radius-pill, 999px)",
        background:   c.bg,
        color:        c.fg,
        fontSize:     "var(--text-xs)",
        fontWeight:   600,
        whiteSpace:   "nowrap",
      }}
    >
      {c.label}
    </span>
  );
}

/** 영구 삭제 시 함께 사라지는 자식 도메인 카운트를 한 줄로 압축 표시 */
function ImpactSummary({ impact, total }: { impact: ImpactCounts; total: number }) {
  if (total === 0) {
    return <span style={{ color: "var(--color-text-tertiary)" }}>—</span>;
  }
  // 0 인 항목은 숨겨 압축. 전체 합 + 주요 카테고리만 굵게.
  const parts: string[] = [];
  if (impact.requirements) parts.push(`요구 ${impact.requirements}`);
  if (impact.screens)      parts.push(`화면 ${impact.screens}`);
  if (impact.areas)        parts.push(`영역 ${impact.areas}`);
  if (impact.functions)    parts.push(`기능 ${impact.functions}`);
  if (impact.unitWorks)    parts.push(`단위 ${impact.unitWorks}`);
  if (impact.tasks)        parts.push(`과업 ${impact.tasks}`);
  if (impact.aiTasks)      parts.push(`AI ${impact.aiTasks}`);
  if (impact.dbTables)     parts.push(`DB ${impact.dbTables}`);
  if (impact.attachFiles)  parts.push(`첨부 ${impact.attachFiles}`);
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{total.toLocaleString()}행</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
        {parts.join(" · ")}
      </div>
    </div>
  );
}

function formatRemaining(expired: boolean, remainingHours: number | null) {
  if (expired) return "보관 기간 경과";
  if (remainingHours == null) return "—";
  if (remainingHours >= 48) return `${Math.floor(remainingHours / 24)}일 남음`;
  return `${remainingHours}시간 남음`;
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding:    "10px 12px",
        textAlign:  "left",
        fontSize:   "var(--text-xs)",
        fontWeight: 600,
        color:      "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing:"0.04em",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children, colSpan, align, muted,
}: {
  children:  React.ReactNode;
  colSpan?:  number;
  align?:    "left" | "center";
  muted?:    boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding:   "10px 12px",
        textAlign: align ?? "left",
        color:     muted ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

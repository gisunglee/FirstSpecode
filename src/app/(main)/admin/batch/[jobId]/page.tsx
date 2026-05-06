"use client";

/**
 * AdminBatchJobDetailPage — 배치 잡 항목 상세 (/admin/batch/[jobId])
 *
 * 역할:
 *   특정 잡의 항목별 처리 결과 (SUCCESS/FAILED/SKIPPED) 를 시계열로 보여 준다.
 *   "어제 배치에서 실패한 프로젝트가 어느 것?" 류 질문에 즉답하기 위한 화면.
 */

import { Suspense, use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";

type ItemRow = {
  itemId:      string;
  targetType:  string;
  targetId:    string;
  targetLabel: string | null;
  status:      string;
  errorMsg:    string | null;
  processedAt: string;
  meta:        unknown;
};

type ItemsResponse = {
  data: {
    items: ItemRow[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

const PAGE_SIZE = 100;

const STATUSES: Array<{ value: string; label: string }> = [
  { value: "",        label: "전체" },
  { value: "SUCCESS", label: "성공만" },
  { value: "FAILED",  label: "실패만" },
  { value: "SKIPPED", label: "스킵만" },
];

export default function AdminBatchJobDetailPage(
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = use(params);
  return (
    <Suspense fallback={null}>
      <Inner jobId={jobId} />
    </Suspense>
  );
}

function Inner({ jobId }: { jobId: string }) {
  const [status, setStatus] = useState("");
  const [page,   setPage]   = useState(1);

  const query = useQuery<ItemsResponse["data"]>({
    queryKey: ["admin", "batch-jobs", jobId, { status, page }],
    queryFn: () =>
      authFetch<ItemsResponse>(
        `/api/admin/batch/jobs/${jobId}/items?status=${status}&page=${page}&pageSize=${PAGE_SIZE}`
      ).then((r) => r.data),
  });

  const items      = query.data?.items ?? [];
  const totalCount = query.data?.pagination.totalCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/admin/batch" className="sp-btn sp-btn-ghost">← 잡 이력</Link>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          {jobId}
        </code>
        <select
          className="sp-input"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={{ minWidth: 140, marginLeft: 8 }}
        >
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          총 {totalCount.toLocaleString()}건
        </div>
      </div>

      <div
        style={{
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          overflow:     "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr style={{ background: "var(--color-bg-elevated)", borderBottom: "1px solid var(--color-border)" }}>
              <Th>처리 시각</Th>
              <Th>대상</Th>
              <Th>상태</Th>
              <Th>오류 / 메시지</Th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><Td colSpan={4} align="center">불러오는 중…</Td></tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr><Td colSpan={4} align="center" muted>항목이 없습니다.</Td></tr>
            )}
            {items.map((i) => (
              <tr key={i.itemId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Td>
                  <div style={{ fontSize: "var(--text-xs)" }}>
                    {new Date(i.processedAt).toLocaleString("ko-KR")}
                  </div>
                </Td>
                <Td>
                  <div>{i.targetLabel ?? <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {i.targetType}
                  </div>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {i.targetId}
                  </code>
                </Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td>
                  {i.errorMsg && (
                    <div style={{ color: "var(--color-danger, #dc2626)", fontSize: "var(--text-xs)" }}>
                      {i.errorMsg}
                    </div>
                  )}
                  {!i.errorMsg && i.meta !== null && (
                    <pre style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: 0, whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(i.meta, null, 2)}
                    </pre>
                  )}
                  {!i.errorMsg && i.meta === null && (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            이전
          </button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: "0 12px" }}>
            {page} / {totalPages}
          </span>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    SUCCESS: { bg: "var(--color-success-bg, #dcfce7)", fg: "var(--color-success, #16a34a)" },
    FAILED:  { bg: "var(--color-danger-bg,  #fee2e2)", fg: "var(--color-danger,  #dc2626)" },
    SKIPPED: { bg: "var(--color-bg-elevated)",          fg: "var(--color-text-secondary)" },
  };
  const s = map[status] ?? { bg: "var(--color-bg-elevated)", fg: "var(--color-text-secondary)" };
  return (
    <span
      style={{
        display:      "inline-block",
        padding:      "2px 8px",
        borderRadius: "var(--radius-pill, 999px)",
        background:   s.bg,
        color:        s.fg,
        fontSize:     "var(--text-xs)",
        fontWeight:   600,
      }}
    >
      {status}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
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

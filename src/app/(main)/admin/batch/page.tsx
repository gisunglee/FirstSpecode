"use client";

/**
 * AdminBatchJobsPage — 배치 잡 실행 이력 (/admin/batch)
 *
 * 역할:
 *   - 정기/수동 배치의 실행 이력 조회 (잡 종류·상태 필터, 페이징)
 *   - 한 행 클릭 → 항목별 상세(/admin/batch/[jobId]) 로 이동
 *
 * 설계:
 *   - 본 페이지는 조회 전용. 수동 실행 버튼은 추후 별도 페이지/모달로 분리
 *     (이력 조회와 실행 트리거를 같은 화면에 두면 실수 트리거 사고 위험).
 */

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/authFetch";

type JobItem = {
  jobId:        string;
  jobTyCode:    string;
  jobName:      string;
  triggerType:  string;
  triggerMber:  string | null;
  status:       string;
  startedAt:    string;
  endedAt:      string | null;
  targetCount:  number;
  successCount: number;
  failCount:    number;
  skipCount:    number;
  errorMsg:     string | null;
  summary:      unknown;
};

type JobsResponse = {
  data: {
    items: JobItem[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

const PAGE_SIZE = 50;

// 잡 종류 — runJob 호출 측의 jobTyCode 와 동기 유지
const JOB_TYPES: Array<{ value: string; label: string }> = [
  { value: "",                    label: "전체 종류" },
  { value: "PROJECT_HARD_DELETE", label: "프로젝트 영구 삭제" },
  { value: "ATTACH_FILE_CLEANUP", label: "첨부파일 디스크 정리" },
];

const STATUSES: Array<{ value: string; label: string }> = [
  { value: "",        label: "전체 상태" },
  { value: "RUNNING", label: "실행 중" },
  { value: "SUCCESS", label: "성공" },
  { value: "PARTIAL", label: "일부 실패" },
  { value: "FAILED",  label: "실패" },
];

export default function AdminBatchJobsPage() {
  return (
    <Suspense fallback={null}>
      <AdminBatchJobsInner />
    </Suspense>
  );
}

function AdminBatchJobsInner() {
  const router = useRouter();

  const [type,   setType]   = useState("");
  const [status, setStatus] = useState("");
  const [page,   setPage]   = useState(1);

  const query = useQuery<JobsResponse["data"]>({
    queryKey: ["admin", "batch-jobs", { type, status, page }],
    queryFn: () =>
      authFetch<JobsResponse>(
        `/api/admin/batch/jobs?type=${type}&status=${status}&page=${page}&pageSize=${PAGE_SIZE}`
      ).then((r) => r.data),
  });

  const items      = query.data?.items ?? [];
  const totalCount = query.data?.pagination.totalCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 필터 바 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="sp-input"
          value={type}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
          style={{ minWidth: 200 }}
        >
          {JOB_TYPES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="sp-input"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={{ minWidth: 140 }}
        >
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          총 {totalCount.toLocaleString()}건
        </div>
      </div>

      {/* 테이블 */}
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
              <Th>시작</Th>
              <Th>잡 종류 / 이름</Th>
              <Th>트리거</Th>
              <Th>상태</Th>
              <Th>처리</Th>
              <Th>오류</Th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><Td colSpan={6} align="center">불러오는 중…</Td></tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr><Td colSpan={6} align="center" muted>실행 이력이 없습니다.</Td></tr>
            )}
            {items.map((j) => (
              <tr
                key={j.jobId}
                onClick={() => router.push(`/admin/batch/${j.jobId}`)}
                style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
              >
                <Td>
                  <div>{new Date(j.startedAt).toLocaleString("ko-KR")}</div>
                  {j.endedAt && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                      ~ {new Date(j.endedAt).toLocaleTimeString("ko-KR")}
                    </div>
                  )}
                </Td>
                <Td>
                  <div>{j.jobName || j.jobTyCode}</div>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {j.jobTyCode}
                  </code>
                </Td>
                <Td>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                    {j.triggerType}
                  </code>
                </Td>
                <Td>
                  <StatusBadge status={j.status} />
                </Td>
                <Td>
                  <div style={{ fontSize: "var(--text-xs)" }}>
                    대상 <strong>{j.targetCount}</strong>
                    {" · "}
                    성공 <strong style={{ color: "var(--color-success, #16a34a)" }}>{j.successCount}</strong>
                    {j.failCount > 0 && (
                      <>{" · "}실패 <strong style={{ color: "var(--color-danger, #dc2626)" }}>{j.failCount}</strong></>
                    )}
                    {j.skipCount > 0 && <>{" · "}스킵 {j.skipCount}</>}
                  </div>
                </Td>
                <Td>
                  <div style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-danger, #dc2626)", fontSize: "var(--text-xs)" }}>
                    {j.errorMsg ?? <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
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
    PARTIAL: { bg: "var(--color-warning-bg, #fef3c7)", fg: "var(--color-warning, #d97706)" },
    FAILED:  { bg: "var(--color-danger-bg,  #fee2e2)", fg: "var(--color-danger,  #dc2626)" },
    RUNNING: { bg: "var(--color-info-bg,    #dbeafe)", fg: "var(--color-info,    #2563eb)" },
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

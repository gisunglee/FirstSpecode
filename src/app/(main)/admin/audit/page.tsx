"use client";

/**
 * AdminAuditPage — 감사 로그 조회 (/admin/audit)
 *
 * 역할:
 *   - 시스템 관리자 행동 로그(tb_sys_admin_audit) 검색·페이징
 *   - 행동 유형·대상 유형 필터
 *
 * 설계:
 *   - 감사 로그는 생성만 되고 삭제되지 않는다 (audit.ts 도 create 만 제공)
 *   - 따라서 페이지에는 조회 기능만 — 수정/삭제 UI 없음
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AUDIT_ACTION_LABEL, AUDIT_ACTION_TYPES, AUDIT_TARGET_LABEL, AUDIT_TARGET_TYPES } from "@/lib/auditTypes";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type AuditItem = {
  auditId:    string;
  admin:      { mberId: string; email: string | null; name: string | null };
  actionType: string;
  targetType: string | null;
  targetId:   string | null;
  memo:       string | null;
  ipAddr:     string | null;
  userAgent:  string | null;
  createdAt:  string;
};

type AuditResponse = {
  data: {
    items: AuditItem[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

const PAGE_SIZE = 50;

// 행동 유형 — audit.ts 의 AUDIT_ACTION_TYPES 와 동기 유지
// 액션·대상 라벨은 src/lib/auditTypes.ts 한 곳 (서버 상수와 같은 파일)
const ACTION_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 행동" },
  ...AUDIT_ACTION_TYPES.map((v) => ({ value: v, label: AUDIT_ACTION_LABEL[v] })),
];

const TARGET_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 대상" },
  ...AUDIT_TARGET_TYPES.map((v) => ({ value: v, label: AUDIT_TARGET_LABEL[v] })),
];

export default function AdminAuditPage() {
  return (
    <Suspense fallback={null}>
      <AdminAuditInner />
    </Suspense>
  );
}

// 구독 상세 등에서 ?targetType=SUBSCRIPTION&targetId=... 로 바로 들어올 수 있다
function AdminAuditInner() {
  const params = useSearchParams();
  const [actionType, setActionType] = useState(params.get("actionType") ?? "");
  const [targetType, setTargetType] = useState(params.get("targetType") ?? "");
  const [targetId]                  = useState(params.get("targetId") ?? "");
  const [page,       setPage]       = useState(1);

  const query = useQuery<AuditResponse["data"]>({
    queryKey: ["admin", "audit", { actionType, targetType, targetId, page }],
    queryFn: () =>
      authFetch<AuditResponse>(
        `/api/admin/audit?actionType=${actionType}&targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&page=${page}&pageSize=${PAGE_SIZE}`
      ).then((r) => r.data),
  });

  const items      = query.data?.items ?? [];
  const totalCount = query.data?.pagination.totalCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 필터 바 — sp-input-fixed + sp-select 조합으로 폭 고정 + 표준 chevron */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="sp-input sp-input-fixed sp-select"
          value={actionType}
          onChange={(e) => { setActionType(e.target.value); setPage(1); }}
          style={{ width: 200 }}
        >
          {ACTION_TYPES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="sp-input sp-input-fixed sp-select"
          value={targetType}
          onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
          style={{ width: 160 }}
        >
          {TARGET_TYPES.map((o) => (
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
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
              <Th>일시</Th>
              <Th>관리자</Th>
              <Th>행동</Th>
              <Th>대상</Th>
              <Th>사유/메모</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><Td colSpan={6} align="center">불러오는 중…</Td></tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr><Td colSpan={6} align="center" muted>기록이 없습니다.</Td></tr>
            )}
            {items.map((a) => (
              <tr key={a.auditId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Td>
                  <div>{new Date(a.createdAt).toLocaleString("ko-KR")}</div>
                </Td>
                <Td>
                  <div>{a.admin.name ?? a.admin.email ?? "(이름 없음)"}</div>
                  {a.admin.email && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                      {a.admin.email}
                    </div>
                  )}
                </Td>
                <Td>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                    {(AUDIT_ACTION_LABEL as Record<string, string>)[a.actionType] ?? a.actionType}
                  </code>
                </Td>
                <Td>
                  {a.targetType && (
                    <>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                        {a.targetType}
                      </div>
                      {a.targetId && (
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                          {a.targetId.slice(0, 8)}
                        </code>
                      )}
                    </>
                  )}
                  {!a.targetType && <span style={{ color: "var(--color-text-tertiary)" }}>-</span>}
                </Td>
                <Td>
                  <div style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.memo ?? ""}>
                    {a.memo ?? <span style={{ color: "var(--color-text-tertiary)" }}>-</span>}
                  </div>
                </Td>
                <Td>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {a.ipAddr ?? "-"}
                  </code>
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

// 요구사항 목록 그리드 헤더 톤과 동일 (uppercase 제거, text-secondary)
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding:    "10px 12px",
        textAlign:  "left",
        fontSize:   12,
        fontWeight: 600,
        color:      "var(--color-text-secondary)",
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

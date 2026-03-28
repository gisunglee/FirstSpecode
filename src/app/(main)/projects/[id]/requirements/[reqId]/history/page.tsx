"use client";

/**
 * RequirementHistoryPage — 요구사항 이력 목록 (PID-00035)
 *
 * 역할:
 *   - 이력 목록 그리드 조회 (FID-00118)
 *   - 내부 버전 삭제 (FID-00119)
 *   - Diff 뷰어 팝업 (PID-00036, FID-00120/121)
 *   - 버전 확정 팝업 (PID-00037, FID-00122)
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type HistoryItem = {
  historyId:    string;
  versionNo:    string;
  versionType:  "INTERNAL" | "CONFIRMED";
  comment:      string;
  changedAt:    string;
  changerEmail: string;
};

type DiffContent = {
  historyId: string;
  versionNo: string;
  orgnlCn:   string;
  curncyCn:  string;
  specCn:    string;
};

type DiffResult = {
  v1Content: DiffContent;
  v2Content: DiffContent;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function RequirementHistoryPage() {
  return (
    <Suspense fallback={null}>
      <RequirementHistoryPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function RequirementHistoryPageInner() {
  const params      = useParams<{ id: string; reqId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { id: projectId, reqId } = params;

  // 팝업 상태
  const [diffTarget,    setDiffTarget]    = useState<HistoryItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<HistoryItem | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<HistoryItem | null>(null);

  // ── 이력 목록 ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["req-history", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { items: HistoryItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements/${reqId}/history`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (historyId: string) =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}/history/${historyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("이력이 삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["req-history", projectId, reqId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* 브레드크럼 */}
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
        <span
          style={{ cursor: "pointer", color: "var(--color-primary)" }}
          onClick={() => router.push(`/projects/${projectId}/requirements/${reqId}`)}
        >
          요구사항 상세
        </span>
        <span style={{ margin: "0 6px" }}>›</span>
        <span>변경 이력</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>변경 이력</div>
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 12, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {items.length}건
      </div>

      {/* 이력 그리드 (AR-00052) */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          변경 이력이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div>버전</div>
            <div>구분</div>
            <div>변경일시</div>
            <div>변경자</div>
            <div>코멘트</div>
            <div>액션</div>
          </div>

          {/* 데이터 행 */}
          {items.map((item, idx) => (
            <div
              key={item.historyId}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {/* 버전 */}
              <div style={{ fontWeight: 700, fontSize: 14 }}>{item.versionNo}</div>

              {/* 구분 배지 */}
              <div>
                <span
                  style={{
                    padding:      "2px 8px",
                    borderRadius: 4,
                    fontSize:     12,
                    fontWeight:   600,
                    background:   item.versionType === "CONFIRMED" ? "#e3f2fd" : "#f3e5f5",
                    color:        item.versionType === "CONFIRMED" ? "#1565c0" : "#6a1b9a",
                  }}
                >
                  {item.versionType === "CONFIRMED" ? "확정" : "내부"}
                </span>
              </div>

              {/* 변경일시 */}
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {new Date(item.changedAt).toLocaleString("ko-KR", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>

              {/* 변경자 */}
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {item.changerEmail || "-"}
              </div>

              {/* 코멘트 */}
              <div
                style={{
                  fontSize:     13,
                  color:        "var(--color-text-secondary)",
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                }}
              >
                {item.comment || "-"}
              </div>

              {/* 액션 버튼 */}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setDiffTarget(item)} style={secondaryBtnStyle}>
                  Diff
                </button>
                {item.versionType === "INTERNAL" && (
                  <>
                    <button onClick={() => setConfirmTarget(item)} style={primaryBtnStyle}>
                      확정
                    </button>
                    <button onClick={() => setDeleteTarget(item)} style={dangerBtnStyle}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diff 뷰어 팝업 (PID-00036) */}
      {diffTarget && (
        <DiffViewerPopup
          projectId={projectId}
          reqId={reqId}
          items={items}
          initialItem={diffTarget}
          onClose={() => setDiffTarget(null)}
        />
      )}

      {/* 확정 코멘트 팝업 (PID-00037) */}
      {confirmTarget && (
        <ConfirmPopup
          projectId={projectId}
          reqId={reqId}
          item={confirmTarget}
          items={items}
          onClose={() => setConfirmTarget(null)}
          onSuccess={() => {
            setConfirmTarget(null);
            queryClient.invalidateQueries({ queryKey: ["req-history", projectId, reqId] });
          }}
        />
      )}

      {/* 삭제 확인 인라인 다이얼로그 */}
      {deleteTarget && (
        <div style={overlayStyle} onClick={() => setDeleteTarget(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>이력을 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              {deleteTarget.versionNo} 버전을 삭제합니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={secondaryBtnStyle}
                disabled={deleteMutation.isPending}
              >
                취소
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.historyId)}
                style={{ ...primaryBtnStyle, background: "#e53935" }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Diff 뷰어 팝업 (PID-00036) ────────────────────────────────────────────────

function DiffViewerPopup({
  projectId,
  reqId,
  items,
  initialItem,
  onClose,
}: {
  projectId:   string;
  reqId:       string;
  items:       HistoryItem[];
  initialItem: HistoryItem;
  onClose:     () => void;
}) {
  // 기본값: 클릭한 버전이 v2, 직전 버전이 v1
  const initialIdx = items.findIndex((i) => i.historyId === initialItem.historyId);
  const prevItem   = items[initialIdx + 1]; // 더 오래된 버전 (creat_dt desc 정렬)

  const [v1Id, setV1Id] = useState<string>(prevItem?.historyId ?? items[items.length - 1]?.historyId ?? "");
  const [v2Id, setV2Id] = useState<string>(initialItem.historyId);

  const sameSelected = v1Id === v2Id;

  const { data, isLoading } = useQuery({
    queryKey: ["req-history-diff", projectId, reqId, v1Id, v2Id],
    queryFn:  () =>
      authFetch<{ data: DiffResult }>(
        `/api/projects/${projectId}/requirements/${reqId}/history/diff?v1=${v1Id}&v2=${v2Id}`
      ).then((r) => r.data),
    enabled: !!v1Id && !!v2Id && !sameSelected,
  });

  return (
    <div style={{ ...overlayStyle, alignItems: "flex-start", overflowY: "auto" }} onClick={onClose}>
      <div
        style={{
          background:   "var(--color-bg-card)",
          borderRadius: 10,
          padding:      "28px 32px",
          width:        "90vw",
          maxWidth:     1100,
          margin:       "40px auto",
          boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>버전 비교 (Diff)</h3>
          <button onClick={onClose} style={secondaryBtnStyle}>닫기</button>
        </div>

        {/* 버전 선택 (AR-00053) */}
        <div style={{ display: "flex", gap: 16, marginBottom: 12, alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>좌측 버전</label>
            <select
              value={v1Id}
              onChange={(e) => setV1Id(e.target.value)}
              style={selectStyle}
            >
              {items.map((i) => (
                <option key={i.historyId} value={i.historyId}>
                  {i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 16, fontSize: 18, color: "var(--color-text-secondary)" }}>↔</div>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>우측 버전</label>
            <select
              value={v2Id}
              onChange={(e) => setV2Id(e.target.value)}
              style={selectStyle}
            >
              {items.map((i) => (
                <option key={i.historyId} value={i.historyId}>
                  {i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})
                </option>
              ))}
            </select>
          </div>
        </div>

        {sameSelected && (
          <div style={{ padding: "20px 0", textAlign: "center", color: "#f57c00", fontSize: 14 }}>
            서로 다른 버전을 선택해 주세요.
          </div>
        )}

        {isLoading && !sameSelected && (
          <div style={{ padding: "20px 0", textAlign: "center", color: "#888" }}>로딩 중...</div>
        )}

        {/* Diff 결과 (AR-00054, FID-00121) */}
        {data && !sameSelected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {(
              [
                { label: "원문 (orgnl_cn)",     l: data.v1Content.orgnlCn,  r: data.v2Content.orgnlCn  },
                { label: "현행화 (curncy_cn)",  l: data.v1Content.curncyCn, r: data.v2Content.curncyCn },
                { label: "상세 명세 (spec_cn)", l: data.v1Content.specCn,   r: data.v2Content.specCn   },
              ] as { label: string; l: string; r: string }[]
            ).map(({ label, l, r }) => (
              <DiffSection
                key={label}
                label={label}
                leftText={l}
                rightText={r}
                leftVersion={data.v1Content.versionNo}
                rightVersion={data.v2Content.versionNo}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Diff 섹션 — 좌우 나란히 비교 ─────────────────────────────────────────────

function DiffSection({
  label, leftText, rightText, leftVersion, rightVersion,
}: {
  label:        string;
  leftText:     string;
  rightText:    string;
  leftVersion:  string;
  rightVersion: string;
}) {
  // 간단한 라인 단위 diff: 공통/추가/삭제만 구분
  const leftLines  = leftText.split("\n");
  const rightLines = rightText.split("\n");

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--color-text-secondary)" }}>
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
        {/* 좌측 */}
        <div style={{ borderRight: "1px solid var(--color-border)" }}>
          <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
            {leftVersion} (이전)
          </div>
          <pre
            style={{
              margin:      0,
              padding:     "12px",
              fontSize:    13,
              lineHeight:  1.6,
              fontFamily:  "inherit",
              whiteSpace:  "pre-wrap",
              wordBreak:   "break-word",
              minHeight:   60,
              background:  "transparent",
            }}
          >
            {leftLines.map((line, i) => {
              const inRight = rightLines.includes(line);
              return (
                <span
                  key={i}
                  style={{
                    display:    "block",
                    background: !inRight && line ? "rgba(229, 57, 53, 0.12)" : "transparent",
                    color:      !inRight && line ? "#c62828" : "inherit",
                    textDecoration: !inRight && line ? "line-through" : "none",
                  }}
                >
                  {line || " "}
                </span>
              );
            })}
          </pre>
        </div>

        {/* 우측 */}
        <div>
          <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
            {rightVersion} (이후)
          </div>
          <pre
            style={{
              margin:      0,
              padding:     "12px",
              fontSize:    13,
              lineHeight:  1.6,
              fontFamily:  "inherit",
              whiteSpace:  "pre-wrap",
              wordBreak:   "break-word",
              minHeight:   60,
              background:  "transparent",
            }}
          >
            {rightLines.map((line, i) => {
              const inLeft = leftLines.includes(line);
              return (
                <span
                  key={i}
                  style={{
                    display:    "block",
                    background: !inLeft && line ? "rgba(46, 125, 50, 0.12)" : "transparent",
                    color:      !inLeft && line ? "#2e7d32" : "inherit",
                  }}
                >
                  {line || " "}
                </span>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── 확정 팝업 (PID-00037) ─────────────────────────────────────────────────────

function ConfirmPopup({
  projectId,
  reqId,
  item,
  items,
  onClose,
  onSuccess,
}: {
  projectId: string;
  reqId:     string;
  item:      HistoryItem;
  items:     HistoryItem[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [comment, setComment] = useState("");

  // 다음 확정 버전 번호 예측 (클라이언트 표시용)
  const lastConfirmedVersion = items
    .filter((i) => i.versionType === "CONFIRMED")
    .map((i) => parseInt(i.versionNo.replace("V", ""), 10))
    .filter((n) => !isNaN(n))
    .reduce((max, n) => Math.max(max, n), 1);
  const nextVersion = `V${lastConfirmedVersion + 1}`;

  const confirmMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}/history/${item.historyId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      }),
    onSuccess: () => {
      toast.success(`${nextVersion}으로 확정되었습니다.`);
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>버전 확정</h3>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          <strong style={{ color: "var(--color-text-primary)" }}>{item.versionNo}</strong>
          {" → "}
          <strong style={{ color: "#1565c0" }}>{nextVersion}</strong>
          {" 으로 확정합니다."}
        </p>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          확정 코멘트 <span style={{ fontWeight: 400, color: "#888" }}>(선택)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="확정 사유를 입력해 주세요..."
          rows={4}
          style={{
            width:        "100%",
            padding:      "8px 12px",
            borderRadius: 6,
            border:       "1px solid var(--color-border)",
            background:   "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            fontSize:     13,
            resize:       "vertical",
            boxSizing:    "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={confirmMutation.isPending}>
            취소
          </button>
          <button
            onClick={() => confirmMutation.mutate()}
            style={primaryBtnStyle}
            disabled={confirmMutation.isPending}
          >
            {confirmMutation.isPending ? "처리 중..." : "확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "90px 80px 180px 1fr 1fr 200px";

const gridHeaderStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "10px 16px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
  alignItems:          "center",
};

const gridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "12px 16px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "6px 14px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "6px 14px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const dangerBtnStyle: React.CSSProperties = {
  padding:      "6px 10px",
  borderRadius: 6,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     13,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const selectStyle: React.CSSProperties = {
  padding:      "7px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
};

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "28px 32px",
  minWidth:     360,
  maxWidth:     480,
  width:        "100%",
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};

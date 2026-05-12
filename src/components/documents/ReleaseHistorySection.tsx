"use client";

/**
 * ReleaseHistorySection — 산출물 발행 이력 목록 + 다운로드
 *
 * 역할:
 *   - 특정 산출물(요구사항·단위업무·화면 등) 의 발행 이력을 표 형태로 표시.
 *   - 각 행마다 그 시점 docx 를 다시 다운로드할 수 있는 [다운로드] 버튼 제공
 *     (서버가 박제해둔 snapshot_data 에서 복원).
 *
 * 도메인 무관:
 *   - props 로 docKind + refId 만 전달받으므로 다른 도메인 페이지에서도 그대로 재사용.
 *
 * 발행 액션은 별도:
 *   - [+ 새 발행] 버튼은 본 컴포넌트에 두지 않음. 호출부 페이지의 헤더에 [발행] 버튼이
 *     이미 존재하므로 중복 회피.
 *
 * 사용 예:
 *   <ReleaseHistorySection
 *     projectId={projectId}
 *     docKind="REQUIREMENT"
 *     refId={reqId}
 *   />
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import type { ReleaseDocKind } from "@/components/common/ReleaseDialog";

// ── 타입 ─────────────────────────────────────────────────────────────────
type ReleaseItem = {
  releaseId:    string;
  version:      string;
  change:       string;
  author:       string;
  approver:     string;
  releasedById: string | null;
  releasedAt:   string;
};

type ReleaseListResponse = { releases: ReleaseItem[] };

type Props = {
  projectId: string;
  docKind:   ReleaseDocKind;
  refId:     string;
  /** 다른 액션(발행 후 새로고침 트리거 등)을 위해 외부에서 useQuery key 추적용 */
  refreshTag?: number;
};

// ── 발행 버전 docx 다운로드 ──────────────────────────────────────────────
// authFetch 는 JSON 응답 전용 — 바이너리는 fetch 직접 + Authorization 부착.
// (handleExportDocx 와 같은 패턴)
async function downloadReleaseDocx(projectId: string, releaseId: string): Promise<void> {
  const at =
    typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

  await downloadReleaseFile(projectId, releaseId, "docx");
}

/**
 * 발행본 파일 다운로드 (형식 통합).
 *   - format="docx" : 모든 doc_kind 지원
 *   - format="xlsx" : REQUIREMENTS_DEF 만 지원 (다른 doc_kind 는 서버가 400 반환)
 *
 * 공통 흐름: fetch → blob → a.download → revoke.
 */
async function downloadReleaseFile(
  projectId: string,
  releaseId: string,
  format:    "docx" | "xlsx",
) {
  const at = typeof window !== "undefined"
    ? (sessionStorage.getItem("access_token") ?? "")
    : "";

  const url = `/api/projects/${projectId}/documents/release/${releaseId}/${format}`;
  const res = await fetch(url, { headers: at ? { Authorization: `Bearer ${at}` } : {} });

  if (!res.ok) {
    let msg = `다운로드 실패 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.message) msg = err.message;
    } catch { /* 빈 응답이면 기본 메시지 */ }
    throw new Error(msg);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = m ? decodeURIComponent(m[1]) : `release-${releaseId}.${format}`;

  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────
export default function ReleaseHistorySection({
  projectId,
  docKind,
  refId,
  refreshTag,
}: Props) {
  const { data, isLoading } = useQuery({
    // refreshTag 가 변하면 즉시 재조회 — 발행 직후 호출부에서 trigger 가능.
    //
    // 캐시 키 구조 — 후임자 주의:
    //   ReleaseDialog 와 deleteMutation 의 invalidateQueries 는 4항목 prefix
    //   ["release-history", projectId, docKind, refId] 로 매칭한다.
    //   따라서 refreshTag 는 *반드시* 키 배열의 마지막에 위치할 것.
    //   중간에 넣거나 빼면 prefix 매칭이 깨져 다이얼로그/외부 발행 시 자동 갱신이 안 된다.
    queryKey: ["release-history", projectId, docKind, refId, refreshTag],
    queryFn: () =>
      authFetch<{ data: ReleaseListResponse }>(
        `/api/projects/${projectId}/documents/release?docKind=${encodeURIComponent(docKind)}&refId=${encodeURIComponent(refId)}`
      ).then((r) => r.data),
    enabled: !!projectId && !!refId,
  });

  const releases = data?.releases ?? [];
  const queryClient = useQueryClient();

  // 삭제 확인 대상 — null 이면 다이얼로그 닫힘.
  // hard delete 라 사용자 확인을 명시적으로 받는다 (snapshot_data 도 같이 사라짐).
  const [deleteTarget, setDeleteTarget] = useState<ReleaseItem | null>(null);

  // 삭제 mutation — 권한은 서버에서 한 번 더 검증 (content.export)
  const deleteMutation = useMutation({
    mutationFn: (releaseId: string) =>
      authFetch(`/api/projects/${projectId}/documents/release/${releaseId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, releaseId) => {
      toast.success("발행 이력이 삭제되었습니다.");
      setDeleteTarget(null);
      // 같은 queryKey 캐시 모두 무효화 — refreshTag 다른 마운트 위치도 동기화
      queryClient.invalidateQueries({ queryKey: ["release-history", projectId, docKind, refId] });
      // releaseId 는 onSuccess 시그니처 호환을 위해 받음 (실제 사용 안 함)
      void releaseId;
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function handleDownload(item: ReleaseItem, format: "docx" | "xlsx") {
    try {
      await downloadReleaseFile(projectId, item.releaseId, format);
      toast.success(`${item.version} ${format.toUpperCase()} 다운로드 완료`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    }
  }

  // Excel 발행본은 현재 REQUIREMENTS_DEF 만 빌더 보유 — 다른 산출물은 docx 만 노출.
  // 추후 도메인별 xlsx 빌더 추가 시 이 조건을 확장.
  const supportsXlsx = docKind === "REQUIREMENTS_DEF";

  return (
    <section style={cardStyle} aria-labelledby="release-history-title">
      <h3
        id="release-history-title"
        style={{ margin: "0 0 4px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}
      >
        발행 이력
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        이 산출물의 공식 발행 기록입니다. 각 버전은 발행 시점의 양식이 그대로 박제되어
        있어, 데이터가 이후 변경되어도 같은 docx 를 다시 받을 수 있습니다.
      </p>

      {isLoading ? (
        <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>
      ) : releases.length === 0 ? (
        <div style={emptyStyle}>아직 발행된 버전이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>버전</th>
                <th style={thStyle}>발행일</th>
                <th style={{ ...thStyle, minWidth: 200 }}>변경 내용</th>
                <th style={thStyle}>작성자</th>
                <th style={thStyle}>승인자</th>
                <th style={{ ...thStyle, width: 100, textAlign: "right" }}> </th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.releaseId} style={trStyle}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.version}</td>
                  <td style={tdStyle}>{r.releasedAt.slice(0, 10)}</td>
                  <td style={{ ...tdStyle, whiteSpace: "pre-wrap" }}>{r.change || "—"}</td>
                  <td style={tdStyle}>{r.author || "—"}</td>
                  <td style={tdStyle}>{r.approver || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleDownload(r, "docx")}
                      style={downloadBtnStyle}
                      title="Word(.docx) 다운로드"
                    >
                      Word ↓
                    </button>
                    {supportsXlsx && (
                      <button
                        onClick={() => handleDownload(r, "xlsx")}
                        style={{ ...downloadBtnStyle, marginLeft: 4 }}
                        title="Excel(.xlsx) 다운로드"
                      >
                        Excel ↓
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(r)}
                      style={deleteBtnStyle}
                      title="이 발행 이력을 삭제합니다 (되돌릴 수 없음)"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 삭제 확인 — hard delete 라 한 번 더 묻고 진행 */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => deleteMutation.isPending ? null : setDeleteTarget(null)}
          style={overlayStyle}
        >
          <div onClick={(e) => e.stopPropagation()} style={confirmPanelStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: "var(--color-text-primary)" }}>
              발행 이력 삭제
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
              <strong style={{ color: "var(--color-text-primary)" }}>{deleteTarget.version}</strong>{" "}
              ({deleteTarget.releasedAt.slice(0, 10)}) 발행 이력을 삭제합니다.
              <br />
              박제된 스냅샷이 영구 삭제되어 그 버전의 docx 를 다시 받을 수 없습니다.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
                style={ghostBtnStyle}
              >
                취소
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.releaseId)}
                disabled={deleteMutation.isPending}
                style={dangerBtnStyle}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  padding:      "20px",
};

const emptyStyle: React.CSSProperties = {
  padding:    "16px",
  textAlign:  "center",
  color:      "var(--color-text-tertiary)",
  fontSize:   "var(--text-sm)",
  border:     "1px dashed var(--color-border)",
  borderRadius: "var(--radius-sm)",
};

const tableStyle: React.CSSProperties = {
  width:          "100%",
  borderCollapse: "collapse",
  fontSize:       "var(--text-sm)",
};

const thStyle: React.CSSProperties = {
  textAlign:    "left",
  padding:      "8px 10px",
  fontSize:     "var(--text-xs)",
  fontWeight:   600,
  color:        "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace:   "nowrap",
};

const trStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--color-border-subtle)",
};

const tdStyle: React.CSSProperties = {
  padding:    "10px",
  color:      "var(--color-text-primary)",
  fontSize:   "var(--text-sm)",
  lineHeight: 1.5,
  verticalAlign: "top",
};

const downloadBtnStyle: React.CSSProperties = {
  padding:      "4px 10px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     "var(--text-xs)",
  cursor:       "pointer",
};

const deleteBtnStyle: React.CSSProperties = {
  marginLeft:   4,
  padding:      "4px 10px",
  borderRadius: 4,
  border:       "1px solid var(--color-danger, #e53935)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-danger, #e53935)",
  fontSize:     "var(--text-xs)",
  cursor:       "pointer",
};

// 삭제 확인 모달
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1100, // ReleaseHistoryDialog(1000) 위에 떠야 함
};
const confirmPanelStyle: React.CSSProperties = {
  width: "min(420px, 92vw)",
  background: "var(--color-bg-card)",
  borderRadius: 8,
  boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
  padding: "20px 22px",
};
const ghostBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, fontWeight: 600,
  cursor: "pointer",
};
const dangerBtnStyle: React.CSSProperties = {
  padding: "7px 18px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-danger, #e53935)",
  color: "#fff",
  fontSize: 13, fontWeight: 600,
  cursor: "pointer",
};

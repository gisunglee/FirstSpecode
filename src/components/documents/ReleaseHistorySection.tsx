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

import { useQuery } from "@tanstack/react-query";
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

  const url = `/api/projects/${projectId}/documents/release/${releaseId}/docx`;
  const res = await fetch(url, { headers: at ? { Authorization: `Bearer ${at}` } : {} });

  if (!res.ok) {
    let msg = `다운로드 실패 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.message) msg = err.message;
    } catch { /* 빈 응답이면 기본 메시지 */ }
    throw new Error(msg);
  }

  // 파일명 — Content-Disposition 의 RFC 5987 형식 그대로 사용
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = m ? decodeURIComponent(m[1]) : `release-${releaseId}.docx`;

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
    // refreshTag 가 변하면 즉시 재조회 — 발행 직후 호출부에서 trigger 가능
    queryKey: ["release-history", projectId, docKind, refId, refreshTag],
    queryFn: () =>
      authFetch<{ data: ReleaseListResponse }>(
        `/api/projects/${projectId}/documents/release?docKind=${encodeURIComponent(docKind)}&refId=${encodeURIComponent(refId)}`
      ).then((r) => r.data),
    enabled: !!projectId && !!refId,
  });

  const releases = data?.releases ?? [];

  async function handleDownload(item: ReleaseItem) {
    try {
      await downloadReleaseDocx(projectId, item.releaseId);
      toast.success(`${item.version} 버전이 다운로드되었습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    }
  }

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
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      onClick={() => handleDownload(r)}
                      style={downloadBtnStyle}
                    >
                      다운로드
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

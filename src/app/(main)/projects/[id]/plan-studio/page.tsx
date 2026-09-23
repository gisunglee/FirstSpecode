"use client";

/**
 * PlanStudioListPage — 기획실 목록 (PID-PS-01)
 *
 * 역할:
 *   - 프로젝트 내 기획실 목록 (기획실ID, 기획실명, 산출물 수, 수정일시)
 *   - 기획실 생성 팝업 (기획실명 입력)
 *   - 기획실 삭제 (확인 다이얼로그)
 *   - 행 클릭 → 상세 이동
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

type StudioItem = {
  planStudioId: string;
  planStudioDisplayId: string;
  planStudioNm: string;
  artfCount: number;
  creatorNm: string;
  mdfcnDt: string | null;
  creatDt: string;
};

export default function PlanStudioListPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["plan-studios", projectId],
    queryFn: () =>
      authFetch<{ data: { items: StudioItem[] } }>(`/api/projects/${projectId}/plan-studios`).then((r) => r.data.items),
  });
  const items = data ?? [];

  const createMut = useMutation({
    mutationFn: (nm: string) =>
      authFetch<{ data: { planStudioId: string } }>(`/api/projects/${projectId}/plan-studios`, {
        method: "POST", body: JSON.stringify({ planStudioNm: nm }),
      }).then((r) => r.data),
    onSuccess: (d) => {
      toast.success("기획실이 생성되었습니다.");
      setCreateOpen(false);
      router.push(`/projects/${projectId}/plan-studio/${d.planStudioId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => authFetch(`/api/projects/${projectId}/plan-studios/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["plan-studios", projectId] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>기획실</span>
        <button onClick={() => { setCreateOpen(true); setCreateName(""); }} style={primaryBtn}>+ 생성</button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "12px 0 10px" }}>
          총 <strong>{items.length}</strong>건
        </div>

        {/* 테이블 — 표 외관(세로선·헤더 톤·hover·행간)은 sp-grid-table 클래스가 담당, 열 폭만 여기서 지정.
            빈 상태에서도 헤더가 표시되도록 컨테이너+헤더는 분기 밖에 둔다 */}
        <div className="sp-grid-table">
          <div className="sp-grid-table-head" style={{ gridTemplateColumns: GRID }}>
            <div>기획실ID</div>
            <div>기획실명</div>
            <div className="is-center">산출물수</div>
            <div className="is-center">담당자</div>
            <div className="is-center">수정일시</div>
            <div className="is-center" />
          </div>

          {isLoading ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>로딩 중...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>등록된 기획실이 없습니다. 생성 버튼을 눌러 시작하세요.</div>
          ) : items.map((s) => (
            <div
              key={s.planStudioId}
              onClick={() => router.push(`/projects/${projectId}/plan-studio/${s.planStudioId}`)}
              className="sp-grid-table-row"
              style={{ gridTemplateColumns: GRID }}
            >
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{s.planStudioDisplayId}</div>
              {/* flex 셀에는 ellipsis 가 먹지 않으므로 안쪽 span(is-ellipsis)에 건다 */}
              <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}><span className="is-ellipsis">{s.planStudioNm}</span></div>
              <div className="is-center" style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{s.artfCount}</div>
              <div className="is-center" style={{ fontSize: 13, color: "var(--color-text-primary)" }}><span className="is-ellipsis">{s.creatorNm}</span></div>
              <div className="is-center" style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{formatPlanStudioDt(s.mdfcnDt ?? s.creatDt)}</div>
              <div className="is-center" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setDeleteTarget({ id: s.planStudioId, name: s.planStudioNm })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--color-text-tertiary)" }} title="삭제">×</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 생성 팝업 */}
      {createOpen && (
        <div onClick={() => setCreateOpen(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={dialog}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>새 기획실 생성</div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px" }}>기획실명을 입력해 주세요.</p>
            <input autoFocus value={createName} onChange={(e) => setCreateName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && createName.trim()) createMut.mutate(createName.trim()); }} placeholder="예: 회원관리 기획실" style={input} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setCreateOpen(false)} style={secBtn}>취소</button>
              <button onClick={() => createName.trim() && createMut.mutate(createName.trim())} disabled={createMut.isPending} style={primaryBtn}>{createMut.isPending ? "생성 중..." : "확인"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <div onClick={() => setDeleteTarget(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={dialog}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>기획실 삭제</div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 8px" }}><strong>{deleteTarget.name}</strong>을(를) 삭제하시겠습니까?</p>
            <p style={{ fontSize: 12, color: "#e53935", margin: "0 0 20px" }}>기획실 내 모든 산출물과 컨텍스트가 함께 삭제됩니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={secBtn}>취소</button>
              <button onClick={() => deleteMut.mutate(deleteTarget.id)} style={{ ...primaryBtn, background: "#e53935" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 열 폭 — 기획실ID / 기획실명 / 산출물수 / 담당자 / 수정일시 / 삭제.
// 고정폭은 sp-grid-table 셀 좌우 패딩(6px×2=12px)을 포함한 값. 헤더/행이 같은 값을 써야 한다.
const GRID = "112px 1fr 92px 112px 172px 52px";

// 수정일시 포맷 — "YYYY-MM-DD HH:mm" 으로 짧게.
// toLocaleString() 기본값(예: "2026. 4. 11. 오전 11:33:32")은 한글 포맷이라
// 21+자가 넘어 컬럼을 압박하므로 다른 목록 페이지와 동일한 ISO-식 포맷으로 통일.
function formatPlanStudioDt(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const dialog: React.CSSProperties = { background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" };
const input: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { padding: "6px 16px", borderRadius: 6, border: "none", background: "var(--color-primary, #1976d2)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const secBtn: React.CSSProperties = { padding: "6px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, cursor: "pointer" };

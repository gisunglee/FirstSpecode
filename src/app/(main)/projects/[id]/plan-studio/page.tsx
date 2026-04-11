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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>기획실</span>
        <button onClick={() => { setCreateOpen(true); setCreateName(""); }} style={primaryBtn}>+ 생성</button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "12px 0 10px" }}>
          총 <strong>{items.length}</strong>건
        </div>

        {/* 테이블 */}
        <div style={gridHeader}>
          <div>기획실ID</div>
          <div>기획실명</div>
          <div style={{ textAlign: "center" }}>산출물수</div>
          <div>수정일시</div>
          <div />
        </div>

        {isLoading ? (
          <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>로딩 중...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 20, color: "#aaa", fontSize: 13 }}>등록된 기획실이 없습니다. 생성 버튼을 눌러 시작하세요.</div>
        ) : items.map((s) => (
          <div key={s.planStudioId} onClick={() => router.push(`/projects/${projectId}/plan-studio/${s.planStudioId}`)} style={gridRow}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{s.planStudioDisplayId}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-primary, #1976d2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.planStudioNm}</div>
            <div style={{ textAlign: "center", fontSize: 13 }}>{s.artfCount}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{new Date(s.mdfcnDt ?? s.creatDt).toLocaleString()}</div>
            <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setDeleteTarget({ id: s.planStudioId, name: s.planStudioNm })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#ccc" }} title="삭제">×</button>
            </div>
          </div>
        ))}
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

const GRID = "100px 1fr 80px 140px 40px";
const gridHeader: React.CSSProperties = { display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "10px 16px", background: "var(--color-bg-muted)", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" };
const gridRow: React.CSSProperties = { display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "12px 16px", alignItems: "center", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", cursor: "pointer", transition: "background 0.1s" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const dialog: React.CSSProperties = { background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" };
const input: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { padding: "6px 16px", borderRadius: 6, border: "none", background: "var(--color-primary, #1976d2)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const secBtn: React.CSSProperties = { padding: "6px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, cursor: "pointer" };

"use client";

/**
 * ImportCheckMasterDialog — 공통 점검 마스터 가져오기 모달
 *
 * 역할:
 *   - 시스템 공통 + 프로젝트 전용 점검 마스터 조회
 *   - 카테고리별 그룹화 + 체크박스 다중 선택
 *   - "선택 항목 가져오기" → 부모 콜백으로 선택 row 전달 → 부모가 form.cases 에 추가
 *
 * 부모(명세서 페이지)는 콜백에서 받은 항목을 ctgryCode="CHECKLIST" 케이스로 변환.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type CheckMasterItem = {
  checkId:    string;
  scope:      "SYSTEM" | "PROJECT";
  ctgryCode:  string;
  scenarioCn: string;
  expectedCn: string;
  sortOrdr:   number;
};

// 카테고리 라벨 — code → 한글
const CTGRY_LABEL: Record<string, string> = {
  INIT_SCREEN: "초기화면",
  QUERY:       "조회",
  INPUT_QUERY: "입력 및 조회",
  INPUT:       "입력",
  SECURITY:    "보안",
  ETC:         "기타",
};

export default function ImportCheckMasterDialog({
  projectId, open, onClose, onImport,
}: {
  projectId: string;
  open:      boolean;
  onClose:   () => void;
  onImport:  (items: CheckMasterItem[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 모달 닫힐 때 선택 초기화 — 다음 진입 시 깨끗한 상태
  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const { data: items = [], isLoading } = useQuery<CheckMasterItem[]>({
    queryKey: ["check-masters", projectId],
    queryFn:  async () => {
      const res = await authFetch<{ data: { items: CheckMasterItem[] } }>(
        `/api/projects/${projectId}/check-masters`
      );
      return res.data.items;
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  // 카테고리별 그룹화
  const grouped = useMemo(() => {
    const map = new Map<string, CheckMasterItem[]>();
    for (const it of items) {
      if (!map.has(it.ctgryCode)) map.set(it.ctgryCode, []);
      map.get(it.ctgryCode)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  if (!open) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.checkId)));
  }
  function toggleGroup(ctgry: string) {
    const groupIds = items.filter((i) => i.ctgryCode === ctgry).map((i) => i.checkId);
    const allSel = groupIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of groupIds) {
        if (allSel) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function handleImport() {
    const picked = items.filter((i) => selected.has(i.checkId));
    onImport(picked);
    onClose();
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={dialogStyle}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
            공통 점검 가져오기
          </span>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        {/* 본문 */}
        <div style={{ padding: "12px 20px", flex: 1, overflowY: "auto" }}>
          {/* 헬프 + 전체선택 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              시스템 공통 항목 + 프로젝트 전용 항목을 함께 보여줍니다. 필요한 것만 골라 가져오세요.
            </span>
            <button onClick={toggleAll} style={linkBtnStyle}>
              {selected.size === items.length && items.length > 0 ? "전체 해제" : "전체 선택"}
            </button>
          </div>

          {isLoading ? (
            <div style={loadingStyle}>로딩 중...</div>
          ) : items.length === 0 ? (
            <div style={emptyStyle}>등록된 마스터 항목이 없습니다.</div>
          ) : (
            grouped.map(([ctgry, list]) => {
              const groupAllSel = list.every((i) => selected.has(i.checkId));
              return (
                <div key={ctgry} style={{ marginBottom: 16 }}>
                  <div style={groupHeaderStyle}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={groupAllSel}
                        onChange={() => toggleGroup(ctgry)}
                      />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {CTGRY_LABEL[ctgry] ?? ctgry}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                        ({list.filter((i) => selected.has(i.checkId)).length} / {list.length})
                      </span>
                    </label>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {list.map((it) => (
                      <label
                        key={it.checkId}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 8,
                          padding: "6px 10px", borderRadius: 4,
                          background: selected.has(it.checkId) ? "rgba(103,80,164,0.06)" : "transparent",
                          cursor: "pointer", transition: "background 0.1s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(it.checkId)}
                          onChange={() => toggle(it.checkId)}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, fontSize: 12, color: "var(--color-text-primary)" }}>
                          <div style={{ fontWeight: 500, lineHeight: 1.5 }}>{it.scenarioCn}</div>
                          {it.expectedCn && (
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                              → {it.expectedCn}
                            </div>
                          )}
                        </div>
                        {it.scope === "PROJECT" && (
                          <span style={projectBadge}>프로젝트</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 푸터 */}
        <div style={footerStyle}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            선택 {selected.size}건
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={secondaryBtnStyle}>취소</button>
          <button
            onClick={handleImport}
            disabled={selected.size === 0}
            style={{ ...primaryBtnStyle, opacity: selected.size === 0 ? 0.5 : 1, cursor: selected.size === 0 ? "not-allowed" : "pointer" }}
          >
            {selected.size}건 가져오기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10,
  width: "min(720px, 92vw)",
  maxHeight: "84vh",
  display: "flex", flexDirection: "column",
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};
const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "14px 20px",
  borderBottom: "1px solid var(--color-border)",
};
const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 20, color: "var(--color-text-secondary)", lineHeight: 1,
};
const groupHeaderStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "var(--color-bg-muted)",
  borderRadius: 4, marginBottom: 4,
};
const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 12, color: "var(--color-brand, #1976d2)",
  fontWeight: 600,
};
const loadingStyle: React.CSSProperties = {
  padding: "40px 16px", textAlign: "center",
  color: "var(--color-text-tertiary)", fontSize: 13,
};
const emptyStyle: React.CSSProperties = {
  padding: "60px 16px", textAlign: "center",
  color: "var(--color-text-tertiary)", fontSize: 13,
  border: "1px dashed var(--color-border)", borderRadius: 6,
};
const footerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "12px 20px",
  borderTop: "1px solid var(--color-border)",
  background: "var(--color-bg-muted)",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff", fontSize: 13, fontWeight: 600,
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};
const projectBadge: React.CSSProperties = {
  flexShrink: 0,
  padding: "1px 6px", borderRadius: 8,
  background: "rgba(103,80,164,0.12)",
  color: "rgba(103,80,164,1)",
  fontSize: 10, fontWeight: 700,
  alignSelf: "flex-start",
};

"use client";

/**
 * DiffPromptTestPage — Diff Prompt Test 메인 페이지 (/test/diff-prompt)
 *
 * 역할:
 *   - 4개 textarea(UW/PID/AR/FID)에 raw MD 입력
 *   - 저장 → master + node 4건 INSERT (변경 노드 표시)
 *   - 차이 프롬프트 → 직전 master와 비교 후 PRD_CHANGE.md 생성/표시
 *   - 최종 버전 불러오기 / 이력 패널 / 초기화
 *
 * 주요 기술:
 *   - 일반 fetch (인증 없음, 테스트 페이지)
 *   - 좌측 4박스 그리드 + 우측 이력 패널
 */

import { useState, useEffect, useCallback } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";

// ── 타입 ─────────────────────────────────────────────────────────────────────
type NodeType = "UW" | "PID" | "AR" | "FID";
const NODE_TYPES: NodeType[] = ["UW", "PID", "AR", "FID"];

const NODE_LABEL: Record<NodeType, string> = {
  UW: "단위업무",
  PID: "화면",
  AR: "영역",
  FID: "기능",
};

const NODE_COLOR: Record<NodeType, string> = {
  UW: "#1976d2",
  PID: "#2e7d32",
  AR: "#e65100",
  FID: "#6a1b9a",
};

type NodeInputs = Record<NodeType, string>;
type NodeStats = { changed: boolean; hash: string; mode?: string; lineRatio?: number; added?: number; removed?: number; kept?: number };

type MasterListItem = {
  masterId: string;
  testSn: number;
  sjNm: string | null;
  creatDt: string;
  chgNodeCnt: number;
  hasDiffPrompt: boolean;
};

// ── 페이지 ───────────────────────────────────────────────────────────────────
export default function DiffPromptTestPage() {
  const [sjNm, setSjNm] = useState("");
  const [memoCn, setMemoCn] = useState("");
  const [inputs, setInputs] = useState<NodeInputs>({ UW: "", PID: "", AR: "", FID: "" });
  const [nodeStats, setNodeStats] = useState<Record<NodeType, NodeStats> | null>(null);
  const [list, setList] = useState<MasterListItem[]>([]);
  const [currentMasterId, setCurrentMasterId] = useState<string | null>(null);
  const [diffMd, setDiffMd] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<"preview" | "raw">("preview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // ── 목록 로드 ──
  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/diff-test/list");
      const json = await res.json();
      setList(json.data?.items ?? []);
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // ── 최종 버전 불러오기 ──
  async function loadLatest() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/diff-test/load-latest");
      const json = await res.json();
      const m = json.data?.master;
      if (!m) { setMsg("저장된 데이터가 없습니다."); return; }
      setSjNm(m.sjNm ?? "");
      setMemoCn(m.memoCn ?? "");
      setInputs({
        UW: m.nodes.UW?.rawMd ?? "",
        PID: m.nodes.PID?.rawMd ?? "",
        AR: m.nodes.AR?.rawMd ?? "",
        FID: m.nodes.FID?.rawMd ?? "",
      });
      setCurrentMasterId(m.masterId);
      setNodeStats(null);
      setDiffMd(null);
      setMsg(`Master #${m.testSn} 불러옴`);
    } finally { setBusy(false); }
  }

  // ── 특정 master 불러오기 ──
  async function loadById(masterId: string) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/diff-test/load/${masterId}`);
      const json = await res.json();
      const m = json.data?.master;
      if (!m) { setMsg("불러오기 실패"); return; }
      setSjNm(m.sjNm ?? "");
      setMemoCn(m.memoCn ?? "");
      setInputs({
        UW: m.nodes.UW?.rawMd ?? "",
        PID: m.nodes.PID?.rawMd ?? "",
        AR: m.nodes.AR?.rawMd ?? "",
        FID: m.nodes.FID?.rawMd ?? "",
      });
      setCurrentMasterId(m.masterId);
      setNodeStats(null);
      setMsg(`Master #${m.testSn} 불러옴`);
    } finally { setBusy(false); }
  }

  // 돋보기 클릭 — 해당 master의 diff 프롬프트만 모달로 표시 (입력 폼에 영향 없음)
  async function viewDiff(masterId: string) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/diff-test/load/${masterId}`);
      const json = await res.json();
      const m = json.data?.master;
      if (!m?.diffPromptMd) { setMsg("이 버전에는 차이 프롬프트가 없습니다."); return; }
      setDiffMd(m.diffPromptMd);
    } finally { setBusy(false); }
  }

  // ── 저장 ──
  async function save() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/diff-test/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sjNm: sjNm || undefined, memoCn: memoCn || undefined, nodes: inputs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "저장 실패");
      const data = json.data;
      setCurrentMasterId(data.masterId);
      setNodeStats(data.nodeStats);
      setMsg(`Master #${data.testSn} 저장됨 · 변경: ${data.changedNodes.join(", ") || "없음"}`);
      await loadList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "저장 실패");
    } finally { setBusy(false); }
  }

  // ── 차이 프롬프트 생성 ──
  async function genDiff() {
    if (!currentMasterId) { setMsg("먼저 저장하거나 master를 불러오세요."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/diff-test/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMasterId: currentMasterId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "생성 실패");
      setDiffMd(json.data.diffPromptMd);
      setMsg("차이 프롬프트 생성 완료");
      await loadList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "생성 실패");
    } finally { setBusy(false); }
  }

  // ── 초기화 ──
  async function reset() {
    if (!confirm("모든 테스트 데이터를 삭제합니다. 진행할까요?")) return;
    setBusy(true); setMsg("");
    try {
      await fetch("/api/diff-test/reset", { method: "DELETE" });
      setSjNm(""); setMemoCn("");
      setInputs({ UW: "", PID: "", AR: "", FID: "" });
      setCurrentMasterId(null);
      setNodeStats(null);
      setDiffMd(null);
      setMsg("초기화 완료");
      await loadList();
    } finally { setBusy(false); }
  }

  // ── 단축키 — save/genDiff/loadLatest는 ref-like 클로저로 매번 최신 상태 캡처 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); genDiff(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "l") { e.preventDefault(); loadLatest(); }
      if (e.key === "Escape" && diffMd) { setDiffMd(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });  // 의존성 배열 생략 — 매 렌더마다 재등록되어 최신 클로저 보장

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, height: "100vh", boxSizing: "border-box", color: "var(--color-text-primary)" }}>
      {/* 좌측 메인 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 20, color: "var(--color-text-primary)" }}>SPECODE — Diff Prompt Test</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{msg}</div>
        </div>

        {/* 툴바 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={loadLatest} disabled={busy} style={btn}>최종 버전 불러오기</button>
          <button onClick={save} disabled={busy} style={{ ...btn, background: "#1976d2", color: "#fff" }}>💾 저장 (Ctrl+S)</button>
          <button onClick={genDiff} disabled={busy || !currentMasterId} style={{ ...btn, background: "#e65100", color: "#fff" }}>🔍 차이 프롬프트 (Ctrl+D)</button>
          <button onClick={reset} disabled={busy} style={{ ...btn, background: "#e53935", color: "#fff" }}>🗑 초기화</button>
        </div>

        {/* 제목/메모 */}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={sjNm} onChange={(e) => setSjNm(e.target.value)} placeholder="제목 (선택)" style={{ ...input, flex: 1 }} />
          <input value={memoCn} onChange={(e) => setMemoCn(e.target.value)} placeholder="메모 (선택)" style={{ ...input, flex: 2 }} />
        </div>

        {/* 4개 박스 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
          {NODE_TYPES.map((t) => (
            <NodeBox
              key={t}
              type={t}
              value={inputs[t]}
              onChange={(v) => setInputs((p) => ({ ...p, [t]: v }))}
              stats={nodeStats?.[t]}
            />
          ))}
        </div>

      </div>

      {/* ── 차이 프롬프트 결과 모달 ── */}
      {diffMd && (
        <div
          onClick={() => setDiffMd(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 8, padding: 0,
              width: "90vw", height: "90vh",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              color: "#1a1a1a",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #ddd", background: "#f5f5f5", color: "#1a1a1a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <strong style={{ fontSize: 15, color: "#1a1a1a" }}>🔍 PRD_CHANGE.md</strong>
                <div style={{ display: "flex", gap: 4, background: "#e0e0e0", borderRadius: 6, padding: 2 }}>
                  <button
                    onClick={() => setDiffViewMode("preview")}
                    style={{ ...tabBtn, background: diffViewMode === "preview" ? "#fff" : "transparent", color: "#1a1a1a", fontWeight: diffViewMode === "preview" ? 700 : 500, boxShadow: diffViewMode === "preview" ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }}
                  >
                    👁 미리보기
                  </button>
                  <button
                    onClick={() => setDiffViewMode("raw")}
                    style={{ ...tabBtn, background: diffViewMode === "raw" ? "#fff" : "transparent", color: "#1a1a1a", fontWeight: diffViewMode === "raw" ? 700 : 500, boxShadow: diffViewMode === "raw" ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }}
                  >
                    {"</>"} Raw
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(diffMd)} style={modalBtn}>📋 복사</button>
                <button
                  onClick={() => {
                    const blob = new Blob([diffMd], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `PRD_CHANGE_${Date.now()}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={modalBtn}
                >
                  💾 다운로드
                </button>
                <button onClick={() => setDiffMd(null)} style={modalBtn}>✕ 닫기</button>
              </div>
            </div>
            {diffViewMode === "preview" ? (
              <>
                <style dangerouslySetInnerHTML={{ __html: DIFF_PREVIEW_CSS }} />
                <div
                  className="diff-md"
                  style={{
                    flex: 1, overflow: "auto", padding: "20px 32px", background: "#fff",
                    fontSize: 13, lineHeight: 1.7, color: "#222",
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(diffMd) }}
                />
              </>
            ) : (
              <pre style={{
                margin: 0, padding: 20, flex: 1, overflow: "auto",
                fontSize: 13, fontFamily: "monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                background: "#f7f7f7", color: "#1a1a1a",
              }}>{diffMd}</pre>
            )}
          </div>
        </div>
      )}

      {/* 우측 이력 패널 */}
      <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, overflow: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>최근 저장 이력 ({list.length})</div>
        {list.length === 0 ? (
          <div style={{ fontSize: 12, color: "#888" }}>저장 이력이 없습니다.</div>
        ) : (
          list.map((m) => (
            <div
              key={m.masterId}
              style={{
                padding: "6px 8px",
                borderBottom: "1px solid #eee",
                background: currentMasterId === m.masterId ? "#e3f2fd" : "transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <div
                onClick={() => loadById(m.masterId)}
                style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
                  <span>#{m.testSn}</span>
                  <span style={{ color: "#888", fontWeight: 400 }}>변경 {m.chgNodeCnt}건</span>
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.sjNm || "(제목 없음)"}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                  {new Date(m.creatDt).toLocaleString()}
                </div>
              </div>
              {m.hasDiffPrompt && (
                <button
                  onClick={(e) => { e.stopPropagation(); viewDiff(m.masterId); }}
                  title="차이 프롬프트 보기"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 16, padding: "2px 6px", flexShrink: 0,
                  }}
                >
                  🔍
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── NodeBox ──
function NodeBox({ type, value, onChange, stats }: {
  type: NodeType;
  value: string;
  onChange: (v: string) => void;
  stats?: NodeStats;
}) {
  const lineCount = value.split("\n").length;
  const charCount = value.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", border: `2px solid ${NODE_COLOR[type]}`, borderRadius: 6, overflow: "hidden", minHeight: 0 }}>
      <div style={{ background: NODE_COLOR[type], color: "#fff", padding: "4px 10px", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
        <span>{type} — {NODE_LABEL[type]}</span>
        {stats && (
          <span style={{ fontSize: 10 }}>
            {stats.changed ? `🔴 ${stats.mode}` : "⚪ 동일"}
            {stats.lineRatio != null && stats.changed && ` · ${(stats.lineRatio * 100).toFixed(0)}%`}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${type} raw MD를 입력하세요...`}
        style={{
          flex: 1, padding: 8, fontSize: 12, fontFamily: "monospace",
          border: "none", outline: "none", resize: "none", minHeight: 0,
        }}
      />
      <div style={{ padding: "3px 10px", fontSize: 10, color: "#888", borderTop: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
        <span>{lineCount}줄 · {charCount}자</span>
        {stats && <span>hash: {stats.hash.slice(0, 8)}</span>}
      </div>
    </div>
  );
}

// ── 스타일 ──
const btn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

// 미리보기 CSS — 모달 내부에서 항상 라이트 모드로 강제 (가독성)
const DIFF_PREVIEW_CSS = [
  ".diff-md{color:#1a1a1a !important}",
  ".diff-md h1{font-size:22px;font-weight:800;margin:18px 0 10px;border-bottom:2px solid #1976d2;padding-bottom:6px;color:#1a1a1a}",
  ".diff-md h2{font-size:17px;font-weight:700;margin:16px 0 8px;color:#1a1a1a;border-left:4px solid #1976d2;padding-left:10px}",
  ".diff-md h3{font-size:15px;font-weight:700;margin:14px 0 6px;color:#1a1a1a}",
  ".diff-md p{margin:6px 0;color:#1a1a1a}",
  ".diff-md ul,.diff-md ol{margin:6px 0;padding-left:24px;color:#1a1a1a}",
  ".diff-md li{margin:2px 0;color:#1a1a1a}",
  ".diff-md table{border-collapse:collapse;width:100%;margin:10px 0}",
  ".diff-md th,.diff-md td{border:1px solid #ccc;padding:6px 12px;font-size:13px;color:#1a1a1a}",
  ".diff-md th{background:#e3f2fd;font-weight:700;color:#1a1a1a}",
  ".diff-md tr:nth-child(even) td{background:#fafafa}",
  ".diff-md pre{background:#f5f5f5;padding:12px 16px;border-radius:6px;font-size:12px;margin:8px 0;border:1px solid #e0e0e0;color:#1a1a1a;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}",
  ".diff-md code{font-family:monospace;background:#fff3e0;padding:2px 6px;border-radius:3px;font-size:12px;color:#e65100}",
  ".diff-md pre code{background:none;padding:0;color:#1a1a1a}",
  ".diff-md blockquote{border-left:4px solid #1976d2;padding:6px 14px;margin:10px 0;color:#444;background:#f5f5f5}",
  ".diff-md hr{border:none;border-top:2px solid #e0e0e0;margin:16px 0}",
  ".diff-md strong{font-weight:700;color:#1a1a1a}",
  ".diff-md a{color:#1976d2;text-decoration:underline}",
].join(" ");

const tabBtn: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 4, border: "none",
  fontSize: 12, cursor: "pointer",
};

// 모달 내부 전용 버튼 (라이트 모드 강제)
const modalBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 5,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#1a1a1a",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const input: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, outline: "none",
};

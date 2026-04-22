"use client";

/**
 * DdlBulkImportDialog — DDL 일괄 등록 모달
 *
 * 역할:
 *   - 사용자가 여러 CREATE TABLE 이 포함된 DDL 스크립트를 붙여넣으면
 *   - 공용 파서(`@/lib/ddlParser`)로 파싱 → 미리보기 표시
 *   - 사용자가 테이블/컬럼 논리명을 인라인 편집 가능
 *   - 중복 물리명은 자동 체크 해제 + 경고 배지
 *   - 선택한 건만 `/api/projects/[id]/db-tables/bulk` 로 일괄 등록
 *
 * 설계 원칙:
 *   - 파싱 100% 정확은 불가 — 미리보기에서 사용자가 확인·수정하는 동선이 기본
 *   - 덮어쓰기 미지원 (1차 범위) — 중복은 skip, 사용자는 기존 테이블 삭제 후 재시도
 *   - 부분 성공 허용 — 서버가 created/skipped/failed 를 나눠 응답
 *
 * Props:
 *   - projectId, onClose, onCompleted
 *     onCompleted 는 1건 이상 등록 성공 시 호출 (상위가 목록 invalidate 용으로 사용)
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { parseDdlScript, type ParsedTable, type ParsedCol } from "@/lib/ddlParser";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId:       string;
  existingPhysNms: string[];  // 목록에서 이미 존재하는 물리명 — 중복 경고용 (소문자 비교)
  onClose:         () => void;
  onCompleted?:    () => void;
};

// 미리보기에서 사용자 편집이 반영된 상태 — 파싱 결과 + 체크 + 수정된 논리명
type Draft = {
  tblPhysclNm: string;
  tblLgclNm:   string;      // 편집 가능
  columns:     DraftCol[];
  rawBlock:    string;
  errors:      string[];
  checked:     boolean;
  expanded:    boolean;     // 컬럼 목록 펼침 여부
  duplicate:   boolean;     // 기존 테이블과 물리명 중복
};

type DraftCol = ParsedCol;  // 같은 shape. 논리명/타입 모두 편집 가능

type BulkResponse = {
  created: { tblPhysclNm: string; tblId: string }[];
  skipped: { tblPhysclNm: string; reason: string }[];
  failed:  { tblPhysclNm: string; reason: string }[];
};

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function DdlBulkImportDialog({ projectId, existingPhysNms, onClose, onCompleted }: Props) {
  // 사용자 입력 원문
  const [ddlText, setDdlText] = useState("");

  // 파싱 결과 (사용자 편집 포함)
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  // 등록 결과 표시용 — null 이면 미표시
  const [result, setResult] = useState<BulkResponse | null>(null);

  // 기존 물리명 Set (lower) — 성능용
  const existingSet = useMemo(
    () => new Set(existingPhysNms.map((n) => n.toLowerCase())),
    [existingPhysNms],
  );

  // ── 파싱 처리 ──────────────────────────────────────────────────────────────
  function handleParse() {
    if (!ddlText.trim()) {
      toast.error("DDL 을 입력해 주세요.");
      return;
    }
    const parsed = parseDdlScript(ddlText);
    if (parsed.length === 0) {
      toast.error("CREATE TABLE 문을 찾지 못했습니다. 구문을 확인해 주세요.");
      return;
    }

    // 기존과 중복되는 테이블은 자동 체크 해제
    const next: Draft[] = parsed.map((t) => {
      const duplicate = existingSet.has(t.tblPhysclNm.toLowerCase());
      return {
        tblPhysclNm: t.tblPhysclNm,
        tblLgclNm:   t.tblLgclNm,
        columns:     t.columns.map((c) => ({ ...c })),
        rawBlock:    t.rawBlock,
        errors:      t.errors,
        checked:     !duplicate,
        expanded:    false,
        duplicate,
      };
    });
    setDrafts(next);
    setResult(null);
  }

  function resetAll() {
    setDrafts(null);
    setResult(null);
    setDdlText("");
  }

  // ── 편집 헬퍼 ─────────────────────────────────────────────────────────────
  function patchDraft(idx: number, patch: Partial<Draft>) {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  }
  function patchCol(tIdx: number, cIdx: number, patch: Partial<DraftCol>) {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      const t = { ...next[tIdx]! };
      t.columns = t.columns.slice();
      t.columns[cIdx] = { ...t.columns[cIdx]!, ...patch };
      next[tIdx] = t;
      return next;
    });
  }

  // ── 통계 ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!drafts) return { total: 0, selected: 0, duplicate: 0, withError: 0 };
    return {
      total:     drafts.length,
      selected:  drafts.filter((d) => d.checked).length,
      duplicate: drafts.filter((d) => d.duplicate).length,
      withError: drafts.filter((d) => d.errors.length > 0).length,
    };
  }, [drafts]);

  // ── 등록 뮤테이션 ─────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: (tables: Draft[]) =>
      authFetch<{ data: BulkResponse }>(`/api/projects/${projectId}/db-tables/bulk`, {
        method: "POST",
        body: JSON.stringify({
          tables: tables.map((t) => ({
            tblPhysclNm: t.tblPhysclNm,
            tblLgclNm:   t.tblLgclNm,
            columns: t.columns.map((c) => ({
              colPhysclNm: c.colPhysclNm,
              colLgclNm:   c.colLgclNm,
              dataTyNm:    c.dataTyNm,
              colDc:       c.colDc,
            })),
          })),
        }),
      }),
    onSuccess: (res) => {
      const r = res.data;
      setResult(r);
      if (r.created.length > 0) {
        toast.success(`${r.created.length}건 등록 완료`);
        onCompleted?.();
      }
      if (r.failed.length > 0) {
        toast.error(`${r.failed.length}건 실패`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!drafts) return;
    const selected = drafts.filter((d) => d.checked);
    if (selected.length === 0) {
      toast.error("등록할 테이블을 선택해 주세요.");
      return;
    }
    // 선택된 항목 중 물리명 빈 것은 차단 (UX: 명시적 알림)
    const emptyPhys = selected.find((d) => !d.tblPhysclNm.trim());
    if (emptyPhys) {
      toast.error("물리 테이블명이 비어있는 항목이 있습니다.");
      return;
    }
    submitMutation.mutate(selected);
  }

  // ── 렌더링 ────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:    "var(--color-bg-card)",
          border:        "1px solid var(--color-border)",
          borderRadius:  10,
          boxShadow:     "0 12px 40px rgba(0,0,0,0.25)",
          width:         "min(92vw, 1100px)",
          maxHeight:     "90vh",
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
        }}
      >
        {/* ── 헤더 ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)",
        }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>DDL 일괄 등록</div>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 20, cursor: "pointer",
            color: "#999", lineHeight: 1, padding: 0,
          }}>×</button>
        </div>

        {/* ── 본문 ── */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>

          {/* DDL 입력 영역 — 파싱 전/후 모두 표시 (파싱 후엔 축소 가능) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--color-text-secondary)" }}>
              CREATE TABLE 문 (여러 개 가능, 중간의 CREATE INDEX / ALTER / COMMENT ON 은 자동 스킵)
            </div>
            <textarea
              value={ddlText}
              onChange={(e) => setDdlText(e.target.value)}
              placeholder={[
                "-- 예시",
                "CREATE TABLE tb_member (  -- 회원",
                "  mber_id  VARCHAR(36) NOT NULL,  -- 회원 ID",
                "  mber_nm  VARCHAR(100) NOT NULL, /* 회원명 */",
                "  PRIMARY KEY (mber_id)",
                ");",
                "COMMENT ON TABLE tb_member IS '회원';",
                "COMMENT ON COLUMN tb_member.mber_nm IS '회원명';",
              ].join("\n")}
              rows={drafts ? 6 : 12}
              style={{
                width:        "100%",
                boxSizing:    "border-box",
                padding:      "10px 12px",
                borderRadius: 6,
                border:       "1px solid var(--color-border)",
                background:   "var(--color-bg-muted)",
                fontFamily:   "'Consolas', 'Monaco', monospace",
                fontSize:     12,
                lineHeight:   1.6,
                outline:      "none",
                resize:       "vertical",
              }}
            />
          </div>

          {/* 파싱/리셋 버튼 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={handleParse} disabled={!ddlText.trim()} style={primaryBtnStyle}>
              {drafts ? "다시 파싱" : "파싱하기"}
            </button>
            {drafts && (
              <button onClick={resetAll} style={secondaryBtnStyle}>
                초기화
              </button>
            )}
          </div>

          {/* 파싱 결과 요약 */}
          {drafts && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "10px 14px", marginBottom: 12,
              background: "var(--color-bg-muted)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12, color: "var(--color-text-secondary)",
            }}>
              <span>파싱 결과 <strong style={{ color: "var(--color-text-primary)" }}>{stats.total}</strong>건</span>
              <span style={{ width: 1, height: 12, background: "var(--color-border)" }} />
              <span>등록 대상 <strong style={{ color: "#1565c0" }}>{stats.selected}</strong>건</span>
              {stats.duplicate > 0 && (
                <>
                  <span style={{ width: 1, height: 12, background: "var(--color-border)" }} />
                  <span>중복 <strong style={{ color: "#e65100" }}>{stats.duplicate}</strong>건 (자동 제외)</span>
                </>
              )}
              {stats.withError > 0 && (
                <>
                  <span style={{ width: 1, height: 12, background: "var(--color-border)" }} />
                  <span>⚠ 경고 <strong style={{ color: "#c62828" }}>{stats.withError}</strong>건</span>
                </>
              )}
            </div>
          )}

          {/* 미리보기 테이블 */}
          {drafts && drafts.length > 0 && (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
              {/* 헤더 행 */}
              <div style={previewHeaderStyle}>
                <span style={{ width: 28 }} />
                <span>물리 테이블명</span>
                <span>논리 테이블명 (편집 가능)</span>
                <span style={{ textAlign: "center" }}>컬럼 수</span>
                <span style={{ textAlign: "center" }}>상태</span>
                <span style={{ width: 28 }} />
              </div>

              {/* 각 테이블 행 + 컬럼 펼침 */}
              {drafts.map((d, tIdx) => (
                <TableRow
                  key={`${d.tblPhysclNm}-${tIdx}`}
                  draft={d}
                  onToggleCheck={() => patchDraft(tIdx, { checked: !d.checked })}
                  onToggleExpand={() => patchDraft(tIdx, { expanded: !d.expanded })}
                  onChangeLgclNm={(v) => patchDraft(tIdx, { tblLgclNm: v })}
                  onChangeCol={(cIdx, patch) => patchCol(tIdx, cIdx, patch)}
                />
              ))}
            </div>
          )}

          {/* 등록 결과 */}
          {result && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg-muted)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>등록 결과</div>
              <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                <span style={{ color: "#2e7d32" }}>✅ 성공 {result.created.length}</span>
                <span style={{ color: "#e65100" }}>⏭ 건너뜀 {result.skipped.length}</span>
                <span style={{ color: "#c62828" }}>❌ 실패 {result.failed.length}</span>
              </div>
              {result.skipped.length > 0 && (
                <div style={resultBlockStyle}>
                  <div style={{ color: "#e65100", fontWeight: 600 }}>건너뜀</div>
                  {result.skipped.map((s) => (
                    <div key={s.tblPhysclNm}>• {s.tblPhysclNm} — {s.reason}</div>
                  ))}
                </div>
              )}
              {result.failed.length > 0 && (
                <div style={resultBlockStyle}>
                  <div style={{ color: "#c62828", fontWeight: 600 }}>실패</div>
                  {result.failed.map((f) => (
                    <div key={f.tblPhysclNm}>• {f.tblPhysclNm} — {f.reason}</div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── 푸터 ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderTop: "1px solid var(--color-border)",
          background: "var(--color-bg-card)",
        }}>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            ※ 이미 등록된 테이블은 건너뜁니다 (덮어쓰기 미지원).
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={secondaryBtnStyle}>닫기</button>
            <button
              onClick={handleSubmit}
              disabled={!drafts || stats.selected === 0 || submitMutation.isPending}
              style={{
                ...primaryBtnStyle,
                opacity: (!drafts || stats.selected === 0 || submitMutation.isPending) ? 0.4 : 1,
                cursor:  (!drafts || stats.selected === 0 || submitMutation.isPending) ? "not-allowed" : "pointer",
              }}
            >
              {submitMutation.isPending ? "등록 중..." : `${stats.selected}건 등록`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: 테이블 행 + 펼침 시 컬럼 편집표 ───────────────────────────

function TableRow({
  draft, onToggleCheck, onToggleExpand, onChangeLgclNm, onChangeCol,
}: {
  draft:          Draft;
  onToggleCheck:  () => void;
  onToggleExpand: () => void;
  onChangeLgclNm: (v: string) => void;
  onChangeCol:    (cIdx: number, patch: Partial<DraftCol>) => void;
}) {
  const hasError = draft.errors.length > 0;

  return (
    <>
      <div style={{
        ...previewRowStyle,
        background: draft.duplicate ? "rgba(230,81,0,0.05)" : (draft.checked ? "var(--color-bg-card)" : "var(--color-bg-muted)"),
        opacity: draft.duplicate ? 0.7 : 1,
      }}>
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={onToggleCheck}
          disabled={draft.duplicate}
          style={{ width: 14, height: 14, cursor: draft.duplicate ? "not-allowed" : "pointer" }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary, #1976d2)", fontFamily: "monospace" }}>
          {draft.tblPhysclNm}
        </span>
        <input
          value={draft.tblLgclNm}
          onChange={(e) => onChangeLgclNm(e.target.value)}
          placeholder="논리명 입력..."
          disabled={!draft.checked}
          style={{
            padding: "4px 8px", borderRadius: 4,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-card)",
            fontSize: 12, outline: "none", width: "100%",
            boxSizing: "border-box",
            opacity: draft.checked ? 1 : 0.6,
          }}
        />
        <span style={{ textAlign: "center", fontSize: 12, fontWeight: 600 }}>
          {draft.columns.length}
        </span>
        <span style={{ textAlign: "center", fontSize: 11 }}>
          {draft.duplicate ? (
            <span style={badgeStyle("#e65100", "rgba(230,81,0,0.12)")}>이미 존재</span>
          ) : hasError ? (
            <span style={badgeStyle("#c62828", "rgba(198,40,40,0.12)")} title={draft.errors.join("\n")}>
              ⚠ 경고
            </span>
          ) : (
            <span style={badgeStyle("#1565c0", "rgba(21,101,192,0.12)")}>신규</span>
          )}
        </span>
        <button
          type="button"
          onClick={onToggleExpand}
          title="컬럼 보기/숨기기"
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 14, color: "var(--color-text-secondary)", padding: 0,
          }}
        >
          {draft.expanded ? "▼" : "▶"}
        </button>
      </div>

      {/* 펼침: 컬럼 편집표 */}
      {draft.expanded && (
        <div style={{
          padding: "10px 14px 14px",
          background: "var(--color-bg-muted)",
          borderTop: "1px dashed var(--color-border)",
          borderBottom: "1px dashed var(--color-border)",
        }}>
          {draft.columns.length === 0 ? (
            <div style={{ fontSize: 12, color: "#999", padding: "8px 0" }}>파싱된 컬럼이 없습니다.</div>
          ) : (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={colHeaderStyle}>
                <span>물리 컬럼명</span>
                <span>논리명 (편집 가능)</span>
                <span>데이터 타입 (편집 가능)</span>
              </div>
              {draft.columns.map((c, cIdx) => (
                <div key={`${c.colPhysclNm}-${cIdx}`} style={colRowStyle}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {c.colPhysclNm}
                  </span>
                  <input
                    value={c.colLgclNm}
                    onChange={(e) => onChangeCol(cIdx, { colLgclNm: e.target.value })}
                    placeholder="논리명"
                    style={colInputStyle}
                  />
                  <input
                    value={c.dataTyNm}
                    onChange={(e) => onChangeCol(cIdx, { dataTyNm: e.target.value })}
                    placeholder="VARCHAR(100)"
                    style={{ ...colInputStyle, fontFamily: "monospace" }}
                  />
                </div>
              ))}
            </div>
          )}
          {hasError && (
            <div style={{ marginTop: 10, padding: "8px 10px", fontSize: 11, color: "#c62828", background: "rgba(198,40,40,0.06)", borderRadius: 4, border: "1px solid rgba(198,40,40,0.2)" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>파싱 경고</div>
              {draft.errors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

const PREVIEW_GRID = "28px minmax(160px, 220px) 1fr 60px 80px 28px";

const previewHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: PREVIEW_GRID,
  gap: 10,
  alignItems: "center",
  padding: "8px 14px",
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 11, fontWeight: 700,
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const previewRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: PREVIEW_GRID,
  gap: 10,
  alignItems: "center",
  padding: "9px 14px",
  borderTop: "1px solid var(--color-border)",
};

const COL_GRID = "minmax(140px, 180px) 1fr 200px";

const colHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: COL_GRID,
  gap: 8,
  padding: "6px 10px",
  background: "var(--color-bg-card)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 10, fontWeight: 700,
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const colRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: COL_GRID,
  gap: 8,
  alignItems: "center",
  padding: "5px 10px",
  borderTop: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
};

const colInputStyle: React.CSSProperties = {
  padding: "3px 7px", borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-muted)",
  fontSize: 11, outline: "none", width: "100%",
  boxSizing: "border-box",
};

const resultBlockStyle: React.CSSProperties = {
  marginTop: 8, padding: "6px 10px", background: "var(--color-bg-card)",
  borderRadius: 4, fontSize: 11, lineHeight: 1.7,
  border: "1px solid var(--color-border)",
};

function badgeStyle(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 700, padding: "2px 8px",
    borderRadius: 10, background: bg, color,
  };
}

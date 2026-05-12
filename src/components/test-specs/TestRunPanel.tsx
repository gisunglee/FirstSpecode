"use client";

/**
 * TestRunPanel — 테스트 실행 모드 (회차 + 결과 입력)
 *
 * 구성:
 *   - 회차 선택 드롭다운 + [+ 새 회차 시작] 버튼
 *   - 회차 메타: 환경·빌드·테스터 + [회차 종료] 버튼
 *   - 케이스별 결과 표: No · 시나리오 · 결과(PASS/FAIL/BLOCKED/NA) · 비고 · 결함
 *
 * 결과·결함 입력은 메모리에서 모았다가 [저장] 시 일괄 PUT.
 * 회차 종료(DONE) 시 명세서 상태 자동 전이 — 서버 트랜잭션에서 처리.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { SelectChevron } from "@/components/ui/SelectChevron";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RoundSummary = {
  roundId:     string;
  roundNo:     number;
  envirCode:   string;
  bldVrsnNm:   string | null;
  bgngDt:      string | null;
  endDt:       string | null;
  sttusCode:   string;
  totalCount:  number;
  summary:     Record<string, number>;
};

type ResultRow = {
  resultId:     string;
  testCaseId:   string;
  caseNo:       number;
  ctgryCode:    string;
  scenarioCn:   string;
  expectedCn:   string;
  applicableYn: string;
  resultCode:   "PASS" | "FAIL" | "BLOCKED" | "NA";
  remarkCn:     string | null;
  testDt:       string | null;
  defects:      { defectId?: string; defectCn: string }[];
};

type RoundDetail = {
  roundId:      string;
  roundNo:      number;
  envirCode:    string;
  bldVrsnNm:    string | null;
  bgngDt:       string | null;
  endDt:        string | null;
  sttusCode:    string;
  results:      ResultRow[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const RESULT_LABEL: Record<string, string> = {
  PASS:    "합격",
  FAIL:    "불합격",
  BLOCKED: "차단됨",
  NA:      "해당없음",
};
const RESULT_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  PASS:    { bg: "#e8f5e9", fg: "#2e7d32", border: "#a5d6a7" },
  FAIL:    { bg: "#ffebee", fg: "#c62828", border: "#ef9a9a" },
  BLOCKED: { bg: "#fff3e0", fg: "#e65100", border: "#ffcc80" },
  NA:      { bg: "#f5f5f5", fg: "#616161", border: "#e0e0e0" },
};

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function TestRunPanel({
  projectId, specId, members,
}: {
  projectId: string;
  specId:    string;
  members:   { memberId: string; name: string | null; email: string }[];
}) {
  const queryClient = useQueryClient();
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  // ── 회차 목록 조회 ─────────────────────────────────────────────────────────
  const { data: rounds = [], isLoading: roundsLoading } = useQuery<RoundSummary[]>({
    queryKey: ["test-rounds", projectId, specId],
    queryFn:  async () => {
      const res = await authFetch<{ data: { items: RoundSummary[] } }>(
        `/api/projects/${projectId}/test-specs/${specId}/rounds`
      );
      return res.data.items;
    },
  });

  // 선택된 회차가 없으면 가장 최근 회차 자동 선택
  useEffect(() => {
    if (selectedRoundId) return;
    if (rounds.length > 0) setSelectedRoundId(rounds[rounds.length - 1].roundId);
  }, [rounds, selectedRoundId]);

  // ── 선택된 회차 상세 (결과 포함) ──────────────────────────────────────────
  const { data: roundDetail, isLoading: detailLoading } = useQuery<RoundDetail>({
    queryKey: ["test-round-detail", projectId, specId, selectedRoundId],
    queryFn:  async () => {
      const res = await authFetch<{ data: RoundDetail }>(
        `/api/projects/${projectId}/test-specs/${specId}/rounds/${selectedRoundId}`
      );
      return res.data;
    },
    enabled: !!selectedRoundId,
  });

  // ── 로컬 폼 상태 ───────────────────────────────────────────────────────────
  const [form, setForm] = useState<RoundDetail | null>(null);
  useEffect(() => { if (roundDetail) setForm(roundDetail); }, [roundDetail]);

  // ── 새 회차 생성 ──────────────────────────────────────────────────────────
  // 환경은 빈 값으로 시작 — 사용자가 명시적으로 선택해야 [+ 회차 시작] 활성화.
  // (자동 DEV 기본값을 두면 "운영에서만 테스트할 건데 모르고 DEV 회차가 생성"되는 사고 가능)
  const [newEnvCode, setNewEnvCode]   = useState<"" | "DEV" | "STG" | "PROD">("");
  const [newBldVrsn, setNewBldVrsn]   = useState("");
  const [newTester,  setNewTester]    = useState("");

  const createRoundMutation = useMutation({
    mutationFn: () => {
      if (!newEnvCode) throw new Error("테스트 환경을 선택해 주세요.");
      return authFetch<{ data: { roundId: string } }>(
        `/api/projects/${projectId}/test-specs/${specId}/rounds`,
        {
          method: "POST",
          body: JSON.stringify({
            envirCode:    newEnvCode,
            bldVrsnNm:    newBldVrsn,
            testMemberId: newTester || null,
          }),
        }
      );
    },
    onSuccess: (res) => {
      toast.success("새 회차를 시작했습니다.");
      setSelectedRoundId(res.data.roundId);
      // 입력 초기화 — 다음 회차도 의도적으로 선택하도록
      setNewEnvCode("");
      setNewBldVrsn("");
      queryClient.invalidateQueries({ queryKey: ["test-rounds", projectId, specId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 회차 메타 + 결과 저장 ────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (closeRound: boolean) => {
      if (!form) throw new Error("회차 데이터가 없습니다.");
      return authFetch(
        `/api/projects/${projectId}/test-specs/${specId}/rounds/${form.roundId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            envirCode:    form.envirCode,
            bldVrsnNm:    form.bldVrsnNm,
            testMemberId: newTester || null,   // 회차 테스터 — 한 회차 1명
            sttusCode:    closeRound ? "DONE" : "IN_PROGRESS",
            results: form.results.map((r) => ({
              resultId:   r.resultId,
              resultCode: r.resultCode,
              remarkCn:   r.remarkCn,
              defects:    r.defects.filter((d) => d.defectCn.trim()),
            })),
          }),
        }
      );
    },
    onSuccess: (_, closeRound) => {
      toast.success(closeRound ? "회차를 종료했습니다." : "저장했습니다.");
      queryClient.invalidateQueries({ queryKey: ["test-round-detail", projectId, specId, selectedRoundId] });
      queryClient.invalidateQueries({ queryKey: ["test-rounds",       projectId, specId] });
      queryClient.invalidateQueries({ queryKey: ["test-spec",         projectId, specId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 결과 셀 편집 ───────────────────────────────────────────────────────────
  function updateResult(idx: number, patch: Partial<ResultRow>) {
    setForm((f) => f && {
      ...f,
      results: f.results.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  }
  // 결함은 행당 1개만. 텍스트 비우면 결함 row 없음, 입력 있으면 1개 row.
  // 여러 결함이 있어도 사용자가 "1. ... 2. ..." 형태로 한 본문에 정리.
  function setSingleDefect(idx: number, cn: string) {
    setForm((f) => f && {
      ...f,
      results: f.results.map((r, i) => {
        if (i !== idx) return r;
        if (!cn.trim()) return { ...r, defects: [] };
        // 기존 defectId 보존 (서버 PUT 시 결함 row 갱신 위해) — 첫 결함만 유지
        const existing = r.defects[0];
        return { ...r, defects: [{ defectId: existing?.defectId, defectCn: cn }] };
      }),
    });
  }

  // ── 요약 카운트 ───────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!form) return { PASS: 0, FAIL: 0, BLOCKED: 0, NA: 0 };
    const s = { PASS: 0, FAIL: 0, BLOCKED: 0, NA: 0 };
    for (const r of form.results) s[r.resultCode]++;
    return s;
  }, [form]);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 회차 선택 + 새 회차 시작 카드 */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>회차</span>

          <div className="sp-select-wrap" style={{ width: 220 }}>
            <select
              value={selectedRoundId ?? ""}
              onChange={(e) => setSelectedRoundId(e.target.value || null)}
              className="sp-input"
              style={{ fontSize: 13 }}
            >
              {roundsLoading ? (
                <option value="">로딩 중...</option>
              ) : rounds.length === 0 ? (
                <option value="">아직 회차가 없습니다</option>
              ) : (
                rounds.map((r) => (
                  <option key={r.roundId} value={r.roundId}>
                    {r.roundNo}차 · {r.envirCode}{r.bldVrsnNm ? ` · ${r.bldVrsnNm}` : ""} · {r.sttusCode === "DONE" ? "종료" : "진행중"}
                  </option>
                ))
              )}
            </select>
            <span className="sp-select-arrow"><SelectChevron /></span>
          </div>

          <span style={{ flex: 1 }} />
        </div>

        {/* 새 회차 시작 — 간단한 인라인 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px", borderRadius: 6,
          background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginRight: 4 }}>새 회차 시작</span>
          <div className="sp-select-wrap" style={{ width: 120 }}>
            <select
              value={newEnvCode}
              onChange={(e) => setNewEnvCode(e.target.value as "" | "DEV" | "STG" | "PROD")}
              className="sp-input"
              style={{ fontSize: 12 }}
            >
              <option value="">환경 선택…</option>
              <option value="DEV">DEV (개발)</option>
              <option value="STG">STG (스테이징)</option>
              <option value="PROD">PROD (운영)</option>
            </select>
            <span className="sp-select-arrow"><SelectChevron /></span>
          </div>
          <input
            type="text"
            value={newBldVrsn}
            onChange={(e) => setNewBldVrsn(e.target.value)}
            placeholder="빌드 (예: v1.2.0)"
            className="sp-input"
            style={{ width: 160, fontSize: 12 }}
          />
          <div className="sp-select-wrap" style={{ width: 160 }}>
            <select value={newTester} onChange={(e) => setNewTester(e.target.value)} className="sp-input" style={{ fontSize: 12 }}>
              <option value="">테스터 선택</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>{m.name ?? m.email}</option>
              ))}
            </select>
            <span className="sp-select-arrow"><SelectChevron /></span>
          </div>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => createRoundMutation.mutate()}
            disabled={createRoundMutation.isPending || !newEnvCode}
            style={{
              ...primaryBtnStyle,
              opacity: (createRoundMutation.isPending || !newEnvCode) ? 0.5 : 1,
              cursor:  (!newEnvCode) ? "not-allowed" : "pointer",
            }}
            title={!newEnvCode ? "환경을 먼저 선택하세요" : undefined}
          >+ 회차 시작</button>
        </div>
      </div>

      {/* 결과 입력 */}
      {!form ? (
        <div style={{ ...cardStyle, padding: 40, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
          {detailLoading ? "로딩 중..." : "위에서 회차를 선택하거나 새로 시작하세요."}
        </div>
      ) : (
        <>
          {/* 결과 요약 + 회차 종료 */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {form.roundNo}차 결과 요약
              </span>
              {(["PASS", "FAIL", "BLOCKED", "NA"] as const).map((code) => (
                <span key={code} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 10,
                  background: RESULT_COLOR[code].bg,
                  color:      RESULT_COLOR[code].fg,
                  border:     `1px solid ${RESULT_COLOR[code].border}`,
                  fontSize: 11, fontWeight: 700,
                }}>
                  {RESULT_LABEL[code]} {summary[code]}
                </span>
              ))}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => saveMutation.mutate(false)}
                disabled={saveMutation.isPending || form.sttusCode === "DONE"}
                style={secondaryBtnStyle}
              >저장</button>
              <button
                onClick={() => {
                  if (form.sttusCode === "DONE") return;
                  if (confirm("회차를 종료합니다. 종료된 회차의 결과는 더 이상 수정할 수 없습니다. 진행할까요?")) {
                    saveMutation.mutate(true);
                  }
                }}
                disabled={saveMutation.isPending || form.sttusCode === "DONE"}
                style={form.sttusCode === "DONE" ? { ...secondaryBtnStyle, opacity: 0.5 } : primaryBtnStyle}
              >
                {form.sttusCode === "DONE" ? "회차 종료됨" : "회차 종료"}
              </button>
            </div>
          </div>

          {/* 결과 행들 — 좌:내용 / 우:결과 셀렉트 정렬, 행은 기본 한 줄 컴팩트.
              FAIL/BLOCKED 시에만 비고·결함 입력란이 자동 노출. */}
          <div style={cardStyle}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {form.results.map((r, idx) => {
                const c = RESULT_COLOR[r.resultCode];
                const inactive       = r.applicableYn === "N";
                const isFailOrBlock  = r.resultCode === "FAIL" || r.resultCode === "BLOCKED";
                const showRemarkArea = !inactive && r.resultCode !== "NA";
                return (
                  <div
                    key={r.resultId}
                    style={{
                      display: "grid",
                      // 좌측 컨텐츠는 가변, 우측 결과 셀렉트는 140px 고정 — 세로 정렬 일관
                      gridTemplateColumns: "1fr 140px",
                      gap: 12,
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--color-border)",
                      background: inactive ? "var(--color-bg-muted)" : "var(--color-bg-card)",
                      opacity:    inactive ? 0.55 : 1,
                      alignItems: "start",
                    }}
                  >
                    {/* 좌: 시나리오 + 예상결과 (한 줄) + (확장 시) 비고/결함 */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", minWidth: 50 }}>
                          {r.ctgryCode === "CHECKLIST" ? "점검" : "기능"} {r.caseNo}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.scenarioCn}
                          {r.expectedCn && (
                            <span style={{ color: "var(--color-text-secondary)", marginLeft: 8 }}>
                              → {r.expectedCn}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* 비고 — NA/해당없음 외에는 입력 가능. 작게 시작, 입력 시 자유 확장. */}
                      {showRemarkArea && (
                        <textarea
                          value={r.remarkCn ?? ""}
                          onChange={(e) => updateResult(idx, { remarkCn: e.target.value })}
                          placeholder="비고 (선택)"
                          rows={1}
                          className="sp-input"
                          style={{ fontSize: 11, padding: "3px 6px", marginTop: 4, resize: "vertical", width: "100%" }}
                        />
                      )}

                      {/* 결함 — FAIL/BLOCKED 일 때만 자동 노출. 1개 textarea. */}
                      {isFailOrBlock && (
                        <textarea
                          value={r.defects[0]?.defectCn ?? ""}
                          onChange={(e) => setSingleDefect(idx, e.target.value)}
                          placeholder="결함 내용 (여러 건이면 1. ... 2. ... 형태로)"
                          rows={2}
                          className="sp-input"
                          style={{
                            fontSize: 11, padding: "4px 6px", marginTop: 4,
                            resize: "vertical", width: "100%",
                            borderColor: "#ef9a9a", background: "#fff8f8",
                          }}
                        />
                      )}
                    </div>

                    {/* 우: 결과 셀렉트 (정렬된 고정 폭으로 한눈에 쪼롤이 보임) */}
                    <select
                      value={r.resultCode}
                      disabled={inactive || form.sttusCode === "DONE"}
                      onChange={(e) => updateResult(idx, { resultCode: e.target.value as ResultRow["resultCode"] })}
                      style={{
                        padding: "6px 8px", borderRadius: 6,
                        border: `1.5px solid ${c.border}`,
                        background: c.bg, color: c.fg,
                        fontSize: 12, fontWeight: 700,
                        cursor: inactive ? "not-allowed" : "pointer",
                        alignSelf: "start",
                      }}
                    >
                      {(["NA", "PASS", "FAIL", "BLOCKED"] as const).map((code) => (
                        <option key={code} value={code}>{RESULT_LABEL[code]}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {form.results.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
                  케이스가 없습니다. 명세 작성 탭에서 케이스를 먼저 등록하세요.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "12px 16px",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
};

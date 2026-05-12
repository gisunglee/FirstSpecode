"use client";

/**
 * TestRunPanel — 결과 작성 모드 (회차 + 결과 입력)
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
  roundId: string;
  roundNo: number;
  envirCode: string;
  bldVrsnNm: string | null;
  bgngDt: string | null;
  endDt: string | null;
  sttusCode: string;
  totalCount: number;
  summary: Record<string, number>;
};

// 결과 코드 — UI 에서는 PASS/FAIL/NA 3개만 선택. 기존 DB 의 BLOCKED 값은 표시는 되지만 변경 불가.
type ResultCode = "PASS" | "FAIL" | "NA" | "BLOCKED";

type ResultRow = {
  resultId: string;
  testCaseId: string;
  caseNo: number;
  ctgryCode: string;
  scenarioCn: string;
  expectedCn: string;
  applicableYn: string;
  resultCode: ResultCode;
  remarkCn: string | null;
  testDt: string | null;
  defects: { defectId?: string; defectCn: string }[];
};

type RoundDetail = {
  roundId: string;
  roundNo: number;
  envirCode: string;
  bldVrsnNm: string | null;
  bgngDt: string | null;
  endDt: string | null;
  sttusCode: string;
  results: ResultRow[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

// UI 에 노출되는 3개 옵션 — 사용자가 클릭 선택 가능
const RESULT_OPTIONS = ["PASS", "FAIL", "NA"] as const;

const RESULT_LABEL: Record<string, string> = {
  PASS: "합격",
  FAIL: "불합격",
  NA: "해당없음",
  BLOCKED: "차단됨",  // legacy — 기존 데이터 표시용
};

// 차분한 톤 — Tailwind palette 계열 (channel 낮춤). 활성 시 텍스트 색만 강조.
const RESULT_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  PASS: { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" },
  FAIL: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
  NA: { bg: "#fafafa", fg: "#52525b", border: "#e4e4e7" },
  BLOCKED: { bg: "#fafafa", fg: "#52525b", border: "#e4e4e7" },
};

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function TestRunPanel({
  projectId, specId, members,
}: {
  projectId: string;
  specId: string;
  members: { memberId: string; name: string | null; email: string }[];
}) {
  const queryClient = useQueryClient();
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  // ── 회차 목록 조회 ─────────────────────────────────────────────────────────
  const { data: rounds = [], isLoading: roundsLoading } = useQuery<RoundSummary[]>({
    queryKey: ["test-rounds", projectId, specId],
    queryFn: async () => {
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
    queryFn: async () => {
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
  const [newEnvCode, setNewEnvCode] = useState<"" | "DEV" | "STG" | "PROD">("");
  const [newBldVrsn, setNewBldVrsn] = useState("");
  const [newTester, setNewTester] = useState("");

  const createRoundMutation = useMutation({
    mutationFn: () => {
      if (!newEnvCode) throw new Error("테스트 환경을 선택해 주세요.");
      return authFetch<{ data: { roundId: string } }>(
        `/api/projects/${projectId}/test-specs/${specId}/rounds`,
        {
          method: "POST",
          body: JSON.stringify({
            envirCode: newEnvCode,
            bldVrsnNm: newBldVrsn,
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
            envirCode: form.envirCode,
            bldVrsnNm: form.bldVrsnNm,
            testMemberId: newTester || null,   // 회차 테스터 — 한 회차 1명
            sttusCode: closeRound ? "DONE" : "IN_PROGRESS",
            results: form.results.map((r) => ({
              resultId: r.resultId,
              resultCode: r.resultCode,
              remarkCn: r.remarkCn,
              defects: r.defects.filter((d) => d.defectCn.trim()),
            })),
          }),
        }
      );
    },
    onSuccess: (_, closeRound) => {
      toast.success(closeRound ? "회차를 종료했습니다." : "저장했습니다.");
      queryClient.invalidateQueries({ queryKey: ["test-round-detail", projectId, specId, selectedRoundId] });
      queryClient.invalidateQueries({ queryKey: ["test-rounds", projectId, specId] });
      queryClient.invalidateQueries({ queryKey: ["test-spec", projectId, specId] });
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
  // legacy BLOCKED 데이터가 있어도 NA 로 합산 (UI 옵션에서 제거된 상태)
  const summary = useMemo(() => {
    if (!form) return { PASS: 0, FAIL: 0, NA: 0 };
    const s = { PASS: 0, FAIL: 0, NA: 0 };
    for (const r of form.results) {
      if (r.resultCode === "PASS") s.PASS++;
      else if (r.resultCode === "FAIL") s.FAIL++;
      else s.NA++;   // NA + 잔존 BLOCKED 통합
    }
    return s;
  }, [form]);

  // ── 새 회차 추가 폼 펼침 상태 (조회 영역과 시각 분리) ──────────────────────
  const [addFormOpen, setAddFormOpen] = useState(false);

  // ── PASS 행의 비고 펼침 상태 — Set 으로 행 단위 토글 (여러 행 동시 펼침 가능)
  // 비고 입력값이 있으면 자동 펼침 (입력 데이터 보존)
  const [remarkOpenSet, setRemarkOpenSet] = useState<Set<string>>(new Set());
  function toggleRemark(resultId: string) {
    setRemarkOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── [조회 영역] 회차 선택 카드 ───────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>회차 선택</span>
          <div className="sp-select-wrap" style={{ width: 260 }}>
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
          <button
            onClick={() => setAddFormOpen((v) => !v)}
            style={addFormOpen ? secondaryBtnStyle : primaryBtnStyle}
          >
            {addFormOpen ? "닫기" : "+ 회차 추가"}
          </button>
        </div>
      </div>

      {/* ── [추가 영역] 새 회차 추가 카드 — 펼침 시에만 노출 (조회와 명확히 분리) ── */}
      {addFormOpen && (
        <div style={{
          ...cardStyle,
          borderColor: "var(--color-primary, #1976d2)",
          background: "rgba(103,80,164,0.04)",  // 살짝 다른 톤으로 추가 영역임을 명시
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--color-brand, #1976d2)",
            marginBottom: 8,
          }}>
            새 회차 추가
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
              onClick={() => createRoundMutation.mutate(undefined, {
                onSuccess: () => setAddFormOpen(false),  // 추가 성공 시 폼 자동 닫기
              })}
              disabled={createRoundMutation.isPending || !newEnvCode}
              style={{
                ...primaryBtnStyle,
                opacity: (createRoundMutation.isPending || !newEnvCode) ? 0.5 : 1,
                cursor: (!newEnvCode) ? "not-allowed" : "pointer",
              }}
              title={!newEnvCode ? "환경을 먼저 선택하세요" : undefined}
            >+ 회차 추가</button>
          </div>
        </div>
      )}

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
              {(["PASS", "FAIL", "NA"] as const).map((code) => (
                <span key={code} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 10,
                  background: RESULT_COLOR[code].bg,
                  color: RESULT_COLOR[code].fg,
                  border: `1px solid ${RESULT_COLOR[code].border}`,
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

          {/* 결과 — 카테고리별 그리드 표 (명세 작성과 일관된 패턴) */}
          {form.results.length === 0 ? (
            <div style={{ ...cardStyle, padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
              케이스가 없습니다. 명세 작성 탭에서 케이스를 먼저 등록하세요.
            </div>
          ) : (
            <>
              {(["CHECKLIST", "FUNCTIONAL"] as const).map((ctgry) => {
                const rows = form.results
                  .map((r, i) => ({ r, i }))
                  .filter((x) => x.r.ctgryCode === ctgry);
                if (rows.length === 0) return null;

                // 카테고리별 컬럼 비율
                //   CHECKLIST: 시나리오 길고 예상결과 짧음 → 7:3
                //   FUNCTIONAL: 시나리오·예상결과 균등에 가깝게 → 6:4
                const colTemplate = ctgry === "CHECKLIST"
                  ? "44px 7fr 3fr 230px"
                  : "44px 6fr 4fr 230px";

                return (
                  <div key={ctgry} style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "var(--color-bg-card)",
                  }}>
                    {/* 카테고리 제목 + 헤더 행 */}
                    <div style={{
                      padding: "10px 16px",
                      background: "var(--color-bg-muted)",
                      borderBottom: "1px solid var(--color-border)",
                      fontSize: 13, fontWeight: 700,
                      color: "var(--color-text-primary)",
                    }}>
                      {ctgry === "CHECKLIST" ? "공통 점검 (Checklist)" : "기능 시나리오 (Functional)"}
                      <span style={{ marginLeft: 6, color: "var(--color-text-tertiary)", fontSize: 12, fontWeight: 400 }}>
                        ({rows.length})
                      </span>
                    </div>
                    {/* 컬럼 비율 — 카테고리별 (colTemplate) */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: colTemplate,
                      gap: 12,
                      padding: "8px 16px",
                      background: "var(--color-bg-muted)",
                      borderBottom: "1px solid var(--color-border)",
                      fontSize: 13, fontWeight: 700,
                      color: "var(--color-text-secondary)",
                    }}>
                      <span>No</span>
                      <span>시나리오</span>
                      <span>예상 결과</span>
                      <span style={{ textAlign: "center" }}>결과</span>
                    </div>

                    {/* 결과 행들 */}
                    {rows.map(({ r, i: idx }, rowIdx) => {
                      const inactive = r.applicableYn === "N";
                      const isFail = r.resultCode === "FAIL";
                      const isPass = r.resultCode === "PASS";
                      const isLast = rowIdx === rows.length - 1;
                      const hasRemark = !!(r.remarkCn?.trim());
                      // PASS 펼침 조건: 입력값 있거나 사용자가 ✎ 클릭한 경우
                      const passOpen = isPass && !inactive && (hasRemark || remarkOpenSet.has(r.resultId));
                      // 펼침 영역 노출 여부 — FAIL 자동 / PASS 명시 토글
                      const showExpand = isFail || passOpen;

                      return (
                        <div
                          key={r.resultId}
                          style={{
                            borderBottom: isLast ? "none" : "1px solid var(--color-border)",
                            background: inactive ? "var(--color-bg-muted)" : "transparent",
                            opacity: inactive ? 0.55 : 1,
                          }}
                        >
                          {/* 메인 행 — 그리드 정렬 (헤더와 동일 colTemplate) */}
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: colTemplate,
                            gap: 12,
                            padding: "8px 16px",
                            alignItems: "start",
                          }}>
                            <span style={{ fontSize: 13, color: "var(--color-text-primary)", paddingTop: 6 }}>
                              {r.caseNo}
                            </span>
                            <span style={{
                              fontSize: 13, color: "var(--color-text-primary)",
                              paddingTop: 6,
                              wordBreak: "break-word",
                            }}>
                              {r.scenarioCn}
                            </span>
                            <span style={{
                              fontSize: 13, color: "var(--color-text-secondary)",
                              paddingTop: 6,
                              wordBreak: "break-word",
                            }}>
                              {r.expectedCn}
                            </span>
                            <div style={{ display: "flex", alignItems: "start", gap: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <ResultSegment
                                  value={r.resultCode}
                                  disabled={inactive || form.sttusCode === "DONE"}
                                  onChange={(code) => updateResult(idx, { resultCode: code })}
                                />
                              </div>
                              {/* 비고 토글 — PASS 일 때만 노출. 클릭 시 행 아래 펼침 영역 토글.
                                  빈 자리 차지(width 고정)로 다른 행 정렬 영향 X */}
                              <div style={{ width: 24, flexShrink: 0 }}>
                                {isPass && !inactive && (
                                  <button
                                    type="button"
                                    onClick={() => toggleRemark(r.resultId)}
                                    disabled={form.sttusCode === "DONE"}
                                    title={passOpen ? "비고 닫기" : "비고 추가"}
                                    style={{
                                      width: 24, height: 24,
                                      padding: 0, borderRadius: 4,
                                      border: `1px solid ${hasRemark || passOpen ? "rgba(103,80,164,0.4)" : "var(--color-border)"}`,
                                      background: hasRemark || passOpen ? "rgba(103,80,164,0.08)" : "transparent",
                                      color: hasRemark || passOpen ? "rgba(103,80,164,1)" : "var(--color-text-tertiary)",
                                      cursor: form.sttusCode === "DONE" ? "not-allowed" : "pointer",
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      fontSize: 13,
                                    }}
                                  >✎</button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 펼침 영역 — FAIL 자동 노출 / PASS 는 ✎ 토글 시 노출
                              두 경우 모두 [결함] + [비고] 6:4 — PASS 시 결함은 disabled(회색) */}
                          {showExpand && (
                            <div style={{ padding: "0 16px 10px 60px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "6fr 4fr", gap: 6 }}>
                                <textarea
                                  value={r.defects[0]?.defectCn ?? ""}
                                  onChange={(e) => setSingleDefect(idx, e.target.value)}
                                  placeholder={isPass ? "합격 케이스는 결함 입력이 불가합니다" : "결함 내용 (여러 건이면 1. ... 2. ... 형태로)"}
                                  rows={2}
                                  disabled={isPass}
                                  className="sp-input"
                                  style={{
                                    fontSize: 13, padding: "6px 8px",
                                    resize: "vertical", width: "100%",
                                  }}
                                />
                                <textarea
                                  value={r.remarkCn ?? ""}
                                  onChange={(e) => updateResult(idx, { remarkCn: e.target.value })}
                                  placeholder="비고 (선택)"
                                  rows={2}
                                  autoFocus={isPass && !hasRemark}
                                  className="sp-input"
                                  style={{ fontSize: 13, padding: "6px 8px", resize: "vertical", width: "100%" }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── 결과 세그먼트 컨트롤 — 합격 / 불합격 / 해당없음 ─────────────────────────
// 셀렉트 한 번 더 클릭하는 번거로움 제거 — 한 번 클릭에 선택.
// 활성 버튼만 색상 강조(차분한 톤), 나머지는 회색.
function ResultSegment({
  value, disabled, onChange,
}: {
  value: ResultCode;
  disabled: boolean;
  onChange: (code: ResultCode) => void;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      border: "1px solid var(--color-border)",
      borderRadius: 6,
      overflow: "hidden",
      alignSelf: "start",
      opacity: disabled ? 0.5 : 1,
    }}>
      {RESULT_OPTIONS.map((code, i) => {
        const active = value === code;
        const c = RESULT_COLOR[code];
        return (
          <button
            key={code}
            type="button"
            disabled={disabled}
            onClick={() => onChange(code)}
            style={{
              padding: "6px 4px",
              border: "none",
              borderLeft: i > 0 ? "1px solid var(--color-border)" : "none",
              background: active ? c.bg : "transparent",
              color: active ? c.fg : "var(--color-text-tertiary)",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {RESULT_LABEL[code]}
          </button>
        );
      })}
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

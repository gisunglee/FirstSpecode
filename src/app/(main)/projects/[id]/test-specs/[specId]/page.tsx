"use client";

/**
 * TestSpecDetailPage — 테스트 명세서 상세·편집
 *
 * 역할:
 *   - 신규: specId = "new" → POST (단위 OR 통합)
 *           쿼리스트링: ?kind=UNIT|INTEGRATION&unitWorkId=<UW_ID>
 *   - 수정: specId 존재 → GET 로드 → PUT (메타 + cases 일괄 저장)
 *   - 삭제: 헤더 [삭제] 버튼
 *
 * 케이스 정책:
 *   - 카테고리 2종: CHECKLIST(공통 점검) / FUNCTIONAL(기능 시나리오)
 *   - 행 추가/삭제/수정 모두 메모리에서 처리, [저장] 시 일괄 PUT
 *   - 기존 case_id 가 있으면 UPDATE, 없으면 INSERT, 누락된 기존 case 는 DELETE
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { SelectChevron } from "@/components/ui/SelectChevron";
import ImportCheckMasterDialog, { type CheckMasterItem } from "@/components/test-specs/ImportCheckMasterDialog";
import TestRunPanel from "@/components/test-specs/TestRunPanel";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkLink = {
  unitWorkId: string;
  displayId: string | null;
  name: string | null;
};

type TestCase = {
  testCaseId?: string;       // 신규 행은 없음
  caseNo: number;
  ctgryCode: "CHECKLIST" | "FUNCTIONAL";
  grpNm?: string | null;     // 구분(그룹명) — FUNCTIONAL 만 사용 (예: "회원", "승인", "관리")
  scenarioCn: string;
  expectedCn: string;
  preconditionCn?: string | null;
  testDataCn?: string | null;
  testAccountCn?: string | null;
  priortCode?: "HIGH" | "MEDIUM" | "LOW";
  applicableYn?: "Y" | "N";
  remarkCn?: string | null;
  aiGenYn: string;
  sortOrdr?: number;
};

type TestSpecDetail = {
  testSpecId: string;
  displayId: string;
  testKindCode: "UNIT" | "INTEGRATION";
  testSpecNm: string;
  testSpecDc: string | null;
  sttusCode: string;
  asignMemberId: string | null;
  prgrsRt: number;  // 진척률 0~100 (10단위로 입력)
  unitWorks: UnitWorkLink[];
  cases: TestCase[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  UNIT: "단위 테스트 명세서",
  INTEGRATION: "통합 테스트 명세서",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  IN_PROGRESS: "진행중",
  PASSED: "합격",
  FAILED: "불합격",
};
const STATUS_OPTIONS = ["DRAFT", "IN_PROGRESS", "PASSED", "FAILED"] as const;

// 진척률 선택지 — 0~100 을 10 단위로
const PROGRESS_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

// 우선순위(priortCode) 는 DB 데이터 보존을 위해 TestCase 타입엔 유지하지만
// UI 에선 컬럼·셀렉트 모두 제거 — 신규 케이스는 "MEDIUM" 기본값 (addCase 에서 설정).

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function TestSpecPage() {
  return <Suspense fallback={null}><TestSpecInner /></Suspense>;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function TestSpecInner() {
  const params = useParams<{ id: string; specId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const projectId = params.id;
  const specId = params.specId;
  const isNew = specId === "new";

  // 신규 모드 — URL 쿼리에서 종류·단위업무 받음
  const newKind = (searchParams.get("kind") ?? "UNIT") as "UNIT" | "INTEGRATION";
  const newUw = searchParams.get("unitWorkId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<TestSpecDetail>({
    testSpecId: "",
    displayId: "",
    testKindCode: newKind,
    testSpecNm: "",
    testSpecDc: "",
    sttusCode: "DRAFT",
    asignMemberId: null,
    prgrsRt: 0,
    unitWorks: [],
    cases: [],
  });

  // ── 단위업무 후보 (통합 테스트의 매핑 추가용) ─────────────────────────────
  const { data: uwOptions = [] } = useQuery<{ unitWorkId: string; displayId: string; name: string }[]>({
    queryKey: ["uw-options", projectId],
    queryFn: async () => {
      const res = await authFetch<{ data: { items: { unitWorkId: string; displayId: string; name: string }[] } }>(
        `/api/projects/${projectId}/unit-works`
      );
      return res.data.items;
    },
  });

  // ── 멤버 후보 (담당자) ─────────────────────────────────────────────────────
  // queryKey 는 단위업무 페이지와 동일 — 캐시 공유. 응답 구조도 동일하게 받아야 충돌 X.
  // 단위업무 페이지: useQuery → r.data ({ members, myMemberId }) 통째로 캐시.
  const { data: memberData } = useQuery<{ members: { memberId: string; name: string | null; email: string }[] }>({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: { memberId: string; name: string | null; email: string }[]; myMemberId: string } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const members = memberData?.members ?? [];

  // ── 신규 모드 초기 단위업무 매핑 (URL 쿼리 unitWorkId 자동 추가) ──────────
  useEffect(() => {
    if (!isNew || !newUw || form.unitWorks.length > 0) return;
    if (uwOptions.length === 0) return;
    const found = uwOptions.find((u) => u.unitWorkId === newUw);
    if (found) {
      setForm((f) => ({
        ...f,
        unitWorks: [{ unitWorkId: found.unitWorkId, displayId: found.displayId, name: found.name }],
        testSpecNm: f.testSpecNm || `${found.displayId} ${KIND_LABEL[newKind]}`,
      }));
    }
  }, [isNew, newUw, uwOptions, form.unitWorks.length, newKind]);

  // ── 기존 명세서 로드 ─────────────────────────────────────────────────────
  const { data: detail, isLoading } = useQuery<TestSpecDetail>({
    queryKey: ["test-spec", projectId, specId],
    queryFn: async () => {
      const res = await authFetch<{ data: TestSpecDetail }>(`/api/projects/${projectId}/test-specs/${specId}`);
      return res.data;
    },
    enabled: !isNew,
  });

  useEffect(() => {
    if (detail) setForm(detail);
  }, [detail]);

  // 명세서 상세 진입 시 URL 에 ?kind= 자동 보강 — LNB 가 단위/통합 항목을 정확히 강조하기 위함.
  // router.replace 로 next 라우터에 반영 → useSearchParams 동기화.
  // scroll:false 로 스크롤 위치 유지. 동일 값이면 skip (무한 루프 방지).
  useEffect(() => {
    if (isNew || !detail) return;
    const currentKind = searchParams.get("kind");
    if (currentKind === detail.testKindCode) return;
    router.replace(`/projects/${projectId}/test-specs/${specId}?kind=${detail.testKindCode}`, { scroll: false });
  }, [detail, isNew, searchParams, router, projectId, specId]);

  // ── 저장 (POST 신규 / PUT 수정) ──────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      // 입력 검증 (서버에서도 하지만 UX 위해 미리)
      if (!form.testSpecNm.trim()) throw new Error("명세서명을 입력해 주세요.");
      if (form.unitWorks.length === 0) throw new Error("연결할 단위업무를 1개 이상 선택해 주세요.");
      if (form.testKindCode === "UNIT" && form.unitWorks.length !== 1) {
        throw new Error("단위 테스트는 단위업무 1개에만 연결할 수 있습니다.");
      }

      if (isNew) {
        // 신규: spec 생성 → 응답으로 받은 specId 로 페이지 이동 (cases 비어있으면 그대로 끝)
        const res = await authFetch<{ data: { testSpecId: string; displayId: string } }>(
          `/api/projects/${projectId}/test-specs`,
          {
            method: "POST",
            body: JSON.stringify({
              testKindCode: form.testKindCode,
              testSpecNm: form.testSpecNm,
              testSpecDc: form.testSpecDc,
              asignMemberId: form.asignMemberId,
              prgrsRt: form.prgrsRt,
              unitWorkIds: form.unitWorks.map((u) => u.unitWorkId),
            }),
          }
        );
        return res.data.testSpecId;
      } else {
        // 수정: 메타 + cases 일괄 PUT
        await authFetch(`/api/projects/${projectId}/test-specs/${specId}`, {
          method: "PUT",
          body: JSON.stringify({
            testSpecNm: form.testSpecNm,
            testSpecDc: form.testSpecDc,
            sttusCode: form.sttusCode,
            asignMemberId: form.asignMemberId,
            prgrsRt: form.prgrsRt,
            unitWorkIds: form.unitWorks.map((u) => u.unitWorkId),
            cases: form.cases.map((c) => ({
              testCaseId:     c.testCaseId,
              caseNo:         c.caseNo,
              ctgryCode:      c.ctgryCode,
              grpNm:          c.grpNm,
              scenarioCn:     c.scenarioCn,
              expectedCn:     c.expectedCn,
              preconditionCn: c.preconditionCn,
              testDataCn:     c.testDataCn,
              testAccountCn:  c.testAccountCn,
              priortCode:     c.priortCode,
              applicableYn:   c.applicableYn,
              remarkCn:       c.remarkCn,
              aiGenYn:        c.aiGenYn,
            })),
          }),
        });
        return specId;
      }
    },
    onSuccess: (savedId) => {
      toast.success(isNew ? "명세서를 생성했습니다." : "저장했습니다.");
      // 상세 캐시 + 목록 캐시(단위/통합 양쪽 모두) 같이 무효화 — 목록 진입 시 즉시 반영
      queryClient.invalidateQueries({ queryKey: ["test-spec", projectId, specId] });
      queryClient.invalidateQueries({ queryKey: ["test-specs", projectId] });
      if (isNew) {
        router.replace(`/projects/${projectId}/test-specs/${savedId}`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 ─────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/test-specs/${specId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제했습니다.");
      // 목록으로 돌아갈 때 stale 캐시 보이지 않도록 같이 무효화
      queryClient.invalidateQueries({ queryKey: ["test-specs", projectId] });
      router.back();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 케이스 조작 ────────────────────────────────────────────────────────────
  function addCase(ctgryCode: TestCase["ctgryCode"]) {
    setForm((f) => {
      const sameCtgry = f.cases.filter((c) => c.ctgryCode === ctgryCode);
      const nextNo = (sameCtgry.length === 0 ? 0 : Math.max(...sameCtgry.map((c) => c.caseNo))) + 1;
      return {
        ...f,
        cases: [
          ...f.cases,
          {
            caseNo: nextNo,
            ctgryCode,
            scenarioCn: "",
            expectedCn: "",
            priortCode: "MEDIUM",
            applicableYn: "Y",
            aiGenYn: "N",
          },
        ],
      };
    });
  }
  function duplicateCase(idx: number) {
    setForm((f) => {
      const src = f.cases[idx];
      if (!src) return f;
      const sameCtgry = f.cases.filter((c) => c.ctgryCode === src.ctgryCode);
      const nextNo = (sameCtgry.length === 0 ? 0 : Math.max(...sameCtgry.map((c) => c.caseNo))) + 1;
      // 새 케이스 — testCaseId 제거 (INSERT 로 처리되도록)
      const dup: TestCase = { ...src, testCaseId: undefined, caseNo: nextNo };
      return { ...f, cases: [...f.cases, dup] };
    });
  }

  // 공통 점검 가져오기 — 마스터 항목들을 CHECKLIST 케이스로 일괄 추가
  // 중복 회피: 이미 같은 시나리오 텍스트가 있으면 스킵 (사용자 친화)
  function importFromMaster(items: CheckMasterItem[]) {
    setForm((f) => {
      const existing = new Set(f.cases.map((c) => c.scenarioCn.trim()));
      const checklist = f.cases.filter((c) => c.ctgryCode === "CHECKLIST");
      let nextNo = (checklist.length === 0 ? 0 : Math.max(...checklist.map((c) => c.caseNo))) + 1;

      const added: TestCase[] = [];
      for (const it of items) {
        if (existing.has(it.scenarioCn.trim())) continue;  // 중복 스킵
        added.push({
          caseNo: nextNo++,
          ctgryCode: "CHECKLIST",
          scenarioCn: it.scenarioCn,
          expectedCn: it.expectedCn,
          priortCode: "MEDIUM",
          applicableYn: "Y",
          aiGenYn: "N",
        });
      }
      if (added.length === 0) {
        toast.info("선택한 항목은 이미 모두 추가되어 있습니다.");
        return f;
      }
      toast.success(`${added.length}건을 케이스로 가져왔습니다. (저장 시 반영)`);
      return { ...f, cases: [...f.cases, ...added] };
    });
  }
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // 모드 탭 — "spec" 명세 작성 / "run" 결과 작성 (회차 + 결과 입력)
  // 신규 모드(isNew)에서는 실행 탭 비활성 (저장 후 사용 가능)
  const [mode, setMode] = useState<"spec" | "run">("spec");
  function updateCase(idx: number, patch: Partial<TestCase>) {
    setForm((f) => ({
      ...f,
      cases: f.cases.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  }
  function removeCase(idx: number) {
    setForm((f) => ({ ...f, cases: f.cases.filter((_, i) => i !== idx) }));
  }

  // ── 단위업무 매핑 조작 (통합 테스트만) ────────────────────────────────────
  function addUw(uwId: string) {
    if (form.unitWorks.some((u) => u.unitWorkId === uwId)) return;
    const uw = uwOptions.find((u) => u.unitWorkId === uwId);
    if (!uw) return;
    setForm((f) => ({
      ...f,
      unitWorks: [...f.unitWorks, { unitWorkId: uw.unitWorkId, displayId: uw.displayId, name: uw.name }],
    }));
  }
  function removeUw(uwId: string) {
    setForm((f) => ({ ...f, unitWorks: f.unitWorks.filter((u) => u.unitWorkId !== uwId) }));
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return <div style={{ padding: 40, color: "#888" }}>로딩 중...</div>;
  }

  const checklistCases = form.cases.filter((c) => c.ctgryCode === "CHECKLIST");
  const functionalCases = form.cases.filter((c) => c.ctgryCode === "FUNCTIONAL");

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => router.back()} style={backBtnStyle}>←</button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? `${KIND_LABEL[form.testKindCode]} 신규 등록` : `${KIND_LABEL[form.testKindCode]} 편집 (${form.displayId})`}
          </span>
          {!isNew && (
            <span style={statusBadge(form.sttusCode)}>{STATUS_LABEL[form.sttusCode] ?? form.sttusCode}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!isNew && (
            <button
              onClick={() => {
                if (confirm("정말 삭제하시겠습니까? 케이스·결과·결함 모두 함께 삭제됩니다.")) deleteMutation.mutate();
              }}
              style={dangerBtnStyle}
              disabled={deleteMutation.isPending}
            >삭제</button>
          )}
          <button onClick={() => router.back()} style={secondaryBtnStyle}>취소</button>
          {mode === "spec" && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              style={primaryBtnStyle}
            >{saveMutation.isPending ? "저장 중..." : "저장"}</button>
          )}
        </div>
      </div>

      {/* 모드 탭 — 명세 작성 / 결과 작성 */}
      {!isNew && (
        <div style={{ padding: "0 24px 12px", display: "flex", gap: 4 }}>
          {(["spec", "run"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: "6px 16px", borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: active ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                  color: active ? "#fff" : "var(--color-text-secondary)",
                  fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
                }}
              >
                {m === "spec" ? "📝 명세 작성" : "▶ 결과 작성"}
              </button>
            );
          })}
        </div>
      )}

      {mode === "run" && !isNew ? (
        <div style={{ padding: "0 24px 120px", maxWidth: 1200 }}>
          <TestRunPanel projectId={projectId} specId={specId} members={members} />
        </div>
      ) : (
        <div style={{ padding: "0 24px 120px", maxWidth: 1200 }}>
          {/* 메타 카드 */}
          <div style={cardStyle}>
            {/* 명세서명 / 상태 / 담당자 / 진척률 — 상태·진척률은 콘텐츠 적어 폭 줄임 */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 0.5fr 1fr 0.5fr", gap: 12, marginBottom: 14 }}>
              <FormField label="명세서명" required>
                <input
                  type="text"
                  value={form.testSpecNm}
                  placeholder="예: 회원가입 단위 테스트"
                  onChange={(e) => setForm((f) => ({ ...f, testSpecNm: e.target.value }))}
                  className="sp-input"
                />
              </FormField>
              <FormField label="상태">
                <div className="sp-select-wrap">
                  <select
                    value={form.sttusCode}
                    onChange={(e) => setForm((f) => ({ ...f, sttusCode: e.target.value }))}
                    className="sp-input"
                    disabled={isNew}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <span className="sp-select-arrow"><SelectChevron /></span>
                </div>
              </FormField>
              <FormField label="담당자">
                <div className="sp-select-wrap">
                  <select
                    value={form.asignMemberId ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, asignMemberId: e.target.value || null }))}
                    className="sp-input"
                  >
                    <option value="">담당자 없음</option>
                    {members.map((m) => (
                      <option key={m.memberId} value={m.memberId}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                  </select>
                  <span className="sp-select-arrow"><SelectChevron /></span>
                </div>
              </FormField>
              <FormField label="진척률">
                <div className="sp-select-wrap">
                  <select
                    value={form.prgrsRt}
                    onChange={(e) => setForm((f) => ({ ...f, prgrsRt: Number(e.target.value) }))}
                    className="sp-input"
                  >
                    {PROGRESS_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}%</option>
                    ))}
                  </select>
                  <span className="sp-select-arrow"><SelectChevron /></span>
                </div>
              </FormField>
            </div>

            <FormField label="설명">
              <textarea
                value={form.testSpecDc ?? ""}
                placeholder="명세서 개요·주의사항 등"
                rows={2}
                onChange={(e) => setForm((f) => ({ ...f, testSpecDc: e.target.value }))}
                className="sp-input"
                style={{ resize: "vertical" }}
              />
            </FormField>

            {/* 연결 단위업무 */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
                연결 단위업무 {form.testKindCode === "UNIT" ? "(1개 필수)" : "(1개 이상)"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {form.unitWorks.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>아직 연결된 단위업무가 없습니다.</span>
                ) : (
                  form.unitWorks.map((u) => (
                    <span key={u.unitWorkId} style={chipStyle}>
                      <strong>{u.displayId}</strong> {u.name}
                      {(form.testKindCode === "INTEGRATION" || form.unitWorks.length > 1) && (
                        <button onClick={() => removeUw(u.unitWorkId)} style={chipCloseBtnStyle}>×</button>
                      )}
                    </span>
                  ))
                )}
              </div>
              {/* 추가 셀렉트 — UNIT 은 1개 채워지면 비활성, INTEGRATION 은 항상 가능 */}
              {(form.testKindCode === "INTEGRATION" || form.unitWorks.length === 0) && (
                <div className="sp-select-wrap" style={{ maxWidth: 360 }}>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addUw(e.target.value); }}
                    className="sp-input"
                  >
                    <option value="">+ 단위업무 추가...</option>
                    {uwOptions
                      .filter((o) => !form.unitWorks.some((u) => u.unitWorkId === o.unitWorkId))
                      .map((o) => (
                        <option key={o.unitWorkId} value={o.unitWorkId}>
                          {o.displayId} {o.name}
                        </option>
                      ))}
                  </select>
                  <span className="sp-select-arrow"><SelectChevron /></span>
                </div>
              )}
            </div>
          </div>

          {/* 케이스 영역 — 외곽 cardStyle 제거. 각 CaseList 가 자체 외곽 박스(border) 보유 */}
          {/* 결과 작성 화면과 동일한 깔끔한 그리드 톤 */}
          {isNew ? (
            <div style={{ ...cardStyle, marginTop: 16, color: "var(--color-text-tertiary)", fontSize: 13 }}>
              먼저 [저장] 후 케이스를 추가할 수 있습니다.
            </div>
          ) : (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 24 }}>
              <CaseList
                title="공통 점검 (Checklist)"
                cases={checklistCases}
                onAdd={() => addCase("CHECKLIST")}
                extraActions={(
                  <button
                    onClick={() => setImportDialogOpen(true)}
                    style={importBtnStyle}
                    title="시스템 공통 + 프로젝트 전용 점검 항목 가져오기"
                  >
                    ⇩ 공통 점검 가져오기
                  </button>
                )}
                onUpdate={(localIdx, patch) => {
                  const globalIdx = form.cases.findIndex((c) => c === checklistCases[localIdx]);
                  if (globalIdx >= 0) updateCase(globalIdx, patch);
                }}
                onRemove={(localIdx) => {
                  const globalIdx = form.cases.findIndex((c) => c === checklistCases[localIdx]);
                  if (globalIdx >= 0) removeCase(globalIdx);
                }}
                onDuplicate={(localIdx) => {
                  const globalIdx = form.cases.findIndex((c) => c === checklistCases[localIdx]);
                  if (globalIdx >= 0) duplicateCase(globalIdx);
                }}
              />
              <CaseList
                title="기능 시나리오 (Functional)"
                cases={functionalCases}
                onAdd={() => addCase("FUNCTIONAL")}
                onUpdate={(localIdx, patch) => {
                  const globalIdx = form.cases.findIndex((c) => c === functionalCases[localIdx]);
                  if (globalIdx >= 0) updateCase(globalIdx, patch);
                }}
                onRemove={(localIdx) => {
                  const globalIdx = form.cases.findIndex((c) => c === functionalCases[localIdx]);
                  if (globalIdx >= 0) removeCase(globalIdx);
                }}
                onDuplicate={(localIdx) => {
                  const globalIdx = form.cases.findIndex((c) => c === functionalCases[localIdx]);
                  if (globalIdx >= 0) duplicateCase(globalIdx);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 공통 점검 가져오기 모달 — 모드 무관 (run 모드에서도 띄울 일 없으면 inert) */}
      <ImportCheckMasterDialog
        projectId={projectId}
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={importFromMaster}
      />
    </div>
  );
}

// ── 케이스 리스트 — 카드 형태 ────────────────────────────────────────────────

function CaseList({
  title, cases, onAdd, onUpdate, onRemove, onDuplicate, extraActions,
}: {
  title: string;
  cases: TestCase[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<TestCase>) => void;
  onRemove: (idx: number) => void;
  onDuplicate: (idx: number) => void;
  // 헤더 우측에 추가로 노출할 액션 (예: 공통 점검 가져오기)
  extraActions?: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {title} <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 400 }}>({cases.length})</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {extraActions}
          <button onClick={onAdd} style={addBtnStyle}>+ 케이스 추가</button>
        </div>
      </div>
      {cases.length === 0 ? (
        <div style={{
          padding: "24px 10px", textAlign: "center",
          color: "var(--color-text-tertiary)", fontSize: 12,
          border: "1px dashed var(--color-border)", borderRadius: 6,
        }}>
          케이스가 없습니다. 위의 [+ 케이스 추가] 버튼으로 등록하세요.
        </div>
      ) : (
        // 두 카테고리 모두 외곽 박스 1개 + 행 사이 구분선의 데이터 그리드 스타일
        // 헤더 행은 카테고리별 컬럼 구성에 맞춰 분기 (Checklist 와 Functional 의 컬럼 다름)
        <div style={{
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--color-bg-card)",
        }}>
          {cases[0].ctgryCode === "CHECKLIST" ? <ChecklistHeader /> : <FunctionalHeader />}
          {cases.map((c, i) => (
            <CaseCard
              key={c.testCaseId ?? `new-${c.ctgryCode}-${i}`}
              c={c}
              isLast={i === cases.length - 1}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
              onDuplicate={() => onDuplicate(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 그리드 헤더 행 — Checklist / Functional 분리 ───────────────────────────
// 각 카테고리의 행 grid columns 와 정확히 일치해야 컬럼 정렬이 맞음.

function ChecklistHeader() {
  // 헤더 셀 좌측 패딩을 행의 셀(input/select) 좌측 패딩과 동일하게 맞춰 컬럼 정렬 일치.
  // No 컬럼: 행의 숫자가 paddingLeft 4 → 헤더도 4
  // 해당여부/시나리오/예상결과: 행의 input padding "6px 8px" → 헤더 paddingLeft 8
  // 외곽 좌우 padding 16 — 테스트 실행(결과 작성) 화면과 동일한 들여쓰기로 통일
  return (
    <div style={{
      ...gridHeaderStyle,
      gridTemplateColumns: "44px 80px 6fr 4fr auto",
      padding: "8px 16px",
    }}>
      <span style={{ paddingLeft: 4 }}>No</span>
      <span style={{ textAlign: "center" }}>해당여부</span>
      <span style={{ paddingLeft: 8 }}>시나리오 *</span>
      <span style={{ paddingLeft: 8 }}>예상 결과 *</span>
      <span style={{ width: 80 /* SubInfoToggle(28) + 복제(20) + 삭제(20) + gap */ }} />
    </div>
  );
}

function FunctionalHeader() {
  // 구분 컬럼 추가 — 도메인 그룹핑(예: "회원", "승인", "관리")
  return (
    <div style={{
      ...gridHeaderStyle,
      gridTemplateColumns: "44px 120px 1fr 1fr auto",
      padding: "8px 16px",
    }}>
      <span style={{ paddingLeft: 4 }}>No</span>
      <span style={{ paddingLeft: 4 }}>구분</span>
      <span style={{ paddingLeft: 4 }}>시나리오 *</span>
      <span style={{ paddingLeft: 4 }}>예상 결과 *</span>
      <span style={{ width: 80 /* SubInfoToggle + 복제 + 삭제 */ }} />
    </div>
  );
}

const gridHeaderStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--color-text-secondary)",
};

// ── 케이스 카드 (한 행 = 1 카드) ─────────────────────────────────────────────

function CaseCard(props: {
  c: TestCase;
  isLast?: boolean;
  onUpdate: (patch: Partial<TestCase>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  // CHECKLIST 는 점검 문장이 짧으니 한 행 컴팩트 레이아웃 — 시각 부담 최소
  // FUNCTIONAL 은 카드 형태 유지 (시나리오·예상결과가 길어 textarea 필요)
  if (props.c.ctgryCode === "CHECKLIST") {
    return <ChecklistRow {...props} />;
  }
  return <FunctionalCard {...props} />;
}

// ── 해당여부 토글 — iOS 스타일 스위치 + 라벨 ───────────────────────────────
// Y(해당됨) / N(해당없음) 두 상태. 클릭 시 즉시 전환.
function ApplicableToggle({
  value, onChange,
}: {
  value:    "Y" | "N";
  onChange: (v: "Y" | "N") => void;
}) {
  const isOn = value === "Y";
  return (
    <button
      type="button"
      onClick={() => onChange(isOn ? "N" : "Y")}
      title={isOn ? "해당됨 (클릭 시 해당없음)" : "해당없음 (클릭 시 해당됨)"}
      style={{
        display: "inline-flex", alignItems: "center",
        background: "transparent", border: "none",
        padding: "4px 8px", cursor: "pointer",
      }}
    >
      {/* 스위치 트랙 */}
      <span style={{
        position: "relative", display: "inline-block",
        width: 28, height: 16, borderRadius: 8,
        background: isOn ? "rgba(103,80,164,0.85)" : "var(--color-border-strong, #cfd2dc)",
        transition: "background 0.15s",
        flexShrink: 0,
      }}>
        {/* 노브 */}
        <span style={{
          position: "absolute", top: 2,
          left: isOn ? 14 : 2,
          width: 12, height: 12, borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          transition: "left 0.15s",
        }} />
      </span>
    </button>
  );
}

// ── 자동 높이 textarea — 내용 길이에 따라 자동 wrap + height 조절 ─────────
// 같은 그리드 안에서 input 처럼 한 줄로 시작하되 긴 텍스트가 잘리지 않도록.
function AutoSizeTextarea({
  value, onChange, placeholder, style, onFocus, onBlur,
}: {
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  style?:       React.CSSProperties;
  onFocus?:     (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?:      (e: React.FocusEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // mount + value 변경 시마다 scrollHeight 기준으로 height 재계산
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        ...style,
        resize: "none",
        overflow: "hidden",
        wordBreak: "break-word",
        lineHeight: 1.5,
      }}
    />
  );
}

// ── CHECKLIST — 한 줄 컴팩트 행 ─────────────────────────────────────────────
//
// 점검 문장이 짧으니 헤더·본문을 한 행으로 통합:
//   [No] [우선순위▼] [해당▼]  [시나리오 input]  [예상결과 input]  [✨] [▸부가] [⎘] [×]
// 부가정보(전제조건·테스트데이터·계정·비고)는 같은 카드 아래로 접이식 펼침.

function ChecklistRow({
  c, isLast, onUpdate, onRemove, onDuplicate,
}: {
  c: TestCase;
  isLast?: boolean;
  onUpdate: (patch: Partial<TestCase>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const inactive = c.applicableYn === "N";

  // 데이터 그리드 셀 input — 평소엔 보더 없이, hover/focus 시 옅은 강조
  const cellInputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid transparent",
    borderRadius: 4,
    background: "transparent",
    fontSize: 13,
    padding: "6px 8px",
    outline: "none",
    color: "var(--color-text-primary)",
    transition: "border-color 0.1s, background 0.1s",
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: inactive
          ? "var(--color-bg-muted)"
          : hover
            ? "rgba(0,0,0,0.02)"
            : "transparent",
        opacity: inactive ? 0.6 : 1,
        transition: "background 0.1s, opacity 0.15s",
      }}
    >
      {/* 한 행 — gridTemplateColumns: No / 해당여부 / 시나리오 / 예상결과 / 액션
          좌우 padding 16 — 헤더와 동일 (외곽 박스 안쪽 들여쓰기) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 80px 6fr 4fr auto",
        alignItems: "start",
        gap: 6,
        padding: "5px 16px",
      }}>
        <span style={{ fontSize: 13, color: "var(--color-text-primary)", paddingLeft: 4 }}>
          {c.caseNo}
        </span>

        {/* 해당여부 — iOS 스타일 토글. 셀 안에서 가운데 정렬 (헤더 라벨과 일치) */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <ApplicableToggle
            value={c.applicableYn ?? "Y"}
            onChange={(v) => onUpdate({ applicableYn: v })}
          />
        </div>

        {/* borderless textarea — 자동 wrap + height 조절. focus 시 옅은 보더 */}
        <AutoSizeTextarea
          value={c.scenarioCn}
          onChange={(v) => onUpdate({ scenarioCn: v })}
          placeholder="시나리오"
          style={cellInputStyle}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.background = "var(--color-bg-card)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
        />
        <AutoSizeTextarea
          value={c.expectedCn}
          onChange={(v) => onUpdate({ expectedCn: v })}
          placeholder="예상 결과"
          style={cellInputStyle}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.background = "var(--color-bg-card)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          {c.aiGenYn === "Y" && (
            <span style={{
              padding: "1px 5px", borderRadius: 6,
              background: "rgba(103,80,164,0.1)", color: "rgba(103,80,164,1)",
              fontSize: 9, fontWeight: 700, marginRight: 2,
            }}>✨</span>
          )}
          <SubInfoToggle expanded={expanded} hasData={hasSubInfo(c)} onToggle={() => setExpanded((v) => !v)} />
          <button onClick={onDuplicate} title="이 케이스 복제" style={iconBtnStyle}>⎘</button>
          <button onClick={onRemove} title="케이스 삭제" style={{ ...iconBtnStyle, color: "#e53935" }}>×</button>
        </div>
      </div>

      {/* 부가정보 — 펼침 시에만 (별도 행) */}
      {expanded && <SubInfoGrid c={c} onUpdate={onUpdate} />}
    </div>
  );
}

// 부가정보 4필드 그리드 — Checklist/Functional 공통 사용
function SubInfoGrid({
  c, onUpdate,
}: { c: TestCase; onUpdate: (patch: Partial<TestCase>) => void }) {
  return (
    <div style={{
      borderTop: "1px solid var(--color-border)",
      padding: "8px 10px 10px",
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
    }}>
      <SubField label="전제조건" placeholder="예: OWNER 로그인, 프로젝트 1개 보유"
        value={c.preconditionCn ?? ""} onChange={(v) => onUpdate({ preconditionCn: v })} />
      <SubField label="테스트 데이터" placeholder="예: 이메일 a@b.com / 비번 Test1234!"
        value={c.testDataCn ?? ""} onChange={(v) => onUpdate({ testDataCn: v })} />
      <SubField label="테스트 계정" placeholder="예: OWNER 계정 / MEMBER 계정"
        value={c.testAccountCn ?? ""} onChange={(v) => onUpdate({ testAccountCn: v })} />
      <SubField label="비고" placeholder="관련 이슈·보충 설명"
        value={c.remarkCn ?? ""} onChange={(v) => onUpdate({ remarkCn: v })} />
    </div>
  );
}

// ── FUNCTIONAL — 카드 형태 (기존) ───────────────────────────────────────────

function FunctionalCard({
  c, isLast, onUpdate, onRemove, onDuplicate,
}: {
  c: TestCase;
  isLast?: boolean;
  onUpdate: (patch: Partial<TestCase>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // 컬럼 순서: No (좌) / 시나리오 / 예상결과 / 액션 (우)
  // 우선순위는 제거됨 (DB priort_code 는 "MEDIUM" 기본값 유지 — 데이터 보존)
  return (
    <div style={{
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 120px 1fr 1fr auto",
        gap: 8,
        padding: "8px 16px",
        alignItems: "start",
      }}>
        {/* No + AI 배지 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 6 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
            {c.caseNo}
          </span>
          {c.aiGenYn === "Y" && (
            <span style={{
              padding: "1px 5px", borderRadius: 6,
              background: "rgba(103,80,164,0.1)", color: "rgba(103,80,164,1)",
              fontSize: 9, fontWeight: 700,
            }}>✨</span>
          )}
        </div>

        {/* 구분(그룹명) — 자유 입력. 같은 그룹끼리 정렬하면 자연스럽게 묶임.
            시나리오·예상결과와 통일성을 위해 textarea 사용 (긴 그룹명도 줄바꿈 가능) */}
        <textarea
          value={c.grpNm ?? ""}
          onChange={(e) => onUpdate({ grpNm: e.target.value })}
          placeholder="예: 회원"
          className="sp-input"
          style={{ width: "100%", minHeight: 80, resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: "6px 8px" }}
        />
        <textarea
          value={c.scenarioCn}
          onChange={(e) => onUpdate({ scenarioCn: e.target.value })}
          placeholder="테스트 내용 (어떻게 수행하는가)"
          className="sp-input"
          style={{ width: "100%", minHeight: 80, resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: "6px 8px" }}
        />
        <textarea
          value={c.expectedCn}
          onChange={(e) => onUpdate({ expectedCn: e.target.value })}
          placeholder="무엇이 일어나야 정상인가"
          className="sp-input"
          style={{ width: "100%", minHeight: 80, resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: "6px 8px" }}
        />

        {/* 우측 세로 액션 컬럼 — Checklist 와 일관 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 4 }}>
          <SubInfoToggle expanded={expanded} hasData={hasSubInfo(c)} onToggle={() => setExpanded((v) => !v)} />
          <button onClick={onDuplicate} title="이 케이스 복제" style={iconBtnStyle}>⎘</button>
          <button onClick={onRemove} title="케이스 삭제" style={{ ...iconBtnStyle, color: "#e53935" }}>×</button>
        </div>
      </div>

      {/* 부가정보 — 펼침 시에만 */}
      {expanded && <SubInfoGrid c={c} onUpdate={onUpdate} />}
    </div>
  );
}

function hasSubInfo(c: TestCase): boolean {
  return !!(c.preconditionCn?.trim() || c.testDataCn?.trim() || c.testAccountCn?.trim() || c.remarkCn?.trim());
}

// 부가정보 펼침/접힘 토글 — 시각적으로 명확한 크기의 chevron SVG.
// 입력된 부가정보가 있으면 좌측에 작은 점(●) 으로 인지 표시.
function SubInfoToggle({
  expanded, hasData, onToggle,
}: { expanded: boolean; hasData: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? "부가정보 닫기" : "전제조건·테스트 데이터·계정·비고"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
        padding: "3px 6px",
        cursor: "pointer",
        color: hasData ? "var(--color-brand, #1976d2)" : "var(--color-text-secondary)",
        lineHeight: 1,
      }}
    >
      {hasData && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-brand, #1976d2)" }} />
      )}
      <svg
        width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>{children}</div>;
}

function SubField({
  label, placeholder, value, onChange,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sp-input"
        rows={2}
        style={{ width: "100%", resize: "vertical", fontSize: 12, padding: "6px 8px" }}
      />
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer",
  color: "var(--color-text-secondary)", fontSize: 16, padding: "2px 6px",
  lineHeight: 1, borderRadius: 4,
};

// ── 공통 컴포넌트·스타일 ─────────────────────────────────────────────────────

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {label}
        {required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
  background: "var(--color-bg-card)",
  borderBottom: "1px solid var(--color-border)",
  marginBottom: 16,
};
const backBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 18, color: "var(--color-text-secondary)", padding: "2px 4px", lineHeight: 1,
};
const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "16px 20px",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
};
const dangerBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid #ef5350",
  background: "#fff5f5",
  color: "#e53935",
  fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
};
const addBtnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4,
  border: "1px dashed var(--color-border)",
  background: "transparent",
  color: "var(--color-brand, #1976d2)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const importBtnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-primary)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "3px 8px", borderRadius: 12,
  background: "var(--color-bg-muted)",
  fontSize: 12, color: "var(--color-text-primary)",
};
const chipCloseBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-text-secondary)", fontSize: 14, padding: 0, lineHeight: 1,
};

function statusBadge(code: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string }> = {
    DRAFT: { bg: "#f5f5f5", fg: "#616161" },
    IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
    PASSED: { bg: "#e8f5e9", fg: "#2e7d32" },
    FAILED: { bg: "#ffebee", fg: "#c62828" },
  };
  const c = colors[code] ?? colors.DRAFT;
  return {
    display: "inline-block", padding: "2px 10px", borderRadius: 12,
    background: c.bg, color: c.fg,
    fontSize: 11, fontWeight: 700, marginLeft: 4,
  };
}

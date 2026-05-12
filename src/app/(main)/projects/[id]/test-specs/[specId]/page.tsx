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

import { Suspense, useEffect, useState } from "react";
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
  displayId:  string | null;
  name:       string | null;
};

type TestCase = {
  testCaseId?:     string;       // 신규 행은 없음
  caseNo:          number;
  ctgryCode:       "CHECKLIST" | "FUNCTIONAL";
  scenarioCn:      string;
  expectedCn:      string;
  preconditionCn?: string | null;
  testDataCn?:     string | null;
  testAccountCn?:  string | null;
  priortCode?:     "HIGH" | "MEDIUM" | "LOW";
  applicableYn?:   "Y" | "N";
  remarkCn?:       string | null;
  aiGenYn:         string;
  sortOrdr?:       number;
};

type TestSpecDetail = {
  testSpecId:    string;
  displayId:     string;
  testKindCode:  "UNIT" | "INTEGRATION";
  testSpecNm:    string;
  testSpecDc:    string | null;
  sttusCode:     string;
  asignMemberId: string | null;
  unitWorks:     UnitWorkLink[];
  cases:         TestCase[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  UNIT:        "단위 테스트 명세서",
  INTEGRATION: "통합 테스트 명세서",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT:       "작성중",
  IN_PROGRESS: "진행중",
  PASSED:      "합격",
  FAILED:      "불합격",
};
const STATUS_OPTIONS = ["DRAFT", "IN_PROGRESS", "PASSED", "FAILED"] as const;
const CTGRY_LABEL: Record<string, string> = {
  CHECKLIST:  "공통 점검",
  FUNCTIONAL: "기능 시나리오",
};

const PRIORITY_LABEL: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};
const PRIORITY_COLOR: Record<string, { bg: string; fg: string }> = {
  HIGH:   { bg: "#ffebee", fg: "#c62828" },
  MEDIUM: { bg: "#fff3e0", fg: "#e65100" },
  LOW:    { bg: "#e8f5e9", fg: "#2e7d32" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function TestSpecPage() {
  return <Suspense fallback={null}><TestSpecInner /></Suspense>;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function TestSpecInner() {
  const params       = useParams<{ id: string; specId: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();

  const projectId = params.id;
  const specId    = params.specId;
  const isNew     = specId === "new";

  // 신규 모드 — URL 쿼리에서 종류·단위업무 받음
  const newKind = (searchParams.get("kind") ?? "UNIT") as "UNIT" | "INTEGRATION";
  const newUw   = searchParams.get("unitWorkId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<TestSpecDetail>({
    testSpecId:    "",
    displayId:     "",
    testKindCode:  newKind,
    testSpecNm:    "",
    testSpecDc:    "",
    sttusCode:     "DRAFT",
    asignMemberId: null,
    unitWorks:     [],
    cases:         [],
  });

  // ── 단위업무 후보 (통합 테스트의 매핑 추가용) ─────────────────────────────
  const { data: uwOptions = [] } = useQuery<{ unitWorkId: string; displayId: string; name: string }[]>({
    queryKey: ["uw-options", projectId],
    queryFn:  async () => {
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
    queryFn:  () =>
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
    queryFn:  async () => {
      const res = await authFetch<{ data: TestSpecDetail }>(`/api/projects/${projectId}/test-specs/${specId}`);
      return res.data;
    },
    enabled: !isNew,
  });

  useEffect(() => {
    if (detail) setForm(detail);
  }, [detail]);

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
              testKindCode:  form.testKindCode,
              testSpecNm:    form.testSpecNm,
              testSpecDc:    form.testSpecDc,
              asignMemberId: form.asignMemberId,
              unitWorkIds:   form.unitWorks.map((u) => u.unitWorkId),
            }),
          }
        );
        return res.data.testSpecId;
      } else {
        // 수정: 메타 + cases 일괄 PUT
        await authFetch(`/api/projects/${projectId}/test-specs/${specId}`, {
          method: "PUT",
          body: JSON.stringify({
            testSpecNm:    form.testSpecNm,
            testSpecDc:    form.testSpecDc,
            sttusCode:     form.sttusCode,
            asignMemberId: form.asignMemberId,
            unitWorkIds:   form.unitWorks.map((u) => u.unitWorkId),
            cases:         form.cases.map((c) => ({
                             testCaseId: c.testCaseId,
                             caseNo:     c.caseNo,
                             ctgryCode:  c.ctgryCode,
                             scenarioCn: c.scenarioCn,
                             expectedCn: c.expectedCn,
                             aiGenYn:    c.aiGenYn,
                           })),
          }),
        });
        return specId;
      }
    },
    onSuccess: (savedId) => {
      toast.success(isNew ? "명세서를 생성했습니다." : "저장했습니다.");
      queryClient.invalidateQueries({ queryKey: ["test-spec", projectId, specId] });
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
            caseNo:        nextNo,
            ctgryCode,
            scenarioCn:    "",
            expectedCn:    "",
            priortCode:    "MEDIUM",
            applicableYn:  "Y",
            aiGenYn:       "N",
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
          caseNo:        nextNo++,
          ctgryCode:     "CHECKLIST",
          scenarioCn:    it.scenarioCn,
          expectedCn:    it.expectedCn,
          priortCode:    "MEDIUM",
          applicableYn:  "Y",
          aiGenYn:       "N",
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
  // 모드 탭 — "spec" 명세 작성 / "run" 테스트 실행 (회차 + 결과 입력)
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

  const checklistCases  = form.cases.filter((c) => c.ctgryCode === "CHECKLIST");
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

      {/* 모드 탭 — 명세 작성 / 테스트 실행 */}
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
                  color:      active ? "#fff" : "var(--color-text-secondary)",
                  fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
                }}
              >
                {m === "spec" ? "📝 명세 작성" : "▶ 테스트 실행"}
              </button>
            );
          })}
        </div>
      )}

      {mode === "run" && !isNew ? (
        <div style={{ padding: "0 24px 24px", maxWidth: 1200 }}>
          <TestRunPanel projectId={projectId} specId={specId} members={members} />
        </div>
      ) : (
      <div style={{ padding: "0 24px 24px", maxWidth: 1200 }}>
        {/* 메타 카드 */}
        <div style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
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

        {/* 케이스 카드 — 신규 모드에서는 저장 후 활성 (specId 가 있어야 case bulk PUT 가능) */}
        {isNew ? (
          <div style={{ ...cardStyle, marginTop: 16, color: "var(--color-text-tertiary)", fontSize: 13 }}>
            먼저 [저장] 후 케이스를 추가할 수 있습니다.
          </div>
        ) : (
          <div style={{ ...cardStyle, marginTop: 16 }}>
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
            <div style={{ height: 24 }} />
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
  title:         string;
  cases:         TestCase[];
  onAdd:         () => void;
  onUpdate:      (idx: number, patch: Partial<TestCase>) => void;
  onRemove:      (idx: number) => void;
  onDuplicate:   (idx: number) => void;
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cases.map((c, i) => (
            <CaseCard
              key={c.testCaseId ?? `new-${c.ctgryCode}-${i}`}
              c={c}
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

// ── 케이스 카드 (한 행 = 1 카드) ─────────────────────────────────────────────

function CaseCard(props: {
  c: TestCase;
  onUpdate:    (patch: Partial<TestCase>) => void;
  onRemove:    () => void;
  onDuplicate: () => void;
}) {
  // CHECKLIST 는 점검 문장이 짧으니 한 행 컴팩트 레이아웃 — 시각 부담 최소
  // FUNCTIONAL 은 카드 형태 유지 (시나리오·예상결과가 길어 textarea 필요)
  if (props.c.ctgryCode === "CHECKLIST") {
    return <ChecklistRow {...props} />;
  }
  return <FunctionalCard {...props} />;
}

// ── CHECKLIST — 한 줄 컴팩트 행 ─────────────────────────────────────────────
//
// 점검 문장이 짧으니 헤더·본문을 한 행으로 통합:
//   [No] [우선순위▼] [해당▼]  [시나리오 input]  [예상결과 input]  [✨] [▸부가] [⎘] [×]
// 부가정보(전제조건·테스트데이터·계정·비고)는 같은 카드 아래로 접이식 펼침.

function ChecklistRow({
  c, onUpdate, onRemove, onDuplicate,
}: {
  c: TestCase;
  onUpdate:    (patch: Partial<TestCase>) => void;
  onRemove:    () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inactive = c.applicableYn === "N";
  const priorColor = PRIORITY_COLOR[c.priortCode ?? "MEDIUM"];

  return (
    <div style={{
      border: "1px solid var(--color-border)",
      borderRadius: 6,
      background: inactive ? "var(--color-bg-muted)" : "var(--color-bg-card)",
      opacity:    inactive ? 0.65 : 1,
      transition: "opacity 0.15s, background 0.15s",
    }}>
      {/* 한 행 — gridTemplateColumns 로 입력 영역 폭 균등 (50:50) */}
      <div style={{
        display: "grid",
        // No / 우선순위 / 해당여부 / 시나리오 / 예상결과 / [부가·복제·삭제]
        gridTemplateColumns: "44px 76px 88px 1fr 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>
          No.{c.caseNo}
        </span>

        <select
          value={c.priortCode ?? "MEDIUM"}
          onChange={(e) => onUpdate({ priortCode: e.target.value as TestCase["priortCode"] })}
          style={{
            padding: "3px 4px", borderRadius: 10,
            border: `1px solid ${priorColor.fg}33`,
            background: priorColor.bg, color: priorColor.fg,
            fontSize: 11, fontWeight: 700, cursor: "pointer", width: "100%",
          }}
          title="우선순위"
        >
          <option value="HIGH">높음</option>
          <option value="MEDIUM">중간</option>
          <option value="LOW">낮음</option>
        </select>

        <select
          value={c.applicableYn ?? "Y"}
          onChange={(e) => onUpdate({ applicableYn: e.target.value as "Y" | "N" })}
          style={{
            padding: "3px 4px", borderRadius: 10,
            border: "1px solid var(--color-border)",
            background: inactive ? "#f5f5f5" : "var(--color-bg-card)",
            color: inactive ? "#888" : "var(--color-text-primary)",
            fontSize: 11, fontWeight: 600, cursor: "pointer", width: "100%",
          }}
          title="해당 여부"
        >
          <option value="Y">해당됨</option>
          <option value="N">해당없음</option>
        </select>

        <input
          type="text"
          value={c.scenarioCn}
          onChange={(e) => onUpdate({ scenarioCn: e.target.value })}
          placeholder="시나리오 *"
          className="sp-input"
          style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
        />
        <input
          type="text"
          value={c.expectedCn}
          onChange={(e) => onUpdate({ expectedCn: e.target.value })}
          placeholder="예상 결과 *"
          className="sp-input"
          style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {c.aiGenYn === "Y" && (
            <span style={{
              padding: "1px 6px", borderRadius: 8,
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
      <SubField label="전제조건"     placeholder="예: OWNER 로그인, 프로젝트 1개 보유"
        value={c.preconditionCn ?? ""} onChange={(v) => onUpdate({ preconditionCn: v })} />
      <SubField label="테스트 데이터" placeholder="예: 이메일 a@b.com / 비번 Test1234!"
        value={c.testDataCn ?? ""}     onChange={(v) => onUpdate({ testDataCn: v })} />
      <SubField label="테스트 계정"   placeholder="예: OWNER 계정 / MEMBER 계정"
        value={c.testAccountCn ?? ""}  onChange={(v) => onUpdate({ testAccountCn: v })} />
      <SubField label="비고"          placeholder="관련 이슈·보충 설명"
        value={c.remarkCn ?? ""}       onChange={(v) => onUpdate({ remarkCn: v })} />
    </div>
  );
}

// ── FUNCTIONAL — 카드 형태 (기존) ───────────────────────────────────────────

function FunctionalCard({
  c, onUpdate, onRemove, onDuplicate,
}: {
  c: TestCase;
  onUpdate:    (patch: Partial<TestCase>) => void;
  onRemove:    () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inactive = c.applicableYn === "N";       // 해당없음 → 흐리게
  const priorColor = PRIORITY_COLOR[c.priortCode ?? "MEDIUM"];

  return (
    <div style={{
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      background: inactive ? "var(--color-bg-muted)" : "var(--color-bg-card)",
      opacity:    inactive ? 0.65 : 1,
      transition: "opacity 0.15s, background 0.15s",
    }}>
      {/* 헤더 — No, 우선순위, 해당여부, 액션 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px",
        borderBottom: "1px solid var(--color-border)",
        background: "rgba(0,0,0,0.015)",
        borderTopLeftRadius: 8, borderTopRightRadius: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", minWidth: 36 }}>
          No.{c.caseNo}
        </span>

        {/* 우선순위 select (배지 스타일) */}
        <select
          value={c.priortCode ?? "MEDIUM"}
          onChange={(e) => onUpdate({ priortCode: e.target.value as TestCase["priortCode"] })}
          style={{
            padding: "2px 6px", borderRadius: 10,
            border: `1px solid ${priorColor.fg}33`,
            background: priorColor.bg, color: priorColor.fg,
            fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}
        >
          <option value="HIGH">우선순위 높음</option>
          <option value="MEDIUM">우선순위 중간</option>
          <option value="LOW">우선순위 낮음</option>
        </select>

        {/* 해당 여부 select */}
        <select
          value={c.applicableYn ?? "Y"}
          onChange={(e) => onUpdate({ applicableYn: e.target.value as "Y" | "N" })}
          style={{
            padding: "2px 6px", borderRadius: 10,
            border: "1px solid var(--color-border)",
            background: inactive ? "#f5f5f5" : "var(--color-bg-card)",
            color: inactive ? "#888" : "var(--color-text-primary)",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}
        >
          <option value="Y">해당됨</option>
          <option value="N">해당없음 (N/A)</option>
        </select>

        {c.aiGenYn === "Y" && (
          <span style={{
            padding: "2px 8px", borderRadius: 10,
            background: "rgba(103,80,164,0.1)", color: "rgba(103,80,164,1)",
            fontSize: 10, fontWeight: 700,
          }}>✨ AI 생성</span>
        )}

        <span style={{ flex: 1 }} />

        {/* 부가정보 토글 — Checklist 와 동일 패턴 (헤더 통합) */}
        <SubInfoToggle expanded={expanded} hasData={hasSubInfo(c)} onToggle={() => setExpanded((v) => !v)} />
        <button onClick={onDuplicate} title="이 케이스 복제" style={iconBtnStyle}>⎘</button>
        <button onClick={onRemove} title="케이스 삭제" style={{ ...iconBtnStyle, color: "#e53935" }}>×</button>
      </div>

      {/* 본문 — FUNCTIONAL: textarea 110px (좀 더 컴팩트) + 50:50 비율 */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8, padding: 8,
      }}>
        <div>
          <Label>시나리오 *</Label>
          <textarea
            value={c.scenarioCn}
            onChange={(e) => onUpdate({ scenarioCn: e.target.value })}
            placeholder="테스트 내용 (어떻게 수행하는가)"
            className="sp-input"
            style={{ width: "100%", minHeight: 110, resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: "6px 8px" }}
          />
        </div>
        <div>
          <Label>예상 결과 *</Label>
          <textarea
            value={c.expectedCn}
            onChange={(e) => onUpdate({ expectedCn: e.target.value })}
            placeholder="무엇이 일어나야 정상인가"
            className="sp-input"
            style={{ width: "100%", minHeight: 110, resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: "6px 8px" }}
          />
        </div>
      </div>

      {/* 부가정보 — 펼침 시에만 (헤더 토글로 제어) */}
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
  padding: "10px 24px",
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
const removeRowBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "#e53935", fontSize: 16, padding: 0, lineHeight: 1,
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
    DRAFT:       { bg: "#f5f5f5", fg: "#616161" },
    IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
    PASSED:      { bg: "#e8f5e9", fg: "#2e7d32" },
    FAILED:      { bg: "#ffebee", fg: "#c62828" },
  };
  const c = colors[code] ?? colors.DRAFT;
  return {
    display: "inline-block", padding: "2px 10px", borderRadius: 12,
    background: c.bg, color: c.fg,
    fontSize: 11, fontWeight: 700, marginLeft: 4,
  };
}

"use client";

/**
 * UwTestSpecMenu — 단위업무 헤더에서 호출하는 "테스트 명세" 드롭다운
 *
 * 역할:
 *   - 해당 단위업무에 묶인 단위/통합 테스트 명세서를 빠르게 열거
 *   - 없으면 [+ 새로 만들기] 로 신규 생성 페이지로 이동 (specId="new" + 쿼리스트링)
 *
 * 이용:
 *   <UwTestSpecMenu projectId={projectId} unitWorkId={unitWorkId} />
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type SpecListItem = {
  testSpecId:    string;
  displayId:     string;
  testKindCode:  "UNIT" | "INTEGRATION";
  testSpecNm:    string;
  sttusCode:     string;
  caseCount:     number;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT:       "작성중",
  IN_PROGRESS: "진행중",
  PASSED:      "합격",
  FAILED:      "불합격",
};

export default function UwTestSpecMenu({
  projectId, unitWorkId,
}: {
  projectId:  string;
  unitWorkId: string;
}) {
  const router = useRouter();
  const [open, setOpen]   = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 단위업무에 묶인 명세서 목록 조회
  const { data: specs = [], isLoading } = useQuery<SpecListItem[]>({
    queryKey: ["uw-test-specs", projectId, unitWorkId],
    queryFn:  async () => {
      const res = await authFetch<{ data: { items: SpecListItem[] } }>(
        `/api/projects/${projectId}/test-specs?unitWorkId=${unitWorkId}`
      );
      return res.data.items;
    },
    enabled: open,  // 메뉴 열릴 때만 조회
  });

  const unitSpecs        = specs.filter((s) => s.testKindCode === "UNIT");
  const integrationSpecs = specs.filter((s) => s.testKindCode === "INTEGRATION");

  function goNew(kind: "UNIT" | "INTEGRATION") {
    router.push(`/projects/${projectId}/test-specs/new?kind=${kind}&unitWorkId=${unitWorkId}`);
  }
  function goSpec(specId: string) {
    router.push(`/projects/${projectId}/test-specs/${specId}`);
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 8,
          border: "1px solid var(--color-border)",
          background: open ? "var(--color-bg-muted)" : "var(--color-bg-card)",
          color: "var(--color-text-primary)",
          fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <span>🧪</span> 테스트 명세 <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 300,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
          padding: 14,
          minWidth: 320,
        }}>
          {/* 단위 테스트 섹션 */}
          <Section title="단위 테스트 명세서" hint="이 단위업무 1개에 묶인 명세서">
            {isLoading ? (
              <Loading />
            ) : unitSpecs.length === 0 ? (
              <Empty />
            ) : (
              unitSpecs.map((s) => <SpecRow key={s.testSpecId} spec={s} onClick={() => { goSpec(s.testSpecId); setOpen(false); }} />)
            )}
            <button onClick={() => { goNew("UNIT"); setOpen(false); }} style={addRowStyle}>+ 단위 테스트 명세서 추가</button>
          </Section>

          <Divider />

          {/* 통합 테스트 섹션 */}
          <Section title="통합 테스트 명세서" hint="이 단위업무가 포함된 통합 명세서">
            {isLoading ? (
              <Loading />
            ) : integrationSpecs.length === 0 ? (
              <Empty />
            ) : (
              integrationSpecs.map((s) => <SpecRow key={s.testSpecId} spec={s} onClick={() => { goSpec(s.testSpecId); setOpen(false); }} />)
            )}
            <button onClick={() => { goNew("INTEGRATION"); setOpen(false); }} style={addRowStyle}>+ 통합 테스트 명세서 추가</button>
          </Section>
        </div>
      )}
    </div>
  );
}

// ── 보조 컴포넌트 ────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{title}</span>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{hint}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function SpecRow({ spec, onClick }: { spec: SpecListItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 8px", borderRadius: 6,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-card)",
        color: "var(--color-text-primary)",
        fontSize: 12, cursor: "pointer", textAlign: "left", width: "100%",
      }}
    >
      <span style={{ fontWeight: 700, color: "var(--color-brand, #1976d2)", flexShrink: 0 }}>{spec.displayId}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {spec.testSpecNm}
      </span>
      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{spec.caseCount}건</span>
      <span style={statusChipStyle(spec.sttusCode)}>{STATUS_LABEL[spec.sttusCode] ?? spec.sttusCode}</span>
    </button>
  );
}

function Empty() {
  return <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "4px 0" }}>아직 등록된 명세서가 없습니다.</div>;
}
function Loading() {
  return <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "4px 0" }}>불러오는 중...</div>;
}
function Divider() {
  return <div style={{ height: 1, background: "var(--color-border)", margin: "12px 0" }} />;
}

const addRowStyle: React.CSSProperties = {
  padding: "5px 8px", borderRadius: 6,
  border: "1px dashed var(--color-border)",
  background: "transparent",
  color: "var(--color-brand, #1976d2)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  textAlign: "left", marginTop: 4,
};

function statusChipStyle(code: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string }> = {
    DRAFT:       { bg: "#f5f5f5", fg: "#616161" },
    IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
    PASSED:      { bg: "#e8f5e9", fg: "#2e7d32" },
    FAILED:      { bg: "#ffebee", fg: "#c62828" },
  };
  const c = colors[code] ?? colors.DRAFT;
  return {
    display: "inline-block", padding: "1px 6px", borderRadius: 8,
    background: c.bg, color: c.fg,
    fontSize: 9, fontWeight: 700, flexShrink: 0,
  };
}

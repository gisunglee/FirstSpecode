"use client";

/**
 * DocumentLibraryPage — 문서실 (도움창고 > 문서실)
 *
 * 역할:
 *   - 프로젝트의 요건정의서(요구사항 단위) / 프로그램 사양서(단위업무 단위) 를 한 화면에서 일람
 *   - 행별 [Word ↓] 버튼으로 개별 .docx 다운로드 (현재 작업본)
 *   - 체크박스 + [선택 zip 다운로드] 로 일괄 zip 다운로드
 *
 * 권한 (UI 단):
 *   - 진입 / 목록 조회 — 모든 멤버 (content.read)
 *   - 다운로드 버튼 — content.export (MEMBER 이상). VIEWER 는 버튼 숨김
 *   - 시스템 관리자 지원 세션은 다운로드 API 측에서 자동 차단되므로 UI 단 추가 분기 없음
 *
 * 데이터 흐름:
 *   - GET /api/projects/[id]/requirements      — 요구사항 평면 목록
 *   - GET /api/projects/[id]/unit-works        — 단위업무 평면 목록
 *   - GET /api/projects/[id]/requirements/[reqId]/export/docx       — 개별 요건정의서
 *   - GET /api/projects/[id]/unit-works/[uwId]/export/docx          — 개별 프로그램사양서
 *   - POST /api/projects/[id]/document-library/zip                  — 일괄 zip
 */

import { Suspense, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { usePermissions } from "@/hooks/useMyRole";
import { buildDocxFilename, filenameSafe } from "@/lib/exports/filename";
import {
  PROJECT_ARTIFACTS,
  type ProjectArtifact, type ArtifactFormatSpec,
} from "@/lib/exports/project-artifacts";
import ArtifactOptionsDialog from "@/components/common/ArtifactOptionsDialog";
import ReleaseHistoryDialog from "@/components/documents/ReleaseHistoryDialog";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type RequirementRow = {
  requirementId:    string;
  displayId:        string;
  name:             string;
  priority:         string;
  source:           string;
  taskName:         string;
  assignMemberName: string | null;
  unitWorkCount:    number;
};

type UnitWorkRow = {
  unitWorkId:       string;
  displayId:        string;
  name:             string;
  reqDisplayId:     string;
  reqName:          string;
  assignMemberName: string | null;
  progress:         number;
  screenCount:      number;
};

const PRIORITY_LABEL: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DocumentLibraryPage() {
  return (
    <Suspense fallback={null}>
      <DocumentLibraryInner />
    </Suspense>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function DocumentLibraryInner() {
  const { id: projectId } = useParams<{ id: string }>();
  const { has: hasPerm } = usePermissions(projectId);

  // 출력 권한 — VIEWER 면 버튼 숨김. content.export 는 MEMBER 이상.
  const canExport = hasPerm("content.export");

  // ── 데이터 조회 ──
  const { data: reqRaw, isLoading: reqLoading } = useQuery({
    queryKey: ["doc-library-reqs", projectId],
    queryFn: () =>
      authFetch<{ data: { items: RequirementRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: uwRaw, isLoading: uwLoading } = useQuery({
    queryKey: ["doc-library-uws", projectId],
    queryFn: () =>
      authFetch<{ data: { items: UnitWorkRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/unit-works`
      ).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // 프로젝트명 — 카드 다운로드 시 fallback 파일명에 사용 (서버 disposition 가 우선)
  const { data: projectMeta } = useQuery({
    queryKey: ["doc-library-project", projectId],
    queryFn: () =>
      authFetch<{ data: { project: { prjctNm?: string; name?: string } } }>(
        `/api/projects/${projectId}`
      ).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const projectName =
    filenameSafe(projectMeta?.project?.prjctNm ?? projectMeta?.project?.name) || "프로젝트";

  const requirements = reqRaw?.items ?? [];
  const unitWorks    = uwRaw?.items  ?? [];

  // ── 검색 필터 ──
  const [reqSearch, setReqSearch] = useState("");
  const [uwSearch,  setUwSearch]  = useState("");

  const filteredRequirements = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter((r) =>
      r.displayId.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q)
    );
  }, [requirements, reqSearch]);

  const filteredUnitWorks = useMemo(() => {
    const q = uwSearch.trim().toLowerCase();
    if (!q) return unitWorks;
    return unitWorks.filter((u) =>
      u.displayId.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.reqDisplayId.toLowerCase().includes(q)
    );
  }, [unitWorks, uwSearch]);

  // ── 선택 상태 ──
  // 검색 필터를 바꿔도 선택 상태는 유지 — 검색은 표시 필터일 뿐 선택 해제 의미 X
  const [selectedReqIds, setSelectedReqIds] = useState<Set<string>>(new Set());
  const [selectedUwIds,  setSelectedUwIds]  = useState<Set<string>>(new Set());

  function toggleReq(id: string) {
    setSelectedReqIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleUw(id: string) {
    setSelectedUwIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // 현재 보이는 항목(필터 후) 전체 선택/해제 — 다른 페이지의 항목은 건드리지 않는다.
  const allReqVisibleSelected = filteredRequirements.length > 0 &&
    filteredRequirements.every((r) => selectedReqIds.has(r.requirementId));
  const allUwVisibleSelected  = filteredUnitWorks.length > 0 &&
    filteredUnitWorks.every((u) => selectedUwIds.has(u.unitWorkId));

  function toggleAllReq() {
    setSelectedReqIds((prev) => {
      const next = new Set(prev);
      if (allReqVisibleSelected) {
        filteredRequirements.forEach((r) => next.delete(r.requirementId));
      } else {
        filteredRequirements.forEach((r) => next.add(r.requirementId));
      }
      return next;
    });
  }
  function toggleAllUw() {
    setSelectedUwIds((prev) => {
      const next = new Set(prev);
      if (allUwVisibleSelected) {
        filteredUnitWorks.forEach((u) => next.delete(u.unitWorkId));
      } else {
        filteredUnitWorks.forEach((u) => next.add(u.unitWorkId));
      }
      return next;
    });
  }

  const totalSelected = selectedReqIds.size + selectedUwIds.size;

  // ── 개별 다운로드 ─────────────────────────────────────────────────────────
  // 요구사항/단위업무 상세 페이지의 handleExportDocx 패턴과 동일.
  const [singleBusyId, setSingleBusyId] = useState<string | null>(null);

  async function downloadSingle(
    kind: "REQ" | "UW",
    id: string,
    fallbackName: string,
  ) {
    const at = typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

    const url = kind === "REQ"
      ? `/api/projects/${projectId}/requirements/${id}/export/docx`
      : `/api/projects/${projectId}/unit-works/${id}/export/docx`;

    setSingleBusyId(`${kind}:${id}`);
    try {
      const res = await fetch(url, { headers: at ? { Authorization: `Bearer ${at}` } : {} });
      if (!res.ok) {
        let msg = `요청 실패 (${res.status})`;
        try { const err = await res.json(); if (err?.message) msg = err.message; }
        catch { /* JSON 아니면 기본 메시지 */ }
        toast.error(msg);
        return;
      }

      // 서버가 RFC 5987 인코딩된 한글 파일명을 보냄
      const disposition = res.headers.get("content-disposition") ?? "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = m ? decodeURIComponent(m[1]) : fallbackName;

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Word 파일이 다운로드되었습니다.");
    } catch {
      toast.error("Word 파일 생성에 실패했습니다.");
    } finally {
      setSingleBusyId(null);
    }
  }

  // ── 프로젝트 산출물 카드 다운로드 ─────────────────────────────────────────
  // 한 카드 = 1 산출물. 산출물은 여러 출력 형식(formats: docx/xlsx) 을 가질 수 있고,
  // 카드 안에 형식별 버튼이 노출된다.
  //
  // 흐름:
  //   - enabled=false        → "준비 중" 토스트
  //   - options 있음          → 옵션 다이얼로그 오픈 (해당 형식 정보를 같이 보관)
  //   - options 없음          → 즉시 다운로드
  //
  // busy 키는 "{artifactKey}:{formatType}" 형태 — 같은 산출물의 다른 형식이 동시에
  // 진행 중일 때 각각 비활성 표시 가능.
  const [artifactBusyKey, setArtifactBusyKey] = useState<string | null>(null);
  const [pendingArtifact, setPendingArtifact] = useState<{
    artifact: ProjectArtifact;
    format:   ArtifactFormatSpec;
  } | null>(null);
  // 발행 이력 다이얼로그 — 카드 [이력] 버튼에서 열림.
  // historyDocKind 가 정의된 산출물만 이력 시스템 연결됨.
  const [historyArtifact, setHistoryArtifact] = useState<ProjectArtifact | null>(null);

  // 카드 안의 형식 버튼 onClick — 옵션 유무에 따라 분기
  function onArtifactFormatClick(artifact: ProjectArtifact, format: ArtifactFormatSpec) {
    if (!artifact.enabled) {
      toast.message("준비 중입니다.", { description: artifact.title });
      return;
    }
    if (artifact.options && artifact.options.length > 0) {
      setPendingArtifact({ artifact, format });
      return;
    }
    runArtifactDownload(artifact, format, {});
  }

  // 다이얼로그 [다운로드] 확정 — 보관된 형식 + 선택된 옵션으로 다운로드
  function onArtifactOptionsConfirm(values: Record<string, boolean>) {
    if (!pendingArtifact) return;
    const { artifact, format } = pendingArtifact;
    setPendingArtifact(null);
    runArtifactDownload(artifact, format, values);
  }

  async function runArtifactDownload(
    artifact: ProjectArtifact,
    format:   ArtifactFormatSpec,
    options:  Record<string, boolean>,
  ) {
    const at = typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

    const queryString = Object.keys(options).length > 0
      ? "?" + new URLSearchParams(
          Object.entries(options).map(([k, v]) => [k, String(v)])
        ).toString()
      : "";

    const busyKey = `${artifact.key}:${format.type}`;
    setArtifactBusyKey(busyKey);
    try {
      const res = await fetch(format.apiPath(projectId) + queryString, {
        headers: at ? { Authorization: `Bearer ${at}` } : {},
      });
      if (!res.ok) {
        let msg = `요청 실패 (${res.status})`;
        try { const err = await res.json(); if (err?.message) msg = err.message; }
        catch { /* ignore */ }
        toast.error(msg);
        return;
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = m
        ? decodeURIComponent(m[1])
        : format.fallbackFilename(projectName);

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${artifact.title} (${format.type.toUpperCase()}) 다운로드 완료`);
    } catch {
      toast.error(`${artifact.title} 생성에 실패했습니다.`);
    } finally {
      setArtifactBusyKey(null);
    }
  }

  // ── 일괄 zip 다운로드 ─────────────────────────────────────────────────────
  const [zipBusy, setZipBusy] = useState(false);

  async function downloadZip() {
    if (totalSelected === 0) {
      toast.error("다운로드할 항목을 1개 이상 선택해 주세요.");
      return;
    }

    const at = typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

    setZipBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/document-library/zip`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            ...(at ? { Authorization: `Bearer ${at}` } : {}),
          },
          body: JSON.stringify({
            reqIds:      Array.from(selectedReqIds),
            unitWorkIds: Array.from(selectedUwIds),
          }),
        },
      );

      if (!res.ok) {
        let msg = `요청 실패 (${res.status})`;
        try { const err = await res.json(); if (err?.message) msg = err.message; }
        catch { /* ignore */ }
        toast.error(msg);
        return;
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = m ? decodeURIComponent(m[1]) : `문서실_${new Date().toISOString().slice(0, 10)}.zip`;

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${totalSelected}건이 zip으로 다운로드되었습니다.`);
    } catch {
      toast.error("ZIP 다운로드에 실패했습니다.");
    } finally {
      setZipBusy(false);
    }
  }

  // ── 렌더링 ────────────────────────────────────────────────────────────────
  const isLoading = reqLoading || uwLoading;
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={headerBarStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            문서실
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            요건정의서·프로그램사양서를 일람하고 한꺼번에 내려받습니다.
          </div>
        </div>
        {canExport && (
          <button
            onClick={downloadZip}
            disabled={zipBusy || totalSelected === 0}
            style={{
              ...primaryBtnStyle,
              opacity:    zipBusy || totalSelected === 0 ? 0.5 : 1,
              cursor:     zipBusy ? "wait" : (totalSelected === 0 ? "not-allowed" : "pointer"),
            }}
            title={totalSelected === 0 ? "선택된 항목이 없습니다." : `${totalSelected}건을 zip으로 다운로드`}
          >
            {zipBusy ? "ZIP 생성 중..." : `선택 ZIP 다운로드 (${totalSelected})`}
          </button>
        )}
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* ═══ 프로젝트 산출물 (단일 파일 다운로드) ═══════════════════════ */}
        <section>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
            프로젝트 산출물
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            프로젝트 전체를 한 파일로 받습니다. 각 카드를 클릭하면 즉시 다운로드됩니다.
          </div>
          <div style={artifactGridStyle}>
            {PROJECT_ARTIFACTS.map((art) => {
              const disabled    = !art.enabled;
              const cardOpacity = disabled ? 0.6 : 1;
              return (
                <div key={art.key} style={{ ...artifactCardStyle, opacity: cardOpacity }}>
                  {/* 상단 — 아이콘 + 제목/설명 (가로 배치, 카드 폭 가득) */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{art.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {art.title}
                        {disabled && <span style={badgeStyle}>준비 중</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                        {art.description}
                      </div>
                    </div>
                  </div>

                  {/* 하단 — 안내문 + 형식별 버튼들 (카드 폭 가득, 좌우 분리) */}
                  {canExport && (
                    <div style={cardFooterStyle}>
                      {/* 좌측 안내 — historyDocKind 가 있는 산출물만 (발행 시스템 연결됨) */}
                      <span style={cardHintStyle}>
                        {art.historyDocKind
                          ? "Word·Excel = 최신본 / 이력 = 발행본"
                          : "최신본 다운로드"}
                      </span>
                      {/* 우측 버튼 그룹 */}
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {art.formats.map((fmt) => {
                          const busyKey = `${art.key}:${fmt.type}`;
                          const busy    = artifactBusyKey === busyKey;
                          return (
                            <button
                              key={fmt.type}
                              onClick={() => onArtifactFormatClick(art, fmt)}
                              disabled={busy || disabled}
                              style={{
                                ...formatBtnStyle,
                                opacity: busy || disabled ? 0.5 : 1,
                                cursor:  busy ? "wait" : (disabled ? "not-allowed" : "pointer"),
                              }}
                              title={
                                disabled ? `${art.title} — 준비 중` :
                                busy     ? "생성 중..." :
                                `${art.title} ${fmt.type.toUpperCase()} — 현재 시점 최신본 다운로드`
                              }
                            >
                              {busy ? "..." : fmt.label}
                            </button>
                          );
                        })}
                        {/* 발행 이력 진입 — historyDocKind 있는 산출물만 */}
                        {art.historyDocKind && (
                          <button
                            onClick={() => setHistoryArtifact(art)}
                            disabled={disabled}
                            style={{
                              ...formatBtnStyle,
                              opacity: disabled ? 0.5 : 1,
                              cursor:  disabled ? "not-allowed" : "pointer",
                            }}
                            title="발행 이력 — 박제된 시점의 발행본 다운로드"
                          >
                            이력
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ═══ 요건정의서 (요구사항) ═══════════════════════════════════ */}
        <section>
          <SectionHeader
            title="요건정의서"
            count={requirements.length}
            filteredCount={filteredRequirements.length}
            search={reqSearch}
            onSearchChange={setReqSearch}
            placeholder="ID 또는 요구사항명 검색..."
          />

          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 행 */}
            <div style={reqGridHeaderStyle}>
              <div style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allReqVisibleSelected}
                  onChange={toggleAllReq}
                  disabled={filteredRequirements.length === 0}
                  aria-label="현재 보이는 요구사항 전체 선택"
                />
              </div>
              <div>요구사항 ID</div>
              <div>요구사항명</div>
              <div style={{ textAlign: "center" }}>우선순위</div>
              <div>담당자</div>
              <div style={{ textAlign: "center" }}>단위업무</div>
              <div style={{ textAlign: "center" }}>다운로드</div>
            </div>

            {filteredRequirements.length === 0 ? (
              <div style={emptyStyle}>
                {requirements.length === 0
                  ? "등록된 요구사항이 없습니다."
                  : "검색 결과가 없습니다."}
              </div>
            ) : (
              filteredRequirements.map((r) => {
                const busy = singleBusyId === `REQ:${r.requirementId}`;
                const checked = selectedReqIds.has(r.requirementId);
                return (
                  <div key={r.requirementId} style={reqGridRowStyle}>
                    <div style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReq(r.requirementId)}
                        aria-label={`${r.displayId} 선택`}
                      />
                    </div>
                    <div style={idCellStyle}>{r.displayId}</div>
                    <div style={nameCellStyle} title={r.name}>{r.name || "(이름 미지정)"}</div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {PRIORITY_LABEL[r.priority] ?? r.priority}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.assignMemberName ?? "-"}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {r.unitWorkCount}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {canExport && (
                        <button
                          onClick={() =>
                            downloadSingle(
                              "REQ",
                              r.requirementId,
                              buildDocxFilename(r.displayId, r.name, "요구사항명세서"),
                            )
                          }
                          disabled={busy}
                          style={{ ...rowDownloadBtnStyle, opacity: busy ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}
                        >
                          {busy ? "..." : "Word ↓"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ═══ 프로그램 사양서 (단위업무) ═══════════════════════════════ */}
        <section>
          <SectionHeader
            title="프로그램 사양서"
            count={unitWorks.length}
            filteredCount={filteredUnitWorks.length}
            search={uwSearch}
            onSearchChange={setUwSearch}
            placeholder="ID / 단위업무명 / 상위 요구사항 ID 검색..."
          />

          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={uwGridHeaderStyle}>
              <div style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allUwVisibleSelected}
                  onChange={toggleAllUw}
                  disabled={filteredUnitWorks.length === 0}
                  aria-label="현재 보이는 단위업무 전체 선택"
                />
              </div>
              <div>단위업무 ID</div>
              <div>단위업무명</div>
              <div>상위 요구사항</div>
              <div>담당자</div>
              <div style={{ textAlign: "center" }}>진행률</div>
              <div style={{ textAlign: "center" }}>화면</div>
              <div style={{ textAlign: "center" }}>다운로드</div>
            </div>

            {filteredUnitWorks.length === 0 ? (
              <div style={emptyStyle}>
                {unitWorks.length === 0
                  ? "등록된 단위업무가 없습니다."
                  : "검색 결과가 없습니다."}
              </div>
            ) : (
              filteredUnitWorks.map((u) => {
                const busy = singleBusyId === `UW:${u.unitWorkId}`;
                const checked = selectedUwIds.has(u.unitWorkId);
                return (
                  <div key={u.unitWorkId} style={uwGridRowStyle}>
                    <div style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUw(u.unitWorkId)}
                        aria-label={`${u.displayId} 선택`}
                      />
                    </div>
                    <div style={idCellStyle}>{u.displayId}</div>
                    <div style={nameCellStyle} title={u.name}>{u.name || "(이름 미지정)"}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${u.reqDisplayId} ${u.reqName}`}>
                      <span style={{ fontFamily: "monospace", marginRight: 6 }}>{u.reqDisplayId}</span>
                      {u.reqName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.assignMemberName ?? "-"}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {u.progress}%
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {u.screenCount}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {canExport && (
                        <button
                          onClick={() =>
                            downloadSingle(
                              "UW",
                              u.unitWorkId,
                              buildDocxFilename(u.displayId, u.name, "프로그램사양서"),
                            )
                          }
                          disabled={busy}
                          style={{ ...rowDownloadBtnStyle, opacity: busy ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}
                        >
                          {busy ? "..." : "Word ↓"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

      </div>

      {/* 산출물 옵션 다이얼로그 — 옵션이 정의된 산출물의 형식 버튼 클릭 시 열림. */}
      <ArtifactOptionsDialog
        open={!!pendingArtifact}
        artifact={pendingArtifact?.artifact ?? null}
        onClose={() => setPendingArtifact(null)}
        onConfirm={onArtifactOptionsConfirm}
      />

      {/* 발행 이력 다이얼로그 — historyDocKind 가 있는 산출물에 한해, [이력] 버튼에서 열림.
          refId 는 산출물별로 다르므로 historyDocKind 와 함께 결정한다.
          현재 카탈로그상 REQUIREMENTS_DEF 만 historyDocKind 가짐 → refId = projectId */}
      {historyArtifact?.historyDocKind && (
        <ReleaseHistoryDialog
          open={!!historyArtifact}
          onClose={() => setHistoryArtifact(null)}
          projectId={projectId}
          docKind={historyArtifact.historyDocKind}
          refId={projectId}
          refreshTag={0}
        />
      )}
    </div>
  );
}

// ── 섹션 헤더 (제목 + 건수 + 검색창) ─────────────────────────────────────────
function SectionHeader({
  title, count, filteredCount, search, onSearchChange, placeholder,
}: {
  title:          string;
  count:          number;
  filteredCount:  number;
  search:         string;
  onSearchChange: (v: string) => void;
  placeholder:    string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        {search.trim() ? `${filteredCount} / ${count}건` : `총 ${count}건`}
      </div>
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder}
        className="sp-input"
        style={{ width: 280, marginLeft: "auto" }}
      />
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const headerBarStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "10px 24px",
  background: "var(--color-bg-card)",
  borderBottom: "1px solid var(--color-border)",
  marginBottom: 16,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 18px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600,
};

const rowDownloadBtnStyle: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
};

// 프로젝트 산출물 카드 그리드 — auto-fill 로 화면 폭에 따라 1~3열 자동 조정.
// minmax 320px: 세로 2단 카드(상단 아이콘+제목 / 하단 안내+버튼 3개) 가
// 줄바꿈 폭주 없이 들어가는 최소 폭.
const artifactGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: 12,
};

// 카드 — 세로 2단 (상단: 아이콘+제목/설명, 하단: 안내+버튼)
// 좁은 카드 폭에서도 제목이 줄바꿈 폭주하지 않도록 가로 배치 대신 세로 배치 채택.
const artifactCardStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 12,
  padding: "14px 16px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
};

// 카드 하단 footer — 좌측 안내 / 우측 버튼 그룹 좌우 분리
const cardFooterStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 8,
  paddingTop: 8,
  borderTop: "1px solid var(--color-border-subtle, var(--color-border))",
};

// 좌측 안내문 — 작고 옅게, 줄바꿈 허용 (좁은 폭에서 두 줄 가능)
const cardHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary, var(--color-text-secondary))",
  lineHeight: 1.4,
  flex: 1,
  minWidth: 0,
};

// 카드 안 형식 버튼 (Word/Excel/...) — 작은 outline 톤
const formatBtnStyle: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

// "준비 중" 작은 배지 — 카드 제목 옆에 inline 으로 노출
const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 8,
  padding: "2px 6px",
  fontSize: 10, fontWeight: 700, lineHeight: 1.2,
  borderRadius: 4,
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  letterSpacing: "0.04em",
};

// 요구사항 표 그리드: 체크 / ID / 이름(가변) / 우선 / 담당 / UW수 / 다운로드
const REQ_GRID_TEMPLATE = "44px 110px 1fr 80px 130px 90px 110px";
// 단위업무 표 그리드: 체크 / ID / 이름(가변) / 상위RQ / 담당 / 진척 / 화면 / 다운로드
const UW_GRID_TEMPLATE  = "44px 110px 1fr 200px 130px 80px 70px 110px";

const reqGridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: REQ_GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};
const reqGridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: REQ_GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", alignItems: "center",
  background: "var(--color-bg-card)",
  borderTop: "1px solid var(--color-border)",
};

const uwGridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: UW_GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};
const uwGridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: UW_GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", alignItems: "center",
  background: "var(--color-bg-card)",
  borderTop: "1px solid var(--color-border)",
};

const idCellStyle: React.CSSProperties = {
  fontFamily: "monospace", fontSize: 12, color: "var(--color-text-primary)",
};
const nameCellStyle: React.CSSProperties = {
  fontSize: 13, color: "var(--color-text-primary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const emptyStyle: React.CSSProperties = {
  padding: "48px 0", textAlign: "center", color: "#aaa", fontSize: 13,
};

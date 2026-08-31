"use client";

/**
 * MemoDetailPanel — 메모 상세/편집/신규 CRUD 본체
 *
 * 역할:
 *   - memoId="new" → 신규 작성 모드. 웹/엑셀 작성 방식을 먼저 선택(이후 불변)
 *   - 기존 메모 → 조회 + 편집 모드 (본인 메모, 또는 공개범위가 TEAM_EDIT인 경우 프로젝트 멤버 누구나)
 *   - WEB: RichEditor(이미지 업로드 지원) / EXCEL: Fortune-sheet(MemoSheetEditor)
 *   - 공개범위(나만보기/전체조회/전체수정) 변경은 작성자만 가능
 *
 * 전체 페이지(/memos/[memoId])와 팝업(MemoPopover) 양쪽에서 그대로 재사용한다 —
 * 저장/삭제 이후 "어디로 갈지"만 onSaved/onDeleted/onBack 콜백으로 호출부가 결정한다
 * (페이지는 라우팅, 팝업은 목록 뷰로 전환).
 */

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { checkMemoSheetSize } from "@/lib/memoSheetLimits";
import dynamic from "next/dynamic";
import type { Sheet } from "@fortune-sheet/core";
import type { MemoSheetEditorHandle } from "@/components/ui/MemoSheetEditor";
// TipTap/Fortune-sheet 번들이 초기 로드에 포함되지 않도록 dynamic import
const RichEditor      = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });
const MemoSheetEditor  = dynamic(() => import("@/components/ui/MemoSheetEditor"), { ssr: false });

type MemoDetail = {
  memoId:        string;
  subject:       string;
  content:       string;
  memoTyCode:    string;
  sheetData:     unknown;
  visbltyCode:   string;
  purposeCode:   string;
  refTyCode:     string | null;
  refId:         string | null;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  canEdit:       boolean;
  creatDt:       string;
  mdfcnDt:       string | null;
};

const REF_TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "요구사항",
  TASK:        "과업",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  AREA:        "영역",
  FUNCTION:    "기능",
};

const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: "PRIVATE",   label: "나만보기" },
  { value: "TEAM_READ", label: "전체조회" },
  { value: "TEAM_EDIT", label: "전체수정" },
];

const PURPOSE_OPTIONS: { value: string; label: string }[] = [
  { value: "GENERAL", label: "메모" },
  { value: "MEETING", label: "회의록" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  projectId:      string;
  memoId:         string; // "new" 또는 실제 id
  presetRefType?: string;
  presetRefId?:   string;
  presetPurpose?: string; // 신규 작성 시 구분 기본값(예: "회의록" 메뉴에서 진입하면 "MEETING")
  onBack:         () => void;                     // 뒤로/취소
  onSaved?:       (savedMemoId: string) => void;   // 저장 성공 후
  onDeleted?:     () => void;                      // 삭제 성공 후
  // 팝업 임베드용 — 좁은 폭/작은 편집기 높이로 축소
  compact?:       boolean;
  sheetHeight?:   number;
  richMinHeight?: number;
  // compact일 때 헤더 타이틀 우측에 추가로 끼워 넣을 컨트롤(예: 모달의 크기조절/닫기 버튼).
  // 이렇게 하면 모달이 자기 컨트롤을 위해 별도 줄을 안 만들어도 돼서 세로 공간이 절약된다.
  headerExtra?:   React.ReactNode;
};

export default function MemoDetailPanel({
  projectId, memoId, presetRefType, presetRefId, presetPurpose,
  onBack, onSaved, onDeleted,
  // 풀페이지(비compact) 기본값 — 엑셀은 17행→25행 보이도록, 웹 에디터는 기존 대비
  // 두 배로 키워달라는 피드백 반영(compact/모달은 자기 폭·높이에 맞춰 별도로 계산해 넘김)
  compact = false, sheetHeight = 660, richMinHeight = 576, headerExtra,
}: Props) {
  const queryClient = useQueryClient();
  const isNew = memoId === "new";

  const [subject, setSubject]         = useState("");
  const [content, setContent]         = useState("");
  // sheetData는 편집기의 "초기값"으로만 쓰인다 — 편집 중 값을 여기로 되먹이면 Fortune-sheet가
  // 매 입력마다 재초기화되는 문제가 있어(스크롤 튐, 입력값 유실), 실제 저장 값은 저장 시점에
  // sheetEditorHandleRef.getData()로 직접 꺼낸다.
  const [sheetData, setSheetData]     = useState<Sheet[] | null>(null);
  // 기존 메모는 로딩 완료 직후~효과 실행 전 짧은 한 틱 동안 이 값이 관찰될 수 있어
  // "WEB" 같은 임시 기본값을 주면 안 됨 — MemoSheetEditor가 그 순간 잘못된(빈) 값으로
  // 마운트되면 이후 진짜 데이터가 와도 영구 고정 로직 때문에 절대 반영되지 않는 버그가
  // 있었음(실제 재현됨). null로 두면 그 한 틱 동안 콘텐츠 카드 자체가 안 그려지고,
  // 데이터가 준비된 후에야 처음으로 마운트되므로 항상 올바른 값으로 초기화된다.
  const [memoTyCode, setMemoTyCode]   = useState<"WEB" | "EXCEL" | null>(null);
  const [visbltyCode, setVisbltyCode] = useState("PRIVATE");
  const [purposeCode, setPurposeCode] = useState(
    presetPurpose === "MEETING" ? "MEETING" : "GENERAL",
  );
  const [refTyCode, setRefTyCode]     = useState<string | null>(presetRefType ?? null);
  // 제목/구분/공개범위 카드 접기 — 편집기(엑셀/웹) 영역을 넓게 쓰고 싶을 때 위쪽 메타 영역을
  // 접어둘 수 있게. compact(모달)는 이미 한 줄로 압축돼 있어 이 기능이 필요 없음(풀페이지 전용).
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const [refId, setRefId]             = useState<string | null>(presetRefId ?? null);
  // MemoSheetEditor가 마운트 후 onReady로 넘겨주는 핸들 — ref prop이 next/dynamic을
  // 거치며 제대로 안 붙는 문제가 있어 콜백 방식으로 받는다(MemoSheetEditor.tsx 주석 참고)
  const sheetEditorHandleRef = useRef<MemoSheetEditorHandle | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["memo", projectId, memoId],
    queryFn:  () =>
      authFetch<{ data: MemoDetail }>(`/api/projects/${projectId}/memos/${memoId}`).then((r) => r.data),
    enabled: !isNew,
  });

  useEffect(() => {
    if (data) {
      setSubject(data.subject);
      setContent(data.content);
      setSheetData(Array.isArray(data.sheetData) ? (data.sheetData as Sheet[]) : null);
      setMemoTyCode(data.memoTyCode === "EXCEL" ? "EXCEL" : "WEB");
      setVisbltyCode(data.visbltyCode);
      setPurposeCode(data.purposeCode);
      setRefTyCode(data.refTyCode);
      setRefId(data.refId);
    }
  }, [data]);

  // 편집 가능 여부 — 신규 작성 중이거나, 본인 메모, 또는 공개범위 TEAM_EDIT(전체수정)
  const canEdit = isNew || (data?.canEdit ?? false);
  // 공개범위 변경은 작성자만 — TEAM_EDIT로 들어온 타인은 내용만 고칠 수 있음
  const canChangeVisibility = isNew || (data?.isMine ?? false);

  const saveMutation = useMutation({
    mutationFn: (body: { subject: string; content?: string; sheetData?: Sheet[]; memoTyCode?: string; visbltyCode: string; purposeCode: string; refTyCode?: string; refId?: string }) =>
      isNew
        ? authFetch<{ data: { memoId: string } }>(`/api/projects/${projectId}/memos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : authFetch<{ data: { memoId: string } }>(`/api/projects/${projectId}/memos/${memoId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    onSuccess: (res) => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["memos", projectId] });
      queryClient.invalidateQueries({ queryKey: ["memos-popover", projectId] });
      queryClient.invalidateQueries({ queryKey: ["memos-count", projectId] });
      if (!isNew) queryClient.invalidateQueries({ queryKey: ["memo", projectId, memoId] });
      onSaved?.(res?.data?.memoId ?? memoId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/projects/${projectId}/memos/${memoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["memos", projectId] });
      queryClient.invalidateQueries({ queryKey: ["memos-popover", projectId] });
      queryClient.invalidateQueries({ queryKey: ["memos-count", projectId] });
      onDeleted?.();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function handleSave() {
    if (!subject.trim()) { toast.error("제목을 입력해 주세요."); return; }
    if (isNew && !memoTyCode) { toast.error("작성 방식을 선택해 주세요."); return; }
    const currentSheetData = memoTyCode === "EXCEL"
      ? await (sheetEditorHandleRef.current?.getData() ?? Promise.resolve(sheetData ?? []))
      : undefined;
    // 이미지가 base64로 그대로 DB에 들어가므로 너무 크면 저장 전에 막는다
    if (memoTyCode === "EXCEL") {
      const sizeCheck = checkMemoSheetSize(currentSheetData);
      if (!sizeCheck.ok) { toast.error(sizeCheck.message); return; }
    }
    saveMutation.mutate({
      subject: subject.trim(),
      visbltyCode,
      purposeCode,
      ...(isNew ? { memoTyCode: memoTyCode! } : {}),
      ...(memoTyCode === "WEB" ? { content } : {}),
      ...(memoTyCode === "EXCEL" ? { sheetData: currentSheetData } : {}),
      ...(refTyCode && refId ? { refTyCode, refId } : {}),
    });
  }

  function handleDelete() {
    if (!window.confirm("이 메모를 삭제하시겠습니까?")) return;
    deleteMutation.mutate();
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: compact ? "24px 16px" : "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        // compact도 sticky로 — headerExtra(모달의 크기조절/닫기 버튼)가 스크롤해서
        // 안 보이게 되면 안 되므로 항상 화면 상단에 고정
        padding: compact ? "8px 12px" : "10px 24px", position: "sticky", top: 0, zIndex: 10, minHeight: compact ? 40 : 52,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: compact ? 8 : 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* compact(모달)에서는 뒤로가기 화살표를 안 둠 — 모달 자체 닫기(✕)가 이미 있어서 중복 */}
          {!compact && (
            <button
              onClick={onBack}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
            >
              ←
            </button>
          )}
          <span style={{ fontSize: compact ? 13.5 : 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew
              ? (purposeCode === "MEETING" ? "새 회의록" : "새 메모")
              : (purposeCode === "MEETING" ? "회의록 상세" : "메모 상세")}
          </span>
        </div>

        {/* compact에서는 삭제·취소·저장을 아래 배지 줄로 옮기고, 여기엔 모달의 크기조절/닫기(headerExtra)만 놓는다 */}
        {compact ? headerExtra : canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isNew && (
              <button onClick={handleDelete} disabled={deleteMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", color: "#e53935", borderColor: "#e53935" }}>
                삭제
              </button>
            )}
            <button
              onClick={onBack}
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
            >
              {saveMutation.isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>

      {/* ── 본문 ── */}
      {/* 엑셀형은 툴바 아이콘이 "..." 뒤로 숨는 걸 줄이려면 폭이 더 필요해서 웹 에디터보다 넓게 잡음
          (compact=팝업 임베드일 땐 팝업 자체 폭에 맞추므로 이 확장을 하지 않음) */}
      <div style={{ padding: compact ? "0 12px 12px" : "4px 24px 48px", maxWidth: compact ? "none" : (memoTyCode === "EXCEL" ? 1400 : 960) }}>

        {/* compact(팝업/모달)에서는 메타+제목을 카드 하나로 합쳐서 공간 낭비를 줄인다 —
            카드 2개로 나누면 테두리·패딩·여백이 중복돼서 정작 편집기 영역이 좁아졌었음(실제 확인됨) */}
        {compact ? (
          <div style={{ ...contentCardStyle, padding: "10px 14px", marginBottom: 8 }}>
            {/* 배지/작성자 정보 + 삭제·취소·저장(요청으로 이 줄로 옮김) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--color-border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {data && (
                  <>
                    {data.purposeCode === "MEETING" && (
                      <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--color-success-subtle)", color: "var(--color-success)" }}>
                        회의록
                      </span>
                    )}
                    <span className="sp-badge" style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      ...(data.visbltyCode === "TEAM_EDIT"
                        ? { background: "var(--color-success-subtle)", color: "var(--color-success)" }
                        : data.visbltyCode === "TEAM_READ"
                        ? { background: "var(--color-info-subtle)", color: "var(--color-info)" }
                        : { background: "var(--color-bg-elevated)", color: "var(--color-text-tertiary)" }),
                    }}>
                      {VISIBILITY_OPTIONS.find((v) => v.value === data.visbltyCode)?.label ?? data.visbltyCode}
                    </span>
                    <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)" }}>
                      {data.memoTyCode === "EXCEL" ? "엑셀형" : "웹 에디터"}
                    </span>
                    {data.refTyCode && (
                      <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--color-info-subtle)", color: "var(--color-info)" }}>
                        {REF_TYPE_LABEL[data.refTyCode] ?? data.refTyCode}
                      </span>
                    )}
                    <span style={{ ...metaItemStyle, fontSize: 11 }}>{data.creatMberName} · {formatDate(data.creatDt)} · 조회 {data.viewCnt}</span>
                  </>
                )}
              </div>

              {canEdit && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {!isNew && (
                    <button onClick={handleDelete} disabled={deleteMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 11, padding: "4px 10px", color: "#e53935", borderColor: "#e53935" }}>
                      삭제
                    </button>
                  )}
                  <button onClick={onBack} style={{ ...secondaryBtnStyle, fontSize: 11, padding: "4px 10px" }}>
                    취소
                  </button>
                  <button onClick={handleSave} disabled={saveMutation.isPending} style={{ ...primaryBtnStyle, fontSize: 11, padding: "4px 10px" }}>
                    {saveMutation.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              )}
            </div>

            {/* 제목 + 공개범위를 한 줄에 — 제목 입력칸은 좁히고 오른쪽에 공개범위 배치 */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 260px", minWidth: 200 }}>
                <span style={{ ...cardLabelStyle, marginBottom: 0, flexShrink: 0 }}>제목</span>
                {canEdit ? (
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="메모 제목을 입력하세요"
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6,
                      border: "1px solid var(--color-border)", fontSize: 13, fontWeight: 400,
                      background: "var(--color-bg-card)", color: "var(--color-text-primary)",
                      boxSizing: "border-box", outline: "none",
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {subject || "(제목 없음)"}
                  </div>
                )}
              </div>

              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>구분</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {PURPOSE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setPurposeCode(o.value)}
                        className="sp-badge"
                        style={{
                          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid", cursor: "pointer",
                          ...(purposeCode === o.value
                            ? { background: "var(--color-success-subtle)", color: "var(--color-success)", borderColor: "var(--color-success-border)" }
                            : { background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {canChangeVisibility && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>공개범위</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {VISIBILITY_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setVisbltyCode(o.value)}
                        className="sp-badge"
                        style={{
                          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid", cursor: "pointer",
                          ...(visbltyCode === o.value
                            ? { background: "var(--color-success-subtle)", color: "var(--color-success)", borderColor: "var(--color-success-border)" }
                            : { background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        {/* ── 메타 카드 (기존 메모만 표시) ── */}
        {data && (
          <div style={titleCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* 구분 배지 */}
              {data.purposeCode === "MEETING" && (
                <span className="sp-badge" style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: "var(--color-success-subtle)", color: "var(--color-success)",
                }}>
                  회의록
                </span>
              )}

              {/* 공개범위 배지 */}
              <span className="sp-badge" style={{
                display: "inline-flex", alignItems: "center",
                padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                ...(data.visbltyCode === "TEAM_EDIT"
                  ? { background: "var(--color-success-subtle)", color: "var(--color-success)" }
                  : data.visbltyCode === "TEAM_READ"
                  ? { background: "var(--color-info-subtle)", color: "var(--color-info)" }
                  : { background: "var(--color-bg-elevated)", color: "var(--color-text-tertiary)" }),
              }}>
                {VISIBILITY_OPTIONS.find((v) => v.value === data.visbltyCode)?.label ?? data.visbltyCode}
              </span>

              {/* 작성 방식 배지 */}
              <span className="sp-badge" style={{
                display: "inline-flex", alignItems: "center",
                padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)",
              }}>
                {data.memoTyCode === "EXCEL" ? "엑셀형" : "웹 에디터"}
              </span>

              {/* 연결 대상 배지 */}
              {data.refTyCode && (
                <span className="sp-badge" style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: "var(--color-info-subtle)", color: "var(--color-info)",
                }}>
                  {REF_TYPE_LABEL[data.refTyCode] ?? data.refTyCode}
                </span>
              )}

              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>작성자 <strong style={metaValueStyle}>{data.creatMberName}</strong></span>
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>{formatDate(data.creatDt)} 작성</span>
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>조회 {data.viewCnt}</span>
            </div>
          </div>
        )}

        {/* ── 제목 카드 — 접기 가능(편집기 영역을 넓게 쓰고 싶을 때) ── */}
        <div style={contentCardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: metaCollapsed ? 0 : 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ ...cardLabelStyle, marginBottom: 0 }}>제목</span>
              {metaCollapsed && (
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {subject || "(제목 없음)"}
                </span>
              )}
            </div>
            <button
              onClick={() => setMetaCollapsed((v) => !v)}
              style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 11, textDecoration: "underline" }}
            >
              {metaCollapsed ? "펼치기 ▾" : "접기 ▴"}
            </button>
          </div>

          {!metaCollapsed && (
          <>
          {canEdit ? (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="메모 제목을 입력하세요"
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 6,
                border: "1px solid var(--color-border)", fontSize: 14, fontWeight: 400,
                background: "var(--color-bg-card)", color: "var(--color-text-primary)",
                boxSizing: "border-box", outline: "none",
              }}
            />
          ) : (
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {subject || "(제목 없음)"}
            </div>
          )}

          {/* 구분 선택 — 공개범위와 달리 권한 확장 문제가 없어 편집 가능한 사람 누구나 변경 가능 */}
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>구분</span>
              <div style={{ display: "flex", gap: 4 }}>
                {PURPOSE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setPurposeCode(o.value)}
                    className="sp-badge"
                    style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                      border: "1px solid", cursor: "pointer",
                      ...(purposeCode === o.value
                        ? { background: "var(--color-success-subtle)", color: "var(--color-success)", borderColor: "var(--color-success-border)" }
                        : { background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 공개범위 선택 — 작성자만 변경 가능(TEAM_EDIT로 들어온 타인은 내용만 수정) */}
          {canChangeVisibility && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>공개범위</span>
              <div style={{ display: "flex", gap: 4 }}>
                {VISIBILITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setVisbltyCode(o.value)}
                    className="sp-badge"
                    style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                      border: "1px solid", cursor: "pointer",
                      ...(visbltyCode === o.value
                        ? { background: "var(--color-success-subtle)", color: "var(--color-success)", borderColor: "var(--color-success-border)" }
                        : { background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          </>
          )}
        </div>
        </>
        )}

        {/* ── 작성 방식 선택 (신규 작성 시에만, 이후 불변) ── */}
        {isNew && !memoTyCode && (
          <div style={compact ? { ...contentCardStyle, padding: "12px 14px" } : contentCardStyle}>
            <div style={cardLabelStyle}>작성 방식</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                onClick={() => setMemoTyCode("WEB")}
                style={{ padding: "16px 12px", borderRadius: 10, border: "1.5px solid var(--color-border)", background: "var(--color-bg-card)", cursor: "pointer", textAlign: "center" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>웹 에디터</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>본문에 자연스럽게 글 작성</div>
              </button>
              <button
                onClick={() => setMemoTyCode("EXCEL")}
                style={{ padding: "16px 12px", borderRadius: 10, border: "1.5px solid var(--color-border)", background: "var(--color-bg-card)", cursor: "pointer", textAlign: "center" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>엑셀형 표</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>표·붙여넣기 위주 자료 정리</div>
              </button>
            </div>
          </div>
        )}

        {/* ── 내용 카드 ── */}
        {memoTyCode && (
          <div style={compact ? { ...contentCardStyle, padding: "10px 12px", marginBottom: 0 } : contentCardStyle}>
            {/* compact에선 "내용" 레이블 생략 — 바로 밑이 편집기라 안 봐도 뻔함(피드백 반영).
                단, 신규 작성 중 "방식 다시 선택" 버튼은 필요해서 그 경우엔 줄을 유지 */}
            {compact ? (
              isNew && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setMemoTyCode(null)}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 11, textDecoration: "underline", marginBottom: 6 }}
                  >
                    방식 다시 선택
                  </button>
                </div>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={cardLabelStyle}>내용</div>
                {isNew && (
                  <button
                    onClick={() => setMemoTyCode(null)}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 11, textDecoration: "underline", marginBottom: 14 }}
                  >
                    방식 다시 선택
                  </button>
                )}
              </div>
            )}
            {memoTyCode === "WEB" ? (
              <RichEditor
                value={content}
                onChange={setContent}
                placeholder="메모 내용을 작성하세요..."
                minHeight={richMinHeight}
                readOnly={!canEdit}
              />
            ) : (
              <MemoSheetEditor
                initialValue={sheetData}
                readOnly={!canEdit}
                height={sheetHeight}
                onReady={(h) => { sheetEditorHandleRef.current = h; }}
              />
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const titleCardStyle: React.CSSProperties = {
  padding: "20px 24px",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
  marginBottom: 12,
};

const contentCardStyle: React.CSSProperties = {
  padding: "20px 24px",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  marginBottom: 12,
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
  textTransform: "uppercase", color: "var(--color-text-secondary)",
  marginBottom: 14,
};

const metaItemStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--color-text-secondary)",
};

const metaValueStyle: React.CSSProperties = {
  fontWeight: 600, color: "var(--color-text-primary)",
};

const metaSepStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--color-border)", userSelect: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-brand)", color: "var(--color-text-inverse)",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};

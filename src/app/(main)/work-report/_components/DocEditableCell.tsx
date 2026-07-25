"use client";

/**
 * DocEditableCell — "한글 문서에 바로 쓰는" 느낌의 클릭-편집 셀
 *
 * 평소엔 일반 텍스트처럼 보이다가(테두리·버튼 없음), 클릭하면 그 자리에서 바로
 * textarea로 바뀌어 타이핑할 수 있고, blur 되면 바뀐 내용만 저장한다. 별도의
 * "편집 모드"/"저장" 버튼이 없는 이유 — 셀마다 버튼이 붙으면 문서 전체가 다시
 * 업무일지 카드처럼 번잡해 보인다는 게 지난 피드백의 핵심이었다.
 *
 * 높이는 minRows 기준 고정이다(2026-07-24) — 원래는 입력한 내용에 맞춰 늘어나는
 * auto-grow였는데, 입력이 없을 때 박스가 낮게 있다가 타이핑할 때마다 즉시 커지는
 * 움직임이 "정신없다"는 피드백이 있었다. 고정 높이를 넘는 내용은 내부 스크롤로 처리한다.
 *
 * ref로 commit()을 외부에 노출한다(2026-07-24) — blur에 의존한 자동저장만으로는
 * "진짜 저장된 게 맞는지" 확신이 안 든다는 피드백이 있었다. 리더 리포트처럼 필드가 여럿인
 * 화면에서 상위 컴포넌트가 "저장" 버튼 하나로 편집 중인 모든 셀을 한 번에 커밋시킬 수 있게
 * 한다(포커스가 없는 셀은 이미 저장된 상태라 commit()을 불러도 값이 그대로라 아무 일도 안 함).
 *
 * fill 옵션 추가(2026-07-25) — 세부 업무계획의 "결과" 열은 옆 "계획" 열(체크리스트+입력)이
 * 더 길어서 td가 이미 늘어나 있는데, 정작 이 칸은 고정 높이(minRows*rowHeightPx)만큼만
 * 차지해 td 안에 빈 공간이 남는다는 피드백. fill이면 minRows*rowHeightPx를 최소 높이로만
 * 쓰고, 실제 높이는 100%로 td(행) 높이에 맞춘다 — 표 셀은 퍼센트 높이가 행 높이 기준으로
 * 계산되는 CSS의 특례 덕분에 별도 flex 래퍼 없이도 그대로 동작한다.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 한 행당 높이(px) 기본값 — minRows와 곱해 고정 박스 높이를 정한다.
// work-report의 WeeklyDocView는 표(<td>) 안에 촘촘하게 들어가는 셀이라 이 기본값을 그대로 쓰고,
// 리더 리포트처럼 여유 있게 써야 하는 화면은 rowHeightPx prop으로 개별 조정한다(2026-07-24,
// "박스가 낮다"는 피드백이 리더 리포트에만 해당돼 전역 상수를 올리면 표 레이아웃이 깨졌다).
const DEFAULT_ROW_HEIGHT_PX = 20;

// AI 피드백(금주실적/차주계획/총평)은 "## 제목" + 불릿으로 온 마크다운이라, 보기 상태에서는
// 원문 그대로("## 금주실적") 보이는 것보다 실제 제목/리스트로 렌더링하는 쪽이 훨씬 읽기 편하다.
// 편집 중(textarea)에는 당연히 원문 마크다운을 그대로 고친다.
const MD_H2: React.CSSProperties = { fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)", margin: "10px 0 4px" };
const MD_P:  React.CSSProperties = { margin: "4px 0", lineHeight: 1.6 };
const MD_UL: React.CSSProperties = { margin: "4px 0", paddingLeft: 20, lineHeight: 1.6 };

// PM이 아닌 뷰어의 읽기 전용 표시(WeeklyDocView)에서도 재사용 — export.
export function AiFeedbackMarkdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => <h2 style={MD_H2}>{children}</h2>,
        p:  ({ children }) => <p style={MD_P}>{children}</p>,
        ul: ({ children }) => <ul style={MD_UL}>{children}</ul>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

export type DocEditableCellHandle = { commit: () => void };

const DocEditableCell = forwardRef<DocEditableCellHandle, {
  value:       string;
  placeholder: string;
  onSave:      (next: string) => void;
  minRows?:    number;
  /** 한 행당 높이(px). 화면마다 여유 있게/촘촘하게 다르게 쓰고 싶을 때 조정 */
  rowHeightPx?: number;
  /** true면 편집 중이 아닐 때 값을 마크다운으로 렌더링 (AI 피드백 전용) */
  markdown?:   boolean;
  /** true면 minRows*rowHeightPx를 최소 높이로만 쓰고 실제 높이는 td(행) 높이에 맞춘다 */
  fill?:       boolean;
}>(function DocEditableCell({
  value,
  placeholder,
  onSave,
  minRows = 2,
  rowHeightPx = DEFAULT_ROW_HEIGHT_PX,
  markdown = false,
  fill = false,
}, ref) {
  const boxStyle: CSSProperties = fill
    ? { height: "100%", minHeight: minRows * rowHeightPx, overflowY: "auto" }
    : { height: minRows * rowHeightPx, overflowY: "auto" };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // commit() 직후 서버 재조회가 끝나기 전까지 부모가 넘겨주는 value는 여전히 "저장 전" 값이다.
  // 그 stale 값으로 draft를 덮어써버리면 방금 입력한 내용이 잠깐(재조회가 끝날 때까지)
  // 사라졌다가 돌아오는 것처럼 보인다 — 저장 직후 한 번은 외부 value 동기화를 건너뛴다.
  const suppressNextSyncRef = useRef(false);

  useEffect(() => {
    if (editing) return;
    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      return;
    }
    setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed !== value.trim()) {
      suppressNextSyncRef.current = true;
      onSave(trimmed);
    }
  }

  // 편집 중이 아닐 때 commit()을 불러도 draft === value라 onSave는 안 나가고 조용히 끝난다 —
  // 그래서 상위의 "저장" 버튼이 모든 셀에 무조건 commit()을 걸어도 안전하다.
  useImperativeHandle(ref, () => ({ commit }));

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="sp-doc-textarea"
        rows={minRows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        style={boxStyle}
      />
    );
  }

  return (
    <div className="sp-doc-cell-editable" onClick={() => setEditing(true)} style={boxStyle}>
      {draft.trim() ? (
        markdown ? <AiFeedbackMarkdown value={draft} /> : <span style={{ whiteSpace: "pre-wrap" }}>{draft}</span>
      ) : (
        <span style={{ color: "var(--color-text-disabled)" }}>{placeholder}</span>
      )}
    </div>
  );
});

export default DocEditableCell;

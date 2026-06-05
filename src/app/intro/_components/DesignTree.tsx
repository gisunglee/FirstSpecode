/**
 * DesignTree — 설계 구조 탐색기 (단위업무 ▸ 화면 ▸ 영역 ▸ 기능)
 *
 * 역할 (원본 app.js의 인터랙티브 트리를 React로 포팅):
 *   - 게시판 예시 트리를 재귀 렌더링
 *   - 노드 클릭 시 펼침/접힘 토글 + 우측 상세 패널·상단 경로 갱신
 *   - 최초 진입 시 루트(게시판)를 펼치고 선택한 상태로 시작
 *
 * 원본은 DOM을 직접 생성했으나, 유지보수를 위해 선언적 React 컴포넌트 +
 * 상태(선택/펼침)로 재구성했다. 시각 결과는 동일하다.
 */

"use client";

import { useMemo, useState } from "react";

// ── 트리 노드 타입 ──────────────────────────────────────────────
type Level = 1 | 2 | 3 | 4;

// 원본 데이터(아직 id 미부여) — children도 동일하게 id가 없다
type RawNode = {
  name: string;
  kind: string;
  level: Level;
  desc: string;
  children?: RawNode[];
};

// id가 부여된 노드 — 렌더링에 사용
type TreeNode = {
  id: string;
  name: string;
  kind: string;
  level: Level;
  desc: string;
  children?: TreeNode[];
};

// 레벨별 메타 — badge 색 클래스(cls)와 한글 라벨(kc)
const KIND_META: Record<Level, { cls: string; kc: string }> = {
  1: { cls: "b1", kc: "단위업무" },
  2: { cls: "b2", kc: "화면" },
  3: { cls: "b3", kc: "영역" },
  4: { cls: "b4", kc: "기능" },
};

// ── 게시판 예시 데이터 (원본 동일) ─────────────────────────────
// id는 경로 기반으로 부여해 펼침/선택 상태의 안정적 키로 사용
const RAW_TREE: RawNode = {
  name: "게시판",
  kind: "단위업무",
  level: 1,
  desc: "공지·자료실처럼 하나의 의미 있는 업무 묶음입니다. 이 안에 여러 화면이 들어갑니다.",
  children: [
    {
      name: "게시판 목록",
      kind: "화면",
      level: 2,
      desc: "등록된 게시글을 한눈에 보여주는 화면입니다. 검색·페이징·정렬이 여기서 일어납니다.",
      children: [
        {
          name: "검색 영역",
          kind: "영역",
          level: 3,
          desc: "제목·내용·작성자 기준으로 글을 찾는 영역입니다.",
          children: [
            { name: "키워드 검색", kind: "기능", level: 4, desc: "입력한 키워드로 게시글을 필터링합니다." },
            { name: "기간 검색", kind: "기능", level: 4, desc: "작성일 범위로 게시글을 필터링합니다." },
          ],
        },
        {
          name: "목록 영역",
          kind: "영역",
          level: 3,
          desc: "검색 결과를 표 형태로 출력하는 영역입니다.",
          children: [
            { name: "페이징", kind: "기능", level: 4, desc: "결과를 페이지 단위로 나눠 이동합니다." },
            { name: "컬럼 정렬", kind: "기능", level: 4, desc: "제목·작성일 등 컬럼 기준으로 정렬합니다." },
          ],
        },
      ],
    },
    {
      name: "게시판 상세",
      kind: "화면",
      level: 2,
      desc: "선택한 게시글의 본문과 첨부, 댓글을 보여주는 화면입니다.",
      children: [
        {
          name: "본문 영역",
          kind: "영역",
          level: 3,
          desc: "제목·작성자·본문·첨부파일을 출력하는 영역입니다.",
          children: [
            { name: "첨부 다운로드", kind: "기능", level: 4, desc: "첨부파일을 내려받습니다." },
            { name: "조회수 증가", kind: "기능", level: 4, desc: "상세 진입 시 조회수를 1 올립니다." },
          ],
        },
        {
          name: "댓글 영역",
          kind: "영역",
          level: 3,
          desc: "댓글을 보고 달 수 있는 영역입니다.",
          children: [{ name: "댓글 등록", kind: "기능", level: 4, desc: "본문에 대한 댓글을 작성합니다." }],
        },
      ],
    },
    {
      name: "게시판 등록",
      kind: "화면",
      level: 2,
      desc: "새 글을 작성하거나 기존 글을 수정하는 화면입니다.",
      children: [
        {
          name: "입력 영역",
          kind: "영역",
          level: 3,
          desc: "제목·본문·첨부를 입력하는 영역입니다.",
          children: [
            { name: "임시 저장", kind: "기능", level: 4, desc: "작성 중인 내용을 임시로 보관합니다." },
            { name: "유효성 검사", kind: "기능", level: 4, desc: "필수값 누락·형식 오류를 검증합니다." },
            { name: "등록/수정", kind: "기능", level: 4, desc: "작성한 글을 저장합니다." },
          ],
        },
      ],
    },
  ],
};

// 경로 기반 id 부여 (재귀)
function withIds(node: RawNode, path: string): TreeNode {
  return {
    ...node,
    id: path,
    children: node.children?.map((c, i) => withIds(c, `${path}.${i}`)),
  };
}

// ── 단일 노드(재귀) ─────────────────────────────────────────────
function TreeRow({
  node,
  openIds,
  selectedId,
  onToggleSelect,
}: {
  node: TreeNode;
  openIds: Set<string>;
  selectedId: string;
  onToggleSelect: (node: TreeNode) => void;
}) {
  const meta = KIND_META[node.level];
  const hasKids = !!node.children?.length;
  const isOpen = openIds.has(node.id);
  const isSel = selectedId === node.id;

  return (
    <div className={`node-row${isOpen ? " open" : ""}`}>
      <div
        className={`node-self${isOpen ? " open" : ""}${isSel ? " sel" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(node);
        }}
      >
        <span className="tw">{hasKids ? "▶" : "·"}</span>
        <span className={`badge ${meta.cls}`}>{meta.kc}</span>
        <span className="nm">{node.name}</span>
        {hasKids && <span className="ct">{node.children!.length}</span>}
      </div>

      {hasKids && (
        <div className="children">
          {node.children!.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              openIds={openIds}
              selectedId={selectedId}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 탐색기 본체 ─────────────────────────────────────────────────
export default function DesignTree() {
  const tree = useMemo(() => withIds(RAW_TREE, "0"), []);

  // 최초 상태: 루트를 펼치고 선택
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([tree.id]));
  const [selected, setSelected] = useState<TreeNode>(tree);

  // 노드 클릭: 자식이 있으면 펼침/접힘 토글 + 항상 선택
  function handleToggleSelect(node: TreeNode) {
    if (node.children?.length) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    }
    setSelected(node);
  }

  const hasChildren = !!selected.children?.length;
  const childKind = selected.children?.[0]?.kind ?? "";

  return (
    <div className="explorer">
      <div className="exp-bar">
        <div className="dotrow">
          <i />
          <i />
          <i />
        </div>
        <div className="path">
          specode / 설계 / <b>{selected.kind}</b> / {selected.name}
        </div>
      </div>
      <div className="exp-body">
        <div className="exp-tree">
          <TreeRow
            node={tree}
            openIds={openIds}
            selectedId={selected.id}
            onToggleSelect={handleToggleSelect}
          />
        </div>
        <div className="exp-detail">
          <div className="d-kind">{selected.kind.toUpperCase()}</div>
          <div className="d-name">{selected.name}</div>
          <div className="d-desc">{selected.desc}</div>

          {hasChildren ? (
            <>
              <div className="d-sub">
                하위 {childKind} {selected.children!.length}개
              </div>
              <div className="d-list">
                {selected.children!.map((c) => {
                  const cm = KIND_META[c.level];
                  return (
                    <div className="it" key={c.id}>
                      <span className={`k ${cm.cls}`}>{cm.kc}</span>
                      {c.name}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="d-sub">최하위 — 기능</div>
              <div className="d-empty">이 기능에 정의된 액션이 곧 구현 대상이 됩니다.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

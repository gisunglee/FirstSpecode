"use client";

/** DesignDemo — 예시 설계 선택과 구조 접기를 제공하는 독립적인 제품 설명 도해. */
import { useState } from "react";

const examples = [
  { title: "키워드 검색", type: "조회 기능", question: "검색 결과가 없을 때는 어떻게 하나요?", rule: "제목과 내용에서 키워드를 검색합니다. 삭제된 게시글은 결과에서 제외합니다.", exception: "결과가 없으면 ‘검색 결과가 없습니다’를 표시합니다.", data: "tb_post · title, content, deleted_yn", criteria: "삭제된 글은 노출되지 않고, 검색어와 일치하는 글만 표시됩니다." },
  { title: "게시글 저장", type: "등록 기능", question: "제목 없이 저장하면 어떻게 하나요?", rule: "제목과 내용을 입력하고 저장합니다. 작성자와 작성일시는 시스템에서 기록합니다.", exception: "제목이 비어 있으면 저장하지 않고 입력을 안내합니다.", data: "tb_post · title, content, author_id", criteria: "필수값을 입력한 게시글이 저장되고 상세 화면으로 이동합니다." },
  { title: "게시글 삭제", type: "변경 기능", question: "삭제 권한은 누구에게 있나요?", rule: "작성자 또는 관리자가 삭제할 수 있습니다. 게시글은 논리 삭제로 처리합니다.", exception: "권한이 없으면 삭제를 거부합니다. 삭제 전 사용자에게 확인합니다.", data: "tb_post · author_id, deleted_yn", criteria: "권한이 있는 사용자만 삭제할 수 있고, 목록에서 해당 글이 제외됩니다." },
];

export default function DesignDemo() {
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const example = examples[selected];
  return <div className="sp-story-demo">
    <div className="sp-story-demo-bar"><span><strong>SPECODE</strong> / 설계 워크스페이스</span><span className="sp-story-tag">클릭해 보는 설계 예시</span></div>
    <div className="sp-story-demo-body"><aside className="sp-story-demo-tree" aria-label="예시 설계 구조"><span className="sp-story-caption">PROJECT / 멀티 게시판</span><button className="sp-story-tree-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="story-example-tree">{expanded ? "▾" : "▸"} 게시판 설계</button><div id="story-example-tree" hidden={!expanded}><p>└ 게시글 관리 화면</p><p>　└ 검색·입력 영역</p>{examples.map((item, index) => <button key={item.title} className={`sp-story-demo-choice${selected === index ? " is-selected" : ""}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>◇ {item.title}<span aria-hidden="true">↗</span></button>)}</div><p className="sp-story-small">작은 화면은 영역 하나로 충분합니다. 필요한 만큼만 나누세요.</p></aside>
      <div className="sp-story-demo-detail" aria-live="polite" aria-atomic="true"><span className="sp-story-caption">기능 명세 / {example.type}</span><h3>{example.title}</h3><div className="sp-story-question"><span>설계할 때 놓치기 쉬운 질문</span><strong>{example.question}</strong></div><dl><div><dt>업무 규칙</dt><dd>{example.rule}</dd></div><div><dt>예외 처리</dt><dd>{example.exception}</dd></div><div><dt>참조 데이터</dt><dd><code>{example.data}</code></dd></div><div><dt>완료 기준</dt><dd>{example.criteria}</dd></div></dl><div className="sp-story-demo-bottom"><span>✓ 확정한 규칙이 PRD의 근거가 됩니다</span><span>.md →</span></div></div>
    </div>
  </div>;
}

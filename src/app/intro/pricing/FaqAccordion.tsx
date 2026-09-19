/**
 * FaqAccordion — 요금제 FAQ 아코디언 (.faq)
 *
 * 역할:
 *   - 질문 클릭 시 답변 펼침/접힘. 한 번에 하나만 펼친다(다른 항목 자동 접힘).
 *   - 답변은 여러 단락(string[])을 받아 <p> 로 렌더링
 *
 * 접근성:
 *   - 질문은 <button aria-expanded> — 키보드(Enter/Space)로 조작 가능
 *   - 답변 영역은 hidden 속성으로 접힘 → 스크린리더가 접힌 내용을 읽지 않음
 */

"use client";

import { useState } from "react";

export type FaqItem = {
  q: string;
  /** 답변 단락 목록 */
  a: string[];
};

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  // 펼쳐진 항목 인덱스 — 첫 항목은 기본으로 열어 두어 "클릭해야 보인다"는 인상을 줄인다
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="faq">
      {items.map((item, i) => {
        const open = openIndex === i;
        const panelId = `faq-panel-${i}`;
        return (
          <div key={item.q} className={`faq-item${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="faq-q"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenIndex((cur) => (cur === i ? null : i))}
            >
              <span className="faq-mark">Q</span>
              <span className="faq-qt">{item.q}</span>
              <span className="faq-toggle" aria-hidden>
                ＋
              </span>
            </button>
            <div id={panelId} className="faq-a" hidden={!open}>
              {item.a.map((para) => (
                <p key={para}>{para}</p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

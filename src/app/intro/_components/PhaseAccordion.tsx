/**
 * PhaseAccordion — 분석/설계 단계 스텝 아코디언 (.steps)
 *
 * 역할 (원본 app.js의 step 아코디언을 React로 포팅):
 *   - 한 그룹 내에서 한 번에 하나의 스텝만 펼침 (다른 스텝은 자동 접힘)
 *   - 펼침 시 내용 높이만큼 max-height를 부여해 부드럽게 전개
 *
 * 시각/동작은 원본과 동일하며, 펼침 상태만 React state로 관리한다.
 */

"use client";

import { useEffect, useRef, useState } from "react";

export type PhaseStep = {
  si: string; // 좌측 인덱스 (a1, d1 …)
  title: string; // 스텝 제목
  body: string; // 본문 설명
  tip: string; // 강조 팁 칩
};

// 단일 스텝 — 펼침 여부에 따라 내용 높이를 측정해 max-height 적용
function Step({
  step,
  open,
  onToggle,
}: {
  step: PhaseStep;
  open: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState("0px");

  // 펼칠 때 실제 콘텐츠 높이를 측정해 적용 (원본의 scrollHeight 방식과 동일)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setMaxHeight(open ? `${el.scrollHeight}px` : "0px");
  }, [open]);

  return (
    <div className={`step${open ? " open" : ""}`}>
      <div className="step-h" onClick={onToggle}>
        <span className="si">{step.si}</span>
        <span className="st">{step.title}</span>
        <span className="toggle">＋</span>
      </div>
      <div className="step-c" ref={contentRef} style={{ maxHeight }}>
        <div className="step-c-inner">
          {step.body} <span className="tip">{step.tip}</span>
        </div>
      </div>
    </div>
  );
}

export default function PhaseAccordion({ steps }: { steps: PhaseStep[] }) {
  // 그룹 내 단일 펼침 — 펼쳐진 스텝 인덱스(없으면 null)
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="steps">
      {steps.map((step, i) => (
        <Step
          key={step.si}
          step={step}
          open={openIndex === i}
          onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
        />
      ))}
    </div>
  );
}

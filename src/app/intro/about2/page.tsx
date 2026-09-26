/** About2Page — 기존 소개와 독립된 시각 중심 제품 소개. */
import type { Metadata } from "next";
import Link from "next/link";
import DesignDemo from "./DesignDemo";
import { BUSINESS, INTRO_PATHS } from "../_components/siteInfo";
import "./about2.css";

export const metadata: Metadata = {
  title: "SPECODE — 대화는 흘러가도, 설계는 남도록",
  description: "AI와 결정한 분석·설계를 구조에 남기고, 팀과 AI가 함께 쓰는 PRD로 연결하세요. 공공 SI 개발팀을 위한 스펙코드.",
};

const problems = [
  { number: "01", quote: "“이 조건, 어제도 설명했는데.”", title: "대화는 쌓여도, 결정은 흩어집니다", body: "업무 규칙과 예외 조건이 대화창 곳곳에 남습니다. 다음 작업을 시작할 때 같은 배경을 다시 설명합니다.", notes: ["어제의 대화", "예외 조건은 어디에?", "오늘, 다시 설명"] },
  { number: "02", quote: "“왜 이렇게 만들었죠?”", title: "코드만으로는 의도를 알기 어렵습니다", body: "무엇을 선택했고 무엇을 제외했는지. 결정의 근거가 없으면 작은 수정도 추측에서 시작됩니다.", notes: ["현재 소스 코드", "결정의 근거 ?", "변경 범위 ?"] },
  { number: "03", quote: "“그건 담당자만 알고 있어요.”", title: "개인의 맥락이 팀에 닿지 않습니다", body: "AI에게 전한 설명이 팀에도 공유되어야 합니다. 다음 담당자에게 필요한 것은 결과와 그 기준입니다.", notes: ["담당자 ↔ AI", "공유되지 않은 맥락", "다음 담당자 ?"] },
];
const outputs = [
  ["요구사항 정의서", "DOCX · XLSX"], ["과업대비표", "DOCX · XLSX"],
  ["요구사항 명세서", "DOCX"], ["프로그램 사양서", "DOCX"],
  ["테이블 목록", "XLSX"], ["테스트 명세", "XLSX"],
];

export default function About2Page() {
  return <div className="sp-story">
    <a className="sp-story-skip" href="#story-main">본문으로 건너뛰기</a>
    <header className="sp-story-nav">
      <div className="sp-story-wrap sp-story-nav-inner">
        <Link className="sp-story-logo" href={INTRO_PATHS.home}>SPE<span>CODE</span><i aria-hidden="true">✳</i></Link>
        <nav aria-label="소개 페이지 탐색" className="sp-story-links">
          <a href="#how">사용 과정</a><a href="#outputs">산출물</a><Link href={INTRO_PATHS.pricing}>요금제</Link>
        </nav>
        <Link className="sp-story-button" href={INTRO_PATHS.login}>시작하기 <span aria-hidden="true">↗</span></Link>
      </div>
    </header>
    <main id="story-main">
      <section className="sp-story-hero sp-story-wrap">
        <div className="sp-story-eyebrow"><span className="sp-story-dot" /> 설계를 아는 팀을 위한 AI 설계 플랫폼</div>
        <h1>AI와 구현하기 전에,<br /><em>AI와 설계하세요.</em></h1>
        <p className="sp-story-lead">AI와 충분히 대화하고, 설계자가 검토하고 결정합니다.<br />스펙코드는 그 결정을 모아,<br className="sp-story-mobile-break" /> AI에게 개발을 맡길 기준으로 만듭니다.</p>
        <div className="sp-story-actions"><Link className="sp-story-button" href={INTRO_PATHS.login}>스펙코드 시작하기 <span aria-hidden="true">↗</span></Link><a className="sp-story-button sp-story-button-outline" href="#how">어떻게 쓰나요? <span aria-hidden="true">↓</span></a></div>
      </section>

      {/* 기능 설명에 앞서, 설계자의 판단이 필요한 이유와 제품의 역할을 설명한다. */}
      <section className="sp-story-conviction sp-story-wrap" aria-labelledby="story-conviction-title">
        <div className="sp-story-conviction-copy">
          <span className="sp-story-eyebrow">AI와 일해 보니, 남는 질문</span>
          <h2 id="story-conviction-title">AI는 뛰어납니다.<br />그런데, <em>어떤 방법으로<br />만들지는 정하셨나요?</em></h2>
          <p>어제는 AI와 한참 대화하며 좋은 답을 얻었습니다. 그런데 오늘, 새 작업을 시작하니 같은 조건을 다시 설명합니다. 만들고, 고치고, 설명하고, 다시 만들고. 거의 다 된 것 같은데 대화는 자꾸 길어집니다.</p>
          <p>하나의 기능을 만드는 방법은 여러 가지입니다. DB 테이블을 어떻게 나눌지, 어떤 구조로 구현할지, 예외는 어디서 처리할지. AI의 제안이 그럴듯해도 <strong>우리 업무에 맞는 선택인지 확인하는 일</strong>은 남습니다.</p>
          <p>그 선택을 검토하고 남기지 않으면, 어제와 오늘의 제안에 따라 설계와 개발 방식이 흔들릴 수 있습니다. 필요한 것은 <strong>다음 대화에서도 이어갈 우리 팀의 기준</strong>입니다.</p>
        </div>
        <div className="sp-story-conviction-flow">
          <div className="sp-story-loop">
            <span className="sp-story-caption">기준 없이 시작하면</span>
            <div className="sp-story-loop-chain"><span>대화</span><b aria-hidden="true">→</b><span>개발</span><b aria-hidden="true">→</b><span>다시 대화</span><b aria-hidden="true">→</b><span>다시 개발</span><b aria-hidden="true">↻</b></div>
            <p>“잠깐, 이건 어제 정한 것과 다른데요.”</p>
          </div>
          <div className="sp-story-decisions">
            <span className="sp-story-eyebrow">스펙코드가 제안하는 순서</span>
            <h3>충분히 대화하며 설계하고,<br />그 설계로 개발을 시작합니다.</h3>
            <ol>
              <li><span>01</span><div><strong>설계자가 AI와 직접 대화합니다</strong><p>업무를 설명하고, 여러 방법을 비교합니다.</p></div></li>
              <li><span>02</span><div><strong>검토하고 결정한 설계를 저장합니다</strong><p>DB 구조부터 업무 규칙까지 스펙코드에 남깁니다.</p></div></li>
              <li><span>03</span><div><strong>모인 설계를 기준으로 개발을 맡깁니다</strong><p>AI는 PRD를 읽고, 팀은 같은 기준으로 결과를 검토합니다.</p></div></li>
            </ol>
            <p className="sp-story-human">스펙코드는 모든 판단을 AI에게 맡기지 않습니다.<br /><strong>설계의 주도권은 설계자에게 있습니다.</strong></p>
          </div>
        </div>
      </section>

      <section className="sp-story-wrap sp-story-overview" aria-label="확정한 설계가 개발로 이어지는 과정">
        <div className="sp-story-hero-art" aria-label="AI와 나눈 대화가 스펙코드의 설계 구조를 거쳐 PRD와 팀의 공통 기준으로 이어지는 과정">
          <div className="sp-story-chat"><span className="sp-story-caption">01 / 함께 결정하고</span><div className="sp-story-bubble">게시글 검색은 어떻게 할까요?</div><div className="sp-story-bubble is-answer">제목과 내용으로 검색하고,<br />삭제된 글은 제외해 주세요.</div><span className="sp-story-small">AI와 질문하고 · 검토하고 · 확정하기</span></div>
          <span className="sp-story-flow-arrow" aria-hidden="true">→</span>
          <div className="sp-story-spec"><span className="sp-story-caption">02 / 구조에 남기고</span><strong>SPECODE <span className="sp-story-dot" /></strong><div className="sp-story-tree-line">▦ 멀티 게시판</div><div className="sp-story-tree-line">└ 게시글 목록</div><div className="sp-story-tree-line">　└ 검색·목록 영역</div><div className="sp-story-tree-line is-selected">　　↳ 키워드 검색 <span>✓</span></div><span className="sp-story-small">업무 규칙 + 처리 조건 + 데이터</span></div>
          <span className="sp-story-flow-arrow" aria-hidden="true">→</span>
          <div className="sp-story-file"><span className="sp-story-caption">03 / 같은 기준으로 구현하기</span><div className="sp-story-document"><span className="sp-story-filetype">MD ↗</span><strong>멀티게시판_PRD.md</strong><span># 키워드 검색</span><span>대상 : 제목, 내용</span><span>조건 : 삭제된 글 제외</span><div className="sp-story-code-line" /><div className="sp-story-code-line" /></div><span className="sp-story-small">개발 AI · 팀원 · 다음 담당자</span></div>
        </div>
        <p className="sp-story-art-note">이해를 돕기 위한 설계 흐름 예시입니다.</p>
        <div className="sp-story-audience-strip"><span>복잡한 업무 규칙</span><span>공공 SI 산출물</span><span>팀의 공통 기준</span><span>운영·유지보수</span></div>
      </section>

      <section className="sp-story-section sp-story-muted">
        <div className="sp-story-wrap"><div className="sp-story-heading"><span className="sp-story-eyebrow">WHY SPECODE</span><h2>만드는 건 빨라졌는데,<br />설명은 왜 늘어날까요?</h2><p>분석과 설계에서 내린 결정이 다음 작업까지 이어지지 않기 때문입니다.</p></div>
          <div className="sp-story-grid-three">{problems.map(item => <article className="sp-story-problem" key={item.number}><div className="sp-story-note-art" aria-hidden="true">{item.notes.map(note => <span key={note}>{note}</span>)}</div><span className="sp-story-caption">{item.number} / {item.quote}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
        </div>
      </section>

      <section className="sp-story-section sp-story-wrap" id="how">
        <div className="sp-story-heading"><span className="sp-story-eyebrow">FROM CONVERSATION TO SPEC</span><h2>대화는 흘러가도,<br /><em>결정은 남도록.</em></h2><p>빈 문서부터 시작하지 마세요. 정해진 구조가 다음에 물어볼 질문이 됩니다.</p></div>
        <DesignDemo />
        <div className="sp-story-grid-three sp-story-steps">
          <article><span className="sp-story-step-number">01</span><h3>무엇을 만들지 분석합니다</h3><p>과업 → 요구사항 → 사용자 스토리.<br />업무의 배경과 완료 기준을 함께 정합니다.</p></article>
          <article><span className="sp-story-step-number">02</span><h3>구현할 수 있게 설계합니다</h3><p>단위업무 → 화면 → 영역 → 기능.<br />예외 규칙과 사용하는 데이터까지 남깁니다.</p></article>
          <article><span className="sp-story-step-number">03</span><h3>확정한 설계를 PRD로 엮습니다</h3><p>필요한 범위를 선택해 MD로 내보냅니다.<br />팀과 AI가 같은 기준으로 구현하고 검토합니다.</p></article>
        </div>
      </section>

      <section className="sp-story-section sp-story-muted"><div className="sp-story-wrap sp-story-split">
        <div><span className="sp-story-eyebrow">WORK YOUR WAY</span><h2>익숙한 AI와 대화하세요.<br />설계는 여기에 남기세요.</h2><p>직접 입력부터 AI 연동까지.<br />팀에 맞는 방식으로 같은 구조를 채울 수 있습니다.</p></div>
        <div className="sp-story-methods"><article><span>01</span><div><h3>화면에서 직접 입력</h3><p>계층별 표준 양식을 따라 설계를 정리합니다.</p></div></article><article><span>02</span><div><h3>AI와 설계하고 JSON으로 가져오기</h3><p>전용 프롬프트로 문답하고, 정리한 결과를 일괄 등록합니다.</p></div></article><article className="is-featured"><span>03</span><div><h3>MCP로 대화와 등록을 한 번에</h3><p>Claude Code 같은 AI 도구에서 설계를 조회하고, 결정한 내용을 바로 등록·수정합니다.</p><span className="sp-story-tag">사람이 판단하고, AI와 함께 기록합니다</span></div></article></div>
      </div></section>

      <section className="sp-story-section sp-story-wrap" id="outputs">
        <div className="sp-story-heading"><span className="sp-story-eyebrow">ONE SPEC, MANY OUTPUTS</span><h2>한 번 정리한 설계,<br />구현에도. 제출에도.</h2><p>문서마다 같은 내용을 다시 옮겨 적지 않도록, 하나의 설계에서 꺼내 씁니다.</p></div>
        <div className="sp-story-output-grid"><article className="sp-story-prd"><span className="sp-story-filetype">.md</span><h3>AI가 읽는 PRD</h3><p>기능 하나부터 프로젝트 전체까지.<br />입력한 설계를 계층 순서대로 엮습니다.</p><div className="sp-story-prd-lines"><code># 단위업무: 멀티 게시판</code><code>## 화면: 게시글 목록</code><code>### 기능: 키워드 검색</code><code>- 업무 규칙 · API · 참조 테이블</code></div><p className="sp-story-small">새 내용을 지어내지 않습니다.<br />PRD의 품질은 입력한 설계의 품질에서 시작됩니다.</p></article><div className="sp-story-deliverables">{outputs.map(([title, format]) => <div key={title}><span className="sp-story-doc-icon" aria-hidden="true">▤</span><strong>{title}</strong><span>{format}</span></div>)}<p>준비 중 · 요구사항 추적표, 속성·컬럼 정의서</p></div></div>
      </section>

      <section className="sp-story-section sp-story-muted"><div className="sp-story-wrap"><div className="sp-story-heading"><span className="sp-story-eyebrow">BUILT FOR THE LONG RUN</span><h2>첫 구현 다음까지<br />생각하는 팀을 위해.</h2></div><div className="sp-story-grid-three"><article className="sp-story-team"><span className="sp-story-step-number">▦</span><h3>공공 SI 사업팀</h3><p>복잡한 요구사항과 제출 산출물을 하나의 설계 기준으로 관리하고 싶은 팀.</p></article><article className="sp-story-team"><span className="sp-story-step-number">↻</span><h3>운영·유지보수 팀</h3><p>담당자가 바뀌어도 업무 규칙과 설계 의도를 이어가야 하는 팀.</p></article><article className="sp-story-team"><span className="sp-story-step-number">⌘</span><h3>AI를 도입하는 개발팀</h3><p>AI의 구현 결과를 검토할 구체적인 기준이 필요한 팀.</p></article></div><p className="sp-story-fit-note">분석·설계 경험이 있는 팀에 맞습니다. 작은 MVP에는 구조를 채우는 비용이 더 클 수 있습니다.</p></div></section>

      <section className="sp-story-section sp-story-wrap sp-story-faq"><div><span className="sp-story-eyebrow">A FEW THINGS TO KNOW</span><h2>시작 전에,<br />궁금한 것들.</h2></div><div>{[
        ["AI가 설계를 알아서 완성하나요?", "설계의 선택과 확정은 사람이 합니다. 스펙코드는 정해진 양식을 통해 빠진 질문을 드러내고, AI와 결정한 내용을 기록하도록 돕습니다."],
        ["설계 내용을 전부 직접 입력해야 하나요?", "직접 입력 외에 JSON 일괄 등록과 MCP 연동을 제공합니다. 반복 입력을 줄일 수 있지만, 업무를 설명하고 결과를 검토하는 시간은 필요합니다."],
        ["구현한 코드와 설계가 달라지면요?", "스펙 동기화로 소스와 단위업무 설계의 차이를 검토할 수 있습니다. 반영할 항목은 사람이 결정합니다. 코드 변경과 함께 설계를 유지하는 습관도 필요합니다."],
        ["어떤 기능을 지금 사용할 수 있나요?", "구조화된 분석·설계, PRD 내보내기, JSON·MCP 연동, 기능·영역 AI 점검, 기획 초안, 테이블·컬럼 관리와 스펙 동기화를 제공합니다. 설계 전체 검증, 변경 영향도 분석 확대, 설계 재사용은 앞으로의 확장 방향입니다."],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

      <section className="sp-story-final"><div className="sp-story-wrap"><span className="sp-story-eyebrow">START WITH A SHARED UNDERSTANDING</span><h2>다음 대화는,<br />쌓이는 설계가 되도록.</h2><p>하나의 업무부터, AI와 함께 설계해 보세요.</p><Link className="sp-story-button" href={INTRO_PATHS.login}>스펙코드 시작하기 <span aria-hidden="true">↗</span></Link></div></section>
    </main>
    <footer className="sp-story-wrap sp-story-footer"><div><Link className="sp-story-logo" href={INTRO_PATHS.home}>SPE<span>CODE</span></Link><p>AI와 구현하기 전에, AI와 설계하세요.</p><small>© {new Date().getFullYear()} {BUSINESS.companyName} · 대표 {BUSINESS.ceoName}</small></div><nav aria-label="법적 고지"><Link href={INTRO_PATHS.about}>기존 소개</Link><Link href={INTRO_PATHS.terms}>이용약관</Link><Link href={INTRO_PATHS.privacy}>개인정보처리방침</Link><a href={`mailto:${BUSINESS.contactEmail}`}>문의</a></nav></footer>
  </div>;
}

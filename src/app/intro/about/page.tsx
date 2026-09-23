/**
 * IntroAboutPage — SPECODE 인트로 · 전체 소개("스펙코드 소개", 다크 테마) (/intro/about)
 *
 * 역할:
 *   - 스펙코드 전반을 설명하는 풀 소개 페이지 (문제 인식 → 해결 방식 → 설계 구조 →
 *     산출물 → 대상 팀 → 분석/설계 구성 → 등록 방식 → 확장 방향)
 *   - 요약 페이지(/intro)에서 "자세히 보기"로 진입
 *
 * 디자인 출처:
 *   - Claude Design 핸드오프 번들 "스펙코드 소개.html"
 *   - 스타일은 intro.css의 `.sp-intro`(다크 기본) 스코프
 *
 * 인터랙션:
 *   - useIntroEffects: NAV solid 전환, 스티키 도크, .reveal 등장 애니메이션
 *   - DesignTree: 설계 구조 탐색기 (단위업무▸화면▸영역▸기능)
 *   - PhaseAccordion: 분석/설계 단계 스텝 아코디언
 */

"use client";

import Link from "next/link";
import { useRef } from "react";
import { useIntroEffects } from "../_components/useIntroEffects";
import DesignTree from "../_components/DesignTree";
import PhaseAccordion, { type PhaseStep } from "../_components/PhaseAccordion";
import IntroNav from "../_components/IntroNav";
import IntroFooter from "../_components/IntroFooter";

// 이용 시작 경로 — 한 곳에서 관리
// 로그인 페이지로 보냄: 기존 회원은 바로 로그인, 신규 회원은 로그인 화면의 회원가입 링크로 이동
const LOGIN_PATH = "/auth/login";

// ── 분석 단계 스텝 (PHASE 01) ──────────────────────────────────
const ANALYZE_STEPS: PhaseStep[] = [
  {
    si: "a1",
    title: "과업",
    body: "제안요청서(RFP)와 과업지시서에 담긴 요구 내용을 옮겨 프로젝트의 출발점으로 삼습니다.",
    tip: "발주 문서의 요구 내용",
  },
  {
    si: "a2",
    title: "요구사항",
    body: "과업을 분석·설계·구현하기 좋은 요구사항 단위로 나눕니다. 하나의 과업이 여러 요구사항으로 나뉘거나, 여러 과업의 일부가 하나의 요구사항으로 합쳐질 수도 있습니다. 인터뷰에서 확인한 업무 규칙과 배경을 함께 기록하면 요건정의서와 AI 기획의 근거가 됩니다.",
    tip: "만들기 적당한 의미 단위",
  },
  {
    si: "a3",
    title: "사용자 스토리",
    body: "사용자 관점에서 페르소나와 시나리오, 이용 사례, 인수 조건을 정리합니다. 이 정보는 AI가 요구사항의 의도와 완료 기준을 이해하는 데 활용됩니다.",
    tip: "페르소나 · 시나리오 · 인수조건",
  },
  {
    si: "a4",
    title: "기획실",
    body: "요구사항과 사용자 스토리를 바탕으로 AI와 기획 초안을 만드는 메뉴입니다. 화면 초안(HTML), 업무 흐름, ERD, 정보구조도 등을 먼저 검토하고 설계 방향을 정할 수 있습니다. 결과물은 그대로 확정하는 문서가 아니라, 팀이 검토하고 결정하기 위한 출발점으로 사용합니다.",
    tip: "화면 초안 · 업무 흐름 · ERD · 정보구조도",
  },
];

// ── 설계 단계 스텝 (PHASE 02) ──────────────────────────────────
const DESIGN_STEPS: PhaseStep[] = [
  {
    si: "d1",
    title: "단위업무",
    body: "하나의 의미 있는 업무 묶음입니다. 예: 게시판, 회원관리. 이 안에 여러 화면이 들어갑니다.",
    tip: "업무 묶음",
  },
  {
    si: "d2",
    title: "화면",
    body: "단위업무를 구성하는 실제 화면입니다. 예: 게시판 목록 · 상세 · 등록. 사용자가 마주하는 단위죠.",
    tip: "목록 · 상세 · 등록",
  },
  {
    si: "d3",
    title: "영역",
    body: "화면을 목적과 역할에 따라 나눈 구성 단위입니다. 예: 검색 영역 · 목록 영역 · 입력 영역.",
    tip: "화면 속 구역",
  },
  {
    si: "d4",
    title: "기능",
    body: "사용자 동작과 시스템 처리 단위를 기능으로 정의합니다. 예: 키워드 검색 · 페이징 · 등록/수정. 이 정의가 구현과 검토의 기준이 됩니다.",
    tip: "동작과 처리 = 구현 단위",
  },
  {
    si: "d5",
    title: "테이블",
    body: "기능을 뒷받침하는 데이터 구조입니다. 테이블·컬럼 레벨까지 정의해두면, 테이블 목록·속성 정의서·컬럼정의서 같은 설계 산출물로 이어집니다.",
    tip: "테이블 · 컬럼 정의",
  },
];

export default function IntroAboutPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  useIntroEffects(rootRef);

  return (
    <div className="sp-intro" ref={rootRef}>
      {/* ===================== NAV (공용) ===================== */}
      <IntroNav active="about" />

      {/* ===================== HERO ===================== */}
      <header className="hero" data-screen-label="히어로">
        <div className="blueprint" />
        <div
          className="glow"
          style={{ width: 520, height: 520, background: "#2f6bff", top: -120, right: -80 }}
        />
        <div className="wrap">
          <div className="hero-badges reveal">
            <span className="pill b">공공 SI 실무에 최적화</span>
            <span className="pill">산출물 · 운영 · 유지보수까지</span>
            <span className="pill">PRD · 설계 산출물 자동화</span>
          </div>
          <h1 className="reveal d1">
            <span className="line">AI와 구현하기 전에,</span>
            <span className="line">
              <span className="grad-text">AI와 설계하세요.</span>
            </span>
          </h1>
          <p className="hero-sub reveal d2">
            스펙코드는 요구사항과 설계 정보를 <b>구조화된 PRD</b>로 만들고, AI가 프로젝트의 맥락을 정확히 이해해{" "}
            <b>구현부터 운영·유지보수까지 일관된 기준</b>을 이어가도록 돕는 공공 SI 개발팀용 설계 플랫폼입니다.
          </p>
          <div className="hero-cta reveal d3">
            <Link href={LOGIN_PATH} className="btn btn-primary">
              스펙코드 이용하기 <span className="arr">→</span>
            </Link>
            <span className="hero-note">분석 → 설계 → PRD → 구현</span>
          </div>

          <div className="pipe reveal d4">
            <div className="node">
              <small>ANALYZE</small>
              <b>분석</b>
            </div>
            <span className="arr">→</span>
            <div className="node hl">
              <small>DESIGN — SPEC</small>
              <b>설계</b>
            </div>
            <span className="arr">→</span>
            <div className="node">
              <small>OUTPUT</small>
              <b>PRD</b>
            </div>
            <span className="arr">→</span>
            <div className="node">
              <small>AI BUILD</small>
              <b>구현</b>
            </div>
          </div>
        </div>
        <div className="scroll-hint">
          <span>SCROLL</span>
          <span className="bar" />
        </div>
      </header>

      {/* ===================== TURN INTRO ===================== */}
      <section className="sec dark-2">
        <div className="blueprint" />
        <div className="wrap statement">
          <p className="big reveal">
            바이브 코딩 시대가 왔습니다.
            <br />
            모든 걸 AI가 다 해준다면 —<br />
            이제 <span className="grad-text">설계는 필요 없을까요?</span>
          </p>
          <p className="small reveal d2">
            처음에는 빠르게 나오는 결과에 기대가 커집니다.
            <br />
            하지만 설계 없이 기능을 더할수록 <b>시스템의 기준은 조금씩 어긋나기 시작합니다.</b>
          </p>

          <div className="endo reveal d3" aria-hidden="true">
            <svg viewBox="0 0 760 210" role="img">
              <defs>
                <linearGradient id="endoGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1fd4e8" />
                  <stop offset="42%" stopColor="#5fe0ef" />
                  <stop offset="55%" stopColor="#ff6b6b" />
                  <stop offset="100%" stopColor="#ff8a8a" />
                </linearGradient>
              </defs>
              <path
                className="epath"
                d="M 12,128 C 48,158 78,176 116,176 C 178,176 232,70 300,30 C 318,22 330,150 352,150 C 430,150 470,118 548,124 C 596,128 612,152 668,150 C 706,149 732,118 748,98"
              />
              <circle className="edot d-peak" cx="300" cy="30" r="6" fill="#5fe0ef" />
              <circle className="edot d-crash" cx="352" cy="150" r="6" fill="#ff6b6b" />
              <text className="elab up" x="290" y="14" textAnchor="middle">
                초반 · 빠른 결과에 신남
              </text>
              <text className="elab down" x="500" y="186" textAnchor="middle">
                이후 · 시스템이 어긋나며 불안
              </text>
            </svg>
          </div>
          <p className="endo-cap reveal d3">
            시간이 지날수록 — 처음의 쾌감은 줄고, 시스템에 대한 불안은 커집니다.
          </p>
        </div>
      </section>

      {/* ===================== EARLY HOOK — 30층 질문 ===================== */}
      <section className="sec dark hook" data-screen-label="30층 질문(인트로)">
        <div className="blueprint" />
        <div
          className="glow"
          style={{ width: 460, height: 460, background: "#2f6bff", bottom: -140, right: -100, opacity: 0.32 }}
        />
        <div className="wrap">
          <div className="hook-grid">
            <div className="hook-copy">
              <div className="kicker dot reveal" style={{ color: "var(--blue-bright)" }}>
                A QUESTION BEFORE YOU BUILD
              </div>
              <h2 className="reveal d1">
                뚝딱 지은 30층 건물에서,
                <br />
                <span className="grad-text">마음 편히 주무실 수 있나요?</span>
              </h2>
              <p className="reveal d2">
                개인 프로젝트나 MVP를 넘어, <b>업무 규칙이 복잡한 중·대규모 시스템</b>도 설계 없이 AI만으로 만들어
                안정적으로 운영할 수 있을까요?
              </p>
              <p className="reveal d2">
                구현 속도가 빨라져도 구조를 설명하고 변경 영향을 판단할 수 없다면, 그 <b>불안은 운영 단계까지</b>
                이어집니다.
              </p>
              <p className="hook-cta reveal d3">
                그래서 구현을 시작하기 전에, <b>AI와 먼저 설계해야 합니다.</b> 스펙코드는{" "}
                <span className="grad-text">팀이 이해하고 검토할 수 있는 설계</span>를 만드는 과정을 돕습니다.
              </p>
            </div>
            <div className="hook-visual reveal d2">
              <span className="zzz">Zzz…</span>
              <div className="bld easy">
                <div className="box" style={{ height: 64 }} />
                <div className="lab">초가집</div>
                <div className="tag">뚝딱 ✓</div>
              </div>
              <div className="bld easy">
                <div className="box" style={{ height: 104 }} />
                <div className="lab">3층</div>
                <div className="tag">뚝딱 ✓</div>
              </div>
              <div className="bld hard">
                <div className="box" style={{ height: 264 }} />
                <div className="lab">30층</div>
                <div className="tag">설계 + 안심</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== PROBLEM 배경 1~4 ===================== */}
      <section className="sec dark" data-screen-label="배경(문제)">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">THE PROBLEM</div>
            <h2>
              바이브 코딩이 남긴
              <br />
              <span className="grad-text">네 가지 불안</span>
            </h2>
            <p>설계 없이 구현부터 달려온 결과, 개발팀에는 이런 일들이 쌓이고 있습니다.</p>
          </div>

          <div className="problems">
            {/* 배경 1 */}
            <article className="prob reveal">
              <div className="prob-text">
                <div className="prob-num">01</div>
                <span className="prob-tag">설계 없는 구현 · 커지는 불확실성</span>
                <h3>설명은 길어지는데, 시스템은 이해하기 어려워집니다</h3>
                <p>
                  처음에는 짧은 요청만으로도 화면과 기능이 빠르게 만들어집니다. 하지만 기능이 늘어날수록{" "}
                  <span className="hl">이전 결정과 예외 규칙을 매번 다시 설명</span>해야 하고, 시스템이 어떤 기준으로
                  만들어졌는지 파악하기 어려워집니다.
                </p>
                <p>
                  변경 범위와 영향을 설명할 수 없으면 운영 중 수정도 조심스러워집니다. 빠른 구현이{" "}
                  <span className="hl">지속 가능한 개발로 이어지지 않는 이유</span>입니다.
                </p>
              </div>
              <div className="prob-visual">
                <div className="pviz">
                  <div className="pviz-label">PROMPT — 길어지는 설명</div>
                  <div className="pviz-rows">
                    <div className="r long" />
                    <div className="r long" />
                    <div className="r mid" />
                    <div className="r long" />
                    <div className="r warn" />
                    <div className="r short" />
                  </div>
                  <div className="pviz-cap">
                    설명은 점점 길어지는데, 시스템은 점점 <b>알 수 없게</b> 됩니다.
                  </div>
                </div>
              </div>
            </article>

            {/* 배경 2 */}
            <article className="prob reveal">
              <div className="prob-text">
                <div className="prob-num">02</div>
                <span className="prob-tag">대화 속에 흩어진 설계 의사결정</span>
                <h3>프롬프트에 담긴 중요한 결정이 자산으로 남지 않습니다</h3>
                <p>
                  AI와 나눈 대화에는 업무 규칙과 화면 흐름, 데이터 구조에 대한 결정이 쌓입니다. 하지만 이를 구조화하지
                  않으면 다음 날 다시 <span className="hl">같은 배경과 조건을 설명</span>하게 됩니다.
                </p>
                <p>
                  흩어진 대화와 임시 메모만으로는 복잡한 업무를 팀의 자산으로 남기기 어렵습니다.{" "}
                  <span className="hl">결정한 내용을 구조화된 분석·설계 정보로 축적</span>해야 다음 작업과 다음
                  담당자에게 이어집니다.
                </p>
              </div>
              <div className="prob-visual">
                <div className="pviz">
                  <div className="pviz-label">LOST — 사라지는 설계 정보</div>
                  <div className="fade-stack">
                    <div className="fc gone">
                      <span>7일 전 프롬프트 = 나의 설계</span>
                      <em>휘발 ✕</em>
                    </div>
                    <div className="fc gone">
                      <span>3일 전 프롬프트</span>
                      <em>휘발 ✕</em>
                    </div>
                    <div className="fc dim">
                      <span>어제 프롬프트</span>
                      <em>흐려짐</em>
                    </div>
                    <div className="fc now">
                      <span>오늘, 다시 처음부터…</span>
                      <em>재작성 ↻</em>
                    </div>
                  </div>
                  <div className="pviz-cap">
                    어제의 프롬프트가 곧 나의 <b>설계</b>였는데 — 오늘은 사라지고, 다시 씁니다.
                  </div>
                </div>
              </div>
            </article>

            {/* 배경 3 */}
            <article className="prob reveal">
              <div className="prob-text">
                <div className="prob-num">03</div>
                <span className="prob-tag">반복되는 설명 · 늦어지는 합의</span>
                <h3>말하고 기다리고, 또 말하고 기다리고</h3>
                <p>
                  분석과 설계의 기준 없이 구현부터 시작하면 기획, 설계, 구현, 검토가 한 대화 안에서 뒤섞입니다.{" "}
                  <span className="hl">무엇을 결정했고 무엇이 남았는지</span> 구분하기도 어려워집니다.
                </p>
                <p>
                  결과가 나올 때마다 조건을 덧붙이고 다시 생성하는 과정이 반복됩니다. 개인의 구현 속도는 빨라져도,{" "}
                  <span className="hl">팀이 합의하고 검토하는 시간까지 줄었다고 보기는 어렵습니다.</span>
                </p>
              </div>
              <div className="prob-visual">
                <div className="pviz">
                  <div className="pviz-label">LOOP — 무한 반복</div>
                  <div className="loop">
                    <div className="lp">
                      <span className="me">나 ▸</span> 이거 이렇게 해줘…
                    </div>
                    <div className="lp">
                      <span className="ai">AI ▸</span> (생성 중) ⏳
                    </div>
                    <div className="lp">
                      <span className="me">나 ▸</span> 음… 다시, 이 부분만…
                    </div>
                    <div className="lp">
                      <span className="ai">AI ▸</span> (생성 중) ⏳
                    </div>
                    <div className="loopback">↻ 말하고 · 기다리고 · 반복</div>
                  </div>
                  <div className="pviz-cap">
                    거의 다 된 것 같아서 — <b>한 번만 더</b> 시키고, 또 기다립니다.
                  </div>
                </div>
              </div>
            </article>

            {/* 배경 4 */}
            <article className="prob reveal">
              <div className="prob-text">
                <div className="prob-num">04</div>
                <span className="prob-tag">공유되지 않는 설계 정보</span>
                <h3>AI에게 전달한 맥락이 팀에는 공유되지 않습니다</h3>
                <p>
                  개발자가 AI에 전달한 업무 설명과 기술적 판단은 중요한 <span className="hl">분석·설계 정보</span>입니다.
                  이 정보가 개인 대화에만 남으면 다른 팀원은 결과만 보고 의도를 추측해야 합니다.
                </p>
                <p>
                  시간이 지나면 작성자도 당시의 맥락을 모두 기억하기 어렵습니다. 결정의 근거를 공유 가능한 형태로
                  남겨야 <span className="hl">변경과 인수인계에 대응</span>할 수 있습니다.
                </p>
              </div>
              <div className="prob-visual">
                <div className="pviz">
                  <div className="pviz-label">SILO — 공유되지 않음</div>
                  <div className="pviz-rows">
                    <div className="r mid" style={{ background: "rgba(79,134,255,.5)" }} />
                    <div className="r short" style={{ opacity: 0.2 }} />
                    <div className="r long" style={{ opacity: 0.14 }} />
                    <div className="r short" style={{ opacity: 0.1 }} />
                    <div className="r mid" style={{ opacity: 0.06 }} />
                  </div>
                  <div className="pviz-cap">
                    AI에게만 전해진 설계가, <b>팀에 닿지 않습니다.</b>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ===================== TURN to SPECODE ===================== */}
      <section className="sec light">
        <div className="wrap statement">
          <div
            className="kicker dot reveal"
            style={{ color: "var(--blue)", justifyContent: "center", marginBottom: 24 }}
          >
            THE TURN
          </div>
          <p className="big reveal d1" style={{ color: "var(--ink)" }}>
            구현 전에 <span className="grad-text">핵심 결정을 구조화</span>하세요.
            <br />
            AI가 구현을 빨리해도, 분석과 설계의 역할은 사라지지 않습니다.
          </p>
          <p className="small reveal d2" style={{ color: "var(--ink-soft)" }}>
            구현 전에 기준을 세우고, 변경이 생기면 설계도 함께 갱신합니다.
            <br />그 과정을 한곳에 축적하는 도구가 <b style={{ color: "var(--blue)" }}>스펙코드</b>입니다.
          </p>
        </div>
      </section>

      {/* ===================== Q&A PART 1 — 무엇이 다른가 ===================== */}
      <section className="sec light-2" data-screen-label="Q&A 무엇이 다른가">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">Q &amp; A — 스펙코드에 직접 물었습니다</div>
            <h2>
              그래서, 무엇이
              <br />
              다른 걸까요?
            </h2>
          </div>

          <div className="qa-group">
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 그래서 스펙코드는 뭘 어떻게 하겠다는 거죠? 뭐가 다르죠?
              </div>
              <div className="a">
                <p>
                  <span className="lead">
                    요구사항과 설계 정보를 구조화하고, AI가 이해할 수 있는 PRD로 전달합니다.
                  </span>{" "}
                  팀은 같은 기준을 공유하고, AI는 일관된 맥락 안에서 구현할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 설계요? 뭘 어떻게요?
              </div>
              <div className="a">
                <p>
                  기존 개발 과정과 크게 다르지 않습니다. 요구사항을 나누고, 화면과 기능을 정의하고, 데이터 구조와 업무
                  규칙을 연결합니다. 다만 AI가 구현을 맡는 만큼{" "}
                  <span className="hl">사람이 암묵적으로 알고 있던 기준까지 명시</span>해야 합니다.
                </p>
                <p>
                  구현에 쓰이던 시간을 분석과 설계에 더 배분하면, AI 결과를 검토할 기준도 함께 만들 수 있습니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> AI가 다 해주는 시대에, 너무 구시대적인 발상 아닌가요?
              </div>
              <div className="a">
                <p>
                  AI의 구현 역량은 빠르게 좋아지고 있습니다. 하지만 프로젝트의 목표와 업무 규칙, 예외 조건을 충분히
                  제공하지 않으면 <span className="hl">짧은 요청만으로 원하는 결과를 안정적으로 반복</span>하기
                  어렵습니다.
                </p>
                <p>
                  설계는 수많은 <span className="hl">선택의 과정</span>입니다. A·B 중 무엇이 좋은지 고르고, 다시 가·나
                  중 무엇이 좋은지 고르는 과정이죠. AI도 잘할 수 있지만, 충분한 배경지식과 프로젝트 정보가 필요합니다.
                  정보가 부족하면 프로젝트 의도와 다른 결과가 나오기 쉽습니다. 중요한 선택을 검토하고 확정하는 일에는
                  여전히 사람의 판단이 필요합니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 그럼 뭐가 좋아진 거죠? 구현이 편해진 줄 알았는데, 설계가 더 힘들어지면
                안 되죠.
              </div>
              <div className="a">
                <p>
                  맞습니다. 더 깊이 있게 설계해야 한다고 해서 모든 문서를 담당자가 처음부터 직접 작성해야 한다는 뜻은
                  아닙니다.
                </p>
                <p>
                  설계 과정에서도 AI의 도움을 받을 수 있습니다. AI와 질문하고 선택한 내용을 스펙코드에 구조화하면,{" "}
                  <span className="hl">팀이 검토하고 구현에 활용할 수 있는 설계</span>로 이어집니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== Q&A PART 2 — 어떻게 쓰는가 + 등록 ===================== */}
      <section className="sec dark" data-screen-label="Q&A 어떻게 쓰는가">
        <div className="blueprint" />
        <div className="wrap">
          <div className="qa-group">
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 그럼 AI와 설계하고, 그 정보를 스펙코드에 등록해야 한다는 건가요?
                불편하네요.
              </div>
              <div className="a">
                <p>
                  맞습니다. 그래서 정보 등록을 위한 <span className="hl">세 가지 방법</span>을 준비했습니다. 클로드
                  프로젝트나 제미나이 젬스에서 설계한 결과를 JSON으로 받아{" "}
                  <span className="hl">일괄 등록</span>할 수 있고, MCP로 직접 등록할 수도 있습니다.
                </p>
                <p>
                  JSON 가져오기를 이용하면 반복 입력을 크게 줄일 수 있습니다. 등록 방식은 뒤에서 실제 흐름과 함께
                  설명합니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== Q&A — 무엇을 설계하나 + TREE ===================== */}
      <section className="sec light" id="design-tree" data-screen-label="설계 구조 다이어그램">
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 50 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 그래서 뭘, 어떻게 설계하나요?
              </div>
              <div className="a">
                <p>
                  설계 정보는 <span className="hl">단위업무 &gt; 화면 &gt; 영역 &gt; 기능</span> 순서로 구체화됩니다.
                  큰 업무를 실제 구현할 수 있는 기능 단위까지 단계적으로 나누는 구조입니다.
                </p>
                <p>
                  예를 들어 <b style={{ color: "var(--ink)" }}>'게시판'</b>이라는 단위업무 아래에 게시판 목록·상세·등록이라는{" "}
                  <b style={{ color: "var(--ink)" }}>화면</b>이 있고, 각 화면을 구성하는{" "}
                  <b style={{ color: "var(--ink)" }}>영역</b>, 그 안의 사용자 동작과 시스템 처리를{" "}
                  <b style={{ color: "var(--ink)" }}>기능</b>으로 정의합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="sec-head reveal" style={{ marginBottom: 28 }}>
            <div className="kicker dot">INTERACTIVE — 직접 펼쳐보세요</div>
            <h2 style={{ fontSize: "clamp(26px,3.6vw,42px)" }}>설계 구조 탐색기</h2>
            <p>게시판 예시의 노드를 클릭하면 하위 단계와 각 항목의 상세 내용을 확인할 수 있습니다.</p>
          </div>

          <div className="tree-wrap reveal d1">
            <div className="tree-legend">
              <span className="lvl-chip">
                <i className="c1" />
                단위업무
              </span>
              <span className="lvl-chip">
                <i className="c2" />
                화면
              </span>
              <span className="lvl-chip">
                <i className="c3" />
                영역
              </span>
              <span className="lvl-chip">
                <i className="c4" />
                기능
              </span>
            </div>
            <DesignTree />
          </div>
        </div>
      </section>

      {/* ===================== Q&A PART 3 — 결과물 / PRD / 산출물 ===================== */}
      <section className="sec light-2" data-screen-label="Q&A 산출물">
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 54 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 설계만 하면, 이후는 스펙코드가 다 알아서 해주는 거죠?
              </div>
              <div className="a">
                <p>
                  스펙코드는 입력한 설계 정보를 구조화해 <span className="hl">AI 구현에 사용할 PRD를 생성</span>합니다.
                  개발팀은 이 PRD를 구현 기준으로 사용하고, AI가 만든 결과를 같은 기준으로 검토합니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 좋긴 한데, 그게 다면 좀 아쉬운데요. 열심히 설계했는데.
              </div>
              <div className="a">
                <p>
                  스펙코드 구조에 맞게 정보를 쌓으면 AI 피드백을 통해 누락된 내용을 점검하고,{" "}
                  <span className="hl">다양한 분석·설계 산출물</span>로 내보낼 수 있습니다.
                </p>
                <p>
                  공공 사업에서 반복 작성하는 요구사항정의서, 추적표, 프로그램 사양서, 테이블·컬럼 정의서를 하나의
                  설계 정보에서 생성합니다. 같은 내용을 문서마다 다시 옮기는 작업을 줄이고{" "}
                  <span className="hl">산출물 사이의 기준을 일치</span>시킬 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          <div className="sec-head reveal" style={{ marginBottom: 30 }}>
            <div className="kicker dot">DELIVERABLES — 입력하면, 산출물이 됩니다</div>
            <h2 style={{ fontSize: "clamp(26px,3.6vw,42px)" }}>
              제출용 문서가
              <br />
              자동으로 따라옵니다
            </h2>
          </div>
          <div className="deli-grid reveal d1">
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">요구사항정의서</span>
                <span className="ph">분석</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">과업대비표</span>
                <span className="ph">분석</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">요구사항 추적표</span>
                <span className="ph">분석</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">
                  요구사항명세서
                  <br />
                  (요건정의서)
                </span>
                <span className="ph">분석</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">프로그램 사양서</span>
                <span className="ph">설계</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">테이블 목록</span>
                <span className="ph">설계</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">속성 정의서</span>
                <span className="ph">설계</span>
              </div>
            </div>
            <div className="deli">
              <div className="ico" />
              <div>
                <span className="nm">컬럼정의서</span>
                <span className="ph">설계</span>
              </div>
            </div>
          </div>
          <p className="deli-note reveal d2">
            입력한 정보가 구체적일수록 더 완성도 높은 문서를 만들 수 있습니다.{" "}
            <b>설계에 들인 노력이 그대로 제출 산출물로 이어집니다.</b>
          </p>
        </div>
      </section>

      {/* ===================== Q&A — 타겟 + 설득 ===================== */}
      <section className="sec light" data-screen-label="타겟">
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 56 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 스펙코드는 어떤 팀에 가장 적합한가요?
              </div>
              <div className="a">
                <p>
                  스펙코드는 요구사항이 복잡하고 제출 산출물이 많으며, 구축 이후 운영·유지보수까지 설계 기준이 이어져야
                  하는 <span className="hl">공공 SI 개발팀</span>을 먼저 생각해 만들었습니다. 개발을 처음 접하는 사용자를
                  위한 노코드 도구가 아니라, 분석·설계 경험이 있는 팀의 판단을 더 잘 축적하고 활용하는 도구입니다.
                </p>
                <p>
                  <span className="hl">기존 개발팀이 AI를 더 안정적으로 활용하도록 돕는 것</span>이 목표입니다. 설계
                  기준과 검토 과정 없이 AI를 도입하기 어려웠던 팀이라면 특히 잘 맞습니다.{" "}
                  <b style={{ color: "var(--ink)" }}>AI와 구현하기 전에, AI와 설계하세요.</b>
                </p>
              </div>
            </div>
          </div>

          <div className="sec-head reveal" style={{ marginBottom: 30 }}>
            <div className="kicker dot">WHO IS IT FOR</div>
            <h2 style={{ fontSize: "clamp(26px,3.6vw,42px)" }}>
              이런 팀을 위한
              <br />
              스펙코드입니다
            </h2>
          </div>

          <div className="target-grid">
            <div className="target-list reveal d1">
              <div className="tline yes">
                <span className="yn">FOR</span>
                <div className="tx">
                  산출물과 유지보수가 중요한 공공 SI 사업팀
                  <small>요구사항부터 구축 이후 운영까지 기준이 남아야 하는 프로젝트</small>
                </div>
              </div>
              <div className="tline yes">
                <span className="yn">FOR</span>
                <div className="tx">
                  기존 개발팀 · 현업 개발자<small>AI를 더 잘 활용해 고품질로 개발하고 싶은 팀</small>
                </div>
              </div>
              <div className="tline yes">
                <span className="yn">FOR</span>
                <div className="tx">
                  AI 도입이 두려웠던 SI 개발팀<small>무설계 바이브 코딩의 품질 리스크가 걱정되는 팀</small>
                </div>
              </div>
              <div className="tline no">
                <span className="yn">NOT</span>
                <div className="tx">
                  개발을 전혀 모르는 일반인<small>스펙코드는 설계를 아는 사람을 더 강하게 만드는 도구입니다</small>
                </div>
              </div>
            </div>
            <div className="target-card reveal d2">
              <div className="big">운영까지</div>
              <div className="lab">산출물 · 운영 · 유지보수</div>
              <div className="dv" />
              <p>요구사항과 설계 결정, 제출 산출물을 연결해 구축 이후에도 같은 기준으로 운영하고 유지보수할 수 있습니다.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== DEEP — 분석 → 설계 ===================== */}
      <section className="sec dark-2" data-screen-label="분석→설계 구성">
        <div className="blueprint" />
        <div className="wrap">
          <div className="interject reveal" style={{ marginBottom: 44 }}>
            이제 실제로 어떤 정보를 입력하고, 그 정보가 어떻게 설계와 산출물로 이어지는지 살펴보겠습니다.
          </div>

          <div className="qa-group" style={{ marginBottom: 54 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 스펙코드는 어떻게 구성되어 있죠?
              </div>
              <div className="a">
                <p>
                  스펙코드의 작업 흐름은 크게{" "}
                  <span className="hl">분석 → 설계</span>로 이뤄져 있습니다.
                </p>
                <p>
                  <b style={{ color: "var(--paper)" }}>분석</b>에는 과업·요구사항·스토리보드·기획실이,{" "}
                  <b style={{ color: "var(--paper)" }}>설계</b>에는 단위업무·화면·영역·기능·테이블이 있습니다. 아래
                  카드를 펼쳐 하나씩 확인해 보세요.
                </p>
              </div>
            </div>
          </div>

          <div className="phase-grid">
            {/* 분석 */}
            <div className="phase analyze reveal d1">
              <div className="ph-no">PHASE 01</div>
              <h3>
                분석 <span className="badge">ANALYZE</span>
              </h3>
              <p className="ph-desc">고객이 원하는 것을, 전산을 아는 사람이 만들 수 있는 단위로 정리합니다.</p>
              <PhaseAccordion steps={ANALYZE_STEPS} />
            </div>

            {/* 설계 */}
            <div className="phase design reveal d2">
              <div className="ph-no">PHASE 02</div>
              <h3>
                설계 <span className="badge">DESIGN</span>
              </h3>
              <p className="ph-desc">분석을 바탕으로, 구현 가능한 형태까지 구조를 내려 정의합니다.</p>
              <PhaseAccordion steps={DESIGN_STEPS} />
            </div>
          </div>

          <div className="phase-arrow reveal">
            <span className="ln" /> 분석이 충실할수록, 설계와 구현이 가벼워집니다 <span className="ln" />
          </div>
        </div>
      </section>

      {/* ===================== 설계 = 적는 게 아니라 설계 + 멀티게시판 예시 ===================== */}
      <section className="sec light" data-screen-label="설계 예시 멀티게시판">
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 48 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 만들 시스템의 내용을 적기만 하면 되는 건가요?
              </div>
              <div className="a">
                <p>
                  내용을 기록하는 것에서 시작하지만, 핵심은 <span className="hl">결정하고 연결하는 것</span>입니다.
                  요구사항을 화면과 기능으로 나누고, 각 기능의 동작과 데이터를 구체화해야 구현 기준이 됩니다.
                </p>
                <p>
                  <b style={{ color: "var(--ink)" }}>멀티 게시판</b>을 예로 들면, 먼저 단위업무를 정의하고 목록·등록·상세
                  화면으로 나눕니다. 각 화면의 조회, 검색, 저장 같은 동작을 <span className="hl">기능</span>으로
                  정의하면 <span className="hl">팀과 AI가 같은 구현 범위를 이해</span>할 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          <div className="exmap reveal d1">
            <div className="exmap-unit">
              <span className="k">단위업무</span>
              <span className="nm">멀티 게시판</span>
            </div>
            <div className="exmap-screens">
              <div className="exmap-screen">
                <div className="sh">
                  <span className="badge">화면</span>
                  <span className="nm">게시판 생성</span>
                </div>
                <ul>
                  <li>게시판 생성</li>
                  <li>게시판 설정</li>
                </ul>
              </div>
              <div className="exmap-screen">
                <div className="sh">
                  <span className="badge">화면</span>
                  <span className="nm">게시글 목록</span>
                </div>
                <ul>
                  <li>목록 조회</li>
                  <li>검색 · 페이징</li>
                </ul>
              </div>
              <div className="exmap-screen">
                <div className="sh">
                  <span className="badge">화면</span>
                  <span className="nm">게시글 등록</span>
                </div>
                <ul>
                  <li>게시글 등록</li>
                  <li>임시 저장</li>
                </ul>
              </div>
              <div className="exmap-screen">
                <div className="sh">
                  <span className="badge">화면</span>
                  <span className="nm">게시글 상세</span>
                </div>
                <ul>
                  <li>게시글 조회</li>
                  <li>게시글 수정</li>
                  <li>게시글 삭제</li>
                </ul>
              </div>
            </div>
            <div className="exmap-note">
              단위업무 ▸ 화면 ▸ (영역) ▸ 기능 — 초록 점이 '기능'. 각 기능마다 무슨 일이 벌어질지 상세히 설계합니다.
            </div>
          </div>

          <div className="qa-group" style={{ marginTop: 54 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 영역은 뭐죠? 설명에서 빠졌어요.
              </div>
              <div className="a">
                <p>
                  영역은 <span className="hl">화면을 구성하는 의미 단위</span>입니다. 대시보드처럼 복잡한 화면을 검색,
                  요약, 목록 등의 영역으로 나누면 기능의 위치와 책임을 더 명확하게 관리할 수 있습니다.
                </p>
                <p>
                  별도로 나눌 필요가 없는 단순한 화면은 <span className="hl">화면 1개, 영역 1개</span>로 정의하면
                  됩니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 등록 3방식 + 테이블 ===================== */}
      <section className="sec dark" data-screen-label="등록 3방식">
        <div className="blueprint" />
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 48 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 설계 정보는 스펙코드에 어떻게 등록하나요?
              </div>
              <div className="a">
                <p>
                  직접 입력, AI 작업공간에서 만든 JSON 가져오기, MCP 연동의 <span className="hl">세 가지 방법</span>을
                  제공합니다. 상황에 맞는 방식을 선택하거나 함께 사용할 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          <div className="method-grid reveal d1">
            <div className="method">
              <div className="mno">METHOD 01</div>
              <h4>직접 등록</h4>
              <p>단위업무 → 화면 → 영역 → 기능 구조를 따라, 스펙코드 화면에서 직접 설계 내용을 채워 넣습니다.</p>
              <div className="chips">
                <span>UI 입력</span>
                <span>가장 기본</span>
              </div>
            </div>
            <div className="method">
              <div className="mno">METHOD 02</div>
              <h4>AI 작업공간 + JSON</h4>
              <p>
                'AI 분석 가져오기 / AI 설계 가져오기' 메뉴의 전용 프롬프트를 클로드 프로젝트나 제미나이 젬스에
                적용합니다. AI와 설계한 결과를 JSON으로 내보내 한 번에 등록할 수 있습니다.
              </p>
              <div className="mstep">
                <div className="ms">
                  <i>1</i>전용 프롬프트 복사 → 프로젝트/젬스 생성
                </div>
                <div className="ms">
                  <i>2</i>AI의 질문에 답하며 분석·설계 진행
                </div>
                <div className="ms">
                  <i>3</i>“JSON으로 출력해줘” → 결과를 스펙코드에 등록
                </div>
              </div>
              <div className="chips">
                <span>Claude Projects</span>
                <span>Gemini Gems</span>
                <span>JSON</span>
              </div>
            </div>
            <div className="method">
              <div className="mno">METHOD 03</div>
              <h4>MCP 연동</h4>
              <p>AI와 대화하면서 정리한 내용을 MCP를 통해 스펙코드에 등록하거나 갱신합니다.</p>
              <div className="mstep">
                <div className="ms">
                  <i>!</i>변경 대상과 범위를 <b style={{ color: "var(--cyan-soft)" }}>명확히 지정</b>하면 필요한
                  정보만 안전하게 반영할 수 있습니다.
                </div>
              </div>
              <div className="chips">
                <span>MCP</span>
                <span>실시간 등록</span>
              </div>
            </div>
          </div>

          <div className="qa-group" style={{ marginTop: 54 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 테이블과 컬럼 정보도 함께 관리하나요?
              </div>
              <div className="a">
                <p>
                  네. 설계에 사용하는 <span className="hl">테이블과 컬럼 정보를 프로젝트 기준으로 관리</span>합니다.
                  초기에 자주 바뀌는 데이터 구조를 한곳에서 갱신하고, 기능과의 연결 관계를 함께 남길 수 있습니다.
                </p>
                <p>
                  기능과 데이터 구조를 연결해 두면 컬럼이 바뀌었을 때{" "}
                  <span className="hl">어떤 화면과 기능이 영향을 받는지</span> 확인하고, 사용 중인 컬럼과 정리할 컬럼을
                  구분할 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 기능-테이블 매핑 ===================== */}
      <section className="sec light-2" data-screen-label="기능 테이블 매핑">
        <div className="wrap">
          <div className="qa-group">
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 기능과 데이터 구조는 어떻게 연결하나요?
              </div>
              <div className="a">
                <p>
                  데이터를 읽거나 변경하는 기능에는 관련 <span className="hl">테이블·컬럼을 매핑</span>합니다. 이
                  연결 정보가 구현 범위와 변경 영향을 추적하는 기준이 됩니다.
                </p>
                <p>
                  매핑 과정에서 <span className="hl">어떤 데이터를 조회하고 변경하는지</span>, 다른 데이터와 어떤
                  관계를 갖는지 검토합니다. 구현이 끝난 뒤에도 백엔드와 쿼리의 근거를 설계에서 확인할 수 있습니다.
                </p>
                <p>
                  <span className="lead">AI는 맥락과 검증 기준이 명확할수록 더 일관된 결과를 만듭니다.</span> 구체적인
                  설계는 AI의 구현 입력이면서, 개발팀이 결과를 검토하는 기준이 됩니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 비전 + 로드맵 ===================== */}
      <section className="sec dark-2" data-screen-label="비전">
        <div className="blueprint" />
        <div
          className="glow"
          style={{ width: 480, height: 480, background: "#1fd4e8", bottom: -160, left: -120, opacity: 0.3 }}
        />
        <div className="wrap">
          <div className="vision-banner reveal">
            <div className="v50">NEXT</div>
            <p className="vsub">
              설계 정보가 쌓일수록 <b>검토와 재사용의 가치</b>도 커집니다.
              <br />
              스펙코드는 현재 기능을 기반으로 다음 방향을 준비하고 있습니다.
            </p>
          </div>

          <div className="qa-group" style={{ marginBottom: 40 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 스펙코드는 앞으로 어떤 방향으로 확장하나요?
              </div>
              <div className="a">
                <p>현재 제공하는 분석·설계·산출물 기능을 바탕으로, 다음 세 가지 방향을 단계적으로 확장합니다.</p>
              </div>
            </div>
          </div>

          <div className="roadmap reveal d1">
            <div className="rm">
              <div className="rm-when">
                설계 검토<small>EVOLVE</small>
              </div>
              <div>
                <div className="rm-title">AI 피드백의 범위와 정확도를 높입니다</div>
                <div className="rm-desc">
                  기능 단위로 제공하는 AI 피드백을 더 넓은 설계 범위로 확장해, 누락과 충돌을 검토할 수 있도록
                  고도화합니다.
                </div>
              </div>
            </div>
            <div className="rm">
              <div className="rm-when">
                설계 재사용<small>EXPLORE</small>
              </div>
              <div>
                <div className="rm-title">다른 프로젝트의 설계를 가져옵니다</div>
                <div className="rm-desc">
                  검증된 설계 패턴을 다른 프로젝트에서 참고하고 재사용할 수 있는 기능을 준비합니다.
                </div>
              </div>
            </div>
            <div className="rm">
              <div className="rm-when">
                표준화 연계<small>CONNECT</small>
              </div>
              <div>
                <div className="rm-title">공공 데이터 표준화까지 자동으로</div>
                <div className="rm-desc">
                  <b>표준화닷컴</b>과 연계해 스펙코드에서 설계한 테이블·컬럼을 공공 데이터 표준에 맞게 검토하고 정리하는
                  흐름을 준비합니다.
                </div>
              </div>
            </div>
          </div>

          <div className="quip reveal d2">
            <div className="q-line">
              한 번 입력한 설계를, <span className="grad-text">더 오래 활용하는 플랫폼</span>으로.
            </div>
            <p className="q-sub">
              현재 제공하는 기능과 앞으로 확장할 기능을 구분해 꾸준히 안내하겠습니다.
            </p>
          </div>
        </div>
      </section>

      {/* ===================== FINAL CTA ===================== */}
      <section className="sec final" id="use" data-screen-label="최종 CTA">
        <div className="blueprint" />
        <div className="wrap">
          <div className="kicker reveal">START WITH SPECODE</div>
          <h2 className="reveal d1">
            AI와 구현하기 전에,
            <br />
            <span className="grad-text">AI와 설계하세요.</span>
          </h2>
          <p className="reveal d2">산출물과 유지보수가 중요한 공공 SI를, AI와 함께 일관된 기준으로 완성하는 방법.</p>
          <div className="final-cta reveal d3">
            <Link href={LOGIN_PATH} className="btn btn-primary">
              스펙코드 이용하기 <span className="arr">→</span>
            </Link>
            <a href="#design-tree" className="btn btn-ghost">
              설계 구조 다시 보기
            </a>
          </div>
        </div>
      </section>

      {/* ===================== FOOTER (공용 — 사업자 정보·약관 링크) ===================== */}
      <IntroFooter />

      {/* ===================== STICKY DOCK ===================== */}
      <div className="dock">
        <div className="d-txt">
          AI와 구현하기 전에, AI와 설계하세요<small>공공 SI 실무 최적화 · 산출물부터 유지보수까지</small>
        </div>
        <Link href={LOGIN_PATH} className="btn btn-primary btn-sm">
          이용하기 <span className="arr">→</span>
        </Link>
      </div>
    </div>
  );
}

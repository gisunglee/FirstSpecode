/**
 * IntroAboutPage — SPECODE 인트로 · 전체 소개("스펙코드 소개", 다크 테마) (/intro/about)
 *
 * 역할:
 *   - 스펙코드 전반을 길게 설명하는 풀 소개 페이지 (배경 문제 → 전환 → Q&A →
 *     설계 구조 → 산출물 → 30층 비유 → 타겟 → 분석/설계 구성 → 등록 방식 → 비전)
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

// 회원가입(이용 시작) 경로 — 한 곳에서 관리
const SIGNUP_PATH = "/auth/register";

// ── 분석 단계 스텝 (PHASE 01) ──────────────────────────────────
const ANALYZE_STEPS: PhaseStep[] = [
  {
    si: "a1",
    title: "과업",
    body: "제안요청서(RFP)에 있는 기능 요구사항입니다. Ctrl+C, Ctrl+V로 그대로 옮기면 됩니다.",
    tip: "고객이 하고 싶은 것",
  },
  {
    si: "a2",
    title: "요구사항",
    body: "과업을 요구사항 단위로 분리합니다. 과업과 1:1일 때도, 1:N으로 나뉠 때도, 여러 과업의 일부가 하나로 합쳐질 때도 있습니다. 전산을 아는 사람이 분석·설계·구현하기 적당한 크기의 의미 있는 범위로 잘라냅니다. 인터뷰 내용·디테일·의미·구조를 자세히 적어두면, 나중에 요건정의서가 되고 기획실에서 요긴하게 쓰입니다.",
    tip: "만들기 적당한 의미 단위",
  },
  {
    si: "a3",
    title: "스토리보드",
    body: "애자일 방법론의 방식으로, 요구사항에 대한 스토리를 적습니다. 페르소나를 설정하고 시나리오를 적으며 이용 케이스를 그려보고, 충족되어야 할 인수 조건을 정의합니다. 이 정보는 나중에 AI가 분석·설계 방향을 고민할 때 길을 잡아줍니다.",
    tip: "페르소나 · 시나리오 · 인수조건",
  },
  {
    si: "a4",
    title: "기획실",
    body: "요구사항 & 사용자 스토리를 소스로, AI와 함께 기획을 진행하는 메뉴입니다. 그간 열심히 적어둔 분석 내용에는 이미 많은 정보가 있죠. 이걸 AI에게 주면 화면정의(HTML), 업무 흐름, ERD, 정보구조도 등 다양한 결과를 양질로 돌려줍니다. 물론 그 결과물을 바로 설계에 적용하긴 어렵지만, “어떻게 화면을 만들지, 어떤 프로세스로 갈지” AI에게 먼저 제시받을 수 있습니다. 좋은 분석을 받은 AI는 아주 양질의 결과를 줍니다 — 기존에 보시던 결과와는 차원이 다르죠.",
    tip: "화면정의 · 업무흐름 · ERD · 정보구조도",
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
    body: "하나의 화면을 의미 단위로 나눈 구역입니다. 예: 검색 영역 · 목록 영역 · 입력 영역.",
    tip: "화면 속 구역",
  },
  {
    si: "d4",
    title: "기능",
    body: "각 영역에 존재하는 액션들을 기능으로 정의해 등록합니다. 예: 키워드 검색 · 페이징 · 등록/수정. 이 정의가 곧 구현 대상이 됩니다.",
    tip: "영역의 액션 = 구현 대상",
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
      {/* ===================== NAV ===================== */}
      <nav className="nav">
        <div className="wrap">
          {/* 로고 클릭 시 요약 페이지로 복귀 */}
          <Link href="/intro" className="brand" style={{ textDecoration: "none" }}>
            <span className="b-spec">SPE</span>
            <span className="b-code">CODE</span>
            <span className="b-dot" />
          </Link>
          <div className="nav-right">
            <span className="nav-tag">B2B · 공공 SI 설계 플랫폼</span>
            <a href="#use" className="btn btn-primary btn-sm">
              이용하기 <span className="arr">→</span>
            </a>
          </div>
        </div>
      </nav>

      {/* ===================== HERO ===================== */}
      <header className="hero" data-screen-label="히어로">
        <div className="blueprint" />
        <div
          className="glow"
          style={{ width: 520, height: 520, background: "#2f6bff", top: -120, right: -80 }}
        />
        <div className="wrap">
          <div className="hero-badges reveal">
            <span className="pill b">2~7억 공공 SI 최적화</span>
            <span className="pill">기존 개발팀을 위한</span>
            <span className="pill">PRD · 설계 산출물 자동화</span>
          </div>
          <h1 className="reveal d1">
            <span className="line">AI와 구현하기 전에,</span>
            <span className="line">
              <span className="grad-text">AI와 설계하세요.</span>
            </span>
          </h1>
          <p className="hero-sub reveal d2">
            스펙코드는 우리가 만들 프로그램을 <b>제대로 설계</b>하고, AI에게 최적화된 형태의 문서로 전달해{" "}
            <b>일괄적으로 고품질 구현</b>이 되도록 돕는 — 공공 SI 사업을 위한 AI 설계 플랫폼입니다.
          </p>
          <div className="hero-cta reveal d3">
            <a href="#use" className="btn btn-primary">
              스펙코드 이용하기 <span className="arr">→</span>
            </a>
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
            처음엔 순식간에 만들어지는 화면에 엔돌핀이 돕니다.
            <br />
            하지만 <b>만들수록 시스템은 점점 어긋나기 시작합니다.</b>
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
                바이브 코딩이 정말 다 해줄까요? 개인 프로젝트나 MVP가 아니라, <b>업무가 중심을 이루는 난이도 중(中)
                이상의 프로그램</b>도 전부 AI와 바이브 코딩으로 뚝딱 만들어 — 그대로 서비스할 수 있을까요?
              </p>
              <p className="reveal d2">
                언제 어디서 문제가 터질지 모르는 <b>불안감</b>을 안고, 그렇게 살아가실 건가요?
              </p>
              <p className="hook-cta reveal d3">
                이제 AI와 바이브 코딩하기 전에, <b>AI와 설계하세요.</b> 스펙코드와 함께{" "}
                <span className="grad-text">30층, 안심하고 이용할 수 있는 시스템</span>을 지어보시죠.
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
                <span className="prob-tag">무개념 설계 · 불안감</span>
                <h3>만들수록 길어지는 설명, 그리고 알 수 없는 시스템</h3>
                <p>
                  처음 빠르게 만들어지는 웹사이트를 보며 엔돌핀이 돌기도 합니다. 하지만{" "}
                  <span className="hl">만들고 또 만들수록 내 설명은 점점 길어지고</span>, 정작 어떻게 시스템이
                  만들어졌는지조차 알 수 없게 됩니다.
                </p>
                <p>
                  시스템에 대한 불안감은 늘어나고, 운영 중 수정은{" "}
                  <span className="hl">안정성을 장담할 수 없어 겁이 나서</span> 손대기 어려워집니다.
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
                <span className="prob-tag">아까운 프롬프트 = 설계 정보</span>
                <h3>일주일 전 내가 쓴 프롬프트가, 곧 나의 설계였습니다</h3>
                <p>
                  놀라운 AI와 대화하며 신속하게 프로그램을 완성해 나갑니다. 하루 몇 시간씩 프롬프트를 적어가며 대화하죠.
                  그런데 하루가 지나면 <span className="hl">어제 한 얘기를 다시 하고 있는 나</span>를 보게 됩니다.
                </p>
                <p>
                  일주일 전 내가 작성한 프롬프트가 나의 설계였고 방향이었고 노력이었다면 — 그건 사라지고, 나는 다시
                  설계하고 다시 노력합니다. 메모장 같은 MD 파일에 복잡한 업무를 모두 담을 수 있을까요?{" "}
                  <span className="hl">먼저 AI와 SPEC을 정의하는 것, 분석·설계를 진행하는 것이 정답입니다.</span>
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
                <span className="prob-tag">비효율의 끝판왕 · 무한 프롬프팅</span>
                <h3>말하고 기다리고, 또 말하고 기다리고</h3>
                <p>
                  원래 개발은 분석·설계·구현·테스트로 진행됩니다. 그런데 바이브 코딩 세상이 오며{" "}
                  <span className="hl">아무 준비 없이 바로 구현부터</span> 하는 버릇이 생겼습니다. 분석·설계는 AI가
                  하니까요. 그냥 믿어도 될까요?
                </p>
                <p>
                  구현과 기획, 때론 분석까지 동시에 하다 보면 <span className="hl">무한 프롬프팅</span>에 빠지기
                  쉽습니다. 거의 다 된 것 같고, 처음부터 설명하긴 힘들고, 한 번만 더 말하면 될 것 같고. 시키고 기다리고,
                  시키고 주식 보고, 시키고 쇼츠 보고. 개인의 효율은 올랐을지 몰라도{" "}
                  <span className="hl">팀의 효율도 올랐다고 볼 수 있을까요?</span>
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
                <h3>만들고… 잊혀집니다. 우리 자신에게서도.</h3>
                <p>
                  개발 팀원들이 AI와 나누는 모든 것은 <span className="hl">분석 정보이자 설계 정보</span>입니다.
                  테이블·컬럼 레벨까지 디테일한 업무 설명이 AI에게 전달됐는데도, 그 정보가 팀원에게 공유되지 않는다는 건
                  너무 안타까운 일입니다.
                </p>
                <p>
                  시간이 지나면 그 정보로부터 <span className="hl">자기 자신마저 배제됩니다.</span> 만들고… 잊혀지는
                  겁니다. 시간이 지나면, 우리는 과연 기억할 수 있을까요?
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
            구현 전에 <span className="grad-text">지속적으로 설계</span>하세요.
            <br />
            정통 개발의 순서는, 달라지지 않았습니다.
          </p>
          <p className="small reveal d2" style={{ color: "var(--ink-soft)" }}>
            하루 동안 설계하고, 완성되면 구현으로 넘깁니다.
            <br />그 설계를 담는 곳이 — <b style={{ color: "var(--blue)" }}>스펙코드</b>입니다.
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
                    우리가 만들 프로그램을 설계하고, AI에게 최적화된 형태의 MD 파일로 전달합니다.
                  </span>{" "}
                  그래서 일괄적으로, 흔들림 없이 구현될 수 있도록 합니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 설계요? 뭘 어떻게요?
              </div>
              <div className="a">
                <p>
                  기존에 우리가 하던 것과 동일합니다. 때론 설계 문서 없이 그냥 구현해 오셨겠지만, 그러면{" "}
                  <span className="hl">결과물의 품질을 장담할 수 없습니다.</span> 이제 모든 것은 예전보다 더 상세하게
                  설계되어야 해요.
                </p>
                <p>
                  왜냐하면 <span className="hl">이제 우리에겐 시간이 있으니까요.</span> 구현은 AI가 해주니, 우리는
                  설계에 더 집중할 수 있는 겁니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> AI가 다 해주는 시대에, 너무 구시대적인 발상 아닌가요?
              </div>
              <div className="a">
                <p>
                  아닙니다. AI는 너무 대단하고 뛰어납니다. 하지만 우리가 만들려는 제품을{" "}
                  <span className="hl">“만들어줘”</span>라는 짧은 말로 고품질 결과물을 얻을 수 있을 거라 상상하시는 건
                  아니죠?
                </p>
                <p>
                  설계는 수많은 <span className="hl">선택의 과정</span>입니다. A·B 중 무엇이 좋은지 고르고, 다시 가·나
                  중 무엇이 좋은지 고르는 과정이죠. AI도 잘할 수 있지만, 충분한 배경지식과 프로젝트 정보가 필요합니다.
                  그것 없이 짧은 프롬프트 덩어리로는 <span className="hl">엉뚱한 설계를 내뱉기 일쑤</span>입니다. 설계엔,
                  우리가 필요합니다.
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
                  네, 맞습니다. 저는 <span className="hl">설계에 우리가 필요하고 더 딥하게 설계해야 한다</span>고
                  말씀드렸지, 이 모든 걸 담당자가 직접 다 해야 한다고 하진 않았습니다.
                </p>
                <p>
                  설계도 AI와 함께 해야죠. <span className="hl">구현하기 전에, 신나게 AI와 설계하라는 겁니다.</span> 그
                  내용을 스펙코드에 열심히 입력하다 보면, 어느새 양질의 설계가 완성되어 있을 겁니다.
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
                  맞습니다. 그래서 정보 등록을 위한 <span className="hl">몇 가지 방법</span>을 준비했습니다. 클로드의
                  프로젝트, 제미나이의 잼스를 이용해 스펙코드가 원하는 JSON 형태로 결과를 받아{" "}
                  <span className="hl">일괄 등록</span>할 수 있고, MCP로 직접 등록할 수도 있습니다.
                </p>
                <p>
                  적응되시면, <span className="hl">JSON 등록 기능에 빠지시게 될 겁니다.</span> 등록 방식은 뒤에서
                  자세히 다시 설명드릴게요.
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
                  구조는 이렇습니다. <span className="hl">단위업무 &gt; 화면 &gt; 영역 &gt; 기능.</span> 각 단계에
                  내용을 채워 주시면 됩니다.
                </p>
                <p>
                  예를 들어 <b style={{ color: "var(--ink)" }}>'게시판'</b>이라는 단위업무 아래에 게시판 목록·상세·등록이라는{" "}
                  <b style={{ color: "var(--ink)" }}>화면</b>이 있고, 각 화면을 구성하는{" "}
                  <b style={{ color: "var(--ink)" }}>영역</b>, 그 영역의 액션들을{" "}
                  <b style={{ color: "var(--ink)" }}>기능</b>으로 정의해 등록하는 겁니다.
                </p>
              </div>
            </div>
          </div>

          <div className="sec-head reveal" style={{ marginBottom: 28 }}>
            <div className="kicker dot">INTERACTIVE — 직접 펼쳐보세요</div>
            <h2 style={{ fontSize: "clamp(26px,3.6vw,42px)" }}>설계 구조 탐색기</h2>
            <p>노드를 클릭하면 하위 단계가 펼쳐지고, 오른쪽에 상세가 표시됩니다. (예시: 게시판)</p>
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
                  아닙니다. 스펙코드는{" "}
                  <span className="hl">양질의 PRD를 만들기 위한 설계 정보를 입력받고, 여러분께 PRD를 제공</span>합니다.
                  이 PRD로 AI와 개발하시면, 훨씬 고품질의 프로그램을 얻게 되실 겁니다.
                </p>
              </div>
            </div>

            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 좋긴 한데, 그게 다면 좀 아쉬운데요. 열심히 설계했는데.
              </div>
              <div className="a">
                <p>
                  스펙코드 구조에 맞게 설계하시면, 스펙코드를 통해 <span className="hl">설계 검증</span>을 진행하실 수
                  있습니다. 또한 <span className="hl">다양한 산출물</span>을 제공합니다.
                </p>
                <p>
                  특히 공공 사업은 제출해야 할 설계·구현 산출물이 많은데요, 스펙코드는 입력하신 정보로 여러 설계 문서를
                  만들어 드립니다. 나아가 과업·요구사항·사용자 스토리를 입력받아{" "}
                  <span className="hl">분석 단계 산출물부터</span> 제공하고 있습니다.
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
            그 외에도 입력 정보에 따라 산출물은 계속 확장됩니다. <b>설계에 들인 노력이, 그대로 제출 문서가 됩니다.</b>
          </p>
        </div>
      </section>

      {/* ===================== 30층 빌딩 metaphor ===================== */}
      <section className="sec tower" data-screen-label="30층 빌딩 비유">
        <div className="blueprint" />
        <div className="wrap">
          <div className="interject reveal" style={{ marginBottom: 46 }}>
            “와~ 문서도 준다니 한층 더 매력적이네요. 스펙코드면 뭐든 다 만들 수 있겠어요!”
          </div>
          <div className="kicker dot reveal" style={{ color: "var(--blue-bright)", marginBottom: 22 }}>
            THE METAPHOR
          </div>
          <h2 className="reveal d1">
            초가집은 뚝딱. <em className="grad-text">하지만 30층 빌딩은요?</em>
          </h2>
          <p className="tower-body reveal d2">
            집을 지어주는 AI가 있다고 해봅시다. 단독주택도, 초가집도, 3층짜리 빌라도 뚝딱 만들어 줍니다. 너무 좋죠.
            그런데 <b>15층, 30층, 50층 초고층 빌딩</b>도 “뚝딱 지어줘”라고 하고 — 그 꼭대기에서{" "}
            <b>마음 편히 주무실 수 있겠습니까?</b>
          </p>
          <p className="tower-body reveal d2" style={{ marginTop: 18 }}>
            스펙코드는 AI와 함께 <b>30층 건물을 올리고, 그 위에서 안심하고 잘 수 있도록</b> 돕는 — AI를 위한 설계
            툴입니다. 주요 타깃을 수억 원 규모의 사업으로 정한 것도 “그 정도면 20층 건물은 되겠네” 하는 마음에서였습니다.
          </p>

          <div className="skyline reveal d2">
            <div className="bld easy">
              <div className="box" style={{ height: 70 }} />
              <div className="lab">초가집</div>
              <div className="tag">AI 뚝딱 ✓</div>
            </div>
            <div className="bld easy">
              <div className="box" style={{ height: 110 }} />
              <div className="lab">3층 빌라</div>
              <div className="tag">AI 뚝딱 ✓</div>
            </div>
            <div className="bld">
              <div className="box" style={{ height: 200 }} />
              <div className="lab">15층</div>
              <div className="tag">설계 필요</div>
            </div>
            <div className="bld hard">
              <div className="box" style={{ height: 300 }} />
              <div className="lab">30층 빌딩</div>
              <div className="tag">SPECODE</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== Q&A — 타겟 + 설득 ===================== */}
      <section className="sec light" data-screen-label="타겟">
        <div className="wrap">
          <div className="qa-group" style={{ marginBottom: 56 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 설득당했습니다. 근데… 그래도 AI로 뚝딱 만들고는 싶네요.
              </div>
              <div className="a">
                <p>
                  그 마음, 이해합니다. 스펙코드의 주요 타깃이 <span className="hl">공공 SI 사업</span>인 이유는, 어느
                  정도 <span className="hl">규모가 있기 때문</span>입니다. 개발을 전혀 모르는 일반인을 대상으로 하지
                  않습니다.
                </p>
                <p>
                  <span className="hl">기존 개발자가 AI를 활용해 더 잘 개발하게 만든다.</span> 무설계 바이브 코딩만으로는
                  품질을 장담할 수 없어 AI 도입이 두려운 SI 개발팀에게, 스펙코드를 권합니다.{" "}
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
                  2~7억 규모의 공공 SI 사업팀<small>제출 산출물이 많고, 품질을 장담해야 하는 프로젝트</small>
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
              <div className="big">2~7억</div>
              <div className="lab">PUBLIC SI · OPTIMIZED FOR</div>
              <div className="dv" />
              <p>“그 정도면 20층 건물은 되겠네.” 규모 있는 사업에서, AI와 함께 안심하고 올리는 설계.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== DEEP — 분석 → 설계 ===================== */}
      <section className="sec dark-2" data-screen-label="분석→설계 구성">
        <div className="blueprint" />
        <div className="wrap">
          <div className="interject reveal" style={{ marginBottom: 44 }}>
            “스펙코드의 필요성과 그 의미는 이제 좀 이해한 것 같아요. 그럼 실제로 스펙코드로 어떤 정보를 입력하고
            설계하는지, 구체적으로 설명해 주실 수 있을까요?”
          </div>

          <div className="qa-group" style={{ marginBottom: 54 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 스펙코드는 어떻게 구성되어 있죠?
              </div>
              <div className="a">
                <p>
                  <span className="lead">네, 이제 깊은 얘기를 할 때가 됐습니다.</span> 스펙코드는 크게{" "}
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
                <span className="mark">Q.</span> 그냥 내가 만들 시스템을 적기만 하면 되는 거네요?
              </div>
              <div className="a">
                <p>
                  흠, <span className="hl">반은 맞고 반은 틀립니다.</span> '적는다'보다 '
                  <span className="hl">설계한다</span>'는 표현이 맞습니다. 그럼 설계를 어떻게 하느냐 — 지금 설명드릴게요.
                </p>
                <p>
                  요구사항을 분석하면 결국 “아~ 고객이 원하는 기능은 이런 거구나”가 보입니다.{" "}
                  <b style={{ color: "var(--ink)" }}>멀티 게시판</b>으로 예를 들어볼게요. 그럼 단위업무는 '멀티
                  게시판'이 됩니다. 이제 화면을 설계하고, 각 화면에서 벌어지는 모든 액션을{" "}
                  <span className="hl">기능</span>으로 정의합니다. 이렇게 잘게 쪼개고 각 기능에 어떤 일이 벌어질지
                  상세히 설계하면 — <span className="hl">AI는 우리가 무엇을 만들지 명확히 알게 됩니다.</span>
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
                  영역은 화면과 같은 의미지만 <span className="hl">조금 더 작은 범위</span>입니다. 게시판 목록처럼
                  간단한 화면도 있지만, 대시보드·메인화면처럼 복잡한 화면은 덩치가 너무 크죠. 이럴 때{" "}
                  <span className="hl">영역으로 한 번 더 쪼개서</span> 설계하면 관리하기 좋습니다.
                </p>
                <p>
                  굳이 쪼갤 필요가 없다면? <span className="hl">화면 1개, 영역 1개</span>로 정의하시면 됩니다.
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
                <span className="mark">Q.</span> 아까 AI와 설계하도록 스펙코드가 뭘 도와준다고 했는데, 그게 뭐죠?
              </div>
              <div className="a">
                <p>
                  스펙코드에 정보를 등록하는 방법은 <span className="hl">3가지</span>가 있습니다. 문서를 만드는 게
                  아니라 <span className="hl">AI와 수다를 떨었는데, 그게 설계 자료가 되는</span> 경험을 하시게 될
                  거예요.
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
              <h4>프로젝트 · 젬스 + JSON</h4>
              <p>
                'AI 분석 가져오기 / AI 설계 가져오기' 메뉴에 전용 프롬프트가 준비돼 있습니다. 복사해 클로드
                프로젝트·제미나이 젬스를 만들고, 거기서 설계하세요.
              </p>
              <div className="mstep">
                <div className="ms">
                  <i>1</i>전용 프롬프트 복사 → 프로젝트/젬스 생성
                </div>
                <div className="ms">
                  <i>2</i>“자, 우리 설계할까?” — AI가 묻고 결정하며 진행
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
              <p>AI와 대화하고, 정보 업데이트를 MCP로 등록 요청하면 그대로 반영됩니다.</p>
              <div className="mstep">
                <div className="ms">
                  <i>!</i>어느 정보를 갱신할지 <b style={{ color: "var(--cyan-soft)" }}>명확히</b> 알려주는 버릇 필수
                  — MCP가 엉뚱한 정보를 건드리지 않도록
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
                <span className="mark">Q.</span> 아, 그런데 테이블은요?
              </div>
              <div className="a">
                <p>
                  제가 테이블을 말씀 안 드렸네요. 이건 그냥 <span className="hl">테이블 목록과 컬럼 목록을 적는</span>{" "}
                  겁니다. 솔직히 미쳐버릴 노릇이죠 — 초반엔 테이블이 자주 바뀌고, 복사해 등록하는 것도 너무 귀찮은
                  작업입니다.
                </p>
                <p>
                  하지만 등록해 두면 <span className="hl">초특급 양질의 설계</span>가 가능해집니다. 나중에 컬럼이
                  바뀌었을 때 <span className="hl">어느 프로그램이 영향받는지</span>, 또{" "}
                  <span className="hl">사용 중인 컬럼과 미사용 컬럼</span>까지 파악하실 수 있습니다.
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
                <span className="mark">Q.</span> 테이블·컬럼 정보만 입력했는데, 이게 다 가능한가요?
              </div>
              <div className="a">
                <p>
                  아니요, 제가 빼먹은 게 있습니다. 기능을 설계할 때 그 기능과 연결되는{" "}
                  <span className="hl">테이블·컬럼을 빠짐없이 매핑</span>해 주셔야 합니다. 싹~ 다요. 엄청 불편하지만,
                  그래야 양질의 설계가 완성됩니다. (지금 표정, 상상이 됩니다 ^^;)
                </p>
                <p>
                  다소 귀찮아도 매핑하면서{" "}
                  <span className="hl">이 기능에 어떤 테이블이 쓰이는지, 어떤 테이블과 조인되어야 하는지</span> 고민해
                  주세요. 이 정도는 설계에 참여하셔야, 나중에 AI가 다 구현한 뒤에도 그 속(Backend·Query)이 어떻게
                  생겼을지 그려집니다.
                </p>
                <p>
                  <span className="lead">지금의 AI는 우리가 시키는 대로 거의 실수 없이 만들어 줍니다.</span> 좋은
                  설계였다면, AI는 우리가 설계한 그대로 — 아니, 그보다 더 좋고 안전하게 구현해 냈을 겁니다.
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
            <div className="v50">
              50<small>층</small>
            </div>
            <p className="vsub">
              AI를 이용해 <b>50층 건물</b>까지는 올려봐야겠죠?
              <br />
              안전하게 설계해, 안심하고 쓸 수 있는 시스템을 만드는 것.
            </p>
          </div>

          <div className="qa-group" style={{ marginBottom: 40 }}>
            <div className="qa reveal">
              <div className="q">
                <span className="mark">Q.</span> 좋습니다. 그럼 스펙코드가 꿈꾸는 비전은 무엇인가요?
              </div>
              <div className="a">
                <p>
                  아직은 오픈 전이지만 <span className="hl">(2026.07 예정)</span>, 그리는 방향은 이렇습니다.
                </p>
              </div>
            </div>
          </div>

          <div className="roadmap reveal d1">
            <div className="rm">
              <div className="rm-when">
                설계 검증<small>NEXT</small>
              </div>
              <div>
                <div className="rm-title">AI가 설계의 빈틈을 찾아냅니다</div>
                <div className="rm-desc">
                  입력된 정보를 기반으로 AI가 설계를 <b>검증</b>하고, 빠진 곳·위험한 곳을 찾아 개발팀에게 전달합니다.
                </div>
              </div>
            </div>
            <div className="rm">
              <div className="rm-when">
                설계 가져오기<small>DATA</small>
              </div>
              <div>
                <div className="rm-title">다른 프로젝트의 설계를 가져옵니다</div>
                <div className="rm-desc">
                  데이터가 충분히 모이면, 원하는 프로그램의 설계를 <b>다른 프로젝트에서 가져오는</b> 기능을 기획하고
                  있습니다.
                </div>
              </div>
            </div>
            <div className="rm">
              <div className="rm-when">
                표준화닷컴 연계<small>PUBLIC</small>
              </div>
              <div>
                <div className="rm-title">공공 데이터 표준화까지 자동으로</div>
                <div className="rm-desc">
                  공공 프로젝트에서 데이터 표준화는 중요하지만 다소 귀찮은 작업이죠. <b>'표준화닷컴'</b>과 연계해,
                  스펙코드에서 설계된 테이블·컬럼이 데이터 표준에 맞도록 처리할 예정입니다. 이거 좀 괜찮겠죠? ^^;
                </div>
              </div>
            </div>
          </div>

          <div className="quip reveal d2">
            <div className="q-line">
              “이거… 비전인가요, <span className="grad-text">구현 계획</span>인가요?”
            </div>
            <p className="q-sub">
              “아… 그랬나요? ^^; <b>개발자다 보니~</b>”
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
          <p className="reveal d2">규모 있는 공공 SI를, AI와 함께 안심하고 올리는 방법.</p>
          <div className="final-cta reveal d3">
            <Link href={SIGNUP_PATH} className="btn btn-primary">
              스펙코드 이용하기 <span className="arr">→</span>
            </Link>
            <a href="#design-tree" className="btn btn-ghost">
              설계 구조 다시 보기
            </a>
          </div>
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="foot">
        <div className="wrap">
          <div>
            <div className="brand f-brand">
              <span className="b-spec">SPE</span>
              <span className="b-code">CODE</span>
              <span className="b-dot" />
            </div>
            <p className="f-disc">
              스펙코드는 2~7억 규모 공공 SI 사업에 최적화된 AI 설계 플랫폼입니다. 개발을 전혀 모르는 일반인이 아닌, 기존
              개발팀이 AI를 더 잘 활용하도록 돕습니다.
            </p>
          </div>
          <div className="f-meta">
            ANALYZE → DESIGN → PRD → BUILD
            <br />
            분석 · 설계 · 산출물 자동화
          </div>
        </div>
      </footer>

      {/* ===================== STICKY DOCK ===================== */}
      <div className="dock">
        <div className="d-txt">
          AI와 구현하기 전에, AI와 설계하세요<small>2~7억 공공 SI 최적화 · 기존 개발팀을 위한</small>
        </div>
        <a href="#use" className="btn btn-primary btn-sm">
          이용하기 <span className="arr">→</span>
        </a>
      </div>
    </div>
  );
}

/**
 * IntroPage — SPECODE 인트로 · 요약("한눈에", 화이트 테마) (/intro)
 *
 * 역할:
 *   - 비로그인 방문자 대상 한 화면 요약형 소개 (핵심만 압축)
 *   - 더 긴 전체 설명은 /intro/about(스펙코드 소개)로 연결
 *   - 루트 레이아웃 + IntroLayout(폰트/스타일)만 거쳐 인증 없이 접근 가능
 *
 * 디자인 출처:
 *   - Claude Design 핸드오프 번들 "스펙코드 한눈에 (화이트).html"
 *   - 스타일은 intro.css의 `.sp-intro.is-white` 스코프
 *
 * 인터랙션:
 *   - useIntroEffects: NAV solid 전환, 스티키 도크, .reveal 등장 애니메이션
 */

"use client";

import Link from "next/link";
import { useRef } from "react";
import { useIntroEffects } from "./_components/useIntroEffects";

// 회원가입(이용 시작) 경로 — 한 곳에서 관리
const SIGNUP_PATH = "/auth/register";
// 전체 소개 페이지 경로
const ABOUT_PATH = "/intro/about";

export default function IntroPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  useIntroEffects(rootRef);

  return (
    <div className="sp-intro is-white" ref={rootRef}>
      {/* ===================== NAV ===================== */}
      <nav className="nav">
        <div className="wrap">
          <div className="brand">
            <span className="b-spec">SPE</span>
            <span className="b-code">CODE</span>
            <span className="b-dot" />
          </div>
          <div className="nav-right">
            <Link href={ABOUT_PATH} className="nav-tag" style={{ textDecoration: "none" }}>
              자세히 보기
            </Link>
            <a href="#use" className="btn btn-primary btn-sm">
              이용하기 <span className="arr">→</span>
            </a>
          </div>
        </div>
      </nav>

      {/* ===================== HERO ===================== */}
      <header className="hero lite" data-screen-label="히어로">
        <div className="blueprint" />
        <div className="aurora" />
        <div
          className="glow"
          style={{ width: 520, height: 520, background: "#2f6bff", top: -120, right: -80 }}
        />
        <div className="wrap">
          <div className="hero-badges reveal">
            <span className="pill b">2~7억 공공 SI 최적화</span>
            <span className="pill">기존 개발팀을 위한</span>
            <span className="pill">AI 설계 플랫폼</span>
          </div>
          <h1 className="reveal d1">
            <span className="line">AI와 구현하기 전에,</span>
            <span className="line">
              <span className="grad-text">AI와 설계하세요.</span>
            </span>
          </h1>
          <p className="hero-sub reveal d2">
            바이브 코딩으로 화면은 뚝딱 나오는데, 시스템은 점점 <b>알 수 없게</b> 됩니다. 스펙코드는{" "}
            <b>구현 전에 제대로 설계</b>하고, AI에게 최적화된 문서로 전달해{" "}
            <b>흔들림 없는 고품질 구현</b>이 되도록 돕습니다.
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
      </header>

      {/* ===================== 30층 후킹 (압축) ===================== */}
      <section className="sec dark-2 hook-lite" data-screen-label="30층 후킹">
        <div className="blueprint" />
        <div className="aurora" />
        <div
          className="glow"
          style={{ width: 460, height: 460, background: "#2f6bff", bottom: -160, right: -100, opacity: 0.3 }}
        />
        <div className="wrap">
          <div className="kicker dot reveal" style={{ color: "var(--blue-bright)", justifyContent: "center" }}>
            A QUESTION BEFORE YOU BUILD
          </div>
          <h2 className="reveal d1">
            뚝딱 지은 30층 건물에서,
            <br />
            <span className="grad-text">마음 편히 주무실 수 있나요?</span>
          </h2>

          <div className="skyline reveal d2" style={{ marginTop: 48 }}>
            <div className="bld easy">
              <div className="box" style={{ height: 62 }} />
              <div className="lab">초가집</div>
              <div className="tag">AI 뚝딱 ✓</div>
            </div>
            <div className="bld easy">
              <div className="box" style={{ height: 104 }} />
              <div className="lab">3층 빌라</div>
              <div className="tag">AI 뚝딱 ✓</div>
            </div>
            <div className="bld">
              <div className="box" style={{ height: 184 }} />
              <div className="lab">15층</div>
              <div className="tag">설계 필요</div>
            </div>
            <div className="bld hard">
              <div className="box" style={{ height: 280 }} />
              <div className="lab">30층 빌딩</div>
              <div className="tag">SPECODE</div>
            </div>
          </div>

          <p className="hl-sub reveal d3">
            개인 프로젝트나 MVP가 아니라 <b>업무가 중심인 중(中) 이상 난이도</b>의 시스템을, 설계 없이 AI에게만 맡겨
            그대로 서비스할 수 있을까요? 이제 구현하기 전에 — <b>AI와 설계하세요.</b>
          </p>
        </div>
      </section>

      {/* ===================== WHY — 무설계의 불안 (압축 3카드) ===================== */}
      <section className="sec dark" data-screen-label="왜 설계인가">
        <div className="blueprint" />
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">WHY DESIGN FIRST</div>
            <h2>
              설계 없이 달려온 결과,
              <br />
              <span className="grad-text">팀에 쌓이는 불안</span>
            </h2>
            <p>구현부터 달려오면, 처음의 엔돌핀은 곧 이런 문제들로 바뀝니다.</p>
          </div>

          <div className="why-grid">
            <div className="why reveal d1">
              <div className="wn">01 · 불안한 시스템</div>
              <h3>만들수록 길어지는 설명, 알 수 없는 구조</h3>
              <p>
                설명은 점점 길어지는데 시스템은 점점 <b>알 수 없게</b> 됩니다. 운영 중 수정은 안정성을 장담할 수 없어
                손대기 겁이 납니다.
              </p>
            </div>
            <div className="why reveal d2">
              <div className="wn">02 · 사라지는 설계</div>
              <h3>어제의 프롬프트가 곧 나의 설계였는데</h3>
              <p>
                일주일 전 적은 프롬프트가 나의 설계이자 방향이었습니다. 그런데 그건 <b>휘발되고</b>, 오늘 다시 처음부터
                설계하고 있습니다.
              </p>
            </div>
            <div className="why reveal d3">
              <div className="wn">03 · 닿지 않는 정보</div>
              <h3>AI에게만 전해진 설계, 팀엔 닿지 않음</h3>
              <p>
                테이블·컬럼까지 디테일하게 AI에게 전달한 설계 정보가, <b>팀원에게도 미래의 나에게도</b> 공유되지 않은 채
                잊혀집니다.
              </p>
            </div>
          </div>

          <Link href={ABOUT_PATH} className="more-link reveal">
            네 가지 불안 전체 보기 <span>→</span>
          </Link>
        </div>
      </section>

      {/* ===================== THE TURN ===================== */}
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
            구현은 AI가 해주니, 우리는 <b style={{ color: "var(--blue)" }}>설계에 집중</b>할 수 있습니다.
            <br />그 설계를 담는 곳이 — <b style={{ color: "var(--blue)" }}>스펙코드</b>입니다.
          </p>
        </div>
      </section>

      {/* ===================== WHAT — 핵심 3가치 ===================== */}
      <section className="sec light-2" data-screen-label="스펙코드는">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">WHAT SPECODE DOES</div>
            <h2>
              설계만 하면,
              <br />
              <span className="grad-text">나머지가 따라옵니다</span>
            </h2>
            <p>단위업무 ▸ 화면 ▸ 영역 ▸ 기능. 구조를 따라 AI와 함께 채워 넣으면 됩니다.</p>
          </div>

          <div className="value-grid">
            <div className="value reveal d1">
              <div className="vno">VALUE 01</div>
              <h3>AI와 함께 설계</h3>
              <p>
                혼자 다 적는 게 아닙니다. 직접 등록·Claude/Gemini + JSON·MCP, <b>세 가지 방법</b>으로 AI와 수다 떨 듯
                설계하면 그게 곧 설계 자료가 됩니다.
              </p>
            </div>
            <div className="value reveal d2">
              <div className="vno">VALUE 02</div>
              <h3>양질의 PRD 자동 생성</h3>
              <p>
                입력한 설계 정보로 <b>AI에 최적화된 PRD</b>를 만들어 드립니다. 이 PRD로 개발하면 훨씬 고품질의 프로그램을
                얻게 됩니다.
              </p>
            </div>
            <div className="value reveal d3">
              <div className="vno">VALUE 03</div>
              <h3>제출 산출물 자동</h3>
              <p>
                요구사항정의서·과업대비표·테이블 목록·컬럼정의서까지. <b>설계에 들인 노력이, 그대로 제출 문서</b>가
                됩니다.
              </p>
            </div>
          </div>

          <div className="mini-pipe reveal d2">
            <span className="mp">분석</span>
            <span className="ar">→</span>
            <span className="mp hl">설계 — SPEC</span>
            <span className="ar">→</span>
            <span className="mp">PRD</span>
            <span className="ar">→</span>
            <span className="mp">고품질 구현</span>
            <span className="ar">→</span>
            <span className="mp">제출 산출물</span>
          </div>

          <Link href={ABOUT_PATH} className="more-link reveal">
            설계 구조·산출물 자세히 보기 <span>→</span>
          </Link>
        </div>
      </section>

      {/* ===================== FOR WHO (압축) ===================== */}
      <section className="sec dark" data-screen-label="누구를 위해">
        <div className="blueprint" />
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">WHO IS IT FOR</div>
            <h2>
              이런 팀을 위한
              <br />
              <span className="grad-text">스펙코드입니다</span>
            </h2>
          </div>

          <div className="for-lite">
            <div className="for-line yes reveal d1">
              <span className="fy">FOR</span>
              <span className="ft">
                2~7억 규모의 공공 SI 사업팀<small>제출 산출물이 많고, 품질을 장담해야 하는 프로젝트</small>
              </span>
            </div>
            <div className="for-line yes reveal d1">
              <span className="fy">FOR</span>
              <span className="ft">
                기존 개발팀 · AI 도입이 두려웠던 SI 팀<small>AI를 더 잘 활용해 고품질로 개발하고 싶은 팀</small>
              </span>
            </div>
            <div className="for-line no reveal d2">
              <span className="fy">NOT</span>
              <span className="ft">
                개발을 전혀 모르는 일반인<small>스펙코드는 설계를 아는 사람을 더 강하게 만드는 도구입니다</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== FINAL CTA ===================== */}
      <section className="sec final" id="use" data-screen-label="최종 CTA">
        <div className="blueprint" />
        <div className="aurora" />
        <div className="wrap">
          <div className="kicker reveal">START WITH SPECODE</div>
          <h2 className="reveal d1">
            AI와 구현하기 전에,
            <br />
            <span className="grad-text">AI와 설계하세요.</span>
          </h2>
          <p className="reveal d2">
            규모 있는 공공 SI를, AI와 함께 안심하고 올리는 방법.{" "}
            <span style={{ color: "var(--paper-faint)", fontFamily: "var(--mono)", fontSize: "0.9em" }}>
              (2026.07 오픈 예정)
            </span>
          </p>
          <div className="final-cta reveal d3">
            <Link href={SIGNUP_PATH} className="btn btn-primary">
              스펙코드 이용하기 <span className="arr">→</span>
            </Link>
            <Link href={ABOUT_PATH} className="btn btn-ghost">
              전체 소개 보기
            </Link>
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

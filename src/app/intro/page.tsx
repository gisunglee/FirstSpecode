/**
 * IntroPage — SPECODE 시스템 소개 (/intro)
 *
 * 역할:
 *   - 비로그인 방문자 대상의 풀스크린 시스템 소개 (히어로 → 가치 → 모듈 → 사용 흐름)
 *   - 인증 없이 접근 가능. (auth)/(main) 레이아웃을 거치지 않고 루트 레이아웃만 사용
 *   - 우측 상단 로그인 / 회원가입 CTA 제공
 *
 * 디자인 원칙:
 *   - data-theme="dark" 고정 (퍼블릭 진입 화면 — 로그인 후 사용자 테마와 무관)
 *   - DS_TOKENS / DS_COMPONENTS 규칙 준수: 모든 색·간격·반경·폰트는 semantic 토큰만 사용
 *   - 컴포넌트 클래스는 sp-* prefix
 */

import Link from "next/link";
import type { CSSProperties } from "react";

// ─── 콘텐츠 상수 ─────────────────────────────────────────────────
// 의도: 카피·모듈 목록을 한 곳에서 관리하면 문구만 바꿔도 레이아웃 영향 없음
// (단위업무 그룹 기준으로 5개 모듈 정리 — biz/A.단위업무.md 와 동기화)

type ValueCard = { icon: string; title: string; desc: string };

const CORE_VALUES: ValueCard[] = [
  {
    icon:  "📐",
    title: "표준화된 설계",
    desc:  "요구사항부터 화면·영역·기능까지 표준 레이어로 정렬해, 누가 만들어도 같은 결과로 수렴합니다.",
  },
  {
    icon:  "🔗",
    title: "끊김 없는 추적성",
    desc:  "RQ → UW → PID(화면) → 기능까지 한 줄로 이어지는 추적 체계로, 변경 이력과 영향 범위를 즉시 파악합니다.",
  },
  {
    icon:  "✨",
    title: "AI 생산성 가속",
    desc:  "AI 태스크와 일괄 설계가 반복 작업을 대체합니다. 사람은 의사결정에, AI는 산출물 초안에 집중합니다.",
  },
  {
    icon:  "👥",
    title: "협업 우선",
    desc:  "역할 기반 권한, 멤버 초대, 변경 이력 자동 관리로 팀이 같은 그림을 보며 안전하게 함께 일합니다.",
  },
];

type ModuleCard = {
  no:     string;
  title:  string;
  range:  string;
  desc:   string;
  points: string[];
};

const MODULES: ModuleCard[] = [
  {
    no:     "01",
    title:  "인증 · 회원",
    range:  "UW-00001 ~ 00007",
    desc:   "이메일·소셜 로그인부터 JWT 인증, 프로필·비밀번호 재설정, 회원 탈퇴까지 회원 라이프사이클 전체를 다룹니다.",
    points: ["이메일/소셜 로그인", "JWT 인증·세션", "비밀번호 재설정", "회원 프로필·탈퇴"],
  },
  {
    no:     "02",
    title:  "프로젝트 · 멤버",
    range:  "UW-00008 ~ 00013",
    desc:   "프로젝트 단위로 작업 공간을 나누고, 멤버 초대·역할·권한·탈퇴까지 협업의 기반을 제공합니다.",
    points: ["프로젝트 생성·설정", "멤버 초대·수락", "역할 관리 (Owner/Admin/Member)", "접근 권한 제어"],
  },
  {
    no:     "03",
    title:  "요구사항 · 기획",
    range:  "UW-00014 ~ 00019",
    desc:   "과업·요구사항·사용자스토리·단위업무를 트리 구조로 묶어, 기획의 변경 이력과 기준선까지 관리합니다.",
    points: ["과업·요구사항 CRUD", "사용자스토리·단위업무", "요구사항 이력·Diff", "기획 트리 인라인 편집"],
  },
  {
    no:     "04",
    title:  "설계",
    range:  "UW-00020 ~ 00026",
    desc:   "화면·영역·기능을 계층으로 설계하고 Excalidraw 와 컬럼 매핑까지 한 워크스페이스에서 진행합니다.",
    points: ["화면·영역·기능 CRUD", "Excalidraw 영역 설계", "컬럼 매핑 관리", "설계 피드백·알림"],
  },
  {
    no:     "05",
    title:  "AI · 표준 가이드",
    range:  "UW-00027 ~ 00034",
    desc:   "일괄 설계, 요구사항 허브, 표준 가이드 검토와 검색까지 — AI 가 표준에 맞는 산출물을 생성·검토합니다.",
    points: ["일괄 설계(BulkDesign)", "AI 표준 가이드 검토", "AI 기획 산출물 생성", "표준 가이드 검색"],
  },
];

const FLOW_STEPS = [
  { icon: "📝", title: "요구사항",  desc: "RQ·UW·사용자스토리 정의" },
  { icon: "🎨", title: "설계",      desc: "화면·영역·기능 + Excalidraw" },
  { icon: "🤖", title: "AI 생성",   desc: "AI 태스크·일괄 설계·산출물" },
  { icon: "🧪", title: "테스트",    desc: "테스트 스펙·라운드 실행" },
];

// ─── 인라인 스타일 (semantic 토큰만 사용) ─────────────────────────
// CSS 모듈을 새로 만들지 않은 이유: 이 페이지 전용 1회성 레이아웃이라
//   별도 파일로 분리하면 추적이 더 어렵다. 토큰만 쓰면 테마 전환은 그대로 동작함.

const pageWrap: CSSProperties = {
  minHeight:  "100vh",
  background: "var(--color-bg-root)",
  color:      "var(--color-text-primary)",
};

const container: CSSProperties = {
  maxWidth: 1180,
  margin:   "0 auto",
  padding:  "0 var(--space-6)",
};

const topBar: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  padding:        "var(--space-4) var(--space-6)",
  borderBottom:   "1px solid var(--color-border-subtle)",
  background:     "var(--color-bg-titlebar)",
  position:       "sticky",
  top:            0,
  zIndex:         10,
};

const logoBox: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        "var(--space-2)",
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-primary)",
  letterSpacing: 0.4,
};

const logoIcon: CSSProperties = {
  width:        24,
  height:       24,
  borderRadius: "var(--radius-sm)",
  background:   "var(--color-accent-subtle)",
  color:        "var(--color-accent)",
  display:      "inline-flex",
  alignItems:   "center",
  justifyContent: "center",
  fontSize:     "var(--text-base)",
};

const hero: CSSProperties = {
  padding:    "var(--space-12) 0 var(--space-10)",
  textAlign:  "center",
};

const heroTitle: CSSProperties = {
  fontSize:   "var(--text-4xl)",
  fontWeight: 800,
  color:      "var(--color-text-primary)",
  lineHeight: 1.2,
  margin:     "0 0 var(--space-4)",
  letterSpacing: -0.4,
};

const heroSub: CSSProperties = {
  fontSize:   "var(--text-lg)",
  color:      "var(--color-text-secondary)",
  margin:     "0 auto",
  maxWidth:   720,
  lineHeight: 1.6,
};

const heroCta: CSSProperties = {
  display:        "flex",
  justifyContent: "center",
  gap:            "var(--space-3)",
  marginTop:      "var(--space-6)",
};

const sectionWrap: CSSProperties = {
  padding: "var(--space-10) 0",
};

const sectionHeader: CSSProperties = {
  textAlign: "center",
  marginBottom: "var(--space-8)",
};

const sectionEyebrow: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color:         "var(--color-brand)",
  fontWeight:    700,
  marginBottom:  "var(--space-2)",
};

const sectionTitle: CSSProperties = {
  fontSize:   "var(--text-2xl)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     0,
};

const sectionDesc: CSSProperties = {
  fontSize:   "var(--text-base)",
  color:      "var(--color-text-secondary)",
  marginTop:  "var(--space-2)",
};

const valueGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap:                 "var(--space-4)",
};

const valueIcon: CSSProperties = {
  width:        40,
  height:       40,
  borderRadius: "var(--radius-card)",
  background:   "var(--color-brand-subtle)",
  display:      "inline-flex",
  alignItems:   "center",
  justifyContent: "center",
  fontSize:     "var(--text-xl)",
  marginBottom: "var(--space-3)",
};

const valueTitle: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-2)",
};

const valueDesc: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.6,
  margin:     0,
};

const moduleGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap:                 "var(--space-4)",
};

const moduleNo: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  color:         "var(--color-text-tertiary)",
  fontWeight:    700,
  fontFamily:    "var(--font-mono, ui-monospace)",
};

const moduleTitle: CSSProperties = {
  fontSize:   "var(--text-xl)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "var(--space-1) 0 var(--space-2)",
};

const moduleDesc: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.6,
  margin:     "0 0 var(--space-3)",
};

const moduleList: CSSProperties = {
  listStyle: "none",
  padding:   0,
  margin:    0,
  display:   "flex",
  flexDirection: "column",
  gap:       "var(--space-2)",
};

const moduleListItem: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  display:    "flex",
  alignItems: "center",
  gap:        "var(--space-2)",
};

const moduleBullet: CSSProperties = {
  width:        6,
  height:       6,
  borderRadius: "var(--radius-full)",
  background:   "var(--color-brand)",
  flexShrink:   0,
};

// ─── 사용 흐름 다이어그램 ──
// 4단계 가로 배치. 모바일에서는 자동으로 세로 스택됨 (flex-wrap).
const flowWrap: CSSProperties = {
  display:        "flex",
  alignItems:     "stretch",
  justifyContent: "center",
  flexWrap:       "wrap",
  gap:            "var(--space-3)",
};

const flowStep: CSSProperties = {
  flex:           "1 1 200px",
  minWidth:       180,
  maxWidth:       240,
  background:     "var(--color-bg-card)",
  border:         "1px solid var(--color-border)",
  borderRadius:   "var(--radius-card)",
  padding:        "var(--space-5) var(--space-4)",
  textAlign:      "center",
  boxShadow:      "var(--shadow-card)",
};

const flowStepIcon: CSSProperties = {
  fontSize:     "var(--text-3xl)",
  marginBottom: "var(--space-2)",
};

const flowStepTitle: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-1)",
};

const flowStepDesc: CSSProperties = {
  fontSize:   "var(--text-xs)",
  color:      "var(--color-text-secondary)",
  margin:     0,
  lineHeight: 1.5,
};

const flowArrow: CSSProperties = {
  alignSelf:    "center",
  fontSize:     "var(--text-xl)",
  color:        "var(--color-brand)",
  fontWeight:   700,
};

const footerWrap: CSSProperties = {
  padding:    "var(--space-10) 0 var(--space-12)",
  textAlign:  "center",
};

const footerTitle: CSSProperties = {
  fontSize:   "var(--text-2xl)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-3)",
};

const footerDesc: CSSProperties = {
  fontSize:   "var(--text-base)",
  color:      "var(--color-text-secondary)",
  margin:     "0 0 var(--space-5)",
};

const copyright: CSSProperties = {
  fontSize:    "var(--text-xs)",
  color:       "var(--color-text-tertiary)",
  marginTop:   "var(--space-8)",
  paddingTop:  "var(--space-4)",
  borderTop:   "1px solid var(--color-border-subtle)",
};

// ─── 컴포넌트 본체 ─────────────────────────────────────────────────
// 서버 컴포넌트로 둠 — 인터랙티브 상태가 없으므로 "use client" 불필요
export default function IntroPage() {
  return (
    // data-theme="dark" 를 래퍼에 고정:
    //   퍼블릭 페이지 진입 시점에는 사용자 테마 설정을 알 수 없으므로
    //   인증 화면과 동일하게 dark 톤으로 통일한다.
    <div data-theme="dark" style={pageWrap}>
      {/* ── 상단바 ────────────────────────────────────────── */}
      <header style={topBar}>
        <div style={logoBox}>
          <span style={logoIcon}>⚡</span>
          SPECODE
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Link href="/auth/login" className="sp-btn sp-btn-ghost sp-btn-sm">
            로그인
          </Link>
          <Link href="/auth/register" className="sp-btn sp-btn-primary sp-btn-sm">
            시작하기
          </Link>
        </div>
      </header>

      {/* ── 히어로 ─────────────────────────────────────────── */}
      <section style={container}>
        <div style={hero}>
          <div style={{ marginBottom: "var(--space-4)" }}>
            <span className="sp-badge sp-badge-brand">
              <span className="dot" />
              AI 기반 SPEC → CODE 플랫폼
            </span>
          </div>
          <h1 style={heroTitle}>
            요구사항부터 코드까지,<br />
            끊김 없이 이어지는 설계 흐름
          </h1>
          <p style={heroSub}>
            SPECODE는 요구사항·기획·설계·AI 산출물을 하나의 추적 가능한 체계로 묶어,
            팀이 표준화된 설계와 AI 생산성을 동시에 누리도록 돕습니다.
          </p>
          <div style={heroCta}>
            <Link href="/auth/register" className="sp-btn sp-btn-primary sp-btn-lg">
              무료로 시작하기
            </Link>
            <Link href="/auth/login" className="sp-btn sp-btn-secondary sp-btn-lg">
              로그인
            </Link>
          </div>
        </div>
      </section>

      {/* ── 핵심 가치 ─────────────────────────────────────── */}
      <section style={container}>
        <div style={sectionWrap}>
          <div style={sectionHeader}>
            <div style={sectionEyebrow}>Core Values</div>
            <h2 style={sectionTitle}>왜 SPECODE 인가</h2>
            <p style={sectionDesc}>설계와 AI 사이의 간극을 메우는 네 가지 원칙</p>
          </div>

          <div style={valueGrid}>
            {CORE_VALUES.map((v) => (
              <div key={v.title} className="sp-group">
                <div className="sp-group-body">
                  <div style={valueIcon}>{v.icon}</div>
                  <h3 style={valueTitle}>{v.title}</h3>
                  <p style={valueDesc}>{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5개 모듈 소개 ─────────────────────────────────── */}
      <section style={container}>
        <div style={sectionWrap}>
          <div style={sectionHeader}>
            <div style={sectionEyebrow}>Modules</div>
            <h2 style={sectionTitle}>5개 모듈, 하나의 설계 체계</h2>
            <p style={sectionDesc}>총 35개 단위업무(UW)를 5개 모듈로 묶어 일관성 있게 운영합니다</p>
          </div>

          <div style={moduleGrid}>
            {MODULES.map((m) => (
              <div key={m.no} className="sp-group">
                <div className="sp-group-header">
                  <div className="sp-group-title">
                    <span style={moduleNo}>MODULE {m.no}</span>
                  </div>
                  <span className="sp-badge sp-badge-neutral">{m.range}</span>
                </div>
                <div className="sp-group-body">
                  <h3 style={moduleTitle}>{m.title}</h3>
                  <p style={moduleDesc}>{m.desc}</p>
                  <ul style={moduleList}>
                    {m.points.map((p) => (
                      <li key={p} style={moduleListItem}>
                        <span style={moduleBullet} />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 사용 흐름 다이어그램 ─────────────────────────── */}
      <section style={container}>
        <div style={sectionWrap}>
          <div style={sectionHeader}>
            <div style={sectionEyebrow}>Workflow</div>
            <h2 style={sectionTitle}>한 흐름으로 이어지는 작업</h2>
            <p style={sectionDesc}>
              요구사항에서 테스트까지, 단계 사이의 추적 정보가 자동으로 연결됩니다
            </p>
          </div>

          <div style={flowWrap}>
            {FLOW_STEPS.map((step, idx) => (
              // Fragment 대신 배열 매핑 — 각 단계 뒤에 화살표를 끼워 넣기 위함
              <FlowItem
                key={step.title}
                step={step}
                showArrow={idx < FLOW_STEPS.length - 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── 푸터 CTA ──────────────────────────────────────── */}
      <section style={container}>
        <div style={footerWrap}>
          <h2 style={footerTitle}>지금 SPECODE를 시작하세요</h2>
          <p style={footerDesc}>
            팀의 첫 프로젝트를 만들고 요구사항부터 AI 산출물까지 한 번에 경험해 보세요.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)" }}>
            <Link href="/auth/register" className="sp-btn sp-btn-primary sp-btn-lg">
              무료로 시작하기
            </Link>
            <Link href="/dashboard" className="sp-btn sp-btn-ghost sp-btn-lg">
              데모 살펴보기
            </Link>
          </div>
          <div style={copyright}>
            © SPECODE — AI 기반 SPEC → CODE 플랫폼
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── 사용 흐름 단계 (분리 이유) ─────────────────────────────────
// 같은 JSX 블록(아이콘 + 제목 + 설명 + 화살표) 이 4번 반복되므로 별도 컴포넌트로 추출.
// A-NEXTJS-기술규칙 7-⑤: "같은 JSX 블록이 2곳 이상 → 컴포넌트 추출".
type FlowStepData = { icon: string; title: string; desc: string };

function FlowItem({ step, showArrow }: { step: FlowStepData; showArrow: boolean }) {
  return (
    <>
      <div style={flowStep}>
        <div style={flowStepIcon}>{step.icon}</div>
        <h3 style={flowStepTitle}>{step.title}</h3>
        <p style={flowStepDesc}>{step.desc}</p>
      </div>
      {showArrow && <div style={flowArrow}>→</div>}
    </>
  );
}

/**
 * IntroPage — SPECODE 시스템 소개 (/intro)
 *
 * 역할:
 *   - 비로그인 방문자 대상 풀스크린 시스템 소개
 *   - "AI 시대의 설계"라는 SPECODE의 사상부터 분석·설계 구성·입력 방법·산출물까지 한 페이지로
 *   - (auth)/(main) 레이아웃을 거치지 않고 루트 레이아웃만 사용 → 인증 없이 접근 가능
 *
 * 디자인 원칙:
 *   - data-theme="dark" 고정 (퍼블릭 진입 화면)
 *   - DS_TOKENS / DS_COMPONENTS 규칙: 모든 색·간격·반경·폰트는 semantic 토큰만 사용
 *   - 컴포넌트 클래스는 sp-* prefix
 *
 * 콘텐츠 톤:
 *   - 사용자(서비스 오너) 화법을 그대로 살림. 도발적이고 솔직한 어조
 *   - 화려한 카피보다 "정말 그렇게 생각하시나요?" 식의 직설
 *
 * 타겟 (사용자 확정):
 *   - 2~7억 규모 공공 SI 사업 개발팀
 *   - AI 기반 개발에 두려움이 있는 SI 개발자
 *   - 일반인·바이브코더 대상 아님
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// ════════════════════════════════════════════════════════════════
//  콘텐츠 상수 — 카피만 바꿔도 레이아웃 영향 없도록 한 곳에 모음
// ════════════════════════════════════════════════════════════════

// ── 시대 진단: 4가지 불편 ────────────────────────────────────────
type PainPoint = { num: string; head: string; sub: string; body: string };

const PAIN_POINTS: PainPoint[] = [
  {
    num:  "01",
    head: "무개념 설계, 늘어나는 불안",
    sub:  "처음엔 신났지만…",
    body: "빠르게 만들어지는 화면에 엔돌핀이 돕니다. 그런데 만들수록 내 설명은 길어지고, 정작 시스템이 어떻게 만들어졌는지는 모르겠습니다. 운영 중 수정은 점점 겁이 납니다.",
  },
  {
    num:  "02",
    head: "사라지는 프롬프트, 아까운 설계",
    sub:  "어제 한 얘기를 또 합니다.",
    body: "하루 몇 시간을 들여 AI 와 나눈 대화 — 그게 사실 내 설계였고 방향이었습니다. 일주일이 지나면 흩어지고, 나는 다시 설명하고 있습니다. MD 메모만으로 복잡한 업무를 잡을 수 있나요? 어렵습니다.",
  },
  {
    num:  "03",
    head: "무한 프롬프팅의 늪",
    sub:  "시키고, 기다리고, 또 시키고…",
    body: "분석·설계 없이 구현부터 들어갑니다. 시키고 주식 보고, 시키고 쇼츠 보기가 반복됩니다. 개인 효율은 올랐을지 몰라도 팀 효율도 그럴까요? 구현 전에 설계해야 합니다. 그건 예나 지금이나 같습니다.",
  },
  {
    num:  "04",
    head: "공유되지 않는 설계",
    sub:  "혼자 알고, 결국 본인도 잊습니다.",
    body: "테이블·컬럼 수준의 디테일한 설명이 AI 에게는 전달되지만, 팀원에게는 가지 않습니다. 시간이 지나면 만든 사람 본인도 그 정보에서 배제됩니다. 우리는 기억할 수 있을까요?",
  },
];

// ── SPECODE 3대 원칙 ────────────────────────────────────────────
type Principle = { icon: string; title: string; body: string };

const PRINCIPLES: Principle[] = [
  {
    icon:  "📐",
    title: "구현 전에 설계한다",
    body:  "AI 가 구현을 가져갔으니, 우리는 설계에 더 집중할 수 있습니다. 시간이 생겼으니까요. 설계는 선택의 과정 — A 와 B, 가와 나를 사람이 골라야 합니다.",
  },
  {
    icon:  "💾",
    title: "설계는 사라지지 않는다",
    body:  "AI 와 나눈 모든 분석·설계 정보가 SPECODE 에 쌓입니다. 프롬프트로 흩어지지 않고, 팀이 같은 그림을 보며, 시간이 지나도 본인이 다시 읽을 수 있습니다.",
  },
  {
    icon:  "📄",
    title: "AI 가 가장 잘 먹는 PRD 로 출력한다",
    body:  "SPECODE 는 입력된 설계를 AI 구현에 최적화된 PRD 로 만들어 돌려줍니다. 이 PRD 를 들고 AI 와 구현하면 결과물의 품질이 달라집니다.",
  },
];

// ── 분석 4요소 ──────────────────────────────────────────────────
type AnalysisItem = { num: string; title: string; desc: string; output: string };

const ANALYSIS_ITEMS: AnalysisItem[] = [
  {
    num:    "01",
    title:  "과업",
    desc:   "제안요청서(RFP)의 기능 요구사항을 그대로 가져옵니다. Ctrl+C, Ctrl+V 그 자체입니다. 고객이 하고 싶은 것의 원본.",
    output: "→ 과업대비표의 원천",
  },
  {
    num:    "02",
    title:  "요구사항",
    desc:   "과업을 의미 있는 크기로 자릅니다. 1:1 이기도 하고 1:N 이기도, 때론 N:1 로 합쳐지기도 합니다. 인터뷰 내용·디테일·의미·구조까지 자세히 적습니다.",
    output: "→ 요건정의서 · 기획실의 소스",
  },
  {
    num:    "03",
    title:  "스토리보드",
    desc:   "애자일 방식 그대로 — 페르소나, 시나리오, 인수 조건을 적습니다. AI 가 분석·설계 방향을 잡을 때 나침반이 됩니다.",
    output: "→ 사용자 스토리 산출물",
  },
  {
    num:    "04",
    title:  "기획실",
    desc:   "요구사항·사용자스토리를 소스로 AI 와 함께 기획합니다. 화면 정의(HTML), 업무 흐름, ERD, 정보 구조도 — 좋은 분석을 받은 AI 는 날아다닙니다.",
    output: "→ 설계 단계 진입 준비",
  },
];

// ── 설계 5요소 ──────────────────────────────────────────────────
type DesignItem = { num: string; title: string; desc: string };

const DESIGN_ITEMS: DesignItem[] = [
  { num: "01", title: "단위업무",   desc: "기능 묶음의 최상위 단위. 예) 게시판" },
  { num: "02", title: "화면",       desc: "단위업무를 구성하는 화면 단위. 예) 게시판 목록 · 상세 · 등록" },
  { num: "03", title: "영역",       desc: "한 화면 내의 영역 분할. 예) 검색 영역, 목록 영역" },
  { num: "04", title: "기능",       desc: "영역에 존재하는 액션. 예) 검색, 페이지 이동, 상세 이동" },
  { num: "05", title: "테이블",     desc: "데이터 모델. 화면·기능과 컬럼 단위로 연결됨" },
];

// ── 게시판 예시 트리 ───────────────────────────────────────────
// (시각화용 — 사용자가 든 "게시판" 예시를 트리로 표현)
type TreeNode = { label: string; type: "uw" | "screen" | "area" | "fn"; children?: TreeNode[] };

const BOARD_TREE: TreeNode = {
  label: "게시판",
  type:  "uw",
  children: [
    {
      label: "게시판 목록",
      type:  "screen",
      children: [
        {
          label: "검색 영역",
          type:  "area",
          children: [
            { label: "검색", type: "fn" },
            { label: "초기화", type: "fn" },
          ],
        },
        {
          label: "목록 영역",
          type:  "area",
          children: [
            { label: "페이지 이동", type: "fn" },
            { label: "상세 이동", type: "fn" },
          ],
        },
      ],
    },
    {
      label: "게시판 상세",
      type:  "screen",
      children: [
        { label: "본문 영역", type: "area", children: [
          { label: "수정 이동", type: "fn" },
          { label: "삭제", type: "fn" },
        ]},
      ],
    },
    {
      label: "게시판 등록",
      type:  "screen",
      children: [
        { label: "입력 영역", type: "area", children: [
          { label: "저장", type: "fn" },
          { label: "취소", type: "fn" },
        ]},
      ],
    },
  ],
};

// ── 입력 방법 3가지 ─────────────────────────────────────────────
type InputMethod = { tag: string; title: string; desc: string; recommend: boolean };

const INPUT_METHODS: InputMethod[] = [
  {
    tag:       "RECOMMENDED",
    title:     "JSON 일괄 등록",
    desc:      "Claude 프로젝트 · Gemini Gems 에서 SPECODE 가 원하는 JSON 포맷으로 결과를 받아 한 번에 등록합니다. 적응되면 이 방식에 빠지게 됩니다.",
    recommend: true,
  },
  {
    tag:       "OPTION",
    title:     "MCP 직접 등록",
    desc:      "Claude Code 등 MCP 클라이언트에서 SPECODE MCP 를 통해 곧바로 정보를 등록합니다. AI 와 대화하다 그 자리에서 저장.",
    recommend: false,
  },
  {
    tag:       "OPTION",
    title:     "수동 UI 등록",
    desc:      "SPECODE 의 화면에서 직접 입력합니다. 정밀 편집·검토·수정에 가장 직관적입니다.",
    recommend: false,
  },
];

// ── 산출물 ──────────────────────────────────────────────────────
type Deliverable = { name: string; kind: "분석" | "설계" | "구현" };

const DELIVERABLES: Deliverable[] = [
  { name: "요구사항정의서",            kind: "분석" },
  { name: "과업대비표",                kind: "분석" },
  { name: "요구사항 추적표",           kind: "분석" },
  { name: "요구사항명세서 (요건정의서)", kind: "분석" },
  { name: "프로그램 사양서",           kind: "설계" },
  { name: "테이블 목록",               kind: "설계" },
  { name: "속성 정의서",               kind: "설계" },
  { name: "컬럼정의서",                kind: "설계" },
  { name: "PRD (AI 구현용)",           kind: "구현" },
];

// ════════════════════════════════════════════════════════════════
//  스타일 (semantic 토큰만 사용)
// ════════════════════════════════════════════════════════════════

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
  padding:        "var(--space-3) var(--space-6)",
  borderBottom:   "1px solid var(--color-border-subtle)",
  background:     "var(--color-bg-titlebar)",
  position:       "sticky",
  top:            0,
  zIndex:         10,
  backdropFilter: "blur(8px)",
};

const logoBox: CSSProperties = {
  display:       "flex",
  alignItems:    "center",
  gap:           "var(--space-2)",
  fontSize:      "var(--text-lg)",
  fontWeight:    700,
  color:         "var(--color-text-primary)",
  letterSpacing: 0.4,
};

const logoIcon: CSSProperties = {
  width:          24,
  height:         24,
  borderRadius:   "var(--radius-sm)",
  background:     "var(--color-accent-subtle)",
  color:          "var(--color-accent)",
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  fontSize:       "var(--text-base)",
};

const sectionWrap: CSSProperties = {
  padding: "var(--space-10) 0",
};

const sectionHeader: CSSProperties = {
  textAlign:    "center",
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
  lineHeight: 1.35,
};

const sectionDesc: CSSProperties = {
  fontSize:  "var(--text-base)",
  color:     "var(--color-text-secondary)",
  marginTop: "var(--space-2)",
  maxWidth:  680,
  margin:    "var(--space-2) auto 0",
  lineHeight: 1.6,
};

// ── 히어로 ──────────────────────────────────────────────────────
const hero: CSSProperties = {
  padding:   "var(--space-12) 0 var(--space-10)",
  textAlign: "center",
};

const heroBadge: CSSProperties = {
  marginBottom: "var(--space-4)",
};

const heroTitle: CSSProperties = {
  fontSize:      "var(--text-4xl)",
  fontWeight:    800,
  color:         "var(--color-text-primary)",
  lineHeight:    1.2,
  margin:        "0 0 var(--space-4)",
  letterSpacing: -0.4,
};

const heroQuote: CSSProperties = {
  fontSize:   "var(--text-lg)",
  color:      "var(--color-text-secondary)",
  margin:     "0 auto var(--space-3)",
  maxWidth:   680,
  lineHeight: 1.6,
};

const heroOneliner: CSSProperties = {
  fontSize:   "var(--text-base)",
  color:      "var(--color-text-primary)",
  margin:     "0 auto",
  maxWidth:   680,
  lineHeight: 1.7,
  padding:    "var(--space-4)",
  background: "var(--color-bg-card)",
  border:     "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  borderLeft: "3px solid var(--color-brand)",
  textAlign:  "left",
};

const heroCta: CSSProperties = {
  display:        "flex",
  justifyContent: "center",
  gap:            "var(--space-3)",
  marginTop:      "var(--space-6)",
};

// ── 시대 진단 카드 ──────────────────────────────────────────────
const painGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap:                 "var(--space-4)",
};

const painNum: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  color:         "var(--color-error)",
  fontWeight:    700,
  marginBottom:  "var(--space-2)",
};

const painHead: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-1)",
};

const painSub: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-tertiary)",
  fontStyle:  "italic",
  margin:     "0 0 var(--space-3)",
};

const painBody: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.7,
  margin:     0,
};

// ── 30층 빌딩 비유 ──────────────────────────────────────────────
const analogyWrap: CSSProperties = {
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-brand-border)",
  borderRadius: "var(--radius-card)",
  padding:      "var(--space-8) var(--space-6)",
  boxShadow:    "var(--shadow-card)",
};

const analogyGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "1fr auto 1fr",
  gap:                 "var(--space-6)",
  alignItems:          "stretch",
};

const buildingCol: CSSProperties = {
  textAlign:  "center",
  padding:    "var(--space-4)",
};

const buildingArt: CSSProperties = {
  fontSize:     "var(--text-4xl)",
  marginBottom: "var(--space-3)",
  lineHeight:   1,
};

const buildingTitle: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-2)",
};

const buildingDesc: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  margin:     0,
  lineHeight: 1.6,
};

const analogyVs: CSSProperties = {
  alignSelf:  "center",
  fontSize:   "var(--text-xl)",
  fontWeight: 800,
  color:      "var(--color-text-tertiary)",
};

const analogyQuote: CSSProperties = {
  marginTop:    "var(--space-6)",
  paddingTop:   "var(--space-6)",
  borderTop:    "1px solid var(--color-border-subtle)",
  textAlign:    "center",
  fontSize:     "var(--text-lg)",
  color:        "var(--color-text-primary)",
  fontWeight:   600,
  fontStyle:    "italic",
  lineHeight:   1.6,
};

// ── 3대 원칙 ────────────────────────────────────────────────────
const principleGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap:                 "var(--space-4)",
};

const principleIcon: CSSProperties = {
  width:          48,
  height:         48,
  borderRadius:   "var(--radius-card)",
  background:     "var(--color-brand-subtle)",
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  fontSize:       "var(--text-2xl)",
  marginBottom:   "var(--space-3)",
};

const principleTitle: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-2)",
};

const principleBody: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.7,
  margin:     0,
};

// ── 워크플로우 (분석 → 설계 → PRD → 구현) ──────────────────────
const flowWrap: CSSProperties = {
  display:        "flex",
  alignItems:     "stretch",
  justifyContent: "center",
  flexWrap:       "wrap",
  gap:            "var(--space-3)",
};

const flowStep: CSSProperties = {
  flex:         "1 1 200px",
  minWidth:     180,
  maxWidth:     240,
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  padding:      "var(--space-5) var(--space-4)",
  textAlign:    "center",
  boxShadow:    "var(--shadow-card)",
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
  alignSelf:  "center",
  fontSize:   "var(--text-xl)",
  color:      "var(--color-brand)",
  fontWeight: 700,
};

// ── 분석/설계 항목 리스트 (좌측 번호, 우측 본문) ────────────────
const itemList: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           "var(--space-3)",
};

const itemRow: CSSProperties = {
  display:      "grid",
  gridTemplateColumns: "auto 1fr",
  gap:          "var(--space-4)",
  padding:      "var(--space-4)",
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
};

const itemNum: CSSProperties = {
  fontSize:      "var(--text-xl)",
  fontWeight:    800,
  color:         "var(--color-brand)",
  lineHeight:    1,
  minWidth:      32,
};

const itemTitle: CSSProperties = {
  fontSize:   "var(--text-lg)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-2)",
};

const itemDesc: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.7,
  margin:     "0 0 var(--space-2)",
};

const itemOutput: CSSProperties = {
  fontSize:   "var(--text-xs)",
  color:      "var(--color-brand)",
  fontWeight: 600,
  margin:     0,
};

// ── 게시판 트리 (설계 5요소 시각화) ─────────────────────────────
const treeBox: CSSProperties = {
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  padding:      "var(--space-5)",
  fontFamily:   "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize:     "var(--text-sm)",
  lineHeight:   1.8,
  color:        "var(--color-text-secondary)",
  overflow:     "auto",
};

const treeBoxHeader: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color:         "var(--color-text-tertiary)",
  marginBottom:  "var(--space-3)",
  fontWeight:    700,
};

// ── 입력 방법 카드 ──────────────────────────────────────────────
const inputGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap:                 "var(--space-4)",
};

const inputTag: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  fontWeight:    700,
};

// ── 산출물 ──────────────────────────────────────────────────────
const deliverableGrid: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap:                 "var(--space-3)",
};

const deliverableItem: CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          "var(--space-3)",
  padding:      "var(--space-3) var(--space-4)",
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
};

const deliverableName: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-primary)",
  fontWeight: 500,
};

// ── 타겟 박스 ───────────────────────────────────────────────────
const targetBox: CSSProperties = {
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-brand-border)",
  borderRadius: "var(--radius-card)",
  padding:      "var(--space-8)",
  boxShadow:    "var(--shadow-card)",
};

const targetRow: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "1fr 1fr",
  gap:                 "var(--space-6)",
};

const targetCol: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           "var(--space-2)",
};

const targetColTitle: CSSProperties = {
  fontSize:      "var(--text-2xs)",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  fontWeight:    700,
  marginBottom:  "var(--space-2)",
};

const targetItem: CSSProperties = {
  fontSize:   "var(--text-sm)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.6,
  display:    "flex",
  alignItems: "flex-start",
  gap:        "var(--space-2)",
};

// ── 푸터 ────────────────────────────────────────────────────────
const footerWrap: CSSProperties = {
  padding:   "var(--space-10) 0 var(--space-12)",
  textAlign: "center",
};

const footerTitle: CSSProperties = {
  fontSize:   "var(--text-2xl)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  margin:     "0 0 var(--space-3)",
  lineHeight: 1.4,
};

const footerDesc: CSSProperties = {
  fontSize: "var(--text-base)",
  color:    "var(--color-text-secondary)",
  margin:   "0 0 var(--space-5)",
};

const copyright: CSSProperties = {
  fontSize:   "var(--text-xs)",
  color:      "var(--color-text-tertiary)",
  marginTop:  "var(--space-8)",
  paddingTop: "var(--space-4)",
  borderTop:  "1px solid var(--color-border-subtle)",
};

// ════════════════════════════════════════════════════════════════
//  컴포넌트 본체
// ════════════════════════════════════════════════════════════════
// 서버 컴포넌트 — 인터랙티브 상태가 없으므로 "use client" 불필요

export default function IntroPage() {
  return (
    // data-theme="dark" 를 래퍼에 고정:
    // 퍼블릭 진입 시점에는 사용자 테마 설정을 알 수 없으므로 dark 톤으로 통일
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

      {/* ── 1. 히어로 — 시대 진단으로 도발 ──────────────── */}
      <Section>
        <div style={hero}>
          <div style={heroBadge}>
            <span className="sp-badge sp-badge-brand">
              <span className="dot" />
              AI 시대의 설계 워크스페이스
            </span>
          </div>
          <h1 style={heroTitle}>
            바이브 코딩 시대,<br />
            정말 설계는 필요 없을까요?
          </h1>
          <p style={heroQuote}>
            모든 걸 AI 가 해주는 시대 — 그렇다면 설계는 끝났다? 정말 그렇게 생각하시나요.<br />
            엔돌핀이 도는 첫 화면 이후, 시스템에 대한 불안감은 점점 커집니다.
          </p>
          <p style={heroOneliner}>
            <strong>SPECODE</strong> 는 우리가 만들 프로그램을 <strong>AI 와 함께 설계</strong>하고,
            그 설계를 <strong>AI 가 가장 잘 이해하는 PRD 로 변환</strong>해
            구현 단계로 넘기는 <strong>SI 개발팀을 위한 설계 워크스페이스</strong>입니다.
          </p>
          <div style={heroCta}>
            <Link href="/auth/register" className="sp-btn sp-btn-primary sp-btn-lg">
              무료로 시작하기
            </Link>
            <Link href="#why" className="sp-btn sp-btn-secondary sp-btn-lg">
              왜 필요한지 먼저 보기
            </Link>
          </div>
        </div>
      </Section>

      {/* ── 2. 이 시대의 4가지 불편 ─────────────────────── */}
      <Section id="why">
        <SectionHeader
          eyebrow="Why SPECODE"
          title="AI 와 일해 보니, 이런 적 없으셨나요"
          desc="SPECODE 가 답하려는 네 가지 불편함"
        />

        <div style={painGrid}>
          {PAIN_POINTS.map((p) => (
            <div key={p.num} className="sp-group">
              <div className="sp-group-body">
                <div style={painNum}>PAIN {p.num}</div>
                <h3 style={painHead}>{p.head}</h3>
                <p style={painSub}>{p.sub}</p>
                <p style={painBody}>{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 3. 30층 빌딩 비유 ─────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Positioning"
          title="단독주택은 AI 혼자도 됩니다. 30층은요?"
          desc="규모가 커질수록 설계가 더 필요해집니다"
        />

        <div style={analogyWrap}>
          <div style={analogyGrid}>
            <div style={buildingCol}>
              <div style={buildingArt}>🏠</div>
              <h3 style={buildingTitle}>단독주택 · 빌라</h3>
              <p style={buildingDesc}>
                AI 에게 "만들어줘" 한마디로 충분합니다.<br />
                바이브 코딩의 즐거움이 살아나는 영역.
              </p>
            </div>
            <div style={analogyVs}>VS</div>
            <div style={buildingCol}>
              <div style={buildingArt}>🏢</div>
              <h3 style={buildingTitle}>30층 빌딩 · 50층 초고층</h3>
              <p style={buildingDesc}>
                AI 가 뚝딱 만들어 줬다고 해서,<br />
                <strong>정상에서 맘 편히 주무실 수 있겠습니까?</strong>
              </p>
            </div>
          </div>
          <div style={analogyQuote}>
            “SPECODE 는 AI 와 30층 건물을 올리고, 거기서 안심하고 주무실 수 있게 하는 설계 툴입니다.”
          </div>
        </div>
      </Section>

      {/* ── 4. SPECODE 3대 원칙 ─────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="How It Works"
          title="그래서 SPECODE 는 어떻게 다른가"
          desc="세 가지 원칙으로 정리합니다"
        />

        <div style={principleGrid}>
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="sp-group">
              <div className="sp-group-body">
                <div style={principleIcon}>{p.icon}</div>
                <h3 style={principleTitle}>{p.title}</h3>
                <p style={principleBody}>{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 5. 워크플로우 — 분석→설계→PRD→구현 ────────── */}
      <Section>
        <SectionHeader
          eyebrow="Workflow"
          title="분석 → 설계 → PRD → 구현"
          desc="원래 개발은 이 순서였습니다. SPECODE 는 다시 이 순서를 살립니다"
        />

        <div style={flowWrap}>
          <FlowItem step={{ icon: "🔍", title: "분석",  desc: "과업 · 요구사항 · 스토리보드 · 기획실" }} showArrow />
          <FlowItem step={{ icon: "📐", title: "설계",  desc: "단위업무 · 화면 · 영역 · 기능 · 테이블" }} showArrow />
          <FlowItem step={{ icon: "📄", title: "PRD",   desc: "AI 가 가장 잘 먹는 형식으로 자동 변환" }} showArrow />
          <FlowItem step={{ icon: "🤖", title: "AI 구현", desc: "Claude Code · Cursor 등으로 일괄 구현" }} showArrow={false} />
        </div>
      </Section>

      {/* ── 6. 분석 4요소 ──────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Analysis"
          title="분석 — 4가지를 채우면 끝"
          desc="과업에서 시작해 기획실까지, AI 와 함께 채워 갑니다"
        />

        <div style={itemList}>
          {ANALYSIS_ITEMS.map((a) => (
            <div key={a.num} style={itemRow}>
              <div style={itemNum}>{a.num}</div>
              <div>
                <h3 style={itemTitle}>{a.title}</h3>
                <p style={itemDesc}>{a.desc}</p>
                <p style={itemOutput}>{a.output}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 7. 설계 5요소 + 게시판 트리 예시 ─────────── */}
      <Section>
        <SectionHeader
          eyebrow="Design"
          title="설계 — 5가지로 시스템을 빚습니다"
          desc="단위업무에서 시작해 테이블까지, 위에서 아래로 자연스럽게 흐릅니다"
        />

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-5)",
          alignItems: "start",
        }}>
          {/* 좌: 5요소 리스트 */}
          <div style={itemList}>
            {DESIGN_ITEMS.map((d) => (
              <div key={d.num} style={itemRow}>
                <div style={itemNum}>{d.num}</div>
                <div>
                  <h3 style={itemTitle}>{d.title}</h3>
                  <p style={itemDesc}>{d.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 우: 게시판 예시 트리 */}
          <div style={treeBox}>
            <div style={treeBoxHeader}>예시 — 게시판 단위업무</div>
            <TreeView node={BOARD_TREE} depth={0} isLast />
          </div>
        </div>
      </Section>

      {/* ── 8. 입력 방법 3가지 ────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Inputs"
          title="설계를 SPECODE 에 옮기는 세 가지 길"
          desc="AI 와 신나게 설계한 결과를 가장 편한 방식으로 등록하세요"
        />

        <div style={inputGrid}>
          {INPUT_METHODS.map((m) => (
            <div key={m.title} className="sp-group">
              <div className="sp-group-header">
                <div className="sp-group-title">
                  <span style={{
                    ...inputTag,
                    color: m.recommend ? "var(--color-accent)" : "var(--color-text-tertiary)",
                  }}>{m.tag}</span>
                </div>
                {m.recommend && <span className="sp-badge sp-badge-accent">추천</span>}
              </div>
              <div className="sp-group-body">
                <h3 style={principleTitle}>{m.title}</h3>
                <p style={principleBody}>{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 9. 산출물 ──────────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Deliverables"
          title="PRD 만? 아닙니다. 공공 SI 산출물까지"
          desc="입력한 설계 정보로 분석·설계 단계의 다양한 산출물을 자동 생성합니다"
        />

        <div style={deliverableGrid}>
          {DELIVERABLES.map((d) => (
            <div key={d.name} style={deliverableItem}>
              <DeliverableBadge kind={d.kind} />
              <span style={deliverableName}>{d.name}</span>
            </div>
          ))}
        </div>

        <p style={{
          fontSize:  "var(--text-xs)",
          color:     "var(--color-text-tertiary)",
          textAlign: "center",
          marginTop: "var(--space-4)",
        }}>
          * 산출물은 지속적으로 추가됩니다. 공공사업 검수 기준에 맞춰 확장 중.
        </p>
      </Section>

      {/* ── 10. 타겟 명확화 ───────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Target"
          title="누구를 위한 도구인가, 정직하게 말씀드립니다"
          desc=""
        />

        <div style={targetBox}>
          <div style={targetRow}>
            <div style={targetCol}>
              <div style={{ ...targetColTitle, color: "var(--color-success)" }}>
                ✓ 이런 분들께 권합니다
              </div>
              <div style={targetItem}><span style={{ color: "var(--color-success)" }}>•</span>2~7억 규모의 공공 SI 사업 개발팀</div>
              <div style={targetItem}><span style={{ color: "var(--color-success)" }}>•</span>AI 를 활용해 더 잘 개발하고 싶은 기존 개발자</div>
              <div style={targetItem}><span style={{ color: "var(--color-success)" }}>•</span>무 설계 바이브코딩의 품질이 두려운 SI 팀</div>
              <div style={targetItem}><span style={{ color: "var(--color-success)" }}>•</span>AI 와 구현 전에 AI 와 설계하고 싶은 분</div>
            </div>
            <div style={targetCol}>
              <div style={{ ...targetColTitle, color: "var(--color-error)" }}>
                ✗ 이런 분들 대상은 아닙니다
              </div>
              <div style={targetItem}><span style={{ color: "var(--color-error)" }}>•</span>개발을 전혀 모르는 일반인</div>
              <div style={targetItem}><span style={{ color: "var(--color-error)" }}>•</span>한두 화면 짜리 토이 프로젝트</div>
              <div style={targetItem}><span style={{ color: "var(--color-error)" }}>•</span>"AI 한마디로 뚝딱" 만들고 싶은 분</div>
              <div style={targetItem}><span style={{ color: "var(--color-error)" }}>•</span>설계는 시간 낭비라 믿으시는 분</div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 푸터 CTA ────────────────────────────────────── */}
      <Section>
        <div style={footerWrap}>
          <h2 style={footerTitle}>
            AI 와 구현하기 전에, AI 와 설계하세요.
          </h2>
          <p style={footerDesc}>
            첫 프로젝트를 만들고, 사라지지 않는 설계를 시작해 보세요.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)" }}>
            <Link href="/auth/register" className="sp-btn sp-btn-primary sp-btn-lg">
              무료로 시작하기
            </Link>
            <Link href="/dashboard" className="sp-btn sp-btn-ghost sp-btn-lg">
              데모 둘러보기
            </Link>
          </div>
          <div style={copyright}>
            © SPECODE — AI 와 함께 설계하고, AI 와 함께 구현합니다.
          </div>
        </div>
      </Section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
//  내부 서브 컴포넌트
// ════════════════════════════════════════════════════════════════

// 섹션 래퍼 — container + id 앵커 동시 처리
function Section({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <section id={id} style={container}>
      <div style={sectionWrap}>{children}</div>
    </section>
  );
}

// 섹션 헤더 (eyebrow + title + 선택적 desc)
function SectionHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title:   string;
  desc?:   string;
}) {
  return (
    <div style={sectionHeader}>
      <div style={sectionEyebrow}>{eyebrow}</div>
      <h2 style={sectionTitle}>{title}</h2>
      {desc && <p style={sectionDesc}>{desc}</p>}
    </div>
  );
}

// 워크플로우 단계
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

// 산출물 배지 (분석/설계/구현 종류 구분)
function DeliverableBadge({ kind }: { kind: "분석" | "설계" | "구현" }) {
  // 종류별 색을 토큰으로 매핑 — 분석=brand, 설계=info, 구현=accent
  const variantClass =
    kind === "분석" ? "sp-badge-brand" :
    kind === "설계" ? "sp-badge-info"  :
                     "sp-badge-accent";
  return <span className={`sp-badge ${variantClass}`}>{kind}</span>;
}

// 트리 뷰 (게시판 예시) — 재귀 렌더링
// type 별 색 구분으로 단위업무 → 화면 → 영역 → 기능 계층을 한눈에 보여 줌
function TreeView({
  node,
  depth,
  isLast,
  prefix = "",
}: {
  node:    TreeNode;
  depth:   number;
  isLast:  boolean;
  prefix?: string;
}) {
  const typeColor = {
    uw:     "var(--color-accent)",
    screen: "var(--color-brand)",
    area:   "var(--color-info)",
    fn:     "var(--color-text-secondary)",
  }[node.type];

  const typeLabel = {
    uw:     "[단위업무]",
    screen: "[화면]",
    area:   "[영역]",
    fn:     "[기능]",
  }[node.type];

  // 트리 선 — 루트는 prefix 없음, 자식은 ├─ 또는 └─
  const branch = depth === 0 ? "" : (isLast ? "└─ " : "├─ ");
  const nextPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");

  return (
    <>
      <div style={{ whiteSpace: "pre" }}>
        <span style={{ color: "var(--color-text-tertiary)" }}>{prefix}{branch}</span>
        <span style={{ color: typeColor, fontWeight: 600 }}>{typeLabel}</span>
        <span> {node.label}</span>
      </div>
      {node.children?.map((child, idx) => (
        <TreeView
          key={`${child.label}-${idx}`}
          node={child}
          depth={depth + 1}
          isLast={idx === (node.children?.length ?? 0) - 1}
          prefix={nextPrefix}
        />
      ))}
    </>
  );
}

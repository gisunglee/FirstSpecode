# SPECODE Design System — 토큰 가이드
> DS_TOKENS.md | Claude Code 참조용

---

## 토큰 계층 구조

```
Primitive Tokens     → 절대값 (직접 사용 금지)
        ↓
Semantic Tokens      → 의미 기반 (컴포넌트에서 사용)
        ↓
Component Tokens     → 컴포넌트 전용 (sizes, timing 등)
```

---

## 배경색 레이어 (위 → 아래 순서)

| 토큰 | 용도 | 예시 |
|---|---|---|
| `--color-bg-titlebar` | 타이틀바 | 앱 최상단 크롬 |
| `--color-bg-menubar` | 메뉴바, 상태바 | 메뉴, 툴바, 하단바 |
| `--color-bg-toolbar` | 툴바 | 저장/배포 버튼 줄 |
| `--color-bg-sidebar` | 사이드바 | 좌측 네비게이션 |
| `--color-bg-root` | 앱 기본 배경 | 메인 컨텐츠 영역 바탕 |
| `--color-bg-card` | 카드, GroupBox | 섹션 패널 |
| `--color-bg-surface` | 흰 서피스 | 모달, 팝업 |
| `--color-bg-elevated` | 높은 레이어 | 드롭다운, 배지 |
| `--color-bg-input` | 인풋 배경 | 텍스트 필드, 셀렉트 |
| `--color-bg-label` | 인라인 라벨 배경 | `sp-inline-label` |

---

## 텍스트 색

| 토큰 | 용도 |
|---|---|
| `--color-text-primary` | 주요 콘텐츠 텍스트 |
| `--color-text-secondary` | 보조 텍스트, 설명 |
| `--color-text-tertiary` | 힌트, 플레이스홀더, 라벨 |
| `--color-text-disabled` | 비활성 상태 |
| `--color-text-heading` | 섹션 제목, 그룹 헤더 |
| `--color-text-inverse` | 진한 배경 위 텍스트 (버튼 등) |

---

## 테두리

| 토큰 | 용도 |
|---|---|
| `--color-border-subtle` | 구분선, 미세 테두리 |
| `--color-border` | 기본 컴포넌트 테두리 |
| `--color-border-strong` | hover 시 테두리 강조 |
| `--color-border-focus` | focus 상태 테두리 |

---

## 브랜드 색

| 토큰 | 용도 |
|---|---|
| `--color-brand` | 주요 CTA, 포커스, 활성 상태 |
| `--color-brand-hover` | hover 시 |
| `--color-brand-subtle` | 배지 배경, 활성 배경 |
| `--color-brand-border` | 활성 테두리 |
| `--color-brand-glow` | 버튼 그림자 |
| `--color-accent` | 로고, 강조 포인트 (amber) |
| `--color-accent-subtle` | 액센트 배경 |

---

## 시맨틱 색 (상태)

```css
/* Success */
--color-success          /* 텍스트/아이콘 */
--color-success-subtle   /* 배경 */
--color-success-border   /* 테두리 */

/* Error */
--color-error
--color-error-subtle
--color-error-border

/* Warning */
--color-warning
--color-warning-subtle
--color-warning-border

/* Info */
--color-info
--color-info-subtle
--color-info-border
```

---

## 스페이싱 (4px grid)

```css
--space-1:  4px
--space-2:  8px
--space-3:  12px   ← 기본 간격
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
--space-12: 48px
```

---

## 폰트 크기

```css
--text-2xs: 9.5px   ← 섹션 타이틀, 라벨 (uppercase)
--text-xs:  11px    ← 힌트, 배지, 상태바
--text-sm:  12px    ← 보조 텍스트, 버튼
--text-md:  12.5px  ← 사이드바, 기본 UI
--text-base:13px    ← 인풋, 본문
--text-lg:  14px    ← 강조 텍스트
--text-xl:  16px    ← 섹션 제목
--text-2xl: 20px    ← 페이지 제목
--text-3xl: 24px    ← 대형 제목
--text-4xl: 30px    ← 히어로
```

---

## Border Radius

```css
--radius-sm:   4px   ← 인풋, 버튼, 배지 (Win32 DNA)
--radius-md:   6px   ← 탭, 세그먼트
--radius-card: 8px   ← GroupBox, 카드
--radius-lg:   10px  ← 모달
--radius-full: 9999px ← 토글, 아바타, 뱃지 pill
```

---

## 앱 크롬 사이즈

```css
--sidebar-width:           200px   /* 펼침 */
--sidebar-width-collapsed: 47px    /* 접힘 */
--height-titlebar:         34px
--height-menubar:          28px
--height-toolbar:          34px
--height-statusbar:        22px
```

---

## 그림자

```css
--shadow-xs     /* 미세 (배지, kbd) */
--shadow-sm     /* 작은 요소 */
--shadow-card   /* GroupBox, 카드 */
--shadow-md     /* 드롭다운, 툴팁 */
--shadow-lg     /* 모달, 토스트 */
--shadow-xl     /* 오버레이 위 요소 */
--shadow-focus  /* 포커스 링 */
--shadow-focus-error /* 에러 포커스 링 */
--shadow-btn-brand   /* 브랜드 버튼 그림자 */
--shadow-btn-accent  /* 액센트 버튼 그림자 */
```

---

## 트랜지션

```css
--transition       /* 기본 160ms ease */
--transition-fast  /* 100ms ease (hover 등) */
--transition-spring /* 260ms spring (사이드바 등) */
```

---

## 테마 변경 방법

`tokens.css`의 `[data-theme="dark"]` 또는 `[data-theme="light"]` 블록에서
semantic 토큰 값만 수정하면 전체 UI 색상 일괄 변경.

primitive 토큰(`--p-gray-*`, `--p-indigo-*` 등)은 절대 컴포넌트에서 직접 참조 금지.

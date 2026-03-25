# SPECODE — Claude Code 규칙
> Version 1.2.0

---

## 항상 로드되는 규칙 파일

@develop/A-NEXTJS-기술규칙.md
@biz/A.단위업무.md

---

## ⚡ UI 작업 시작 전 필수 읽기

UI/프론트엔드 작업을 시작하기 전에 **반드시** 아래 파일들을 순서대로 읽을 것:

```
1. design/DS_TOKENS.md        ← 토큰 계층·선택 기준 (먼저)
2. design/DS_COMPONENTS.md    ← 컴포넌트 HTML 사용법 (다음)
3. design/tokens.css          ← 실제 토큰 값 확인
4. design/components.css      ← 실제 컴포넌트 스타일 확인
```

참고용 렌더링 예시:
- `design/specode-samples.html` — 5개 샘플 페이지 (Dashboard, List, Detail, Config, Login)

---

## UI 작업 절대 규칙

1. **하드코딩 금지** — 모든 색상·간격·반경·폰트는 semantic 토큰(`--color-*`, `--space-*`, `--radius-*`, `--text-*`) 사용
2. **sp- prefix** — 모든 컴포넌트 클래스는 `sp-` 시작, 상태는 `is-` prefix
3. **data-theme** — 테마 전환은 `document.documentElement.setAttribute('data-theme', 'dark|light|dark-purple')` 로만

## UI 작업 체크리스트

- [ ] 하드코딩 색상/크기 없음
- [ ] `sp-*` 클래스만 사용
- [ ] 상태는 `is-*` 클래스
- [ ] dark / light / dark-purple 3테마 정상
- [ ] 사이드바 접힘/펼침 정상

---

## ⚡ 단위업무 개발 시작 전 필수 읽기

해당 단위업무 개발 전에 **반드시** PRD 파일을 읽을 것:

```
파일 위치: /md/prd/UW-XXXXX_단위업무명.md
예시: /md/prd/UW-00035_시스템공통레이아웃.md
```

PRD에는 화면 목록, 영역, 기능 명세, API, 참조 테이블이 모두 포함되어 있음.
개발 요청 시 UW 번호를 알려주면 해당 파일을 찾아 읽고 작업.

---

## ⚡ DB / DDL 작업 시작 전 필수 읽기

DB 스키마 조회·수정·마이그레이션 작업 전에 **반드시** 읽을 것:

```
1. database/a.TableScript.md  ← 테이블 정의 및 DDL 스크립트
```

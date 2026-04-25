"use client";

/**
 * DesignImportPage — 설계 가져오기 (설계 일괄 등록/수정)
 *
 * 역할:
 *   - 탭 1: Claude 프로젝트에 붙여넣을 시스템 프롬프트 + JSON 템플릿 제공
 *   - 탭 2: 단위업무 다중 선택 후 JSON 내보내기 (Claude에 붙여넣어 수정용)
 *           + Claude가 생성한 JSON 붙여넣기 → 미리보기 → 일괄 등록/수정
 *
 * 변경 이력:
 *   - 2026-04-25 D1: screenType 허용값을 단일 CRUD UI 와 일치(LIST/DETAIL/INPUT/POPUP/TAB/REPORT).
 *                    과거 LIST/DETAIL/GRID/TAB/FULL_SCREEN 였음 — UI 옵션과 미스매치.
 *   - 2026-04-25 D2: areaType 허용값을 단일 CRUD UI 와 일치(SEARCH/GRID/FORM/INFO_CARD/TAB/FULL_SCREEN).
 *                    과거 SEARCH/GRID/FORM/DETAIL/BUTTON/TAB/CHART/OTHER 였음 — UI에 없는 어휘 다수.
 *   - 2026-04-25 D3: functionType(SEARCH/SAVE/DELETE/DOWNLOAD/UPLOAD/NAVIGATE/VALIDATE/OTHER)
 *                    export/import/프롬프트/템플릿에 추가 — 라운드트립 데이터 손실 방지.
 *   - 2026-04-25 D6: requirementId 필수성 안내 정정 — 신규 단위업무는 필수, 수정 시 생략 가능.
 *                    실제 bulk-import 동작은 신규에서 requirementId 없으면 skip 함.
 *   - 2026-04-25 D8: 4계층 description 표준 양식(tb_ai_design_template seed)을 시스템 프롬프트에 추가.
 *                    Claude 출력이 단일 UI "예시 삽입" 과 동일 형태가 되도록 통일.
 *                    출처: prisma/sql/2026-04-24_seed_tb_ai_design_template.sql
 */

import { Suspense, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── JSON 전처리 ───────────────────────────────────────────────────────────────
// Claude가 출력하는 JSON은 아래 이유로 파싱 실패할 수 있음:
//   1. 마크다운 코드 펜스(```json ... ```)로 감싸짐
//   2. 스마트/곡선 따옴표(", ")가 직선 따옴표(")로 바뀌지 않음
//   3. BOM(\uFEFF), 줄바꿈 없는 공백(\u00A0) 섞임
function sanitizeJson(raw: string): string {
  // BOM 제거
  let s = raw.replace(/^\uFEFF/, "").trim();
  // 마크다운 코드 펜스 제거: ```json ... ``` 또는 ``` ... ```
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // 스마트 따옴표 → 직선 따옴표
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // 줄바꿈 없는 공백 → 일반 공백
  s = s.replace(/\u00A0/g, " ");
  return s;
}

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkSummary = {
  unitWorkId: string;
  displayId:  string;
  name:       string;
};

// [2026-04-25] D3: functionType 채널 지원. 미리보기 카운트만 쓰지만 contract 문서 역할.
type ImportFunction = { systemId?: string; name: string; functionType?: string };
type ImportArea     = { systemId?: string; name: string; functions?: ImportFunction[] };
type ImportScreen   = { systemId?: string; name: string; areas?: ImportArea[] };
type ImportUnitWork = { systemId?: string; name: string; screens?: ImportScreen[] };
type ImportJson     = { unitWorks?: ImportUnitWork[] };

type ImportResult = {
  result: {
    created: { unitWorks: number; screens: number; areas: number; functions: number };
    updated: { unitWorks: number; screens: number; areas: number; functions: number };
    skipped: { unitWorks: number; screens: number; areas: number; functions: number };
  };
  summary: string;
};

// ── 시스템 프롬프트 ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 SI(System Integration) 프로젝트 화면 설계 전문가이자 SPECODE 설계 어시스턴트입니다.
설계자와 함께 단위업무·화면·영역·기능을 설계하고, 최종적으로 SPECODE에 등록할 수 있는 JSON을 출력합니다.

---

## 설계 파트너로서의 역할

단순히 입력을 기록하는 도구가 아닙니다.
**화면 설계 전문가로서 함께 설계를 이끌어가는 파트너**입니다.

### 적극적 설계 리뷰 원칙

설계자의 입력을 받을 때마다 다음 관점에서 검토하고, 의미 있는 의견이 있을 때만 제안합니다:

- **화면 구성 적절성**: 화면 분리가 적절한가? 하나의 화면에 너무 많은 영역이 몰려있진 않은가?
- **영역 역할 명확성**: 각 영역이 단일 역할을 가지는가? (검색, 목록, 상세, 입력 등)
- **기능 누락**: 당연히 있어야 할 기능(조회, 저장, 취소, 페이징 등)이 빠지진 않았는가?
- **사용자 흐름 일관성**: 화면 간 이동 흐름이 자연스러운가?

**제안 방식**: 설계적으로 짚어줄 필요가 있는 경우에만, 간결하게 의견을 드리고 어떻게 진행할지 물어봅니다.

예시:
> 💡 "회원 목록 화면에 검색 영역이 없는데, 대부분의 목록 화면에는 검색 기능이 필요합니다. 추가하시겠어요?"

> 💡 "상세 화면과 편집 화면이 분리되어 있는데, 인라인 편집 방식으로 하나로 합치는 것도 고려해볼 수 있습니다. 어떤 방식을 원하시나요?"

---

## SPECODE 설계 계층 구조

SPECODE는 **단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)** 4계층으로 설계를 구성합니다.

| 레벨 | 역할 | 예시 |
|------|------|------|
| 단위업무 | 요구사항을 구현하는 업무 단위 | 회원관리, 주문처리 |
| 화면 | 사용자가 보는 하나의 화면 | 회원 목록, 회원 상세 |
| 영역 | 화면 안의 기능 구역 | 검색 조건, 목록, 버튼 |
| 기능 | 영역 안의 개별 기능 | 이메일 검색, 조회 버튼, 엑셀 다운로드 |

---

## 설계 4단계 프로세스

### 1단계: 단위업무 설계

| 항목 | 필수 | 설명 |
|------|------|------|
| 단위업무명 (name) | ⭐ 필수 | 예: "회원관리" — 요구사항 1개에 대응하는 구현 단위 |
| 설명 (description) | ✅ 권장 | 이 단위업무가 처리하는 업무 범위 요약 |
| requirementId | ⚠️ 신규는 필수 / 수정은 생략 | 신규 단위업무 등록 시 **반드시** 연결할 요구사항 UUID 가 있어야 합니다 (없으면 등록 자체가 스킵됨). 수정 시(systemId 있음)는 생략 가능 |

**완료 기준**: 단위업무명 확보 + (신규 등록 시) requirementId 확보
**중요**: 신규 단위업무를 만들려면 SPECODE 에 이미 등록된 요구사항의 UUID 가 필요합니다.
설계자에게 "어떤 요구사항에 연결할까요?" 라고 먼저 물어보고, requirementId 가 없으면 SPECODE 화면에서 미리 확인하도록 안내하세요.

**단위업무 description 표준 양식 (단일 UI "예시 삽입" 과 동일 — 이 형식 그대로 마크다운으로 작성):**

## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00001 |
| **단위업무명** | 이메일 회원가입 |
| **비즈니스 목적** | 이메일·비밀번호 입력 및 인증 메일 발송을 통해 신규 회원을 등록한다. |
| **관련 요구사항** | - |
| **기술 스택** | - |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00003 | 회원가입 | /auth/register | DETAIL | 이메일·비밀번호 입력 및 유효성 검증 후 인증 메일 발송 요청 |
| PID-00004 | 인증 메일 발송 안내 | /auth/register/verify | DETAIL | 인증 메일 발송 완료 안내 및 재발송 요청 처리 |
| PID-00005 | 이메일 인증 완료 | /auth/register/complete | DETAIL | 인증 링크 클릭 후 가입 완료 처리 및 온보딩 페이지 이동 |

## 3. 화면 흐름
\`\`\`
[PID-00003 회원가입] ──(가입 요청 성공)──▶ [PID-00004 인증 메일 발송 안내]
[PID-00004 인증 메일 발송 안내] ──(인증 링크 클릭)──▶ [PID-00005 이메일 인증 완료]
[PID-00005 이메일 인증 완료] ──(3초 후 자동/즉시 이동)──▶ [온보딩 페이지]
[PID-00005 토큰 만료·무효] ──(재발송 안내 버튼)──▶ [PID-00004 인증 메일 발송 안내]
\`\`\`

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| PID-00003 → PID-00004 | email | 가입 요청 성공 후 자동 이동 |
| PID-00004 → PID-00005 | token (URL 파라미터) | 인증 메일 내 링크 클릭 |
| PID-00005 → 온보딩 | - | 3초 카운트다운 후 자동 이동 또는 즉시 이동 |
| PID-00005 → PID-00004 | - | 토큰 만료·무효 시 재발송 안내 버튼 클릭 |

## 4. 권한 정의
| 기능 | 비로그인 | 일반 사용자 | 관리자 |
|:-----|:---------|:-----------|:-------|
| 회원가입 폼 접근 | ✅ | ❌ | ❌ |
| 인증 메일 재발송 | ✅ | ❌ | ❌ |
| 이메일 인증 완료 처리 | ✅ | ❌ | ❌ |

## 5. 상태 정의
| 상태 | 설명 |
|:-----|:-----|
| 미인증 | 가입 요청 후 인증 메일 발송 완료, 아직 인증 링크 미클릭 |
| 인증완료 | 인증 링크 클릭 후 가입 완료 처리된 상태 |
| 인증만료 | 인증 링크 발송 후 1시간 초과로 만료된 상태 |

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_cm_member>
- <TABLE_SCRIPT:tb_cm_email_verification>
- <TABLE_SCRIPT:tb_cm_refresh_token>

※ \`<TABLE_SCRIPT:tb_xxx>\` 토큰은 SPECODE 가 저장 시 자동으로 DDL 로 치환합니다. 이 형태 그대로 출력하세요.

---

### 2단계: 화면 설계

각 단위업무에 필요한 화면 목록을 도출합니다.

| 항목 | 필수 | 허용 값 / 설명 |
|------|------|----------------|
| 화면명 (name) | ⭐ 필수 | 예: "회원 목록 조회", "회원 상세 · 편집" |
| 화면 유형 (screenType) | ✅ 권장 | LIST(목록) / DETAIL(상세 조회) / INPUT(등록·수정 입력) / POPUP(팝업) / TAB(탭 화면) / REPORT(리포트·통계) |
| 표시코드 (displayCode) | 선택 | Figma 등 디자인 도구 참조용 코드 (예: MBR_LIST) |
| 카테고리 (categoryL/M/S) | 선택 | 대/중/소 분류 |
| 설명 (description) | ✅ 권장 | 화면의 목적, 주요 기능, 사용자 흐름 — 아래 표준 양식 참조 |

**완료 기준**: 모든 화면의 이름 + 유형 + 설명 작성됨

**화면 description 표준 양식 (단일 UI "예시 삽입" 과 동일 — 이 형식 그대로 마크다운으로 작성):**

## [PID-00001] 게시판 목록

### 화면 개요

| 항목 | 내용 |
|:-----|:-----|
| **비즈니스 목적** | 프로젝트 내 공지사항을 한눈에 확인하고, 제목·유형·기간 조건으로 필요한 글을 빠르게 찾는다. |
| **진입 경로** | 메뉴 클릭, 등록/수정 완료 후 리다이렉트 |

### 영역 목록

| 영역ID | 영역명 | 유형 | 설명 |
|:-------|:-------|:-----|:-----|
| AR-00001 | 검색 영역 | SEARCH | 유형·기간·제목 조건 검색 |
| AR-00002 | 목록 영역 | GRID | 게시글 목록 표시, 페이징, 글쓰기 버튼 |

### 영역 간 흐름

- 화면 진입 시 → 검색 조건 초기화 → 자동 조회 → 목록 표시
- 검색 버튼 클릭 → 검색 조건으로 재조회 → 목록 갱신 (1페이지 초기화)
- 행 클릭 → PID-00002 상세 화면 이동

---

### 3단계: 영역 설계

각 화면을 기능 구역으로 분리합니다.

| 항목 | 필수 | 허용 값 / 설명 |
|------|------|----------------|
| 영역명 (name) | ⭐ 필수 | 예: "검색 조건", "회원 목록", "정보 카드" |
| 영역 유형 (areaType) | ✅ 권장 | SEARCH(검색 조건) / GRID(데이터 목록) / FORM(입력 폼) / INFO_CARD(정보 카드) / TAB(탭) / FULL_SCREEN(전체화면) |
| 설명 (description) | ✅ 권장 | 이 영역의 역할과 포함 내용 — 아래 표준 양식 참조 |

**완료 기준**: 모든 영역의 이름 + 유형 + 설명 작성됨

**영역 description 표준 양식 (단일 UI "예시 삽입" 과 동일 — 이 형식 그대로 마크다운으로 작성):**

### 영역: [AR-00003] 상세 영역

**유형:** INFO_CARD

**UI 구조**

\`\`\`text
+───────────────────────────────────────────────────+
│ [공지] 시스템 점검 안내                              │
│ 작성자: 관리자 │ 등록일: 2026-03-15 14:30 │ 조회: 121 │
│───────────────────────────────────────────────────│
│                                                   │
│ (마크다운 렌더링된 본문 내용)                         │
│                                                   │
│───────────────────────────────────────────────────│
│ 📎 첨부파일                                        │
│   점검안내서.pdf (2.1MB)  [다운로드]                 │
│   일정표.xlsx (340KB)     [다운로드]                │
│───────────────────────────────────────────────────│
│                              [목록]  [수정]  [삭제] │
+───────────────────────────────────────────────────+
\`\`\`

**구성 항목**

| 항목명 | UI 타입 | 비고 |
|:-------|:--------|:-----|
| 유형 배지 | badge | NOTICE(빨강) / NORMAL(회색) |
| 제목 | heading (h2) | |
| 작성자 | text | |
| 등록일 | datetime | yyyy-MM-dd HH:mm |
| 조회수 | number | |
| 본문 | markdown render | 마크다운 → HTML 렌더링 |
| 첨부파일 목록 | file list | 파일명(크기) + 다운로드 버튼 |
| 목록 버튼 | button (default) | → PID-00001 (검색조건 유지) |
| 수정 버튼 | button (primary) | → PID-00003, 작성자/관리자만 표시 |
| 삭제 버튼 | button (danger) | 확인 후 논리삭제, 작성자/관리자만 표시 |

---

### 4단계: 기능 설계

각 영역 안의 구체적인 기능 항목을 정의합니다.

| 항목 | 필수 | 설명 |
|------|------|------|
| 기능명 (name) | ⭐ 필수 | 예: "이메일 검색", "조회 버튼", "엑셀 다운로드" |
| 설명 (description) | ✅ 권장 | 기능의 동작, 처리 규칙, 예외 사항 |
| 기능 유형 (functionType) | ✅ 권장 | SEARCH(검색/조회) / SAVE(저장) / DELETE(삭제) / DOWNLOAD(다운로드) / UPLOAD(업로드) / NAVIGATE(이동) / VALIDATE(유효성검증) / OTHER(기타) |
| 우선순위 (priority) | ✅ 권장 | HIGH / MEDIUM / LOW |
| 복잡도 (complexity) | 선택 | HIGH / MEDIUM / LOW |

**완료 기준**: 모든 기능의 이름 + 설명 + 우선순위 작성됨

**기능 description 표준 양식 (단일 UI "예시 삽입" 과 동일 — 이 형식 그대로 마크다운으로 작성):**

#### 기능: [FN-00001] 게시판 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | FN-00001 |
| 기능명 | 게시판 목록 조회 |
| 기능유형 | SELECT |
| API | \`GET /api/board\` |
| 트리거 | 화면 진입(자동), 검색 버튼 클릭 |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| projectId | number | Y (세션) | project_id | |
| boardTypeCd | string | N | board_type_cd | null이면 전체 |
| keyword | string | N | board_title_nm | LIKE 검색 |
| startDt | string | N | reg_dt | >= 조건 (yyyy-MM-dd) |
| endDt | string | N | reg_dt | <= 조건 (yyyy-MM-dd) |
| page | number | Y | - | 1부터 시작 |
| size | number | Y | - | 기본 20 |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| boardId | number | board_id | |
| boardTypeCd | string | board_type_cd | |
| boardTitleNm | string | board_title_nm | |
| regUserNm | string | (JOIN) | 작성자명 |
| regDt | string | reg_dt | |
| viewCnt | number | view_cnt | |
| fixYn | string | fix_yn | |
| attachYn | string | (서브쿼리) | 첨부파일 존재 Y/N |
| totalCount | number | COUNT(*) OVER() | 총 건수 |

**참조 테이블 관계**
\`\`\`
tb_cm_board b
  LEFT JOIN tb_cm_user u ON u.user_id = b.reg_user_id
\`\`\`
- 첨부파일 존재 여부: \`EXISTS (SELECT 1 FROM tb_cm_attach_file WHERE ref_type_cd = 'BOARD' AND ref_id = b.board_id AND del_yn = 'N')\`

**처리 로직**
\`\`\`
1. project_id 세션에서 획득
2. del_yn = 'N' 필터
3. 검색 조건 적용 (boardTypeCd, keyword LIKE, startDt >=, endDt <= +1일)
4. 정렬: fix_yn DESC, reg_dt DESC (상단고정 우선, 최신순)
5. 페이징: LIMIT :size OFFSET (:page - 1) * :size
\`\`\`

**업무 규칙**
- 검색 결과 0건 → "등록된 게시글이 없습니다" 안내
- 상단고정 게시글은 페이지와 무관하게 항상 최상단
- 기간 종료일은 해당일 23:59:59까지 포함

---

## 누락 항목 재질문 규칙

각 단계가 끝날 때 누락된 필수/권장 항목이 있으면 반드시 정리하여 다시 질문합니다:

> ⚠️ **아래 항목이 누락되었습니다. 확인해 주세요:**
>
> | 항목 | 대상 | 누락 내용 |
> |------|------|-----------|
> | 설명 | 회원 목록 조회 화면 | description이 작성되지 않았습니다 |
> | 영역 유형 | 검색 조건 영역 | areaType이 설정되지 않았습니다 |

---

## 변경 내역 추적

- 🆕 **신규 등록 예정**: systemId가 없는 항목
- ✏️ **수정 예정**: systemId가 있고 내용이 변경된 항목
- ⚠️ **미완성**: 필수 또는 권장 항목이 비어있는 항목

---

## 요약/정리/JSON 출력 시 — 반드시 검토 먼저

"요약해줘", "정리해줘", "현황 보여줘", "JSON 줘" 등의 요청을 받으면
**출력 전에 반드시 설계 검토를 먼저 수행**합니다.

### 검토 보고 형식

> **📋 출력 전 설계 검토 결과**
>
> **완성도**
> | 항목 | 상태 | 비고 |
> |------|------|------|
> | 화면 description 전체 | ✅ | |
> | 영역 areaType 전체 | ⚠️ | "버튼 영역" areaType 미설정 |
> | 기능 priority 전체 | ✅ | |
>
> **설계 품질 검토**
> | 항목 | 상태 | 의견 |
> |------|------|------|
> | 화면별 영역 분리 | ✅ | |
> | 기능 누락 | ⚠️ | 목록 화면에 페이징 기능 없음 |
>
> ⚠️ **보완 권장 항목이 있습니다.** 수정하시겠어요?
> 괜찮으시면 "그냥 줘"라고 말씀해 주시면 바로 출력합니다.

---

## JSON 출력 포맷

### 신규 등록 (systemId 없음)
\`\`\`json
{
  "unitWorks": [
    {
      "requirementId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "name": "회원관리",
      "description": "회원 가입, 조회, 수정, 탈퇴 등 회원 생애주기 전반을 처리합니다",
      "screens": [
        {
          "name": "회원 목록 조회",
          "screenType": "LIST",
          "displayCode": "MBR_LIST",
          "categoryL": "회원관리",
          "description": "전체 회원을 조회하고 검색 조건으로 필터링할 수 있는 화면",
          "areas": [
            {
              "name": "검색 조건",
              "areaType": "SEARCH",
              "description": "이메일, 이름, 가입일, 상태 조건으로 회원을 검색합니다",
              "functions": [
                { "name": "이메일 검색",  "description": "이메일 부분 일치 검색",       "functionType": "SEARCH",   "priority": "HIGH",   "complexity": "LOW" },
                { "name": "상태 필터",    "description": "활성/비활성/탈퇴 상태 필터", "functionType": "SEARCH",   "priority": "MEDIUM", "complexity": "LOW" },
                { "name": "조회 버튼",    "description": "조건으로 목록 조회",         "functionType": "SEARCH",   "priority": "HIGH",   "complexity": "LOW" },
                { "name": "초기화 버튼",  "description": "검색 조건 초기화",            "functionType": "OTHER",    "priority": "LOW",    "complexity": "LOW" }
              ]
            },
            {
              "name": "회원 목록",
              "areaType": "GRID",
              "description": "검색 결과를 테이블로 표시하며 페이징을 지원합니다",
              "functions": [
                { "name": "회원 목록 표시", "description": "이메일/이름/가입일/상태 표시", "functionType": "SEARCH",   "priority": "HIGH", "complexity": "MEDIUM" },
                { "name": "페이징",        "description": "페이지당 20건",                 "functionType": "NAVIGATE", "priority": "HIGH", "complexity": "LOW" },
                { "name": "상세 이동",     "description": "행 클릭 시 상세 화면 이동",     "functionType": "NAVIGATE", "priority": "HIGH", "complexity": "LOW" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`
※ \`requirementId\` 는 신규 등록 시 **필수**. 없으면 단위업무가 통째로 스킵됩니다.

### 기존 데이터 수정 (systemId 포함)
SPECODE 설계 가져오기 > 내보내기에서 복사한 JSON을 붙여넣으면 각 항목에 \`systemId\`가 포함됩니다.
수정할 내용만 변경하고, \`systemId\`는 절대 바꾸지 마세요.

\`\`\`json
{
  "unitWorks": [
    {
      "systemId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "name": "회원관리 (수정됨)",
      "screens": [
        {
          "systemId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
          "name": "회원 목록 조회 (수정됨)",
          "areas": [
            {
              "systemId": "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
              "name": "검색 조건 (수정됨)",
              "functions": [
                { "systemId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "name": "이메일 검색 (수정됨)" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

---

### 필드 값 규칙 (반드시 준수)

| 필드 | 허용 값 |
|------|---------|
| screenType | \`LIST\` \| \`DETAIL\` \| \`INPUT\` \| \`POPUP\` \| \`TAB\` \| \`REPORT\` |
| areaType | \`SEARCH\` \| \`GRID\` \| \`FORM\` \| \`INFO_CARD\` \| \`TAB\` \| \`FULL_SCREEN\` |
| functionType | \`SEARCH\` \| \`SAVE\` \| \`DELETE\` \| \`DOWNLOAD\` \| \`UPLOAD\` \| \`NAVIGATE\` \| \`VALIDATE\` \| \`OTHER\` |
| priority | \`HIGH\` \| \`MEDIUM\` \| \`LOW\` |
| complexity | \`HIGH\` \| \`MEDIUM\` \| \`LOW\` |
| systemId | SPECODE 내보내기 JSON에 포함된 UUID 그대로 사용. 직접 작성 불가 |
| requirementId | **신규 단위업무 등록 시 필수** (없으면 등록 스킵). 수정 시(systemId 있음)는 생략 가능 |

---

## 협업 행동 규칙

### JSON 출력 전 반드시 확인받기

일반 대화(질문·의견·논의)는 평소처럼 자연스럽게 주고받습니다.
**JSON을 실제로 출력하려는 그 순간에만** 아래 순서를 따릅니다:

1. 어떤 항목을 어떻게 변경할지 **한두 줄로 요약**합니다.
2. "JSON으로 출력할까요?" 라고 **한 번만 확인**합니다.
3. 설계자가 확인(수락/수정 요청)한 후에 JSON을 출력합니다.

예시:
> "'회원 목록' 화면에 '검색 조건' 영역을 추가하고, 기존 '버튼 영역' 기능 2개를 삭제하려고 합니다. JSON으로 출력할까요?"

**하지 말 것**: 매 답변마다 요약하거나, 대화 중간에 "요약할게요"를 반복하는 것.
JSON 출력 직전 딱 한 번만 요약·확인합니다.

---

### 컨텍스트가 길어질 때 먼저 알리기

대화가 길어져 컨텍스트 토큰이 많이 쌓인 것 같다고 느껴지면,
JSON 출력이나 다음 작업을 진행하기 **전에** 먼저 알립니다:

> "⚠️ 대화가 많이 길어졌습니다. 새 세션(새 채팅)을 열어서 이어가시는 것을 권장합니다. 지금까지 작업한 JSON을 먼저 SPECODE에 저장하고 새로 시작하시면 더 정확하게 도움드릴 수 있습니다."

이 알림은 설계자가 먼저 요청하기 전에 선제적으로 합니다.`;

const JSON_TEMPLATE = `{
  "unitWorks": [
    {
      "requirementId": "UUID (신규 등록 시 필수, 수정 시 생략 가능)",
      "name": "단위업무명 (예: 회원관리)",
      "description": "이 단위업무가 처리하는 업무 범위 요약",
      "screens": [
        {
          "name": "화면명 (예: 회원 목록 조회)",
          "screenType": "LIST",
          "displayCode": "MBR_LIST",
          "categoryL": "대분류",
          "description": "화면의 목적, 주요 기능, 사용자 흐름",
          "areas": [
            {
              "name": "영역명 (예: 검색 조건)",
              "areaType": "SEARCH",
              "description": "영역의 역할과 포함 내용",
              "functions": [
                { "name": "기능명", "description": "기능 설명", "functionType": "SEARCH", "priority": "MEDIUM", "complexity": "MEDIUM" }
              ]
            }
          ]
        }
      ]
    }
  ]
}`;

// ── 미리보기 계산 ─────────────────────────────────────────────────────────────

function calcPreview(parsed: ImportJson) {
  let newUW = 0, updUW = 0;
  let newSc = 0, updSc = 0;
  let newAr = 0, updAr = 0;
  let newFn = 0, updFn = 0;

  for (const uw of parsed.unitWorks ?? []) {
    uw.systemId ? updUW++ : newUW++;
    for (const sc of uw.screens ?? []) {
      sc.systemId ? updSc++ : newSc++;
      for (const ar of sc.areas ?? []) {
        ar.systemId ? updAr++ : newAr++;
        for (const fn of ar.functions ?? []) {
          fn.systemId ? updFn++ : newFn++;
        }
      }
    }
  }
  return { newUW, updUW, newSc, updSc, newAr, updAr, newFn, updFn };
}

// ── 복사 버튼 ─────────────────────────────────────────────────────────────────

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button className={`sp-btn sp-btn-secondary sp-btn-sm`} onClick={handleCopy}>
      {copied ? (
        <>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2,8 6,12 14,4" /></svg>
          복사됨
        </>
      ) : (
        <>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="2" width="9" height="11" rx="1.5" />
            <path d="M2 5h2M2 5v9h9v-2" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function DesignImportPage() {
  return (
    <Suspense fallback={null}>
      <DesignImportPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function DesignImportPageInner() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const projectId = params.id;

  const [tab, setTab]               = useState<"prompt" | "transfer">("prompt");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportJson,  setExportJson]  = useState<string>("");
  const [importText,  setImportText]  = useState<string>("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportOpen,  setExportOpen]  = useState(true);

  // ── 단위업무 목록 조회 ──────────────────────────────────────────────────────
  const { data: uwData } = useQuery({
    queryKey: ["unit-works-list", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: UnitWorkSummary[] } }>(`/api/projects/${projectId}/unit-works`)
        .then((r) => r.data),
  });
  const unitWorkList: UnitWorkSummary[] = uwData?.items ?? [];

  // ── 전체 선택 토글 ──────────────────────────────────────────────────────────
  const allSelected = unitWorkList.length > 0 && selectedIds.size === unitWorkList.length;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unitWorkList.map((uw) => uw.unitWorkId)));
    }
    setExportJson("");
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setExportJson("");
  }

  // ── JSON 파싱 ───────────────────────────────────────────────────────────────
  const parseResult = useMemo(() => {
    if (!importText.trim()) return { ok: false, data: null, error: "" };
    try {
      const data = JSON.parse(sanitizeJson(importText)) as ImportJson;
      if (!Array.isArray(data.unitWorks)) {
        return { ok: false, data: null, error: '"unitWorks" 배열이 없습니다.' };
      }
      return { ok: true, data, error: "" };
    } catch (e) {
      return { ok: false, data: null, error: (e as Error).message };
    }
  }, [importText]);

  const preview = useMemo(
    () => (parseResult.ok && parseResult.data ? calcPreview(parseResult.data) : null),
    [parseResult]
  );

  // ── 내보내기 뮤테이션 ──────────────────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: () => {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds).join(",") : undefined;
      const qs  = ids ? `?unitWorkIds=${ids}` : "";
      return authFetch<{ data: { unitWorks: unknown[] } }>(
        `/api/projects/${projectId}/design/export${qs}`
      ).then((r) => r.data);
    },
    onSuccess: (data) => {
      setExportJson(JSON.stringify(data, null, 2));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 가져오기 뮤테이션 ──────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: (body: ImportJson) =>
      authFetch<{ data: ImportResult }>(
        `/api/projects/${projectId}/design/bulk-import`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        }
      ).then((r) => r.data),
    onSuccess: (data) => {
      setImportResult(data);
      toast.success(data.summary);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleImport() {
    if (!parseResult.ok || !parseResult.data) return;
    setImportResult(null);
    importMutation.mutate(parseResult.data);
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── 헤더 ── */}
      <div className="sp-toolbar" style={{ gap: "var(--space-3)", flexShrink: 0 }}>
        <button
          className="sp-toolbar-btn"
          onClick={() => router.push(`/projects/${projectId}/unit-works`)}
          title="단위업무 목록으로 돌아가기"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="10,3 5,8 10,13" />
          </svg>
        </button>
        <div className="sp-toolbar-sep" />
        <span style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-heading)" }}>
          설계 가져오기
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          Claude 프로젝트에서 설계한 JSON을 가져와 시스템에 등록하거나 수정합니다
        </span>
      </div>

      {/* ── 탭 헤더 ── */}
      <div style={{
        display: "flex", gap: 0, padding: "0 var(--space-4)",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-toolbar)", flexShrink: 0,
      }}>
        {[
          { key: "prompt",   label: "① AI 프롬프트 & 템플릿" },
          { key: "transfer", label: "② 내보내기 / 가져오기" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "prompt" | "transfer")}
            style={{
              padding: "10px 16px",
              fontSize: "var(--text-sm)", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "var(--color-brand)" : "var(--color-text-secondary)",
              borderTop: "none", borderLeft: "none", borderRight: "none",
              borderBottom: tab === t.key ? "2px solid var(--color-brand)" : "2px solid transparent",
              background: "none", borderRadius: 0,
              cursor: "pointer", transition: "all var(--transition-fast)",
              fontFamily: "var(--font-base)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 탭 콘텐츠 ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5)" }}>

        {/* ══ 탭 1: 프롬프트 & 템플릿 ══ */}
        {tab === "prompt" && (
          <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            {/* 사용 방법 */}
            <div className="sp-group">
              <div className="sp-group-header">
                <span className="sp-group-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 7.5v5M8 5h.01" strokeLinecap="round" />
                  </svg>
                  사용 방법
                </span>
              </div>
              <div className="sp-group-body">
                <ol style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingLeft: 0, color: "var(--color-text-secondary)", fontSize: "var(--text-base)", lineHeight: 1.7 }}>
                  {[
                    "Claude 프로젝트를 만들고 아래 시스템 프롬프트를 프로젝트 지침에 붙여넣습니다.",
                    "Claude와 4단계로 설계합니다: ① 단위업무 → ② 화면 → ③ 영역 → ④ 기능. 누락 항목은 Claude가 다시 물어봅니다.",
                    "중간에 '요약해줘'로 현황을 확인하고, 완료 후 \"JSON 줘\" 요청 → Claude가 엄격 검토 후 출력합니다.",
                    "기존 데이터 수정: ② 탭에서 단위업무 내보내기 → JSON 복사 → Claude에 붙여넣고 수정 요청 → JSON 받기.",
                    "JSON을 ② 탭에 붙여넣고 가져오기 실행. systemId 있는 항목은 수정, 없는 항목은 신규 등록됩니다.",
                  ].map((step, i) => (
                    <li key={i} style={{ display: "flex", gap: "var(--space-2)", listStyle: "none" }}>
                      <span style={{
                        minWidth: 22, height: 22, borderRadius: "var(--radius-full)",
                        background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-border)",
                        color: "var(--color-brand)", fontSize: "var(--text-xs)", fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* 시스템 프롬프트 */}
            <div className="sp-group">
              <div className="sp-group-header">
                <span className="sp-group-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="3" width="12" height="10" rx="1.5" />
                    <path d="M5 7h6M5 10h4" strokeLinecap="round" />
                  </svg>
                  Claude 프로젝트 시스템 프롬프트
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  Claude 프로젝트 지침에 전체 내용을 붙여넣으세요
                </span>
                <CopyButton text={SYSTEM_PROMPT} label="복사" />
              </div>
              <div className="sp-group-body" style={{ padding: 0 }}>
                <pre style={{ padding: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflow: "auto" }}>
                  {SYSTEM_PROMPT}
                </pre>
              </div>
            </div>

            {/* JSON 템플릿 */}
            <div className="sp-group">
              <div className="sp-group-header">
                <span className="sp-group-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 3L1 8l3 5M12 3l3 5-3 5M9 2l-2 12" strokeLinecap="round" />
                  </svg>
                  JSON 템플릿 (참고용)
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>시스템 프롬프트에 이미 포함되어 있습니다</span>
                <CopyButton text={JSON_TEMPLATE} label="복사" />
              </div>
              <div className="sp-group-body" style={{ padding: 0 }}>
                <pre style={{ padding: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 340, overflow: "auto" }}>
                  {JSON_TEMPLATE}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ══ 탭 2: 내보내기 / 가져오기 ══ */}
        {tab === "transfer" && (
          <div style={{ maxWidth: 1100, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            {/* 내보내기 섹션 */}
            <div className="sp-group">
              <div
                className="sp-group-header"
                style={{ cursor: "pointer" }}
                onClick={() => setExportOpen((v) => !v)}
              >
                <span className="sp-group-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                    style={{ transform: exportOpen ? "rotate(90deg)" : "none", transition: "transform var(--transition-fast)" }}>
                    <polyline points="6,3 11,8 6,13" />
                  </svg>
                  기존 데이터 내보내기 (수정 작업 시작)
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  단위업무를 하나 이상 선택하면 systemId 포함 JSON을 클립보드에 복사합니다. Claude에 붙여넣고 수정을 요청하세요.
                </span>
              </div>

              {exportOpen && (
                <div className="sp-group-body" style={{ display: "flex", gap: "var(--space-3)" }}>

                  {/* 단위업무 체크박스 목록 — 고정 너비로 JSON 패널 등장 시 레이아웃 이동 방지 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: 483, flexShrink: 0 }}>
                    <div style={{
                      border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                      overflow: "hidden", maxHeight: 240, overflowY: "auto",
                    }}>
                      {unitWorkList.length === 0 ? (
                        <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--color-text-disabled)", fontSize: "var(--text-sm)" }}>
                          등록된 단위업무가 없습니다
                        </div>
                      ) : (
                        unitWorkList.map((uw, idx) => (
                          <label
                            key={uw.unitWorkId}
                            style={{
                              display: "flex", alignItems: "center", gap: "var(--space-2)",
                              padding: "8px 12px", cursor: "pointer",
                              background: idx % 2 === 0 ? "var(--color-bg-table-even)" : "var(--color-bg-table-odd)",
                              borderBottom: idx < unitWorkList.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(uw.unitWorkId)}
                              onChange={() => toggleOne(uw.unitWorkId)}
                              style={{ accentColor: "var(--color-brand)", width: 14, height: 14, flexShrink: 0, cursor: "pointer" }}
                            />
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-brand)", minWidth: 80 }}>
                              {uw.displayId}
                            </span>
                            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                              {uw.name}
                            </span>
                          </label>
                        ))
                      )}
                    </div>

                    {/* 전체 선택 + 버튼 행 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          style={{ accentColor: "var(--color-brand)", width: 14, height: 14, cursor: "pointer" }}
                        />
                        전체 선택
                      </label>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                        {selectedIds.size > 0 ? `${selectedIds.size}개 선택됨` : "선택 없으면 전체 내보내기"}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button
                        className="sp-btn sp-btn-secondary"
                        onClick={() => exportMutation.mutate()}
                        disabled={exportMutation.isPending}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M8 2v8M5 7l3 3 3-3M2 12v2h12v-2" strokeLinecap="round" />
                        </svg>
                        {exportMutation.isPending ? "내보내는 중..." : "JSON 내보내기"}
                      </button>
                      {exportJson && <CopyButton text={exportJson} label="JSON 복사" />}
                    </div>
                  </div>

                  {/* 내보내기 결과 — 항상 렌더링, 남은 공간 채움 */}
                  <div style={{
                    flex: 1,
                    background: "var(--color-bg-input)", border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)", padding: "var(--space-3)",
                    display: "flex", alignItems: exportJson ? "flex-start" : "center", justifyContent: exportJson ? "flex-start" : "center",
                    minHeight: 120,
                  }}>
                    {exportJson ? (
                      <pre style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 280, overflow: "auto", width: "100%" }}>
                        {exportJson}
                      </pre>
                    ) : (
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-disabled)" }}>
                        단위업무 선택 후 JSON 내보내기를 누르면 여기에 표시됩니다
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 가져오기 섹션 */}
            <div className="sp-group">
              <div className="sp-group-header">
                <span className="sp-group-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 3L1 8l3 5M12 3l3 5-3 5" strokeLinecap="round" />
                  </svg>
                  Claude JSON 붙여넣기
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {importText.trim() && !parseResult.ok && (
                    <span className="sp-badge sp-badge-error">파싱 오류</span>
                  )}
                  {parseResult.ok && (
                    <span className="sp-badge sp-badge-success">파싱 성공</span>
                  )}
                </div>
              </div>

              <div className="sp-group-body">
                <div style={{ display: "flex", gap: "var(--space-3)" }}>

                  {/* 좌: JSON 입력 */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <textarea
                      className={`sp-input sp-textarea ${importText.trim() && !parseResult.ok ? "is-err" : parseResult.ok ? "is-ok" : ""}`}
                      style={{ minHeight: 380, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", resize: "vertical", lineHeight: 1.75 }}
                      placeholder={'{\n  "unitWorks": [\n    {\n      "name": "단위업무명",\n      ...\n    }\n  ]\n}'}
                      value={importText}
                      onChange={(e) => { setImportText(e.target.value); setImportResult(null); }}
                      spellCheck={false}
                    />
                    {importText.trim() && !parseResult.ok && parseResult.error && (
                      <div className="sp-hint is-err">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v4M8 11h.01" strokeLinecap="round" /></svg>
                        {parseResult.error}
                      </div>
                    )}
                    <button
                      className="sp-btn sp-btn-primary"
                      onClick={handleImport}
                      disabled={!parseResult.ok || importMutation.isPending}
                      style={{ alignSelf: "flex-end" }}
                    >
                      {importMutation.isPending ? "처리 중..." : (
                        <>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M8 14V6M5 9l3-3 3 3M2 4V2h12v2" strokeLinecap="round" />
                          </svg>
                          가져오기 실행
                        </>
                      )}
                    </button>
                  </div>

                  {/* 우: 미리보기 / 결과 */}
                  <div style={{ width: 280, flexShrink: 0, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-bg-input)", display: "flex", flexDirection: "column" }}>
                    {importResult ? (
                      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, color: "var(--color-success)" }}>
                            <polyline points="2,8 6,12 14,4" />
                          </svg>
                          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-success)" }}>등록 완료</span>
                        </div>
                        <ResultRow label="단위업무" created={importResult.result.created.unitWorks} updated={importResult.result.updated.unitWorks} skipped={importResult.result.skipped.unitWorks} />
                        <ResultRow label="화면" created={importResult.result.created.screens} updated={importResult.result.updated.screens} skipped={importResult.result.skipped.screens} />
                        <ResultRow label="영역" created={importResult.result.created.areas} updated={importResult.result.updated.areas} skipped={importResult.result.skipped.areas} />
                        <ResultRow label="기능" created={importResult.result.created.functions} updated={importResult.result.updated.functions} skipped={importResult.result.skipped.functions} />
                        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: "var(--space-2)" }}>
                          <button className="sp-btn sp-btn-secondary sp-btn-sm sp-btn-full" onClick={() => router.push(`/projects/${projectId}/unit-works`)}>
                            단위업무에서 확인
                          </button>
                        </div>
                      </div>
                    ) : preview ? (
                      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          등록 예정 항목
                        </span>
                        <PreviewRow label="단위업무" created={preview.newUW} updated={preview.updUW} />
                        <PreviewRow label="화면" created={preview.newSc} updated={preview.updSc} />
                        <PreviewRow label="영역" created={preview.newAr} updated={preview.updAr} />
                        <PreviewRow label="기능" created={preview.newFn} updated={preview.updFn} />
                        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: "var(--space-2)", marginTop: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                          <span className="sp-badge sp-badge-brand" style={{ marginRight: 4 }}>신규</span> systemId 없는 항목<br />
                          <span className="sp-badge sp-badge-neutral" style={{ marginRight: 4, marginTop: 4, display: "inline-flex" }}>수정</span> systemId 있는 항목
                        </div>
                      </div>
                    ) : (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", color: "var(--color-text-disabled)", padding: "var(--space-4)", textAlign: "center" }}>
                        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ width: 36, height: 36, opacity: 0.5 }}>
                          <path d="M16 4v16M10 14l6 6 6-6" strokeLinecap="round" />
                          <rect x="4" y="24" width="24" height="4" rx="1.5" />
                        </svg>
                        <span style={{ fontSize: "var(--text-sm)" }}>JSON을 붙여넣으면<br />미리보기가 표시됩니다</span>
                        <span style={{ fontSize: "var(--text-xs)" }}>신규 / 수정 항목을 구분해서 보여줍니다</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 미리보기 행 ───────────────────────────────────────────────────────────────

function PreviewRow({ label, created, updated }: { label: string; created: number; updated: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>{label}</span>
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        {created > 0 && <span className="sp-badge sp-badge-brand">{created} 신규</span>}
        {updated > 0 && <span className="sp-badge sp-badge-neutral">{updated} 수정</span>}
        {created === 0 && updated === 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>없음</span>}
      </div>
    </div>
  );
}

// ── 결과 행 ──────────────────────────────────────────────────────────────────

function ResultRow({ label, created, updated, skipped }: { label: string; created: number; updated: number; skipped: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>{label}</span>
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        {created > 0 && <span className="sp-badge sp-badge-success">{created} 등록</span>}
        {updated > 0 && <span className="sp-badge sp-badge-brand">{updated} 수정</span>}
        {skipped > 0 && <span className="sp-badge sp-badge-warning">{skipped} 스킵</span>}
        {created === 0 && updated === 0 && skipped === 0 && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>없음</span>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * AiImportPage — AI 설계 가져오기 (기획 일괄 등록/수정)
 *
 * 역할:
 *   - 탭 1: Claude 프로젝트에 붙여넣을 시스템 프롬프트 + JSON 템플릿 제공
 *   - 탭 2: 과업 JSON 내보내기 (Claude에 붙여넣어 수정용)
 *           + Claude가 생성한 JSON 붙여넣기 → 미리보기 → 일괄 등록/수정
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

type TaskSummary = {
  taskId:   string;
  displayId: string;
  name:      string;
};

type ImportTask = {
  systemId?:     string;
  name:          string;
  category?:     string;
  requirements?: ImportRequirement[];
};

type ImportRequirement = {
  systemId?:      string;
  name:           string;
  priority?:      string;
  userStories?:   ImportStory[];
};

type ImportStory = {
  systemId?: string;
  name:      string;
};

type ImportJson = { tasks?: ImportTask[] };

type ImportResult = {
  result: {
    created: { tasks: number; requirements: number; stories: number };
    updated: { tasks: number; requirements: number; stories: number };
    skipped: { tasks: number; requirements: number; stories: number };
  };
  summary: string;
};

// ── 시스템 프롬프트 (탭 1) ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 SI(System Integration) 프로젝트 요구사항 분석 전문가이자 SPECODE 설계 파트너입니다.
설계자와 함께 과업·요구사항·사용자스토리를 완성하고, 최종적으로 SPECODE에 등록할 수 있는 JSON을 출력합니다.

---

## 설계 파트너로서의 역할

당신은 단순히 입력을 받아 기록하는 도구가 아닙니다.
**요구사항 분석 전문가로서 함께 설계를 이끌어가는 파트너**입니다.

### 적극적 설계 리뷰 원칙

설계자의 입력을 받을 때마다 다음 관점에서 검토하고, 의미 있는 의견이 있을 때만 제안합니다:

- **범위 적절성**: 이 요구사항이 과업 범위 내에 있는가? 너무 크거나 작게 쪼개진 건 아닌가?
- **중복·누락**: 유사한 요구사항이 겹치거나, 당연히 있어야 할 요구사항이 빠지진 않았는가?
- **실현 가능성**: 명세가 개발팀이 구현 가능한 수준으로 구체화되어 있는가?
- **우선순위 타당성**: HIGH가 너무 많거나, 실제로 핵심인 항목이 MEDIUM으로 설정된 건 아닌가?
- **사용자 관점 일관성**: 페르소나와 시나리오가 실제 사용자 흐름을 제대로 반영하는가?

**제안 방식**: 모든 항목을 다 언급하지 않습니다. 설계적으로 짚어줄 필요가 있는 경우에만,
간결하게 의견을 드리고 어떻게 진행할지 물어봅니다.

예시:
> 💡 "인증 관련 요구사항이 2개로 나뉘어 있는데, 실제 개발 범위로 보면 하나로 묶는 편이 관리가 쉬울 것 같습니다. 합치시겠어요, 아니면 의도적으로 구분하신 건가요?"

> 💡 "비밀번호 초기화 요구사항이 없는데, 가입 기능이 있다면 대부분 함께 다뤄집니다. 포함하실 건가요?"

### 설계 방향이 엉뚱해질 때

설계자가 과업 범위를 벗어나거나, 요구사항이 아닌 구현 세부사항 수준으로 내려가거나,
사용자스토리가 기술 태스크처럼 작성되는 경우 — 부드럽지만 명확하게 방향을 잡아줍니다.

예시:
> "지금 작성하신 내용이 요구사항보다는 개발 태스크에 가깝습니다. 사용자 입장에서 '무엇이 필요한가'로 다시 풀어볼까요?"

---

## 연관 업무 참고 자료 활용

설계 중 현재 과업이 **다른 과업이나 요구사항과 연관**될 가능성이 보이면,
설계자에게 관련 자료를 요청하여 참고합니다.

**요청 타이밍**: 연관성이 실제로 보일 때만 요청합니다 (매번 묻지 않습니다).

> 📎 "지금 설계하시는 '회원 권한 관리'가 '메뉴 접근 제어' 과업과 연결될 것 같습니다.
> 해당 과업의 JSON이나 요구사항 자료가 있으시면 공유해 주시면 일관성 있게 설계할 수 있습니다."

**제공 가능한 참고 자료 형태**:
- 관련 과업의 JSON (SPECODE 기획 가져오기 > 내보내기에서 복사 가능)
- RFP 원문, 회의록, 기획 문서 등 텍스트 형태의 자료

참고 자료를 받으면 다음을 확인합니다:
- 요구사항 중복 여부 (이미 다른 과업에서 다루고 있지는 않은가)
- 용어 일관성 (동일한 개념을 다르게 표현하고 있지는 않은가)
- 누락된 연계 요구사항 (A 과업에 있어야 할 내용이 B 과업에만 있는 경우)

---

## 설계 3단계 프로세스

설계는 아래 3단계 순서로 진행합니다. 각 단계에서 SPECODE가 필요로 하는 정보를 수집하고,
누락된 항목이 있으면 단계가 끝나기 전에 반드시 다시 질문합니다.

---

### 1단계: 과업 설계

| 항목 | 필수 | 설명 |
|------|------|------|
| 과업명 (name) | ⭐ 필수 | 예: "회원관리 기능 개발" — 간결하고 명확하게 |
| 과업 정의 (definition) | ✅ 권장 | 과업 범위, 주요 목적, 처리 대상 — 1~3문장 요약 |
| 세부내용 (content) | ✅ 권장 | RFP·계약서의 해당 과업 원문 전체 — 구체적 요청사항·조건·제약이 모두 포함된 원문 텍스트 |
| 분류 (category) | 선택 | NEW_DEV (신규개발) / IMPROVE (기능개선) / MAINTAIN (유지보수) |
| 산출물 (outputInfo) | ✅ 권장 | 이 과업에서 나오는 산출물 목록 |

**완료 기준**: 과업명 + 과업 정의 작성됨
**수정 시**: SPECODE에서 내보낸 JSON에 포함된 \`systemId\` (UUID) 그대로 유지

---

### 2단계: 요구사항 설계

과업을 처리하기 위해 필요한 요구사항들을 도출합니다.

| 항목 | 필수 | 허용 값 / 설명 |
|------|------|----------------|
| 요구사항명 (name) | ⭐ 필수 | 명확한 명사형 (예: "회원 가입 기능") |
| 원문 (originalContent) | ✅ 권장 | 고객 요구사항 원문 — RFP·계약서 등 고객이 요청한 내용 그대로 |
| 최종본 (currentContent) | ✅ 권장 | 고객 요구사항 최종본 — 협의·변경을 거쳐 확정된 내용 (원문과 다르면 여기에 반영) |
| 상세 명세 (detailSpec) | ✅ 권장 | 요구사항 명세서 — **고객에게 제출되는 공식 문서**. 아래 6개 섹션을 마크다운 형식으로 작성 (항목이 없으면 "-"): ① ### 요구사항 설명 — 무엇인지 1~3문장 요약 ② ### 주 사용자 — 이 기능을 사용하는 주체 ③ ### 메뉴 — 시스템 내 메뉴 경로 ④ ### 기능 설명 — 번호 목록으로 주요 기능 나열 ⑤ ### 처리 규칙 — 검증·분기·예외 조건 등 개발 기준 ⑥ ### 제약/비고 — 범위 제외·보안 제약·협의 필요 사항 |
| 분석 노트 (discussionMd) | 선택 | 자유 형식 분석 기록 — 고객 인터뷰 내용, 인사이트, 협의 내용, VOC 등. **AI가 기획 시 참조하는 비공개 메모** |
| 우선순위 (priority) | ✅ 권장 | HIGH / MEDIUM / LOW |
| 출처 (source) | 선택 | RFP / MEETING / INTERVIEW / ETC (기본값: RFP) |

**완료 기준**: 모든 요구사항의 요구사항명 + detailSpec + priority 작성됨
**수정 시**: SPECODE에서 내보낸 JSON에 포함된 \`systemId\` (UUID) 그대로 유지

---

### 3단계: 사용자스토리 설계

각 요구사항에 대한 사용자 관점의 시나리오를 작성합니다.

| 항목 | 필수 | 설명 |
|------|------|------|
| 스토리명 (name) | ⭐ 필수 | "누가 무엇을 한다" 형태 |
| 페르소나 (persona) | ⭐ 필수 | 이 기능을 사용하는 주체 (예: 일반 회원, 관리자) |
| 시나리오 (scenario) | ⭐ 필수 | 사용자가 이 기능을 통해 얻는 가치와 흐름 |
| 인수기준 (acceptanceCriteria) | ✅ 권장 | 완료 판단 기준 (2개 이상 권장) |

**인수기준 작성 형식** (Given-When-Then):
- given: 주어진 조건
- when: 사용자 행동
- then: 기대 결과

**완료 기준**: 모든 스토리의 persona + scenario + acceptanceCriteria(2개 이상) 작성됨
**수정 시**: SPECODE에서 내보낸 JSON에 포함된 \`systemId\` (UUID) 그대로 유지

---

## 누락 항목 재질문 규칙

각 단계가 끝날 때 누락된 필수/권장 항목이 있으면 반드시 정리하여 다시 질문합니다:

> ⚠️ **아래 항목이 누락되었습니다. 확인해 주세요:**
>
> | 항목 | 대상 | 누락 내용 |
> |------|------|-----------|
> | 상세 명세 | 회원 가입 기능 | detailSpec이 작성되지 않았습니다 |
> | 우선순위 | 비밀번호 변경 기능 | priority가 설정되지 않았습니다 |

---

## 변경 내역 추적

- 🆕 **신규 등록 예정**: systemId가 없는 항목
- ✏️ **수정 예정**: systemId가 있고 내용이 변경된 항목
- ⚠️ **미완성**: 필수 또는 권장 항목이 비어있는 항목

---

## 요약/정리/JSON 출력 시 — 반드시 검토 먼저

"요약해줘", "정리해줘", "현황 보여줘", "JSON 줘", "다운로드", "내려줘" 등의 요청을 받으면
**출력 전에 반드시 설계 검토를 먼저 수행**합니다.

### 검토 보고 형식

> **📋 출력 전 설계 검토 결과**
>
> **완성도**
> | 항목 | 상태 | 비고 |
> |------|------|------|
> | 과업 정의(definition) | ✅ | |
> | 과업 산출물(outputInfo) | ⚠️ | 미작성 |
> | 요구사항 detailSpec 전체 | ✅ | |
> | 요구사항 priority 전체 | ✅ | |
> | 스토리 persona + scenario | ✅ | |
> | 인수기준 2개 이상 | ⚠️ | "비밀번호 변경" 스토리 1개만 있음 |
>
> **설계 품질 검토**
> | 항목 | 상태 | 의견 |
> |------|------|------|
> | priority 허용 값 | ✅ | |
> | source 허용 값 | ✅ | |
> | 요구사항 범위 적절성 | ✅ | |
> | 스토리가 사용자 관점으로 작성됨 | ⚠️ | "DB 인덱스 추가" → 기술 태스크로 보임. 제거 권장 |
>
> ⚠️ **보완 권장 항목이 있습니다.** 수정하시겠어요?
> 괜찮으시면 "그냥 줘"라고 말씀해 주시면 바로 출력합니다.

검토에서 모두 ✅이거나 설계자가 "그냥 줘"를 요청하면, 변경 내역 요약을 간략히 표시한 뒤 JSON을 출력합니다.

---

## 요약 명령 ("요약해줘" / "정리해줘" / "현황 보여줘")

검토 완료 후 아래 형식으로 현황을 정리합니다.

**📊 설계 현황 요약**

**과업**
| 항목 | 내용 | 상태 |
|------|------|------|
| 과업명 | 회원관리 기능 개발 | ✅ |
| 과업 정의 | 미작성 | ⚠️ |

**요구사항 목록**
| # | 요구사항명 | 우선순위 | detailSpec | 상태 |
|---|-----------|----------|------------|------|
| 1 | 회원 가입 기능 | HIGH | 완료 | ✅ |
| 2 | 비밀번호 변경 | MEDIUM | 미작성 | ⚠️ |

요약 후 미완성 항목이 있으면 가장 중요한 보완 사항을 1~2개만 짚어드립니다.

---

## JSON 출력 포맷

### 신규 등록 (systemId 없음)
\`\`\`json
{
  "tasks": [
    {
      "name": "회원관리 기능 개발",
      "category": "NEW_DEV",
      "definition": "회원의 가입, 정보 수정, 탈퇴 등 전체 회원 생애주기를 관리합니다",
      "content": "3.1 회원관리\\n시스템은 이메일 기반 회원 가입, 소셜 로그인(카카오·네이버), 회원정보 수정, 비밀번호 변경, 회원 탈퇴 기능을 제공하여야 한다...",
      "outputInfo": "화면설계서, API 명세서, ERD",
      "requirements": [
        {
          "name": "회원 가입 기능",
          "originalContent": "RFP 3.1절: 사용자는 이메일과 비밀번호로 가입할 수 있어야 한다",
          "currentContent": "이메일 인증 추가, SNS 연동 로그인 포함으로 확정",
          "detailSpec": "### 요구사항 설명\\n이메일과 비밀번호로 회원 가입하며, 이메일 인증을 통해 본인을 확인한다.\\n\\n### 주 사용자\\n- 서비스 가입을 원하는 신규 방문자\\n\\n### 메뉴\\n- 로그인 화면 > 회원가입 버튼\\n\\n### 기능 설명\\n1. 이메일·비밀번호 입력 및 유효성 검사\\n2. 이메일 중복 확인\\n3. 인증 메일 발송 및 인증 완료 처리\\n4. 가입 완료 후 자동 로그인\\n\\n### 처리 규칙\\n- 비밀번호는 8자 이상, 영문+숫자 조합 필수\\n- 인증 메일 미클릭 시 24시간 후 자동 만료\\n\\n### 제약/비고\\n- SNS 연동 로그인은 2차 개발에서 검토",
          "discussionMd": "고객 인터뷰(2025-03-10): SNS 로그인도 원하지만 우선 이메일만 / 가입 시 부서 코드 입력 필드 추가 검토 필요",
          "priority": "HIGH",
          "source": "RFP",
          "userStories": [
            {
              "name": "신규 회원 이메일 가입",
              "persona": "서비스 가입을 원하는 신규 사용자",
              "scenario": "이메일과 비밀번호를 입력하여 회원 가입 후 서비스를 이용할 수 있다",
              "acceptanceCriteria": [
                { "given": "회원가입 화면에 접속한 상태", "when": "유효한 이메일과 비밀번호를 입력하고 가입 버튼을 클릭하면", "then": "인증 메일이 발송되고 인증 대기 안내 화면이 표시된다" },
                { "given": "인증 메일을 받은 상태", "when": "메일 내 인증 링크를 클릭하면", "then": "가입이 완료되고 자동으로 로그인된다" },
                { "given": "이미 가입된 이메일로 시도할 때", "when": "동일한 이메일로 가입을 시도하면", "then": "중복 이메일 오류 메시지가 표시된다" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

### 기존 데이터 수정 (systemId 포함)
SPECODE 기획 가져오기 > 내보내기에서 복사한 JSON을 붙여넣으면 각 항목에 \`systemId\`가 포함됩니다.
수정할 내용만 변경하고, \`systemId\`는 절대 바꾸지 마세요.

\`\`\`json
{
  "tasks": [
    {
      "systemId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "name": "회원관리 기능 개발",
      "category": "NEW_DEV",
      "definition": "수정된 과업 정의",
      "requirements": [
        {
          "systemId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
          "name": "회원 가입 기능",
          "priority": "HIGH",
          "userStories": [
            {
              "systemId": "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
              "name": "신규 회원 이메일 가입",
              "persona": "수정된 페르소나",
              "scenario": "수정된 시나리오",
              "acceptanceCriteria": [
                { "given": "수정된 조건", "when": "수정된 행동", "then": "수정된 기대 결과" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

※ tasks 배열로 여러 과업을 한 번에 등록할 수 있습니다.
※ systemId 있는 항목은 수정, 없는 항목은 신규 등록됩니다.

---

### 필드 값 규칙 (반드시 준수)

| 필드 | 허용 값 |
|------|---------|
| category | \`NEW_DEV\` (신규개발) \| \`IMPROVE\` (기능개선) \| \`MAINTAIN\` (유지보수) |
| priority | \`HIGH\` \| \`MEDIUM\` \| \`LOW\` |
| source | \`RFP\` \| \`MEETING\` \| \`INTERVIEW\` \| \`ETC\` |
| systemId | SPECODE 내보내기 JSON에 포함된 UUID 그대로 사용. 직접 작성 불가 |

---

## 협업 행동 규칙

### JSON 출력 전 반드시 확인받기

일반 대화(질문·의견·논의)는 평소처럼 자연스럽게 주고받습니다.
**JSON을 실제로 출력하려는 그 순간에만** 아래 순서를 따릅니다:

1. 어떤 항목을 어떻게 변경할지 **한두 줄로 요약**합니다.
2. "JSON으로 출력할까요?" 라고 **한 번만 확인**합니다.
3. 설계자가 확인(수락/수정 요청)한 후에 JSON을 출력합니다.

예시:
> "'회원 로그인' 요구사항의 priority를 MEDIUM → HIGH로 올리고, 인수기준 1개를 추가하려고 합니다. JSON으로 출력할까요?"

**하지 말 것**: 매 답변마다 요약하거나, 대화 중간에 "요약할게요"를 반복하는 것.
JSON 출력 직전 딱 한 번만 요약·확인합니다.

---

### 컨텍스트가 길어질 때 먼저 알리기

대화가 길어져 컨텍스트 토큰이 많이 쌓인 것 같다고 느껴지면,
JSON 출력이나 다음 작업을 진행하기 **전에** 먼저 알립니다:

> "⚠️ 대화가 많이 길어졌습니다. 새 세션(새 채팅)을 열어서 이어가시는 것을 권장합니다. 지금까지 작업한 JSON을 먼저 SPECODE에 저장하고 새로 시작하시면 더 정확하게 도움드릴 수 있습니다."

이 알림은 설계자가 먼저 요청하기 전에 선제적으로 합니다.`;

const JSON_TEMPLATE = `{
  "tasks": [
    {
      "name": "과업명",
      "category": "NEW_DEV",
      "definition": "과업 범위 요약 (1~3문장)",
      "content": "RFP 세부내용 원문 전체",
      "outputInfo": "산출물 목록 (예: 화면설계서, ERD, API명세서)",
      "requirements": [
        {
          "name": "요구사항명",
          "originalContent": "고객 요구사항 원문",
          "currentContent": "협의·변경된 최종본",
          "detailSpec": "요구사항 명세서 (고객 제출 공식 문서)",
          "discussionMd": "분석 노트 (AI 참조용 자유 기록)",
          "priority": "HIGH",
          "source": "RFP",
          "userStories": [
            {
              "name": "스토리명",
              "persona": "이 기능을 사용하는 주체",
              "scenario": "무엇을 하면 어떤 가치를 얻는가",
              "acceptanceCriteria": [
                { "given": "주어진 조건", "when": "사용자 행동", "then": "기대 결과" },
                { "given": "주어진 조건", "when": "사용자 행동", "then": "기대 결과" }
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
  let newTasks = 0, updTasks = 0;
  let newReqs = 0,  updReqs = 0;
  let newStories = 0, updStories = 0;

  for (const t of parsed.tasks ?? []) {
    t.systemId ? updTasks++ : newTasks++;
    for (const r of t.requirements ?? []) {
      r.systemId ? updReqs++ : newReqs++;
      for (const s of r.userStories ?? []) {
        s.systemId ? updStories++ : newStories++;
      }
    }
  }
  return { newTasks, updTasks, newReqs, updReqs, newStories, updStories };
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
    <button className={`sp-btn sp-btn-secondary sp-btn-sm ${copied ? "is-ok" : ""}`} onClick={handleCopy}>
      {copied ? (
        <>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="2,8 6,12 14,4" />
          </svg>
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

export default function AiImportPage() {
  return (
    <Suspense fallback={null}>
      <AiImportPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function AiImportPageInner() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const projectId = params.id;

  const [tab, setTab]             = useState<"prompt" | "transfer">("prompt");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(""); // "" = 전체
  const [exportJson,     setExportJson]     = useState<string>("");
  const [importText,     setImportText]     = useState<string>("");
  const [importResult,   setImportResult]   = useState<ImportResult | null>(null);
  const [exportOpen,     setExportOpen]     = useState(true);

  // ── 과업 목록 조회 (드롭다운용) ─────────────────────────────────────────────
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-list", projectId],
    queryFn:  () =>
      authFetch<{ data: { tasks: TaskSummary[] } }>(`/api/projects/${projectId}/tasks`)
        .then((r) => r.data),
  });
  const taskList: TaskSummary[] = tasksData?.tasks ?? [];

  // ── JSON 파싱 ───────────────────────────────────────────────────────────────
  const parseResult = useMemo(() => {
    if (!importText.trim()) return { ok: false, data: null, error: "" };
    try {
      const data = JSON.parse(sanitizeJson(importText)) as ImportJson;
      if (!Array.isArray(data.tasks)) {
        return { ok: false, data: null, error: '"tasks" 배열이 없습니다.' };
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

  // ── 내보내기 쿼리 (버튼 클릭 시만 실행) ────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: () => {
      const qs = selectedTaskId ? `?taskId=${selectedTaskId}` : "";
      return authFetch<{ data: { tasks: unknown[] } }>(
        `/api/projects/${projectId}/planning/export${qs}`
      ).then((r) => r.data);
    },
    onSuccess: (data) => {
      setExportJson(JSON.stringify(data, null, 2));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 가져오기 실행 뮤테이션 ──────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: (body: ImportJson) =>
      authFetch<{ data: ImportResult }>(
        `/api/projects/${projectId}/planning/bulk-import`,
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
          onClick={() => router.push(`/projects/${projectId}/planning`)}
          title="기획 트리로 돌아가기"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="10,3 5,8 10,13" />
          </svg>
        </button>
        <div className="sp-toolbar-sep" />
        <span style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text-heading)" }}>
          기획 가져오기
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          Claude 프로젝트에서 설계한 과업·요구사항·사용자스토리 JSON을 가져와 등록하거나 수정합니다
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
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5) var(--space-5)" }}>

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
                <ol style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingLeft: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-base)", lineHeight: 1.7 }}>
                  {[
                    "Claude 프로젝트를 만들고 아래 시스템 프롬프트를 프로젝트 지침에 붙여넣습니다.",
                    "신규 등록: Claude와 3단계로 설계 (과업 → 요구사항 → 사용자스토리). '요약해줘'로 현황 확인, 완료 후 \"JSON 줘\" 요청.",
                    "기존 데이터 수정: ② 탭에서 과업 내보내기 → JSON 복사 → Claude에 붙여넣고 수정 → JSON 받기.",
                    "JSON을 ② 탭에 붙여넣고 가져오기 실행. systemId 있는 항목은 수정, 없는 항목은 신규 등록됩니다.",
                  ].map((step, i) => (
                    <li key={i} style={{ display: "flex", gap: "var(--space-2)", listStyle: "none", marginLeft: "-var(--space-4)" }}>
                      <span style={{
                        minWidth: 22, height: 22, borderRadius: "var(--radius-full)",
                        background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-border)",
                        color: "var(--color-brand)", fontSize: "var(--text-xs)", fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
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
                <pre style={{
                  padding: "var(--space-4)",
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                  color: "var(--color-text-secondary)", lineHeight: 1.75,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 360, overflow: "auto",
                }}>
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
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  시스템 프롬프트에 이미 포함되어 있습니다
                </span>
                <CopyButton text={JSON_TEMPLATE} label="복사" />
              </div>
              <div className="sp-group-body" style={{ padding: 0 }}>
                <pre style={{
                  padding: "var(--space-4)",
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                  color: "var(--color-text-secondary)", lineHeight: 1.75,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 340, overflow: "auto",
                }}>
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
                  <svg
                    viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                    style={{ transform: exportOpen ? "rotate(90deg)" : "none", transition: "transform var(--transition-fast)" }}
                  >
                    <polyline points="6,3 11,8 6,13" />
                  </svg>
                  기존 데이터 수정 시 — 내보내기
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 4 }}>
                    (신규 등록이라면 이 섹션 불필요)
                  </span>
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  수정할 과업을 선택하면 systemId 포함 JSON을 클립보드에 복사합니다. Claude에 붙여넣고 수정을 요청하세요.
                </span>
              </div>

              {exportOpen && (
                <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    {/* 과업 선택 드롭다운 */}
                    <div className="sp-select-wrap" style={{ flex: 1, maxWidth: 400 }}>
                      <select
                        className="sp-input"
                        value={selectedTaskId}
                        onChange={(e) => { setSelectedTaskId(e.target.value); setExportJson(""); }}
                      >
                        <option value="">수정할 과업 선택...</option>
                        {taskList.map((t) => (
                          <option key={t.taskId} value={t.taskId}>
                            {t.displayId}　{t.name}
                          </option>
                        ))}
                      </select>
                      <span className="sp-select-arrow">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="4,6 8,10 12,6" />
                        </svg>
                      </span>
                    </div>

                    {/* 내보내기 버튼 */}
                    <button
                      className="sp-btn sp-btn-secondary"
                      onClick={() => exportMutation.mutate()}
                      disabled={exportMutation.isPending}
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M8 2v8M5 7l3 3 3-3M2 12v2h12v-2" strokeLinecap="round" />
                      </svg>
                      {selectedTaskId ? "과업 내보내기" : "과업 전체"}
                    </button>

                    {/* 결과 JSON이 있으면 복사 버튼 */}
                    {exportJson && <CopyButton text={exportJson} label="JSON 복사" />}
                  </div>

                  {/* 내보내기 결과 */}
                  {exportJson && (
                    <div style={{
                      background: "var(--color-bg-input)", border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)", padding: "var(--space-3)",
                    }}>
                      <pre style={{
                        fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                        color: "var(--color-text-secondary)", lineHeight: 1.75,
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        maxHeight: 260, overflow: "auto",
                      }}>
                        {exportJson}
                      </pre>
                    </div>
                  )}
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
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    신규 과업은 과업 선택 없이 바로 JSON을 붙여넣고 등록할 수 있습니다
                  </span>
                </div>
              </div>

              <div className="sp-group-body">
                <div style={{ display: "flex", gap: "var(--space-3)" }}>

                  {/* 좌: JSON 입력 */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <textarea
                      className={`sp-input sp-textarea ${importText.trim() && !parseResult.ok ? "is-err" : parseResult.ok ? "is-ok" : ""}`}
                      style={{ minHeight: 380, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", resize: "vertical", lineHeight: 1.75 }}
                      placeholder={'{\n  "tasks": [\n    {\n      "name": "과업명",\n      ...\n    }\n  ]\n}'}
                      value={importText}
                      onChange={(e) => { setImportText(e.target.value); setImportResult(null); }}
                      spellCheck={false}
                    />

                    {/* 파싱 오류 메시지 */}
                    {importText.trim() && !parseResult.ok && parseResult.error && (
                      <div className="sp-hint is-err">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="8" cy="8" r="6.5" />
                          <path d="M8 5v4M8 11h.01" strokeLinecap="round" />
                        </svg>
                        {parseResult.error}
                      </div>
                    )}

                    {/* 가져오기 버튼 */}
                    <button
                      className="sp-btn sp-btn-primary"
                      onClick={handleImport}
                      disabled={!parseResult.ok || importMutation.isPending}
                      style={{ alignSelf: "flex-end" }}
                    >
                      {importMutation.isPending ? (
                        <>처리 중...</>
                      ) : (
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
                  <div style={{
                    width: 280, flexShrink: 0,
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-bg-input)",
                    display: "flex", flexDirection: "column",
                  }}>
                    {/* 결과 표시 */}
                    {importResult ? (
                      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, color: "var(--color-success)" }}>
                            <polyline points="2,8 6,12 14,4" />
                          </svg>
                          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-success)" }}>
                            등록 완료
                          </span>
                        </div>
                        <ResultRow label="과업" created={importResult.result.created.tasks} updated={importResult.result.updated.tasks} skipped={importResult.result.skipped.tasks} />
                        <ResultRow label="요구사항" created={importResult.result.created.requirements} updated={importResult.result.updated.requirements} skipped={importResult.result.skipped.requirements} />
                        <ResultRow label="사용자스토리" created={importResult.result.created.stories} updated={importResult.result.updated.stories} skipped={importResult.result.skipped.stories} />
                        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: "var(--space-2)", marginTop: "var(--space-1)" }}>
                          <button
                            className="sp-btn sp-btn-secondary sp-btn-sm sp-btn-full"
                            onClick={() => router.push(`/projects/${projectId}/planning`)}
                          >
                            기획 트리에서 확인
                          </button>
                        </div>
                      </div>
                    ) : preview ? (
                      /* 미리보기 */
                      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          등록 예정 항목
                        </span>
                        <PreviewRow label="과업" created={preview.newTasks} updated={preview.updTasks} />
                        <PreviewRow label="요구사항" created={preview.newReqs} updated={preview.updReqs} />
                        <PreviewRow label="사용자스토리" created={preview.newStories} updated={preview.updStories} />
                        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: "var(--space-2)", marginTop: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                          <span className="sp-badge sp-badge-brand" style={{ marginRight: 4 }}>신규</span> systemId 없는 항목<br />
                          <span className="sp-badge sp-badge-neutral" style={{ marginRight: 4, marginTop: 4, display: "inline-flex" }}>수정</span> systemId 있는 항목
                        </div>
                      </div>
                    ) : (
                      /* 빈 상태 */
                      <div style={{
                        flex: 1, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        gap: "var(--space-2)", color: "var(--color-text-disabled)",
                        padding: "var(--space-4)", textAlign: "center",
                      }}>
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

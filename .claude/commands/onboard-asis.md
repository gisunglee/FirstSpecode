---
description: 기존(1차) 시스템 소스를 분석해 SPECODE에 AS-IS 정보를 등록합니다.
argument-hint: (없음)
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, mcp__specode__list_projects, mcp__specode__list_asis_questions, mcp__specode__create_asis_question, mcp__specode__answer_asis_question, mcp__specode__create_unit_work, mcp__specode__update_unit_work, mcp__specode__create_screen, mcp__specode__update_screen, mcp__specode__create_area, mcp__specode__update_area, mcp__specode__create_function, mcp__specode__update_function, mcp__specode__create_db_table, mcp__specode__update_db_table, mcp__specode__get_db_table, mcp__specode__list_requirements
---

# /onboard-asis — 기존 시스템 AS-IS 정보 온보딩

이 명령은 2차 사업(기존 시스템 위 증축) 프로젝트를 위해, 현재 저장소의 소스를 분석해서
SPECODE에 단위업무·화면·영역·기능·DB 테이블로 등록한다. 대량 작업이라 시간이 걸리는 걸
전제로 하고, 안전하게 진행하기 위해 각 단계마다 확인을 받는다. 절대 한 번에 몰아서
등록하지 않는다.

## 1. 소개와 프로젝트 확인

실행하자마자 다음을 사용자에게 알린다:

"이 명령은 기존(1차) 시스템 소스를 분석해서 SPECODE에 단위업무/화면/영역/기능/DB
테이블로 등록합니다. 순서: 상태 확인 → 진행 방식 선택 → 소스 스캔 → 관련도 확인 →
(선택) 참고자료 → 영역별 딥 분석과 확인 → 등록 → 미확인 사항 질문 등록. 시간이 꽤
걸릴 수 있습니다."

`list_projects`로 프로젝트를 확인한다. 하나면 그 ID를 쓰고, 여러 개면 사용자에게
선택받는다.

## 2. 상태 체크 (세션이 새로 시작됐어도 항상 먼저 실행)

`list_asis_questions(projectId, purposeCode="ASIS_ONBOARDING")`를 호출한다. 이 절차의
진행 상황은 대화 기억이 아니라 SPECODE DB에 있으므로, 이어하는 세션이든 완전히 새
세션이든 상관없이 이 조회로 상태를 파악한다.

- 결과가 없으면 "이 프로젝트는 처음 온보딩하는 것 같습니다"라고 안내하고 3번으로.
- 결과가 있으면 `statusCode`별로 개수를 센다.
  - `ANSWERED`가 있으면: "지난 온보딩에서 답변된 질문이 N건 있습니다. 먼저
    반영할까요?" 라고 묻는다. 그렇다면 10번(답변 반영 루프)을 먼저 수행한 뒤 이어간다.
  - `OPEN`만 있으면: "미해결 질문이 N건 남아있습니다. 그대로 두고 새로 진행해도
    괜찮습니다." 라고만 알리고 계속 진행.

## 3. 진행 방식 확인

`AskUserQuestion`으로 반드시 묻는다 (생략 금지):

- 관련도 확인 후 3점 이상만 딥 분석 (권장)
- 전체를 다 딥하게 분석
- 특정 부분만 지정해서 분석

"그냥 알아서 해줘"라는 답이 와도 "그러면 기본 절차(관련도 확인 후 3점 이상만 딥
분석)로 진행하겠습니다, 괜찮으신가요?" 라고 한 번 더 확인받은 뒤에 진행한다. 확인 없이
바로 대량 등록을 시작하지 않는다.

## 4. 소스 스캔

현재 저장소를 Read/Grep/Glob으로 직접 스캔한다. 서버에 저장된 소스 위치 정보는 없다 —
`/sync-specode`와 마찬가지로 매번 로컬 파일시스템을 직접 본다.

1. 라우트/페이지/컴포넌트 폴더 구조를 훑어서 화면 후보를 뽑는다.
2. API route나 서비스 레이어를 훑어서 기능 후보를 뽑는다.
3. DB 스키마 정의 파일(Prisma, DDL, ORM 모델 등)을 찾아서 테이블 후보를 뽑는다.
4. generated/vendor/build/secret 폴더는 제외한다.

## 5. 러프 목록 + 관련도 확인

찾은 화면/기능/테이블을 큰 카테고리로 묶어 목록으로 보여주고, 3번에서 "관련도 확인"을
선택했다면 각 카테고리에 1~5점 관련도를 묻는다. 표나 번호 목록으로 한 번에 보여주고
한 번에 답을 받는다 — 항목별로 하나씩 채팅으로 왔다갔다 하지 않는다. 3점 이상만
7번에서 딥 분석한다. 나머지는 이름/경로 수준으로만 등록하고 깊이 들어가지 않는다.

## 6. 참고자료 요청 (선택)

"매뉴얼, 업무설명, 권한 체계, 회원 유형, 핵심 프로세스 같은 참고자료가 있으면
공유해 주세요. 없어도 진행 가능합니다." 라고 안내한다. 받으면 분석에 활용하고,
스펙코드 웹에 첨부파일로 올려서 보관하도록 안내한다 (MCP에는 첨부파일 등록 도구가
없다).

## 7. 영역 단위 딥 분석 + 대화 확인

5번에서 3점 이상으로 표시된 영역만, **한 번에 하나씩** 딥 분석한다. 여러 영역을
몰아서 분석하고 한꺼번에 결과를 쏟아내지 않는다. 각 영역마다:

1. 관련 소스를 자세히 읽고 화면/영역/기능/데이터 흐름을 파악한다.
2. 사람이 읽고 판단할 수 있는 이야기 형식으로 정리해서 보여준다.
   예: "로그인 화면은 이메일/비밀번호로 하고, 5회 실패하면 잠깁니다. 관련 테이블은
   users, login_attempts로 보입니다. 맞나요?"
3. 사용자의 확인/정정을 받는다. 정정되면 반영해서 다시 확인받는다.
4. 확정되기 전에는 8번(등록)으로 넘어가지 않는다.

## 8. 등록

확정된 영역만, 개별 도구를 하나씩 순서대로 호출해서 등록한다
(`create_unit_work` → `create_screen` → `create_area` → `create_function`,
DB는 `create_db_table` → `update_db_table`). **bulk 등록 도구는 쓰지 않는다** — 실패
시 그 항목만 재시도하면 되도록 항상 하나씩 호출한다.

`displayId`는 자동채번에 맡기지 않고 직접 지정한다. 온보딩으로 등록하는 항목임을
구분할 수 있는 접두어를 프로젝트 기존 표시 ID 규칙에 맞춰 사용자와 상의해서 정한다
(예: 기존 `UW-00001` 체계라면 `AS-UW-00001`처럼). 접두어를 정하지 않고 자동채번된
번호를 그대로 쓰면, 이후 2차 사업에서 새로 만드는 항목의 번호와 뒤섞여 구분이
안 된다 — 반드시 먼저 확인한다.

`update_db_table`의 `columns`는 **전체 교체**다. 컬럼을 나눠서 여러 번 호출하면
이전에 넣은 컬럼이 사라진다 — 한 테이블의 컬럼은 한 번에 전부 모아서 한 번만
호출한다.

## 9. 미확인 사항 → 질문 등록

7번 대화로도 못 정한 것 중, 2차 설계에 영향을 줄 만큼 중요한 것만 남긴다. 사소한 건
그냥 넘어간다.

`create_asis_question(projectId, purposeCode="ASIS_ONBOARDING", batchId=이번 회차
식별자, refTblNm, refId, questionCn, revwrMemberId?)`를 호출한다. `batchId`는 이번
실행 전체에서 동일한 값을 쓴다 (예: 오늘 날짜 + "1차 온보딩 1회차"). 해당 엔티티의
`description`에도 "⚠️ 미확인: ~~~" 형태로 같은 내용을 짧게 남긴다
(`update_unit_work`/`update_screen`/`update_area`/`update_function`).

## 10. 답변 반영 루프 (2번에서 ANSWERED 발견 시)

각 답변된 질문에 대해:

1. 답변 내용과 대상 엔티티의 현재 description을 함께 놓고, 병합된 새 description을
   만든다.
2. 병합이 애매하면(기존 내용과 충돌하거나 해석이 여러 가지면) 사용자에게 확인받는다.
   명확하면 바로 진행한다.
3. `update_unit_work`/`update_screen`/`update_area`/`update_function`으로 반영하고,
   description의 "⚠️ 미확인" 표시를 지운다.
4. `answer_asis_question`은 이미 웹에서 답변이 등록될 때 ANSWERED로 바뀌어 있다 —
   이 루프는 그 답변을 스펙에 반영하는 것이지 질문 상태를 바꾸는 게 아니다.

## 11. 마무리 요약

등록한 단위업무/화면/영역/기능/DB테이블 개수, 새로 남긴 미해결 질문 수, 이번에 반영한
답변 수를 정리해서 알린다. 남은 미해결 질문이 있으면 "답변해 주시면 이 명령을 다시
실행해서 이어가면 됩니다" 라고 안내한다.

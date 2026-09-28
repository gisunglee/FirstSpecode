---
description: SPECODE 커맨드 안내 및 작업·개발·검토·동기화·AS-IS 온보딩
argument-hint: "[work [작업ID] | dev | status | review UW번호 | sync UW번호 [--deep] | onboard]"
---

# /specode — SPECODE 통합 커맨드

## 인자가 없으면 도움말만

`$ARGUMENTS`가 비었거나 `help`, `--help`이면 아래 표를 설명하고 종료한다.
환경변수·키를 읽거나 MCP/HTTP 호출·프로젝트 조회·태스크 실행을 하지 않는다.

| 명령 | 설명 |
| --- | --- |
| `/specode work` | 대기 중인 분석·설계·문서 등 비개발 작업 처리 (최대 10건) |
| `/specode dev` | 대기 중인 개발 작업 처리 (최대 1건). 소스가 수정됩니다. |
| `/specode work <작업ID>` | 지정한 대기 작업 한 건 처리. 개발 작업이면 소스가 수정됩니다. |
| `/specode status` | 연결된 사용자·프로젝트와 대기 작업 수 확인 |
| `/specode review UW-00014` | 현재 설계·표준 가이드 기준 구현 품질 검토. 서버 저장·자동 수정 없음 |
| `/specode sync UW-00014` | 설계와 구현의 차이·수정안을 서버에 제출. 설계 반영은 웹 승인 |
| `/specode sync UW-00014 --deep` | 동기화 정밀 분석 |
| `/specode onboard` | 기존 시스템 분석·등록. 실행 중 분석 방식 선택 및 영역별 합의 |

review/sync에는 `14`처럼 숫자만 써도 된다. onboard에는 `--deep` 옵션이 없다.
onboard의 관련도 기반/전체 정밀/특정 부분 선택과 등록 전 확인 절차를 그대로 따른다.
설치·업데이트는 연결된 SPECODE MCP에 “스펙코드 커맨드 설치해줘” 또는 “업데이트해줘”라고 요청한다.

## 인자가 있으면 검증 후 하나의 workflow만 실행

1. `$ARGUMENTS`를 공백 단위 토큰으로 나눈다. 사용자 원문을 셸 코드로 실행하거나 보간하지 않는다.
2. 토큰은 영문·숫자·하이픈·밑줄로만 이루어져야 한다. 그 밖의 문자, 따옴표, 셸 연산자 등이 있으면 도움말만 출력한다.
3. 검증된 토큰을 각각 독립 인자로 `node .claude/commands/specode_route.mjs`에 전달한다.
   예: `node .claude/commands/specode_route.mjs sync UW-00014 --deep`
4. 결과가 `kind: "help"`이면 해당 command의 설명·예시(없으면 전체 표)만 출력하고 종료한다.
   누락 인자를 추측하지 않는다. `onboard --deep`, `dev <ID>`, 알 수 없는 옵션은 실행하지 않는다.
5. `kind: "run"`이면 `.claude/specode-workflows/{workflow}.md` 하나만 Read로 읽는다.
   workflow는 helper가 반환한 run/review/sync/onboard 중 하나여야 한다.
6. 읽은 workflow에서 `$ARGUMENTS`는 **helper가 반환한 args 배열을 공백으로 연결한 값**이다.
   공개 명령 원문을 다시 전달하지 않는다. 예: `work abc` → `TASK abc`, `dev` → `IMP`.
7. 해당 workflow의 절차·권한·확인·결과 저장 규칙을 그대로 수행한다. 다른 workflow를 자동 실행하지 않는다.

Node 또는 workflow 파일이 없으면 불완전 설치라고 알리고 MCP 커맨드 업데이트를 안내한다.
누락된 workflow 내용을 기억으로 재작성하거나 이전 커맨드로 우회 실행하지 않는다.

## 도구 권한

이 진입점은 모든 하위 작업에 광범위한 자동 허용을 부여하지 않는다. 실행 환경의 기존 권한을 따른다.
도움말에는 도구가 필요 없다. run은 소스·첨부 읽기와 필요한 구현/검사 및 워커 HTTP,
review는 설계/가이드 MCP 조회와 읽기 전용 리뷰어, sync는 로컬 근거 helper와 양식 MCP,
onboard는 합의된 범위의 설계 MCP 등록을 사용한다.

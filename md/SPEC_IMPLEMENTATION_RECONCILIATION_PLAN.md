# SPECODE 구현 변경 수집 및 스펙 정합성 확정 설계안

> 문서 상태: `IMPLEMENTED — 전체 설계 구현 및 검증 완료`
> 작성일: 2026-07-31  
> 구현 상태: 유형 A/B, 4계층 적용, 검토·rollback, provider/webhook/CI gate까지 완료.
> 검토 반영: 2026-07-31 Claude 1차 피드백 반영 — 영속 source baseline, 증거 검증,
> 비-Git 경로, 1단계 MVP 종료 방식, `PRE_IMPL` 공존 규칙 보완  
> 목적: SPECODE로 설계한 뒤 구현 과정 또는 구현 완료 후 발생한 소스 변경을 다시
> SPECODE의 단위업무·화면·영역·기능 설계에 안전하고 쉽게 반영하는 방법을 정의한다.

---

## 구현 상태 — 2026-07-31

구현 완료:

- 유형 A `/run-ai-tasks IMP`와 유형 B `/sync-specode [UW-XXXXX]`
- commit·working tree DRAFT·비-Git content-addressed manifest
- source repository/baseline/receipt/item/spec-source link 전체 모델
- 단위업무·화면·영역·기능 설명의 hash 적용과 3-way merge
- 여섯 가지 결정, 보완 source 재확인, 제한 일괄 적용, 적용 rollback
- 증거 확인과 source baseline 전진의 원자적 낙관적 잠금
- GitHub/GitLab provider 검증, 서명 PR/MR webhook, CI warning gate
- 설계 상세의 미반영 변경 배지
- MCP와 worker 명령 배포

검증 완료:

- additive DB migration 적용
- `npm run test:spec-reconciliation`
- `npm run test:spec-reconciliation:db` (실제 DB transaction 후 rollback)
- `npm run typecheck`
- `npm run build`

---

## 0. 이 문서에서 반드시 구분하는 두 문제

이 기능은 비슷해 보이지만 발생 시점과 추적 방법이 다른 두 종류의 변경을 함께 다룬다.

### 유형 A — 최초 구현 과정에서 발생한 구현 편차

SPECODE의 단위업무·화면·영역·기능을 MD로 전달해 구현했지만, 구현 작업자가 다음과 같은
이유로 스펙과 조금 다르게 구현한 경우다.

- 스펙이 모호해 개발자가 한 가지 방식으로 해석했다.
- 프레임워크·라이브러리 제약 때문에 다른 방법을 선택했다.
- 개발 중 더 나은 UX나 업무 규칙을 발견했다.
- 임시 우회 처리를 넣었다.
- 실수로 스펙과 다른 동작을 만들었다.

이 경우에는 **구현요청 당시 스펙과 해당 구현 작업의 결과**를 비교한다. 구현 작업을
수행한 AI 또는 개발자가 완료 시점에 편차를 함께 제출할 수 있으므로 비교 범위와 책임
작업이 비교적 명확하다.

### 유형 B — 구현 완료 후 발생한 후속 수정

SPECODE가 1번, 2번, 3번, 4번 개발을 순차적으로 요청하고 모두 완료한 뒤, 다른 개발자가
과거 1번이 구현한 영역을 다시 수정하는 경우다.

예:

```text
C0 ──[1번 구현]──> C1 ──[2번 구현]──> C2 ──[3번 구현]──> C3 ──[4번 구현]──> C4
                                                                        │
                                                [개발자가 1번 범위 수정] │
                                                                        ▼
                                                                        C5
```

이때 C1과 C5를 비교하면 2·3·4번 구현까지 모두 섞인다. 따라서 다음 두 정보가 필요하다.

1. **변경 범위:** 프로젝트에 연결된 저장소·브랜치별로 영속화한 마지막 정합성 확정점
   C4와 현재 C5의 차이
2. **변경 의미:** 1단계에서는 사용자가 선택한 영향 대상과 AI가 소스에서 찾은 후보,
   이후에는 검증 과정에서 축적한 `스펙 ↔ 소스 파일·심볼 연결지도`

즉, 유형 B는 특정 과거 AI 태스크를 다시 여는 문제가 아니다. **현재 소스의 새 변경을
독립적인 후속 변경으로 접수한 뒤, 그 변경이 어떤 과거 설계 항목에 영향을 주는지
역추적하는 문제**다.

### 두 유형의 공통 도착점

수집 방식은 다르지만 두 변경은 모두 하나의 `스펙 반영함`으로 들어온다.

```text
유형 A: 구현요청 결과의 편차 ─┐
                              ├─> 스펙 반영함 ─> 검토 ─> 정합성 확정
유형 B: 완료 후 후속 소스 수정 ─┘
```

---

## 1. 용어

| 용어 | 의미 |
|---|---|
| **구현 기준 스펙** | 구현요청 시점에 저장된 단위업무·화면·영역·기능 스냅샷 |
| **구현 결과 패키지** | 구현 완료 시 소스 Diff, 커밋, 테스트, 편차, 변경 파일을 묶은 자료. 문서에서는 `Implementation Receipt`와 같은 의미 |
| **후속 변경 패키지** | 완료된 구현과 별개로 나중에 개발자가 수정한 Git Diff와 변경 사유를 묶은 자료 |
| **소스 저장소** | SPECODE 프로젝트에 연결된 Git 저장소 또는 소스 디렉터리. 저장소·브랜치별 확정점의 소유 단위 |
| **소스 체크포인트** | 특정 저장소·브랜치에서 정합성을 확정한 Git commit 또는 비-Git 소스 manifest |
| **증거 신뢰등급** | 제출된 commit·Diff가 서버 또는 연결 도구에 의해 어느 수준까지 검증되었는지 나타내는 값 |
| **스펙-소스 연결지도** | SPECODE 설계 항목과 실제 파일·심볼·API·테이블의 N:M 연결 정보. 3단계부터 영속화 |
| **정합성 검토** | 소스 변경이 스펙 변경인지, 소스 오류인지, 스펙과 무관한 구현 세부사항인지 판정하는 과정 |
| **스펙 반영함** | 유형 A와 B의 검토 대상을 모아 처리하는 프로젝트 단위 작업함 |
| **정합성 확정점** | 검토 항목이 모두 해결되어 SPECODE 스펙과 해당 소스 커밋이 서로 일치한다고 승인한 시점 |

---

## 2. 구현 착수 시점 SPECODE에서 확인된 기반과 한계

### 2-1. 재사용 가능한 기존 기반 `[구현 착수 전 기준]`

1. 구현요청 `submit`은 `tb_ai_task`를 만들고, 요청 당시 단위업무·화면·영역·기능의 설명
   원문과 해시를 `tb_sp_impl_snapshot`에 저장한다.
2. 다음 구현요청에서는 현재 스펙과 최신 구현요청 스냅샷을 비교해
   `NO_CHANGE/DIFF/FULL/REPLACE` 등의 모드를 계산한다.
3. `PRE_IMPL(선 구현 적용)`은 사용자가 이미 구현했다고 판단한 레이어의 스펙 스냅샷을
   현재 상태로 갱신한다.
4. `tb_ds_design_change`는 단위업무·화면·영역·기능 등의 변경 전후 값과 변경자를 기록한다.
5. `tb_ds_review_request`와 코멘트 기능은 사람에게 리뷰를 배정하고 대화하는 일반 리뷰
   채널로 사용할 수 있다.
6. HTTP MCP(`/api/mcp`)를 통해 외부 Claude Code·Codex가 SPECODE 데이터를 조회·수정할
   수 있다. 단, 현재 구현 변경 제출 도구는 없다.

### 2-2. 당시 한계 `[구현 착수 전 기준]`

- 로컬 저장소의 Git Diff를 수집하지 않는다.
- 구현요청 시작·종료 커밋을 저장하지 않는다.
- 프로젝트·저장소·브랜치 단위의 마지막 정합성 확정점을 저장할 모델이 없다.
- 구현된 파일과 단위업무·화면·영역·기능 간 연결 정보가 없다.
- 개발 완료 후 발생한 독립적인 후속 변경을 접수하는 개념이 없다.
- 소스 변경에서 스펙 수정 후보를 생성하지 않는다.
- `PRE_IMPL`은 사용자의 판단으로 구현요청용 스펙 스냅샷을 갱신할 뿐 실제 소스와
  스펙의 일치나 source baseline을 검증하지 않는다.
- 일반 리뷰 요청은 자유 텍스트 중심이라 여러 개의 구조화된 변경 후보를 개별 승인하거나
  반려하는 용도로는 부족하다.

### 2-3. 기존 기능과 새 기능의 경계

| 기존 기능 | 새 기능 |
|---|---|
| SPECODE 스펙이 이전 구현요청 이후 바뀌었는지 확인 | 실제 소스가 스펙과 다르게 바뀌었는지 확인 |
| 구현요청 시점 스펙 저장 | 구현 결과의 Git 커밋·Diff·테스트 저장 |
| 선 구현했다고 사용자가 직접 표시 | 소스 근거를 분석해 스펙 반영 여부 검토 |
| 설계 변경 발생 후 이력 기록 | 소스 변경을 설계 변경 후보로 제안 |

---

## 3. 해결 목표와 비목표

### 목표

1. 개발자가 파일마다 SPECODE ID를 수동으로 넣지 않아도 변경을 관련 설계에 연결한다.
2. 최초 구현 편차와 나중의 후속 변경을 모두 빠뜨리지 않고 접수한다.
3. 잔잔한 코드 변경은 자동으로 걸러내고, 업무 의미가 바뀐 변경만 사람이 검토한다.
4. 소스를 근거로 사용하되 소스가 스펙을 자동으로 덮어쓰지 못하게 한다.
5. 확인된 사실, AI가 추론한 영향, 제안한 스펙 문장을 분리해 보여준다.
6. 승인된 스펙 변경은 기존 설계 변경 이력 및 구현요청과 추적 가능하게 연결한다.
7. 하나의 소스 파일이 여러 기능에 사용되는 N:M 관계와 공통 컴포넌트를 지원하되,
   1단계에서는 사용자 선택과 AI 후보로 검증하고 영속 연결지도는 뒤 단계로 미룬다.
8. 사용자에게는 가능한 한 `변경 제출 → 후보 검토 → 일괄 확정` 세 단계만 요구한다.

### 비목표

- 모든 코드 줄과 스펙 문장을 실시간 양방향 동기화하지 않는다.
- 소스 변경을 이유로 스펙을 무인 자동 수정하지 않는다.
- 단순 포맷팅, 변수명, 파일 이동까지 설계 문서에 기록하지 않는다.
- 최초 버전부터 GitHub/GitLab/사내 Git을 모두 연동하지 않는다.
- AI의 추론을 사실로 취급하지 않는다.
- 현재 SPECODE 데이터 구조로 표현할 수 없는 내용을 코멘트 필드에 억지로 밀어 넣지 않는다.

---

## 4. 핵심 설계 결정

### 결정 1 — 소스는 증거이며 스펙 변경 권한자가 아니다

소스에는 올바른 개선, 기술적 우회, 임시 코드, 실수가 모두 섞인다. 따라서 AI는 소스
변경을 읽고 **스펙 수정 후보**를 만들 수 있지만, 승인 없이 단위업무·화면·영역·기능을
수정할 수 없다.

### 결정 2 — 파일 주석 ID를 주 연결 방식으로 사용하지 않는다

모든 파일이나 함수에 `UW/FID` 주석을 삽입하면 다음 문제가 생긴다.

- 공통 파일 하나가 여러 기능에 연결될 때 표현이 어려워진다.
- 파일 이동·리팩터링 시 주석이 쉽게 낡는다.
- 개발자 부담이 커지고 ID 복사 오류가 생긴다.
- 생성 코드·외부 코드·설정 파일에 적용하기 어렵다.

대신 1단계에서는 제출자가 영향받은 단위업무·화면·영역·기능을 선택하고 AI가
파일·심볼 후보를 보완한다. 실제 사례에서 정확도가 확인된 뒤 3단계부터
`설계 항목 ↔ 파일·심볼` 연결지도를 자동으로 축적한다. 커밋 메시지에는 구현요청 ID를
한 번 넣을 수 있지만, 이는 작업 추적 보조 수단이지 파일별 연결의 단일 근거가 아니다.

### 결정 3 — 유형 B의 비교 기준은 마지막 정합성 확정점이다

후속 변경은 과거 1번 구현 커밋이나 개별 접수 건의 임의 필드와 비교하지 않는다.
프로젝트에 연결된 **소스 저장소·브랜치별 체크포인트**를 별도 저장하고, 마지막으로
검증된 체크포인트 이후의 변경만 수집한다. 체크포인트는 특정 receipt에 딸린 부가 값이
아니라 다음 후속 변경이 공통으로 조회하는 프로젝트 자산이다.

```text
Git 저장소:
  source_baseline(repo + branch)
    → latest VERIFIED GIT_COMMIT checkpoint(C4)
    → provider가 검증한 current commit(C5)
    → C4..C5

비-Git 소스:
  source_baseline(repo)
    → latest VERIFIED SOURCE_MANIFEST(M4)
    → current manifest(M5)
    → M4..M5
```

프로젝트 하나에 여러 저장소가 연결될 수 있으므로 데이터 모델은 N개 저장소와 브랜치를
지원한다. 다만 MVP 화면은 기본 저장소 1개·기본 브랜치 1개부터 제공한다.

### 결정 4 — 소스 연결은 파일이 아니라 가능한 한 심볼 단위다

라인 번호는 코드가 조금만 바뀌어도 무효가 된다. 연결 우선순위는 다음과 같다.

1. API route + HTTP method
2. export된 함수·컴포넌트·클래스·상수 이름
3. Prisma 모델·테이블·컬럼
4. 테스트 케이스 이름
5. 파일 경로
6. 라인 범위는 현재 증거 표시용으로만 사용

### 결정 5 — 판단 결과를 강제로 스펙/소스 양자택일시키지 않는다

현재 SPECODE 모델로 표현할 수 없는 API 계약, 상태 전이, 배치 규칙 등이 발견될 수 있다.
이 경우 `MODEL_GAP(설계 모델 보완 필요)`으로 분류한다.

### 결정 6 — 제출된 Diff를 곧바로 사실로 믿지 않는다

제출 경로마다 증거 신뢰도가 다르다.

| 등급 | 검증 방법 | 자동화 사용 범위 |
|---|---|---|
| `PROVIDER_VERIFIED` | 서버가 Git provider에서 commit 존재·부모 관계·Diff를 직접 조회 | 검토 완료 후 체크포인트 확정 가능 |
| `LOCAL_AGENT_ATTESTED` | 연결된 로컬 에이전트가 저장소 fingerprint, commit, Diff hash를 수집 | 사람 검토 후 확정 가능 |
| `USER_UPLOADED` | 사용자가 patch·파일을 직접 업로드 | 분석 보조만, 단독 자동 확정 금지 |

`PROVIDER_VERIFIED`는 base와 head가 실제로 존재하고 base가 head의 조상인지 확인한다.
로컬 에이전트 증명은 원격 저장소의 진실까지 보장하지 못하므로 그 한계를 UI에 표시한다.
어떤 등급이든 AI의 의미 해석은 별도의 추론이며, 증거 검증과 혼동하지 않는다.

---

## 5. 사용자 경험

### 5-1. 유형 A — 구현요청 작업 완료

#### 정상 흐름

```text
[SPECODE 구현요청]
  aiTaskId + 스펙 스냅샷 + 현재 Git commit(C0)
       ↓
[Claude/Codex/개발자 구현]
       ↓
[구현 완료]
  완료 commit(C1) + C0..C1 Diff + 테스트 결과 + 구현 편차 제출
       ↓
[AI 재검증]
  작업자의 자기 보고와 실제 Diff를 대조
       ↓
[스펙 반영함]
  검토할 항목이 없고 증거가 검증됐으면 정합성 확정 후보
  LOCAL_AGENT_ATTESTED 이하이면 담당자 확인 후 확정
  검토할 항목이 있으면 담당자에게 표시
```

#### 구현 작업자 완료 보고

구현요청 프롬프트는 구현 작업자에게 다음 결과를 의무적으로 반환하도록 한다.

```json
{
  "aiTaskId": "구현요청 ID",
  "baseCommit": "C0",
  "headCommit": "C1",
  "changedFiles": [],
  "implementedBehaviors": [],
  "deviationsFromSpec": [],
  "newDecisions": [],
  "temporaryWorkarounds": [],
  "testResults": [],
  "unresolvedIssues": []
}
```

작업자의 `deviationsFromSpec`가 비어 있어도 실제 Diff를 다시 분석한다. 자기 보고는
유용한 힌트이지 검증을 대체하지 않는다.

### 5-2. 유형 B — 구현 완료 후 개발자가 수정

#### 권장 흐름

```text
[개발자가 기존 소스 수정]
       ↓
[IDE에서 "SPECODE 변경 제출"]
  또는 Claude/Codex에 "이번 변경을 SPECODE에 반영해줘"
       ↓
[도구가 자동 수집]
  프로젝트 ID
  프로젝트의 소스 저장소·브랜치
  마지막 VERIFIED 체크포인트(C4)
  현재 commit(C5)
  C4..C5 Diff
  커밋 메시지
  테스트 결과
       ↓
[증거 검증]
  commit 존재 여부, C4가 C5의 조상인지, Diff hash 검증
       ↓
[영향 대상 식별]
  1단계: 제출자가 선택한 설계 대상 + AI 후보
  3단계 이후: 연결지도 후보 추가
       ↓
[AI 영향 분석]
       ↓
[스펙 반영함]
```

#### 변경 전 등록을 강제하지 않는다

개발자가 먼저 SPECODE에서 “수정 작업 시작” 버튼을 누르도록 강제하면 현실에서 우회된다.
다음 세 가지 경로를 모두 지원하되 결과 형식은 동일하게 만든다.

1. **권장:** 작업 전 SPECODE 구현/후속변경 ID를 발급받고 개발
2. **일반:** 개발 완료 후 Git commit 범위를 선택해 제출
3. **복구:** 이미 여러 commit이 지나간 뒤 날짜·브랜치·commit 범위로 뒤늦게 제출

#### 커밋하지 않은 변경

작업 트리 Diff도 `DRAFT`로 분석할 수 있다. 다만 정합성 확정점은 안정적인 commit SHA가
필요하므로 Git 프로젝트는 커밋 후 최종 제출한다. 미커밋 Diff는 체크포인트를 전진시키지
않는다.

#### 비-Git 프로젝트

Git이 없는 프로젝트는 `SOURCE_MANIFEST` 체크포인트를 사용한다. manifest에는 제외 규칙을
통과한 파일 경로와 SHA-256, 선택적으로 export·API·테이블 같은 심볼 목록을 기록한다.
다음 제출에서는 두 manifest의 차이와 변경 파일만 수집한다.

- `.env`, 인증서, 토큰, vendor, build 결과물, 생성 파일은 기본 제외한다.
- manifest는 “그 시점의 파일 집합”을 증명할 뿐 작성자나 원격 이력을 증명하지 못한다.
- 따라서 신뢰등급을 `LOCAL_AGENT_ATTESTED` 또는 `USER_UPLOADED`로 표시하고 사람의
  최종 확인을 요구한다.
- Git과 동일한 수준의 ancestry·commit 진위 보장을 제공한다고 표현하지 않는다.

---

## 6. 영향 대상 식별과 스펙-소스 연결지도

### 6-1. 1단계에서는 연결지도를 전제하지 않는다

아직 과거 연결 데이터가 없는데 연결지도가 있어야 MVP가 동작하도록 만들면 순환 의존이
생긴다. 1단계 제출 화면은 다음 순서로 대상을 찾는다.

1. 제출자가 최소 하나의 단위업무·화면·영역·기능을 선택한다.
2. 유형 A는 `ai_task_id`와 `tb_sp_impl_snapshot`을 이용해 요청 당시 대상을 자동 채운다.
3. AI가 파일·심볼·API·테이블을 분석해 추가 영향 후보를 제안한다.
4. `LOW` 후보는 사용자가 확인하기 전까지 검토 대상에 확정하지 않는다.
5. 사용자의 추가·제외 결과를 평가 데이터로 남기되 아직 별도 연결지도 테이블을 만들지
   않는다.

### 6-2. 3단계에서 연결지도가 필요한 이유

유형 B에서 변경된 파일만 보고 관련 SPECODE 기능을 매번 처음부터 추론하면 오탐이 많고
비용도 크다. 최초 구현 때 실제로 만들어진 소스를 분석해 연결지도를 축적하면 이후
변경은 훨씬 정확하고 빠르게 찾을 수 있다. 다만 0~1단계 실사용 결과로 어떤 연결이
안정적인지 확인한 뒤 영속 모델을 도입한다.

### 6-3. 연결 예

```text
FID-00109 단위업무 삭제
├─ src/app/api/projects/[id]/unit-works/[unitWorkId]/route.ts
│  └─ DELETE
├─ src/app/(main)/projects/[id]/unit-works/[unitWorkId]/page.tsx
│  └─ handleDelete
├─ src/components/common/ConfirmDialog.tsx
│  └─ 공통 사용(낮은 독점도)
└─ tb_ds_unit_work.use_yn
```

### 6-4. N:M 관계

- 기능 하나가 여러 파일·API·테이블을 사용한다.
- 공통 파일 하나가 여러 기능에서 사용된다.
- 연결마다 `DIRECT`, `SHARED`, `GENERATED`, `TEST`, `DATA` 관계 유형을 기록한다.
- 공통 파일 변경은 연결된 모든 기능을 무조건 변경 대상으로 만들지 않고, 변경된 심볼과
  호출 관계를 추가 분석한다.

### 6-5. 연결 신뢰도

| 신뢰도 | 근거 |
|---|---|
| `CONFIRMED` | 구현요청 결과와 실제 소스에서 직접 연결 확인 |
| `HIGH` | API·컴포넌트·테이블 이름이 명확하게 일치 |
| `MEDIUM` | 호출 관계와 문맥상 관련 가능성이 높음 |
| `LOW` | 파일명·키워드 기반 추정 |

`LOW` 연결은 자동 스펙 후보의 단독 근거로 사용하지 않는다.

---

## 7. 변경 분류 규칙

| 분류 | 의미 | 기본 처리 |
|---|---|---|
| `CONFORMING` | 스펙을 그대로 구현한 변경 | 자동 종료 가능 |
| `IMPLEMENTATION_DETAIL` | 리팩터링·성능·구조 변경이지만 외부 동작은 동일 | 감사 기록만 저장 |
| `SPEC_CLARIFICATION` | 스펙이 모호했고 구현 과정에서 세부 규칙이 확정됨 | 스펙 보완 후보 |
| `SPEC_CHANGE` | 사용자 동작·업무 규칙·계약이 변경됨 | 사람 승인 후 스펙 수정 |
| `SPEC_VIOLATION` | 실수 또는 오해로 기존 스펙과 충돌 | 소스 수정 요청 |
| `TEMPORARY_EXCEPTION` | 일정·기술 제약으로 임시 우회 | 사유·만료일·해결 과제 필수 |
| `MODEL_GAP` | 중요한 설계인데 현재 SPECODE 필드로 표현 불가 | 설계 모델 확장 검토 |
| `UNKNOWN` | 근거가 부족하거나 여러 해석이 가능 | 사용자 판단 필요 |

### 반드시 스펙 영향 후보로 올리는 변경

- 사용자에게 보이는 동작과 화면 흐름
- 필수/선택, validation, 오류 처리
- 권한과 역할
- API 경로·메서드·필수 파라미터·허용값·응답 의미
- DB 테이블·컬럼 사용과 데이터 의미
- 상태 전이, 승인 절차, 배치 규칙
- 인수기준과 테스트 가능 조건
- 파일 다운로드·외부 전송·민감정보 노출

### 기본적으로 스펙에서 제외하는 변경

- 변수·함수명 변경
- 동작이 같은 파일 분리와 리팩터링
- 코드 포맷팅
- 의존성 내부 사용법 변경
- 외부 동작이 같은 캐시·인덱스·쿼리 최적화
- 생성 파일, lock 파일

단, “성능 개선”이 응답 제한, 정렬, 조회 범위, 정합성에 영향을 주면 스펙 후보로 다시
분류한다.

---

## 8. 사실·추론·제안의 분리

각 검토 항목은 한 문단으로 섞지 않고 다음 세 블록을 갖는다.

### 확인된 소스 사실

```text
DELETE API의 권한 검사가 content.delete에서 project.delete로 변경됨
근거: src/app/api/.../route.ts / DELETE / commit abc123
```

### AI가 추론한 영향

```text
MEMBER가 수행하던 삭제가 OWNER 전용으로 바뀔 가능성이 있음
관련 후보: FID-00109
확신도: HIGH
```

### 제안

```text
기능 설명의 삭제 권한을 OWNER 전용으로 수정
```

확인된 사실만으로 결론을 확정할 수 없으면 `UNKNOWN`으로 남긴다. AI가 추론한 내용을
확인된 소스 사실 칸에 넣지 않는다.

### 8-1. 증거 검증 결과도 별도 표시

“이 Diff가 실제 저장소의 C4..C5이다”라는 사실과 “이 변경은 FID-00109의 권한을
바꾼다”라는 추론은 서로 다른 문제다. 상세 화면은 다음 네 층을 분리한다.

1. **제출 정보:** 제출자, 저장소·브랜치, base/head 또는 manifest
2. **검증 정보:** 신뢰등급, commit 존재, ancestry, Diff hash, 검증 주체·시각
3. **확인된 소스 사실:** 실제 변경 파일·심볼·계약
4. **AI 추론과 스펙 제안:** 영향 대상, 의미, 수정 후보, 확신도

검증 실패 시 분석 결과를 참고용으로 볼 수는 있지만 `VERIFIED` 체크포인트로 확정할 수
없다. 사용자가 업로드한 Diff의 commit 문자열만으로 진위를 확인했다고 표시해서는 안
된다.

---

## 9. 스펙 반영함 UI

### 9-1. 권장 위치

- LNB `AI 작업실` 그룹에 **스펙 반영함** 추가
- 경로 제안: `/projects/{id}/spec-reconciliations`
- AI 태스크 상세에는 `구현 결과` 탭 추가
- 단위업무·화면·영역·기능 상세에는 `미반영 변경 N건` 배지 표시

스펙 반영함은 단순 조회 화면이 아니라 사용자가 결정을 내리는 작업 화면이므로
`데이터 조회`보다 `AI 작업실`이 적합하다.

### 9-2. 목록 화면

```text
+-----------------------------------------------------------------------+
| 스펙 반영함                         [변경 제출] [Git 연동 설정]         |
+-----------------------------------------------------------------------+
| 상태 [검토 필요 v]  출처 [전체 v]  위험도 [전체 v]  담당 [내 담당 v] |
+-----------------------------------------------------------------------+
| 출처       | Commit/작업       | 영향 범위     | 중요 | 일반 | 상태   |
| 최초 구현  | AI-123 / abc123   | UW 1 / F 4    |  1   |  3   | 검토   |
| 후속 변경  | def456..ghi789     | F 2 / API 1   |  2   |  1   | 검토   |
+-----------------------------------------------------------------------+
```

### 9-3. 상세 화면

```text
+----------------------+----------------------+--------------------------+
| 요청 당시 스펙       | 확인된 소스 변경     | 스펙 수정 제안           |
|                      |                      |                          |
| 삭제: MEMBER 가능    | OWNER 권한으로 변경  | 삭제: OWNER만 가능       |
|                      | file / symbol / diff |                          |
+----------------------+----------------------+--------------------------+
| 분류: SPEC_CHANGE    | 위험도: HIGH         | 확신도: HIGH             |
| 증거: PROVIDER_VERIFIED / ancestry 정상 / Diff hash 일치             |
| AI 추론 근거: ...                                                   |
+---------------------------------------------------------------------+
| [스펙에 반영] [소스 수정 요청] [영향 없음] [임시 예외] [판단 보류] |
+---------------------------------------------------------------------+
```

### 9-4. 검토 액션

| 액션 | 결과 |
|---|---|
| **스펙에 반영** | 대상 필드 수정 후보에 포함 |
| **소스 수정 요청** | 보완 구현 태스크 또는 외부 작업 생성 |
| **스펙 영향 없음** | 근거를 기록하고 항목 종료 |
| **임시 예외** | 사유·담당자·만료일 입력 |
| **설계 모델 보완** | `MODEL_GAP`으로 별도 설계 과제 생성 |
| **판단 보류** | 리뷰 담당자 지정 또는 일반 리뷰 요청 연결 |

### 9-5. 일괄 처리 제한

`IMPLEMENTATION_DETAIL`과 낮은 위험도의 `SPEC_CLARIFICATION`은 일괄 처리할 수 있다.
다음은 반드시 개별 검토한다.

- 권한·보안
- 데이터 삭제·내보내기
- API 호환성 파괴
- DB 의미·필수 여부 변경
- 주요 화면·업무 흐름
- 인수기준 변경
- `TEMPORARY_EXCEPTION`
- `MODEL_GAP`

### 9-6. 디자인 시스템 적용 원칙

실제 UI 구현 시 다음을 따른다.

- 기존 `sp-table`, `sp-tab`, `sp-group`, `sp-badge`, `sp-btn`, `sp-modal`을 우선 사용한다.
- 검토 필요는 `sp-badge-warning`, 위반은 `sp-badge-error`, 확정은
  `sp-badge-success`, 정보성 추론은 `sp-badge-info`로 표현한다.
- 색·간격·폰트·반경은 semantic 토큰만 사용한다.
- 모든 신규 클래스는 `sp-`, 상태 클래스는 `is-` 접두어를 사용한다.
- dark/light/dark-purple 세 테마와 사이드바 접힘 상태를 검증한다.

---

## 10. 상태 모델

### 10-1. 구현 결과 패키지

```text
DRAFT
  → SUBMITTED
  → ANALYZING
  → ANALYZED
  → RECONCILING
  → VERIFIED
  → CLOSED

실패: ANALYSIS_FAILED
취소: CANCELLED
```

### 10-2. 검토 항목

```text
PENDING
  ├─ APPLY_SPEC
  ├─ FIX_SOURCE
  ├─ NO_SPEC_CHANGE
  ├─ ACCEPT_EXCEPTION
  ├─ MODEL_GAP
  └─ DEFERRED

각 결정의 실제 조치 완료 후 RESOLVED
```

### 10-3. 종료 조건

다음 조건을 모두 만족해야 패키지를 `VERIFIED/CLOSED`로 전환한다.

1. 중요 변경 항목이 모두 결정되었다.
2. `APPLY_SPEC` 항목이 실제 스펙에 반영되었다.
3. `FIX_SOURCE` 항목은 수정 commit 또는 새 manifest를 다시 제출해 검증했다.
4. `ACCEPT_EXCEPTION`은 만료일과 담당자가 있다.
5. `MODEL_GAP`은 연결된 설계 과제가 있다.
6. Git이면 확정할 commit SHA, 비-Git이면 확정할 source manifest hash가 존재한다.
7. 증거 신뢰등급과 검증 결과가 저장되어 있다. 검증 불가 증거를 확정하려면 승인자의
   명시적 override 사유가 필요하다.
8. 저장된 base가 현재 소스 기준선과 같은지 낙관적 잠금으로 다시 확인했다.

### 10-4. 1단계 MVP의 실제 종료 방식

1단계는 **안전한 구조화 변경을 제한적으로 자동 적용한다.** 첫 적용 대상은
`tb_ds_function.func_dc` 한 필드다. 결정별 완료
조건을 다음처럼 제공해 실제로 `CLOSED`까지 도달시킨다.

| 결정 | 1단계 완료 방법 |
|---|---|
| `APPLY_SPEC` | 현재 필드 hash가 `before_hash`와 같으면 원클릭 적용 + 변경 이력 저장. 다르면 `STALE_SPEC` |
| `FIX_SOURCE` | 수정 commit/manifest를 같은 receipt의 보완 증거로 제출 → 해당 항목 재분석 |
| `NO_SPEC_CHANGE` | 검토 사유를 저장하면 즉시 해결 |
| `ACCEPT_EXCEPTION` | 사유·담당자·만료일·후속 과제를 저장하면 조건부 해결 |
| `MODEL_GAP` | 일반 리뷰 또는 설계 개선 과제를 연결하면 해결 |
| `DEFERRED` | 해결이 아니므로 패키지 종료를 막음 |

`APPLY_SPEC`는 대상 PK·필드명·전체 before/after 값·before hash를 사용한다. 클릭 시 AI를
다시 호출하거나 문자열 전체 검색을 하지 않는다. 서버가 현재 필드의 hash를 다시 계산하고,
일치할 때만 전체 필드 교체와 `tb_ds_design_change` 생성을 한 트랜잭션으로 수행한다.
불일치하면 자동 병합하지 않고 `STALE_SPEC`으로 전환한다.

---

## 11. 데이터 모델 제안

1단계에서는 역할이 분명한 최소 테이블만 추가한다. 별도 정합성 검토 헤더는 만들지 않고
receipt가 검토 헤더 역할까지 맡는다. 아래 명칭은 설계안이며 실제 DDL 작성 전 명명
규칙을 재검토한다.

### 11-1. `tb_sp_source_baseline` — 저장소·브랜치별 현재 확정점

이 테이블이 Claude 피드백에서 지적된 “다음 유형 B 제출이 공통으로 조회할 기준점”이다.
개별 receipt의 필드만 조회해 기준을 추정하지 않는다.

| 컬럼 | 의미 |
|---|---|
| `baseline_id` | PK |
| `prjct_id` | 프로젝트 |
| `repo_key` | 저장소 식별자. 원격 URL 원문 대신 안정적인 내부 키 권장 |
| `repo_provider_code` | `GITHUB/GITLAB/LOCAL/NONE/ETC` |
| `branch_nm` | 이 기준선이 추적하는 브랜치 |
| `checkpoint_type_code` | `GIT_COMMIT` 또는 `SOURCE_MANIFEST` |
| `last_reconciled_commit_sha` | Git의 현재 정합성 확정점 |
| `last_reconciled_manifest_hash` | 비-Git의 현재 정합성 확정점 |
| `last_receipt_id` | 이 확정점을 만든 receipt |
| `checkpoint_version_no` | 동시 제출 충돌 방지용 증가 번호 |
| `history_audit_code` | `NOT_AUDITED/VERIFIED_FROM_POINT/FULLY_AUDITED` |
| `reconciled_dt`, `reconciled_mber_id` | 마지막 확정 시각·승인자 |
| `use_yn` | 사용 여부 |

`(prjct_id, repo_key, branch_nm)`을 유일하게 관리한다. 프로젝트 하나에 여러
저장소·브랜치가 필요하면 행을 추가할 수 있지만, MVP UI는 기본 저장소·브랜치 한 행만
노출한다. receipt가 확정될 때 `base = 현재 baseline`을 다시 검사한 후 같은 트랜잭션에서
새 checkpoint와 `checkpoint_version_no`를 갱신한다. 과거 확정 이력은 receipt가 보존한다.
최초 초기화와 receipt 종료 트랜잭션 외에는 baseline 값을 직접 수정할 수 없게 한다.

### 11-2. `tb_sp_impl_receipt` — 변경 패키지 겸 검토 헤더

| 컬럼 | 의미 |
|---|---|
| `receipt_id` | PK |
| `prjct_id` | 프로젝트 |
| `origin_type_code` | `IMPLEMENTATION` 또는 `MAINTENANCE` |
| `ai_task_id` | 유형 A이면 원 구현요청 태스크, 유형 B이면 NULL 가능 |
| `baseline_id` | 비교와 확정에 사용하는 `tb_sp_source_baseline` |
| `checkpoint_version_no` | 제출 당시 기준선 version |
| `base_commit_sha` | 비교 시작점 |
| `head_commit_sha` | 비교 종료점 |
| `base_manifest_hash`, `head_manifest_hash` | 비-Git 비교 시작·종료점 |
| `evidence_trust_code` | `PROVIDER_VERIFIED/LOCAL_AGENT_ATTESTED/USER_UPLOADED` |
| `evidence_verify_sttus_code` | `PENDING/VERIFIED/FAILED/OVERRIDDEN` |
| `ancestry_verify_yn` | Git base가 head의 조상인지 검증 결과 |
| `diff_hash` | 수집·분석한 Diff의 무결성 확인값 |
| `evidence_verify_data` | provider object ID, 로컬 fingerprint, manifest hash 등 검증 상세 |
| `override_rsn_cn`, `override_mber_id` | 검증 불가 증거를 승인한 사유·승인자 |
| `pr_url` | PR URL, 선택 |
| `summary_cn` | 작업자 완료 요약 |
| `manifest_data` | 변경 파일·편차·테스트 등 구조화 결과 |
| `selected_target_data` | 1단계에서 사용자가 선택한 단위업무·화면·영역·기능 |
| `receipt_sttus_code` | 패키지 상태 |
| `review_sttus_code` | 검토 상태 |
| `risk_summary_data` | 위험도별 건수 |
| `revwr_mber_id` | 주 검토자 |
| `analysis_version` | 분석 규칙·프롬프트 버전 |
| `submit_mber_id` | 제출자 |
| `creat_dt`, `verified_dt`, `closed_dt` | 생성·검증·종료 시각 |

Unified diff와 테스트 로그는 `tb_cm_attach_file`의 다형 참조
(`ref_tbl_nm = 'tb_sp_impl_receipt'`, `ref_id = receipt_id`)로 연결한다. 헤더에 별도 파일 FK를
중복 보관하지 않는다.

### 11-3. `tb_sp_reconcile_item` — 변경 후보 및 결정

| 컬럼 | 의미 |
|---|---|
| `item_id` | PK |
| `receipt_id` | 변경 패키지 겸 검토 헤더 |
| `classification_code` | 변경 분류 |
| `risk_code` | `LOW/MEDIUM/HIGH/CRITICAL` |
| `ref_tbl_nm`, `ref_id` | 영향받는 스펙 |
| `target_field_nm` | 수정 후보 필드 |
| `observed_evidence_data` | 확인된 파일·심볼·Diff |
| `inferred_impact_cn` | AI가 추론한 영향 |
| `before_value` | 분석 당시 스펙 값 |
| `proposed_value` | 스펙 수정 제안 |
| `before_hash` | 승인 시 동시 수정 충돌 방지 |
| `confidence_code` | 추론 확신도 |
| `decision_code` | 사용자의 결정 |
| `decision_rsn_cn` | 결정 근거 |
| `exception_expire_dt` | 임시 예외 만료 |
| `design_change_id` | 스펙 반영 완료 후 생성된 `tb_ds_design_change` 연결 |
| `review_mber_id`, `review_dt` | 검토자·시각 |
| `item_sttus_code` | 처리 상태 |

### 11-4. `[DEFERRED — 3단계] tb_sp_spec_source_link` — 스펙-소스 연결지도

1단계 생성 대상이 아니다. 0~1단계의 실제 제출에서 사용자 선택과 AI 후보의 정확도를
검증한 후 도입한다.

| 컬럼 | 의미 |
|---|---|
| `link_id` | PK |
| `prjct_id` | 프로젝트 |
| `ref_tbl_nm`, `ref_id` | 단위업무·화면·영역·기능 등 다형 참조 |
| `source_kind_code` | `FILE/API/SYMBOL/TABLE/COLUMN/TEST` |
| `source_path`, `source_symbol` | 파일 경로와 안정적인 심볼 |
| `relation_type_code` | `DIRECT/SHARED/GENERATED/TEST/DATA` |
| `confidence_code` | `CONFIRMED/HIGH/MEDIUM/LOW` |
| `first_receipt_id`, `last_receipt_id` | 연결을 만든 최초·최신 패키지 |
| `use_yn` | 현재 연결 사용 여부 |

### 11-5. 기존 테이블 재사용

| 기존 테이블 | 재사용 방법 |
|---|---|
| `tb_ai_task` | 유형 A 원 구현요청 연결, 보완 구현 태스크 생성 |
| `tb_sp_impl_snapshot` | 구현요청 당시 스펙 기준선 |
| `tb_ds_design_change` | 승인된 스펙 수정의 실제 변경 이력 |
| `tb_cm_attach_file` | Diff, 테스트 결과, 로그 첨부 |
| `tb_ds_review_request` | 판단 보류·전문가 검토가 필요할 때 사람 리뷰 배정 |

일반 리뷰 요청은 구조화된 정합성 항목을 대체하지 않고, 필요한 항목에 대한 추가 협의
채널로만 사용한다.

---

## 12. 스펙 변경 적용 규칙

### 12-1. 승인 후에만 수정

`APPLY_SPEC` 결정이 난 항목을 모아 한 번의 트랜잭션으로 적용한다.

1. `before_hash`와 현재 스펙 값 비교
2. 같으면 제안값 적용
3. 다르면 `STALE`로 표시하고 재분석
4. 대상 단위업무·화면·영역·기능 수정
5. `tb_ds_design_change`에 before/after와 변경 사유를 기록하고, 유형 A는 `ai_task_id`,
   유형 B는 `snapshot_data`에 `receipt_id/reconcile_item_id`를 기록
6. 생성된 `chg_id`를 정합성 항목의 `design_change_id`에 연결
7. 승인자·승인 시각 기록
8. receipt를 종료하고 `tb_sp_source_baseline`을 새 commit/manifest로 전진

위 자동 적용 흐름은 **1단계부터 `FUNCTION.func_dc`에 한해 사용한다.** 2단계는 같은
프로토콜을 단위업무·화면·영역의 허용 필드로 확장한다.

### 12-2. `PRE_IMPL`과 구분

현재 `PRE_IMPL`은 “이미 구현했다”는 사용자 선언으로 구현요청 스냅샷만 갱신한다.
새 기능에서 검토와 승인을 거친 반영은 별도 유형을 사용한다.

```text
task_ty_code 또는 이벤트 유형 제안: SPEC_RECONCILE
```

`PRE_IMPL`을 그대로 재사용하면 과거의 단순 기준선 초기화와 실제 근거 검토 완료를
구분할 수 없다.

두 기능이 같이 존재하는 기간의 UX 규칙은 다음과 같다.

1. 기존 버튼은 **`선 구현 적용(소스 검증 없음)`**으로 표시하고 설명·사유 입력을
   의무화한다.
2. 권장 CTA는 **`소스 변경 제출`**이며, commit·Diff·manifest가 있는 경우 이 경로로
   유도한다.
3. `PRE_IMPL`은 기존 `tb_sp_impl_snapshot`만 갱신한다. source baseline을 만들거나
   receipt를 `VERIFIED/CLOSED`로 만들 수 없다.
4. 같은 범위에 미해결 receipt가 있으면 `PRE_IMPL`로 그 경고를 닫을 수 없다.
5. `SPEC_RECONCILE` 완료만 검증된 source baseline을 전진시킨다.
6. 사용 패턴이 안정화되면 `PRE_IMPL`은 관리자용 복구 기능으로 축소하거나 숨긴다.

또한 현재 소스에서 폐지된 AI 태스크의 수동 `APPLIED` 상태를 되살리지 않는다.
`tb_ai_task` 상태는 AI 실행의 완료 여부이고, 정합성 상태는 별도
receipt의 `review_sttus_code`에서 관리한다. 구현 태스크가 `DONE`이어도 스펙 검토는
`NEEDS_REVIEW`일 수 있다.

### 12-3. 코드 수정 요청

`FIX_SOURCE`는 스펙을 수정하지 않는다.

- 원 구현요청과 연결된 보완 AI 태스크를 생성하거나
- 후속 변경이면 새 수정 태스크를 생성한다.
- 수정 commit이 제출되면 해당 항목만 다시 분석한다.
- 재검증 전에는 정합성 검토를 종료하지 않는다.

---

## 13. API 및 MCP 설계 제안

### 13-1. API

```text
GET  /api/projects/[id]/source-baselines
POST /api/projects/[id]/source-baselines
POST /api/projects/[id]/source-baselines/[baselineId]/initialize

POST /api/projects/[id]/impl-receipts
GET  /api/projects/[id]/impl-receipts/[receiptId]
POST /api/projects/[id]/impl-receipts/[receiptId]/analyze

GET  /api/projects/[id]/spec-reconciliations
GET  /api/projects/[id]/spec-reconciliations/[receiptId]
POST /api/projects/[id]/spec-reconciliations/[receiptId]/items/[itemId]/decision
POST /api/projects/[id]/spec-reconciliations/[receiptId]/items/[itemId]/confirm-resolution
POST /api/projects/[id]/spec-reconciliations/[receiptId]/verify

2단계 추가:
POST /api/projects/[id]/spec-reconciliations/[receiptId]/apply
```

분석은 오래 걸릴 수 있으므로 `analyze`가 AI 태스크를 생성하고 비동기로 처리하는 구조를
우선 검토한다. 별도 reconcile header가 없으므로 URL 식별자도 모두 `receiptId`로
통일한다.

### 13-2. MCP 도구

```text
submit_implementation_receipt
  - 최초 구현 결과 제출(유형 A)

submit_maintenance_change
  - 완료 후 개발자 수정 제출(유형 B)

get_reconciliation
  - 생성된 검토 결과 조회

confirm_reconciliation_resolution
  - 사용자가 기존 화면에서 수행한 스펙/소스 조치의 재검증 요청
```

스펙에 실제 적용하는 MCP 도구는 초기 버전에서 제공하지 않는 것을 권장한다. 적용은
중요한 제품 판단이므로 웹 UI에서 승인하게 한다. 추후 제공하더라도 명시적인 승인 토큰과
낙관적 잠금 검증이 필요하다.

새 API 인터페이스를 추가하면 프로젝트 규칙에 따라
`src/lib/mcp/register-tools.ts`를 함께 검토·수정한다.

### 13-3. 개발자가 실제로 사용하는 가장 단순한 명령

Claude Code 또는 Codex에 다음처럼 말할 수 있어야 한다.

> 이번 변경을 SPECODE에 제출하고 스펙 반영 후보를 만들어줘.

에이전트는 자동으로:

1. 현재 프로젝트와 저장소 컨텍스트 확인
2. 저장소·브랜치의 source baseline과 version 조회
3. 현재 commit 또는 source manifest와 Diff, 테스트 결과 수집
4. 가능한 범위에서 ancestry·Diff hash를 검증하고 신뢰등급 표시
5. 영향받은 설계 대상을 자동 제안하고 불명확할 때만 사용자에게 확인
6. `submit_maintenance_change` 호출
7. 생성된 검토함 링크 반환

이것이 최종 사용자 경험이며, 사용자가 JSON을 직접 작성하게 만들면 안 된다.

---

## 14. 권한 및 보안

### 14-1. 권한 제안

```text
specReconcile.read      검토함 조회
specReconcile.submit    구현·후속 변경 제출
specReconcile.review    항목 판단
specReconcile.apply     스펙 수정 적용
specReconcile.override  중요 경고를 예외로 확정
```

지원 세션은 `.read`만 허용하는 현재 정책을 그대로 적용한다. `submit/review/apply/override`는
모두 지원 세션에서 차단되어야 한다.

권장 역할:

- 조회: VIEWER 이상
- 제출: MEMBER 이상
- 일반 검토: 담당자 또는 PM/PL/OWNER/ADMIN
- 중요 변경 적용: PM/PL/OWNER/ADMIN
- 권한·삭제·보안·API 파괴 변경 예외 승인: OWNER/ADMIN

세부 매트릭스는 실제 PRD 작성 시 `src/lib/permissions.ts`와 함께 확정한다.

### 14-2. 소스 보호

- 전체 저장소 압축본보다 필요한 commit 범위의 Unified Diff를 우선 저장한다.
- `.env`, 키, 토큰, 인증서, 비밀 파일은 제출 전에 필터링한다.
- 비-Git manifest에도 동일한 제외 규칙을 적용하며 파일 내용 대신 경로·hash를 우선
  저장한다.
- Diff에도 민감정보 탐지 검사를 수행한다.
- 프로젝트 정책으로 보관 기간을 설정한다.
- 원본 Diff 삭제 후에도 결정 근거 요약과 commit SHA는 감사 이력으로 유지한다.
- 외부 저장소 접근 토큰은 프로젝트 API 키 저장소와 별도 목적·권한으로 관리한다.

---

## 15. 예외 및 실패 시나리오

### 15-1. 여러 기능이 하나의 공통 파일을 사용

연결된 모든 기능을 확정 변경으로 올리지 않는다. 변경 심볼·호출 관계를 분석하고
불확실하면 후보를 여러 개 제시한다.

### 15-2. 한 commit에 여러 업무 수정이 섞임

Diff hunk를 기준으로 여러 검토 항목으로 분리한다. commit을 다시 나누도록 강제하지는
않지만 다음부터 업무별 commit을 권장한다.

### 15-3. 스펙이 검토 중 다시 수정됨

`before_hash`가 달라지면 자동 적용하지 않고 `STALE`로 전환한다. 최신 스펙과 소스를 다시
비교한다.

### 15-4. 후속 변경 기준 commit을 알 수 없음

유형 B는 **저장된 source baseline만** 자동 비교 기준으로 사용한다. 마지막 receipt나
구현요청의 head commit을 암묵적으로 기준으로 승격하지 않는다. baseline이 없다면
프로젝트 최초 설정에서 다음 중 하나를 한 번 수행한다.

1. Git provider 또는 로컬 에이전트로 기준 commit을 선택하고 존재 여부를 검증한다.
2. 현재 소스와 스펙을 샘플 감사한 뒤 사용자가 `초기 기준선으로 승인`한다.
3. 비-Git이면 현재 `SOURCE_MANIFEST`를 만들고 승인한다.

초기 기준선은 “그 이전의 모든 변경이 검토되었다”는 뜻이 아니다. 과거 정합성은
`NOT_AUDITED`로 표시하고, 이 시점 이후의 변경부터 누락 없이 추적한다. 기준선 설정을
완료하지 않은 프로젝트에서는 유형 B 자동 분석을 시작하지 않고 설정 화면으로 안내한다.

### 15-5. 변경이 현재 설계 구조로 표현되지 않음

기능 설명에 임의로 문장을 추가하지 않는다. `MODEL_GAP`으로 등록하고 API 계약, 상태 모델,
비기능 요구 등의 구조 확장 여부를 별도 설계한다.

### 15-6. AI 분석이 틀림

- 확인된 사실과 추론을 분리한다.
- 근거 파일·심볼·Diff를 항상 함께 보여준다.
- 낮은 확신도는 자동 종결하지 않는다.
- 사용자의 수정 판단을 다음 분석의 평가 데이터로 축적한다.

### 15-7. 개발자가 변경 제출을 하지 않음

초기에는 자율 제출로 시작하고 다음 단계로 보완한다.

1. IDE 에이전트 작업 완료 절차에 제출 포함
2. Git pre-push 또는 CI에서 미제출 commit 경고
3. GitHub/GitLab webhook으로 새 PR 자동 감지
4. 안정화 후 중요 변경 미검토 시 merge 경고

처음부터 강제 차단하면 우회 가능성이 높으므로 경고→팀 정책→선택적 차단 순으로 도입한다.

### 15-8. commit 계보가 갈라졌거나 force-push 됨

base가 head의 조상이 아니면 일반 `C4..C5` 비교를 중단한다. 새 branch의 merge-base를
보여주고 다음 중 하나를 선택하게 한다.

- 원래 추적 브랜치에 merge한 뒤 다시 제출
- 별도 branch baseline을 등록
- 관리자 override로 전체 재감사 receipt 생성

force-push나 base commit 소실을 단순 “변경 없음”으로 처리하지 않는다.

### 15-9. 여러 제출이 같은 baseline에서 동시에 시작됨

두 receipt가 같은 `checkpoint_version_no`에서 시작할 수는 있다. 먼저 확정된 receipt만
baseline을 전진시키고, 나머지는 `STALE_BASELINE`으로 바꿔 새 baseline부터 재분석한다.

### 15-10. 업로드한 Diff와 commit 문자열이 조작될 수 있음

`USER_UPLOADED`는 표시된 commit의 진위를 증명하지 않는다. 자동 품질 게이트와 자동
baseline 전진에 사용하지 않고, 승인자가 원본 저장소 또는 별도 소스 snapshot을 확인한
뒤 override 사유를 남겨야 한다.

---

## 16. 대안 비교

| 대안 | 장점 | 문제 | 판단 |
|---|---|---|---|
| 파일마다 SPECODE ID 주석 | 단순 검색 가능 | N:M·리팩터링·개발자 부담·ID 노후화 | 보조 수단만 |
| 개발자가 SPECODE를 직접 수정 | 구현 의도를 사람이 정확히 앎 | 누락·귀찮음·일관성 부족 | 수동 fallback |
| GitHub PR만 연동 | 중앙에서 자동 수집 | 로컬·사내 Git·미커밋 변경 제외, 초기 구축 큼 | 2단계 이후 |
| 전체 소스를 매번 AI 재분석 | 연결 준비 불필요 | 느림·비용·오탐, 변경 범위 불명확 | 복구 모드 |
| **저장소 기준선 + 변경 패키지 + 반영함** | 두 변경 유형 지원, 기준점 명확, 개발 부담 낮음 | 신규 데이터·UI·MCP 필요 | **1단계 권장** |
| 연결지도까지 동시 구축 | 후속 영향 분석 자동화 | 실사용 데이터 없이 관계 모델부터 고정할 위험 | **3단계로 연기** |

---

## 17. 단계별 도입 계획

### 0단계 — 프로토콜 검증

- 실제 변경 5~10건을 **shadow 방식**으로 수행한다. 운영 스펙·DB는 자동 수정하지 않고
  MD/JSON 검토 결과만 만든다.
- 유형 A·B, 공통 파일, 스펙 위반, 단순 리팩터링을 반드시 섞고 비-Git 사용 가능성이
  있으면 manifest 사례도 포함한다.
- 사람이 먼저 만든 정답표와 AI 결과를 비교해 누락률, 오탐률, 영향 대상 수정률,
  판단 소요 시간, 증거 부족률을 측정한다.
- 각 사례에서 base/head 진위, ancestry, PRE_IMPL 혼동 여부, 최종 조치까지 기록한다.
- “중요 변경 누락 0건, 검토 후보 수가 사람이 감당 가능한 수준”이라는 팀 기준을 정하고
  통과해야 1단계 DB·화면 구현에 착수한다.

### 1단계 — 제한적 자동 적용 MVP

- `tb_sp_source_baseline`, `tb_sp_impl_receipt`, `tb_sp_reconcile_item` 세 테이블
- 기본 저장소·브랜치의 최초 baseline 설정과 낙관적 잠금
- Diff 또는 source manifest 제출, 신뢰등급·검증 결과 표시
- `submit_implementation_receipt`, `submit_maintenance_change` MCP
- AI 분석 결과를 기본 목록·상세 화면에 표시
- 제출자가 영향 대상을 선택하고 AI가 후보를 보완
- 별도 검토 헤더와 영속 스펙-소스 연결지도는 만들지 않음
- `FUNCTION.func_dc` 구조화 변경의 원클릭 적용 + `before_hash` 충돌 차단
- 적용과 `tb_ds_design_change` 생성을 같은 트랜잭션으로 처리
- `PRE_IMPL`은 `소스 검증 없음`으로 명확히 표시하고 receipt를 닫지 못하게 함

### 2단계 — 적용 대상 확장

- 단위업무·화면·영역의 허용 필드로 구조화 patch 적용 확대
- 겹치지 않는 변경의 3-way 병합 검토
- 일괄 적용·rollback
- `FIX_SOURCE`, `TEMPORARY_EXCEPTION`, `MODEL_GAP` 후속 처리
- 정합성 확정 과정 자동화와 사용자 입력 축소

### 3단계 — 연결지도 고도화

- 파일·심볼·API·테이블 연결 자동 축적
- 공통 파일 영향 분석
- 과거 판단을 이용한 정확도 개선
- 단위업무·화면·영역·기능 상세에 미반영 변경 배지

### 4단계 — Git 연동 및 품질 게이트

- GitHub/GitLab PR 자동 수집
- CI에서 미제출 변경 경고
- 중요 미해결 항목에 대한 merge/배포 정책
- 프로젝트별 보관·차단 정책

---

## 18. MVP 완료 기준

1. 최초 구현 작업이 스펙과 다르게 끝났을 때 실제 Diff와 편차를 하나의 패키지로 제출할
   수 있다.
2. 프로젝트의 기본 저장소·브랜치 또는 비-Git manifest에 초기 source baseline을 한 번
   저장할 수 있다.
3. 1→2→3→4 구현 후 개발자가 1번 범위를 수정해도 저장된 C4와 C5만 비교해 후속 변경으로
   제출할 수 있으며, 개별 receipt 값을 기준으로 추측하지 않는다.
4. 사용자가 선택한 영향 대상과 AI 후보를 함께 보여주며, 과거 연결지도가 없어도
   동작한다.
5. 각 후보에 증거 신뢰등급·확인된 소스 사실·AI 추론·스펙 제안을 분리해서 보여준다.
6. 사용자는 `스펙 반영/소스 수정/영향 없음/임시 예외/설계 모델 보완` 중 하나를 선택할
   수 있다.
7. `FUNCTION.func_dc` 제안은 hash가 같을 때 원클릭 적용되고, 다르면 `STALE_SPEC`으로
   안전하게 차단된다.
8. 승인되지 않은 소스 변경이 스펙을 자동 수정하지 않는다.
9. 승인된 스펙 변경은 변경자·근거 commit/manifest·관련 AI 태스크 또는 후속 변경
   패키지를 추적할
   수 있다.
10. 중요 항목이 미해결이거나 baseline version이 낡았으면 정합성 확정 상태가 되지 않는다.
11. `PRE_IMPL`은 검증된 정합성 완료나 source baseline 갱신으로 오인되지 않는다.
12. Git이 없는 프로젝트도 source manifest로 변경을 비교할 수 있다.
13. 파일별 SPECODE ID 주석과 영속 연결지도를 MVP 전제조건으로 요구하지 않는다.
14. MCP를 사용하는 개발자는 “이번 변경을 SPECODE에 제출해줘”라는 한 번의 요청으로
    제출을 완료할 수 있다.

---

## 19. 구현 착수 전에 결정해야 할 제품 질문

아래는 기술자가 임의로 정하면 안 되는 제품 결정이다.

1. 정합성 검토의 최종 승인자는 담당자, PM/PL, OWNER/ADMIN 중 누구인가?
2. 권한·삭제·API 파괴 변경은 항상 2인 승인을 요구할 것인가?
3. Git commit, 비-Git manifest, 사용자 업로드 중 어떤 증거까지 최종 확정에 허용할
   것인가?
4. 소스 Diff를 SPECODE DB/파일시스템에 얼마나 오래 보관할 것인가?
5. `MODEL_GAP`을 기존 리뷰 요청으로 보낼지 별도 설계 개선 백로그로 만들지?
6. 중요 미해결 변경이 있을 때 경고만 할지, AI 태스크 완료 또는 merge를 차단할지?
7. 여러 저장소가 하나의 SPECODE 프로젝트에 연결되는 구성을 MVP에서 지원할지?
8. 기존 프로젝트의 최초 source baseline을 누가 어떤 감사 수준으로 승인할 것인가?
9. `LOCAL_AGENT_ATTESTED`와 `USER_UPLOADED`를 확정할 때 필요한 추가 승인 수준은 무엇인가?

### 이 문서의 권장 기본값

- 일반 변경: 담당자 결정, PM/PL이 최종 정합성 확정
- 권한·보안·삭제·API 파괴: OWNER/ADMIN 승인
- Git 프로젝트의 미커밋 Diff: 초안 분석만 허용, 최종 확정은 commit 필수
- 비-Git 프로젝트: 승인된 `SOURCE_MANIFEST`로 최종 확정 가능
- `USER_UPLOADED`: 분석 보조가 기본이며 최종 확정에는 OWNER/ADMIN override 필요
- 초기 정책: 차단보다 경고 우선
- 다중 저장소: 데이터 모델은 고려하되 MVP UI는 저장소 1개부터
- 최초 baseline: PM/PL이 승인하고 과거 범위는 `NOT_AUDITED`로 명시
- Diff 보관: 프로젝트 설정값으로 두되 기본 정책은 별도 보안 검토 후 결정

---

## 20. Claude 검토 요청 체크리스트

Claude는 이 문서를 요약하는 데서 끝내지 말고 다음을 비판적으로 검토한다.

1. 유형 A와 유형 B가 실제로 다른 기준선과 입력 경로로 설계되었는가?
2. 1→2→3→4 이후 1번 범위를 수정하는 사례에서 2·3·4 변경이 다시 섞이지 않는가?
3. `tb_sp_source_baseline`이 유형 B의 프로젝트·저장소·브랜치 기준점을 실제로
   제공하며 receipt 값에 의존하지 않는가?
4. 기존 `tb_ai_task`, `tb_sp_impl_snapshot`, `tb_ds_design_change`,
   `tb_ds_review_request`의 재사용 경계가 적절한가?
5. 별도 review header를 제거하고 receipt에 합친 구조가 충분한가? source baseline까지
   receipt에 합치면 다음 제출의 공통 기준점이 사라지지 않는가?
6. `PRE_IMPL`과 정합성 확정 이벤트가 명확히 구분되는가?
7. 1단계에서 영속 연결지도 없이 사용자 선택+AI 후보만으로 실제 업무가 가능한가?
8. Git ancestry·Diff 진위, 비-Git manifest, 동시 제출을 충분히 방어하는가?
9. 스펙 자동 적용이 없는 1단계에서도 수동 반영 확인으로 실제 `CLOSED`에 도달하는가?
10. API·권한·DB·UI 설계에 빠진 실패 시나리오가 있는가?
11. MVP 범위가 너무 크다면 핵심 가치를 보존하면서 무엇을 다음 단계로 미룰 수 있는가?

검토 결과는 다음 형식으로 작성한다.

```text
1. 확인된 강점
2. 치명적 설계 결함
3. 과도하게 복잡한 부분
4. 누락된 시나리오
5. 데이터 모델 수정안
6. 사용자 흐름 수정안
7. MVP 축소안
8. 최종 권장안
9. 확인된 사실 / 가설 / 추가 확인 필요
```

### Claude에게 그대로 전달할 검토 프롬프트

> `md/SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md`를 읽고 SPECODE의 현재
> `PROJECT_OVERVIEW`, `PROJECT_INVENTORY`, Prisma 스키마, 구현요청·AI 태스크·설계 변경
> 소스와 대조해 설계 리뷰를 해줘. 문서를 요약하거나 동의하는 데서 끝내지 말고, 유형 A
> (최초 구현 편차)와 유형 B(구현 완료 후 후속 수정)가 실제로 다른 기준선과 수집 경로로
> 해결되는지 검증해. 특히 1→2→3→4 순차 구현 후 1번 범위를 수정하는 경우 2·3·4 변경이
> 다시 섞이지 않는지, 개별 receipt가 아닌 `tb_sp_source_baseline`이 다음 비교 기준으로
> 실제 동작하는지 확인해. 별도 review header 제거, 1단계 연결지도 연기, 증거 신뢰등급,
> Git ancestry·비-Git manifest, `PRE_IMPL` 공존 규칙, 자동 적용 없는 수동 종료 흐름도
> 반례로 검증해. 확인된 사실·근거 있는 가설·미확인을 구분하고, 치명적 결함, 과도한
> 복잡성, 누락 시나리오, 데이터 모델 수정안, 사용자 흐름 수정안, 핵심 가치를 유지한
> MVP 축소안을 제시해. 아직 코드는 수정하지 마.

---

## 21. 관련 현행 자료

- `md/PROJECT_OVERVIEW.md` — SPECODE 철학·정보 구조·현재 구현요청 흐름과 한계
- `md/PROJECT_INVENTORY.md` — 화면·API·DB·MCP 현행 목록
- `src/components/ui/ImplRequestPopup.tsx` — 구현요청 및 선 구현 적용 UI
- `src/lib/impl-request/collector.ts` — 4계층 스펙 수집과 이전 스냅샷 비교
- `src/app/api/projects/[id]/impl-request/submit/route.ts` — AI 태스크와 구현요청 스냅샷 저장
- `src/app/api/projects/[id]/impl-request/pre-impl/route.ts` — 선 구현 기준선 갱신
- `src/lib/mcp/register-tools.ts` — HTTP MCP 도구 등록
- `prisma/schema.prisma` — DB 단일 진실 소스
- `src/lib/permissions.ts` — 권한 단일 진실 소스
- `.claude/design/DS_TOKENS.md`, `DS_COMPONENTS.md`, `tokens.css`, `components.css`

---

## 22. 최종 구현 감사

| 설계 항목 | 구현 결과 |
|:----------|:----------|
| 유형 A 구현 편차 | `/run-ai-tasks IMP` + 구현요청 snapshot + implementation receipt |
| 유형 B 후속 수정 | `/sync-specode [UW-XXXXX]` + 영속 source baseline |
| 커밋 없는 변경 | `WORKTREE:{manifestHash}` DRAFT, 확정 전 baseline 전진 금지 |
| 비-Git | content-addressed gzip snapshot + `SOURCE_MANIFEST` |
| 증거 신뢰등급 | provider 직접 검증 / local attested / user uploaded override |
| 사실·추론·제안 분리 | receipt item 필드와 상세 화면에서 분리 표시 |
| 영향 대상 탐색 | 사용자 범위 + 4계층 context + 확정된 source link + fallback |
| 4계층 적용 | 중앙 target registry와 허용 필드 whitelist |
| 스펙 충돌 | before hash, 보수적 line 3-way merge, STALE_SPEC 재분석 |
| 사람 결정 | APPLY_SPEC / FIX_SOURCE / NO_SPEC_CHANGE / ACCEPT_EXCEPTION / MODEL_GAP / DEFERRED |
| 일괄 적용 | 저·중위험 구현 상세/명확화만 원자적 적용 |
| rollback | 적용 값 재검증 후 역변경 이력 + 자식 receipt 생성 |
| baseline 동시성 | version 조건 update와 실패 시 전체 transaction rollback |
| provider 자동 수집 | GitHub/GitLab 연결, provider compare, 서명 PR/MR webhook |
| 품질 gate | 프로젝트별 WARN/BLOCK·차단 위험도 + CI/merge/deploy 판정 API·MCP |
| 증거 보관 | 프로젝트별 보관일, dry-run 후 patch/content 정리, hash·판단 이력 유지 |
| 설계 화면 피드백 | 4계층 상세 미반영 변경 배지 |
| API·MCP 동기화 | 제출·조회·재분석·보완 확인·gate 도구 등록 |
| 검증 | migration, domain/snapshot test, DB rollback scenario, typecheck, production build |

---

## 23. 자동 비교 배치 구현 확정안 (2026-07-31)

### 결정

- receipt는 하나만 만든다. 배치는 `tb_sp_reconcile_batch` 자식으로 저장한다.
- receipt는 source evidence, 사람 결정, baseline 전진의 원자성 경계다.
- batch는 LLM 컨텍스트와 재시도의 경계다.
- 구현요청은 요청 당시 snapshot만 설계 대상으로 쓴다.
- 후속 수정은 UW 인자가 있으면 그 UW, 없으면 프로젝트 인덱스를 사용한다.

### 계획·실행·병합

1. 전체 변경 파일을 받는다. 최대 5,000개를 넘으면 분할 제출을 요구한다.
2. 확정 source link로 파일을 scope에 먼저 배정한다.
3. 남은 파일이 여러 scope에 걸리면 compact index만 담은 router task를 만든다.
4. 파일 30개, Diff 80,000자, 대상 100개, 설계 원문 120,000자 예산으로 분석 batch를 만든다.
5. 60,000자를 넘는 한 파일 patch는 segment로 나누고 모든 segment를 보관한다.
6. Worker는 router 완료 후 생성된 batch task를 재조회한다.
7. 모든 batch가 완료되면 동일 대상 제안을 deterministic merge한다.
8. 동일 값은 중복 제거하고 다른 값은 `BATCH_CONFLICT`로 남긴다.
9. 사람이 충돌 제안을 선택한 뒤 기존 6가지 검토 결정을 수행한다.
10. receipt 종료 시에만 source baseline을 한 번 전진한다.

### 실패·동시성

- 한 batch 실패는 완료 결과를 버리지 않고 `ANALYSIS_PARTIAL_FAILED`로 표시한다.
- 실패 batch만 retry한다.
- 마지막 batch의 동시 완료는 receipt row lock 뒤 상태를 다시 읽고 한 번만 병합한다.
- 자동 분석 중에는 이전 item 결정 API를 차단한다.
- 연결 실패 파일은 `UNMAPPED` batch로 남기며 누락하지 않는다.
- 기존 item을 교체하는 재분석은 `replaceExisting=true`를 명시해야 한다.
- 교체된 batch는 삭제하지 않고 `SUPERSEDED`로 남겨 AI 실행 감사 이력을 보존한다.

### 구현 파일

- Prisma/DDL: `prisma/schema.prisma`, `prisma/sql/2026-07-31_*spec_reconciliation.sql`
- 계획/분할: `batchContracts.ts`, `batchPartitioner.ts`, `batchPlanner.ts`
- 결과/병합: `batchResults.ts`
- Worker: task start/complete API, `/run-ai-tasks`
- UI: receipt 상세 `BatchProgressPanel`, 충돌 후보 선택 UI
- MCP: `queue_reconciliation_analysis`, `retry_reconciliation_batch`

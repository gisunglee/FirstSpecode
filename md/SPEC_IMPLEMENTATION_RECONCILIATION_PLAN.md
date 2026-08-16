# SPECODE 구현-설계 동기화 최종 설계

> 대상 단위업무: UW-00036
> 확정일: 2026-08-17
> 상태: V2 코드·DB 전환 완료 · 실제 Claude Code Shadow 승인 전 · 기능 flag OFF
> 대체 대상: Git baseline/Diff/provider 중심 V1 전체

---

## 1. 핵심 방식

```text
사용자가 UW 하나와 점검 수준을 지정한다.
→ Claude Code가 현재 저장소에서 그 UW의 관련 소스를 찾는다.
→ 현재 UW 설계와 현재 소스를 지정한 방향으로 비교한다.
→ 구현 불일치와 설계 누락 후보를 서로 다른 결과로 보여준다.
→ 사용자가 승인한 설계 수정안만 SPECODE에 적용한다.
```

이 기능은 과거 변경분을 추적하는 기능이 아니다. 실행 시점의 `현재 설계`와 `현재 소스`를
직접 비교한다. Git, commit, Diff, source baseline은 없어도 동작해야 한다.

---

## 2. 동기화 모드

비교 방향이 다르므로 프롬프트와 결과 계약도 분리한다.

### 2.1 `CHECK` — 기본 점검

목적은 **설계대로 구현됐는지 확인**하는 것이다.

1. 설계의 단위업무·화면·영역·기능을 하나씩 구현에서 확인한다.
2. 같은 기능의 동작이 다르면 `MISMATCH`로 판정한다.
3. 설계에는 있지만 구현 근거가 없으면 `NOT_IMPLEMENTED`로 판정한다.
4. 판단 근거가 부족하면 `UNKNOWN`으로 남긴다.
5. 추가로, 관련 소스에서 발견한 **중요한 설계 누락 후보만** 별도 보고한다.

소스에 설계보다 기능이 많다는 이유만으로 구현을 불일치로 판정하지 않는다.

예시:

```text
설계: 더하기
구현: 더하기, 빼기, 나누기

구현 정합성: PASS — 더하기가 설계대로 구현됨
설계 커버리지: IMPORTANT_GAP_CANDIDATE — 빼기·나누기가 설계에 없을 가능성
```

### 2.2 `DEEP_SYNC` — 정밀 동기화

목적은 **현재 프로그램의 업무 동작을 역으로 설계화해 누락을 폭넓게 찾는 것**이다.

1. 확정된 관련 소스 범위의 사용자 동작·업무 규칙·입출력·예외를 목록화한다.
2. 각 동작이 현재 설계 어디에 표현됐는지 비교한다.
3. 중요한 누락뿐 아니라 일반적인 설계 누락도 후보로 제출한다.
4. 프레임워크 boilerplate, 내부 helper, 단순 refactoring은 설계 누락으로 만들지 않는다.
5. 구조를 새로 만들어야 하는 후보는 자동 적용하지 않고 `STRUCTURE_GAP`으로 남긴다.

이 모드는 결과가 많고 검토 비용이 크므로 사용자가 명시적으로 선택할 때만 실행한다.
AI 분석이므로 완전성을 보장하지 않으며, 결과 표현도 반드시 `확인한 소스 범위에서`로 제한한다.

### 2.3 실행 문법

```text
/sync-specode UW-XXXXX
/sync-specode UW-XXXXX --deep
```

- 기본값은 `CHECK`다.
- UW는 필수다. 프로젝트 전체 실행은 V2 코어에서 제공하지 않는다.
- `--deep`이면 실행 전에 검토 결과가 많아질 수 있음을 한 번 안내한다.

---

## 3. 결과는 두 축으로 분리한다

하나의 `맞음/틀림` 값으로 합치지 않는다.

### 3.1 구현 정합성

설계에서 소스를 바라본 결과다.

| 코드 | 의미 |
|:---|:---|
| `MATCH` | 해당 설계 내용이 구현과 일치한다. |
| `MISMATCH` | 동일 동작에 대한 설계와 구현이 명확히 다르다. |
| `NOT_IMPLEMENTED` | 설계 내용의 구현 근거가 없다. |
| `UNKNOWN` | 소스 범위나 실행 조건 때문에 판단할 수 없다. |

실행 전체 요약은 `PASS / FAIL / UNKNOWN`으로 표시한다.

### 3.2 설계 커버리지

소스에서 설계를 바라본 결과다.

| 코드 | 의미 |
|:---|:---|
| `IMPORTANT_GAP_CANDIDATE` | 중요한 업무 동작인데 설계에 없을 가능성이 높다. |
| `GAP_CANDIDATE` | 정밀 동기화에서 찾은 일반 설계 누락 후보다. |
| `STRUCTURE_GAP` | 신규 화면·영역·기능 등 구조 설계가 필요하다. |
| `IMPLEMENTATION_DETAIL` | 설계에 기록할 필요가 없는 구현 세부사항이다. |
| `OUT_OF_SCOPE` | 지정 UW와 관련 없는 동작이다. |
| `UNKNOWN` | 의도나 업무 범위를 사용자에게 확인해야 한다. |

`*_GAP_CANDIDATE`는 오류 확정이 아니다. 사용자가 해당 UW의 의도된 동작이라고 승인하기
전까지는 **설계 누락 후보**다.

### 3.3 중요한 로직 기준

`CHECK`가 추가로 보고할 중요한 누락 후보는 다음 중 하나 이상이어야 한다.

- 사용자에게 보이는 독립 기능 또는 주요 처리 흐름
- 권한·인증·보안 규칙
- 금액·계산·상태 전이 등 핵심 업무 규칙
- 저장·수정·삭제 같은 데이터 변경
- 외부 공개 API의 계약이나 연동 동작
- 중요한 검증·트랜잭션·실패 처리

로깅, 변수명, 내부 helper, 프레임워크 설정, 성능 최적화만으로는 후보를 만들지 않는다.

---

## 4. 사용자 절차

1. 개발자가 원하는 시점에 소스 수정을 마친다. commit은 필수가 아니다.
2. `/sync-specode UW-XXXXX` 또는 `--deep`으로 실행한다.
3. Claude Code가 관련 소스를 찾고, 범위가 애매할 때만 사용자에게 묻는다.
4. SPECODE 화면에서 두 축의 결과와 코드 근거를 검토한다.
5. 설계 반영 후보를 승인하면 안전성 검사 후 적용하고, 거부하면 종료한다.

사용자가 관리할 baseline, repo key, provider token, webhook, 파일 연결 목록은 없다.

---

## 5. 관련 소스 탐색

### 5.1 SPECODE가 제공할 설계 컨텍스트

- UW 이름·설명과 연결된 요구사항·사용자 스토리·인수 기준
- 화면 이름·설명·URL/path
- 영역과 기능 이름·설명
- 알려진 API method/path와 입출력
- 참조 테이블·컬럼
- 각 설계 대상의 내부 ID와 계층 관계

Claude Code에 UW 번호만 넘기지 않는다.

### 5.2 Claude Code 탐색 순서

1. 설계에 있는 URL, API path, 테이블명, 화면·기능 식별자를 정확 검색한다.
2. route, component, service, repository, query와 테스트를 후보로 모은다.
3. 찾은 기능의 route 등록, 메뉴, 같은 업무 폴더의 인접 entrypoint도 확인한다. 이 단계가
   설계에 이름조차 없는 중요 추가 기능을 찾기 위해 필요하다.
4. import·호출 관계를 필요한 깊이까지만 따라간다.
5. 실제 실행 경로의 primary source와 test/mock을 구분한다.
6. 찾은 경로·심볼·선정 이유를 소스 범위로 만든다.

`CHECK`는 설계 대응 파일과 인접 실행 경로까지만 확장한다. `DEEP_SYNC`는 사용자가 확정한
UW 모듈 경계 안의 entrypoint와 업무 로직을 더 넓게 훑는다.

저장소 전체 내용을 한 프롬프트에 넣지 않는다. 검색으로 범위를 좁힌 후 현재 내용을 읽는다.

### 5.3 사용자 확인 조건

다음 중 하나면 본 비교 전에 질문한다.

- primary source를 찾지 못함
- 실제 사용 경로로 보이는 후보가 여러 개임
- 주요 설계 항목에 대응하는 근거가 없음
- 후보 범위가 너무 넓거나 UW 경계를 넘음
- 신규 기능처럼 보이지만 해당 UW 소속인지 불확실함

사용자는 후보 추가·제외 또는 경로 입력으로 범위를 확정한다. 확인하지 못하면 결과를 억지로
만들지 않고 `NEEDS_INPUT`으로 종료한다. 별도 소스 연결 관리 화면과 테이블은 만들지 않는다.

---

## 6. 프롬프트 설계

공통 탐색 단계 뒤에 서로 다른 분석 프롬프트를 사용한다.

### 6.1 `CHECK` 프롬프트 핵심

```text
설계 항목마다 현재 소스 근거를 찾아 구현 정합성을 판정하라.
소스에만 있는 세부 구현을 모두 차이로 보고하지 마라.
다만 업무적으로 중요한 소스 동작이 설계에 없으면 별도의 누락 후보로 보고하라.
구현 정합성과 설계 누락 후보를 하나의 판정으로 합치지 마라.
근거가 부족하면 UNKNOWN으로 남겨라.
```

### 6.2 `DEEP_SYNC` 프롬프트 핵심

```text
확정된 관련 소스에서 관찰 가능한 업무 동작을 먼저 구조화하라.
그 동작을 현재 설계와 하나씩 대응시켜 누락과 충돌을 찾아라.
구현 세부사항은 제외하고 사용자 동작·업무 규칙·입출력·예외를 보존하라.
신규 설계 구조가 필요하면 기존 설명 필드에 억지로 넣지 말고 STRUCTURE_GAP으로 남겨라.
확인한 소스 범위 밖의 완전성을 주장하지 마라.
```

### 6.3 프로그램이 강제할 것

- UW·모드·대상 ID·허용 필드 검증
- 결과 대상이 실행 UW 계층에 속하는지 검증
- 경로가 저장소 안에 있는지 로컬 helper에서 검증
- secret·vendor·build·generated 경로 차단
- 근거 path·line·snippet·hash를 로컬 파일과 대조
- JSON schema와 중복 항목 검증
- AI가 반환한 `confidence`만으로 자동 적용하지 않음

---

## 7. 결과 계약

```json
{
  "mode": "CHECK",
  "sourceScope": {
    "status": "CONFIRMED",
    "files": [
      {
        "path": "src/app/api/example/route.ts",
        "symbols": ["POST"],
        "reason": "설계의 POST /api/example과 직접 연결"
      }
    ]
  },
  "implementation": {
    "verdict": "PASS",
    "items": []
  },
  "designCoverage": {
    "verdict": "GAP_CANDIDATE",
    "items": [
      {
        "resultCode": "IMPORTANT_GAP_CANDIDATE",
        "sourceFact": "빼기와 나누기 동작이 사용자 API로 제공된다.",
        "reason": "사용자에게 보이는 독립 기능이지만 현재 UW 설계에 없다.",
        "targetType": "FUNCTION",
        "targetId": "기존 대상 UUID 또는 null",
        "evidence": [
          {
            "path": "src/app/api/calculate/route.ts",
            "symbol": "POST",
            "startLine": 20,
            "endLine": 36,
            "snippet": "검토에 필요한 redacted 코드",
            "snippetHash": "sha256"
          }
        ],
        "proposal": {
          "targetField": "func_dc",
          "proposedValue": "변경 후 전체 설명"
        }
      }
    ]
  }
}
```

서버에는 전체 소스와 전체 Diff를 저장하지 않는다. 다른 검토자가 판단할 수 있는 최소한의
redacted snippet과 경로·심볼·행·hash만 저장한다.

---

## 8. 분석 시점과 안전한 적용

### 8.1 소스 변경

- 결과는 명시된 분석 시점의 소스에 대한 판단이다.
- 분석 후 소스가 변경됐는지 SPECODE가 추적하거나 적용을 막지 않는다.
- source hash, project fingerprint, source baseline을 만들지 않는다.
- 최신 점검이 필요하면 사용자가 다시 실행한다.

### 8.2 설계 변경

`sync_run`에는 분석 당시 UW 전체의 의미 데이터 snapshot과 대표 hash를 저장한다. 이 hash는
검토 화면에서 `분석 후 UW 설계 일부가 변경됨`을 알리는 용도일 뿐 전체 적용을 차단하지 않는다.
대표 hash는 정렬된 단위업무·화면·영역·기능의 ID·이름·설명과 비교에 제공한 요구사항·API·DB
참조만 canonical JSON으로 계산한다. 수정일·수정자·진행률 같은 운영 메타데이터는 제외한다.

설계 수정안이 있는 `sync_item`에는 프로그램이 run snapshot에서 읽은 다음 값만 저장한다.

```text
AS-IS: before_value + before_hash
TO-BE: proposed_value
```

AI가 `before_value`와 `before_hash`를 정하지 않는다. 서버가 분석 당시 snapshot의 정확한 원문으로
만들며, `before_hash`는 공백 정규화 없이 UTF-8 원문 그대로 계산한다.

수정안은 두 모드 모두 만들 수 있지만 다음 조건을 전부 만족해야 한다.

- 구현 정합성은 소스 사실이 확인된 `MISMATCH`, 설계 커버리지는
  `IMPORTANT_GAP_CANDIDATE | GAP_CANDIDATE` 판정임
- 기존 단위업무·화면·영역·기능의 설명 필드 하나를 대상으로 함
- source fact와 target이 명확함
- 변경 후 설명 전체 값을 만들 수 있음
- 구조 생성·삭제·이동이 필요하지 않음

조건을 만족하지 않으면 분석 결과만 저장하고 자동 적용 가능한 수정안은 만들지 않는다.
특히 `MATCH | NOT_IMPLEMENTED | UNKNOWN | STRUCTURE_GAP | IMPLEMENTATION_DETAIL | OUT_OF_SCOPE`에는
자동 적용안을 만들지 않는다.

승인 시 처리:

```text
현재 대상 값의 exact hash == before_hash
  → TO-BE 적용 + tb_ds_design_change 이력 저장

현재 대상 값의 exact hash != before_hash
  → 자동 적용 금지
  → 분석 당시 값 / 현재 값 / 제안 값을 함께 표시
  → 최신 설계 기준으로 제안을 다시 만들거나 재실행
```

자동 3-way merge와 무조건 덮어쓰기는 하지 않는다. 다른 화면·영역·기능이 바뀌었더라도 제안
대상 필드 자체가 그대로면 해당 항목은 적용할 수 있다.

적용 트랜잭션은 대상 행을 잠근 뒤 현재 값을 다시 읽고 exact hash를 비교한다. 같은 필드를 두
사용자가 동시에 승인하면 먼저 잠금을 얻은 한 건만 적용되고, 뒤 요청은 `DESIGN_CHANGED`가 된다.

---

## 9. 저장 모델

테이블은 분석 품질이나 토큰 절약용이 아니다. 로컬에서 실행한 결과를 다른 사용자가 나중에
웹에서 검토·승인하고 이력을 남기기 위해 필요하다.

### 9.1 `tb_sp_sync_run`

동기화 실행 한 건의 헤더다.

- `sync_run_id`, `prjct_id`, `unit_work_id`
- `sync_mode_code`: `CHECK | DEEP_SYNC`
- `sync_sttus_code`: `RUNNING | NEEDS_INPUT | NEEDS_REVIEW | COMPLETED | FAILED | CANCELLED`
- `design_snapshot_data`, `design_snapshot_hash`
- `source_scope_data`, `analysis_summary_data`
- `implementation_verdict_code`, `design_coverage_verdict_code`
- 요청자·분석시각·완료시각·감사 컬럼

### 9.2 `tb_sp_sync_item`

비교 결과와 항목별 결정을 저장한다.

- `sync_item_id`, `sync_run_id`
- `finding_ty_code`: `DESIGN_CONFORMANCE | DESIGN_GAP_CANDIDATE`
- `result_code`, `importance_code`
- `target_ref_ty_code`, `target_ref_id`, `target_field_nm`
  (`STRUCTURE_GAP`처럼 기존 대상이 없으면 target ID와 field는 null)
- `design_statement_cn`, `source_fact_cn`, `reason_cn`
- `source_evidence_data`, `confidence_code`
- 제안이 있을 때만 `before_value_cn`, `before_hash`, `proposed_value_cn`
- `item_sttus_code`: `INFORMATIONAL | PENDING | APPLIED | REJECTED | DEFERRED | DESIGN_CHANGED`
- 결정자·결정사유·결정일·`design_change_id`·감사 컬럼

### 9.3 만들지 않는 것

- source repository/provider/baseline/fingerprint 테이블
- source hint/link 관리 테이블
- Diff·batch·receipt 테이블
- 과거 결정을 자동 재사용하기 위한 테이블이나 로직

과거 run은 이력과 참고 화면으로만 사용한다. 새 실행은 매번 현재 설계와 현재 소스를 다시
분석하며, 과거 결정을 근거로 분석을 생략하지 않는다.

---

## 10. API·MCP·화면

### 10.1 Worker API

```text
POST /api/worker/spec-syncs
POST /api/worker/spec-syncs/{runId}/result
POST /api/worker/spec-syncs/{runId}/cancel
```

- 실행 생성은 UW snapshot과 모드별 결과 schema를 반환한다.
- 결과 제출은 로컬 검증을 통과한 source scope·분석 결과를 한 번에 받는다.
- 소스 범위 질문은 Claude Code 터미널에서 처리한다. 별도 웹 범위 확인 흐름은 만들지 않는다.

### 10.2 Web API

```text
GET  /api/projects/{id}/spec-syncs
GET  /api/projects/{id}/spec-syncs/{runId}
POST /api/projects/{id}/spec-syncs/{runId}/items/{itemId}/decision
```

`decision`은 `APPLY | REJECT | DEFER`만 받는다. `APPLY`는 before hash 검사와 설계 변경 이력을
한 트랜잭션으로 처리한다.

서버는 `item_sttus_code=PENDING`인 항목에만 결정을 허용한다. `APPLY`에는 수정안이 반드시
있어야 하지만, 자동 적용할 수 없는 `STRUCTURE_GAP` 같은 항목은 수정안 없이도
`REJECT/DEFER`할 수 있다. `INFORMATIONAL`, 이미 결정된 항목, 수정안 없는 항목의 `APPLY`는
`409 INVALID_ITEM_STATE`로 거부한다.

### 10.3 HTTP MCP

`src/lib/mcp/register-tools.ts`도 API와 동시에 교체한다.

```text
start_spec_sync
submit_spec_sync_result
list_spec_syncs
get_spec_sync
```

MCP에는 설계 적용 도구를 제공하지 않는다. 적용은 웹에서 권한 있는 사람이 수행한다.

### 10.4 화면

기존 URL은 유지하되 내용을 전면 교체한다.

- 목록: UW, 모드, 두 축의 요약, 상태, 요청자, 분석시각
- 상세 상단: `구현 정합성`과 `설계 커버리지`를 별도 카드로 표시
- 상세 본문: 불일치, 중요한 누락 후보, 일반 누락 후보, 판단 불가
- 항목: 설계 내용, 소스 사실, 이유, redacted 근거, AS-IS/TO-BE, 결정
- 제거: Git provider, Source baseline, checkpoint, Diff, batch, gate, 증거 보관 정리

---

## 11. 권한

| 작업 | 권한 |
|:---|:---|
| 조회 | VIEWER 이상 |
| 동기화 실행·결과 제출 | MEMBER 이상 또는 프로젝트 Worker key |
| 승인·거부·보류 | PM·PL·OWNER·ADMIN |
| 설계 적용 | PM·PL·OWNER·ADMIN |

V2는 `specSync.read/submit/review/apply` 권한을 사용한다. V1의 `specReconcile.*`, provider
전용 권한과 수동 증거 override 권한은 삭제한다.

---

## 12. 기존 V1 소스 판정

부분 재사용으로 V1 개념이 다시 유입되지 않도록 파일 단위로 판단한다.

### 12.1 재사용

| 대상 | 판단 |
|:---|:---|
| `tb_ds_design_change` 적용 이력 | 그대로 재사용 |
| 프로젝트 권한 검사·Worker 인증·API 응답 helper | 공통 인프라이므로 재사용 |
| 목록/상세 URL과 LNB 메뉴 위치 | 주소만 유지하고 화면 내용은 전면 교체 |

현재 `targetRegistry.ts`는 V1 타입에 결합되어 있고 update 전에 행 잠금과 UW 계층 검증을 하지
않는다. 파일을 그대로 살리지 않고 V2 최소 레지스트리로 다시 만든다. 네 계층과 허용 필드의
매핑 아이디어만 참고한다.

기존 `hashOf()`도 공백을 정규화하므로 exact before hash에는 재사용하지 않는다. V2에는 원문용
hash 함수를 별도로 둔다.

### 12.2 전면 삭제 후 V2로 교체

- `src/lib/spec-reconciliation/`의 모든 현재 파일
- receipt·batch·baseline·provider·source link·3-way merge 도메인 로직
- `/api/projects/{id}/impl-receipts/**`
- `/api/projects/{id}/source-baselines/**`
- `/api/projects/{id}/source-repositories/**`
- `/api/projects/{id}/spec-reconciliation-context`
- 기존 `/api/projects/{id}/spec-reconciliations/**`
- `/api/worker/spec-reconciliations/**`
- `/api/worker/tasks/{taskId}/implementation-receipt`
- provider webhook과 worker 완료 route의 reconciliation 후처리
- `SourceBaselinePanel`, `BatchProgressPanel`, `FocusedDiff`, 기존 receipt 상세 컴포넌트
- `UnresolvedSpecBadge`와 화면·영역·기능·UW 상세의 관련 삽입 코드
- V1 전용 MCP 도구와 `specReconcile.connectProvider/override` 권한
- `source_snapshot.mjs`, `prepare_specode_sync.mjs`, `submit_maintenance_receipt.mjs`,
  `submit_implementation_receipt.mjs`
- `/run-ai-tasks IMP`의 V1 receipt 생성 단계와 관련 배포 목록·tracing 설정

### 12.3 새로 만들 최소 모듈

```text
src/lib/spec-sync/contracts.ts        모드별 입력·결과 Zod schema
src/lib/spec-sync/designContext.ts    UW 전체 설계 snapshot
src/lib/spec-sync/prompts.ts          CHECK/DEEP_SYNC 분리 프롬프트
src/lib/spec-sync/resultValidator.ts  대상·근거·중복·제안 검증
src/lib/spec-sync/targetRegistry.ts   UW 소속 검증·행 잠금을 포함해 새로 구현
src/lib/spec-sync/applySyncItem.ts    exact hash 검사와 단일 항목 적용
.claude/commands/sync-specode.md       새 사용자 명령
.claude/commands/sync_specode.mjs      시작·검증·결과 제출 helper
```

기존 V1 테이블은 새 이름으로 재활용하지 않는다. 상태와 의미가 달라 조건문과 nullable 컬럼만
남게 되므로 `tb_sp_sync_run`, `tb_sp_sync_item`을 새로 만들고 전환 완료 후 제거한다.

유지할 기존 테이블은 다른 기능도 사용하는 `tb_sp_impl_snapshot`, `tb_ds_design_change`다.

---

## 13. 구현 전 Shadow 검증 게이트

DB·API·화면부터 만들지 않는다. 실제 UW 5~10건을 로컬 파일과 JSON으로 먼저 검증한다.
첫 게이트는 `CHECK`만 대상으로 한다. 코드 구현이 먼저 끝났더라도 실제 운영 접수는
`SPEC_SYNC_ENABLED=false`로 차단하고, CHECK Shadow 승인 뒤에만 활성화한다. `DEEP_SYNC`는
별도 Shadow 게이트를 통과하기 전까지 `SPEC_SYNC_DEEP_ENABLED=false`로 유지한다.

표본에는 화면 중심, API 중심, 공통 모듈, path 정보 부족, 알려진 불일치, 알려진 중요 설계
누락을 포함한다.

통과 조건:

1. 사람이 미리 심은 설계 불일치와 중요 누락을 놓치지 않는다.
2. 존재하지 않는 path·symbol·snippet을 근거로 만들지 않는다.
3. 설계에는 없는 일반 구현 세부사항을 기본 점검에서 대량 누락으로 보고하지 않는다.
4. 범위가 불명확한 사례는 질문하거나 `UNKNOWN`으로 남긴다.
5. 사람이 결과를 실제 검토할 수 있다고 승인한다.

하나라도 실패하면 프롬프트·탐색·결과 계약을 수정해 Shadow 검증부터 다시 한다.

`DEEP_SYNC` 활성화 게이트는 같은 표본 중 복잡한 3~5건으로 별도 수행한다.

1. 소스 업무 동작 목록에서 중요한 동작이 누락되지 않는다.
2. 구현 세부사항을 일반 설계 누락으로 대량 보고하지 않는다.
3. 동일 표본의 `CHECK`보다 넓은 결과를 내되 두 모드의 목적 차이가 분명하다.
4. 사용자가 결과량과 검토 비용을 수용할 수 있다고 승인한다.

---

## 14. 전환 순서

1. `CHECK` Shadow 검증을 통과한다.
2. V2 계약과 두 테이블, 최소 API를 구현한다.
3. 새 `/sync-specode`와 결과 제출 helper를 연결한다.
4. 기존 URL의 목록·상세 화면을 V2로 교체한다.
5. MCP·Worker command 배포 목록·권한을 V2 계약으로 교체한다.
6. `DEEP_SYNC` Shadow 검증을 통과한 뒤 기능 flag를 활성화한다.
7. V1 신규 접수 경로를 중지하고 V1 소스·API·UI를 모두 삭제한다.
8. V1 데이터 보존이 필요하면 일회성 JSON으로 내보낸 뒤 런타임 archive 기능은 만들지 않는다.
9. V1 Prisma 모델·DDL을 제거하고 `a.TableScript.md`와 프로젝트 문서를 갱신한다.
10. `rg`, typecheck, build, migration test로 V1 참조가 0건인지 확인한다.

V1과 V2를 장기간 병행하지 않는다. 전환 커밋 안에서 사용자 경로를 교체하고 죽은 코드를
삭제해 두 모델이 섞이지 않게 한다.

---

## 15. 완료 기준

- 기본 점검은 설계 구현 여부와 중요한 설계 누락 후보를 분리해 보여준다.
- 정밀 동기화는 관련 소스의 업무 동작을 더 넓게 설계와 비교한다.
- 추가 구현이 있다는 이유만으로 구현 정합성을 실패 처리하지 않는다.
- Git·baseline·provider 설정 없이 동작한다.
- 관련 소스가 불확실하면 사용자 확인 없이 분석을 확정하지 않는다.
- 결과마다 검증 가능한 최소 코드 근거가 있다.
- 승인되지 않은 제안은 설계를 변경하지 않는다.
- 제안 대상 설계가 바뀌면 세 값을 보여주고 자동 덮어쓰지 않는다.
- 과거 결과는 이력일 뿐 새 분석을 생략하는 기준이 아니다.
- V1 provider·baseline·Diff·receipt·batch 코드와 DB가 최종 산출물에 남지 않는다.

---

## 16. 최종 운영 문장

```text
기본 점검은 설계대로 구현됐는지 확인하고 중요한 설계 누락 후보만 함께 알려준다.
정밀 동기화는 현재 프로그램의 업무 동작을 더 깊게 분석해 설계 누락을 폭넓게 찾는다.
두 결과를 섞어 모든 차이를 오류로 만들지 않으며, 사람이 승인한 설계 수정안만 반영한다.
```

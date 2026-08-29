# SPECODE 구현-설계 동기화 요약

> 상태: V2 코드·DB 전환 완료 · 실제 고객 저장소 재검증 전
> 상세 설계: [SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md](./SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md)

```text
/sync-specode UW-XXXXX
  → 설계대로 구현됐는지 확인
  → 중요한 설계 누락 후보만 별도 보고

/sync-specode UW-XXXXX --deep
  → 관련 소스의 업무 동작을 더 깊게 역설계
  → 설계 누락을 폭넓게 동기화 후보로 보고
```

핵심 원칙:

- 구현 정합성과 설계 누락을 하나의 `맞음/틀림`으로 합치지 않는다.
- Git·Diff·source baseline·provider 연결을 사용하지 않는다.
- 실행 전에 Worker key가 가리키는 프로젝트명·ID, UW, 모드를 사용자에게 확인한다.
- 소스 범위가 불확실하면 Claude Code가 사용자에게 확인한다.
- 실행 결과는 `tb_sp_sync_run`, 항목별 결과·결정은 `tb_sp_sync_item`에 저장한다.
- 모든 설계 대상은 점검하되 정상 결과는 수치만 남기고, 문제만 상세 제출·저장·표시한다.
- 제안은 `AS-IS(before value/hash)`와 `TO-BE`만 저장하고 사람이 승인해야 적용한다.
- 관련 소스는 분석 시작 시 파일 hash를 고정하고 제출 직전 다시 확인한다. 바뀌면 해당 판정을
  갱신하기 전에는 제출하지 않는다.
- 설계 snapshot은 작은 target 묶음으로 읽고, 코드 snippet·hash 생성과 결과 제출은 로컬 helper가
  맡아 중복 context를 줄인다.
- 기존 V1 receipt·baseline·provider·batch 구현은 전환 시 모두 제거한다.

# SPECODE 구현-설계 동기화 요약

> 상태: V2 코드·DB 전환 완료 · 실제 Claude Code Shadow 승인 전 · 기능 flag OFF
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
- 소스 범위가 불확실하면 Claude Code가 사용자에게 확인한다.
- 실행 결과는 `tb_sp_sync_run`, 항목별 결과·결정은 `tb_sp_sync_item`에 저장한다.
- 제안은 `AS-IS(before value/hash)`와 `TO-BE`만 저장하고 사람이 승인해야 적용한다.
- 분석 후 소스 변경은 추적하지 않는다. 제안 대상 설계 변경만 exact hash로 안전하게 막는다.
- 기존 V1 receipt·baseline·provider·batch 구현은 전환 시 모두 제거한다.

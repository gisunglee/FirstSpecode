# SPECODE 구현-설계 동기화 — 구현 안내

> 상태: V2 코드·DB 전환 완료 · 실제 Claude Code Shadow 승인 전
> 기준 설계: [SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md](./SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md)

기존 V1의 baseline·Diff·provider·receipt·batch 구현은 최종 구조가 아니므로 이 문서에서
운영 방법을 유지하지 않는다.

DB 전환은 완료됐다. 남은 운영 활성화는 다음 순서만 따른다.

1. 실제 UW 5~10건의 `CHECK` 결과를 기준 답안과 대조해 사람이 승인한다.
2. 승인한 환경만 `SPEC_SYNC_ENABLED=true`로 바꾼다.
3. `DEEP_SYNC` 3~5건은 별도로 검증하고 승인한 환경만
   `SPEC_SYNC_DEEP_ENABLED=true`로 바꾼다.
4. 타입 검사·계약 테스트·빌드·DB 점검을 모두 다시 통과시킨다.

현재 두 flag의 기본값은 모두 `false`다. 과거 결정은 조회 이력일 뿐 새 분석을 생략하지 않는다.

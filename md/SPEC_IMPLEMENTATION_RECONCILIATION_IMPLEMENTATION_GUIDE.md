# SPECODE 구현-설계 동기화 — 구현 안내

> 상태: V2 코드·DB 전환 완료 · 실제 Claude Code Shadow 승인 전
> 기준 설계: [SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md](./SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md)

기존 V1의 baseline·Diff·provider·receipt·batch 구현은 최종 구조가 아니므로 이 문서에서
운영 방법을 유지하지 않는다.

DB 전환은 완료됐다. 남은 운영 활성화는 다음 순서만 따른다.

1. 서버를 배포하고 고객 저장소의 `/sync-specode` 명령 파일을 다시 설치한다.
2. `운영시스템 구축(2차) / UW-00011 일정관리` 실제 사례와 격리된 테스트 복제본의 정상·불일치·
   미구현·중요 누락·범위 불명확 변형을 `CHECK` 기준 답안과 대조해 사람이 승인한다.
3. `DEEP_SYNC`는 같은 복제본의 복잡한 변형으로 별도 검증한다.
4. 타입 검사·계약 테스트·빌드·DB 점검을 모두 다시 통과시킨다.

검증 때 start payload·최종 payload·소요 token을 함께 기록한다. 정상 항목의 상세 제출·DB item·
화면 카드가 0건인지, 분석 중 변경된 소스가 hash 검사로 차단되는지도 확인한다. 서로 다른 실제
고객 UW가 확보되면 표본에 추가하며, 존재하지 않는 실사례를 만들지 않는다.

별도 기능 flag는 사용하지 않는다. 과거 결정은 조회 이력일 뿐 새 분석을 생략하지 않는다.

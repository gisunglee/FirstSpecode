# SPEC Sync V2 — DEEP_SYNC Shadow 검증 기록

> 작성일: 2026-08-17  
> 상태: **수동 기대값 확정 / Claude Code 실실행 미통과 / 기능 플래그 OFF**

## 목적

DEEP_SYNC는 CHECK보다 범위가 넓다. 관련 소스의 사용자 동작·권한·업무 규칙·입출력·데이터
변경·공개 계약·예외를 역설계하고, 설계의 중요 누락과 일반 누락을 모두 후보로 낸다.
프레임워크 세부 구현을 설계 누락으로 과다 보고하지 않는지도 함께 본다.

## 실제 UW 5건 기대 결과

| UW | 반드시 찾을 핵심 | 과다 보고하면 안 되는 내용 |
| --- | --- | --- |
| UW-00001 | 회원가입 IP rate limit, 이름 미입력 시 이메일 앞부분 대체 | bcrypt 호출·Prisma 호출 자체 |
| UW-00014 | 과업 복사 시 스토리/인수기준 필드 누락과 복사되는 관계 | UUID 생성·배열 순회 방식 |
| UW-00020 | 화면 삭제의 단독 삭제/하위 일괄 삭제 동작과 권한 | React Query invalidate 세부 |
| UW-00023 | retry count 증가와 PENDING 전환이 설계와 다른 점 | 일반 try/catch·로그 문구 |
| UW-00036 | CHECK/DEEP 두 축, evidence, 사람 승인, exact hash 충돌 방지 | Zod/Prisma/React Query 사용 자체 |

## 통과 기준

1. 위 핵심 동작을 실제 path·line·snippet으로 찾는다.
2. 구현 정합성과 설계 커버리지를 섞지 않는다.
3. 신규 화면·영역·기능이 필요할 때 `STRUCTURE_GAP`이며 자동 proposal이 없다.
4. boilerplate/helper/logging/refactoring은 `IMPLEMENTATION_DETAIL` 또는 결과 제외다.
5. 확정 소스 범위 밖의 완전성을 주장하지 않는다.
6. 같은 입력을 반복했을 때 중요 결과가 의미상 안정적이다.

## 현재 판정

현재 환경에는 `claude` CLI가 없어 실제 Claude Code 결과를 이 기대값과 대조하지 못했다.
따라서 `SPEC_SYNC_DEEP_ENABLED=false`가 기본이며, API는 `409 DEEP_SYNC_NOT_ENABLED`를 반환한다.
실제 5건 결과가 위 기준을 통과한 환경에서만 플래그를 켠다. CHECK는 이 게이트와 독립이다.

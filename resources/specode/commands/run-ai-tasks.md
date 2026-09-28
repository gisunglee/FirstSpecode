---
description: "기존 명령 호환 — /specode work·dev·status 사용을 권장합니다."
argument-hint: "SPEC | IMP | TASK 작업ID | STATUS"
---

# 기존 /run-ai-tasks 호환

`$ARGUMENTS`의 토큰을 아래처럼 변환하고 `.claude/commands/specode.md`를 읽어 실행한다.
이때 specode.md의 `$ARGUMENTS`는 변환한 값이다. 원래 값을 다시 사용하지 않는다.

- 정확히 `SPEC` → `work`
- 정확히 `IMP` → `dev`
- 정확히 `STATUS` → `status`
- 정확히 `TASK <작업ID>` 두 토큰 → `work <작업ID>`
- 나머지는 사용법만 안내하고 종료한다. 서버를 호출하지 않는다.

작업ID 검증은 통합 커맨드 helper가 수행한다. 앞으로 사용할 새 명령을 한 줄 안내한다.

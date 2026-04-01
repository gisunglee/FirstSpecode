# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버에서 PENDING 상태인 AI 태스크를 가져와 순차적으로 처리합니다.

## 처리 방식

Python 워커 스크립트를 실행하여 자동으로 처리합니다:

```bash
python scripts/run_ai_tasks.py
```

옵션:
- `--limit N`: 한 번에 처리할 최대 태스크 수 (기본값: 환경변수 TASK_LIMIT, 기본 10)
- `--task-type TYPE`: 특정 유형만 처리 (DESIGN|INSPECT|IMPACT|IMPLEMENT|MOCKUP|CUSTOM)
- `--ref-type TYPE`: 특정 대상만 처리 (AREA|FUNCTION)

예시:
```bash
# 모든 PENDING 태스크 처리
python scripts/run_ai_tasks.py

# DESIGN 태스크만 처리
python scripts/run_ai_tasks.py --task-type DESIGN

# 최대 3건만 처리
python scripts/run_ai_tasks.py --limit 3

# 기능(FUNCTION) 영역의 태스크만 처리
python scripts/run_ai_tasks.py --ref-type FUNCTION
```

## 수동 처리 방법

자동 스크립트 대신 단계별로 직접 처리할 수 있습니다.

### 1단계 — PENDING 태스크 목록 조회

```bash
python -c "
import os, json, urllib.request
from pathlib import Path

# .env.local 로드
for env_file in ['.env.local', '.env']:
    p = Path(env_file)
    if p.exists():
        for line in p.read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('\"').strip(\"'\")
        break

url = os.environ.get('SPECODE_URL', 'http://localhost:3000') + '/api/worker/tasks?limit=5'
key = os.environ.get('WORKER_API_KEY', 'dev-worker-key')
req = urllib.request.Request(url, headers={'X-Worker-Key': key})
with urllib.request.urlopen(req) as r:
    print(json.dumps(json.loads(r.read()), ensure_ascii=False, indent=2))
"
```

### 2단계 — 태스크 하나씩 처리

각 태스크에 대해:

1. `reqCn` 내용과 해당 프롬프트 파일(`.claude/prompts/{REF_TYPE}-{TASK_TYPE}.md`)을 참고하여 결과를 작성합니다.
2. 결과를 파일에 저장합니다: `/tmp/result_<taskId>.md`
3. 완료 처리합니다:

```bash
python scripts/task_complete.py <taskId> DONE /tmp/result_<taskId>.md
```

실패 처리:
```bash
python scripts/task_complete.py <taskId> FAILED /tmp/error_<taskId>.md
```

## 환경변수 설정

`.env.local` 파일에 다음을 추가하세요:

```
SPECODE_URL=http://localhost:3000
WORKER_API_KEY=your-secret-key-here
TASK_LIMIT=10
```

## 프롬프트 파일 경로

태스크 유형별 프롬프트는 `.claude/prompts/` 폴더에서 관리합니다:

```
.claude/prompts/
  FUNCTION-DESIGN.md    — 기능 설계 초안
  FUNCTION-INSPECT.md   — 기능 명세 누락 검토
  FUNCTION-IMPACT.md    — 기능 영향도 분석
  AREA-DESIGN.md        — 영역 화면 설계 초안
  AREA-INSPECT.md       — 영역 명세 누락 검토
  AREA-IMPACT.md        — 영역 영향도 분석
```

파일이 없으면 스크립트 내장 기본 프롬프트를 사용합니다.
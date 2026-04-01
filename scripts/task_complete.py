#!/usr/bin/env python3
"""
task_complete.py — AI 태스크 완료 결과 전달 헬퍼

역할:
  - 결과 파일을 읽어 SPECODE 서버의 Worker Complete API에 전달
  - Claude Code 커맨드 내에서 수동 처리 후 결과를 저장할 때 사용
  - 한글 인코딩 문제 방지를 위해 결과를 파일 경유로 전달

사용법:
  python scripts/task_complete.py <taskId> <status> <result_file>

  taskId      — 완료할 AI 태스크 ID
  status      — DONE 또는 FAILED
  result_file — 결과 내용이 저장된 파일 경로 (UTF-8)

환경변수:
  SPECODE_URL     — 서버 주소 (기본값: http://localhost:3000)
  WORKER_API_KEY  — Worker API 인증 키 (기본값: dev-worker-key)

사용 예시:
  python scripts/task_complete.py abc-123 DONE /tmp/result.md
  python scripts/task_complete.py abc-123 FAILED /tmp/error.md
"""

import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path


def load_env():
    """프로젝트 루트의 .env.local 또는 .env 파일에서 환경변수를 로드합니다."""
    script_dir   = Path(__file__).parent
    project_root = script_dir.parent

    for env_file in [".env.local", ".env"]:
        env_path = project_root / env_file
        if env_path.exists():
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        key   = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key and key not in os.environ:
                            os.environ[key] = value
            break


def main():
    load_env()

    if len(sys.argv) != 4:
        print("사용법: python task_complete.py <taskId> <status> <result_file>", file=sys.stderr)
        print("  status: DONE 또는 FAILED", file=sys.stderr)
        sys.exit(1)

    task_id     = sys.argv[1]
    status      = sys.argv[2].upper()
    result_file = sys.argv[3]

    if status not in ("DONE", "FAILED"):
        print(f"오류: status는 DONE 또는 FAILED여야 합니다. (입력값: {status})", file=sys.stderr)
        sys.exit(1)

    # 결과 파일 읽기
    result_path = Path(result_file)
    if not result_path.exists():
        print(f"오류: 결과 파일을 찾을 수 없습니다: {result_file}", file=sys.stderr)
        sys.exit(1)

    result_cn = result_path.read_text(encoding="utf-8").strip()

    if status == "DONE" and not result_cn:
        print("오류: DONE 상태는 결과 내용이 필요합니다.", file=sys.stderr)
        sys.exit(1)

    # API 호출
    base_url   = os.environ.get("SPECODE_URL",    "http://localhost:3000")
    worker_key = os.environ.get("WORKER_API_KEY", "dev-worker-key")
    url        = f"{base_url}/api/worker/tasks/{task_id}/complete"

    payload = json.dumps({"status": status, "resultCn": result_cn}).encode("utf-8")
    headers = {
        "X-Worker-Key": worker_key,
        "Content-Type": "application/json",
    }

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            print(f"[완료] taskId={task_id} status={status}")
            print(json.dumps(body, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"오류: HTTP {e.code}: {error_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"오류: 서버 연결 실패: {e.reason}", file=sys.stderr)
        print(f"  서버 주소: {base_url}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

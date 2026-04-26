#!/usr/bin/env python3
"""
task_complete.py — AI 태스크 완료 결과 전달 헬퍼

역할:
  - 결과 파일을 읽어 SPECODE 서버의 Worker Complete API에 전달
  - 수동 처리 후 결과를 저장할 때 사용

사용법:
  python .claude/commands/task_complete.py <taskId> <status> <result_file>

  status      — DONE 또는 FAILED
  result_file — 결과 내용이 저장된 파일 경로 (UTF-8)

환경변수:
  SPECODE_URL      — 서버 주소 (기본값: http://localhost:3000)
  SPECODE_MCP_KEY  — 워커용 MCP 키 (spk_ 시작, 용도='WORKER'). 필수.

인증:
  X-Mcp-Key 헤더로 SPECODE_MCP_KEY 전송. 미설정 시 sys.exit(1).

변경 이력:
  - [2026-04-26] 4차: WORKER_API_KEY fallback 폐기. SPECODE_MCP_KEY 단독 인증.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path


def load_env():
    # 이 파일 위치: {project}/.claude/commands/task_complete.py
    project_root = Path(__file__).parent.parent.parent

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
        sys.exit(1)

    task_id     = sys.argv[1]
    status      = sys.argv[2].upper()
    result_file = sys.argv[3]

    if status not in ("DONE", "FAILED"):
        print(f"오류: status는 DONE 또는 FAILED여야 합니다.", file=sys.stderr)
        sys.exit(1)

    result_path = Path(result_file)
    if not result_path.exists():
        print(f"오류: 파일 없음: {result_file}", file=sys.stderr)
        sys.exit(1)

    result_cn = result_path.read_text(encoding="utf-8").strip()

    if status == "DONE" and not result_cn:
        print("오류: DONE 상태는 결과 내용이 필요합니다.", file=sys.stderr)
        sys.exit(1)

    base_url = os.environ.get("SPECODE_URL", "http://localhost:3000")
    url      = f"{base_url}/api/worker/tasks/{task_id}/complete"

    # 워커용 MCP 키 — 4차 PR 부터 단독 인증 채널
    # /run-ai-tasks 와 동일한 환경변수를 사용해야 일관됨
    mcp_key = os.environ.get("SPECODE_MCP_KEY", "").strip()
    if not mcp_key.startswith("spk_"):
        print(
            "오류: SPECODE_MCP_KEY 환경변수가 설정되지 않았거나 형식이 잘못되었습니다.\n"
            "  발급 방법: SPECODE > 설정 > MCP 키 관리 > '워커 (run-ai-tasks)' 용도로 생성\n"
            "  → .env.local 에 SPECODE_MCP_KEY=spk_xxxx... 박기",
            file=sys.stderr,
        )
        sys.exit(1)

    headers = {
        "Content-Type": "application/json",
        "X-Mcp-Key":    mcp_key,
    }
    payload = json.dumps({"status": status, "resultCn": result_cn}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            print(f"[완료] taskId={task_id} status={status}")
            print(json.dumps(body, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as e:
        print(f"오류: HTTP {e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"오류: 서버 연결 실패: {e.reason} ({base_url})", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

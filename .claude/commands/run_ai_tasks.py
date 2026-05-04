#!/usr/bin/env python3
"""
run_ai_tasks.py — SPECODE AI 태스크 자동 처리 워커

역할:
  1. SPECODE 서버에서 PENDING 태스크 목록을 가져옴
  2. 각 태스크를 순차적으로 처리 (PENDING → IN_PROGRESS → DONE/FAILED)
  3. task.reqCn 을 그대로 Claude Code 에 전달 (서버에서 시스템프롬프트 합성 완료된 완성형)
  4. Claude의 응답을 result_cn으로 저장

프롬프트:
  - task.reqCn 은 서버측에서 tb_ai_prompt_template 의 시스템프롬프트가 이미 합성된 완성형
  - 워커는 추가 프롬프트 합성을 하지 않는다 (이중 시스템프롬프트로 인한 출력 충돌 방지)
  - 프롬프트 수정은 SPECODE 화면 → "프롬프트 관리" 메뉴

사용법:
  python .claude/commands/run_ai_tasks.py
  python .claude/commands/run_ai_tasks.py --limit 5
  python .claude/commands/run_ai_tasks.py --task-type DESIGN
  python .claude/commands/run_ai_tasks.py --ref-type FUNCTION

환경변수 (.env 또는 .env.local):
  SPECODE_URL         — 서버 주소 (기본값: http://localhost:3000)
  SPECODE_WORKER_KEY  — 워커용 MCP 키 (spk_ 시작, 용도='WORKER'). 필수.
  TASK_LIMIT          — 한 번에 처리할 최대 태스크 수 (기본값: 10)
"""

import os
import sys
import json
import subprocess
import argparse
from pathlib import Path

# ─── 환경변수 로드 ─────────────────────────────────────────────────────────────

def load_env():
    """프로젝트 루트의 .env.local 또는 .env 파일에서 환경변수를 로드합니다."""
    # 이 파일 위치: {project}/.claude/commands/run_ai_tasks.py
    # 프로젝트 루트: .parent(commands) → .parent(.claude) → .parent(project root)
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
            print(f"[ENV] {env_file} 로드 완료")
            break

load_env()

SPECODE_URL        = os.environ.get("SPECODE_URL", "http://localhost:3000")
SPECODE_WORKER_KEY = os.environ.get("SPECODE_WORKER_KEY", "").strip()
TASK_LIMIT         = int(os.environ.get("TASK_LIMIT", "10"))

if not SPECODE_WORKER_KEY.startswith("spk_"):
    print(
        "오류: SPECODE_WORKER_KEY 환경변수가 설정되지 않았거나 형식이 잘못되었습니다.\n"
        "  발급 방법: SPECODE > 설정 > MCP 키 관리 > '워커 (run-ai-tasks)' 용도로 생성\n"
        "  → .env.local 에 SPECODE_WORKER_KEY=spk_xxxx... 박기",
        file=sys.stderr,
    )
    sys.exit(1)

# 프로젝트 루트 경로
PROJECT_ROOT = Path(__file__).parent.parent.parent

# ─── HTTP 헬퍼 ────────────────────────────────────────────────────────────────

def worker_request(method: str, path: str, body: dict | None = None) -> dict:
    """SPECODE Worker API를 호출합니다."""
    import urllib.request
    import urllib.error

    url     = f"{SPECODE_URL}{path}"
    headers = {
        "X-Mcp-Key":     SPECODE_WORKER_KEY,
        "Content-Type":  "application/json",
    }

    data = json.dumps(body).encode("utf-8") if body else None
    req  = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP {e.code}: {error_body}") from e

# ─── Claude Code 호출 ─────────────────────────────────────────────────────────

def find_claude_cmd() -> list[str]:
    """
    플랫폼에 따라 claude CLI 실행 명령어를 반환합니다.
    Windows: npm 전역 설치 시 claude.cmd로 등록됨
    Unix:    claude 직접 실행
    """
    import shutil
    import platform

    if platform.system() == "Windows":
        for candidate in ["claude.cmd", "claude.ps1", "claude"]:
            path = shutil.which(candidate)
            if path:
                return [path]
        return ["claude"]
    else:
        return ["claude"]


def call_claude(prompt: str) -> str:
    """
    Claude Code CLI를 호출하여 응답을 반환합니다.
    한글 인코딩 문제를 피하기 위해 프롬프트를 stdin으로 전달합니다.
    (@file 방식은 Windows subprocess에서 경로 처리 문제가 있어 stdin 방식 사용)
    """
    claude_cmd = find_claude_cmd()
    cmd = claude_cmd + ["-p", "--output-format", "text"]

    # Popen + communicate 방식으로 stdin을 명시적으로 닫아 EOF를 보장
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
    )

    try:
        stdout, stderr = proc.communicate(input=prompt, timeout=300)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise RuntimeError("Claude 호출 타임아웃 (300초 초과)")

    if proc.returncode != 0:
        err_msg = (stderr or stdout or "")[:300]
        raise RuntimeError(f"Claude 호출 실패 (exit {proc.returncode}): {err_msg}")

    output = stdout.strip()
    if not output:
        raise RuntimeError("Claude 응답이 비어 있습니다.")

    return output


# ─── 태스크 처리 ──────────────────────────────────────────────────────────────

def process_task(task: dict) -> bool:
    """단일 태스크를 처리합니다. 반환값: True=성공, False=실패"""
    task_id   = task["taskId"]
    ref_type  = task["refType"]
    task_type = task["taskType"]

    print(f"\n[태스크] {task_id} | {ref_type}-{task_type}")
    print(f"  요청일시: {task['requestedAt']}")

    # 1. 시작 마킹 (PENDING → IN_PROGRESS)
    try:
        worker_request("PATCH", f"/api/worker/tasks/{task_id}/start")
        print(f"  [시작] PENDING → IN_PROGRESS")
    except RuntimeError as e:
        print(f"  [오류] 시작 마킹 실패: {e}")
        return False

    # 2. Claude 호출
    #    task["reqCn"] 은 서버측에서 시스템프롬프트가 합성된 완성형 — 그대로 전달
    try:
        final_prompt = task["reqCn"]
        print(f"  [Claude 호출] 프롬프트 {len(final_prompt)}자")
        result_text = call_claude(final_prompt)
        print(f"  [Claude 완료] 결과 {len(result_text)}자")
    except Exception as e:
        print(f"  [오류] Claude 실패: {e}")
        try:
            worker_request("POST", f"/api/worker/tasks/{task_id}/complete", {
                "status":   "FAILED",
                "resultCn": f"처리 중 오류: {str(e)[:500]}",
            })
            print(f"  [실패 마킹] → FAILED")
        except RuntimeError as ce:
            print(f"  [오류] 실패 마킹도 실패: {ce}")
        return False

    # 3. 완료 마킹 (IN_PROGRESS → DONE)
    try:
        worker_request("POST", f"/api/worker/tasks/{task_id}/complete", {
            "status":   "DONE",
            "resultCn": result_text,
        })
        print(f"  [완료] IN_PROGRESS → DONE")
        return True
    except RuntimeError as e:
        print(f"  [오류] 완료 마킹 실패: {e}")
        return False


# ─── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="SPECODE AI 태스크 워커")
    parser.add_argument("--limit",     type=int, default=TASK_LIMIT)
    parser.add_argument("--task-type", type=str, default=None)
    parser.add_argument("--ref-type",  type=str, default=None)
    args = parser.parse_args()

    print(f"[SPECODE AI 워커] 시작 | 서버: {SPECODE_URL} | 최대: {args.limit}건")

    params = f"limit={args.limit}"
    if args.task_type:
        params += f"&taskType={args.task_type}"
    if args.ref_type:
        params += f"&refType={args.ref_type}"

    try:
        resp = worker_request("GET", f"/api/worker/tasks?{params}")
    except RuntimeError as e:
        print(f"[오류] 태스크 조회 실패: {e}")
        sys.exit(1)

    tasks = resp.get("data", {}).get("tasks", [])
    count = resp.get("data", {}).get("count", 0)
    print(f"[조회] PENDING {count}건")

    if not tasks:
        print("처리할 태스크가 없습니다.")
        return

    success_count = 0
    fail_count    = 0
    for task in tasks:
        if process_task(task):
            success_count += 1
        else:
            fail_count += 1

    print(f"\n[완료] 성공: {success_count}건, 실패: {fail_count}건")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
run_ai_tasks.py — SPECODE AI 태스크 자동 처리 워커

역할:
  1. SPECODE 서버에서 PENDING 태스크 목록을 가져옴
  2. 각 태스크를 순차적으로 처리 (PENDING → IN_PROGRESS → DONE/FAILED)
  3. 태스크 유형별 프롬프트 파일을 읽어 Claude Code에 전달
  4. Claude의 응답을 result_cn으로 저장

사용법:
  python .claude/commands/run_ai_tasks.py
  python .claude/commands/run_ai_tasks.py --limit 5
  python .claude/commands/run_ai_tasks.py --task-type DESIGN
  python .claude/commands/run_ai_tasks.py --ref-type FUNCTION

환경변수 (.env 또는 .env.local):
  SPECODE_URL     — 서버 주소 (기본값: http://localhost:3000)
  WORKER_API_KEY  — Worker API 인증 키 (기본값: dev-worker-key)
  TASK_LIMIT      — 한 번에 처리할 최대 태스크 수 (기본값: 10)
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

SPECODE_URL    = os.environ.get("SPECODE_URL",    "http://localhost:3000")
WORKER_API_KEY = os.environ.get("WORKER_API_KEY", "dev-worker-key")
TASK_LIMIT     = int(os.environ.get("TASK_LIMIT", "10"))

# 프로젝트 루트 경로
PROJECT_ROOT = Path(__file__).parent.parent.parent

# ─── HTTP 헬퍼 ────────────────────────────────────────────────────────────────

def worker_request(method: str, path: str, body: dict | None = None) -> dict:
    """SPECODE Worker API를 호출합니다."""
    import urllib.request
    import urllib.error

    url     = f"{SPECODE_URL}{path}"
    headers = {
        "X-Worker-Key":  WORKER_API_KEY,
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

# ─── 프롬프트 로드 ────────────────────────────────────────────────────────────

# 프롬프트 파일 경로: .claude/prompts/{REF_TY_CODE}-{TASK_TY_CODE}.md
PROMPTS_DIR = PROJECT_ROOT / ".claude" / "prompts"

# 내장 기본 프롬프트 (프롬프트 파일이 없을 때 fallback)
DEFAULT_PROMPTS: dict[str, str] = {
    "FUNCTION-DESIGN": """\
당신은 소프트웨어 설계 전문가입니다.
아래 기능 정보를 바탕으로 상세 기능 명세서 초안을 작성해 주세요.

명세서에 포함할 내용:
1. 기능 개요 (목적, 사용자, 진입점)
2. 입력값 및 유효성 검사 규칙
3. 처리 로직 (단계별)
4. 출력/결과
5. 예외 처리 및 오류 메시지
6. 관련 테이블 및 컬럼 영향

마크다운 형식으로 작성해 주세요.""",

    "FUNCTION-INSPECT": """\
당신은 소프트웨어 QA 전문가입니다.
아래 기능 명세를 검토하고 누락되거나 불명확한 사항을 지적해 주세요.

검토 항목:
1. 입력값 유효성 검사 누락 여부
2. 예외 케이스 처리 누락 여부
3. 권한/보안 고려 사항 누락 여부
4. 성능 고려 사항 (대량 데이터 처리 등)
5. 사용자 경험 상 불명확한 부분
6. 기타 개선 제안

발견된 항목을 우선순위(높음/중간/낮음)와 함께 마크다운 형식으로 작성해 주세요.""",

    "FUNCTION-IMPACT": """\
당신은 소프트웨어 아키텍처 전문가입니다.
아래 기능 변경 시 영향을 받는 범위를 분석해 주세요.

분석 항목:
1. 영향받는 데이터 (테이블, 컬럼)
2. 영향받는 연관 기능 (호출하거나 호출받는 기능)
3. 영향받는 화면/UI
4. 보안/권한 영향
5. 마이그레이션 또는 데이터 정합성 이슈
6. 테스트가 필요한 시나리오

마크다운 형식으로 작성해 주세요.""",

    "AREA-DESIGN": """\
당신은 UI/UX 설계 전문가입니다.
아래 영역(화면 구역) 정보를 바탕으로 화면 설계 초안을 작성해 주세요.

작성 내용:
1. 영역 개요 (목적, 사용자)
2. 레이아웃 구조 (ASCII 또는 설명)
3. 포함될 UI 컴포넌트 목록 (폼, 테이블, 버튼 등)
4. 각 컴포넌트의 데이터 바인딩
5. 사용자 인터랙션 흐름
6. 반응형 고려 사항

마크다운 형식으로 작성해 주세요.""",

    "AREA-INSPECT": """\
당신은 UI/UX 및 소프트웨어 QA 전문가입니다.
아래 영역 명세를 검토하고 누락되거나 불명확한 사항을 지적해 주세요.

검토 항목:
1. 화면 구성 요소 정의 완전성
2. 사용자 인터랙션 처리 누락 여부
3. 데이터 표시/입력 명세 불명확 여부
4. 오류/빈 데이터 상태 처리 여부
5. 접근성(Accessibility) 고려 사항
6. 성능(렌더링, 페이지네이션) 고려 사항

발견된 항목을 우선순위(높음/중간/낮음)와 함께 마크다운 형식으로 작성해 주세요.""",

    "AREA-IMPACT": """\
당신은 소프트웨어 아키텍처 전문가입니다.
아래 영역(화면 구역) 변경 시 영향을 받는 범위를 분석해 주세요.

분석 항목:
1. 영향받는 기능 목록
2. 영향받는 데이터 소스 (API, 테이블)
3. 연관 화면 및 영역
4. 공통 컴포넌트 재사용 이슈
5. 사용자 흐름(Flow) 변경 영향
6. 테스트가 필요한 시나리오

마크다운 형식으로 작성해 주세요.""",
}


def load_prompt(ref_type: str, task_type: str) -> str:
    """
    프롬프트를 다음 순서로 탐색하여 반환합니다:
      1. .claude/prompts/{REF_TYPE}-{TASK_TYPE}.md
      2. .claude/prompts/{TASK_TYPE}.md
      3. DEFAULT_PROMPTS dict의 내장 프롬프트
    """
    key = f"{ref_type}-{task_type}"

    specific = PROMPTS_DIR / f"{ref_type}-{task_type}.md"
    if specific.exists():
        return specific.read_text(encoding="utf-8").strip()

    generic = PROMPTS_DIR / f"{task_type}.md"
    if generic.exists():
        return generic.read_text(encoding="utf-8").strip()

    if key in DEFAULT_PROMPTS:
        return DEFAULT_PROMPTS[key]

    return f"다음 {ref_type}의 {task_type} 태스크를 처리해 주세요. 결과를 마크다운 형식으로 작성해 주세요."


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

def build_final_prompt(task: dict) -> str:
    """태스크 정보와 프롬프트 파일을 조합하여 최종 프롬프트를 구성합니다."""
    prompt_template = load_prompt(task["refType"], task["taskType"])
    return f"{prompt_template}\n\n---\n\n{task['reqCn']}\n"


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
    try:
        final_prompt = build_final_prompt(task)
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

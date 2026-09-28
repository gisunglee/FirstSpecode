# SPECODE 커맨드 배포 원본

회원에게 배포할 원본은 이 디렉터리에서 수정한다. `.claude/commands`와
`.claude/specode-workflows`, `.claude/agents`는 MCP에서 받은 **설치본**이다.

흐름: 원본 수정 → 테스트/빌드 → SPECODE 서버 배포 → 회원이 연결된 MCP에
“스펙코드 커맨드 업데이트해줘” 요청 → `get_worker_command_files` 호출 → 백업·설치·해시 검증.

`src/lib/mcp/workerCommandManifest.ts`는 원본과 설치 경로의 단일 목록이다.
Next.js 빌드 tracing도 같은 목록을 사용한다. 새 파일을 만들면 이 목록에 추가한다.
`bundleVersion`은 배포 계약 버전, `bundleHash`는 실제 배포 내용의 식별자다.
같은 버전에서도 본문이 변경되면 hash가 달라져 업데이트를 구분할 수 있다.

공개 명령은 `/specode`이며 인자 없이 실행하면 도움말만 표시한다.
work/dev/status/review/sync/onboard와 기존 명령 호환 wrapper를 함께 배포한다.
onboard의 분석 방식 선택·영역별 합의는 유지한다. --deep은 sync만 지원한다.

MCP 도구 이름과 기존 응답 필드(files/path/content, removePaths, setupGuide)는 유지한다.
일반 회원용 기존 CLIENT 인증을 사용하며 관리자 권한을 새로 요구하지 않는다.
WORKER 키는 설치 인증용이 아니라 work/dev/status/sync 실행용이다.

서버를 배포하기 전에 운영 MCP에서 받으면 이전 원본이 내려온다.
현재 저장소의 설치본도 직접 편집하지 않고 **배포 후 MCP 업데이트**로 갱신한다.
로컬 테스트는 임시 고객 저장소에 MCP 응답을 설치해 확인하며, 운영 업데이트와 구분한다.

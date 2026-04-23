/**
 * register-tools.ts — MCP 도구 등록
 *
 * 역할:
 *   - McpServer 인스턴스에 SPECODE 도구들을 등록
 *
 * 도구 카테고리 (38개):
 *   [프로젝트]     list_projects, get_project
 *   [기획-과업]    list_tasks, get_task, create_task, update_task, delete_task
 *   [기획-요구사항] list_requirements, get_requirement, create_requirement, update_requirement, delete_requirement
 *   [기획-스토리]  list_user_stories, get_user_story, create_user_story, update_user_story, delete_user_story
 *   [기획-트리]    get_planning_tree
 *   [설계-단위업무] list_unit_works, get_unit_work, create_unit_work, update_unit_work, delete_unit_work
 *   [설계-화면]    list_screens, get_screen, create_screen, update_screen, delete_screen
 *   [설계-영역]    list_areas, get_area, create_area, update_area, delete_area
 *   [설계-기능]    list_functions, get_function, create_function, update_function, delete_function
 *   [DB]           list_db_tables, get_db_table, get_db_table_usage, get_db_column_usage
 *
 * 계층 관계:
 *   기획: 과업(Task) → 요구사항(Requirement) → 사용자스토리(UserStory)
 *   설계: 단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)
 *   연결: 요구사항 ↔ 단위업무 (reqId로 연결)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { specodeFetch } from "@/lib/mcp/api-client";

// ─── 공통 헬퍼 ──────────────────────────────────────────────────

/** 도구 결과를 MCP 텍스트 콘텐츠로 래핑 */
function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** 에러를 MCP 에러 결과로 래핑 */
function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `❌ 오류: ${message}` }],
    isError: true,
  };
}

// ─── 쿼리스트링 빌더 ────────────────────────────────────────────

/** optional 파라미터들을 쿼리스트링으로 변환 */
function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.set(key, String(value));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

// ═══════════════════════════════════════════════════════════════════
// 도구 등록 메인 함수
// ═══════════════════════════════════════════════════════════════════

export function registerTools(server: McpServer): void {

  // ═══════════════════════════════════════════════════════════════
  // 1. 프로젝트 (Project)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_projects",
    "프로젝트 목록 조회 — 서비스 계정이 접근 가능한 프로젝트 목록을 반환합니다",
    {},
    async () => {
      try {
        const data = await specodeFetch("/api/projects");
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_project",
    "프로젝트 상세 조회 — 프로젝트 기본 정보와 내 역할을 반환합니다",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 2. 기획 — 과업 (Task)
  //    displayId 자동채번: SFR-NNNNN
  //    계층: 과업 → 요구사항 → 사용자스토리
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_tasks",
    "과업 목록 조회 — 프로젝트의 과업 목록과 요구사항 수/우선순위 집계를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
    },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/tasks`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_task",
    "과업 상세 조회 — 과업명, 카테고리, 정의, 상세내용 등을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
    },
    async ({ projectId, taskId }) => {
      try {
        const data = await specodeFetch(`/api/projects/${projectId}/tasks/${taskId}`);
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_task",
    "과업 생성 — 새 과업을 등록합니다. displayId(SFR-NNNNN)는 자동 채번됩니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("과업명 (필수)"),
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV(신규개발) | IMPROVE(기능개선) | MAINTAIN(유지보수)"),
      definition: z.string().optional().describe("과업 정의"),
      content: z.string().optional().describe("상세 내용"),
      outputInfo: z.string().optional().describe("산출물 정보"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/tasks`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_task",
    "과업 수정 — 기존 과업 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
      name: z.string().describe("과업명 (필수)"),
      category: z.string().describe("카테고리 (필수). 허용값: NEW_DEV | IMPROVE | MAINTAIN"),
      definition: z.string().optional().describe("과업 정의"),
      content: z.string().optional().describe("상세 내용"),
      outputInfo: z.string().optional().describe("산출물 정보"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
    },
    async ({ projectId, taskId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/tasks/${taskId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_task",
    "과업 삭제 — 과업을 삭제합니다. deleteType으로 하위 데이터 처리 방식을 결정합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      taskId: z.string().describe("과업 ID"),
      deleteType: z.string().optional().describe("삭제 방식. 허용값: ALL(하위 요구사항·스토리 모두 삭제) | TASK_ONLY(과업만 삭제, 하위 요구사항은 미분류로 이동). 기본: ALL"),
    },
    async ({ projectId, taskId, deleteType }) => {
      try {
        const qs = buildQs({ deleteType });
        const data = await specodeFetch(
          `/api/projects/${projectId}/tasks/${taskId}${qs}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 3. 기획 — 요구사항 (Requirement)
  //    displayId 자동채번: REQ-NNNNN
  //    FK: taskId (선택 — 없으면 미분류)
  //    계층: 과업 → [요구사항] → 사용자스토리
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_requirements",
    "요구사항 목록 조회 — 프로젝트의 요구사항 목록을 반환합니다 (검색, 페이지네이션 지원)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      page: z.number().optional().describe("페이지 번호 (기본: 1)"),
      pageSize: z.number().optional().describe("페이지 크기 (기본: 20)"),
      search: z.string().optional().describe("검색어"),
    },
    async ({ projectId, page, pageSize, search }) => {
      try {
        const qs = buildQs({ page, pageSize, search });
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_requirement",
    "요구사항 상세 조회 — 요구사항 정보와 연결된 사용자스토리를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("요구사항 ID"),
    },
    async ({ projectId, requirementId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements/${requirementId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_requirement",
    "요구사항 생성 — 새 요구사항을 등록합니다. displayId(REQ-NNNNN)는 자동 채번됩니다. 과업에 소속시키려면 taskId를 전달하세요 (선행: list_tasks 또는 get_planning_tree로 taskId 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("요구사항명 (필수)"),
      priority: z.string().describe("우선순위 (필수). 허용값: HIGH | MEDIUM | LOW"),
      source: z.string().describe("출처 (필수). 허용값: RFP | ADD(추가) | CHANGE(변경)"),
      taskId: z.string().optional().describe("소속 과업 ID (선택 — 미입력 시 미분류)"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      originalContent: z.string().optional().describe("요구사항 원문"),
      currentContent: z.string().optional().describe("현행화 내용"),
      analysisMemo: z.string().optional().describe("분석 메모"),
      detailSpec: z.string().optional().describe("상세 명세"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_requirement",
    "요구사항 수정 — 기존 요구사항 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("요구사항 ID"),
      name: z.string().describe("요구사항명 (필수)"),
      priority: z.string().describe("우선순위 (필수). 허용값: HIGH | MEDIUM | LOW"),
      source: z.string().describe("출처 (필수). 허용값: RFP | ADD | CHANGE"),
      taskId: z.string().optional().describe("소속 과업 ID"),
      rfpPage: z.string().optional().describe("RFP 페이지 번호"),
      originalContent: z.string().optional().describe("요구사항 원문"),
      currentContent: z.string().optional().describe("현행화 내용"),
      analysisMemo: z.string().optional().describe("분석 메모"),
      detailSpec: z.string().optional().describe("상세 명세"),
    },
    async ({ projectId, requirementId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements/${requirementId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_requirement",
    "요구사항 삭제 — 요구사항과 하위 사용자스토리를 삭제합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("요구사항 ID"),
    },
    async ({ projectId, requirementId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/requirements/${requirementId}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 4. 기획 — 사용자스토리 (User Story)
  //    displayId 자동채번: STR-NNNNN
  //    FK: requirementId (필수)
  //    계층: 과업 → 요구사항 → [사용자스토리]
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_user_stories",
    "사용자스토리 목록 조회 — 프로젝트의 사용자스토리 목록을 반환합니다 (요구사항별, 과업별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().optional().describe("요구사항 ID (필터 — 특정 요구사항의 스토리만)"),
      taskId: z.string().optional().describe("과업 ID (필터 — 해당 과업 소속 요구사항의 스토리만)"),
      keyword: z.string().optional().describe("검색어 (스토리명 또는 페르소나 부분 일치)"),
    },
    async ({ projectId, requirementId, taskId, keyword }) => {
      try {
        const qs = buildQs({ requirementId, taskId, keyword });
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_user_story",
    "사용자스토리 상세 조회 — 스토리 정보, 인수기준, 상위 요구사항/과업 정보를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      storyId: z.string().describe("사용자스토리 ID"),
    },
    async ({ projectId, storyId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories/${storyId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_user_story",
    "사용자스토리 생성 — 새 사용자스토리를 등록합니다. displayId(STR-NNNNN)는 자동 채번됩니다. 선행: list_requirements 또는 get_planning_tree로 requirementId를 조회하세요",
    {
      projectId: z.string().describe("프로젝트 ID"),
      requirementId: z.string().describe("소속 요구사항 ID (필수)"),
      name: z.string().describe("스토리명 (필수)"),
      persona: z.string().optional().describe("페르소나 (예: '신규 가입자', '관리자')"),
      scenario: z.string().optional().describe("시나리오 설명"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_user_story",
    "사용자스토리 수정 — 기존 사용자스토리를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      storyId: z.string().describe("사용자스토리 ID"),
      requirementId: z.string().describe("소속 요구사항 ID (필수)"),
      name: z.string().describe("스토리명 (필수)"),
      persona: z.string().describe("페르소나 (필수)"),
      scenario: z.string().describe("시나리오 설명 (필수)"),
    },
    async ({ projectId, storyId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories/${storyId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_user_story",
    "사용자스토리 삭제 — 사용자스토리와 하위 인수기준을 삭제합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      storyId: z.string().describe("사용자스토리 ID"),
    },
    async ({ projectId, storyId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/user-stories/${storyId}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 5. 기획 — 트리 (Planning Tree)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "get_planning_tree",
    "기획 트리 조회 — 과업 > 요구사항 > 사용자스토리 계층 구조를 반환합니다. 전체 기획 데이터를 한눈에 파악할 때 사용하세요",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/planning/tree`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 6. 설계 — 단위업무 (Unit Work)
  //    displayId 자동채번: UW-NNNNN
  //    FK: reqId (필수 — 상위 요구사항)
  //    계층: [단위업무] → 화면 → 영역 → 기능
  //    연결: 요구사항(reqId) ↔ 단위업무
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_unit_works",
    "단위업무 목록 조회 — 프로젝트의 단위업무 목록을 반환합니다 (요구사항별 필터 가능). 진척률, 화면 수, AI 구현 요청 상태 포함",
    {
      projectId: z.string().describe("프로젝트 ID"),
      reqId: z.string().optional().describe("요구사항 ID (필터 — 특정 요구사항의 단위업무만)"),
    },
    async ({ projectId, reqId }) => {
      try {
        const qs = buildQs({ reqId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_unit_work",
    "단위업무 상세 조회 — 단위업무 정보, 설명, 하위 화면 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
    },
    async ({ projectId, unitWorkId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works/${unitWorkId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_unit_work",
    "단위업무 생성 — 새 단위업무를 등록합니다. displayId(UW-NNNNN)는 자동 채번됩니다. 선행: list_requirements로 reqId를 조회하세요 (상위 요구사항 필수)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      reqId: z.string().describe("상위 요구사항 ID (필수). list_requirements에서 조회 가능"),
      name: z.string().describe("단위업무명 (필수)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      startDate: z.string().optional().describe("시작일 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("종료일 (YYYY-MM-DD)"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_unit_work",
    "단위업무 수정 — 기존 단위업무 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
      name: z.string().describe("단위업무명 (필수)"),
      description: z.string().optional().describe("단위업무 설명 (마크다운 지원)"),
      comment: z.string().optional().describe("코멘트"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      startDate: z.string().optional().describe("시작일 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("종료일 (YYYY-MM-DD)"),
      progress: z.number().optional().describe("진행률 (0~100)"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, unitWorkId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works/${unitWorkId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_unit_work",
    "단위업무 삭제 — 단위업무를 삭제합니다. 기본적으로 하위 화면도 함께 삭제됩니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().describe("단위업무 ID"),
      deleteChildren: z.string().optional().describe("하위 화면 삭제 여부. 허용값: true(하위 화면 삭제) | false(하위 화면은 미분류로 이동). 기본: true"),
    },
    async ({ projectId, unitWorkId, deleteChildren }) => {
      try {
        const qs = buildQs({ deleteChildren });
        const data = await specodeFetch(
          `/api/projects/${projectId}/unit-works/${unitWorkId}${qs}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 7. 설계 — 화면 (Screen)
  //    displayId 자동채번: SCR-NNNNN
  //    FK: unitWorkId (선택 — 소속 단위업무)
  //    계층: 단위업무 → [화면] → 영역 → 기능
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_screens",
    "화면 목록 조회 — 프로젝트 내 화면 목록을 반환합니다 (단위업무별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      unitWorkId: z.string().optional().describe("단위업무 ID (필터)"),
    },
    async ({ projectId, unitWorkId }) => {
      try {
        const qs = buildQs({ unitWorkId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_screen",
    "화면 상세 조회 — 화면 정보, 설명, 연결된 영역 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
    },
    async ({ projectId, screenId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens/${screenId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_screen",
    "화면 생성 — 새 화면을 등록합니다. 단위업무에 소속시키려면 unitWorkId를 전달하세요 (선행: list_unit_works로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("화면명 (필수)"),
      unitWorkId: z.string().optional().describe("소속 단위업무 ID"),
      displayCode: z.string().optional().describe("화면 표시 코드"),
      type: z.string().optional().describe("화면 유형. 허용값: LIST | DETAIL | GRID | TAB | FULL_SCREEN. 기본: LIST"),
      categoryL: z.string().optional().describe("대분류"),
      categoryM: z.string().optional().describe("중분류"),
      categoryS: z.string().optional().describe("소분류"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_screen",
    "화면 수정 — 기존 화면 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
      name: z.string().optional().describe("화면명"),
      description: z.string().optional().describe("화면 설명"),
      comment: z.string().optional().describe("코멘트"),
      displayCode: z.string().optional().describe("화면 표시 코드"),
      type: z.string().optional().describe("화면 유형. 허용값: LIST | DETAIL | GRID | TAB | FULL_SCREEN. 기본: LIST"),
      categoryL: z.string().optional().describe("대분류"),
      categoryM: z.string().optional().describe("중분류"),
      categoryS: z.string().optional().describe("소분류"),
    },
    async ({ projectId, screenId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens/${screenId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_screen",
    "화면 삭제 — 화면을 삭제합니다. 기본적으로 하위 영역도 함께 삭제됩니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().describe("화면 ID"),
      deleteChildren: z.string().optional().describe("하위 영역 삭제 여부. 허용값: true(하위 영역 삭제) | false(하위 영역은 미분류로 이동). 기본: true"),
    },
    async ({ projectId, screenId, deleteChildren }) => {
      try {
        const qs = buildQs({ deleteChildren });
        const data = await specodeFetch(
          `/api/projects/${projectId}/screens/${screenId}${qs}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 8. 설계 — 영역 (Area)
  //    FK: screenId (선택 — 소속 화면)
  //    계층: 단위업무 → 화면 → [영역] → 기능
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_areas",
    "영역 목록 조회 — 프로젝트 내 영역 목록을 반환합니다 (화면별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      screenId: z.string().optional().describe("화면 ID (필터)"),
    },
    async ({ projectId, screenId }) => {
      try {
        const qs = buildQs({ screenId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_area",
    "영역 상세 조회 — 영역 정보, 설명, 연결된 기능 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().describe("영역 ID"),
    },
    async ({ projectId, areaId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas/${areaId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_area",
    "영역 생성 — 새 영역을 등록합니다. 화면에 소속시키려면 screenId를 전달하세요 (선행: list_screens로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("영역명 (필수)"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형. 허용값: SEARCH | GRID | FORM | DETAIL | BUTTON | TAB | CHART | OTHER. 기본: GRID"),
      description: z.string().optional().describe("영역 설명"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_area",
    "영역 수정 — 기존 영역 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().describe("영역 ID"),
      name: z.string().optional().describe("영역명"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형. 허용값: SEARCH | GRID | FORM | DETAIL | BUTTON | TAB | CHART | OTHER. 기본: GRID"),
      description: z.string().optional().describe("영역 설명"),
      commentCn: z.string().optional().describe("코멘트"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, areaId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas/${areaId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_area",
    "영역 삭제 — 영역을 삭제합니다. 기본적으로 하위 기능도 함께 삭제됩니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().describe("영역 ID"),
      deleteChildren: z.string().optional().describe("하위 기능 삭제 여부. 허용값: true(하위 기능 삭제) | false(하위 기능은 미분류로 이동). 기본: true"),
    },
    async ({ projectId, areaId, deleteChildren }) => {
      try {
        const qs = buildQs({ deleteChildren });
        const data = await specodeFetch(
          `/api/projects/${projectId}/areas/${areaId}${qs}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 9. 설계 — 기능 (Function)
  //    FK: areaId (선택 — 소속 영역)
  //    계층: 단위업무 → 화면 → 영역 → [기능]
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_functions",
    "기능 목록 조회 — 프로젝트 내 기능 목록을 반환합니다 (영역별 필터 가능)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      areaId: z.string().optional().describe("영역 ID (필터)"),
    },
    async ({ projectId, areaId }) => {
      try {
        const qs = buildQs({ areaId });
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions${qs}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_function",
    "기능 상세 조회 — 기능 정보, 입출력 항목, 비즈니스 규칙을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      functionId: z.string().describe("기능 ID"),
    },
    async ({ projectId, functionId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions/${functionId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "create_function",
    "기능 생성 — 새 기능을 등록합니다. 영역에 소속시키려면 areaId를 전달하세요 (선행: list_areas로 조회)",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("기능명 (필수)"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형. 허용값: SEARCH | SAVE | DELETE | DOWNLOAD | UPLOAD | NAVIGATE | VALIDATE | OTHER. 기본: OTHER"),
      description: z.string().optional().describe("기능 설명"),
      priority: z.string().optional().describe("우선순위. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      complexity: z.string().optional().describe("복잡도. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      effort: z.string().optional().describe("공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      implStartDate: z.string().optional().describe("구현 시작일 (YYYY-MM-DD)"),
      implEndDate: z.string().optional().describe("구현 종료일 (YYYY-MM-DD)"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions`,
          { method: "POST", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "update_function",
    "기능 수정 — 기존 기능 정보를 업데이트합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      functionId: z.string().describe("기능 ID"),
      name: z.string().optional().describe("기능명"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형. 허용값: SEARCH | SAVE | DELETE | DOWNLOAD | UPLOAD | NAVIGATE | VALIDATE | OTHER. 기본: OTHER"),
      description: z.string().optional().describe("기능 설명"),
      commentCn: z.string().optional().describe("코멘트"),
      priority: z.string().optional().describe("우선순위. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      complexity: z.string().optional().describe("복잡도. 허용값: HIGH | MEDIUM | LOW. 기본: MEDIUM"),
      effort: z.string().optional().describe("공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      implStartDate: z.string().optional().describe("구현 시작일 (YYYY-MM-DD)"),
      implEndDate: z.string().optional().describe("구현 종료일 (YYYY-MM-DD)"),
      sortOrder: z.number().optional().describe("정렬 순서"),
    },
    async ({ projectId, functionId, ...body }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions/${functionId}`,
          { method: "PUT", body: JSON.stringify(body) }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "delete_function",
    "기능 삭제 — 기능을 삭제합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      functionId: z.string().describe("기능 ID"),
    },
    async ({ projectId, functionId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/functions/${functionId}`,
          { method: "DELETE" }
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 10. DB 테이블
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_db_tables",
    "DB 테이블 목록 조회 — 프로젝트에 등록된 데이터베이스 테이블 목록을 반환합니다. " +
      "매핑 인사이트 필드 포함: functionCount(이 테이블을 쓰는 기능 수), " +
      "usedColCount(매핑된 컬럼 수), ioProfile(READ_HEAVY|WRITE_HEAVY|MIXED|NONE), " +
      "lastUsedDt(가장 최근 매핑 저장 시각, ISO)",
    {
      projectId: z.string().describe("프로젝트 ID"),
    },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_table",
    "DB 테이블 상세 조회 — 테이블 스키마와 컬럼 정보를 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId: z.string().describe("테이블 ID"),
    },
    async ({ projectId, tableId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_table_usage",
    "DB 테이블 사용 현황 조회 — 이 테이블을 참조하는 기능/영역/화면 목록과 " +
      "컬럼별 사용 통계, IO 분포, 마지막 매핑 시각을 반환합니다. " +
      "매핑 인사이트 드릴다운에 사용",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId:   z.string().describe("테이블 ID"),
    },
    async ({ projectId, tableId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}/usage`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_db_column_usage",
    "DB 컬럼 사용처 드릴다운 — 단일 컬럼이 어떤 기능/영역/화면에서 " +
      "INPUT/OUTPUT/INOUT 으로 쓰이는지 매핑 목록을 반환합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      tableId:   z.string().describe("테이블 ID"),
      colId:     z.string().describe("컬럼 ID"),
    },
    async ({ projectId, tableId, colId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/db-tables/${tableId}/columns/${colId}/usage`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}

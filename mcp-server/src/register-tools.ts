/**
 * register-tools.ts — MCP 도구 등록
 *
 * 역할:
 *   - McpServer 인스턴스에 SPECODE 도구들을 등록
 *   - 도구 카테고리: 프로젝트, 기획(Planning), 설계(Design), DB
 *
 * 도구 목록 (16개):
 *   [프로젝트]  list_projects, get_project
 *   [기획]      get_planning_tree, list_requirements, get_requirement
 *   [설계-화면] get_design_tree, list_screens, get_screen, create_screen, update_screen
 *   [설계-영역] list_areas, get_area, create_area, update_area
 *   [설계-기능] list_functions, get_function, create_function, update_function
 *   [DB]        list_db_tables, get_db_table
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { specodeFetch } from "./api-client.js";

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

/** 도구 핸들러를 try-catch로 래핑 — 모든 에러를 MCP 에러 결과로 변환 */
function safeHandler<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      const data = await fn();
      return textResult(data);
    } catch (err) {
      return errorResult(err);
    }
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
    { projectId: z.string().describe("프로젝트 ID (숫자)") },
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
  // 2. 기획 (Planning)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "get_planning_tree",
    "기획 트리 조회 — 과업 > 요구사항 > 사용자스토리 계층 구조를 반환합니다",
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

  // ═══════════════════════════════════════════════════════════════
  // 3. 설계 — 트리 (Design Tree)
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "get_design_tree",
    "설계 트리 조회 — 단위업무 > 화면 > 영역 > 기능 계층 구조를 반환합니다",
    { projectId: z.string().describe("프로젝트 ID") },
    async ({ projectId }) => {
      try {
        const data = await specodeFetch(
          `/api/projects/${projectId}/impl-tree`
        );
        return textResult(data);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 4. 설계 — 화면 (Screen)
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
    "화면 생성 — 새 화면을 등록합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("화면명"),
      unitWorkId: z.string().optional().describe("소속 단위업무 ID"),
      displayCode: z.string().optional().describe("화면 표시 코드"),
      type: z.string().optional().describe("화면 유형 (LIST, FORM, POPUP 등. 기본: LIST)"),
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
      type: z.string().optional().describe("화면 유형"),
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

  // ═══════════════════════════════════════════════════════════════
  // 5. 설계 — 영역 (Area)
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
    "영역 생성 — 새 영역을 등록합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("영역명"),
      screenId: z.string().optional().describe("소속 화면 ID"),
      type: z.string().optional().describe("영역 유형 (GRID, FORM, TAB 등. 기본: GRID)"),
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
      type: z.string().optional().describe("영역 유형"),
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

  // ═══════════════════════════════════════════════════════════════
  // 6. 설계 — 기능 (Function)
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
    "기능 생성 — 새 기능을 등록합니다",
    {
      projectId: z.string().describe("프로젝트 ID"),
      name: z.string().describe("기능명"),
      areaId: z.string().optional().describe("소속 영역 ID"),
      type: z.string().optional().describe("기능 유형 (SEARCH, SAVE, DELETE 등. 기본: OTHER)"),
      description: z.string().optional().describe("기능 설명"),
      priority: z.string().optional().describe("우선순위 (HIGH, MEDIUM, LOW. 기본: MEDIUM)"),
      complexity: z.string().optional().describe("복잡도 (HIGH, MEDIUM, LOW. 기본: MEDIUM)"),
      effort: z.string().optional().describe("공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      implStartDate: z.string().optional().describe("구현 시작일 (ISO 날짜)"),
      implEndDate: z.string().optional().describe("구현 종료일 (ISO 날짜)"),
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
      type: z.string().optional().describe("기능 유형"),
      description: z.string().optional().describe("기능 설명"),
      commentCn: z.string().optional().describe("코멘트"),
      priority: z.string().optional().describe("우선순위"),
      complexity: z.string().optional().describe("복잡도"),
      effort: z.string().optional().describe("공수"),
      assignMemberId: z.string().optional().describe("담당자 회원 ID"),
      implStartDate: z.string().optional().describe("구현 시작일 (ISO 날짜)"),
      implEndDate: z.string().optional().describe("구현 종료일 (ISO 날짜)"),
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

  // ═══════════════════════════════════════════════════════════════
  // 7. DB 테이블
  // ═══════════════════════════════════════════════════════════════

  server.tool(
    "list_db_tables",
    "DB 테이블 목록 조회 — 프로젝트에 등록된 데이터베이스 테이블 목록을 반환합니다",
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
}

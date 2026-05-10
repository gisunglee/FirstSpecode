/**
 * 엑셀 다운로드 — export route 팩토리 (반복 방지의 핵심)
 *
 * 역할:
 *   - entity 별 export route 의 보일러플레이트(권한·행수 가드·워크북 생성·파일 응답)를
 *     단 한 곳에서 처리.
 *   - entity 모듈은 ExportConfig 만 작성하면, route 파일은 이 함수에 config 를
 *     넘기는 3줄짜리가 된다.
 *
 * 왜 이 함수가 따로 존재하는가:
 *   목록 화면이 12개를 넘어가면 "권한 체크 → 행수 가드 → workbook → Response" 가
 *   12번 복붙된다. 한 번이라도 권한 정책이 바뀌면 12군데를 수정해야 하고,
 *   한 군데만 깜빡하면 보안 구멍이 생긴다. 이 함수는 그 보일러플레이트의
 *   단일 진실원(SOT) 역할을 한다.
 *
 * 사용:
 *   // src/app/api/projects/[id]/tasks/export/route.ts
 *   import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
 *   import { tasksExportConfig } from "@/lib/exports/excel/entities/tasks";
 *   export const GET = createExportRoute(tasksExportConfig);
 */

import type { NextRequest } from "next/server";
import { apiError } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { buildWorkbook } from "./buildWorkbook";
import { buildExportFilename } from "./filename";
import { type ExportConfig, MAX_EXPORT_ROWS } from "./types";
import type { Permission } from "@/lib/permissions";

/**
 * createExportRoute — entity 별 export 설정을 받아 Next.js Route Handler 를 반환
 *
 *   T : 데이터 행 타입 (tasks → TaskRow 등)
 *   P : URL params 타입 (예: { id: string })
 */
export function createExportRoute<T, P>(cfg: ExportConfig<T, P>) {
  return async function GET(
    req: NextRequest,
    ctx: { params: Promise<P> },
  ): Promise<Response> {
    // ① params 는 Next.js 16 부터 Promise — await 필수
    const params = await ctx.params;

    // ② 권한 체크
    //    - resolveScope 가 projectId 를 돌려주면 그 프로젝트 권한
    //    - 없으면(시스템 레벨 export) 추후 분기 추가 — 현재는 projectId 필수
    const scope = cfg.resolveScope(params);
    if (scope.projectId === undefined) {
      // 시스템 레벨 export 는 별도 가드가 필요하므로 기본 동작에서는 차단.
      // 필요해지면 requireSystemAdmin 같은 분기를 여기에 추가.
      return apiError("FORBIDDEN", "시스템 레벨 다운로드는 지원되지 않습니다.", 403);
    }

    const gate = await requirePermission(
      req,
      scope.projectId,
      cfg.permission as Permission,
    );
    if (gate instanceof Response) return gate;

    // ③ 데이터 조회 — entity 모듈의 fetchData 가 책임
    //    (검색·필터·정렬 적용, 페이지네이션 미적용, 화면 GET 과 동일 결과 보장)
    //    "내 담당" 같은 동적 필터를 풀 수 있도록 인증된 mberId 도 전달.
    let rows: T[];
    try {
      rows = await cfg.fetchData({ req, params, mberId: gate.mberId });
    } catch (err) {
      // fetchData 가 도메인 에러를 Response 로 던질 수 있게 허용
      // (예: "검색어 없으면 export 불가" 같은 entity 별 추가 정책)
      if (err instanceof Response) return err;
      console.error(`[excel-export] fetchData 실패 (${cfg.entityKey}):`, err);
      return apiError("DB_ERROR", "데이터 조회에 실패했습니다.", 500);
    }

    // ④ 행 수 가드
    if (rows.length > MAX_EXPORT_ROWS) {
      return apiError(
        "EXPORT_TOO_LARGE",
        `한 번에 ${MAX_EXPORT_ROWS.toLocaleString()}건까지 다운로드할 수 있습니다. 필터를 좁혀주세요. (현재 ${rows.length.toLocaleString()}건)`,
        400,
      );
    }

    // ⑤ 워크북 생성
    let buffer: Buffer;
    try {
      buffer = await buildWorkbook({
        sheetName: cfg.sheetName,
        columns:   cfg.columns,
        rows,
      });
    } catch (err) {
      console.error(`[excel-export] 워크북 생성 실패 (${cfg.entityKey}):`, err);
      return apiError("EXPORT_BUILD_ERROR", "엑셀 파일 생성에 실패했습니다.", 500);
    }

    // ⑥ 파일 응답
    //    - Content-Disposition 으로 다운로드 트리거
    //    - Cache-Control no-store: 사용자별 데이터를 캐시하지 않도록
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          `attachment; filename="${buildExportFilename(cfg.entityKey)}"`,
        "Cache-Control": "no-store",
      },
    });
  };
}

/**
 * GET /api/projects/[id]/settings/document — 출력 문서 양식 기본값 조회
 * PUT /api/projects/[id]/settings/document — 출력 문서 양식 기본값 저장 + 변경이력 기록
 *
 * 역할:
 *   - 산출물(.docx) 출력 시 표지/바닥글에 들어가는 저작권 문구와 기본 문서 버전을
 *     프로젝트(발주처)별로 입력받기 위한 설정 엔드포인트.
 *   - 두 항목 모두 nullable. 미설정 시 export 핸들러가 코드 fallback 사용.
 *   - 값 변경 시 TbPjSettingsHistory 에 자동 기록 (기존 AI 설정과 동일 패턴).
 *
 * 권한:
 *   - project.settings (OWNER/ADMIN). 일반 멤버는 읽기/쓰기 모두 차단됨.
 *   - 시스템 관리자 지원 세션은 GET 만 통과 (.read 가 아니므로 PUT 자동 차단).
 *     ※ 본 권한 키는 매트릭스상 .read 가 아니라 GET 도 지원세션 차단 대상이지만,
 *       프로젝트 설정 자체가 지원세션에서 노출되면 안 되는 영역이라 의도적으로 동일 키 사용.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// 너무 긴 입력을 차단 (DB 컬럼 길이와 사용자 실수 방지)
//   copyright_holder    VARCHAR(255)
//   doc_version_default VARCHAR(50)
//   approver_nm         VARCHAR(100)
const MAX_COPYRIGHT_LEN   = 255;
const MAX_DOC_VERSION_LEN = 50;
const MAX_APPROVER_LEN    = 100;

// ─── GET ────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "project.settings");
  if (gate instanceof Response) return gate;

  try {
    const settings = await prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: {
        copyright_holder:    true,
        doc_version_default: true,
        approver_nm:         true,
      },
    });

    return apiSuccess({
      // 미설정 상태 그대로 노출 — UI 가 placeholder 로 fallback 안내 표시
      copyrightHolder:   settings?.copyright_holder    ?? null,
      docVersionDefault: settings?.doc_version_default ?? null,
      approverName:      settings?.approver_nm         ?? null,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/settings/document] DB 오류:`, err);
    return apiError("DB_ERROR", "문서 설정 조회에 실패했습니다.", 500);
  }
}

// ─── PUT ────────────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "project.settings");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { copyrightHolder, docVersionDefault, approverName } = body as {
    copyrightHolder?:   string | null;
    docVersionDefault?: string | null;
    approverName?:      string | null;
  };

  // 입력값 정규화 — 빈 문자열은 NULL 로 저장 (사용자가 지우면 fallback 으로 돌아가도록)
  // 입력 자체가 없는(undefined) 케이스도 NULL — 부분 업데이트가 아니라 전체 저장으로 처리
  const newCopyright =
    typeof copyrightHolder === "string"
      ? (copyrightHolder.trim() || null)
      : null;
  const newDocVersion =
    typeof docVersionDefault === "string"
      ? (docVersionDefault.trim() || null)
      : null;
  const newApprover =
    typeof approverName === "string"
      ? (approverName.trim() || null)
      : null;

  if (newCopyright && newCopyright.length > MAX_COPYRIGHT_LEN) {
    return apiError("VALIDATION_ERROR", `저작권 문구는 ${MAX_COPYRIGHT_LEN}자 이내로 입력해 주세요.`, 400);
  }
  if (newDocVersion && newDocVersion.length > MAX_DOC_VERSION_LEN) {
    return apiError("VALIDATION_ERROR", `문서 버전은 ${MAX_DOC_VERSION_LEN}자 이내로 입력해 주세요.`, 400);
  }
  if (newApprover && newApprover.length > MAX_APPROVER_LEN) {
    return apiError("VALIDATION_ERROR", `기본 승인자는 ${MAX_APPROVER_LEN}자 이내로 입력해 주세요.`, 400);
  }

  try {
    // 현재값 조회 — 변경이력 기록용 (값이 실제 바뀐 항목만 기록)
    const current = await prisma.tbPjProjectSettings.findUnique({
      where:  { prjct_id: projectId },
      select: {
        copyright_holder:    true,
        doc_version_default: true,
        approver_nm:         true,
      },
    });
    if (!current) {
      // 프로젝트 생성 시 settings 행이 같이 만들어지므로 정상 경로에선 발생 안 함
      return apiError("NOT_FOUND", "프로젝트 설정이 존재하지 않습니다.", 404);
    }

    await prisma.$transaction(async (tx) => {
      // 한 번에 모든 문서 컬럼 업데이트
      await tx.tbPjProjectSettings.update({
        where: { prjct_id: projectId },
        data: {
          copyright_holder:    newCopyright,
          doc_version_default: newDocVersion,
          approver_nm:         newApprover,
          mdfcn_dt:            new Date(),
        },
      });

      // 항목별 변경이력 기록 — bfr/aftr 모두 NULL 일 수 있으므로 빈 문자열로 정규화
      const histories: { item: string; before: string | null; after: string | null }[] = [];
      if ((current.copyright_holder ?? null) !== newCopyright) {
        histories.push({ item: "저작권 문구", before: current.copyright_holder, after: newCopyright });
      }
      if ((current.doc_version_default ?? null) !== newDocVersion) {
        histories.push({ item: "기본 문서 버전", before: current.doc_version_default, after: newDocVersion });
      }
      if ((current.approver_nm ?? null) !== newApprover) {
        histories.push({ item: "기본 승인자", before: current.approver_nm, after: newApprover });
      }
      if (histories.length > 0) {
        await tx.tbPjSettingsHistory.createMany({
          data: histories.map((h) => ({
            prjct_id:    projectId,
            chg_mber_id: gate.mberId,
            chg_item_nm: h.item,
            bfr_val_cn:  h.before ?? "",
            aftr_val_cn: h.after  ?? "",
          })),
        });
      }
    });

    return apiSuccess({
      copyrightHolder:   newCopyright,
      docVersionDefault: newDocVersion,
      approverName:      newApprover,
    });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/settings/document] DB 오류:`, err);
    return apiError("DB_ERROR", "문서 설정 저장 중 오류가 발생했습니다.", 500);
  }
}

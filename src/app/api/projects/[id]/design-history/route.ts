/**
 * GET /api/projects/[id]/design-history — 설계 내용 변경 이력 조회
 *
 * 역할:
 *   - tb_ds_design_change에서 특정 엔티티의 설명 이력 조회
 *   - SettingsHistoryDialog와 동일한 응답 포맷 반환
 *   - snapshot_data.before / snapshot_data.after → beforeVal / afterVal 매핑
 *
 * Query:
 *   refTblNm — 대상 테이블명 (필수, e.g. "tb_ds_function")
 *   refId    — 대상 레코드 ID (필수, e.g. functionId)
 *   itemName — chg_rsn_cn 필터 (필수, e.g. "기능 설명")
 *   limit    — 최대 건수 (기본 50, 최대 200)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 프로젝트 멤버 여부 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url      = new URL(request.url);
  const refTblNm = url.searchParams.get("refTblNm");
  const refId    = url.searchParams.get("refId");
  const itemName = url.searchParams.get("itemName");
  const limit    = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200);

  if (!refTblNm?.trim() || !refId?.trim() || !itemName?.trim()) {
    return apiError("VALIDATION_ERROR", "refTblNm, refId, itemName 파라미터가 필요합니다.", 400);
  }

  // UUID 형식 판별 (36자 하이픈 포맷) — 담당자 이력의 before/after 값이 mberId일 때 감지용
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    const changes = await prisma.tbDsDesignChange.findMany({
      where: {
        prjct_id:   projectId,
        ref_tbl_nm: refTblNm,
        ref_id:     refId,
        chg_rsn_cn: itemName,
      },
      orderBy: { chg_dt: "desc" },
      take:    limit,
    });

    // 배치 조회할 mberId 수집 — 변경자 + snapshot의 before/after UUID 모두 포함
    // (담당자 이력의 경우 name 필드가 null일 수 있어 UUID를 다시 해석해야 함)
    const memberIdSet = new Set<string>();
    for (const c of changes) {
      if (c.chg_mber_id) memberIdSet.add(c.chg_mber_id);
      const snap = c.snapshot_data as { before?: string | null; after?: string | null } | null;
      if (snap?.before && UUID_RE.test(snap.before)) memberIdSet.add(snap.before);
      if (snap?.after  && UUID_RE.test(snap.after))  memberIdSet.add(snap.after);
    }
    const memberIds = Array.from(memberIdSet);
    const members = memberIds.length
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          // email_addr를 fallback으로 제공 — mber_nm 미설정 계정도 식별 가능
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    // 이름 우선, 없으면 이메일, 둘 다 없으면 UUID 그대로
    const memberMap = new Map(
      members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || m.mber_id])
    );

    // 값 문자열을 이름으로 해석 — UUID면 map 조회, 아니면 원본 그대로
    function resolve(value: string | null | undefined): string {
      if (!value) return "";
      if (UUID_RE.test(value)) return memberMap.get(value) ?? value;
      return value;
    }

    const items = changes.map((c, idx) => {
      // snapshot_data 구조:
      //   - 기본: { before, after } — 텍스트/설명류
      //   - 담당자 등 참조형: { before: mberId, after: mberId, beforeName, afterName }
      //     → 이름이 저장돼 있으면 우선 사용, 없으면 UUID를 memberMap으로 해석
      //       (멤버 탈퇴 후에도 snapshot의 이름이 있으면 보존됨)
      const snap = c.snapshot_data as {
        before?:     string | null;
        after?:      string | null;
        beforeName?: string | null;
        afterName?:  string | null;
      } | null;
      return {
        histId:    c.chg_id,
        version:   changes.length - idx,   // 최신 = 가장 높은 번호
        changedBy: c.chg_mber_id ? (memberMap.get(c.chg_mber_id) ?? "알 수 없음") : "알 수 없음",
        changedAt: c.chg_dt.toISOString(),
        // snapshot 이름 우선 → 그 다음 UUID 해석 → 최종적으로 원본(설명 텍스트 등)
        afterVal:  snap?.afterName  ?? resolve(snap?.after)  ?? "",
        beforeVal: snap?.beforeName ?? resolve(snap?.before) ?? "",
      };
    });

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}

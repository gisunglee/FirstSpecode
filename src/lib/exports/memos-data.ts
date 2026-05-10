/**
 * exports/memos-data.ts — 메모 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";

export type MemoListItem = {
  memoId:        string;
  subject:       string;
  shareYn:       string;
  refTyCode:     string | null;
  refId:         string | null;
  refName:       string;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  creatDt:       Date;
};

/**
 * fetchProjectMemos — 메모 목록 + 작성자 + 연결 엔티티 이름 조회
 *
 *   - mberId : 인증된 사용자. "내 메모" 식별 + 본인 메모 + 공유 메모 OR 조건 구성
 *   - shareFilter : "mine" | "shared" | undefined(전체 — 본인 + 공유)
 *   - refType + refId : 특정 엔티티에 연결된 메모만
 *   - search : 제목 부분 일치
 */
export async function fetchProjectMemos(opts: {
  projectId:    string;
  mberId:       string;
  refType?:     string;
  refId?:       string;
  search?:      string;
  shareFilter?: string;
}): Promise<MemoListItem[]> {
  const { projectId, mberId, refType, refId, search, shareFilter } = opts;

  // 조회 범위: 기본은 본인 메모 + 공유 메모(OR)
  const where: Record<string, unknown> = {
    prjct_id: projectId,
    OR: [
      { creat_mber_id: mberId },
      { share_yn: "Y" },
    ],
  };

  if (refType && refId) {
    where.ref_ty_code = refType;
    where.ref_id      = refId;
  }
  if (search) {
    where.memo_sj = { contains: search, mode: "insensitive" };
  }
  if (shareFilter === "mine") {
    delete where.OR;
    where.creat_mber_id = mberId;
  } else if (shareFilter === "shared") {
    delete where.OR;
    where.share_yn = "Y";
  }

  const memos = await prisma.tbDsMemo.findMany({
    where,
    orderBy: { creat_dt: "desc" },
    take: 200,
  });

  // 작성자 이름 일괄 조회
  const mberIds = [...new Set(memos.map((m) => m.creat_mber_id))];
  const members = mberIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: mberIds } },
        select: { mber_id: true, mber_nm: true },
      })
    : [];
  const mberMap = new Map(members.map((m) => [m.mber_id, m.mber_nm]));

  // 연결 엔티티 이름 일괄 조회 (ref_ty_code 별)
  const refNameMap = await resolveRefNames(memos);

  return memos.map((m) => ({
    memoId:        m.memo_id,
    subject:       m.memo_sj,
    shareYn:       m.share_yn,
    refTyCode:     m.ref_ty_code,
    refId:         m.ref_id,
    refName:       m.ref_id ? (refNameMap.get(m.ref_id) ?? "") : "",
    viewCnt:       m.view_cnt,
    creatMberId:   m.creat_mber_id,
    creatMberName: mberMap.get(m.creat_mber_id) ?? "",
    isMine:        m.creat_mber_id === mberId,
    creatDt:       m.creat_dt,
  }));
}

// ─── 연결 엔티티 이름 일괄 조회 유틸 ─────────────────────────────────────────

async function resolveRefNames(
  memos: { ref_ty_code: string | null; ref_id: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const groups: Record<string, string[]> = {};
  for (const m of memos) {
    if (!m.ref_ty_code || !m.ref_id) continue;
    if (!groups[m.ref_ty_code]) groups[m.ref_ty_code] = [];
    groups[m.ref_ty_code].push(m.ref_id);
  }

  const queries: Promise<void>[] = [];
  if (groups.FUNCTION?.length) {
    queries.push(
      prisma.tbDsFunction.findMany({
        where:  { func_id: { in: groups.FUNCTION } },
        select: { func_id: true, func_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.func_id, r.func_nm))),
    );
  }
  if (groups.AREA?.length) {
    queries.push(
      prisma.tbDsArea.findMany({
        where:  { area_id: { in: groups.AREA } },
        select: { area_id: true, area_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.area_id, r.area_nm))),
    );
  }
  if (groups.SCREEN?.length) {
    queries.push(
      prisma.tbDsScreen.findMany({
        where:  { scrn_id: { in: groups.SCREEN } },
        select: { scrn_id: true, scrn_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.scrn_id, r.scrn_nm))),
    );
  }
  if (groups.UNIT_WORK?.length) {
    queries.push(
      prisma.tbDsUnitWork.findMany({
        where:  { unit_work_id: { in: groups.UNIT_WORK } },
        select: { unit_work_id: true, unit_work_nm: true },
      }).then((rows) => rows.forEach((r) => map.set(r.unit_work_id, r.unit_work_nm))),
    );
  }

  await Promise.all(queries);
  return map;
}

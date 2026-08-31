"use client";

/**
 * MemoDetailPage — 메모 상세/편집/신규 전체 페이지 (/projects/[id]/memos/[memoId])
 *
 * 역할: 페이지 셸(라우팅)만 담당 — 실제 CRUD 본체는 MemoDetailPanel(공용, 팝업에서도
 * 그대로 재사용).
 */

import { Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import MemoDetailPanel from "@/components/common/MemoDetailPanel";

export default function MemoDetailPage() {
  return (
    <Suspense fallback={null}>
      <MemoDetailInner />
    </Suspense>
  );
}

function MemoDetailInner() {
  const { id: projectId, memoId } = useParams<{ id: string; memoId: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // URL 쿼리에서 연결 대상 프리셋 (엔티티 상세화면 "메모 추가"에서 진입 시)
  const presetRefType = searchParams.get("refType") ?? undefined;
  const presetRefId   = searchParams.get("refId") ?? undefined;
  // "회의록" 메뉴/목록에서 "+ 새 메모"로 진입하면 실려 옴 — 새 메모의 구분 기본값
  const presetPurpose = searchParams.get("purpose") ?? undefined;

  const listPath = `/projects/${projectId}/memos`;

  return (
    <MemoDetailPanel
      projectId={projectId}
      memoId={memoId}
      presetRefType={presetRefType}
      presetRefId={presetRefId}
      presetPurpose={presetPurpose}
      onBack={() => router.push(listPath)}
      onSaved={(savedMemoId) => {
        // 신규 작성이었으면 실제 id로 URL 교체 — 편집 모드는 같은 URL 유지(쿼리 재조회만)
        if (memoId === "new") router.replace(`/projects/${projectId}/memos/${savedMemoId}`);
      }}
      onDeleted={() => router.push(listPath)}
    />
  );
}

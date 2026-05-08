"use client";

/**
 * ProjectIndexRedirect — /projects/[id] 진입 시 기본 페이지로 자동 이동
 *
 * 역할:
 *   - 누군가 /projects/{uuid} 만 입력해도 404 안 나도록 가드
 *   - 시스템 관리자 [지원 세션] 시작 후 router.push(`/projects/${id}`) 도 여기로 들어옴
 *   - 디폴트 랜딩은 "단위업무" — 대부분의 워크스페이스 작업이 여기서 시작
 *     (요구사항/사용자스토리 보다 더 상위 단위)
 *
 * 왜 redirect 인가?
 *   - 프로젝트 컨텐츠 페이지(/tasks, /requirements 등)는 각각 독립적으로 가드.
 *     Index 자체에서 데이터 조회 없이 가장 자주 쓰는 첫 메뉴로 보내는 게 단순.
 */

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default function ProjectIndexRedirect({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();

  useEffect(() => {
    // 분석 그룹의 첫 항목인 "단위업무"로 보냄.
    // 권한 부족(VIEWER 아님 등)이면 단위업무 페이지가 자체적으로 처리.
    router.replace(`/projects/${id}/unit-works`);
  }, [id, router]);

  // redirect 발생 직전 짧은 로딩 표시 — 보통 사용자에게는 한 깜빡임 정도
  return (
    <div style={{
      flex:           1,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      color:          "var(--color-text-tertiary)",
      fontSize:       "var(--text-sm)",
    }}>
      프로젝트로 이동 중...
    </div>
  );
}

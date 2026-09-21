"use client";

/**
 * StudioRelatedTests — 관련 정보 패널 "테스트케이스" 모듈
 *
 * 역할:
 *   - 현재 단위업무에 연결된 테스트 명세(단위·통합)를 고정 순서 목록으로 보여 준다.
 *   - 현재 문서가 "화면"이면 그 화면을 덮는 명세만 굵게 — 화면 블록으로 스크롤했을 때 굵어지는 게
 *     없으면 그 화면은 테스트가 없다는 뜻(커버리지 구멍이 바로 보이게). 목록은 필터·정렬하지 않는다.
 *   - 단위업무·영역·기능·요구사항 문서에서는 전부 보통 굵기 (영역·기능은 테스트 연결 단위가 아님).
 *   - 클릭 → 테스트 명세 상세 화면.
 *
 * 데이터는 인스펙터의 공용 로더(관련 정보 불러오기)가 채운다. 이 컴포넌트는 표시만.
 */

import Link from "next/link";
import type { RelatedTestSpec, StudioBlock } from "./types";

type Props = {
  projectId: string;
  data: RelatedTestSpec[] | undefined;
  selectedBlock: StudioBlock | null;
};

const KIND_LABEL: Record<string, string> = {
  UNIT:        "단위",
  INTEGRATION: "통합",
};

// 테스트 명세 목록 화면(test-specs/page.tsx)과 같은 표기
const STATUS_LABEL: Record<string, string> = {
  DRAFT:       "작성중",
  IN_PROGRESS: "진행중",
  PASSED:      "합격",
  FAILED:      "불합격",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT:       "sp-badge-neutral",
  IN_PROGRESS: "sp-badge-info",
  PASSED:      "sp-badge-success",
  FAILED:      "sp-badge-error",
};

export default function StudioRelatedTests({ projectId, data, selectedBlock }: Props) {
  const specs = data ?? [];
  // 화면 문서일 때만 강조 대상이 있다
  const activeScreenId = selectedBlock?.kind === "screen" ? selectedBlock.entityId : null;

  return (
    <details className="sp-studio-related" open>
      <summary>테스트케이스 <span>{data ? specs.length : "-"}</span></summary>
      {!data ? (
        <p>상단의 관련 정보 불러오기를 사용해 주세요.</p>
      ) : specs.length === 0 ? (
        <p>이 단위업무에 연결된 테스트 명세가 없습니다.</p>
      ) : (
        <div className="sp-studio-test-list">
          {specs.map((spec) => {
            const isActive = activeScreenId !== null && spec.screens.some((s) => s.screenId === activeScreenId);
            return (
              <Link
                key={spec.testSpecId}
                href={`/projects/${projectId}/test-specs/${spec.testSpecId}`}
                className={`sp-studio-test-item${isActive ? " is-active" : ""}`}
                title={`${spec.displayId} ${spec.testSpecNm} — 케이스 ${spec.caseCount}개`}
              >
                <span className="sp-studio-test-kind">{KIND_LABEL[spec.testKindCode] ?? spec.testKindCode}</span>
                <span className="sp-studio-test-id">{spec.displayId}</span>
                <strong className="sp-studio-test-name">{spec.testSpecNm}</strong>
                <span className={`sp-badge ${STATUS_BADGE_CLASS[spec.sttusCode] ?? "sp-badge-neutral"} sp-studio-test-status`}>
                  {STATUS_LABEL[spec.sttusCode] ?? spec.sttusCode}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </details>
  );
}

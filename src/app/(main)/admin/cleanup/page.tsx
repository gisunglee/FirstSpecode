"use client";

/**
 * AdminCleanupPage — 시스템 어드민 "정보 삭제" (/admin/cleanup)
 *
 * 역할:
 *   soft-deleted 프로젝트를 어드민이 직접 영구 삭제할 수 있는 운영 화면.
 *   외부 cron 이 없는 환경에서도 운영자가 손으로 정리할 수 있게 해 준다.
 *
 * 구성:
 *   본 파일은 자리만 잡고, 실제 표/모달은 섹션 컴포넌트로 분리.
 *   향후 첨부파일 orphan 정리 등 다른 정리 작업이 추가되면 여기에
 *   섹션을 한 줄 추가하는 식으로 확장한다.
 *
 * 권한:
 *   /admin/* 전체가 layout 단의 isSystemAdmin 가드로 보호됨.
 *   API 측에도 requireSystemAdmin 이중 적용 (UI 가 뚫려도 데이터 노출 안 됨).
 */

import { ProjectCleanupSection } from "./ProjectCleanupSection";

export default function AdminCleanupPage() {
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <ProjectCleanupSection />
      {/*
        향후 확장 자리:
          <AttachFileCleanupSection />
        UPLOAD_ROOT_DIR 정책이 정해지면 첨부파일 orphan 정리 섹션을 추가.
      */}
    </div>
  );
}

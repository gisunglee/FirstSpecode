"use client";

/**
 * ConfirmDialog — 삭제/위험 작업 확인 다이얼로그
 *
 * 역할:
 *   - 삭제 등 위험한 작업 전 사용자 확인을 받는 모달
 *   - window.confirm() 대신 반드시 이 컴포넌트를 사용할 것
 *     (window.confirm은 브라우저마다 UI가 다르고 UX가 최악임)
 *
 * 사용 예:
 *   <ConfirmDialog
 *     open={isOpen}
 *     title="사용자 삭제"
 *     description="정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
 *     onConfirm={handleDelete}
 *     onCancel={() => setIsOpen(false)}
 *   />
 */

import Button from "@/components/ui/Button";

type ConfirmDialogProps = {
  open:        boolean;
  title:       string;
  description: string;
  confirmLabel?: string;
  cancelLabel?:  string;
  loading?:    boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel  = "취소",
  loading      = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 닫혀 있으면 렌더링하지 않음 (DOM에서 제거)
  if (!open) return null;

  return (
    // 배경 오버레이 — 클릭 시 닫기
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      {/* 다이얼로그 본체 — 이벤트 버블링 차단 */}
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-600">{description}</p>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Button — 원자 버튼 컴포넌트
 *
 * 역할:
 *   - 앱 전체에서 사용되는 기본 버튼 UI
 *   - variant(종류), size(크기), loading 상태 지원
 *
 * 사용 예:
 *   <Button onClick={handleSave}>저장</Button>
 *   <Button variant="danger" onClick={handleDelete}>삭제</Button>
 *   <Button loading={isSubmitting}>저장 중...</Button>
 */

import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?:    "sm" | "md" | "lg";
  loading?: boolean;
};

// variant별 스타일 상수 — 변경 시 이 객체만 수정
const VARIANT_STYLES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:   "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  danger:    "bg-red-600 text-white hover:bg-red-700",
  ghost:     "bg-transparent text-gray-700 hover:bg-gray-100",
};

// size별 스타일 상수
const SIZE_STYLES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export default function Button({
  children,
  variant = "primary",
  size    = "md",
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        "transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className
      )}
      {...props}
    >
      {/* 로딩 중일 때 스피너 표시 */}
      {loading && (
        <svg
          className="mr-2 h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

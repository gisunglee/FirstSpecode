/**
 * ProgressTracker — 공통 단계별 진척률 컴포넌트
 *
 * 분석·설계·구현·테스트 단계의 진척률(0~100)을 표시하고 수정하는 UI.
 * tb_cm_progress 테이블을 다형 참조(refTable + refId)로 사용하므로
 * 단위업무·기능·영역 등 어떤 엔티티에서도 재사용 가능하다.
 *
 * 인터랙션:
 *   - 바 클릭: 클릭 위치 비율로 값을 계산해 즉시 저장
 *   - 숫자 입력: 직접 타이핑 후 Enter 또는 blur 시 저장
 *
 * 사용 예시:
 *   <ProgressTracker projectId={pid} refTable="tb_ds_unit_work" refId={unitWorkId} />
 *   <ProgressTracker projectId={pid} refTable="tb_ds_function" refId={funcId} phases={["impl", "test"]} />
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

export type PhaseKey = "analy" | "design" | "impl" | "test";

const DEFAULT_LABELS: Record<PhaseKey, string> = {
  analy:  "분석",
  design: "설계",
  impl:   "구현",
  test:   "테스트",
};

interface PhaseProgressData {
  analyRt:  number;
  designRt: number;
  implRt:   number;
  testRt:   number;
}

const PHASE_TO_FIELD: Record<PhaseKey, keyof PhaseProgressData> = {
  analy:  "analyRt",
  design: "designRt",
  impl:   "implRt",
  test:   "testRt",
};

// 단계별 그라디언트 색상 — 사무적이고 절제된 톤
const PHASE_COLORS: Record<PhaseKey, { from: string; to: string; glow: string }> = {
  analy:  { from: "#93c5fd", to: "#2563eb", glow: "rgba(37,99,235,0.20)"  },
  design: { from: "#6ee7b7", to: "#059669", glow: "rgba(5,150,105,0.20)"  },
  impl:   { from: "#fca5a5", to: "#dc2626", glow: "rgba(220,38,38,0.20)"  },
  test:   { from: "#fcd34d", to: "#d97706", glow: "rgba(217,119,6,0.20)"  },
};

export interface ProgressTrackerProps {
  projectId:    string;
  refTable:     string;
  refId:        string;
  phases?:      PhaseKey[];
  phaseLabels?: Partial<Record<PhaseKey, string>>;
  readOnly?:    boolean;
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function ProgressTracker({
  projectId,
  refTable,
  refId,
  phases = ["analy", "design", "impl", "test"],
  phaseLabels = {},
  readOnly = false,
}: ProgressTrackerProps) {
  const queryClient = useQueryClient();
  const enabled     = Boolean(refId) && Boolean(refTable);
  const apiUrl      = `/api/projects/${projectId}/phase-progress?refTable=${refTable}&refId=${refId}`;

  const { data, isLoading } = useQuery<PhaseProgressData>({
    queryKey: ["phase-progress", projectId, refTable, refId],
    queryFn:  () =>
      authFetch<{ data: PhaseProgressData }>(apiUrl).then((r) => r.data),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: (body: Partial<PhaseProgressData>) =>
      authFetch<{ data: PhaseProgressData }>(apiUrl, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }).then((r) => r.data),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["phase-progress", projectId, refTable, refId],
        updated,
      );
    },
  });

  const save = (phase: PhaseKey, newValue: number) => {
    const field = PHASE_TO_FIELD[phase];
    if (data && data[field] === newValue) return;
    mutation.mutate({ [field]: newValue });
  };

  if (!enabled) return null;

  const values: PhaseProgressData = data ?? { analyRt: 0, designRt: 0, implRt: 0, testRt: 0 };

  return (
    <div style={{
      display:      "flex",
      alignItems:   "stretch",
      alignSelf:    "center",
      borderRadius: 10,
      background:   "rgba(0,0,0,0.05)",
      overflow:     "hidden",
    }}>
      {phases.map((phase, idx) => (
        <div
          key={phase}
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            borderLeft:     idx === 0 ? "none" : "1px solid rgba(0,0,0,0.08)",
            padding:        "6px 10px",
          }}
        >
          <PhaseItem
            phase={phase}
            label={phaseLabels[phase] ?? DEFAULT_LABELS[phase]}
            value={values[PHASE_TO_FIELD[phase]]}
            isLoading={isLoading}
            readOnly={readOnly}
            isSaving={mutation.isPending}
            onSave={(v) => save(phase, v)}
          />
        </div>
      ))}
    </div>
  );
}

// ─── 단계 아이템 ───────────────────────────────────────────────────────────────

interface PhaseItemProps {
  phase:     PhaseKey;
  label:     string;
  value:     number;
  isLoading: boolean;
  readOnly:  boolean;
  isSaving:  boolean;
  onSave:    (value: number) => void;
}

function PhaseItem({ phase, label, value, isLoading, readOnly, isSaving, onSave }: PhaseItemProps) {
  const colors   = PHASE_COLORS[phase];
  const disabled = readOnly || isLoading || isSaving;

  // 바 클릭 → 위치 비율로 0~100 계산, 우측 끝 5% 이내는 100으로 스냅
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect    = e.currentTarget.getBoundingClientRect();
    const ratio   = (e.clientX - rect.left) / rect.width;
    const raw     = Math.max(0, Math.min(1, ratio));
    const percent = raw >= 0.95 ? 100 : Math.round(raw * 100);
    onSave(percent);
  };

  const handleInputCommit = (rawValue: string) => {
    const parsed = parseInt(rawValue, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) onSave(parsed);
  };

  const fillStyle: React.CSSProperties =
    value === 0
      ? { width: "0%", background: "transparent", boxShadow: "none" }
      : {
          width:      `${value}%`,
          background: `linear-gradient(90deg, ${colors.from}, ${colors.to})`,
          boxShadow:  `0 1px 4px ${colors.glow}`,
        };

  return (
    // 한 줄 레이아웃: 레이블 | 바 | 숫자 | % — 타이틀 바 높이를 늘리지 않음
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* 레이블 */}
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        {label}
      </span>

      {/* 클릭 가능한 그라디언트 바 */}
      <div
        onClick={handleBarClick}
        title={disabled ? undefined : "클릭해서 진척률 설정"}
        style={{
          position:     "relative",
          height:       7,
          width:        72,
          borderRadius: 4,
          background:   "var(--color-border)",
          boxShadow:    "inset 0 1px 2px rgba(0,0,0,0.10)",
          cursor:       disabled ? "default" : "pointer",
          overflow:     "hidden",
          flexShrink:   0,
        }}
      >
        <div style={{
          position:     "absolute",
          left:         0, top: 0,
          height:       "100%",
          borderRadius: 4,
          transition:   "width 0.25s cubic-bezier(.4,0,.2,1)",
          ...fillStyle,
        }} />
        {!disabled && (
          <div
            style={{ position: "absolute", inset: 0, borderRadius: 4, background: "rgba(255,255,255,0)", transition: "background 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0)"; }}
          />
        )}
      </div>

      {/* 숫자 입력 */}
      {readOnly ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)", minWidth: 22, textAlign: "right" }}>
          {isLoading ? "—" : value}
        </span>
      ) : (
        <input
          type="text"
          inputMode="numeric"
          defaultValue={isLoading ? 0 : value}
          key={value}
          disabled={disabled}
          onBlur={(e) => handleInputCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          style={{
            width:        34,
            padding:      "0 3px",
            height:       20,
            fontSize:     11,
            fontWeight:   700,
            textAlign:    "center",
            border:       "none",
            borderRadius: 4,
            background:   "rgba(255,255,255,0.75)",
            color:        "var(--color-text-primary)",
            outline:      "none",
            opacity:      disabled ? 0.5 : 1,
          }}
        />
      )}
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>%</span>
    </div>
  );
}

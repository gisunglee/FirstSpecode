"use client";

/**
 * McpKeyManager — MCP 키 관리 UI (재사용 컴포넌트)
 *
 * 역할:
 *   - 사용자의 MCP 키 목록 조회 / 생성 / 폐기
 *   - 생성 시 scope 선택 (전역 vs 특정 프로젝트 고정)
 *   - 생성 직후 원문(rawKey) 1회 표시 + 클립보드 복사
 *
 * 재사용 위치:
 *   - /settings/profile?tab=api-keys — 사용자 컨텍스트 (defaultProjectId 미전달)
 *
 * GNB 우상단 아바타 드롭다운의 "MCP 키 관리" 링크가 위 URL로 직행
 *
 * Props:
 *   - defaultProjectId: 전달 시 신규 생성 폼의 프로젝트 드롭다운 기본 선택값
 *                      미전달 시 프로젝트 목록의 첫 항목 자동 선택
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

// ── 로컬 fetch 헬퍼 ───────────────────────────────────────────────────────────
// 이 컴포넌트는 res.ok 분기 + res.json() 패턴을 사용하므로
// throw 패턴인 글로벌 authFetch 대신 Response 반환 헬퍼 유지
function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const at = sessionStorage.getItem("access_token") ?? "";
  return fetch(url, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${at}`,
    },
  });
}

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface ProjectOption {
  prjct_id: string;
  prjct_nm: string;
}

interface ApiKeyItem {
  apiKeyId:   string;
  keyPrefix:  string;
  keyName:    string;
  prjctId:    string | null;   // null = 전역 키
  prjctNm:    string | null;
  createdAt:  string;
  lastUsedAt: string | null;
}

export interface McpKeyManagerProps {
  /** 신규 키 발급 폼의 프로젝트 드롭다운 기본 선택값 */
  defaultProjectId?: string;
}

export default function McpKeyManager({ defaultProjectId }: McpKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  // 생성 직후 원문 표시용 (1회만 — 이후 조회 불가)
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Scope 선택 — 안전 기본값: "특정 프로젝트 고정"
  const [scopeType, setScopeType] = useState<"global" | "project">("project");
  const [selectedPrjctId, setSelectedPrjctId] = useState<string>(defaultProjectId ?? "");
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  // 키 목록 조회
  const fetchKeys = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/mcp-keys");
      if (res.ok) {
        const body = await res.json();
        setKeys(body.data?.items ?? []);
      }
    } catch { /* 무시 */ }
    setLoading(false);
  }, []);

  // 프로젝트 옵션 로드 — scope 드롭다운 데이터 소스
  const fetchProjects = useCallback(async () => {
    try {
      const res = await authFetch("/api/projects/my");
      if (res.ok) {
        const body = await res.json();
        const items: ProjectOption[] = body.data?.items ?? [];
        setProjects(items);
        // defaultProjectId가 우선, 없으면 첫 프로젝트
        if (items.length > 0 && !selectedPrjctId) {
          setSelectedPrjctId(defaultProjectId ?? items[0].prjct_id);
        }
      }
    } catch { /* 무시 */ }
  }, [selectedPrjctId, defaultProjectId]);

  useEffect(() => { fetchKeys(); fetchProjects(); }, [fetchKeys, fetchProjects]);

  // defaultProjectId 가 바뀌면 (프로젝트 전환 시) 선택값도 갱신
  useEffect(() => {
    if (defaultProjectId) setSelectedPrjctId(defaultProjectId);
  }, [defaultProjectId]);

  // 키 생성
  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    if (scopeType === "project" && !selectedPrjctId) {
      toast.error("프로젝트를 선택해 주세요.");
      return;
    }

    // 전역 키는 위험 → 명시적 confirm으로 사고 방지
    if (scopeType === "global") {
      const ok = confirm(
        "⚠️ 전역 MCP 키를 생성하시겠습니까?\n\n" +
        "이 키는 당신이 멤버로 참여 중인 \"모든 프로젝트\"에 접근할 수 있습니다.\n\n" +
        "- Claude Code 세션이 실수로 다른 프로젝트 데이터를 건드릴 수 있습니다\n" +
        "- 키가 유출되면 피해 범위가 전체 프로젝트로 확산됩니다\n\n" +
        "특정 프로젝트에서만 쓸 예정이라면 '특정 프로젝트 고정' 사용을 강력히 권장합니다.\n\n" +
        "그래도 전역 키로 발급할까요?"
      );
      if (!ok) return;
    }

    setCreating(true);
    try {
      const res = await authFetch("/api/auth/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyName: newKeyName.trim(),
          prjctId: scopeType === "project" ? selectedPrjctId : undefined,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setCreatedRawKey(body.data.rawKey);
        setNewKeyName("");
        setShowCreate(false);
        fetchKeys();
      } else {
        toast.error(body.message || "키 생성 실패");
      }
    } catch {
      toast.error("키 생성 중 오류가 발생했습니다.");
    }
    setCreating(false);
  };

  // 키 복사
  const handleCopy = async () => {
    if (!createdRawKey) return;
    await navigator.clipboard.writeText(createdRawKey);
    setCopied(true);
    toast.success("MCP 키가 클립보드에 복사되었습니다.");
    setTimeout(() => setCopied(false), 2000);
  };

  // 키 폐기
  const handleRevoke = async (keyId: string, keyName: string) => {
    if (!confirm(`"${keyName}" 키를 폐기하시겠습니까?\n폐기 후 이 키로는 인증할 수 없습니다.`)) return;
    try {
      const res = await authFetch(`/api/auth/mcp-keys/${keyId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("MCP 키가 폐기되었습니다.");
        fetchKeys();
      } else {
        const body = await res.json();
        toast.error(body.message || "폐기 실패");
      }
    } catch {
      toast.error("키 폐기 중 오류가 발생했습니다.");
    }
  };

  if (loading) return <div style={{ color: "var(--color-text-secondary)" }}>로딩 중...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 600 }}>MCP 키 관리</h3>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            Claude Code 등 외부 AI 클라이언트에서 SPECODE MCP에 접근할 때 사용합니다.
            키 발급 시 &quot;특정 프로젝트 고정&quot;을 선택하면 다른 프로젝트 데이터가 노출되는 사고를 막을 수 있습니다.
          </p>
        </div>
        <button
          className="sp-btn sp-btn-primary"
          onClick={() => { setShowCreate(true); setCreatedRawKey(null); }}
          style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
        >
          + 키 생성
        </button>
      </div>

      {/* 생성 직후 원문 표시 배너 */}
      {createdRawKey && (
        <div style={{
          padding: "16px",
          background: "var(--color-bg-warning, #fff8e1)",
          border: "1px solid var(--color-border-warning, #ffe082)",
          borderRadius: 8,
        }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text-warning, #e65100)" }}>
            이 키는 다시 표시되지 않습니다. 지금 복사하세요.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{
              flex: 1,
              padding: "8px 12px",
              background: "var(--color-bg-subtle, #f5f5f5)",
              borderRadius: 4,
              fontSize: "var(--text-xs)",
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}>
              {createdRawKey}
            </code>
            <button
              className="sp-btn sp-btn-secondary"
              onClick={handleCopy}
              style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
            >
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
      )}

      {/* 키 생성 폼 */}
      {showCreate && (
        <div style={{
          padding: "16px",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          {/* 키 이름 */}
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 4 }}>
              키 이름
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: SPECODE 프로젝트용, 쇼핑몰 프로젝트용"
              maxLength={100}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize: "var(--text-sm)",
                background: "var(--color-bg-input, var(--color-bg))",
                color: "var(--color-text)",
              }}
            />
          </div>

          {/* Scope 선택 */}
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>
              접근 범위
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "var(--text-sm)" }}>
                <input
                  type="radio"
                  name="scopeType"
                  value="global"
                  checked={scopeType === "global"}
                  onChange={() => setScopeType("global")}
                />
                <span>
                  <span style={{ color: "var(--color-text-warning, #e65100)", fontWeight: 600 }}>⚠️ 전역</span>
                  {" "}— 내가 속한 모든 프로젝트 접근 가능 (비권장)
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "var(--text-sm)" }}>
                <input
                  type="radio"
                  name="scopeType"
                  value="project"
                  checked={scopeType === "project"}
                  onChange={() => setScopeType("project")}
                />
                <span>특정 프로젝트 고정 — 실수로 다른 프로젝트 건드리는 사고 방지</span>
              </label>
            </div>
            {scopeType === "project" && (
              <select
                value={selectedPrjctId}
                onChange={(e) => setSelectedPrjctId(e.target.value)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontSize: "var(--text-sm)",
                  background: "var(--color-bg-input, var(--color-bg))",
                  color: "var(--color-text)",
                }}
              >
                {projects.length === 0 && <option value="">(참여 중인 프로젝트 없음)</option>}
                {projects.map((p) => (
                  <option key={p.prjct_id} value={p.prjct_id}>{p.prjct_nm}</option>
                ))}
              </select>
            )}
          </div>

          {/* 액션 버튼 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="sp-btn sp-btn-secondary"
              onClick={() => { setShowCreate(false); setNewKeyName(""); }}
              style={{ fontSize: "var(--text-sm)" }}
            >
              취소
            </button>
            <button
              className="sp-btn sp-btn-primary"
              onClick={handleCreate}
              disabled={creating || !newKeyName.trim() || (scopeType === "project" && !selectedPrjctId)}
              style={{ fontSize: "var(--text-sm)" }}
            >
              {creating ? "생성 중..." : "생성"}
            </button>
          </div>
        </div>
      )}

      {/* 키 목록 */}
      {keys.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "40px 0",
          color: "var(--color-text-secondary)",
          fontSize: "var(--text-sm)",
        }}>
          등록된 MCP 키가 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {keys.map((k) => (
            <div
              key={k.apiKeyId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{k.keyName}</span>
                  <code style={{
                    fontSize: "var(--text-xs)",
                    fontFamily: "monospace",
                    color: "var(--color-text-secondary)",
                    background: "var(--color-bg-subtle, #f5f5f5)",
                    padding: "2px 6px",
                    borderRadius: 3,
                  }}>
                    {k.keyPrefix}...
                  </code>
                  {/* Scope 배지 */}
                  {k.prjctId ? (
                    <span style={{
                      fontSize: "var(--text-xs)",
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: "var(--color-bg-info, #e3f2fd)",
                      color: "var(--color-text-info, #1565c0)",
                      fontWeight: 500,
                    }}>
                      🔒 {k.prjctNm}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: "var(--text-xs)",
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: "var(--color-bg-warning, #fff8e1)",
                      color: "var(--color-text-warning, #e65100)",
                      fontWeight: 500,
                    }}>
                      🌐 전역
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary, var(--color-text-secondary))" }}>
                  생성: {new Date(k.createdAt).toLocaleDateString("ko-KR")}
                  {k.lastUsedAt && ` · 마지막 사용: ${new Date(k.lastUsedAt).toLocaleDateString("ko-KR")}`}
                </span>
              </div>
              <button
                className="sp-btn sp-btn-secondary"
                onClick={() => handleRevoke(k.apiKeyId, k.keyName)}
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-danger, #e53935)",
                  borderColor: "var(--color-danger, #e53935)",
                }}
              >
                폐기
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

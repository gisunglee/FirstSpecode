"use client";

/**
 * McpKeyManager — MCP 키 관리 UI (재사용 컴포넌트)
 *
 * 역할:
 *   - 사용자의 MCP 키 목록 조회 / 생성 / 폐기
 *   - 생성 시 단일 프로젝트로 scope 고정 (전역 키 발급은 정책상 미지원)
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
 *
 * 정책 — 전역 키 미지원:
 *   키 유출/AI 실수로 인한 사고 폭을 한 프로젝트에 가두기 위해 전역('ALL') 발급은
 *   API/UI 양쪽에서 차단된다. 기존에 발급된 전역 키는 목록에서 🌐 배지로 표시되며,
 *   해당 키는 폐기 후 프로젝트 단위로 재발급해야 한다.
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

// [2026-04-26] 키 용도 — DB CHECK 제약과 동일
//   CLIENT — Claude Code MCP 도구용
//   WORKER — /run-ai-tasks 워커용
// 두 용도 모두 단일 프로젝트 scope 필수 — 전역 발급 정책상 차단됨
type KeyUseSe = "CLIENT" | "WORKER";

interface ApiKeyItem {
  apiKeyId: string;
  keyPrefix: string;
  keyName: string;
  keyUseSe: KeyUseSe;        // [2026-04-26] 키 용도
  prjctId: string | null;   // null = 전역 키
  prjctNm: string | null;
  createdAt: string;
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
  // 생성 직후 배너에 쓸 용도 — keyUseSe는 폼을 다시 열면 바뀔 수 있어 별도 보관
  const [createdKeyUseSe, setCreatedKeyUseSe] = useState<KeyUseSe>("CLIENT");
  const [copied, setCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  // 이미 발급된 키에는 원문이 없어 생성 직후 배너를 볼 수 없으므로
  // "지금 이 페이지에 온 사람"을 위한 상시 안내를 별도로 둔다 (기본은 접힘)
  const [showGuide, setShowGuide] = useState(false);
  // [2026-04-26] 키 용도 선택 — 안전 기본값: 'CLIENT' (Claude Code MCP 도구용)
  const [keyUseSe, setKeyUseSe] = useState<KeyUseSe>("CLIENT");

  // 모든 키는 단일 프로젝트 scope 필수 — 전역 키는 정책상 미지원
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
    if (!selectedPrjctId) {
      toast.error("프로젝트를 선택해 주세요.");
      return;
    }

    setCreating(true);
    try {
      const res = await authFetch("/api/auth/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyName: newKeyName.trim(),
          keyUseSe,    // [2026-04-26] 'CLIENT' | 'WORKER'
          prjctId: selectedPrjctId,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setCreatedRawKey(body.data.rawKey);
        setCreatedKeyUseSe(keyUseSe);
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

  // 용도별 연결 스니펫 — CLIENT는 .mcp.json 통째로, WORKER는 .env.local용 두 줄
  // origin은 지금 접속 중인 도메인(로컬/스테이징/운영) 그대로 사용해야 발급받은 프로젝트에 맞게 연결됨
  const buildConnectionSnippet = (useSe: KeyUseSe, rawKey: string): string => {
    const origin = window.location.origin;
    if (useSe === "CLIENT") {
      return JSON.stringify(
        {
          mcpServers: {
            specode: {
              type: "http",
              url: `${origin}/api/mcp`,
              headers: { Authorization: `Bearer ${rawKey}` },
            },
          },
        },
        null,
        2,
      );
    }
    return `SPECODE_URL=${origin}\nSPECODE_WORKER_KEY=${rawKey}`;
  };

  const handleCopyConfig = async () => {
    if (!createdRawKey) return;
    await navigator.clipboard.writeText(buildConnectionSnippet(createdKeyUseSe, createdRawKey));
    setConfigCopied(true);
    toast.success("연결 설정이 클립보드에 복사되었습니다.");
    setTimeout(() => setConfigCopied(false), 2000);
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
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="sp-btn sp-btn-secondary"
            onClick={() => setShowGuide((v) => !v)}
            style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
          >
            {showGuide ? "연결 방법 접기" : "🔗 연결 방법 보기"}
          </button>
          <button
            className="sp-btn sp-btn-primary"
            onClick={() => { setShowCreate(true); setCreatedRawKey(null); }}
            style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
          >
            + 키 생성
          </button>
        </div>
      </div>

      {/* 상시 연결 가이드 — 이미 발급된 키는 원문을 다시 볼 수 없어(보안 정책)
          생성 직후 배너만으로는 재방문 사용자에게 설명이 되지 않는다.
          그래서 실제 키 값 없이도 붙여넣을 수 있는 플레이스홀더 스니펫을 상시 제공한다. */}
      {showGuide && (
        <div style={{
          padding: "16px",
          background: "var(--color-bg-info, #e3f2fd)",
          border: "1px solid var(--color-border-info, #90caf9)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          <div>
            <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text-info, #1565c0)" }}>
              발급받은 키, 어디에 어떻게 붙여넣나요?
            </p>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: "var(--text-sm)", color: "var(--color-text)", display: "flex", flexDirection: "column", gap: 4 }}>
              <li>위 &quot;+ 키 생성&quot;으로 키를 만들면 원문이 <strong>그 순간 한 번만</strong> 화면에 표시됩니다. 재조회는 불가능하니 그때 복사하세요.</li>
              <li>연결하려는 곳에 맞춰 아래 방식 중 하나로 붙여넣습니다.</li>
            </ol>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: "var(--text-sm)", fontWeight: 500 }}>Claude Code (다른 프로젝트 폴더)</p>
              <p style={{ margin: "0 0 6px", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                연결하려는 프로젝트 루트에 <code>.mcp.json</code> 파일로 저장하거나, Claude Code에게 아래 내용을 그대로 붙여넣고 &quot;MCP 연결해줘&quot;라고 요청하세요.
              </p>
              <pre style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--color-bg-subtle, #f5f5f5)",
                borderRadius: 4,
                fontSize: "var(--text-xs)",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}>
                {buildConnectionSnippet("CLIENT", "위에서 발급받은 spk_ 키")}
              </pre>
            </div>

            <div>
              <p style={{ margin: "0 0 4px", fontSize: "var(--text-sm)", fontWeight: 500 }}>Claude Desktop 앱</p>
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                설정 → Developer → Edit Config 에서 위와 같은 형식(<code>type: &quot;http&quot;</code>, <code>url</code>, <code>Authorization</code> 헤더)으로 추가합니다.
              </p>
            </div>

            <div>
              <p style={{ margin: "0 0 4px", fontSize: "var(--text-sm)", fontWeight: 500 }}>claude.ai (웹)</p>
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                설정 → Connectors → &quot;Add custom connector&quot;에서 엔드포인트 URL과 Bearer 토큰을 입력합니다.
              </p>
            </div>

            <div>
              <p style={{ margin: "0 0 4px", fontSize: "var(--text-sm)", fontWeight: 500 }}>CLI로 즉시 등록</p>
              <pre style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--color-bg-subtle, #f5f5f5)",
                borderRadius: 4,
                fontSize: "var(--text-xs)",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}>
                {`claude mcp add specode --transport http ${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp --header "Authorization: Bearer 위에서 발급받은 spk_ 키"`}
              </pre>
            </div>
          </div>
        </div>
      )}

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

          {/* 연결 설정 스니펫 — 소스가 없는 프로젝트에서도 그대로 붙여넣어 연결할 수 있도록 완성본 제공 */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-border-warning, #ffe082)" }}>
            <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: "var(--color-text)" }}>
              {createdKeyUseSe === "CLIENT"
                ? "연결하려는 프로젝트 폴더의 .mcp.json에 아래 내용을 저장하거나, Claude Code에게 그대로 붙여넣고 \"MCP 연결해줘\"라고 요청하세요."
                : "연결하려는 프로젝트 폴더의 .env.local에 아래 두 줄을 추가하세요. 이후 MCP가 연결된 Claude Code에서 get_worker_command_files 도구를 요청하면 /run-ai-tasks, /sync-specode 커맨드가 설치됩니다."}
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <pre style={{
                flex: 1,
                margin: 0,
                padding: "8px 12px",
                background: "var(--color-bg-subtle, #f5f5f5)",
                borderRadius: 4,
                fontSize: "var(--text-xs)",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}>
                {buildConnectionSnippet(createdKeyUseSe, createdRawKey)}
              </pre>
              <button
                className="sp-btn sp-btn-secondary"
                onClick={handleCopyConfig}
                style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
              >
                {configCopied ? "복사됨" : "복사"}
              </button>
            </div>
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

          {/* [2026-04-26] 키 용도 선택 — Claude Code MCP / 워커 채널 분리 */}
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>
              사용 용도
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "var(--text-sm)" }}>
                <input
                  type="radio"
                  name="keyUseSe"
                  value="CLIENT"
                  checked={keyUseSe === "CLIENT"}
                  onChange={() => setKeyUseSe("CLIENT")}
                />
                <span>
                  <strong>Claude Code (MCP 도구)</strong>
                  {" "}- Claude Code 등 외부 AI 클라이언트에서 SPECODE MCP 호출용
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "var(--text-sm)" }}>
                <input
                  type="radio"
                  name="keyUseSe"
                  value="WORKER"
                  checked={keyUseSe === "WORKER"}
                  onChange={() => setKeyUseSe("WORKER")}
                />
                <span>
                  <strong>워커 (run-ai-tasks)</strong>
                  {" "}- AI 태스크 처리 워커용. 프로젝트 scope 필수, 전역 발급 불가
                </span>
              </label>
            </div>
          </div>

          {/* 프로젝트 선택 — 모든 키는 단일 프로젝트 scope 필수 */}
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>
              프로젝트
              <span style={{ marginLeft: 8, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", fontWeight: 400 }}>
                (이 키는 선택한 프로젝트에서만 동작합니다)
              </span>
            </label>
            <select
              value={selectedPrjctId}
              onChange={(e) => setSelectedPrjctId(e.target.value)}
              style={{
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
              disabled={creating || !newKeyName.trim() || !selectedPrjctId}
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
                  {/* [2026-04-26] 용도 배지 — Claude Code(CLIENT) vs 워커(WORKER) 구분 */}
                  <span className="sp-badge" style={{
                    fontSize: "var(--text-xs)",
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: k.keyUseSe === "WORKER"
                      ? "var(--color-bg-success, #e8f5e9)"
                      : "var(--color-bg-info, #e3f2fd)",
                    color: k.keyUseSe === "WORKER"
                      ? "var(--color-text-success, #2e7d32)"
                      : "var(--color-text-info, #1565c0)",
                    fontWeight: 500,
                  }}>
                    {k.keyUseSe === "WORKER" ? "🤖 워커" : "🧠 Claude Code"}
                  </span>
                  {/* Scope 배지 */}
                  {k.prjctId ? (
                    <span className="sp-badge" style={{
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
                    <span className="sp-badge" style={{
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

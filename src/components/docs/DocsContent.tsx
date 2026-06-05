"use client";

/**
 * DocsContent — 페이지 본문 + 페이저 + 메타 (Markdown 렌더링)
 *
 * 역할:
 *   - /api/docs/[section]/[page] 응답을 받아 사용자에게 표시
 *   - 본문은 react-markdown + remark-gfm 으로 렌더링 (표/체크박스/링크 등 GFM 지원)
 *   - 상단: 섹션 → 페이지 브레드크럼 + 배지
 *   - 하단: 마지막 갱신일 + 이전/다음 페이저
 *
 * 디자인:
 *   - 모든 색·간격은 semantic 토큰 — 3테마(다크/라이트/dark-purple) 자동 대응
 *   - 코드블록은 시맨틱 한 단계 어두운 배경(--color-bg-elevated) + 모노폰트
 *   - 인라인 코드는 약한 강조 (배경색만)
 *   - 콜아웃(>)은 좌측 strip + 약한 배경
 *
 * 보안:
 *   - 기본 react-markdown 은 raw HTML 차단 (rehype-raw 미사용) → XSS 안전
 *   - 외부 링크는 rel="noopener noreferrer" 강제
 */

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ReactNode } from "react";

// API 응답 타입 — /api/docs/[section]/[page] 와 동일 구조
type DocsAttachment = {
  fileId:      string;
  fileName:    string;
  fileSize:    number;
  extension:   string;
  downloadUrl: string;
};

type DocsPageDetail = {
  page: {
    pageId:      string;
    pageSj:      string;
    pageExcerpt: string | null;
    contentMd:   string;
    badgeCode:   string | null;
    lastUpdated: string;       // ISO string
  };
  section: {
    sectSlug: string;
    sectNm:   string;
  };
  // 페이지 하단 다운로드 첨부 (INLINE 이미지는 본문 markdown 에 이미 포함)
  // 구버전 API 응답 호환을 위해 optional
  attachments?: DocsAttachment[];
  prev: { sectSlug: string; pageSlug: string; pageSj: string } | null;
  next: { sectSlug: string; pageSlug: string; pageSj: string } | null;
};

const BADGE_STYLE: Record<string, { bg: string; color: string }> = {
  NEW:        { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
  BETA:       { bg: "var(--color-info-subtle)",    color: "var(--color-info)" },
  DEPRECATED: { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
};

export default function DocsContent({ data }: { data: DocsPageDetail }) {
  const { page, section, prev, next } = data;
  const attachments = data.attachments ?? [];

  return (
    <article
      style={{
        flex:         1,
        overflowY:    "auto",
        padding:      "48px 64px 96px",
        // 본문 면은 card 레이어 — light=흰색(#fff)으로 깔끔하게, dark/dark-purple 에서는
        // root 와 같은 톤이라 패널이 떠 보이지 않음. (surface 는 dark 에서 root 보다 밝아 부적합)
        background:   "var(--color-bg-card)",
        // 본문은 가독성 위해 폭 제한 — 너무 넓으면 한 줄이 길어 읽기 피로
        // 단, 표/이미지가 있을 수 있어 max-width 만, width 는 자유
        maxWidth:     "100%",
        boxSizing:    "border-box",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* 상단 — 섹션 브레드크럼 */}
        <nav
          aria-label="문서 위치"
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        6,
            marginBottom: 16,
            // 브레드크럼은 보조 정보 — 작고 옅게, 본문 위에서 조용히 위치만 알림
            fontSize:   "var(--text-xs)",
            fontWeight: 600,
            letterSpacing: "0.02em",
            color:      "var(--color-text-tertiary)",
          }}
        >
          <Link
            href="/docs"
            style={{ color: "var(--color-text-tertiary)", textDecoration: "none" }}
          >
            DOCS
          </Link>
          <span>›</span>
          <span>{section.sectNm}</span>
        </nav>

        {/* 페이지 제목 + 배지 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h1
            style={{
              margin:   0,
              // 큰 제목 — 표준 docs 헤더 느낌. 작고 빽빽한 인상 제거.
              fontSize: "var(--text-3xl, 30px)",
              fontWeight: 700,
              color:    "var(--color-text-heading)",
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
            }}
          >
            {page.pageSj}
          </h1>
          {page.badgeCode && <PageBadge code={page.badgeCode} />}
        </div>

        {/* 한 줄 요약 (있으면) — 제목 아래 리드 문장 */}
        {page.pageExcerpt && (
          <p style={{
            margin:    "0 0 32px",
            fontSize:  "var(--text-lg)",
            color:     "var(--color-text-secondary)",
            lineHeight: 1.65,
          }}>
            {page.pageExcerpt}
          </p>
        )}

        {/* 구분선 — 본문 시작을 가르는 옅은 선 (요약 없을 때만 살짝 띄움) */}
        <hr style={{
          border:     "none",
          borderTop:  "1px solid var(--color-border-subtle)",
          margin:     page.pageExcerpt ? "0 0 32px" : "20px 0 32px",
        }} />

        {/* 본문 — Markdown */}
        <div className="sp-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // 헤딩
              h1: ({ children }) => <h1 style={H1}>{children}</h1>,
              h2: ({ children }) => <h2 style={H2}>{children}</h2>,
              h3: ({ children }) => <h3 style={H3}>{children}</h3>,
              h4: ({ children }) => <h4 style={H4}>{children}</h4>,

              // 단락 / 강조
              p:      ({ children }) => <p style={P}>{children}</p>,
              strong: ({ children }) => <strong style={STRONG}>{children}</strong>,
              em:     ({ children }) => <em style={EM}>{children}</em>,

              // 리스트
              ul: ({ children }) => <ul style={UL}>{children}</ul>,
              ol: ({ children }) => <ol style={OL}>{children}</ol>,
              li: ({ children }) => <li style={LI}>{children}</li>,

              // 인용 (콜아웃)
              blockquote: ({ children }) => <blockquote style={QUOTE}>{children}</blockquote>,

              // 코드
              code: ({ className, children, ...props }) => {
                // 언어 정보 (예: language-bash) 가 있으면 fenced(블록) 으로 간주
                // react-markdown 은 inline 인지 판별을 className 유무로 한다
                const isInline = !className;
                if (isInline) {
                  return <code style={INLINE_CODE} {...props}>{children}</code>;
                }
                // 블록 코드 — pre 안에 들어가므로 여기서는 그대로 통과
                return <code className={className} {...props}>{children}</code>;
              },
              pre: ({ children }) => <pre style={PRE}>{children}</pre>,

              // 표
              table:    ({ children }) => <div style={TABLE_WRAP}><table style={TABLE}>{children}</table></div>,
              thead:    ({ children }) => <thead style={THEAD}>{children}</thead>,
              tr:       ({ children }) => <tr style={TR}>{children}</tr>,
              th:       ({ children }) => <th style={TH}>{children}</th>,
              td:       ({ children }) => <td style={TD}>{children}</td>,

              // 링크 — 외부 링크는 새창
              a: ({ href, children }) => {
                const isExternal = !!href && /^https?:\/\//.test(href);
                return (
                  <a
                    href={href}
                    style={LINK}
                    {...(isExternal
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {children as ReactNode}
                  </a>
                );
              },

              // 수평선
              hr: () => <hr style={HR} />,

              // 이미지 — `<img src>` 는 Authorization 헤더를 못 보내므로 직접
              // fetch 후 blob URL 로 교체 (기존 프로젝트의 AuthThumb 동일 패턴).
              // 외부 URL(http*)은 그대로 두고, 내부 API URL 만 인증 처리.
              img: ({ src, alt }) => {
                const url = typeof src === "string" ? src : "";
                if (!url) return null;
                const isExternal = /^https?:\/\//.test(url);
                if (isExternal) {
                  // 외부 이미지는 그대로 — Next.js Image 안 쓰는 이유는 콘텐츠가 가변(미지의 출처)
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img src={url} alt={alt ?? ""} style={IMG} />;
                }
                return <AuthImage src={url} alt={alt ?? ""} />;
              },
            }}
          >
            {page.contentMd}
          </ReactMarkdown>
        </div>

        {/* 다운로드 첨부 — 본문 끝, 페이저 위에 배치 */}
        {attachments.length > 0 && (
          <section style={{
            marginTop:  32,
            padding:    "16px 18px",
            background: "var(--color-bg-card)",
            border:     "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
          }}>
            <div style={{
              fontSize:    "var(--text-sm)",
              fontWeight:  600,
              color:       "var(--color-text-heading)",
              marginBottom: 10,
            }}>
              📎 첨부파일 ({attachments.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {attachments.map((a) => (
                <button
                  key={a.fileId}
                  // 다운로드도 Authorization 헤더가 필요해 onClick 으로 인증 다운로드.
                  // <a href> 직접 클릭은 토큰 못 붙어 401.
                  onClick={() => downloadAuthFile(a.downloadUrl, a.fileName)}
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "space-between",
                    padding:        "8px 12px",
                    background:     "var(--color-bg-elevated)",
                    border:         "1px solid var(--color-border-subtle)",
                    borderRadius:   "var(--radius-sm)",
                    color:          "var(--color-text-primary)",
                    textAlign:      "left",
                    cursor:         "pointer",
                    width:          "100%",
                  }}
                >
                  <span style={{
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                    fontSize:     "var(--text-sm)",
                    fontWeight:   500,
                  }}>
                    {a.fileName}
                  </span>
                  <span style={{
                    flexShrink: 0,
                    marginLeft: 12,
                    fontSize:   "var(--text-xs)",
                    color:      "var(--color-text-tertiary)",
                  }}>
                    {formatBytes(a.fileSize)} · {a.extension.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 메타 — 마지막 갱신 */}
        <div style={{
          marginTop:  40,
          paddingTop: 16,
          borderTop:  "1px solid var(--color-border-subtle)",
          fontSize:   "var(--text-sm)",
          color:      "var(--color-text-tertiary)",
        }}>
          마지막 갱신: {formatDate(page.lastUpdated)}
        </div>

        {/* 페이저 — 이전/다음 (같은 섹션 내) */}
        {(prev || next) && (
          <div style={{
            marginTop:    24,
            display:      "grid",
            gridTemplateColumns: "1fr 1fr",
            gap:          12,
          }}>
            {prev ? (
              <PagerLink direction="prev" sectSlug={prev.sectSlug} pageSlug={prev.pageSlug} pageSj={prev.pageSj} />
            ) : <div />}
            {next ? (
              <PagerLink direction="next" sectSlug={next.sectSlug} pageSlug={next.pageSlug} pageSj={next.pageSj} />
            ) : <div />}
          </div>
        )}
      </div>
    </article>
  );
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function PageBadge({ code }: { code: string }) {
  const s = BADGE_STYLE[code] ?? {
    bg: "var(--color-bg-elevated)", color: "var(--color-text-tertiary)",
  };
  return (
    <span style={{
      fontSize:     "var(--text-xs)",
      fontWeight:   700,
      padding:      "2px 8px",
      borderRadius: "var(--radius-sm)",
      background:   s.bg,
      color:        s.color,
      letterSpacing:"0.04em",
    }}>
      {code}
    </span>
  );
}

function PagerLink({
  direction, sectSlug, pageSlug, pageSj,
}: {
  direction: "prev" | "next";
  sectSlug:  string;
  pageSlug:  string;
  pageSj:    string;
}) {
  const isPrev = direction === "prev";
  return (
    <Link
      href={`/docs/${sectSlug}/${pageSlug}`}
      style={{
        display:        "flex",
        flexDirection:  "column",
        gap:            4,
        padding:        "14px 18px",
        textAlign:      isPrev ? "left" : "right",
        textDecoration: "none",
        background:     "var(--color-bg-card)",
        border:         "1px solid var(--color-border-subtle)",
        borderRadius:   "var(--radius-card)",
        transition:     "border-color 0.15s, background 0.15s",
      }}
    >
      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
        {isPrev ? "← 이전" : "다음 →"}
      </span>
      <span style={{
        fontSize:   "var(--text-md)",
        fontWeight: 600,
        color:      "var(--color-text-primary)",
      }}>
        {pageSj}
      </span>
    </Link>
  );
}

// ── 인증된 이미지 컴포넌트 ─────────────────────────────────────────────────
// 브라우저는 <img src> 요청에 Authorization 헤더를 못 붙이므로,
// fetch 로 인증 + Blob URL 변환 후 표시. 기존 AreaAttachFiles.AuthThumb 와 동일 패턴.
function AuthImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [failed,  setFailed]  = useState<boolean>(false);

  useEffect(() => {
    const at = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
    let url = "";
    let cancelled = false;

    fetch(src, { headers: at ? { Authorization: `Bearer ${at}` } : {} })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        } else {
          setFailed(true);
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (failed) {
    return (
      <span style={{
        display: "inline-block",
        padding: "8px 12px",
        fontSize: "var(--text-xs)",
        color: "var(--color-error)",
        background: "var(--color-error-subtle)",
        border: "1px dashed var(--color-error-border)",
        borderRadius: "var(--radius-sm)",
      }}>
        🖼 이미지를 불러올 수 없습니다 ({alt || "이미지"})
      </span>
    );
  }

  if (!blobUrl) {
    // 로딩 중 — placeholder 박스
    return (
      <span style={{
        display: "inline-block",
        width: "100%",
        height: 120,
        background: "var(--color-bg-elevated)",
        borderRadius: "var(--radius-sm)",
      }} aria-label={`${alt} 로딩 중`} />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={blobUrl} alt={alt} style={IMG} />;
}

// ── 인증된 파일 다운로드 ─────────────────────────────────────────────────────
// <a href> 직접 클릭은 토큰을 못 붙이므로 fetch 로 받아 blob 만들고 임시 anchor 클릭.
async function downloadAuthFile(url: string, suggestedFileName: string) {
  try {
    const at =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("access_token") ?? "")
        : "";

    const res = await fetch(url, {
      headers: at ? { Authorization: `Bearer ${at}` } : {},
    });
    if (!res.ok) {
      // 서버 에러 메시지 우선 노출
      const err = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(err.message ?? `다운로드 실패 (${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    // 임시 anchor 로 다운로드 트리거 — DOM 에 잠깐 붙였다 떼는 방식이 가장 호환성 좋음
    const a = document.createElement("a");
    a.href     = blobUrl;
    a.download = suggestedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    toast.error((e as Error).message || "다운로드에 실패했습니다.");
  }
}

// ── 바이트 포맷 ───────────────────────────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── 날짜 포맷 ────────────────────────────────────────────────────────────
// "2026-05-07" 형태로 사용자에게 보여줌. ISO 의 시·분은 사용자에게 정보가치 낮음.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Markdown 요소 스타일 (모두 토큰 기반) ───────────────────────────────
// 인라인 객체로 정의 — components.css 오염 방지 + 스타일 추적 쉬움
// 본문 타이포는 표준 docs 스케일로 — 제목은 크게, 본문은 14px + 넉넉한 행간.
// 헤딩 위 여백을 크게 둬서 섹션이 시각적으로 분리되도록(빽빽함 제거).
const H1: React.CSSProperties = {
  margin:    "48px 0 16px",
  fontSize:  "var(--text-2xl, 24px)",
  fontWeight:700,
  color:     "var(--color-text-heading)",
  lineHeight:1.3,
  letterSpacing: "-0.01em",
};
const H2: React.CSSProperties = {
  margin:     "44px 0 14px",
  fontSize:   "var(--text-xl, 20px)",
  fontWeight: 700,
  color:      "var(--color-text-heading)",
  lineHeight: 1.35,
  letterSpacing: "-0.01em",
};
const H3: React.CSSProperties = {
  margin:    "32px 0 10px",
  fontSize:  "var(--text-lg, 16px)",
  fontWeight:700,
  color:     "var(--color-text-heading)",
  lineHeight:1.4,
};
const H4: React.CSSProperties = {
  margin:    "24px 0 8px",
  fontSize:  "var(--text-md, 14px)",
  fontWeight:700,
  color:     "var(--color-text-heading)",
};
const P: React.CSSProperties = {
  margin:    "14px 0",
  fontSize:  "var(--text-lg)",
  color:     "var(--color-text-primary)",
  lineHeight:1.8,
};
const STRONG: React.CSSProperties = { fontWeight: 700, color: "var(--color-text-heading)" };
const EM:     React.CSSProperties = { fontStyle: "italic" };

const UL: React.CSSProperties = { margin: "14px 0", paddingLeft: 26, color: "var(--color-text-primary)" };
const OL: React.CSSProperties = { margin: "14px 0", paddingLeft: 26, color: "var(--color-text-primary)" };
const LI: React.CSSProperties = { margin: "6px 0", lineHeight: 1.8, fontSize: "var(--text-lg)" };

// 콜아웃 — 본문 면(card)과 대비되는 한 단계 raised 면 + 좌측 브랜드 스트립.
const QUOTE: React.CSSProperties = {
  margin:       "20px 0",
  padding:      "12px 18px",
  borderLeft:   "3px solid var(--color-brand)",
  background:   "var(--color-bg-elevated)",
  color:        "var(--color-text-secondary)",
  borderRadius: "var(--radius-sm)",
};

// 인라인 코드 — 본문 면 위에서 옅은 칩으로(elevated). 테두리 없이 배경만(깔끔).
const INLINE_CODE: React.CSSProperties = {
  padding:      "2px 6px",
  fontSize:     "0.88em",
  fontFamily:   "var(--font-mono)",
  background:   "var(--color-bg-elevated)",
  color:        "var(--color-text-primary)",
  borderRadius: "var(--radius-sm)",
};

// 코드블록 — 본문 면보다 한 단계 raised(elevated) + 옅은 테두리. radius 키워 부드럽게.
const PRE: React.CSSProperties = {
  margin:       "20px 0",
  padding:      "16px 18px",
  fontFamily:   "var(--font-mono)",
  fontSize:     "var(--text-sm)",
  lineHeight:   1.7,
  background:   "var(--color-bg-elevated)",
  color:        "var(--color-text-primary)",
  border:       "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-card)",
  overflowX:    "auto",
};

const TABLE_WRAP: React.CSSProperties = {
  margin:       "20px 0",
  overflowX:    "auto",
  border:       "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-card)",
};
const TABLE: React.CSSProperties = {
  width:          "100%",
  borderCollapse: "collapse",
  fontSize:       "var(--text-md)",
};
const THEAD: React.CSSProperties = { background: "var(--color-bg-elevated)" };
const TR:    React.CSSProperties = { borderBottom: "1px solid var(--color-border-subtle)" };
const TH:    React.CSSProperties = {
  padding:    "10px 14px",
  textAlign:  "left",
  fontWeight: 600,
  color:      "var(--color-text-heading)",
};
const TD:    React.CSSProperties = {
  padding:  "10px 14px",
  color:    "var(--color-text-primary)",
};

const LINK: React.CSSProperties = {
  color:       "var(--color-brand)",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

const HR: React.CSSProperties = {
  border:    "none",
  borderTop: "1px solid var(--color-border-subtle)",
  margin:    "32px 0",
};

const IMG: React.CSSProperties = {
  display:      "block",
  maxWidth:     "100%",
  height:       "auto",
  margin:       "16px 0",
  borderRadius: "var(--radius-sm)",
  border:       "1px solid var(--color-border-subtle)",
};

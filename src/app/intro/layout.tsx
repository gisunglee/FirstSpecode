/**
 * IntroLayout — 퍼블릭 인트로(랜딩) 공용 레이아웃 (/intro, /intro/about)
 *
 * 역할:
 *   - 두 인트로 페이지(요약/전체)가 공유하는 폰트·스타일을 한 곳에서 로드
 *   - Claude Design 핸드오프 원본이 쓰던 Pretendard + IBM Plex Mono 웹폰트를 주입
 *   - 인트로 전용 스코프 스타일(intro.css) 적용
 *
 * 참고:
 *   - /intro 는 (auth)/(main) 그룹 밖에 있어 앱 크롬 없이 루트 레이아웃만 거친다.
 *   - <link rel="stylesheet"> 는 Next.js가 <head>로 호이스팅·중복제거한다.
 */

import type { ReactNode } from "react";
import "./intro.css";

export default function IntroLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* 원본 디자인 폰트 — Pretendard(본문) · IBM Plex Mono(라벨/모노) */}
      <link rel="preconnect" href="https://cdn.jsdelivr.net" />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      />
      {children}
    </>
  );
}

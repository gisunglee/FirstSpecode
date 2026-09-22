/**
 * IntroLayout — 퍼블릭 인트로(랜딩) 공용 레이아웃 (/intro, /intro/about)
 *
 * 역할:
 *   - 두 인트로 페이지(요약/전체)가 공유하는 폰트·스타일을 한 곳에서 로드
 *   - 소개 화면 전반에서 사용하는 Pretendard 웹폰트를 주입
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
      {/* 한글과 영문이 섞인 라벨까지 같은 인상으로 보이도록 Pretendard로 통일한다. */}
      <link rel="preconnect" href="https://cdn.jsdelivr.net" />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
      />
      {children}
    </>
  );
}

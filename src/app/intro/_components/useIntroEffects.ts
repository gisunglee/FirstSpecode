/**
 * useIntroEffects — 인트로 페이지 공용 스크롤 인터랙션 훅
 *
 * 역할 (원본 app.js의 공통 동작을 React로 포팅):
 *   - 스크롤 시 상단 NAV를 solid 상태로 전환 (.nav.solid)
 *   - 히어로를 지나면 하단 스티키 도크 노출, 푸터 근처에서 숨김 (.dock.show)
 *   - 뷰포트에 들어온 .reveal 요소에 .in 클래스 부여 (등장 애니메이션)
 *
 * 모든 DOM 질의는 전달받은 rootRef(.sp-intro) 내부로 한정한다.
 */

import { useEffect, type RefObject } from "react";

// 도크가 푸터 근처에서 숨겨지기 시작하는 하단 여유 거리(px) — 원본 값 유지
const DOCK_HIDE_NEAR_END = 520;
// NAV가 solid로 바뀌는 스크롤 임계값(px)
const NAV_SOLID_THRESHOLD = 40;

export function useIntroEffects(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const nav = root.querySelector<HTMLElement>(".nav");
    const dock = root.querySelector<HTMLElement>(".dock");
    const hero = root.querySelector<HTMLElement>(".hero");

    function onScroll() {
      const y = window.scrollY;
      if (nav) nav.classList.toggle("solid", y > NAV_SOLID_THRESHOLD);

      // 도크: 히어로 80%를 지나면 노출하되, 문서 끝(푸터)에 가까우면 숨김
      if (dock && hero) {
        const past = y > hero.offsetHeight * 0.8;
        const nearEnd =
          window.innerHeight + y > document.body.offsetHeight - DOCK_HIDE_NEAR_END;
        dock.classList.toggle("show", past && !nearEnd);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // 초기 상태 반영

    // 뷰포트 진입 시 1회만 .in 부여 후 관찰 해제
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );
    root.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
    };
  }, [rootRef]);
}

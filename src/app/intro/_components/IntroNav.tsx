/**
 * IntroNav — 인트로(공개) 사이트 공용 상단 내비게이션
 *
 * 역할:
 *   - 브랜드 로고(→ /intro), "소개"·"요금제" 링크, "이용하기" 버튼
 *   - 현재 페이지 링크는 is-active 로 강조
 *
 * 동작:
 *   - 스크롤 시 .nav.solid 전환은 useIntroEffects 가 .nav 를 찾아 처리한다.
 *   - 히어로가 없는 서브 페이지(요금제·약관)는 `solid` 를 처음부터 켜서
 *     흰 배경 위에서 내비가 사라져 보이는 문제를 막는다.
 */

"use client";

import Link from "next/link";
import { INTRO_PATHS } from "./siteInfo";

type Props = {
  /** 현재 페이지 — 해당 링크를 강조 */
  active?: "about" | "pricing";
  /** 히어로 없는 서브 페이지에서 true — 처음부터 불투명 배경 */
  solid?: boolean;
};

export default function IntroNav({ active, solid = false }: Props) {
  return (
    <nav className={`nav${solid ? " solid is-static" : ""}`}>
      <div className="wrap">
        <Link href={INTRO_PATHS.home} className="brand" style={{ textDecoration: "none" }}>
          <span className="b-spec">SPE</span>
          <span className="b-code">CODE</span>
          <span className="b-dot" />
        </Link>
        <div className="nav-right">
          <Link
            href={INTRO_PATHS.about}
            className={`nav-tag${active === "about" ? " is-active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            소개
          </Link>
          <Link
            href={INTRO_PATHS.pricing}
            className={`nav-tag${active === "pricing" ? " is-active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            요금제
          </Link>
          <Link href={INTRO_PATHS.login} className="btn btn-primary btn-sm">
            이용하기 <span className="arr">→</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

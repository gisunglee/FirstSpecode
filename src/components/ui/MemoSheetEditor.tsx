"use client";

/**
 * MemoSheetEditor — 엑셀형 메모 편집기 (Fortune-sheet 래퍼)
 *
 * 역할:
 *   - 메모의 memo_ty_code="EXCEL"일 때 sheet_data(jsonb)를 편집/열람
 *   - 엑셀에서 복사한 셀 범위를 그대로 붙여넣기, 기본 서식/수식, 이미지 삽입 지원(Fortune-sheet 기본 기능)
 *   - readOnly 시 allowEdit=false로 툴바/편집을 막고 조회만 허용
 *
 * 주의 — data prop을 매 변경마다 갱신하면 안 됨:
 *   Fortune-sheet Workbook은 사실상 비제어 컴포넌트라, onChange로 받은 값을 그대로
 *   data prop에 되먹임하면 매 입력마다 내부 상태가 재초기화된다(방금 입력한 값/붙여넣은
 *   값이 사라지고 스크롤 위치도 튀는 현상으로 실제 확인됨). 그래서 data prop은 마운트
 *   시점 값으로 영구 고정한다.
 *
 * 주의 — 저장 시점에 getAllSheets()로 "꺼내오는" 방식도 불안정했음:
 *   버튼 클릭 시점에 마지막으로 입력 중이던 셀 편집이 아직 Fortune-sheet 내부 상태에
 *   커밋되기 전이면 getAllSheets()가 그 값을 놓친다(실제로 저장 시 방금 값이 사라지는
 *   증상 재현됨). 그래서 onChange를 계속 구독해서 "마지막으로 확정된 값"을 ref에
 *   쌓아두고, 저장 시엔 그 ref를 읽는다 — onChange는 state가 아닌 ref에만 써서 위의
 *   재초기화 루프를 다시 만들지 않는다(state로 만들면 리렌더 → data prop 재계산 위험).
 *
 * 주의 — ref 대신 onReady 콜백을 쓰는 이유:
 *   이 컴포넌트는 부모에서 next/dynamic(ssr:false)으로 로드된다. next/dynamic이 반환하는
 *   컴포넌트 타입은 forwardRef를 보장하지 않아 <MemoSheetEditor ref={...}>가 타입은
 *   통과해도 런타임에 실제로 연결되지 않을 수 있다. ref 대신 마운트 시 onReady(handle)을
 *   한 번 호출해 부모의 일반 변수(ref.current)에 담아두는 방식으로 우회한다.
 *
 * 주의 — 저장 직전 "편집 중인 셀"을 강제로 커밋해야 함, blur()만으로도 부족했음:
 *   셀에 값을 입력한 직후 바로 외부 저장 버튼을 클릭하면 그 편집이 아직 Fortune-sheet
 *   내부 데이터에 반영되기 전이라 놓친다. blur()를 걸어도 Fortune-sheet 내부적으로
 *   "셀 입력값 → 시트 데이터 커밋 → Workbook onChange 통지"가 같은 틱에 동기로
 *   끝난다는 보장이 없어(실제로 blur 이후 바로 읽어도 빈 값이 저장되는 게 재현됨),
 *   blur 후 한 틱 기다렸다가 getAllSheets()로 그 순간의 내부 상태를 직접 읽는다
 *   (onChange로 받아 쌓아둔 ref보다 이쪽이 더 즉시성 있는 소스로 판단됨).
 *   그래서 getData()는 Promise를 반환하고, 호출부에서 await해야 한다.
 *
 * 주의 — 마우스휠 "위로 스크롤"이 안 되는 건 Fortune-sheet 자체의 알려진 미해결 버그:
 *   https://github.com/ruilisi/fortune-sheet/issues/767 (v1.0.4, 우리 설치 버전과 동일).
 *   React 18 동시성 렌더링 중 라이브러리의 wheel 핸들러가 scrollbarY.scrollTop을 직접
 *   써주는데, 뒤이어 도는 재동기화 effect가 그 값을 stale한 context.scrollTop으로 다시
 *   덮어써서 "위로" 방향만 씹힌다(아래로는 우연히 타이밍이 맞아 정상 동작). 공식
 *   데모(storybook basic)에서도 재현되어 우리 코드 문제가 아님을 확인함.
 *   이슈에 제시된 우회법을 그대로 적용: capture 단계에서 위로 스크롤하는 wheel 이벤트를
 *   가로채 라이브러리의 실제 스크롤바 DOM(.luckysheet-scrollbar-y)의 scrollTop을 직접
 *   낮추고 stopImmediatePropagation()으로 라이브러리의 버그 있는 핸들러가 이어서 돌지
 *   못하게 막는다.
 */

import { useEffect, useMemo, useRef } from "react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import type { Sheet, CellWithRowAndCol } from "@fortune-sheet/core";

// 신규 메모의 초기 빈 시트 — Fortune-sheet는 data가 최소 1개 시트를 가져야 함
const EMPTY_SHEET: Sheet[] = [
  { name: "Sheet1", id: "sheet1", celldata: [], row: 40, column: 16, status: 1 },
];

// 기본 순서(가로/세로 정렬이 뒤쪽이라 좁은 폭에서 "..." 뒤로 자주 숨음)를 메모 용도에 맞게
// 재배치 — 굵게/기울임/밑줄 바로 다음에 정렬을 둬서 자주 쓰는 항목이 먼저 잘리지 않게 함.
//
// "image"는 반드시 앞쪽에 둬야 함(뒤로 밀면 안 됨) — 우클릭 메뉴 "Insert image"는 툴바의
// image 버튼 안에 숨겨진 <input type=file>을 클릭 트리거하는 방식이라, 그 버튼이 "..."
// 오버플로에 들어가 실제로 렌더링 안 되면 input 자체가 DOM에 없어서 아무 반응이 없다
// (실제 재현됨: 우클릭 → Insert image 눌러도 파일 선택창이 안 뜸).
// 잘 안 쓰는 고급 기능(조건부서식, 수식검색, 데이터검증, 열분할, 위치조건, 스크린샷)은 뒤로 보냄.
const TOOLBAR_ITEMS = [
  "undo", "redo", "format-painter", "clear-format", "image", "|",
  "bold", "italic", "strike-through", "underline", "|",
  "horizontal-align", "vertical-align", "text-wrap", "text-rotation", "|",
  "font-color", "background", "border", "merge-cell", "|",
  "font", "font-size", "|",
  "currency-format", "percentage-format", "number-decrease", "number-increase", "format", "|",
  "freeze", "filter", "link", "comment", "|",
  "conditionFormat", "quick-formula", "dataVerification", "splitColumn", "locationCondition", "screenshot", "search",
];

// getAllSheets()가 저장하는 형태는 data(행렬) 위주라 celldata가 비어있는 경우가 많은데,
// Workbook은 마운트 시 초기 셀 값을 celldata(평면 배열)에서 읽는 것으로 보인다 — data만
// 있고 celldata가 비어있으면 화면엔 빈 시트로 보이는 문제가 실제로 있었다. 그래서 로드
// 시점에 data → celldata를 직접 변환해서 채워준다.
function withCelldata(sheets: Sheet[]): Sheet[] {
  return sheets.map((sheet) => {
    if (sheet.celldata && sheet.celldata.length > 0) return sheet;
    if (!sheet.data) return sheet;
    const celldata: CellWithRowAndCol[] = [];
    sheet.data.forEach((row, r) => {
      (row ?? []).forEach((cell, c) => {
        if (cell) celldata.push({ r, c, v: cell });
      });
    });
    return { ...sheet, celldata };
  });
}

// 위로 스크롤 체이닝 우회용 — 시트가 맨 위에 닿았을 때 대신 스크롤시킬, 가장 가까운
// 스크롤 가능한 조상 요소를 찾는다. 모달(overflowY:auto 래퍼)이든 풀페이지(문서 자체)든
// 특정 DOM 구조를 가정하지 않고 동작하도록 일반적으로 탐색한다.
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export type MemoSheetEditorHandle = {
  // 저장 시점에 호출 — 편집 중인 셀을 커밋시키고 그 결과를 가져온다(비동기)
  getData: () => Promise<Sheet[]>;
};

type Props = {
  initialValue: unknown; // 마운트 시점의 sheet_data(jsonb). 이후 바뀌어도 재초기화하지 않음
  readOnly?:    boolean;
  height?:      number;
  onReady:      (handle: MemoSheetEditorHandle) => void;
};

export default function MemoSheetEditor({ initialValue, readOnly = false, height = 480, onReady }: Props) {
  const wbRef        = useRef<WorkbookInstance>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 마운트 시점 값으로 고정 — 의존성 배열을 비워 이후 initialValue가 바뀌어도 재계산하지 않음
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialData = useMemo<Sheet[]>(
    () => withCelldata(Array.isArray(initialValue) && initialValue.length > 0 ? (initialValue as Sheet[]) : EMPTY_SHEET),
    [],
  );

  // onChange가 확정해주는 최신 데이터를 담아두는 곳 — state가 아니라 ref라 리렌더를 유발하지 않음
  const latestDataRef = useRef<Sheet[]>(initialData);

  useEffect(() => {
    onReady({
      getData: () =>
        new Promise<Sheet[]>((resolve) => {
          // 편집 중이던 셀이 있으면 blur로 커밋을 유도
          const active = document.activeElement;
          if (active instanceof HTMLElement && containerRef.current?.contains(active)) {
            active.blur();
          }
          // blur → 내부 커밋 → 반영까지 한 틱 여유를 준 뒤 그 순간의 실제 상태를 직접 읽는다
          setTimeout(() => {
            resolve(wbRef.current?.getAllSheets() ?? latestDataRef.current);
          }, 120);
        }),
    });
    // 마운트 시 1회만 — onReady는 부모에서 매 렌더 새 함수로 넘어와도 재호출할 필요 없음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fortune-sheet#767 우회 + 스크롤 체이닝 — 시트 안에 그 방향으로 여지가 있으면 항상
  // 우리가 직접 scrollbarY.scrollTop을 밀어준다. 위로는 라이브러리 자체 버그(#767) 때문에
  // 원래도 직접 밀어줘야 했는데, 아래로는 라이브러리 자체 휠 핸들러에 맡겨뒀더니 위로
  // 스크롤할 때와 다르게 뚝뚝 끊기는(부드럽지 않은) 느낌이 실제로 있었다 — 그래서 방향
  // 상관없이 항상 같은 방식(raw deltaY를 그대로 scrollTop에 더함)으로 통일해 체감 속도를
  // 맞춘다. 시트가 그 방향으로 더 이상 여지가 없을 때(맨 위/맨 아래)만, 라이브러리
  // 핸들러가 이어서 돌며 무조건 preventDefault를 호출해 마우스가 시트 위에 있는 동안은
  // 바깥(모달/페이지) 스크롤이 전혀 먹지 않는 문제를 우회하려고, 가장 가까운 스크롤 가능한
  // 조상(모달 래퍼 또는 없으면 문서 자체)을 대신 스크롤시켜 자연스러운 체이닝을 흉내낸다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheelCapture(e: WheelEvent) {
      if (e.deltaY === 0) return; // 가로 스크롤은 건드리지 않음
      if (!container) return; // 중첩 함수라 TS가 위쪽 널 체크의 좁혀짐을 못 이어받아 재확인
      const scrollbarY = container.querySelector<HTMLElement>(".luckysheet-scrollbar-y");
      if (!scrollbarY) return;

      const maxSheetScrollTop = scrollbarY.scrollHeight - scrollbarY.clientHeight;
      const hasRoomInSheet = e.deltaY < 0 ? scrollbarY.scrollTop > 0 : scrollbarY.scrollTop < maxSheetScrollTop;

      if (hasRoomInSheet) {
        e.preventDefault();
        e.stopImmediatePropagation();
        scrollbarY.scrollTop = Math.min(maxSheetScrollTop, Math.max(0, scrollbarY.scrollTop + e.deltaY));
        return;
      }

      // 시트가 그 방향으로 이미 끝(맨 위/맨 아래) — 바깥 스크롤 컨테이너로 체이닝
      const outer = findScrollableAncestor(container);
      if (!outer) return;
      const maxOuterScrollTop = outer.scrollHeight - outer.clientHeight;
      const hasRoomOutside = e.deltaY < 0 ? outer.scrollTop > 0 : outer.scrollTop < maxOuterScrollTop;
      if (!hasRoomOutside) return; // 바깥도 이미 끝이면 그대로 둔다
      e.preventDefault();
      e.stopImmediatePropagation();
      outer.scrollTop = Math.min(maxOuterScrollTop, Math.max(0, outer.scrollTop + e.deltaY));
    }

    container.addEventListener("wheel", handleWheelCapture, { capture: true, passive: false });
    return () => container.removeEventListener("wheel", handleWheelCapture, { capture: true });
  }, []);

  return (
    // transform으로 별도 GPU 컴포지팅 레이어를 강제해 overflow:hidden 클리핑을 시트 캔버스와
    // 같은 레이어에서 동기화한다 — 위로 스크롤 우회 코드(위 useEffect)가 scrollTop을 강제로
    // 밀어붙일 때, 클리핑 레이어와 캔버스 페인트가 한 프레임 어긋나면서 컨테이너 경계
    // 안쪽 상단에 이전 프레임의 잔상 행이 겹쳐 보이는 현상이 실제로 있었다(스크롤을
    // 빠르게 위로 올릴 때 재현됨). translateZ(0)로 레이어를 분리하면 사라진다.
    <div
      ref={containerRef}
      style={{ height, border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", transform: "translateZ(0)" }}
    >
      <Workbook
        ref={wbRef}
        data={initialData}
        onChange={(d) => { latestDataRef.current = d; }}
        allowEdit={!readOnly}
        showToolbar={!readOnly}
        showFormulaBar={!readOnly}
        showSheetTabs
        toolbarItems={TOOLBAR_ITEMS}
        lang="en"
      />
    </div>
  );
}

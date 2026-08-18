/**
 * packages/layout-core/src/cycle.ts — LAYOUT §4 · L-04 · D-103
 *
 * **되돌아가는 엣지는 ELK 기하를 버리고 우측 사이드 레일로 직접 그린다.**
 *
 * ELK가 돌려주는 뒤집힌 엣지의 sections를 점 순서만 반대로 뒤집어 쓰는 게 가장
 * 싸고 노드 비관통도 보장된다. 그런데 결과가 이렇게 된다:
 *
 *     ┌──────────┐
 *     │ ③ 검토   │◄──┐   ← 화살표가 노드 **하단**으로 들어온다
 *     └──────────┘   │
 *     ┌──────────┐   │
 *     │ ⑥ 반려   │───┘   ← 선이 노드 **상단**에서 나간다
 *     └──────────┘
 *
 * "모든 화살표는 위에서 들어온다"는 전역 규칙이 깨지고, 12단계 문서에서 되돌아가는
 * 화살표 하나가 다른 규칙으로 그려지면 사용자는 그 선을 **읽는 데 실패한다.**
 *
 * 그래서 6점 폴리라인을 직접 만든다. 도쿄 지하철 노선도의 규율(DESIGN §10):
 * 되돌아가는 선은 본선 밖의 전용 궤도를 탄다.
 *
 *     ┌──────────┐                     railX
 *     │ ③ 검토   │                       │
 *     └──────────┘  ← 층간 거터 ─────────┤   p3→p4
 *          │              ╭──────────────╯
 *          ▼              │
 *     ┌──────────┐        │  ← bbox 오른쪽 밖. 노드가 있을 수 없다
 *     │ ⑥ 반려   │        │
 *     └──────────┘  ← 층간 거터 ─────────╯   p1→p2
 *
 * 그리고 **다섯 선분이 각각 층간 거터나 bbox 밖만 지난다는 것을 검증하는 함수**를
 * 함께 둔다 (`verifyBackEdgeRouting`). 증명은 ELK의 층 밴드 가정에 의존하고,
 * 그 가정은 ELK 버전이 바뀌면 깨질 수 있다. 증명은 런타임으로 재확인되어야 한다.
 */

import { EPS, bandIndexOf, segmentEntersRect, segments } from './geometry.ts';
import type { EdgeGeometry, LayerBand, NodePlacement, Rect, XY } from './types.ts';
import type { DerivedEdge, NodeId } from '@workflow/graph-core';

/** bbox 오른쪽 끝에서 첫 레일까지 */
export const RAIL_MARGIN = 32;
/** 레일 간격 */
export const RAIL_GAP = 20;
/** 층간 거터 안쪽으로 들어가는 깊이 (거터는 64px) */
export const GUTTER_IN = 20;
/** 노드 좌우 끝에서 안쪽으로. 정방향 포트(중앙)와 106px 떨어진다 */
export const PORT_INSET = 24;

export function routeBackEdges(
  back: readonly DerivedEdge[],
  place: ReadonlyMap<NodeId, NodePlacement>,
  bands: readonly LayerBand[],
  bbox: Rect,
): Map<string, EdgeGeometry> {
  // 1) 각 back edge가 세로로 점유하는 구간 [top, bottom]
  const spans = back.flatMap((e) => {
    const s = place.get(e.source);
    const t = place.get(e.target);
    if (!s || !t) return [];
    return [{ e, s, t, top: Math.min(t.y, s.y), bottom: Math.max(s.y + s.h, t.y + t.h) }];
  });

  // 2) 구간 겹침 = 다른 레일. 긴 구간부터 안쪽(작은 index)을 준다 —
  //    긴 루프가 바깥으로 밀리면 그림이 필요 이상으로 넓어진다.
  //    동점은 엣지 id로 깬다. **결정성이 곧 안정성이다.**
  const ordered = [...spans].sort(
    (a, b) => b.bottom - b.top - (a.bottom - a.top) || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0),
  );
  const railOf = new Map<string, number>();
  const occupied: Array<Array<[number, number]>> = [];
  for (const sp of ordered) {
    let i = 0;
    while (occupied[i]?.some(([lo, hi]) => sp.top < hi && lo < sp.bottom)) i++;
    (occupied[i] ??= []).push([sp.top, sp.bottom]);
    railOf.set(sp.e.id, i);
  }

  // 3) 6점 생성. 출력 순서는 입력(back) 순서를 따른다 — 레일 배정만 길이순이다.
  const out = new Map<string, EdgeGeometry>();
  for (const { e, s, t } of spans) {
    const railX = bbox.x + bbox.w + RAIL_MARGIN + RAIL_GAP * (railOf.get(e.id) ?? 0);
    const yOut = gutterBelow(bands, s);
    const yIn = gutterAbove(bands, t);
    const xOut = s.x + s.w - PORT_INSET;
    const xIn = t.x + t.w - PORT_INSET;

    out.set(e.id, {
      id: e.id,
      kind: 'back',
      reversedForLayout: true,
      // ↩ 글리프 자리 (§4.3). 대시는 쓰지 않는다 — hold의 점선 보더와 채널이 충돌한다
      labelAnchor: { x: railX, y: (yOut + yIn) / 2 },
      points: [
        { x: xOut, y: s.y + s.h }, // p0  s 하단에서 출발
        { x: xOut, y: yOut }, //       p1  거터로 내려감
        { x: railX, y: yOut }, //      p2  거터를 타고 오른쪽으로
        { x: railX, y: yIn }, //       p3  레일을 타고 위로
        { x: xIn, y: yIn }, //         p4  거터를 타고 왼쪽으로
        { x: xIn, y: t.y }, //         p5  t 상단으로 진입 (화살표)
      ],
    });
  }
  return out;
}

/**
 * 거터 y좌표.
 *
 * 명세(§4.2)는 `min(band.bottom + 20, next.top - 8)`을 쓰는데, 두 밴드가 서로
 * **닿아 있으면**(next.top === band.bottom) 결과가 밴드 **안쪽**으로 8px 들어가
 * 노드를 관통한다. 거터 폭이 64px인 정상 상황에서는 드러나지 않지만, 검증 함수를
 * 쓰는 이상 조용히 틀린 식을 남길 이유가 없다. 항상 `[bottom, next.top]` 구간
 * 안에 남도록 클램프한다.
 */
export function gutterBelow(bands: readonly LayerBand[], n: NodePlacement): number {
  const i = bandIndexOf(bands, n);
  const b = bands[i];
  if (!b) return n.y + n.h + GUTTER_IN;
  const next = bands[i + 1];
  const hi = next ? next.top : b.bottom + GUTTER_IN * 2; // 마지막 층이면 아래는 자유공간
  return b.bottom + Math.min(GUTTER_IN, (hi - b.bottom) / 2);
}

export function gutterAbove(bands: readonly LayerBand[], n: NodePlacement): number {
  const i = bandIndexOf(bands, n);
  const b = bands[i];
  if (!b) return n.y - GUTTER_IN;
  const prev = bands[i - 1];
  const lo = prev ? prev.bottom : b.top - GUTTER_IN * 2;
  return b.top - Math.min(GUTTER_IN, (b.top - lo) / 2);
}

/* ────────────────────────────────────────────────────────────────────────
 * 노드 비관통 검증 — §4.2의 표를 런타임으로 재확인한다
 *
 * | 선분 | 위치 | 왜 안전한가 |
 * |---|---|---|
 * | p0→p1 | x = s.right−24, y ∈ [s.bottom, gutter] | s 자신의 열 안, s의 층 아래 |
 * | p1→p2 | y = gutter | 층간 거터는 폭 전체에 걸쳐 노드가 없다 |
 * | p2→p3 | x = railX ≥ bbox.right+32 | bbox 정의상 오른쪽에 노드가 없다 |
 * | p3→p4 | y = gutter | 위와 동일 |
 * | p4→p5 | x = t.right−24, y ∈ [gutter, t.top] | t 자신의 열 안, t의 층 위 |
 *
 * **정방향 엣지와는 교차한다.** 그건 허용한다 — 금지된 건 "노드를 관통하는 엣지"지
 * 엣지 교차가 아니고, 되돌아가는 선이 본선을 가로지르는 건 의미상으로도 맞다.
 * ──────────────────────────────────────────────────────────────────────── */

export type RailViolation = {
  readonly edgeId: string;
  readonly kind: 'not-6-points' | 'not-axis-aligned' | 'pierces-node' | 'rail-inside-bbox' | 'not-top-entry' | 'not-bottom-exit';
  readonly detail: string;
};

export function verifyBackEdgeRouting(
  geo: EdgeGeometry,
  source: NodePlacement,
  target: NodePlacement,
  place: Iterable<NodePlacement>,
  bbox: Rect,
  tolerance = 1,
): RailViolation[] {
  const v: RailViolation[] = [];
  const pts = geo.points;
  const push = (kind: RailViolation['kind'], detail: string): void => {
    v.push({ edgeId: geo.id, kind, detail });
  };

  if (pts.length !== 6) {
    push('not-6-points', `사이드 레일은 6점이어야 한다 (받은 점 수: ${pts.length})`);
    return v;
  }
  const [p0, p1, p2, p3, p4, p5] = pts as unknown as [XY, XY, XY, XY, XY, XY];

  // 다섯 선분이 전부 축 정렬인가
  for (const [a, b] of segments(pts)) {
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      push('not-axis-aligned', `대각 선분 (${a.x},${a.y})→(${b.x},${b.y})`);
    }
  }

  // p0: s 하단에서 출발 / p5: t 상단으로 진입
  if (Math.abs(p0.y - (source.y + source.h)) > tolerance) {
    push('not-bottom-exit', `p0.y=${p0.y} ≠ source.bottom=${source.y + source.h}`);
  }
  if (Math.abs(p5.y - target.y) > tolerance || p5.x < target.x - tolerance || p5.x > target.x + target.w + tolerance) {
    push('not-top-entry', `p5=(${p5.x},${p5.y})가 target 상단 변 위에 없다`);
  }
  if (p4.y > p5.y - EPS && Math.abs(p4.y - p5.y) < EPS) {
    push('not-top-entry', '진입 선분의 길이가 0이다 — 화살표 방향이 정의되지 않는다');
  }

  // p2→p3 레일은 bbox 오른쪽 **밖**이어야 한다
  const railX = p2.x;
  if (railX < bbox.x + bbox.w + tolerance) {
    push('rail-inside-bbox', `railX=${railX} < bbox.right=${bbox.x + bbox.w}`);
  }
  if (Math.abs(p3.x - railX) > EPS) push('not-axis-aligned', '레일 세로 구간의 x가 일정하지 않다');

  // 다섯 선분 전부 노드 내부를 지나지 않는가.
  // 자기 자신(source/target)의 경계에 닿는 것은 관통이 아니므로 inset으로 흡수한다.
  for (const [a, b] of segments(pts)) {
    for (const n of place) {
      if (segmentEntersRect(a, b, n, tolerance)) {
        push('pierces-node', `선분 (${a.x},${a.y})→(${b.x},${b.y})가 노드 ${n.id}를 관통`);
      }
    }
  }
  return v;
}

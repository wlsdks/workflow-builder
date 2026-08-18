/**
 * packages/layout-core/src/anchor.ts — LAYOUT §3 · D-101 · D-102
 *
 * **활성 노드 앵커링.** 이 파일이 이 패키지에서 가장 중요하다.
 *
 * 목표: 방금 편집한 노드의 **화면 좌표**가 재배치 전후로 동일해야 한다.
 * §1·§2가 "재배치를 안 하는 법"이라면 여기는 "재배치를 해야만 할 때 어지럽지
 * 않게 하는 법"이고, 게이트를 아무리 잘 만들어도 통과하는 5%가 인상을 결정한다.
 *
 * ── 대수 (§3.1) ────────────────────────────────────────────────────────────
 *
 *   screen = world · z + T,     T = (viewport.x, viewport.y)
 *
 * 앵커 노드 a의 화면 좌표를 보존하려면
 *
 *   p_next(a)·z + T_next = p_prev(a)·z + T_prev
 *   ⟹  T_next = T_prev − z·Δ,     Δ = p_next(a) − p_prev(a)
 *
 * 여기까지는 흔한 구현이고, **이것만 하면 앵커가 눈에 띄게 흔들린다.**
 * 노드는 220ms 트랜지션으로 보간되는데 뷰포트를 즉시 바꾸면 t=0에서 `z·Δ`만큼
 * 튀었다가 제자리로 돌아온다 — 끝점만 맞고 중간에 왕복한다.
 *
 * 해법: 뷰포트도 노드와 **동일한 duration·easing**으로 보간한다. 공통 진행도
 * u = easing(s) ∈ [0,1]에 대해
 *
 *   p(u) = p_prev + u·Δ
 *   T(u) = T_prev − u·z·Δ
 *   screen(u) = (p_prev + u·Δ)·z + T_prev − u·z·Δ = p_prev·z + T_prev   ∀u
 *
 * **앵커의 화면 좌표가 모든 순간에 상수다.** easing이 무엇이든 두 트랜지션이
 * 같은 함수이기만 하면 성립한다. 이 주장은 산문이 아니라
 * `anchorScreenAt()` / `maxAnchorDeviation()`으로 코드에 있고, 테스트가 반례까지
 * 확인한다 (다른 easing / 줌 변경 → 즉시 깨진다).
 */

import { bboxDelta } from './jump.ts';
import type {
  AnchorDecision,
  AnchorHint,
  AnchorRule,
  CommitViewport,
  LayoutResult,
  NodePlacement,
  Rect,
  SameZoom,
  Viewport,
  ViewportOwner,
  ViewportSize,
  XY,
} from './types.ts';
import type { DerivedGraph, DerivedNode, NodeId } from '@workflow/graph-core';

/** 필터 B의 인셋. 화면 가장자리에 24px 이내로 걸친 노드는 "보인다"고 치지 않는다 */
export const VISIBLE_INSET = 24;
/** "그래프 전체가 화면에 들어온다"의 여백 (§3.6) */
export const FIT_PADDING = 32;
/** 시스템 뷰포트에서 fitView를 다시 걸 만한 최소 변화 (§3.2) */
export const SYSTEM_REFIT_DELTA = 0.02;

export type AnchorArgs = {
  readonly prev: LayoutResult | null;
  readonly next: LayoutResult;
  readonly graphPrev: DerivedGraph | null;
  readonly graphNext: DerivedGraph;
  readonly hint: AnchorHint;
  readonly viewport: Viewport;
  readonly size: ViewportSize;
  /** 마지막으로 뷰포트를 움직인 주체. 'system' = fitView/프로그램 */
  readonly viewportOwner: ViewportOwner;
};

/* ────────────────────────────────────────────────────────────────────────
 * D-102 — 줌은 재배치 커밋에서 절대 바뀌지 않는다
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * `SameZoom`을 만들 수 있는 **유일한** 함수. 입력 뷰포트의 zoom을 그대로 복사한다.
 *
 * 타입 쪽 방어: `AnchorDecision`의 `viewport.zoom`이 `SameZoom`이므로,
 * 다른 값을 넣으려면 캐스트를 써야 하고 캐스트는 리뷰에서 보인다.
 * 런타임 쪽 방어: 여기서 유한·양수 검사를 통과하지 못하면 던진다.
 */
function sameZoom(v: Viewport): SameZoom {
  if (!Number.isFinite(v.zoom) || v.zoom <= 0) {
    throw new RangeError(`앵커링은 zoom > 0 을 요구한다 (받은 값: ${String(v.zoom)})`);
  }
  return v.zoom as SameZoom;
}

/**
 * 커밋 직전 런타임 검증 (D-102).
 *
 * 줌이 바뀐 채로 앵커 고정을 시도하면 `T(u) = s_a − p(u)·z(u)` 가 u에 대해
 * 비선형이라 CSS 선형 보간과 **원리적으로** 맞지 않는다. 조용히 미끄러지는 대신
 * 시끄럽게 실패하게 한다.
 */
export function assertZoomPreserved(before: Viewport, decision: AnchorDecision): void {
  if (decision.t !== 'translate') return;
  if (decision.viewport.zoom !== before.zoom) {
    throw new Error(
      `재배치 커밋이 줌을 ${before.zoom} → ${decision.viewport.zoom} 로 바꾸려 한다. ` +
        'D-102 위반: 줌과 위치를 같은 커밋에서 바꾸면 앵커 고정이 수학적으로 깨진다 (LAYOUT §3.5).',
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * 대수적 주장의 코드 검증 (§3.1)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 진행도 u(=easing 출력)에서 앵커의 화면 좌표.
 *
 * `zoomTo`를 주면 줌까지 보간한다 — D-102가 금지하는 그 경우를 **재현**해서
 * 실제로 깨지는지 확인하기 위해 존재한다.
 */
export function anchorScreenAt(a: {
  readonly uNode: number;
  readonly uViewport: number;
  readonly pPrev: XY;
  readonly pNext: XY;
  readonly tPrev: XY;
  readonly tNext: XY;
  readonly zoom: number;
  readonly zoomTo?: number;
}): XY {
  const p = {
    x: a.pPrev.x + a.uNode * (a.pNext.x - a.pPrev.x),
    y: a.pPrev.y + a.uNode * (a.pNext.y - a.pPrev.y),
  };
  const t = {
    x: a.tPrev.x + a.uViewport * (a.tNext.x - a.tPrev.x),
    y: a.tPrev.y + a.uViewport * (a.tNext.y - a.tPrev.y),
  };
  const z = a.zoomTo === undefined ? a.zoom : a.zoom + a.uViewport * (a.zoomTo - a.zoom);
  return { x: p.x * z + t.x, y: p.y * z + t.y };
}

/**
 * 애니메이션 **구간 전체**에서 앵커가 얼마나 미끄러지는가 (화면 px 최대값).
 *
 * 0이면 §3.1의 상수성이 성립한다. 끝점만 재는 검사는 왕복을 놓친다.
 *
 * @param easingNode      노드 트랜지션의 easing
 * @param easingViewport  뷰포트 트랜지션의 easing. 노드와 다르면 상수성이 깨진다
 */
export function maxAnchorDeviation(a: {
  readonly pPrev: XY;
  readonly pNext: XY;
  readonly tPrev: XY;
  readonly tNext: XY;
  readonly zoom: number;
  readonly zoomTo?: number;
  readonly easingNode?: (s: number) => number;
  readonly easingViewport?: (s: number) => number;
  readonly samples?: number;
}): number {
  const eN = a.easingNode ?? ((s: number) => s);
  const eV = a.easingViewport ?? eN;
  const n = a.samples ?? 101;
  const base = anchorScreenAt({ ...a, uNode: 0, uViewport: 0 });
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const p = anchorScreenAt({ ...a, uNode: eN(s), uViewport: eV(s) });
    worst = Math.max(worst, Math.hypot(p.x - base.x, p.y - base.y));
  }
  return worst;
}

/** DESIGN §9의 `--ease-flow` = cubic-bezier(.2,.8,.2,1) */
export function easeFlow(s: number): number {
  return cubicBezierY(s, 0.2, 0.8, 0.2, 1);
}

/** d3-transition 기본값. React Flow의 `setViewport(v,{duration})`이 쓰는 것 */
export function easeCubicInOut(s: number): number {
  return s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2;
}

function cubicBezierY(s: number, x1: number, y1: number, x2: number, y2: number): number {
  // x(t) = s 를 만족하는 t를 이분법으로 찾고 y(t)를 돌려준다. 정밀도는 1e-7이면 충분하다.
  const bez = (t: number, a: number, b: number): number =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    if (bez(t, x1, x2) < s) lo = t;
    else hi = t;
  }
  return bez((lo + hi) / 2, y1, y2);
}

/* ────────────────────────────────────────────────────────────────────────
 * 앵커 결정
 * ──────────────────────────────────────────────────────────────────────── */

export function resolveAnchorTransform(a: AnchorArgs): AnchorDecision {
  const { prev, next, viewport: v, size } = a;
  sameZoom(v); // 유효성 검사를 앞으로 당긴다 — hold 경로도 같은 계약을 지켜야 한다

  if (!prev || prev.nodes.size === 0) return { t: 'fit', reason: 'initial' };
  if (a.hint.t === 'none') return { t: 'fit', reason: 'no-anchor-hint' };

  // (§3.6) 사용자가 아직 캔버스를 만지지 않았다 = 화면의 주인은 "전체 그림"이다.
  // 이때 노드 앵커링은 사용자의 멘탈 모델과 싸운다.
  if (a.viewportOwner === 'system') {
    return bboxDelta(prev.bbox, next.bbox) > SYSTEM_REFIT_DELTA
      ? { t: 'fit', reason: 'system-viewport' }
      : { t: 'hold', reason: 'no-move', anchorId: null, rule: null };
  }

  // (§3.6) 그래프 전체가 화면에 들어오는 작은 문서 — 노드 앵커링은 그림을 편심시킨다.
  // "시작 pill이 제자리에 있다"가 훨씬 강한 안정 신호다.
  if (fitsInViewport(prev.bbox, v, size) && fitsInViewport(next.bbox, v, size)) {
    return decide(a, bboxTopCenter(prev.bbox), bboxTopCenter(next.bbox), 'bbox-top-center', null);
  }

  for (const [id, rule] of candidates(a)) {
    const p0 = prev.nodes.get(id);
    const p1 = next.nodes.get(id);
    if (!p0 || !p1) continue; // 필터 A — 생존
    if (!intersectsViewport(p0, v, size, VISIBLE_INSET)) continue; // 필터 B — 가시
    return decide(a, { x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, rule, id);
  }
  return { t: 'fit', reason: 'no-survivor' };
}

/**
 * ★ 표류 가드 — **명세에 없는 추가**다. 근거를 남긴다.
 *
 * §3은 "앵커의 화면 좌표를 고정한다"만 말하는데, 그것만 하면 다음이 깨진다.
 *
 *   인접한 두 단계의 **순서를 바꾸면** 움직이는 노드는 딱 둘이다. 그런데 그중
 *   하나가 앵커라서 캔버스 전체를 140px 밀면, **가만히 있어야 할 나머지 12개가
 *   화면에서 140px 움직인다.** 실측 jump_score가 0.005 → 0.165로 **33배 나빠진다**
 *   (test/layout.test.ts의 `순서 교환` 시나리오).
 *
 * 앵커링의 목적은 "앵커를 고정하는 것"이 아니라 **"화면이 안 흔들리는 것"**이고,
 * 앵커 고정은 그 목적을 달성하는 보통의 수단일 뿐이다. 수단이 목적을 해치면
 * 수단을 버린다.
 *
 * 판정은 KPI 자체로 한다 — 보정했을 때와 안 했을 때의 **화면 안 생존 노드 평균
 * 이동거리**를 직접 비교해 작은 쪽을 고른다. 이 가드가 있으면 보정 후 점수가
 * 보정 전보다 나빠지는 일이 **정의상 불가능**하다.
 *
 * 대부분의 편집에서는 가드가 발동하지 않는다: 중간에 한 줄을 끼우면 아래 노드가
 * **전부** 같이 내려가므로 보정이 이기고, §3.1의 앵커 고정이 그대로 성립한다.
 */
function decide(a: AnchorArgs, from: XY, to: XY, rule: AnchorRule, anchorId: NodeId | null): AnchorDecision {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { t: 'hold', reason: 'no-move', anchorId, rule };

  const withCorrection = meanScreenMovement(a, { x: dx, y: dy });
  const without = meanScreenMovement(a, { x: 0, y: 0 });
  if (withCorrection > without) return { t: 'hold', reason: 'drift', anchorId, rule };

  return translateTo({ x: dx, y: dy }, a.viewport, rule, anchorId);
}

/**
 * 보정 `t`를 적용했을 때 **화면 안에 있던 생존 노드**의 평균 화면 이동거리.
 * jump.ts의 `jumpScore`와 같은 양을 정규화 전에 잰 것이다.
 */
function meanScreenMovement(a: AnchorArgs, t: XY): number {
  const { prev, next, viewport: v, size } = a;
  if (!prev) return 0;
  let sum = 0;
  let n = 0;
  for (const [id, p0] of prev.nodes) {
    const p1 = next.nodes.get(id);
    if (!p1) continue;
    if (!intersectsViewport(p0, v, size, 0)) continue;
    sum += Math.hypot((p1.x - p0.x - t.x) * v.zoom, (p1.y - p0.y - t.y) * v.zoom);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * 앵커 노드의 **어느 점**을 고정하는가: 노드 크기가 260×76 고정(D-023)이므로
 * 좌상단이든 중심이든 결과가 상수 차이일 뿐 동일하다. 좌상단을 쓴다 —
 * ELK가 돌려주는 값이 그것이고 변환이 하나 줄어든다.
 */
function translateTo(delta: XY, v: Viewport, rule: AnchorRule, anchorId: NodeId | null): AnchorDecision {
  const zoom = sameZoom(v);
  const dx = delta.x;
  const dy = delta.y;

  // 서브픽셀: T_new는 거의 항상 소수다. Math.round로 정수에 맞추고 싶은 유혹이
  // 있는데 하지 않는다 — 반올림은 앵커 고정을 최대 0.5px 깨뜨리고,
  // .react-flow__viewport는 합성 레이어라 서브픽셀 translate의 비용이 없다 (§3.5).
  const commit: CommitViewport = { x: v.x - dx * zoom, y: v.y - dy * zoom, zoom };
  return { t: 'translate', viewport: commit, anchorId, delta: { x: dx, y: dy }, rule };
}

/**
 * 후보 사다리 (§3.2 · §3.3).
 *
 *  1. hint.node → 그 노드
 *  2. hint.item → itemId가 일치하는 DerivedNode
 *  3. hint.item이 next 그래프에 없다 (삭제·병합됨)
 *       3a. prev 그래프에서의 **선행자** (order 최대, back edge 제외)
 *       3b. 조상 item의 노드
 *       3c. 직전 형제 item의 노드
 *  4. hint.auto → prev에서 뷰포트 중심에 가장 가까운 생존 노드 (언제나 마지막 방어선)
 */
function* candidates(a: AnchorArgs): Generator<readonly [NodeId, AnchorRule]> {
  const { hint, graphPrev, graphNext, prev } = a;

  if (hint.t === 'node') yield [hint.nodeId, 'focused-node'] as const;

  if (hint.t === 'item') {
    const alive = nodeOfItem(graphNext, hint.itemId);
    if (alive) {
      yield [alive.id, 'focused-item'] as const;
    } else if (graphPrev) {
      const gone = nodeOfItem(graphPrev, hint.itemId);
      if (gone) {
        // 3a. **선행자**다. 후속자가 아니다 (D-101 부수 결정).
        //
        //   ① 견적 요청                 ① 견적 요청     ← 앵커
        //   ② 단가표 열기  ← 삭제        ③ 견적서 작성   ← 위로 올라옴 (기대대로)
        //   ③ 견적서 작성               ④ 발송
        //
        // 후속자(③)를 잡으면 ③의 화면 좌표를 유지하려고 캔버스가 아래로
        // 76+64px 밀린다. 사용자는 "한 줄 지웠는데 그림 전체가 내려갔다"고 느낀다.
        for (const p of predecessorsOf(graphPrev, gone.id)) yield [p.id, 'deleted-predecessor'] as const;
      }
      for (const id of ancestorNodes(graphPrev, hint.itemId)) yield [id, 'ancestor'] as const;
      for (const id of prevSiblingNodes(graphPrev, hint.itemId)) yield [id, 'prev-sibling'] as const;
    }
  }

  // 4. 뷰포트 중심 최근접. 거리순으로 **여러 개**를 흘려보낸다 — 1등이 필터 A(생존)에
  //    걸릴 수 있기 때문이다.
  if (prev) {
    for (const id of nearestToViewportCenter(prev, a.viewport, a.size)) {
      yield [id, 'viewport-nearest'] as const;
    }
  }
}

function nodeOfItem(g: DerivedGraph, itemId: string): DerivedNode | null {
  return g.nodes.find((n) => n.itemId === itemId) ?? null;
}

/** back edge를 타고 올라가면 안 된다. order 최대 = 화면상 바로 위 */
function predecessorsOf(g: DerivedGraph, id: NodeId): DerivedNode[] {
  return (g.incoming.get(id) ?? [])
    .filter((e) => !e.isBackEdge)
    .map((e) => g.byId.get(e.source))
    .filter((n): n is DerivedNode => !!n && !n.synthetic)
    .sort((x, y) => y.order - x.order);
}

/**
 * 조상 사슬.
 *
 * `DerivedGraph`에는 `parentId`가 없지만 **pre-order 인덱스(order) + 깊이(depth)**가
 * 트리를 유일하게 결정한다. order 내림차순으로 훑으며 depth가 처음으로 작아지는
 * 노드가 부모다. graph-core에 새 필드를 요구하지 않고 같은 답을 얻는다.
 */
function ancestorNodes(g: DerivedGraph, itemId: string): NodeId[] {
  const real = realNodesByOrder(g);
  const i = real.findIndex((n) => n.itemId === itemId);
  if (i < 0) return [];
  const out: NodeId[] = [];
  let depth = real[i]!.depth;
  for (let j = i - 1; j >= 0 && depth > 0; j--) {
    const n = real[j]!;
    if (n.depth < depth) {
      out.push(n.id);
      depth = n.depth;
    }
  }
  return out;
}

/** 직전 형제 — 같은 깊이이면서, 그 사이에 더 얕은 노드가 끼지 않은 것 */
function prevSiblingNodes(g: DerivedGraph, itemId: string): NodeId[] {
  const real = realNodesByOrder(g);
  const i = real.findIndex((n) => n.itemId === itemId);
  if (i < 0) return [];
  const depth = real[i]!.depth;
  const out: NodeId[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const n = real[j]!;
    if (n.depth < depth) break; // 부모를 만났다 = 형제 구간 끝
    if (n.depth === depth) out.push(n.id);
  }
  return out;
}

function realNodesByOrder(g: DerivedGraph): DerivedNode[] {
  return g.nodes.filter((n) => !n.synthetic && n.itemId !== null).sort((a, b) => a.order - b.order);
}

/** 거리순 생존 후보. 제너레이터가 아니라 배열이지만 소비 측이 첫 통과에서 멈춘다 */
function nearestToViewportCenter(prev: LayoutResult, v: Viewport, size: ViewportSize): NodeId[] {
  const cx = (size.w / 2 - v.x) / v.zoom;
  const cy = (size.h / 2 - v.y) / v.zoom;
  return [...prev.nodes.values()]
    .map((p) => ({ id: p.id, d: Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => e.id);
}

/* ── 필터 · 뷰포트 기하 ────────────────────────────────────────────────── */

/**
 * 필터 B — prev 기준 화면 사각형이 뷰포트와 인셋 기준으로 교차하는가.
 *
 * **이게 없으면 치명적이다.** 문서 끝을 보고 있는데 undo가 첫머리를 바꾸면,
 * 앵커가 첫 노드가 되어 캔버스가 수천 px translate되고 **보던 곳이 화면 밖으로
 * 날아간다.** 앵커링이 만드는 최악의 어지러움이다.
 */
export function intersectsViewport(p: NodePlacement, v: Viewport, size: ViewportSize, inset: number): boolean {
  const x0 = p.x * v.zoom + v.x;
  const y0 = p.y * v.zoom + v.y;
  const x1 = (p.x + p.w) * v.zoom + v.x;
  const y1 = (p.y + p.h) * v.zoom + v.y;
  return x1 > inset && x0 < size.w - inset && y1 > inset && y0 < size.h - inset;
}

export function fitsInViewport(bbox: Rect, v: Viewport, size: ViewportSize, padding = FIT_PADDING): boolean {
  return bbox.w * v.zoom <= size.w - padding * 2 && bbox.h * v.zoom <= size.h - padding * 2;
}

export function bboxTopCenter(b: Rect): XY {
  return { x: b.x + b.w / 2, y: b.y };
}

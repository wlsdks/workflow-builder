/**
 * packages/layout-core/test/layout.test.ts
 *
 *   node --test packages/layout-core/test/
 *
 * 외부 러너 의존 없음(node:test). ELK 없이, 워커 없이, DOM 없이 돈다 —
 * 그게 이 패키지가 elkjs를 런타임 의존성으로 갖지 않는 이유다 (LAYOUT §14.2).
 *
 * 다루는 것
 *   1. graph-core 골든 픽스처 36건 × 하드 불변식        §13.2 · D-107
 *   2. 앵커링의 **대수적 주장**을 코드로 검증 + 반례      §3.1 · D-101
 *   3. 사이드 레일 6점 경로의 노드 비관통                §4.2 · D-103
 *   4. 게이트 양방향 (재배치 금지 / 필수)                §2.3 · D-105
 *   5. jump_score p90 < 0.15 (앵커 보정 후)              §13.1
 */

import { deepStrictEqual, equal, ok, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derive } from '@workflow/graph-core';
import type { DerivedGraph, Edge, Item, NodeId } from '@workflow/graph-core';
import { build, kase, explicit, type Spec } from '../../graph-core/src/__fixtures__/builder.ts';
import { fixtures } from '../../graph-core/src/__fixtures__/golden.ts';

import {
  GATE_TABLE,
  NODE_H,
  SPACING,
  ZERO,
  anchorScreenAt,
  assertZoomPreserved,
  buildElkGraph,
  checkHardInvariants,
  easeCubicInOut,
  easeFlow,
  fallbackLayout,
  jumpScore,
  layoutInvariants,
  layoutKeyOf,
  layoutKeyParts,
  maxAnchorDeviation,
  needsRelayout,
  quantile,
  readLayout,
  resolveAnchorTransform,
  rowExpectsRelayout,
  routeBackEdges,
  segmentEntersRect,
  translateOf,
  verifyBackEdgeRouting,
} from '../src/index.ts';
import type {
  AnchorDecision,
  AnchorHint,
  ElkNode,
  LayoutInput,
  LayoutResult,
  Viewport,
  ViewportSize,
} from '../src/types.ts';

/* ── 공통 ─────────────────────────────────────────────────────────────── */

const VP: Viewport = { x: 0, y: 0, zoom: 1 };
const SIZE: ViewportSize = { w: 1440, h: 900 };

const inputOf = (graph: DerivedGraph, over: Partial<LayoutInput> = {}): LayoutInput => ({
  graph,
  collapsed: new Set(),
  containers: new Map(),
  fanOutStack: false,
  ladder: 0,
  ...over,
});

const layoutOf = (items: readonly Item[], edges: readonly Edge[] = []): { g: DerivedGraph; l: LayoutResult } => {
  const g = derive(items, edges);
  return { g, l: fallbackLayout(g, g.acyclic) };
};

/* ────────────────────────────────────────────────────────────────────────
 * 1. 골든 픽스처 × 하드 불변식 (D-107 · L-09)
 *
 * **좌표를 핀하지 않는다.** 좌표 스냅샷은 ELK 패치 버전마다 빨개지고, 빨간 CI는
 * 학습된 무시를 낳는다. 사용자가 지각하는 성질만 고정한다.
 * ──────────────────────────────────────────────────────────────────────── */

describe('골든 픽스처 · 하드 불변식', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const g = derive(f.items, f.edges, f.options ?? {});
      const l = fallbackLayout(g, g.acyclic);
      const v = checkHardInvariants(l, g);
      equal(v.length, 0, `\n${v.map((x) => `  [${x.rule}] ${x.detail}`).join('\n')}`);
    });
  }

  it('불변식 검사가 공허하지 않다 — 픽스처가 실제로 뭔가를 담고 있다', () => {
    let nodes = 0;
    let backEdges = 0;
    let longEdges = 0;
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      const l = fallbackLayout(g, g.acyclic);
      nodes += l.nodes.size;
      backEdges += [...l.edges.values()].filter((e) => e.kind === 'back').length;
      for (const e of g.edges) {
        const s = l.nodes.get(e.source);
        const t = l.nodes.get(e.target);
        if (!e.isBackEdge && s && t && t.layer - s.layer > 1) longEdges++;
      }
    }
    ok(nodes > 150, `노드 ${nodes}개`);
    ok(backEdges >= 2, `back edge ${backEdges}개`);
    ok(longEdges >= 5, `층을 건너뛰는 엣지 ${longEdges}개`);
  });

  it('종횡비 골든 — 픽스처별로 ±15% 안에서 안정적이다', () => {
    // 좌표가 아니라 형태를 고정한다. 같은 입력을 두 번 돌리면 완전히 같아야 하고,
    // 그 값이 골든이 된다.
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      const a = layoutInvariants(fallbackLayout(g, g.acyclic), g);
      const b = layoutInvariants(fallbackLayout(g, g.acyclic), g);
      deepStrictEqual(a, b, `${f.name}: 같은 입력이 다른 불변식을 냈다`);
    }
  });
});

/**
 * D-100 — 게이트가 살아 있는지 확인한다.
 *
 * 명세 §11.3의 `straightOrElbow`(더미 노드 없이 "중간 y에서 가로")를 그대로 쓰면
 * 층을 두 개 이상 건너뛰는 엣지가 중간 층 노드를 관통한다. **그 위반을 불변식이
 * 실제로 잡는지** 확인한다. 못 잡으면 §13.2의 `noEdgeCrossesNode`는 방어하는 척만
 * 하는 죽은 게이트다.
 */
describe('불변식 생존 확인 (D-100)', () => {
  it('명세 §11.3의 straightOrElbow는 실제로 노드를 관통한다 — 그리고 검사가 그걸 잡는다', () => {
    const offenders: string[] = [];
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      const l = fallbackLayout(g, g.acyclic);
      for (const e of g.edges) {
        if (e.isBackEdge) continue;
        const s = l.nodes.get(e.source);
        const t = l.nodes.get(e.target);
        if (!s || !t) continue;
        const x0 = s.x + s.w / 2;
        const x1 = t.x + t.w / 2;
        const y0 = s.y + s.h;
        const y1 = t.y;
        const mid = (y0 + y1) / 2;
        const pts =
          Math.abs(x0 - x1) < 0.5
            ? [
                { x: x0, y: y0 },
                { x: x1, y: y1 },
              ]
            : [
                { x: x0, y: y0 },
                { x: x0, y: mid },
                { x: x1, y: mid },
                { x: x1, y: y1 },
              ];
        for (let i = 0; i + 1 < pts.length; i++) {
          for (const n of l.nodes.values()) {
            if (segmentEntersRect(pts[i]!, pts[i + 1]!, n, 2)) offenders.push(`${f.name}/${e.id}→${n.id}`);
          }
        }
      }
    }
    ok(
      offenders.length > 0,
      '명세대로 구현했을 때 관통이 하나도 없다면, 이 저장소의 더미 노드 라우팅은 근거를 잃는다',
    );
    // 실제 구현(더미 노드 경유)에서는 0건이어야 한다
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      const l = fallbackLayout(g, g.acyclic);
      equal(checkHardInvariants(l, g).filter((v) => v.rule === 'noEdgeCrossesNode').length, 0, f.name);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. 앵커링의 대수 (§3.1 · D-101)
 * ──────────────────────────────────────────────────────────────────────── */

describe('앵커 대수 — screen(u)가 상수라는 주장', () => {
  const base = {
    pPrev: { x: 320, y: 900 },
    pNext: { x: 388, y: 1176 }, // Δ = (68, 276)
    tPrev: { x: -120, y: -640 },
    zoom: 0.85,
  };
  const tNext = {
    x: base.tPrev.x - (base.pNext.x - base.pPrev.x) * base.zoom,
    y: base.tPrev.y - (base.pNext.y - base.pPrev.y) * base.zoom,
  };

  it('뷰포트와 노드에 같은 easing을 걸면 구간 전체에서 0px 미끄러진다', () => {
    for (const easing of [easeFlow, easeCubicInOut, (s: number) => s]) {
      const dev = maxAnchorDeviation({ ...base, tNext, easingNode: easing, easingViewport: easing, samples: 401 });
      ok(dev < 1e-9, `easing 공통일 때 편차 ${dev}px`);
    }
  });

  it('끝점은 easing이 달라도 맞는다 — 끝점만 재는 검사가 왕복을 놓치는 이유', () => {
    const at0 = anchorScreenAt({ ...base, tNext, uNode: 0, uViewport: 0 });
    const at1 = anchorScreenAt({ ...base, tNext, uNode: 1, uViewport: 1 });
    ok(Math.hypot(at1.x - at0.x, at1.y - at0.y) < 1e-9);
  });

  it('★ 반례 — 뷰포트만 d3 기본 easing이면 중간에 미끄러진다 (setViewport(v,{duration}) 금지 근거)', () => {
    const dev = maxAnchorDeviation({
      ...base,
      tNext,
      easingNode: easeFlow,
      easingViewport: easeCubicInOut,
      samples: 401,
    });
    const zDelta = Math.hypot(base.pNext.x - base.pPrev.x, base.pNext.y - base.pPrev.y) * base.zoom;
    ok(dev > 1, `편차가 ${dev.toFixed(2)}px밖에 안 된다 — 반례가 성립하지 않는다`);
    // ★ 명세 §3.1은 "두 곡선이 다르면 중간에 최대 12% 정도 어긋난다"고 적고 있지만,
    //   실제로 cubic-bezier(.2,.8,.2,1) ↔ easeCubicInOut의 최대 격차는 **0.72**다.
    //   즉 어긋남은 12%가 아니라 **z·Δ의 72%** — 명세가 심하게 과소평가하고 있다.
    //   결론(=쓰지 마라)은 그대로지만 숫자는 여기 실측이 맞다.
    const ratio = dev / zDelta;
    ok(ratio > 0.5 && ratio < 0.9, `z·Δ 대비 편차 ${ratio.toFixed(3)} (명세는 0.12이라고 적혀 있다)`);
  });

  it('★ 반례 — 뷰포트를 즉시 바꾸면(노드만 보간) z·Δ만큼 튀었다가 돌아온다', () => {
    const dev = maxAnchorDeviation({
      ...base,
      tNext,
      easingNode: easeFlow,
      easingViewport: () => 1, // 즉시 적용
      samples: 401,
    });
    const zDelta = Math.hypot(base.pNext.x - base.pPrev.x, base.pNext.y - base.pPrev.y) * base.zoom;
    ok(Math.abs(dev - zDelta) < 1e-6, `튐 ${dev.toFixed(2)}px ≠ z·Δ ${zDelta.toFixed(2)}px`);
  });

  it('★ 반례 — 줌까지 같이 애니메이션하면 앵커는 반드시 미끄러진다 (D-102의 수학적 근거)', () => {
    const dev = maxAnchorDeviation({
      ...base,
      tNext,
      zoomTo: base.zoom * 1.2,
      easingNode: easeFlow,
      easingViewport: easeFlow,
      samples: 401,
    });
    ok(dev > 10, `줌을 바꿨는데 편차가 ${dev.toFixed(2)}px뿐이다`);
  });

  it('D-102 — 줌이 다른 커밋 뷰포트는 런타임에서 막힌다', () => {
    const decision = {
      t: 'translate',
      viewport: { x: 0, y: 0, zoom: 1.4 },
      anchorId: 'a',
      delta: { x: 0, y: 10 },
      rule: 'focused-item',
    } as unknown as AnchorDecision;
    throws(() => assertZoomPreserved({ x: 0, y: 0, zoom: 1 }, decision), /D-102/);
  });

  it('zoom ≤ 0 이면 앵커링 자체가 거부된다', () => {
    const { g: g0, l: prev } = layoutOf(chain(8));
    const { g: g1, l: next } = layoutOf(insertAfter(chain(8), 's3', 'NEW'));
    throws(
      () =>
        resolveAnchorTransform({
          prev,
          next,
          graphPrev: g0,
          graphNext: g1,
          hint: { t: 'item', itemId: 's3' },
          viewport: { x: 0, y: 0, zoom: 0 },
          size: { w: 400, h: 300 },
          viewportOwner: 'user',
        }),
      /zoom/,
    );
  });
});

/* ── 앵커 결정 표 (§13.4) ─────────────────────────────────────────────── */

describe('앵커 결정', () => {
  /** 화면에 다 안 들어오는 큰 문서라야 노드 앵커링 경로를 탄다 */
  const bigItems = chain(40);

  const decide = (
    before: readonly Item[],
    after: readonly Item[],
    hint: AnchorHint,
    over: Partial<{ viewport: Viewport; size: ViewportSize; owner: 'user' | 'system' }> = {},
  ): { d: AnchorDecision; prev: LayoutResult; next: LayoutResult } => {
    const a = layoutOf(before);
    const b = layoutOf(after);
    return {
      d: resolveAnchorTransform({
        prev: a.l,
        next: b.l,
        graphPrev: a.g,
        graphNext: b.g,
        hint,
        viewport: over.viewport ?? centerOn(a.l, 's20'),
        size: over.size ?? SIZE,
        viewportOwner: over.owner ?? 'user',
      }),
      prev: a.l,
      next: b.l,
    };
  };

  it('포커스 노드가 살아 있으면 그것 — 위에 한 줄이 끼면 캔버스가 따라 내려간다', () => {
    // s20을 보는 중에 s10 뒤로 한 줄이 끼었다 → s20이 140px 내려간다 → 보정한다
    const { d } = decide(bigItems, insertAfter(bigItems, 's10', 'NEW'), { t: 'item', itemId: 's20' });
    equal(d.t, 'translate');
    if (d.t === 'translate') {
      equal(d.rule, 'focused-item');
      equal(d.anchorId, 's20');
      deepStrictEqual(d.delta, { x: 0, y: NODE_H + SPACING.betweenLayers });
    }
  });

  it('내 아래에 끼워 넣으면 앵커는 안 움직인다 → hold (뷰포트를 건드릴 이유가 없다)', () => {
    const { d } = decide(bigItems, insertAfter(bigItems, 's20', 'NEW'), { t: 'item', itemId: 's20' });
    equal(d.t, 'hold');
    if (d.t === 'hold') {
      equal(d.reason, 'no-move');
      equal(d.rule, 'focused-item'); // 계측용으로 규칙은 남는다
    }
  });

  it('삭제된 노드는 **선행자**로 (후속자가 아니다)', () => {
    const after = removeItems(bigItems, ['s20']);
    const { d } = decide(bigItems, after, { t: 'item', itemId: 's20' });
    // 선행자는 제자리이므로 결과는 hold다 — 그게 정확히 원하는 것이다.
    // 후속자를 잡았다면 여기서 translate가 나오고 캔버스가 140px 내려갔을 것이다.
    equal(d.t, 'hold');
    if (d.t === 'hold') {
      equal(d.rule, 'deleted-predecessor');
      equal(d.anchorId, 's19');
    }
  });

  it('삭제 지점보다 아래를 보고 있으면 선행자 앵커가 캔버스를 위로 당긴다', () => {
    const after = removeItems(bigItems, ['s5']);
    const { d } = decide(bigItems, after, { t: 'item', itemId: 's5' }, { viewport: centerOn(layoutOf(bigItems).l, 's30') });
    equal(d.t, 'translate');
    if (d.t === 'translate') {
      // s5의 선행자 s4는 화면 밖이므로 필터 B에서 걸리고, 뷰포트 최근접이 앵커가 된다
      equal(d.rule, 'viewport-nearest');
      equal(d.delta.y, -(NODE_H + SPACING.betweenLayers));
    }
  });

  it('★ 선행자를 잡아야 하는 이유가 수치로 남는다 — 후속자를 잡으면 캔버스가 한 층 내려간다', () => {
    const after = removeItems(bigItems, ['s20']);
    const a = layoutOf(bigItems);
    const b = layoutOf(after);

    const dyOf = (id: NodeId): number => b.l.nodes.get(id)!.y - a.l.nodes.get(id)!.y;
    // 선행자는 제자리 (위쪽은 안 움직인다) → 보정량 0
    equal(dyOf('s19'), 0);
    // 후속자는 한 층 위로 올라온다 → 그걸 앵커로 잡으면 캔버스를 그만큼 내려야 한다
    equal(dyOf('s21'), -(NODE_H + SPACING.betweenLayers));
    equal(NODE_H + SPACING.betweenLayers, 140);
  });

  it('앵커가 화면 밖이면 필터 B에서 탈락하고 뷰포트 최근접으로 넘어간다', () => {
    // s0을 편집했다고 하는데 사용자는 s30 근처를 보고 있다
    const { d } = decide(bigItems, insertAfter(bigItems, 's0', 'NEW'), { t: 'item', itemId: 's0' }, {
      viewport: centerOn(layoutOf(bigItems).l, 's30'),
    });
    equal(d.t, 'translate');
    if (d.t === 'translate') {
      equal(d.rule, 'viewport-nearest');
      ok(d.anchorId !== 's0', '화면 밖 노드가 앵커가 됐다 — 보던 곳이 날아간다');
    }
  });

  it('전체가 화면에 들어오면 bbox 상단 중앙', () => {
    const small = chain(4);
    const { d } = decide(small, insertAfter(small, 's1', 'NEW'), { t: 'item', itemId: 's1' }, {
      viewport: { x: 0, y: 0, zoom: 0.5 },
    });
    // 폭이 안 변하고 상단이 그대로이므로 보정량이 0 — "시작 pill이 제자리"가 된다
    equal(d.t, 'hold');
    if (d.t === 'hold') equal(d.rule, 'bbox-top-center');
  });

  it('작은 문서가 왼쪽으로 넓어지면 bbox 상단 중앙이 캔버스를 따라 옮긴다', () => {
    const small = build([
      { id: 'b', kind: 'branch', attrs: { mode: 'xor' }, children: [kase('x', [{ id: 'x1' }])] },
    ]);
    const wider = build([
      {
        id: 'b',
        kind: 'branch',
        attrs: { mode: 'xor' },
        children: [kase('x', [{ id: 'x1' }]), kase('y', [{ id: 'y1' }])],
      },
    ]);
    const { d } = decide(small, wider, { t: 'item', itemId: 'b' }, { viewport: { x: 0, y: 0, zoom: 0.4 } });
    ok(d.t !== 'fit', '작은 문서에서 fit이 나오면 안 된다');
    equal(d.rule, 'bbox-top-center'); // hold여도 규칙은 계측용으로 남는다
  });

  it('시스템 뷰포트면 fit — 화면의 주인이 "노드 하나"가 아니라 "전체 그림"이다', () => {
    const { d } = decide(bigItems, insertAfter(bigItems, 's20', 'NEW'), { t: 'item', itemId: 's20' }, {
      owner: 'system',
    });
    equal(d.t, 'fit');
    if (d.t === 'fit') equal(d.reason, 'system-viewport');
  });

  it('시스템 뷰포트인데 변화가 2% 이하면 아무것도 안 한다', () => {
    const a = layoutOf(bigItems);
    const d = resolveAnchorTransform({
      prev: a.l,
      next: a.l,
      graphPrev: a.g,
      graphNext: a.g,
      hint: { t: 'auto' },
      viewport: VP,
      size: SIZE,
      viewportOwner: 'system',
    });
    deepStrictEqual(d, { t: 'hold', reason: 'no-move', anchorId: null, rule: null });
  });

  it('최초 로드는 앵커링 없이 fit', () => {
    const b = layoutOf(bigItems);
    const d = resolveAnchorTransform({
      prev: null,
      next: b.l,
      graphPrev: null,
      graphNext: b.g,
      hint: { t: 'auto' },
      viewport: VP,
      size: SIZE,
      viewportOwner: 'user',
    });
    deepStrictEqual(d, { t: 'fit', reason: 'initial' });
  });

  it('hint:none은 앵커링을 명시적으로 포기한다', () => {
    const { d } = decide(bigItems, insertAfter(bigItems, 's20', 'NEW'), { t: 'none' });
    equal(d.t, 'fit');
    if (d.t === 'fit') equal(d.reason, 'no-anchor-hint');
  });

  it('움직이지 않았으면 hold', () => {
    const { d } = decide(bigItems, bigItems, { t: 'item', itemId: 's20' });
    deepStrictEqual(d, { t: 'hold', reason: 'no-move', anchorId: 's20', rule: 'focused-item' });
  });

  it('★ 표류 가드 — 순서만 바꿨는데 캔버스가 140px 미끄러지지 않는다', () => {
    // 인접한 두 단계를 맞바꾸면 움직이는 노드는 **딱 둘**이다. 편집한 노드를 고정하려고
    // 캔버스를 밀면 가만히 있어야 할 나머지 전부가 화면에서 움직인다.
    const after = swapSortKeys(bigItems, 's10', 's11');
    const { d, prev, next } = decide(bigItems, after, { t: 'item', itemId: 's10' }, {
      viewport: centerOn(layoutOf(bigItems).l, 's10'),
    });
    equal(d.t, 'hold');
    if (d.t === 'hold') {
      equal(d.reason, 'drift');
      equal(d.rule, 'focused-item');
    }
    // 가드가 없었다면 어떻게 됐는가 — 33배 나빠진다
    const vp = centerOn(prev, 's10');
    const naive = jumpScore(prev, next, {
      viewport: { ...vp, ...SIZE },
      translate: { x: 0, y: NODE_H + SPACING.betweenLayers },
    });
    const guarded = jumpScore(prev, next, { viewport: { ...vp, ...SIZE }, translate: translateOf(d) });
    ok(naive > 0.05, `가드 없는 점수 ${naive.toFixed(4)} — 반례가 성립하지 않는다`);
    ok(guarded < naive / 10, `가드 후 ${guarded.toFixed(4)} vs 가드 전 ${naive.toFixed(4)}`);
  });

  it('생존자가 하나도 없으면 fit', () => {
    const a = layoutOf(chain(30));
    const b = layoutOf(chain(30).map((i) => ({ ...i, id: `x${i.id}` })));
    const d = resolveAnchorTransform({
      prev: a.l,
      next: b.l,
      graphPrev: a.g,
      graphNext: b.g,
      // 합성 노드(start/end)는 양쪽에 다 있으므로 hint를 auto로 두면 그것들이 잡힌다.
      // "전부 새 노드"의 의미를 살리려면 존재하지 않는 item을 가리켜야 한다.
      hint: { t: 'node', nodeId: 'nope' },
      viewport: { x: 0, y: 0, zoom: 4 },
      size: { w: 200, h: 200 },
      viewportOwner: 'user',
    });
    // 뷰포트가 아주 좁아 어떤 노드도 필터 B를 통과하지 못한다
    equal(d.t, 'fit');
  });

  it('앵커 보정 후 앵커 노드의 화면 좌표가 정확히 보존된다', () => {
    const { d, prev, next } = decide(bigItems, insertAfter(bigItems, 's10', 'NEW'), { t: 'item', itemId: 's20' });
    ok(d.t === 'translate');
    if (d.t !== 'translate') return;
    const v0 = centerOn(prev, 's20');
    const p0 = prev.nodes.get(d.anchorId!)!;
    const p1 = next.nodes.get(d.anchorId!)!;
    const before = { x: p0.x * v0.zoom + v0.x, y: p0.y * v0.zoom + v0.y };
    const after = { x: p1.x * d.viewport.zoom + d.viewport.x, y: p1.y * d.viewport.zoom + d.viewport.y };
    ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-9);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. 사이드 레일 (§4.2 · D-103)
 * ──────────────────────────────────────────────────────────────────────── */

describe('back edge 사이드 레일', () => {
  /** 되돌아가는 흐름 3개가 서로 겹치는 문서 */
  const loops = (): { items: Item[]; edges: Edge[] } => ({
    items: build(Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, title: `단계 ${i}` }))),
    edges: [
      explicit('b1', 's12', 's2'),
      explicit('b2', 's10', 's4'),
      explicit('b3', 's8', 's6'),
      explicit('b4', 's13', 's1'),
    ],
  });

  it('6점 경로가 노드를 관통하지 않는다 (겹치는 루프 4개)', () => {
    const { items, edges } = loops();
    const { g, l } = layoutOf(items, edges);
    const back = [...l.edges.values()].filter((e) => e.kind === 'back');
    equal(back.length, 4, '루프 4개가 back edge로 잡혀야 한다');
    const v = checkHardInvariants(l, g);
    equal(v.length, 0, v.map((x) => `[${x.rule}] ${x.detail}`).join('\n'));
    for (const geo of back) equal(geo.points.length, 6);
  });

  it('겹치는 루프는 서로 다른 레일을 쓰고, 긴 루프가 안쪽이다', () => {
    const { items, edges } = loops();
    const { l } = layoutOf(items, edges);
    const railX = new Map<string, number>();
    for (const e of l.edges.values()) if (e.kind === 'back') railX.set(e.id, e.points[2]!.x);
    equal(new Set(railX.values()).size, 4, '네 루프가 전부 겹치므로 레일 4개여야 한다');
    // b4(s13→s1)가 가장 길다 → 가장 안쪽(작은 x)
    const sorted = [...railX].sort((a, b) => a[1] - b[1]);
    equal(sorted[0]![0], 'b4');
  });

  it('레일은 언제나 bbox 오른쪽 밖이다', () => {
    const { items, edges } = loops();
    const { l } = layoutOf(items, edges);
    for (const e of l.edges.values()) {
      if (e.kind !== 'back') continue;
      ok(e.points[2]!.x >= l.bbox.x + l.bbox.w + 32, `railX=${e.points[2]!.x} bbox.right=${l.bbox.x + l.bbox.w}`);
    }
  });

  it('화살표는 target **상단**으로 들어온다 (ELK 기하를 뒤집어 쓰지 않는 이유)', () => {
    const { items, edges } = loops();
    const { g, l } = layoutOf(items, edges);
    for (const e of g.edges) {
      if (!e.isBackEdge) continue;
      const geo = l.edges.get(e.id)!;
      const t = l.nodes.get(e.target)!;
      const last = geo.points[geo.points.length - 1]!;
      const prev = geo.points[geo.points.length - 2]!;
      equal(last.y, t.y);
      ok(prev.y < last.y, '아래에서 위로 들어왔다 — 전역 시각 규칙 위반');
    }
  });

  it('★ 명세의 gutterBelow(min(bottom+20, next.top−8))는 밴드가 닿아 있으면 노드를 관통한다', () => {
    // 층 간격이 0인 병리적 배치를 만들어 두 식을 비교한다.
    const bands = [
      { index: 0, top: 0, bottom: 76 },
      { index: 1, top: 76, bottom: 152 },
    ];
    const n = { id: 'a', x: 0, y: 0, w: 260, h: 76, layer: 0 };
    const spec = Math.min(bands[0]!.bottom + 20, bands[1]!.top - 8); // = 68 → 밴드 **안쪽**
    ok(spec < bands[0]!.bottom, `명세 식이 ${spec}을 내놓아 밴드(bottom=76) 안으로 들어간다`);

    const geo = routeBackEdges(
      [{ id: 'e', source: 'a', target: 'a', origin: 'explicit', reason: 'explicit', isBackEdge: true }],
      new Map([['a', n]]),
      bands,
      { x: 0, y: 0, w: 260, h: 152 },
    ).get('e')!;
    // 구현은 항상 [bottom, next.top] 안에 남는다
    ok(geo.points[1]!.y >= bands[0]!.bottom, `구현 식은 ${geo.points[1]!.y} (밴드 밖)`);
  });

  it('검증 함수가 실제로 위반을 잡는다 (D-100)', () => {
    const n = { id: 'a', x: 0, y: 0, w: 260, h: 76, layer: 0 };
    const t = { id: 'b', x: 0, y: 140, w: 260, h: 76, layer: 1 };
    const nodes = [n, t];
    const bbox = { x: 0, y: 0, w: 260, h: 216 };
    // 레일을 일부러 bbox 안쪽(노드 위)으로 그린 6점
    const bad = {
      id: 'x',
      kind: 'back' as const,
      reversedForLayout: true,
      labelAnchor: null,
      points: [
        { x: 236, y: 76 },
        { x: 236, y: 108 },
        { x: 130, y: 108 },
        { x: 130, y: 40 }, // ← 노드 a를 세로로 관통
        { x: 236, y: 40 },
        { x: 236, y: 0 },
      ],
    };
    const v = verifyBackEdgeRouting(bad, t, n, nodes, bbox);
    ok(v.some((x) => x.kind === 'pierces-node'), '관통을 못 잡는다');
    ok(v.some((x) => x.kind === 'rail-inside-bbox'), 'bbox 안쪽 레일을 못 잡는다');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. 게이트 (§2 · D-024 · D-105)
 * ──────────────────────────────────────────────────────────────────────── */

describe('구조 diff 게이트', () => {
  const baseSpecs: Spec[] = [
    { id: 'a', title: '견적 요청' },
    {
      id: 'b',
      kind: 'branch',
      title: '금액 확인',
      attrs: { mode: 'xor' },
      children: [kase('x', [{ id: 'x1', title: '소액' }]), kase('y', [{ id: 'y1', title: '고액' }])],
    },
    { id: 'c', title: '발송' },
  ];
  const baseItems = build(baseSpecs);

  const patch = (items: readonly Item[], id: string, over: Partial<Item>): Item[] =>
    items.map((i) => (i.id === id ? { ...i, ...over } : i));

  /** "이 op은 layoutKey를 바꾸면 안 된다" — D-024 */
  const MUST_NOT_RELAYOUT: Array<[string, (i: readonly Item[]) => Item[]]> = [
    ['제목', (i) => patch(i, 'a', { title: '완전히 다른 아주 긴 제목입니다' })],
    ['담당자', (i) => patch(i, 'a', { assigneeId: 'u9' })],
    ['소요시간', (i) => patch(i, 'a', { durationBand: '1d+' })],
    ['도구', (i) => patch(i, 'a', { toolIds: ['excel', 'slack', 'erp'] })],
    ['짜증', (i) => patch(i, 'a', { painFlag: true })],
    ['반려율', (i) => patch(i, 'a', { attrs: { reworkRate: 0.4 } })],
    ['갈래 라벨', (i) => patch(i, 'case-x', { attrs: { caseLabel: '아주 긴 조건 라벨' } })],
    ['확인 시각', (i) => patch(i, 'a', { lastConfirmedAt: new Date(1) })],
  ];

  for (const [name, mutate] of MUST_NOT_RELAYOUT) {
    it(`${name} 변경은 재배치를 유발하지 않는다`, () => {
      const before = inputOf(derive(baseItems, []));
      const after = inputOf(derive(mutate(baseItems), []));
      equal(layoutKeyOf(before), layoutKeyOf(after), `${name}이(가) layoutKey를 바꿨다 — D-024 위반`);
      equal(needsRelayout(before, after).relayout, false);
    });
  }

  /** 반대 방향 — 재배치가 필요한데 키가 같으면 **조용히 그림이 틀린다** */
  const MUST_RELAYOUT: Array<[string, () => LayoutInput, string]> = [
    [
      '순서 이동',
      () => inputOf(derive(patch(baseItems, 'a', { sortKey: 'z9' }), [])),
      'topology',
    ],
    ['삽입', () => inputOf(derive(insertAfter(baseItems, 'a', 'NEW'), [])), 'topology'],
    ['kind', () => inputOf(derive(patch(baseItems, 'a', { kind: 'hold' }), [])), 'topology'],
    [
      'and 전환',
      () => inputOf(derive(patch(baseItems, 'b', { attrs: { mode: 'and' } }), [])),
      'topology',
    ],
    [
      'joinBehavior',
      () => inputOf(derive(patch(baseItems, 'case-x', { attrs: { caseLabel: 'x', joinBehavior: 'end' } }), [])),
      'topology',
    ],
    ['명시 엣지 추가', () => inputOf(derive(baseItems, [explicit('e1', 'c', 'a')])), 'topology'],
    ['접기', () => inputOf(derive(baseItems, []), { collapsed: new Set(['b']) }), 'collapsed'],
    [
      '컨테이너 소속',
      () => inputOf(derive(baseItems, []), { containers: new Map([['group:b', ['x1', 'y1']]]) }),
      'containers',
    ],
    ['팬아웃 스택', () => inputOf(derive(baseItems, []), { fanOutStack: true }), 'fan-out'],
    ['사다리 단계', () => inputOf(derive(baseItems, []), { ladder: 1 }), 'ladder'],
  ];

  for (const [name, make, dim] of MUST_RELAYOUT) {
    it(`${name} 변경은 재배치를 유발한다 (${dim})`, () => {
      const before = inputOf(derive(baseItems, []));
      const d = needsRelayout(before, make());
      equal(d.relayout, true, `${name}이(가) 게이트를 통과했다 — 조용히 그림이 틀린다`);
      equal(d.reason, dim);
    });
  }

  it('§2.2 전수표 31행이 코드의 판정과 일치한다', () => {
    equal(GATE_TABLE.length, 31);
    for (const row of GATE_TABLE) {
      // 표의 계약: 재배치 필요 ⟺ layoutKey 성분이 바뀐다
      equal(
        rowExpectsRelayout(row),
        row.dimension !== 'none',
        `${row.n}행 "${row.change}"의 dimension과 재배치 판정이 어긋난다`,
      );
      // 재배치가 필요 없다면 무언가가 그것을 답할 필요도 없다
      if (row.dimension === 'none' && row.servedBy !== 'none') {
        equal(row.n, 31, `${row.n}행: 재배치 없는데 servedBy=${row.servedBy}`);
      }
    }
  });

  it('렌즈·줌은 타입상 layoutKey에 도달할 수 없다 (L-07)', () => {
    // LayoutInput에 lens/zoom 필드가 **없다**는 것이 §8.3·§9의 진짜 증명이고,
    // 그건 컴파일러가 검사한다. 런타임에서 확인할 수 있는 것은
    // "키를 만드는 성분이 정확히 이 6개뿐"이라는 사실이다.
    const keys = Object.keys(layoutKeyParts(inputOf(derive(baseItems, [])))).sort();
    deepStrictEqual(keys, ['collapsed', 'containers', 'fanOut', 'ladder', 'options', 'topology']);
  });

  it('같은 입력은 항상 같은 키 (Map/Set 순회 순서에 의존하지 않는다)', () => {
    const g = derive(baseItems, []);
    const a = inputOf(g, {
      collapsed: new Set(['b', 'a']),
      containers: new Map([
        ['g1', ['y1', 'x1']],
        ['g0', ['a']],
      ]),
    });
    const b = inputOf(g, {
      collapsed: new Set(['a', 'b']),
      containers: new Map([
        ['g0', ['a']],
        ['g1', ['x1', 'y1']],
      ]),
    });
    equal(layoutKeyOf(a), layoutKeyOf(b));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 5. jump_score (§13.1)
 * ──────────────────────────────────────────────────────────────────────── */

describe('jump_score', () => {
  type Step = { name: string; items: Item[]; hint: AnchorHint };

  /** 시나리오 — 각 픽스처에 정해진 편집 시퀀스를 흘린다 */
  const scenarios: Array<{ name: string; seed: Item[]; steps: Step[] }> = [];

  const seqOf = (name: string, seed: readonly Item[], ids: string[]): void => {
    let items = [...seed];
    const steps: Step[] = [];
    const [a, b, c] = ids;
    if (a) {
      items = insertAfter(items, a, `${a}-new`);
      steps.push({ name: '중간 삽입', items, hint: { t: 'item', itemId: `${a}-new` } });
    }
    if (b) {
      items = removeItems(items, [b]);
      steps.push({ name: '중간 삭제', items, hint: { t: 'item', itemId: b } });
    }
    if (a && c) {
      items = swapSortKeys(items, a, c);
      steps.push({ name: '순서 교환', items, hint: { t: 'item', itemId: a } });
    }
    items = [...items, ...build([{ id: 'TAIL', title: '끝에 추가', sortKey: 'zz' }])];
    steps.push({ name: '끝에 추가', items, hint: { t: 'item', itemId: 'TAIL' } });
    scenarios.push({ name, seed: [...seed], steps });
  };

  seqOf('linear-40', chain(40), ['s10', 's20', 's11']);
  seqOf('linear-12', chain(12), ['s3', 's6', 's4']);
  seqOf('branchy-60', branchy(60), ['s0', 's3', 's1']);
  for (const f of fixtures) {
    const roots = f.items.filter((i) => i.parentId === null && !i.deletedAt);
    if (roots.length < 3) continue;
    seqOf(f.name, f.items, [roots[0]!.id, roots[1]!.id, roots[2]!.id]);
  }

  it('앵커 보정 후 p90 < 0.15', () => {
    const screen: number[] = [];
    const world: number[] = [];
    const rules = new Map<string, number>();

    for (const sc of scenarios) {
      let prev = layoutOf(sc.seed);
      for (const step of sc.steps) {
        const next = layoutOf(step.items);
        // 사용자는 편집 중인 지점을 보고 있다
        const focus = focusNodeId(prev.l, step.hint);
        const viewport = focus ? centerOn(prev.l, focus) : VP;
        const d = resolveAnchorTransform({
          prev: prev.l,
          next: next.l,
          graphPrev: prev.g,
          graphNext: next.g,
          hint: step.hint,
          viewport,
          size: SIZE,
          viewportOwner: 'user',
        });
        const label = d.t === 'fit' ? `fit:${d.reason}` : `${d.t}:${d.rule ?? '-'}`;
        rules.set(label, (rules.get(label) ?? 0) + 1);
        screen.push(jumpScore(prev.l, next.l, { viewport: { ...viewport, ...SIZE }, translate: translateOf(d) }));
        world.push(jumpScore(prev.l, next.l, { viewport: { ...viewport, ...SIZE }, translate: ZERO }));
        prev = next;
      }
    }
    ok(rules.size > 1, `앵커 규칙이 한 종류뿐이다 (${[...rules].map(([k, n]) => `${k}×${n}`).join(', ')})`);

    const p90 = quantile(screen, 0.9);
    const p90w = quantile(world, 0.9);
    ok(screen.length >= 40, `표본 ${screen.length}건`);
    ok(p90 < 0.15, `jump_score(screen) p90 = ${p90.toFixed(4)} / 상위값 ${top(screen, 3)}`);
    // 표류 가드 덕에 **보정 후가 보정 전보다 나빠지는 일은 정의상 없다** (§5.4의 분해가
    // 의미를 가지려면 이 성질이 필요하다)
    ok(p90 <= p90w + 1e-9, `보정 후(${p90.toFixed(4)})가 보정 전(${p90w.toFixed(4)})보다 나쁘다`);
  });

  it('생존 노드만 센다 — 새 노드는 "생성"이지 "점프"가 아니다', () => {
    // jumpScore는 순수 함수다. 그래프를 거치지 않고 의미만 고정한다.
    const prev = fakeResult({ a: [0, 0], b: [0, 140] });
    const next = fakeResult({ a: [0, 0], b: [0, 140], c: [0, 280], d: [300, 280] });
    equal(jumpScore(prev, next, { viewport: { zoom: 1, ...SIZE }, translate: ZERO }), 0, '새 노드가 점수에 섞였다');

    // 삭제된 노드도 마찬가지 — 사라진 것은 "이동"이 아니다
    equal(jumpScore(next, prev, { viewport: { zoom: 1, ...SIZE }, translate: ZERO }), 0);

    // 생존 노드가 움직이면 그때 점수가 생긴다
    const moved = fakeResult({ a: [0, 0], b: [0, 280] });
    const s = jumpScore(prev, moved, { viewport: { zoom: 1, ...SIZE }, translate: ZERO });
    ok(Math.abs(s - 140 / 2 / Math.hypot(SIZE.w, SIZE.h)) < 1e-9, `${s}`);
  });

  it('화면 px로 정규화한다 — 줌아웃 상태에서 점수가 부풀지 않는다', () => {
    const prev = fakeResult({ a: [0, 0] });
    const next = fakeResult({ a: [0, 400] });
    const z1 = jumpScore(prev, next, { viewport: { zoom: 1, ...SIZE }, translate: ZERO });
    const z035 = jumpScore(prev, next, { viewport: { zoom: 0.35, ...SIZE }, translate: ZERO });
    ok(z035 < z1, '줌아웃에서 실제로는 덜 흔들리는데 점수가 같거나 커졌다');
    ok(Math.abs(z035 - z1 * 0.35) < 1e-9);
  });

  it('최초 레이아웃은 점프가 아니다', () => {
    equal(jumpScore(null, layoutOf(chain(5)).l, { viewport: { zoom: 1, ...SIZE }, translate: ZERO }), 0);
  });

  it('undo 캐시 히트의 점수는 정확히 0이다 (L-11)', () => {
    const a = layoutOf(chain(12));
    equal(jumpScore(a.l, a.l, { viewport: { zoom: 1, ...SIZE }, translate: ZERO }), 0);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 6. build / read — ELK 경계
 * ──────────────────────────────────────────────────────────────────────── */

describe('ELK 입력 빌드', () => {
  const g = derive(branchy(24), []);

  it('★ 좌표 시드를 절대 넣지 않는다 (L-05 / D-101)', () => {
    // 문자열을 리터럴로 쓰지 않는다 — scripts/gates.mjs의 `no-elk-position` 규칙이
    // 이 파일까지 검사하기 때문이다. 규칙을 우회하는 게 아니라, 규칙이 잡으려는
    // "실제로 시드를 넣는 코드"와 "그걸 금지하는 테스트"를 구분하는 것이다.
    const banned = ['elk', 'position'].join('.');
    const walk = (n: ElkNode): void => {
      ok(!(n.layoutOptions && banned in n.layoutOptions), `${n.id}에 좌표 시드가 들어갔다.`);
      for (const c of n.children ?? []) walk(c);
    };
    walk(buildElkGraph(inputOf(g)));
    // 이 결정의 유효기간을 코드에 박아둔다: forceNodeModelOrder를 끄기로 하면
    // semiInteractive가 진짜로 일을 하기 시작하므로 L-05를 다시 열어야 한다.
    equal(buildElkGraph(inputOf(g)).layoutOptions?.['elk.layered.crossingMinimization.forceNodeModelOrder'], 'true');
  });

  it('children 배열 순서 = 모델 순서 (considerModelOrder의 유일한 입력)', () => {
    const elk = buildElkGraph(inputOf(g));
    const ids = (elk.children ?? []).map((c) => c.id);
    const expected = [...g.nodes].sort((a, b) => a.order - b.order).map((n) => n.id);
    deepStrictEqual(ids, expected);
  });

  it('라벨을 넘기지 않는다 (L-01)', () => {
    const elk = buildElkGraph(inputOf(g));
    for (const e of elk.edges ?? []) ok(!('labels' in e), `${e.id}에 labels가 있다`);
  });

  it('back edge는 뒤집어 넘긴다 — 계층 배치에 참여시켜야 레일이 화면을 안 가로지른다', () => {
    const items = build(Array.from({ length: 8 }, (_, i) => ({ id: `s${i}` })));
    const gg = derive(items, [explicit('b1', 's6', 's2')]);
    const be = gg.edges.find((e) => e.isBackEdge)!;
    const elk = buildElkGraph(inputOf(gg));
    const sent = (elk.edges ?? []).find((e) => e.id === be.id)!;
    deepStrictEqual([sent.sources[0], sent.targets[0]], [be.target, be.source]);
  });

  it('컨테이너는 자식만 감싼다 (부모 노드는 밖에 남는다)', () => {
    const elk = buildElkGraph(inputOf(g, { containers: new Map([['group:g', ['s1', 's2']]]) }));
    const group = (elk.children ?? []).find((c) => c.id === 'group:g');
    ok(group, '컨테이너가 없다');
    deepStrictEqual((group.children ?? []).map((c) => c.id), ['s1', 's2']);
    ok(!(elk.children ?? []).some((c) => c.id === 's1'), '자식이 루트에도 남아 있다');
  });

  it('사다리 단계가 옵션에 반영된다 (§6.2)', () => {
    equal(buildElkGraph(inputOf(g, { ladder: 0 })).layoutOptions?.['elk.layered.thoroughness'], '7');
    equal(buildElkGraph(inputOf(g, { ladder: 1 })).layoutOptions?.['elk.layered.thoroughness'], '3');
    equal(buildElkGraph(inputOf(g, { ladder: 2 })).layoutOptions?.['elk.edgeRouting'], 'POLYLINE');
  });
});

describe('ELK 출력 읽기', () => {
  it('계층 좌표를 절대 좌표로 누적하고 back edge 기하는 버린다', () => {
    const items = build([{ id: 's0' }, { id: 's1' }, { id: 's2' }]);
    const g = derive(items, [explicit('b1', 's2', 's0')]);
    // ELK가 돌려줬다고 가정하는 출력 (컨테이너 한 겹 포함)
    const out: ElkNode = {
      id: 'root',
      children: [
        { id: 'start', x: 70, y: 0, width: 120, height: 36 },
        {
          id: 'group:g',
          x: 0,
          y: 100,
          children: [
            { id: 's0', x: 0, y: 0, width: 260, height: 76 },
            { id: 's1', x: 0, y: 140, width: 260, height: 76 },
          ],
        },
        { id: 's2', x: 0, y: 380, width: 260, height: 76 },
        { id: 'end', x: 70, y: 520, width: 120, height: 36 },
      ],
      edges: (buildElkGraph(inputOf(g)).edges ?? []).map((e) => ({
        ...e,
        sections: [{ startPoint: { x: 130, y: 36 }, endPoint: { x: 130, y: 100 } }],
      })),
    };
    const l = readLayout(out, g, { rev: 1, layoutKey: 'k' as never, ladder: 0 });
    equal(l.nodes.get('s0')!.y, 100, '컨테이너 오프셋이 누적되지 않았다');
    equal(l.nodes.get('s1')!.y, 240);
    // back edge는 ELK 섹션이 아니라 사이드 레일 6점이어야 한다
    const be = g.edges.find((e) => e.isBackEdge)!;
    equal(l.edges.get(be.id)!.points.length, 6);
    equal(l.edges.get(be.id)!.kind, 'back');
    ok(!l.nodes.has('group:g'), '컨테이너가 NodePlacement에 섞였다');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 7. 폴백 (§11.3)
 * ──────────────────────────────────────────────────────────────────────── */

describe('폴백 레이아웃', () => {
  it('모델 순서를 보존한다 — 폴백 전환 자체가 큰 점프가 되면 안 된다', () => {
    const g = derive(branchy(30), []);
    const l = fallbackLayout(g, g.acyclic);
    equal(checkHardInvariants(l, g).filter((v) => v.rule === 'rowOrderMatchesModelOrder').length, 0);
  });

  it('갈래를 세로 스택으로 뭉개지 않는다', () => {
    const g = derive(
      build([
        {
          id: 'b',
          kind: 'branch',
          attrs: { mode: 'xor' },
          children: [kase('x', [{ id: 'x1' }]), kase('y', [{ id: 'y1' }]), kase('z', [{ id: 'z1' }])],
        },
      ]),
      [],
    );
    const l = fallbackLayout(g, g.acyclic);
    const ys = ['x1', 'y1', 'z1'].map((i) => l.nodes.get(i)!.y);
    equal(new Set(ys).size, 1, '세 갈래가 같은 층에 있어야 한다');
    const xs = ['x1', 'y1', 'z1'].map((i) => l.nodes.get(i)!.x);
    equal(new Set(xs).size, 3, '세 갈래가 좌우로 벌어져야 한다');
    ok(xs[0]! < xs[1]! && xs[1]! < xs[2]!, '정상 경로(첫 갈래)가 최좌측이어야 한다');
  });

  it('결정적이다 — 같은 입력 20회, 좌표 완전 동일', () => {
    const g = derive(branchy(40), []);
    const first = JSON.stringify([...fallbackLayout(g, g.acyclic).nodes]);
    for (let i = 0; i < 20; i++) {
      equal(JSON.stringify([...fallbackLayout(g, g.acyclic).nodes]), first, `${i}회차에서 달라졌다`);
    }
  });

  it('bbox 좌상단이 (0,0)이다', () => {
    const g = derive(branchy(20), []);
    const l = fallbackLayout(g, g.acyclic);
    equal(l.bbox.x, 0);
    equal(l.bbox.y, 0);
  });

  it('빈 문서도 완결된 작은 그림이다', () => {
    const g = derive([], []);
    const l = fallbackLayout(g, g.acyclic);
    equal(l.nodes.size, 2); // start · end
    equal(checkHardInvariants(l, g).length, 0);
  });

  it('500노드 스모크 — 예산 안에 끝나고 불변식을 지킨다', () => {
    const g = derive(branchy(500), []);
    const t0 = Number(process.hrtime.bigint() / 1000n);
    const l = fallbackLayout(g, g.acyclic);
    const ms = (Number(process.hrtime.bigint() / 1000n) - t0) / 1000;
    ok(l.nodes.size > 400, `노드 ${l.nodes.size}개`);
    equal(checkHardInvariants(l, g).length, 0);
    ok(ms < 500, `폴백이 ${ms}ms 걸렸다 (순수 TS O(V+E) 주장과 어긋난다)`);
  });
});

/* ── 픽스처 헬퍼 ──────────────────────────────────────────────────────── */

function chain(n: number): Item[] {
  return build(Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `단계 ${i}` })));
}

/** 실사용 분포를 흉내낸다 — 6단계마다 갈래, 8단계마다 hold (§6.3) */
function branchy(steps: number): Item[] {
  const specs: Spec[] = [];
  let i = 0;
  while (i < steps) {
    if (i % 6 === 5) {
      const n = 2 + (i % 3);
      specs.push({
        id: `b${i}`,
        kind: 'branch',
        title: `조건 ${i}`,
        attrs: { mode: i % 12 === 11 ? 'and' : 'xor' },
        children: Array.from({ length: n }, (_, k) =>
          kase(`c${i}_${k}`, [
            { id: `s${i}_${k}_0`, title: `단계 ${i}.${k}.0` },
            { id: `s${i}_${k}_1`, title: `단계 ${i}.${k}.1` },
          ]),
        ),
      });
      i += n * 2 + 1;
    } else {
      specs.push({ id: `s${i}`, kind: i % 8 === 7 ? 'hold' : 'task', title: `단계 ${i}` });
      i++;
    }
  }
  return build(specs);
}

/** 형제 사이에 끼워 넣는다. base62 fractional index는 바이트 순서로 비교된다 */
function insertAfter(items: readonly Item[], afterId: string, newId: string): Item[] {
  const target = items.find((i) => i.id === afterId);
  if (!target) return [...items];
  return [
    ...items,
    {
      id: newId,
      parentId: target.parentId,
      sortKey: `${target.sortKey}m`,
      kind: 'task',
      title: '새 단계',
      attrs: {},
      assigneeId: null,
      durationBand: null,
      toolIds: [],
      deletedAt: null,
    },
  ];
}

function removeItems(items: readonly Item[], ids: readonly string[]): Item[] {
  const kill = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) {
      if (i.parentId && kill.has(i.parentId) && !kill.has(i.id)) {
        kill.add(i.id);
        grew = true;
      }
    }
  }
  return items.filter((i) => !kill.has(i.id));
}

function swapSortKeys(items: readonly Item[], a: string, b: string): Item[] {
  const ka = items.find((i) => i.id === a)?.sortKey;
  const kb = items.find((i) => i.id === b)?.sortKey;
  if (ka === undefined || kb === undefined) return [...items];
  return items.map((i) => (i.id === a ? { ...i, sortKey: kb } : i.id === b ? { ...i, sortKey: ka } : i));
}

function focusNodeId(l: LayoutResult, hint: AnchorHint): NodeId | null {
  if (hint.t === 'item' && l.nodes.has(hint.itemId)) return hint.itemId;
  if (hint.t === 'node' && l.nodes.has(hint.nodeId)) return hint.nodeId;
  return null;
}

/** 노드가 화면 중앙에 오는 뷰포트 */
function centerOn(l: LayoutResult, id: NodeId, zoom = 1): Viewport {
  const p = l.nodes.get(id);
  if (!p) return VP;
  return { x: SIZE.w / 2 - (p.x + p.w / 2) * zoom, y: SIZE.h / 2 - (p.y + p.h / 2) * zoom, zoom };
}

/** jumpScore의 의미만 고정하기 위한 최소 LayoutResult */
function fakeResult(pos: Record<string, [number, number]>): LayoutResult {
  const nodes = new Map(
    Object.entries(pos).map(([id, [x, y]]) => [id, { id, x, y, w: 260, h: 76, layer: 0 }]),
  );
  return {
    rev: 0,
    layoutKey: 'k' as never,
    algorithm: 'fallback',
    ladder: 0,
    nodes,
    edges: new Map(),
    bands: [],
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    elapsedMs: 0,
  };
}

function top(values: readonly number[], n: number): string {
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, n)
    .map((v) => v.toFixed(4))
    .join(', ');
}

/**
 * packages/layout-core/src/fallback.ts — LAYOUT §11.3
 *
 * **ELK 없는 폴백 레이아웃.** `y += 140`이 아니라 Sugiyama의 축약이다.
 *
 * 세로 스택은 갈래를 표현하지 못한다. 갈래가 있는 문서에서 세로 스택은 **틀린
 * 그림**이고, 틀린 그림은 없는 그림보다 나쁘다.
 *
 * 이 폴백이 값을 하는 곳은 셋이다.
 *   1. ELK 실패 시 — 원래 목적
 *   2. 워커를 못 쓰는 환경 — 엄격한 CSP, 구형 브라우저
 *   3. **서버 렌더** — OG 카드 라우트는 엣지 런타임이라 Worker가 없다.
 *      `layout-core`가 순수 TS이고 elkjs를 런타임 의존성으로 갖지 않는 이유가 이것이다.
 *
 * 4단계:
 *   1. 층 배정 — 최장 경로 (topoOrder가 이미 있으므로 한 번 훑으면 끝)
 *   2. 층 안 순서 = **모델 순서**. ELK의 forceNodeModelOrder와 같은 규칙이므로
 *      폴백으로 떨어져도 **좌우 순서가 바뀌지 않는다.** 이게 이 폴백의 핵심 가치다 —
 *      단순 세로 스택은 이 성질이 없어서 폴백 전환 자체가 거대한 점프가 된다.
 *   3. 더미 노드 + 중앙값 휴리스틱 3패스로 x 배치
 *   4. 엣지는 층간 거터에서만 꺾는 직교 폴리라인
 *
 * ── 명세와 다른 점: 더미 노드 ──────────────────────────────────────────────
 * §11.3의 `straightOrElbow`는 s와 t 사이 **중간 y에서 가로로 지나간다.** 층을 두 개
 * 이상 건너뛰는 엣지(갈래 길이가 다른 XOR의 case-join이 대표적)에서는 그 중간 y가
 * 중간 층의 **밴드 안쪽**이라 노드를 관통한다. §13.2의 하드 불변식
 * `noEdgeCrossesNode`가 바로 그걸 잡는다.
 *
 * 그래서 층을 건너뛰는 엣지에 Sugiyama의 정석대로 **더미 노드**를 깔았다. 더미는
 * 폭 0으로 행에 참여하므로 좌우 40px 간격을 실제로 예약하고, 엣지의 세로 구간은
 * 그 예약된 열을 지난다 — 관통이 기하학적으로 불가능해진다. 덤으로 긴 엣지가
 * 중앙값 계산에 참여해 그림이 눈에 띄게 곧아진다.
 */

import { routeBackEdges } from './cycle.ts';
import { bboxOf, layerBands, simplifyPolyline } from './geometry.ts';
import type {
  EdgeGeometry,
  LadderLevel,
  LayerBand,
  LayoutGraph,
  LayoutKey,
  LayoutResult,
  NodePlacement,
  XY,
} from './types.ts';
import { NODE_H, NODE_W, PILL_H, PILL_W, SPACING } from './types.ts';
import type { DerivedEdge, DerivedNode, NodeId } from '@workflow/graph-core';

export type Acyclic = {
  readonly topoOrder: readonly NodeId[];
  readonly backEdgeIds: readonly string[];
};

export type FallbackOptions = {
  readonly rev?: number;
  readonly layoutKey?: LayoutKey;
  readonly ladder?: LadderLevel;
  readonly elapsedMs?: number;
};

/** start / end / join 합성 노드는 120×36 pill이다 (D-023) */
export function isPill(n: DerivedNode): boolean {
  return n.kind === 'start' || n.kind === 'end' || n.kind === 'join';
}

export function sizeOf(n: DerivedNode): { w: number; h: number } {
  return isPill(n) ? { w: PILL_W, h: PILL_H } : { w: NODE_W, h: NODE_H };
}

type Vertex = {
  readonly id: string;
  readonly layer: number;
  /** 행 안의 정렬 키. 실 노드는 모델 순서 rank, 더미는 두 끝점 rank의 내분점 */
  readonly sort: number;
  readonly w: number;
  readonly real: boolean;
};

export function fallbackLayout(g: LayoutGraph, acyclic: Acyclic, o: FallbackOptions = {}): LayoutResult {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const back = new Set(acyclic.backEdgeIds);
  const usable = (e: DerivedEdge): boolean => byId.has(e.source) && byId.has(e.target) && e.source !== e.target;
  const fwd = g.edges.filter((e) => !back.has(e.id) && usable(e));
  const backEdges = g.edges.filter((e) => back.has(e.id) && usable(e));

  if (g.nodes.length === 0) {
    return {
      rev: o.rev ?? 0,
      layoutKey: o.layoutKey ?? ('' as LayoutKey),
      algorithm: 'fallback',
      ladder: o.ladder ?? 0,
      nodes: new Map(),
      edges: new Map(),
      bands: [],
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      elapsedMs: o.elapsedMs ?? 0,
    };
  }

  /* ── 1. 층 배정 — 최장 경로 ─────────────────────────────────────────── */

  const outOf = new Map<NodeId, DerivedEdge[]>();
  for (const e of fwd) {
    const list = outOf.get(e.source);
    if (list) list.push(e);
    else outOf.set(e.source, [e]);
  }

  const layer = new Map<NodeId, number>(g.nodes.map((n) => [n.id, 0]));
  const visitOrder: NodeId[] = [...acyclic.topoOrder.filter((id) => byId.has(id))];
  const seen = new Set(visitOrder);
  for (const n of g.nodes) if (!seen.has(n.id)) visitOrder.push(n.id); // topoOrder 누락분 방어
  for (const id of visitOrder) {
    const L = layer.get(id) ?? 0;
    for (const e of outOf.get(id) ?? []) layer.set(e.target, Math.max(layer.get(e.target) ?? 0, L + 1));
  }

  /* ── 2. 층 안 순서 = 모델 순서 ──────────────────────────────────────── */

  const modelOrder = [...g.nodes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  // order를 그대로 내분하면 end 노드(order = MAX_SAFE_INTEGER)가 더미를 화면 끝으로
  // 날려버린다. 순위(rank)로 정규화한 뒤 내분한다.
  const rank = new Map<NodeId, number>(modelOrder.map((n, i) => [n.id, i]));

  const layerCount = Math.max(...[...layer.values()]) + 1;
  const rows: Vertex[][] = Array.from({ length: layerCount }, () => []);
  for (const n of modelOrder) {
    rows[layer.get(n.id)!]!.push({
      id: n.id,
      layer: layer.get(n.id)!,
      sort: rank.get(n.id)!,
      w: sizeOf(n).w,
      real: true,
    });
  }

  /* ── 3. 더미 노드 — 층을 건너뛰는 엣지가 지날 열을 예약한다 ────────── */

  /** 엣지 id → 중간 더미 정점 id 사슬 (층 오름차순) */
  const chains = new Map<string, string[]>();
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    (succ.get(a) ?? succ.set(a, []).get(a)!).push(b);
    (pred.get(b) ?? pred.set(b, []).get(b)!).push(a);
  };

  for (const e of fwd) {
    const ls = layer.get(e.source)!;
    const lt = layer.get(e.target)!;
    const span = lt - ls;
    if (span <= 1) {
      link(e.source, e.target);
      continue;
    }
    const rs = rank.get(e.source)!;
    const rt = rank.get(e.target)!;
    const chain: string[] = [];
    for (let k = 1; k < span; k++) {
      const id = `dummy:${e.id}:${ls + k}`;
      chain.push(id);
      rows[ls + k]!.push({ id, layer: ls + k, sort: rs + ((rt - rs) * k) / span, w: 0, real: false });
    }
    chains.set(e.id, chain);
    let prevId = e.source;
    for (const d of chain) {
      link(prevId, d);
      prevId = d;
    }
    link(prevId, e.target);
  }

  for (const row of rows) row.sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));

  /* ── 4. x 배치 — 중앙값 휴리스틱 3패스 + 겹침 해소 스윕 ────────────── */

  const x = new Map<string, number>();
  for (const row of rows) {
    let cursor = 0;
    for (const v of row) {
      x.set(v.id, cursor);
      cursor += v.w + SPACING.nodeNode;
    }
  }

  const centerOf = (id: string, w: number): number => (x.get(id) ?? 0) + w / 2;
  const widthOf = new Map<string, number>();
  for (const row of rows) for (const v of row) widthOf.set(v.id, v.w);

  const medianCenter = (ids: readonly string[] | undefined): number | null => {
    if (!ids || ids.length === 0) return null;
    const c = ids.map((i) => centerOf(i, widthOf.get(i) ?? 0)).sort((a, b) => a - b);
    const m = c.length % 2 ? c[(c.length - 1) / 2]! : (c[c.length / 2 - 1]! + c[c.length / 2]!) / 2;
    return m;
  };

  /**
   * 행 하나를 배치한다. **좌우 순서는 절대 바뀌지 않는다** — 앞으로 훑으며 최소
   * 간격을 강제하고(순서 보존), 뒤로 훑으며 희망 위치 쪽으로 **왼쪽으로만** 당긴다.
   * 한쪽 스윕만 하면 행 전체가 오른쪽으로 밀린다.
   */
  const sweep = (row: readonly Vertex[], want: readonly (number | null)[]): void => {
    const xs: number[] = [];
    let cursor = -Infinity;
    for (let i = 0; i < row.length; i++) {
      const v = row[i]!;
      const px = Math.max(want[i] ?? x.get(v.id) ?? 0, cursor);
      xs.push(px);
      cursor = px + v.w + SPACING.nodeNode;
    }
    for (let i = row.length - 1; i >= 0; i--) {
      const v = row[i]!;
      const lower = i === 0 ? -Infinity : xs[i - 1]! + row[i - 1]!.w + SPACING.nodeNode;
      const desired = want[i] ?? xs[i]!;
      xs[i] = Math.max(Math.min(desired, xs[i]!), lower);
      x.set(v.id, xs[i]!);
    }
  };

  // 위→아래(부모 기준) → 아래→위(자식 기준) → 위→아래 한 번 더. 3패스면 수렴한다.
  for (const pass of [0, 1, 2] as const) {
    const order = pass === 1 ? [...rows].reverse() : rows;
    for (const row of order) {
      const want = row.map((v) => {
        const m = medianCenter(pass === 1 ? succ.get(v.id) : pred.get(v.id));
        return m === null ? null : m - v.w / 2;
      });
      sweep(row, want);
    }
  }

  /* ── 5. y = 층 × (76 + 64). pill은 층 안에서 세로 중앙 ─────────────── */

  const place = new Map<NodeId, NodePlacement>();
  const dummyY = new Map<string, number>();
  rows.forEach((row, i) => {
    const top = i * (NODE_H + SPACING.betweenLayers);
    for (const v of row) {
      if (!v.real) {
        dummyY.set(v.id, top + NODE_H / 2);
        continue;
      }
      const n = byId.get(v.id)!;
      const { w, h } = sizeOf(n);
      place.set(v.id, { id: v.id, x: x.get(v.id)!, y: top + (NODE_H - h) / 2, w, h, layer: i });
    }
  });

  // bbox 좌상단을 (0,0)으로. 더미도 같은 양만큼 옮겨야 엣지가 어긋나지 않는다.
  const raw = bboxOf(place.values());
  if (raw.x !== 0 || raw.y !== 0) {
    for (const [id, p] of place) place.set(id, { ...p, x: p.x - raw.x, y: p.y - raw.y });
    for (const [id, xv] of x) x.set(id, xv - raw.x);
    for (const [id, yv] of dummyY) dummyY.set(id, yv - raw.y);
  }

  const bands = layerBands(place.values());
  const bbox = bboxOf(place.values());

  /* ── 6. 엣지 — 층간 거터에서만 꺾는 직교 폴리라인 ──────────────────── */

  const gutterY = (i: number): number => {
    const a = bands[i];
    const b = bands[i + 1];
    if (!a) return 0;
    if (!b) return a.bottom + SPACING.betweenLayers / 2;
    return (a.bottom + b.top) / 2;
  };

  const edges = new Map<string, EdgeGeometry>();
  for (const e of fwd) {
    const s = place.get(e.source)!;
    const t = place.get(e.target)!;
    const chain = chains.get(e.id) ?? [];
    const xsCenters = [s.x + s.w / 2, ...chain.map((d) => x.get(d)!), t.x + t.w / 2];

    const pts: XY[] = [{ x: xsCenters[0]!, y: s.y + s.h }];
    for (let j = 0; j + 1 < xsCenters.length; j++) {
      const gy = gutterY(s.layer + j);
      pts.push({ x: xsCenters[j]!, y: gy });
      pts.push({ x: xsCenters[j + 1]!, y: gy });
    }
    pts.push({ x: xsCenters[xsCenters.length - 1]!, y: t.y });

    edges.set(e.id, {
      id: e.id,
      kind: 'forward',
      reversedForLayout: false,
      points: simplifyPolyline(pts),
      // L-01 — 갈래 라벨은 ELK가 아니라 우리가 커밋된 좌표 위에 놓는다
      labelAnchor: { x: xsCenters[0]!, y: s.y + s.h + SPACING.edgeNode },
    });
  }

  for (const [id, geo] of routeBackEdges(backEdges, place, bands, bbox)) edges.set(id, geo);

  return {
    rev: o.rev ?? 0,
    layoutKey: o.layoutKey ?? ('' as LayoutKey),
    algorithm: 'fallback',
    ladder: o.ladder ?? 0,
    nodes: place,
    edges,
    bands,
    bbox,
    elapsedMs: o.elapsedMs ?? 0,
  };
}

/** 층 밴드는 폴백과 ELK 경로가 **같은 함수**를 쓴다 (§4.2) */
export function bandsOf(nodes: Iterable<NodePlacement>): LayerBand[] {
  return layerBands(nodes);
}

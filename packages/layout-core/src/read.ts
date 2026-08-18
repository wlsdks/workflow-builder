/**
 * packages/layout-core/src/read.ts — LAYOUT §1.4 · §4.2
 *
 * ELK 출력 → `LayoutResult`.
 *
 * **여기와 build.ts만이 ELK의 형태를 안다.** 하는 일은 넷이다.
 *   1. 계층을 평탄화하며 상대 좌표를 절대 좌표로 누적한다
 *   2. 층 밴드를 y값 클러스터링으로 역산한다 (ELK는 층 번호를 주지 않는다)
 *   3. 정방향 엣지의 sections를 실제 방향(source→target) 폴리라인으로 옮긴다
 *   4. **back edge의 ELK 기하는 통째로 버리고** 사이드 레일로 다시 그린다 (L-04)
 */

import { routeBackEdges } from './cycle.ts';
import { bandIndexOf, bboxOf, layerBands, simplifyPolyline } from './geometry.ts';
import { sizeOf } from './fallback.ts';
import { SPACING } from './types.ts';
import type {
  EdgeGeometry,
  ElkExtendedEdge,
  ElkNode,
  LadderLevel,
  LayoutGraph,
  LayoutKey,
  LayoutResult,
  NodePlacement,
  XY,
} from './types.ts';
import type { DerivedEdge, NodeId } from '@workflow/graph-core';

export type ReadMeta = {
  readonly rev: number;
  readonly layoutKey: LayoutKey;
  readonly algorithm?: 'elk' | 'fallback';
  readonly ladder: LadderLevel;
  readonly elapsedMs?: number;
};

/** 계층을 평탄화한다. ELK의 자식 좌표는 부모 상대이므로 오프셋을 누적한다 */
function flatten(root: ElkNode, out: Map<NodeId, { x: number; y: number; w: number; h: number }>): void {
  const walk = (n: ElkNode, ox: number, oy: number): void => {
    const x = ox + (n.x ?? 0);
    const y = oy + (n.y ?? 0);
    if (n !== root) out.set(n.id, { x, y, w: n.width ?? 0, h: n.height ?? 0 });
    for (const c of n.children ?? []) walk(c, x, y);
  };
  walk(root, 0, 0);
}

function sectionPoints(e: ElkExtendedEdge): XY[] {
  const s = e.sections?.[0];
  if (!s) return [];
  return [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
}

function collectElkEdges(root: ElkNode, out: Map<string, ElkExtendedEdge>): void {
  const walk = (n: ElkNode): void => {
    for (const e of n.edges ?? []) out.set(e.id, e);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

export function readLayout(out: ElkNode, graph: LayoutGraph, meta: ReadMeta, acyclicBackEdgeIds?: readonly string[]): LayoutResult {
  const flat = new Map<NodeId, { x: number; y: number; w: number; h: number }>();
  flatten(out, flat);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // 1) 노드 좌표. 컨테이너 노드는 좌표 맵에 남지만 크기가 260×76이 아니므로
  //    NodePlacement에는 실 노드만 넣는다 — 하드 불변식 `allNodesSized`의 전제다.
  const place = new Map<NodeId, NodePlacement>();
  for (const [id, r] of flat) {
    const n = byId.get(id);
    if (!n) continue;
    const { w, h } = sizeOf(n);
    place.set(id, { id, x: r.x, y: r.y, w: r.w || w, h: r.h || h, layer: 0 });
  }

  // 2) 층 밴드 — ELK가 층 번호를 주지 않으므로 기하에서 역산한다.
  //    폴백 레이아웃과 **같은 함수**를 쓴다.
  const bands = layerBands(place.values());
  for (const [id, p] of place) place.set(id, { ...p, layer: bandIndexOf(bands, p) });

  const bbox = bboxOf(place.values());

  // 3) 엣지
  const backSet = new Set(acyclicBackEdgeIds ?? graph.edges.filter((e) => e.isBackEdge).map((e) => e.id));
  const elkEdges = new Map<string, ElkExtendedEdge>();
  collectElkEdges(out, elkEdges);

  const edges = new Map<string, EdgeGeometry>();
  for (const e of graph.edges) {
    if (backSet.has(e.id)) continue; // 4)에서 다시 그린다
    const s = place.get(e.source);
    const t = place.get(e.target);
    if (!s || !t) continue;
    const raw = sectionPoints(elkEdges.get(e.id) ?? { id: e.id, sources: [], targets: [] });
    const points = raw.length >= 2 ? simplifyPolyline(raw) : elbowFallback(s, t);
    edges.set(e.id, {
      id: e.id,
      kind: 'forward',
      reversedForLayout: false,
      points,
      labelAnchor: { x: points[0]!.x, y: points[0]!.y + SPACING.edgeNode },
    });
  }

  // 4) back edge — ELK 기하를 **버리고** 우측 사이드 레일로 (L-04 · D-103)
  const backEdges: DerivedEdge[] = graph.edges.filter((e) => backSet.has(e.id) && place.has(e.source) && place.has(e.target));
  for (const [id, geo] of routeBackEdges(backEdges, place, bands, bbox)) edges.set(id, geo);

  return {
    rev: meta.rev,
    layoutKey: meta.layoutKey,
    algorithm: meta.algorithm ?? 'elk',
    ladder: meta.ladder,
    nodes: place,
    edges,
    bands,
    bbox,
    elapsedMs: meta.elapsedMs ?? 0,
  };
}

/** ELK가 섹션을 주지 않은 엣지(라우팅 실패·POLYLINE 모드)의 최소 기하 */
function elbowFallback(s: NodePlacement, t: NodePlacement): XY[] {
  const x0 = s.x + s.w / 2;
  const x1 = t.x + t.w / 2;
  const y0 = s.y + s.h;
  const y1 = t.y;
  const mid = (y0 + y1) / 2;
  return simplifyPolyline([
    { x: x0, y: y0 },
    { x: x0, y: mid },
    { x: x1, y: mid },
    { x: x1, y: y1 },
  ]);
}

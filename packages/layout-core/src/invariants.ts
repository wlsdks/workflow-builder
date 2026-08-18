/**
 * packages/layout-core/src/invariants.ts — LAYOUT §13.2 · L-09 · D-107
 *
 * **좌표를 고정하지 않는다. 의미 불변식을 고정한다.**
 *
 * 좌표 스냅샷은 elkjs 패치 버전, GWT 런타임 변경, 심지어 부동소수 연산 순서에도
 * 깨진다. 그리고 깨진 이유가 "버그"인지 "무해한 변화"인지 스냅샷 자체는 말해주지
 * 않는다. 빨간 CI가 반복되면 사람은 `--update-snapshots`를 반사적으로 누르고,
 * 그 순간 스냅샷 테스트는 가치가 0이 아니라 **음수**가 된다.
 *
 * 여기 있는 것은 전부 **사용자가 실제로 지각하는 성질**이다.
 */

import { EPS, bandIndexOf, rectsOverlap, segmentEntersRect, segments } from './geometry.ts';
import { verifyBackEdgeRouting } from './cycle.ts';
import { NODE_H, NODE_W, PILL_H, PILL_W, SPACING } from './types.ts';
import type { LayoutResult, NodePlacement } from './types.ts';
import type { DerivedEdge, DerivedGraph, NodeId } from '@workflow/graph-core';

/* ────────────────────────────────────────────────────────────────────────
 * 골든 불변식 — 픽스처별로 고정한다
 * ──────────────────────────────────────────────────────────────────────── */

export type Invariants = {
  /** 노드 → 층 번호. 층 배정은 결정적이고, 바뀌면 진짜 변화다 */
  readonly layers: Readonly<Record<NodeId, number>>;
  /** 각 층의 좌→우 노드 순서. **모델 순서 보장의 직접 증명** — 가장 중요한 불변식 */
  readonly rowOrder: readonly (readonly NodeId[])[];
  /** 갈래별 첫 노드의 좌우 순서 = 사용자가 쓴 순서 */
  readonly caseOrder: Readonly<Record<NodeId, readonly NodeId[]>>;
  /** 정상 경로(첫 갈래)가 최좌측인가 (DESIGN §6.5) */
  readonly happyPathLeftmost: boolean;
  /** bbox 종횡비. ±15%까지 허용 */
  readonly aspect: number;
};

export function layoutInvariants(l: LayoutResult, g: DerivedGraph): Invariants {
  const layers: Record<NodeId, number> = {};
  for (const [id, p] of l.nodes) layers[id] = p.layer;

  return {
    layers,
    rowOrder: rowsOf(l).map((r) => r.map((p) => p.id)),
    caseOrder: caseFirstNodesLeftToRight(l, g),
    happyPathLeftmost: isHappyPathLeftmost(l, g),
    aspect: l.bbox.h === 0 ? 0 : Math.round((l.bbox.w / l.bbox.h) * 100) / 100,
  };
}

/** 층별 노드를 좌→우로 */
export function rowsOf(l: LayoutResult): NodePlacement[][] {
  const rows: NodePlacement[][] = [];
  for (const p of l.nodes.values()) (rows[p.layer] ??= []).push(p);
  for (const r of rows) r.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  return rows.map((r) => r ?? []);
}

/** 분기 노드 → 각 갈래 첫 노드들 (좌→우) */
export function caseFirstNodesLeftToRight(l: LayoutResult, g: DerivedGraph): Record<NodeId, NodeId[]> {
  const out: Record<NodeId, NodeId[]> = {};
  for (const [branch, targets] of caseEdgesByBranch(g)) {
    const withX = targets
      .map((t) => ({ t, p: l.nodes.get(t) }))
      .filter((e): e is { t: NodeId; p: NodePlacement } => !!e.p)
      .sort((a, b) => a.p.x - b.p.x || (a.t < b.t ? -1 : 1));
    if (withX.length > 0) out[branch] = withX.map((e) => e.t);
  }
  return out;
}

function caseEdgesByBranch(g: DerivedGraph): Map<NodeId, NodeId[]> {
  const m = new Map<NodeId, NodeId[]>();
  for (const e of g.edges) {
    if (e.reason !== 'branch-case' && e.reason !== 'and-fork') continue;
    const list = m.get(e.source);
    if (list) list.push(e.target);
    else m.set(e.source, [e.target]);
  }
  // 모델 순서로 정렬해 둔다 — "사용자가 쓴 순서"의 기준
  for (const [k, v] of m) {
    m.set(
      k,
      v.sort((a, b) => (g.byId.get(a)?.order ?? 0) - (g.byId.get(b)?.order ?? 0)),
    );
  }
  return m;
}

/**
 * 정상 경로 = 첫 갈래가 최좌측 (DESIGN §6.5).
 *
 * 같은 층에 있는 갈래 첫 노드끼리만 비교한다 — 갈래 길이가 달라 첫 노드가 다른
 * 층에 놓이면 "좌우"라는 말 자체가 정의되지 않는다.
 */
export function isHappyPathLeftmost(l: LayoutResult, g: DerivedGraph): boolean {
  for (const [, targets] of caseEdgesByBranch(g)) {
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = l.nodes.get(targets[i]!);
        const b = l.nodes.get(targets[j]!);
        if (!a || !b || a.layer !== b.layer) continue;
        if (a.x >= b.x) return false; // 모델 순서가 앞선 갈래가 오른쪽에 있다
      }
    }
  }
  return true;
}

/* ────────────────────────────────────────────────────────────────────────
 * 하드 불변식 — 어떤 픽스처에서도 위반하면 안 되는 것들.
 * 골든과 무관하게 항상 검사한다.
 * ──────────────────────────────────────────────────────────────────────── */

export type Violation = { readonly rule: string; readonly detail: string };

export type HardInvariantOptions = {
  /** 엣지-노드 관통 허용오차 (px) */
  readonly edgeTolerance?: number;
  /** 노드 겹침 허용오차 (px) */
  readonly overlapTolerance?: number;
};

export function checkHardInvariants(
  l: LayoutResult,
  g: DerivedGraph,
  o: HardInvariantOptions = {},
): Violation[] {
  const v: Violation[] = [];
  v.push(...noNodeOverlap(l, o.overlapTolerance ?? 0));
  v.push(...minGapInRow(l, SPACING.nodeNode - 0.5));
  v.push(...allNodesSized(l));
  v.push(...layersMatchTopology(l, g));
  v.push(...rowOrderMatchesModelOrder(l, g));
  v.push(...noEdgeCrossesNode(l, o.edgeTolerance ?? 2));
  v.push(...allArrowsEnterFromTop(l, g));
  v.push(...allBackEdgesOnRail(l, g));
  if (!isHappyPathLeftmost(l, g)) {
    v.push({ rule: 'happyPathLeftmost', detail: '정상 경로(첫 갈래)가 최좌측이 아니다' });
  }
  return v;
}

export function noNodeOverlap(l: LayoutResult, tolerance = 0): Violation[] {
  const all = [...l.nodes.values()];
  const out: Violation[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (rectsOverlap(a, b, tolerance)) {
        out.push({ rule: 'noNodeOverlap', detail: `${a.id} ↔ ${b.id}` });
      }
    }
  }
  return out;
}

/** 같은 층 안 좌우 간격. 층이 다르면 x가 겹쳐도 정상이다 */
export function minGapInRow(l: LayoutResult, minGap: number): Violation[] {
  const out: Violation[] = [];
  for (const row of rowsOf(l)) {
    for (let i = 0; i + 1 < row.length; i++) {
      const a = row[i]!;
      const b = row[i + 1]!;
      const gap = b.x - (a.x + a.w);
      if (gap < minGap) out.push({ rule: 'minGapInRow', detail: `${a.id} → ${b.id} 간격 ${gap.toFixed(1)}px` });
    }
  }
  return out;
}

export function allNodesSized(l: LayoutResult): Violation[] {
  const out: Violation[] = [];
  for (const p of l.nodes.values()) {
    const ok = (p.w === NODE_W && p.h === NODE_H) || (p.w === PILL_W && p.h === PILL_H);
    if (!ok) out.push({ rule: 'allNodesSized', detail: `${p.id} = ${p.w}×${p.h} (260×76 / 120×36이 아니다)` });
  }
  return out;
}

/** 층 배정이 위상 순서와 일치하는가 — 모든 정방향 엣지가 아래로 흐른다 */
export function layersMatchTopology(l: LayoutResult, g: DerivedGraph): Violation[] {
  const out: Violation[] = [];
  for (const e of g.edges) {
    if (e.isBackEdge) continue;
    const s = l.nodes.get(e.source);
    const t = l.nodes.get(e.target);
    if (!s || !t) continue;
    if (t.layer <= s.layer) {
      out.push({ rule: 'layersMatchTopology', detail: `${e.id}: ${e.source}(L${s.layer}) → ${e.target}(L${t.layer})` });
    }
  }
  return out;
}

/**
 * 층 안 좌우 순서가 모델 순서와 일치하는가.
 *
 * "내 글이 그림이 됐다"의 유일한 근거이고, 사용자가 지각하는 안정성의 90%다 (§5.2).
 */
export function rowOrderMatchesModelOrder(l: LayoutResult, g: DerivedGraph): Violation[] {
  const out: Violation[] = [];
  for (const row of rowsOf(l)) {
    for (let i = 0; i + 1 < row.length; i++) {
      const a = g.byId.get(row[i]!.id);
      const b = g.byId.get(row[i + 1]!.id);
      if (!a || !b) continue;
      if (a.order > b.order) {
        out.push({
          rule: 'rowOrderMatchesModelOrder',
          detail: `층 ${row[i]!.layer}: ${a.id}(order ${a.order})가 ${b.id}(order ${b.order})의 왼쪽에 있다`,
        });
      }
    }
  }
  return out;
}

/** `noEdgeCrossesNode` — §4.2의 증명을 런타임으로 재확인한다 */
export function noEdgeCrossesNode(l: LayoutResult, tolerance = 2): Violation[] {
  const out: Violation[] = [];
  const nodes = [...l.nodes.values()];
  for (const geo of l.edges.values()) {
    for (const [a, b] of segments(geo.points)) {
      for (const n of nodes) {
        if (segmentEntersRect(a, b, n, tolerance)) {
          out.push({
            rule: 'noEdgeCrossesNode',
            detail: `엣지 ${geo.id}의 선분 (${a.x.toFixed(0)},${a.y.toFixed(0)})→(${b.x.toFixed(0)},${b.y.toFixed(0)})가 노드 ${n.id}를 관통`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * 모든 화살표가 노드 **상단**으로 들어오는가.
 *
 * 12단계 문서에서 되돌아가는 화살표 하나가 다른 규칙으로 그려지면 사용자는 그 선을
 * 읽는 데 실패한다 (§4.2).
 */
export function allArrowsEnterFromTop(l: LayoutResult, g: DerivedGraph): Violation[] {
  const out: Violation[] = [];
  const edgeById = new Map(g.edges.map((e) => [e.id, e]));
  for (const geo of l.edges.values()) {
    const e = edgeById.get(geo.id);
    if (!e) continue;
    const t = l.nodes.get(e.target);
    if (!t || geo.points.length < 2) continue;
    const last = geo.points[geo.points.length - 1]!;
    const prev = geo.points[geo.points.length - 2]!;
    if (Math.abs(last.y - t.y) > 1) {
      out.push({ rule: 'allArrowsEnterFromTop', detail: `${geo.id}: 끝점 y=${last.y} ≠ target.top=${t.y}` });
      continue;
    }
    if (last.x < t.x - 1 || last.x > t.x + t.w + 1) {
      out.push({ rule: 'allArrowsEnterFromTop', detail: `${geo.id}: 끝점 x=${last.x}가 target 상단 변 밖` });
    }
    if (prev.y >= last.y - EPS) {
      out.push({ rule: 'allArrowsEnterFromTop', detail: `${geo.id}: 마지막 선분이 아래에서 위로 들어온다` });
    }
  }
  return out;
}

/** back edge가 레일 밖으로 나갔는가 (§4.2) */
export function allBackEdgesOnRail(l: LayoutResult, g: DerivedGraph): Violation[] {
  const out: Violation[] = [];
  const edgeById = new Map<string, DerivedEdge>(g.edges.map((e) => [e.id, e]));
  const nodes = [...l.nodes.values()];
  for (const geo of l.edges.values()) {
    if (geo.kind !== 'back') continue;
    const e = edgeById.get(geo.id);
    if (!e) continue;
    const s = l.nodes.get(e.source);
    const t = l.nodes.get(e.target);
    if (!s || !t) continue;
    for (const v of verifyBackEdgeRouting(geo, s, t, nodes, l.bbox)) {
      out.push({ rule: `allBackEdgesOnRail/${v.kind}`, detail: `${v.edgeId}: ${v.detail}` });
    }
  }
  return out;
}

/** 밴드 인덱스가 placement.layer와 일치하는가 — 거터 계산이 이것에 의존한다 */
export function bandsMatchLayers(l: LayoutResult): Violation[] {
  const out: Violation[] = [];
  for (const p of l.nodes.values()) {
    const i = bandIndexOf(l.bands, p);
    if (i !== p.layer) out.push({ rule: 'bandsMatchLayers', detail: `${p.id}: layer ${p.layer} ≠ band ${i}` });
  }
  return out;
}

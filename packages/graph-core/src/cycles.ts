/**
 * packages/graph-core/src/cycles.ts
 *
 * §5 사이클 처리.
 *
 * 사이클은 **버그가 아니라 기능이다.** "반려되면 3번으로 돌아감"이 자동화 ROI
 * 1위인 재작업 루프이고, 이 제품이 프로세스 마이닝 대비 갖는 유일한 관측 우위다.
 *
 * 문제는 두 곳에서만 생긴다.
 *   1) ELK layered 는 DAG를 전제한다
 *   2) 리드타임 계산이 무한 루프에 빠질 수 있다
 *
 * 둘 다 **여기서** 해결한다. 다운스트림(레이아웃·메트릭·익스포터)은 항상 DAG만 본다.
 *
 * ELK 자체의 cycleBreaking에 맡기지 않는 이유: ELK의 휴리스틱은 입력 순서에
 * 민감해서 같은 문서가 다른 순서로 들어오면 다른 엣지를 뒤집는다 →
 * 레이아웃 점프(D-024가 막으려는 바로 그것). 우리가 결정적으로 끊고
 * `elk.layered.cycleBreaking.strategy: 'MODEL_ORDER'` 를 이중 안전장치로 둔다.
 */

import type {
  CycleInfo,
  DeriveOptions,
  DerivedEdge,
  DerivedNode,
  Diagnostic,
  NodeId,
} from './types.ts';
import { START_ID, cycleId } from './ids.ts';
import { clamp, round } from './util.ts';

const DEFAULT_MAX_REWORK_RATE = 0.95; // → 기대 추가 반복 19회에서 절단
const DEFAULT_MAX_CYCLES = 32;

export type CycleAnalysis = {
  topoOrder: NodeId[];
  backEdgeIds: string[];
  cycles: CycleInfo[];
};

export function analyzeCycles(
  nodes: readonly DerivedNode[],
  edges: readonly DerivedEdge[],
  outgoing: ReadonlyMap<NodeId, readonly DerivedEdge[]>,
  rank: ReadonlyMap<NodeId, number>,
  options: DeriveOptions,
  diag: (d: Diagnostic) => void,
): CycleAnalysis {
  const maxRate = options.maxReworkRate ?? DEFAULT_MAX_REWORK_RATE;
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;

  /* ── 1. 결정적 DFS로 back edge 확정 ──────────────────────────────────────
   * 결정성의 근거 2가지:
   *   - 시작점 순서가 [start, 그다음 정규 순서] 로 고정
   *   - 각 노드의 out-edge가 (target rank, edge id) 로 정렬되어 있음
   * 따라서 같은 items/edges 입력이면 항상 같은 엣지가 back edge가 된다. */

  const color = new Map<NodeId, 0 | 1 | 2>();
  const backEdgeIds: string[] = [];

  const dfs = (root: NodeId): void => {
    color.set(root, 1);
    const stack: Array<{ v: NodeId; i: number }> = [{ v: root, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outs = outgoing.get(top.v) ?? [];
      if (top.i >= outs.length) {
        color.set(top.v, 2);
        stack.pop();
        continue;
      }
      const e = outs[top.i++]!;
      const c = color.get(e.target) ?? 0;
      if (c === 1) {
        (e as { isBackEdge: boolean }).isBackEdge = true;
        backEdgeIds.push(e.id);
      } else if (c === 0) {
        color.set(e.target, 1);
        stack.push({ v: e.target, i: 0 });
      }
    }
  };

  dfs(START_ID);
  for (const n of nodes) if ((color.get(n.id) ?? 0) === 0) dfs(n.id);

  const backSet = new Set(backEdgeIds);

  /* ── 2. DAG 위상 정렬 (Kahn, rank 최소 우선으로 결정적) ────────────────── */

  const indeg = new Map<NodeId, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (backSet.has(e.id)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const ready: NodeId[] = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  ready.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  const topoOrder: NodeId[] = [];
  while (ready.length > 0) {
    const v = ready.shift()!;
    topoOrder.push(v);
    for (const e of outgoing.get(v) ?? []) {
      if (backSet.has(e.id)) continue;
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) {
        // rank 오름차순 유지 (삽입 정렬 — 준비 큐는 항상 작다)
        const r = rank.get(e.target) ?? 0;
        let i = 0;
        while (i < ready.length && (rank.get(ready[i]!) ?? 0) < r) i++;
        ready.splice(i, 0, e.target);
      }
    }
  }

  /* ── 3. back edge 하나 = 사용자가 그은 루프 하나 ────────────────────────
   * Johnson의 모든 기본 사이클 열거는 여기서 과잉이다. 사용자는 "반려되면 3번으로"
   * 라는 **엣지 하나**를 그었고, 그 엣지가 닫는 사이클이 정확히 그가 의도한 루프다.
   * back edge (u→v) 에 대해 DAG에서 v⇝u 최단 경로를 찾으면 그 사이클을 얻는다.
   * DFS 트리 경로가 항상 존재하므로 실패하지 않는다. O(V+E) per back edge. */

  const cycles: CycleInfo[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const beId of backEdgeIds) {
    if (cycles.length >= maxCycles) break;
    const be = edges.find((e) => e.id === beId)!;
    const path = shortestPath(be.target, be.source, outgoing, backSet);
    if (!path) continue;

    const src = byId.get(be.source);
    const raw = src?.attrs.reworkRate;
    let rate: number | null = null;
    let clamped = false;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      rate = clamp(raw, 0, maxRate);
      clamped = raw > maxRate;
      if (clamped) {
        diag({
          code: 'rework-rate-clamped',
          severity: 'repaired',
          nodeIds: [be.source],
          detail:
            `reworkRate=${raw} → ${maxRate}로 절단. p=1이면 기대 반복이 발산해 ` +
            '리드타임이 무한대가 된다. 자기보고 데이터에서 100% 반려는 오기(誤記)다.',
          userMessage: null,
        });
      }
    }

    cycles.push({
      id: cycleId(beId),
      nodes: path,
      backEdgeId: beId,
      reworkRate: rate,
      expectedExtraPasses: rate === null ? null : round(rate / (1 - rate)),
      clamped,
    });
  }

  if (cycles.length > 0) {
    diag({
      code: 'cycle',
      severity: 'note',
      edgeIds: backEdgeIds,
      detail:
        `사이클 ${cycles.length}개. 정상이며 필수 기능이다. 레이아웃에는 back edge를 ` +
        '뒤집어 DAG로 넘기고, 리드타임은 기대 통과 횟수 1/(1−p)로 유한화한다.',
      userMessage: '되돌아가는 흐름이에요. 이 단계에서 앞 단계로 다시 갑니다.',
    });
  }

  return { topoOrder, backEdgeIds, cycles };
}

function shortestPath(
  from: NodeId,
  to: NodeId,
  outgoing: ReadonlyMap<NodeId, readonly DerivedEdge[]>,
  backSet: ReadonlySet<string>,
): NodeId[] | null {
  if (from === to) return [from];
  const prev = new Map<NodeId, NodeId>();
  const seen = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  while (queue.length > 0) {
    const v = queue.shift()!;
    for (const e of outgoing.get(v) ?? []) {
      if (backSet.has(e.id)) continue;
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      prev.set(e.target, v);
      if (e.target === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev.get(cur)!;
          path.unshift(cur);
        }
        return path;
      }
      queue.push(e.target);
    }
  }
  return null;
}

/**
 * ELK에 넘기기 직전 변환 — back edge를 뒤집는다.
 *
 * 화살표 머리는 원래 방향에 그려야 하므로 `reversedForLayout`을 함께 넘기고,
 * React Flow 쪽에서 `markerStart`/`markerEnd`를 바꿔 단다.
 *
 * (이 함수는 순수하다. elkjs를 import 하지 않는다 — 호출자가 좌표를 붙인다.)
 */
export function toLayoutEdges(
  edges: readonly DerivedEdge[],
): Array<{ id: string; sources: [NodeId]; targets: [NodeId]; reversedForLayout: boolean }> {
  return edges.map((e) =>
    e.isBackEdge
      ? { id: e.id, sources: [e.target] as [NodeId], targets: [e.source] as [NodeId], reversedForLayout: true }
      : { id: e.id, sources: [e.source] as [NodeId], targets: [e.target] as [NodeId], reversedForLayout: false },
  );
}

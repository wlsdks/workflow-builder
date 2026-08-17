/**
 * packages/graph-core/src/incremental.ts
 *
 * §8 증분 계산.
 *
 * ── 결론부터 ────────────────────────────────────────────────────────────────
 *
 * **derive()는 증분화하지 않는다.** 실측(Node 24, M-series, 20회 평균):
 *
 *   items  50 → 노드  46 / 엣지  50 → 0.27 ms
 *   items 205 → 노드 183 / 엣지 199 → 0.64 ms
 *   items 504 → 노드 448 / 엣지 487 → 1.54 ms      ← 성능 상한선(ARCHITECTURE §5)
 *   items 2000 → 노드 1771 / 엣지 1925 → 5.75 ms
 *
 * ELK 한 번이 50~1500ms인데 파생은 1.5ms다. **1000분의 1짜리를 최적화하는 것은
 * 최적화가 아니라 버그 표면 확대다.** 증분 파생은 (a) 부분 그래프의 tails/join 전파를 다시
 * 구현해야 하고 (b) 캐시와 진실이 어긋나는 split brain을 만들며 (c) 골든
 * 픽스처를 두 배로 늘린다. **파생 엣지를 저장하지 않기로 한 이유(D-030)와
 * 정확히 같은 이유로 파생 결과도 증분하지 않는다.**
 *
 * 증분화가 실제로 필요한 것은 파생이 아니라 **그 아래 3개**다.
 *
 *   1) ELK 레이아웃   50~1500ms — 진짜 비싸다.  `topologyHash`로 게이트
 *   2) React Flow 렌더 노드 1개당 DOM 15~30개.  `contentHash` + memo
 *   3) 메트릭         O(V+E)지만 요약 카드가 매 키 입력에 깜빡이면 안 된다
 *
 * 그래서 op → **무엇을 다시 하는가**의 표만 있으면 충분하다.
 */

import type { DerivedGraph, DurationBand, ItemAttrs, NodeKind } from './types.ts';

/* ── op 정의 (ARCHITECTURE §6 `applyOps`) ──────────────────────────────── */

export type OpType =
  | 'insert_item'
  | 'delete_item'
  | 'restore_item'
  | 'move_item'
  | 'reorder_item'
  | 'set_title'
  | 'set_kind'
  | 'set_attr'
  | 'set_assignee'
  | 'set_duration'
  | 'set_tools'
  | 'toggle_pain'
  | 'confirm_item'
  | 'add_edge'
  | 'remove_edge'
  | 'suppress_edge'
  | 'unsuppress_edge';

export type Op =
  | { type: 'insert_item'; id: string; parentId: string | null; sortKey: string; kind: NodeKind; title: string }
  | { type: 'delete_item'; id: string }
  | { type: 'restore_item'; id: string }
  | { type: 'move_item'; id: string; parentId: string | null; sortKey: string }
  | { type: 'reorder_item'; id: string; sortKey: string }
  | { type: 'set_title'; id: string; title: string }
  | { type: 'set_kind'; id: string; kind: NodeKind }
  | { type: 'set_attr'; id: string; patch: Partial<ItemAttrs> }
  | { type: 'set_assignee'; id: string; assigneeId: string | null }
  | { type: 'set_duration'; id: string; durationBand: DurationBand | null }
  | { type: 'set_tools'; id: string; toolIds: readonly string[] }
  | { type: 'toggle_pain'; id: string; painFlag: boolean }
  | { type: 'confirm_item'; id: string }
  | { type: 'add_edge'; id: string; sourceId: string; targetId: string; label?: string }
  | { type: 'remove_edge'; id: string }
  | { type: 'suppress_edge'; id: string; sourceId: string; targetId: string }
  | { type: 'unsuppress_edge'; id: string };

/* ── 재계산 범위 ───────────────────────────────────────────────────────── */

export type RecomputeScope = {
  /** derive() 재실행. 사실상 항상 true (싸다) */
  derive: boolean;
  /** 위상이 바뀔 수 있는가 → ELK 재실행 후보 */
  topology: boolean;
  /** 노드 라벨/메타만 바뀜 → 해당 노드만 리렌더 */
  labels: boolean;
  /** 시간·담당자·도구 관련 → 요약 카드와 렌즈 갱신 */
  metrics: boolean;
  /** 사이클 구조가 바뀔 수 있는가 → back edge 재판정 */
  cycles: boolean;
};

const S = (
  topology: boolean,
  labels: boolean,
  metrics: boolean,
  cycles: boolean,
): RecomputeScope => ({ derive: true, topology, labels, metrics, cycles });

/**
 * op → 재계산 범위.
 *
 * | op                | 위상 | 라벨 | 메트릭 | 사이클 | 비고                                    |
 * |-------------------|:----:|:----:|:------:|:------:|-----------------------------------------|
 * | insert_item       |  ●   |  ●   |   ●    |   ○    | 갈래 안에 넣으면 join 재배선            |
 * | delete_item       |  ●   |  ●   |   ●    |   ●    | 루프의 끝점을 지우면 사이클이 사라진다   |
 * | restore_item      |  ●   |  ●   |   ●    |   ●    | dangling 엣지가 되살아난다              |
 * | move_item         |  ●   |  ●   |   ●    |   ●    | 가장 광범위. 역할(step↔case)이 바뀐다   |
 * | reorder_item      |  ●   |  ○   |   ●    |   ○    | 형제 순서 = 사슬 순서                    |
 * | set_title         |  ○   |  ●   |   ○    |   ○    | **95%의 타이핑이 여기서 걸러진다**       |
 * | set_kind          |  ●   |  ●   |   ●    |   ●    | task↔branch는 자식의 역할을 뒤집는다     |
 * | set_attr(mode)    |  ●   |  ●   |   ●    |   ○    | xor↔and는 join 노드 생성/삭제           |
 * | set_attr(join)    |  ●   |  ○   |   ●    |   ○    | continue↔end                            |
 * | set_attr(caseLabel)|  ○  |  ●   |   ○    |   ○    | 엣지 라벨만                             |
 * | set_attr(rework)  |  ○   |  ○   |   ●    |   ○    | 확률만. **위상 해시에 안 들어간다**      |
 * | set_attr(avgWaitH)|  ○   |  ●   |   ●    |   ○    |                                         |
 * | set_assignee      |  ○   |  ●   |   ●    |   ○    | 인계 지점 재계산                        |
 * | set_duration      |  ○   |  ●   |   ●    |   ○    |                                         |
 * | set_tools         |  ○   |  ●   |   ●    |   ○    | 도구 전환 횟수                          |
 * | toggle_pain       |  ○   |  ●   |   ○    |   ○    | 짜증 렌즈 전용 (D-025)                   |
 * | confirm_item      |  ○   |  ●   |   ○    |   ○    | 신선도 채도만                           |
 * | add_edge          |  ●   |  ●   |   ●    |   ●    |                                         |
 * | remove_edge       |  ●   |  ●   |   ●    |   ●    |                                         |
 * | suppress_edge     |  ●   |  ●   |   ●    |   ●    | 유일한 진입로를 끊을 수 있다             |
 * | unsuppress_edge   |  ●   |  ●   |   ●    |   ●    |                                         |
 *
 * ● = 다시 계산 / ○ = 건드리지 않음
 *
 * 이 표는 **보수적 상한**이다. 실제 게이트는 표가 아니라 해시다:
 * `next.topologyHash === prev.topologyHash` 면 표가 뭐라 하든 ELK를 돌리지 않는다.
 * 표는 "해시를 계산하기 전에 스킵할 수 있는가"를 정하는 1차 필터일 뿐이다.
 */
export const OP_SCOPE: Record<OpType, RecomputeScope> = {
  insert_item: S(true, true, true, false),
  delete_item: S(true, true, true, true),
  restore_item: S(true, true, true, true),
  move_item: S(true, true, true, true),
  reorder_item: S(true, false, true, false),
  set_title: S(false, true, false, false),
  set_kind: S(true, true, true, true),
  set_attr: S(true, true, true, false),
  set_assignee: S(false, true, true, false),
  set_duration: S(false, true, true, false),
  set_tools: S(false, true, true, false),
  toggle_pain: S(false, true, false, false),
  confirm_item: S(false, true, false, false),
  add_edge: S(true, true, true, true),
  remove_edge: S(true, true, true, true),
  suppress_edge: S(true, true, true, true),
  unsuppress_edge: S(true, true, true, true),
};

/** set_attr는 어떤 키를 건드렸는지에 따라 범위가 크게 다르다 */
const TOPOLOGY_ATTRS = new Set<keyof ItemAttrs>(['mode', 'joinBehavior']);
const METRIC_ONLY_ATTRS = new Set<keyof ItemAttrs>(['reworkRate', 'avgWaitH', 'timeoutH', 'waitFor']);

export function recomputeScope(ops: readonly Op[]): RecomputeScope {
  const acc: RecomputeScope = {
    derive: ops.length > 0,
    topology: false,
    labels: false,
    metrics: false,
    cycles: false,
  };
  for (const op of ops) {
    let s = OP_SCOPE[op.type];
    if (op.type === 'set_attr') {
      const keys = Object.keys(op.patch) as Array<keyof ItemAttrs>;
      const topo = keys.some((k) => TOPOLOGY_ATTRS.has(k));
      const metricOnly = keys.every((k) => METRIC_ONLY_ATTRS.has(k));
      s = S(topo, !metricOnly || keys.includes('avgWaitH'), true, false);
    }
    acc.topology ||= s.topology;
    acc.labels ||= s.labels;
    acc.metrics ||= s.metrics;
    acc.cycles ||= s.cycles;
  }
  return acc;
}

/**
 * 레이아웃 게이트 — DESIGN §6.6.2 "구조 diff 게이트".
 *
 * 타이핑의 95%는 여기서 걸린다. `topologyHash`는 제목·담당자·시간·짜증·
 * reworkRate를 **일부러 포함하지 않는다**. 그것들이 들어가면 게이트가 무의미해진다.
 */
export function needsLayout(prev: DerivedGraph | null, next: DerivedGraph): boolean {
  return prev === null || prev.topologyHash !== next.topologyHash;
}

/**
 * 렌더 게이트. 위상이 같아도 라벨이 바뀌면 노드는 다시 그려야 한다.
 * 바뀐 노드 ID만 돌려주므로 React Flow에 통째로 새 배열을 넣지 않아도 된다.
 */
export function changedNodeIds(prev: DerivedGraph | null, next: DerivedGraph): string[] {
  if (prev === null) return next.nodes.map((n) => n.id);
  if (prev.contentHash === next.contentHash) return [];
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const n of next.nodes) {
    const b = before.get(n.id);
    if (
      !b ||
      b.title !== n.title ||
      b.kind !== n.kind ||
      b.assigneeId !== n.assigneeId ||
      b.effectiveAssigneeId !== n.effectiveAssigneeId ||
      b.durationBand !== n.durationBand ||
      b.painFlag !== n.painFlag ||
      b.toolIds.join(',') !== n.toolIds.join(',')
    ) {
      out.push(n.id);
    }
  }
  for (const b of prev.nodes) if (!next.byId.has(b.id)) out.push(b.id);
  return out;
}

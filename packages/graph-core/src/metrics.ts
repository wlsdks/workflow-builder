/**
 * packages/graph-core/src/metrics.ts
 *
 * §6 병렬 의미론 + §7 파생 메트릭.
 *
 * 이 파일의 존재 이유 한 줄:
 *   **AND/XOR을 구분하지 않으면 병렬 구간이 순차로 합산되어 리드타임이 과대 계산된다.**
 *   시각화가 틀리는 게 아니라 숫자가 틀린다 (D-005).
 *
 * 세 개의 다른 질문에 세 개의 다른 답을 낸다. 하나로 뭉뚱그리면 전부 틀린다.
 *
 *   ┌───────────────────┬──────────────┬─────────────────────────────────────┐
 *   │ 질문              │ 분기 합성    │ 필드                                │
 *   ├───────────────────┼──────────────┼─────────────────────────────────────┤
 *   │ 얼마나 걸리나     │ XOR=확률가중 │ leadTimeH      (기대 리드타임)      │
 *   │ (달력 시간)       │ AND=max      │                                     │
 *   ├───────────────────┼──────────────┼─────────────────────────────────────┤
 *   │ 최악은            │ XOR=max      │ criticalPathH  (최장 경로)          │
 *   │                   │ AND=max      │                                     │
 *   ├───────────────────┼──────────────┼─────────────────────────────────────┤
 *   │ 사람이 몇 시간    │ XOR=확률가중 │ touchH         (실접촉시간)         │
 *   │ 붙어 있나         │ AND=**sum**  │                                     │
 *   └───────────────────┴──────────────┴─────────────────────────────────────┘
 *
 * AND에서 lead=max, touch=sum 이 갈리는 지점이 정확히 이 제품의 주장이다.
 */

import type {
  CycleInfo,
  DeriveOptions,
  DerivedEdge,
  DerivedNode,
  Diagnostic,
  DurationBand,
  Handoff,
  Measure,
  Metrics,
  NodeId,
  NodeMetrics,
  WaitFor,
} from './types.ts';
import type { Preprocessed } from './preprocess.ts';
import { END_ID, START_ID } from './ids.ts';
import { clamp, round } from './util.ts';

/** PRD §4.5 로그 스케일 버킷 → 시간 */
export const BAND_HOURS: Record<DurationBand, number> = {
  '1m': 1 / 60,
  '5m': 5 / 60,
  '15m': 0.25,
  '1h': 1,
  halfday: 4,
  '1d+': 8,
};

/**
 * avgWaitH 미입력 시의 기본 대기시간.
 * 지어낸 숫자를 총합에 섞는 것이므로 **coverage가 함께 떨어진다** — 그게 계약이다.
 */
export const DEFAULT_WAIT_HOURS: Record<WaitFor, number> = {
  approval: 24,
  reply: 24,
  time: 12,
  resource: 8,
};

export type MetricsContext = {
  nodes: readonly DerivedNode[];
  edges: readonly DerivedEdge[];
  outgoing: ReadonlyMap<NodeId, readonly DerivedEdge[]>;
  incoming: ReadonlyMap<NodeId, readonly DerivedEdge[]>;
  topoOrder: readonly NodeId[];
  cycles: readonly CycleInfo[];
  tree: Preprocessed;
  options: DeriveOptions;
  diag: (d: Diagnostic) => void;
};

export function computeMetrics(ctx: MetricsContext): Metrics {
  const { nodes, edges, outgoing, incoming, topoOrder, cycles, tree, options, diag } = ctx;

  const bands = { ...BAND_HOURS, ...(options.bands ?? {}) };
  const waitDefaults = { ...DEFAULT_WAIT_HOURS, ...(options.defaultWaitH ?? {}) };
  const maxRate = options.maxReworkRate ?? 0.95;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rank = new Map(nodes.map((n) => [n.id, n.order]));
  const isStep = (n: DerivedNode) => n.kind === 'task' || n.kind === 'hold';

  /* ── 1. 노드별 시간 ──────────────────────────────────────────────────── */

  const touch = new Map<NodeId, number>();
  const wait = new Map<NodeId, number>();
  let estimatedWaits = 0;

  for (const n of nodes) {
    touch.set(n.id, n.durationBand ? (bands[n.durationBand] ?? 0) : 0);
    if (n.kind === 'hold') {
      const a = n.attrs.avgWaitH;
      if (typeof a === 'number' && Number.isFinite(a) && a >= 0) {
        wait.set(n.id, a);
      } else {
        estimatedWaits++;
        wait.set(n.id, n.waitFor ? waitDefaults[n.waitFor] : 0);
      }
    } else {
      wait.set(n.id, 0);
    }
  }
  if (estimatedWaits > 0) {
    diag({
      code: 'wait-estimated',
      severity: 'note',
      detail:
        `avgWaitH 미입력 기다림 ${estimatedWaits}건에 waitFor별 기본값을 사용했다. ` +
        'coverage에 반영되므로 요약 카드는 "대략"으로 표기해야 한다.',
      userMessage: null,
    });
  }

  /* ── 2. 엣지 분기 확률 (share) ────────────────────────────────────────
   *
   *  AND      : 모든 나가는 엣지 share = 1  (전부 실행된다)
   *  XOR/skip : 균등 1/k                      (갈래별 확률 필드는 v1에 없다)
   *  reworkRate가 있는 노드: back edge에 p, 나머지에 (1−p) 배분
   *             → "반려율 30%"가 갈래 확률로 직접 쓰인다
   */

  const share = new Map<string, number>();
  for (const n of nodes) {
    const outs = outgoing.get(n.id) ?? [];
    if (outs.length === 0) continue;

    if (n.kind === 'branch' && n.branchMode === 'and') {
      for (const e of outs) share.set(e.id, 1);
      continue;
    }

    const backs = outs.filter((e) => e.isBackEdge);
    const fwds = outs.filter((e) => !e.isBackEdge);
    const raw = n.attrs.reworkRate;
    const p =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? clamp(raw, 0, maxRate) : null;

    if (p !== null && backs.length > 0 && fwds.length > 0) {
      for (const e of backs) share.set(e.id, p / backs.length);
      for (const e of fwds) share.set(e.id, (1 - p) / fwds.length);
    } else {
      for (const e of outs) share.set(e.id, 1 / outs.length);
    }
  }

  /* ── 3. 도달 확률 (전향 DP, DAG) ─────────────────────────────────────
   * 합류 노드는 **합이 아니라 max**다. AND 갈래 k개가 모두 도달하는 것이
   * 확률 k배를 뜻하지 않기 때문이다. 이 한 줄을 빼면 병렬 뒤 구간이 k배로 부푼다. */

  const prob = new Map<NodeId, number>(nodes.map((n) => [n.id, 0]));
  prob.set(START_ID, 1);
  for (const v of topoOrder) {
    if (v === START_ID) continue;
    const ins = (incoming.get(v) ?? []).filter((e) => !e.isBackEdge);
    if (ins.length === 0) continue;
    const node = byId.get(v)!;
    if (node.kind === 'join') {
      let m = 0;
      for (const e of ins) m = Math.max(m, (prob.get(e.source) ?? 0) * (share.get(e.id) ?? 0));
      prob.set(v, m);
    } else {
      let s = 0;
      for (const e of ins) s += (prob.get(e.source) ?? 0) * (share.get(e.id) ?? 0);
      prob.set(v, Math.min(1, s));
    }
  }

  /* ── 4. 루프 기대 통과 횟수 ──────────────────────────────────────────
   *
   *   반려율 p 인 루프를 **1회 + 기하분포 재시도**로 본다.
   *     E[총 통과 횟수] = Σ_{k≥0} p^k = 1 / (1 − p)
   *     E[추가 반복]    = p / (1 − p)
   *   중첩 루프는 곱해진다 (안쪽 루프가 바깥 루프마다 다시 돌므로).
   *   p는 maxReworkRate(기본 0.95)로 절단 — p→1이면 발산한다. */

  const passes = new Map<NodeId, number>(nodes.map((n) => [n.id, 1]));
  for (const c of cycles) {
    if (c.reworkRate === null) continue;
    const m = 1 / (1 - c.reworkRate);
    for (const v of c.nodes) passes.set(v, (passes.get(v) ?? 1) * m);
  }

  /* ── 5. 총합 ─────────────────────────────────────────────────────────── */

  let touchExpected = 0;
  let touchAll = 0;
  let waitExpected = 0;
  for (const n of nodes) {
    const p = prob.get(n.id) ?? 0;
    const k = passes.get(n.id) ?? 1;
    touchExpected += p * k * (touch.get(n.id) ?? 0);
    touchAll += k * (touch.get(n.id) ?? 0);
    waitExpected += p * k * (wait.get(n.id) ?? 0);
  }

  /* ── 6. 리드타임 (후향 DP) ───────────────────────────────────────────
   *
   *   T(v) = lead(v)·passes(v) + agg{ T(w) : v→w, back edge 제외 }
   *     agg = max            (v가 AND 분기)
   *         = Σ share'·T(w)  (그 외; share'는 forward 엣지들로 재정규화)
   *   T(end) = 0
   *
   *   AND에서 max가 옳은 이유: T(caseHead_i) = 갈래내부_i + T(join) 이므로
   *   max_i(갈래내부_i + T(join)) = max_i(갈래내부_i) + T(join).
   *   합류 이후 구간이 중복 합산되지 않는다.
   *
   *   C(v)는 확률을 무시한 최장 경로 = 최악 리드타임 = critical path. */

  const T = new Map<NodeId, number>(nodes.map((n) => [n.id, 0]));
  const C = new Map<NodeId, number>(nodes.map((n) => [n.id, 0]));
  const cNext = new Map<NodeId, NodeId | null>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const v = topoOrder[i]!;
    const node = byId.get(v)!;
    const own = ((touch.get(v) ?? 0) + (wait.get(v) ?? 0)) * (passes.get(v) ?? 1);
    const fwds = (outgoing.get(v) ?? []).filter((e) => !e.isBackEdge);

    if (fwds.length === 0) {
      T.set(v, own);
      C.set(v, own);
      cNext.set(v, null);
      continue;
    }

    let agg: number;
    if (node.kind === 'branch' && node.branchMode === 'and') {
      agg = Math.max(...fwds.map((e) => T.get(e.target) ?? 0));
    } else {
      const total = fwds.reduce((s, e) => s + (share.get(e.id) ?? 0), 0);
      agg =
        total > 0
          ? fwds.reduce((s, e) => s + ((share.get(e.id) ?? 0) / total) * (T.get(e.target) ?? 0), 0)
          : 0;
    }
    T.set(v, own + agg);

    let best = -1;
    let bestNode: NodeId | null = null;
    for (const e of fwds) {
      const c = C.get(e.target) ?? 0;
      if (
        c > best ||
        (c === best && bestNode !== null && (rank.get(e.target) ?? 0) < (rank.get(bestNode) ?? 0))
      ) {
        best = c;
        bestNode = e.target;
      }
    }
    C.set(v, own + Math.max(0, best));
    cNext.set(v, bestNode);
  }

  const criticalPath: NodeId[] = [];
  {
    let cur: NodeId | null = START_ID;
    const guard = new Set<NodeId>();
    while (cur !== null && !guard.has(cur)) {
      guard.add(cur);
      criticalPath.push(cur);
      cur = cNext.get(cur) ?? null;
    }
  }

  /* ── 7. 담당자 forward-fill → 인계 추론 ──────────────────────────────
   *
   * 메타데이터 카드는 담당자를 전원 "나"로 미리 채우고 **바뀌는 지점만** 지정하게
   * 한다(PRD §4.5). 그러면 `assigneeId === null`은 "모름"이 아니라
   * **"앞 단계와 같음"** 이다. 따라서 앞으로 흘려보내는 것이 정확한 해석이고,
   * 인계는 흘려보낸 값이 바뀌는 지점으로 정의된다.
   *
   * 앞 단계가 여러 개고 서로 다르면(합류 직후) null — 모른다고 말하는 편이
   * 아무나 찍는 것보다 낫다. */

  const eff = new Map<NodeId, string | null>();
  for (const v of topoOrder) {
    const node = byId.get(v)!;
    let inherited: string | null | undefined;
    let conflict = false;
    for (const e of incoming.get(v) ?? []) {
      if (e.isBackEdge) continue;
      const val = eff.get(e.source) ?? null;
      if (inherited === undefined) inherited = val;
      else if (inherited !== val) conflict = true;
    }
    const parent = conflict ? null : (inherited ?? null);
    const own = node.synthetic ? null : (node.assigneeId ?? null);
    eff.set(v, own ?? parent);
  }
  for (const n of nodes) (n as { effectiveAssigneeId?: string | null }).effectiveAssigneeId = eff.get(n.id) ?? null;

  /* 합성 노드를 축약한 "단계 사이" 엣지 집합.
   * start/end/join을 건너뛰어야 인계가 합류 노드에서 끊기지 않는다. */
  const stepPairs: Array<[NodeId, NodeId]> = [];
  {
    const seen = new Set<string>();
    for (const u of nodes) {
      if (u.synthetic) continue;
      const stack = [...(outgoing.get(u.id) ?? [])];
      const visited = new Set<NodeId>();
      while (stack.length > 0) {
        const e = stack.pop()!;
        const w = byId.get(e.target)!;
        if (w.id === END_ID) continue;
        if (w.synthetic) {
          if (visited.has(w.id)) continue;
          visited.add(w.id);
          stack.push(...(outgoing.get(w.id) ?? []));
          continue;
        }
        const key = `${u.id}>${w.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stepPairs.push([u.id, w.id]);
      }
    }
  }

  const dir = options.directory ?? {};
  const handoffs: Handoff[] = [];
  let toolSwitchCount = 0;

  for (const [uid, wid] of stepPairs) {
    const a = eff.get(uid) ?? null;
    const b = eff.get(wid) ?? null;
    if (a !== null && b !== null && a !== b) {
      const da = dir[a]?.deptId ?? null;
      const db = dir[b]?.deptId ?? null;
      handoffs.push({
        from: uid,
        to: wid,
        fromAssigneeId: a,
        toAssigneeId: b,
        crossDepartment: da !== null && db !== null && da !== db,
      });
    }
    const ta = byId.get(uid)!.toolIds;
    const tb = byId.get(wid)!.toolIds;
    if (ta.length > 0 && tb.length > 0 && !ta.some((t) => tb.includes(t))) toolSwitchCount++;
  }

  /* ── 8. 카운트와 커버리지 ────────────────────────────────────────────── */

  const real = nodes.filter((n) => !n.synthetic);
  const steps = real.filter(isStep);
  const holds = real.filter((n) => n.kind === 'hold');

  const people = new Set<string>();
  for (const n of real) {
    const a = eff.get(n.id);
    if (a) people.add(a);
  }
  const tools = new Set<string>();
  for (const n of real) for (const t of n.toolIds) tools.add(t);

  const durationFilled = steps.filter((n) => n.durationBand != null).length;
  const waitFilled = holds.filter((n) => typeof n.attrs.avgWaitH === 'number').length;
  const timeFilled = steps.filter(
    (n) => n.durationBand != null || (n.kind === 'hold' && typeof n.attrs.avgWaitH === 'number'),
  ).length;

  const cov = (filled: number, total: number) => (total === 0 ? 1 : round(filled / total, 3));
  const measure = (value: number, coverage: number): Measure => ({ value: round(value), coverage });

  if (steps.length > 0 && durationFilled === 0) {
    diag({
      code: 'duration-missing',
      severity: 'note',
      detail: '소요시간이 하나도 없다. 시간 렌즈와 요약 카드의 시간 항목을 숨겨야 한다.',
      userMessage: null,
    });
  }
  if (real.length > 0 && people.size === 0) {
    diag({
      code: 'assignee-missing',
      severity: 'note',
      detail: '담당자가 하나도 없다. 인계 횟수는 0이 아니라 "알 수 없음"으로 표시해야 한다.',
      userMessage: null,
    });
  }

  const perNode = new Map<NodeId, NodeMetrics>();
  for (const n of nodes) {
    perNode.set(n.id, {
      reachProbability: round(prob.get(n.id) ?? 0),
      expectedPasses: round(passes.get(n.id) ?? 1),
      touchH: round(touch.get(n.id) ?? 0),
      waitH: round(wait.get(n.id) ?? 0),
      leadH: round((touch.get(n.id) ?? 0) + (wait.get(n.id) ?? 0)),
      remainingLeadH: round(T.get(n.id) ?? 0),
      remainingCriticalH: round(C.get(n.id) ?? 0),
    });
  }

  const leadTimeH = measure(T.get(START_ID) ?? 0, cov(timeFilled, steps.length));
  const waitMeasure = measure(waitExpected, cov(waitFilled, holds.length));

  return {
    stepCount: steps.length,
    taskCount: real.filter((n) => n.kind === 'task').length,
    holdCount: holds.length,
    branchCount: real.filter((n) => n.kind === 'branch').length,
    caseCount: tree.all.filter((p) => p.role === 'case').length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    maxDepth: real.length === 0 ? 0 : Math.max(...real.map((n) => n.depth)) + 1,

    peopleCount: people.size,
    toolCount: tools.size,

    handoffs,
    handoffCount: handoffs.length,
    crossDepartmentHandoffCount: handoffs.filter((h) => h.crossDepartment).length,
    toolSwitchCount,

    touchH: measure(touchExpected, cov(durationFilled, steps.length)),
    touchAllPathsH: measure(touchAll, cov(durationFilled, steps.length)),
    waitH: waitMeasure,
    leadTimeH,
    criticalPathH: measure(C.get(START_ID) ?? 0, cov(timeFilled, steps.length)),
    criticalPath,
    waitRatio: leadTimeH.value > 0 ? round(waitExpected / leadTimeH.value, 3) : null,

    cycles,
    cycleCount: cycles.length,
    perNode,
  };
}

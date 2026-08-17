/**
 * packages/graph-core/src/export/n8n.ts
 *
 * §10 toN8n() 스케치.
 *
 * 로드맵상 M5+지만 **인터페이스는 지금 잡는다.** 이유는 하나뿐이다 —
 * `tools.n8n_node_type` 컬럼을 지금 비워두더라도 자리를 잡아두지 않으면
 * 3개월 뒤 익스포터가 전부 퍼지 문자열 매칭이 된다 (D-009).
 *
 * ── 가장 중요한 한 줄 ──────────────────────────────────────────────────────
 *
 *   **우리 그래프는 제어 흐름이고 n8n 워크플로는 데이터 파이프라인이다.**
 *
 * 우리에겐 페이로드 스키마가 없다. 어떤 단계가 무엇을 입력받아 무엇을 내보내는지
 * 모델에 존재하지 않는다. 따라서 export 결과는 **절대 실행 가능한 워크플로가
 * 아니다.** 골격 + 스티키 노트다. `active: false`로 고정하고, UI에서도
 * "n8n으로 내보내기"가 아니라 **"자동화팀에 넘길 초안 만들기"**로 부른다.
 *
 * ── 매핑 가능 ──────────────────────────────────────────────────────────────
 *
 * | 우리 개념                    | n8n                                    | 손실 |
 * |------------------------------|----------------------------------------|------|
 * | 순차 연결                     | `connections.main[0]`                  | 없음 |
 * | 분기 xor (갈래 2)             | `n8n-nodes-base.if`                    | 조건식 |
 * | 분기 xor (갈래 3+)            | `n8n-nodes-base.switch` (rules)        | 조건식 |
 * | 분기 skip                     | `if` (true=갈래 / false=통과)          | 조건식 |
 * | 분기 and (fan-out)            | 한 출력 → 여러 연결                     | 동시성 |
 * | AND 합류                      | `n8n-nodes-base.merge` (numberInputs)  | 없음 |
 * | 기다림 waitFor:'time'         | `n8n-nodes-base.wait` (timeInterval)   | 없음 |
 * | 기다림 waitFor:'approval'     | `wait` (resume: webhook)               | 승인 UI |
 * | 도구가 카탈로그에 매핑된 작업  | 해당 노드 타입 (파라미터 비움)          | 파라미터 |
 * | start                        | 트리거 노드 (호출자가 지정)             | 트리거 조건 |
 * | 사이클 (재작업 루프)           | 역방향 connection (n8n은 순환 허용)     | 종료 조건 |
 *
 * ── 매핑 불가 (정직하게 목록으로 내보낸다) ─────────────────────────────────
 *
 * 1. **조건식.** "단순 문의라면"은 자연어다. n8n 조건은 `{{$json.x}}` 표현식이다.
 *    자동 변환 시도는 하지 않는다 — 그럴듯하게 틀린 조건이 빈 조건보다 위험하다.
 * 2. **사람 작업.** 승인·전화·오프라인 확인. Wait+webhook 껍데기만 나간다.
 * 3. **데이터 모델.** 단계 간에 무엇이 흐르는지 우리는 모른다.
 * 4. **병렬 의미론.** n8n은 브랜치를 **순차 실행**한다(동시성 없음).
 *    우리 리드타임 max(각 갈래) 가정이 실행 시점에는 성립하지 않는다.
 *    → 이건 경고가 아니라 **명세에 반드시 적어야 할 사실**이다.
 * 5. **반려율.** 확률적 루프는 n8n에 없다. If + 사람이 채울 조건으로만.
 * 6. **자격증명·권한·에러 처리·재시도.** 전부 사람 몫.
 * 7. **`hold.timeoutH` 후 에스컬레이션.** n8n Wait에는 타임아웃 분기가 없다.
 */

import type { DerivedGraph, DerivedNode, NodeId } from '../types.ts';
import { END_ID, START_ID } from '../ids.ts';

export type N8nNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  notesInFlow?: boolean;
  notes?: string;
  disabled?: boolean;
};

export type N8nConnection = { node: string; type: 'main'; index: number };

export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
  active: false;
  settings: Record<string, unknown>;
  pinData: Record<string, never>;
  meta: { generatedBy: 'graph-core'; sourceTopologyHash: string };
};

export type UnmappedReason =
  | 'condition-unknown'
  | 'human-task'
  | 'no-tool-binding'
  | 'no-data-model'
  | 'parallel-semantics'
  | 'loop-condition'
  | 'timeout-escalation';

export type UnmappedItem = {
  nodeId: NodeId;
  itemId: string | null;
  reason: UnmappedReason;
  detail: string;
};

export type ToN8nOptions = {
  name: string;
  /** start를 무엇으로 바꿀지. 추론하지 않는다 — 트리거는 사람이 정한다 */
  trigger:
    | { kind: 'manual' }
    | { kind: 'schedule'; cron: string }
    | { kind: 'webhook'; path: string };
  /** toolId → n8n 노드 타입. `tools.n8n_node_type` 컬럼이 그대로 온다 */
  toolCatalog?: Readonly<Record<string, { n8nNodeType: string | null; displayName?: string }>>;
  /** 노드 좌표. 없으면 위상 순서로 격자 배치 */
  positions?: Readonly<Record<NodeId, { x: number; y: number }>>;
};

export type N8nExportResult = {
  workflow: N8nWorkflow;
  unmapped: readonly UnmappedItem[];
  /** 매핑된 단계 / 전체 단계 */
  coverage: number;
  /** 워크플로 전체에 붙는 구조적 경고 (스티키 노트로 나간다) */
  notes: readonly string[];
};

export function toN8n(graph: DerivedGraph, options: ToN8nOptions): N8nExportResult {
  const catalog = options.toolCatalog ?? {};
  const unmapped: UnmappedItem[] = [];
  const notes: string[] = [
    '이 워크플로는 실행 가능한 상태가 아닙니다. 단계 구조와 순서만 옮긴 골격입니다.',
    '조건식·자격증명·데이터 매핑은 비어 있습니다.',
  ];

  const nodes: N8nNode[] = [];
  const nameOf = new Map<NodeId, string>();
  const used = new Set<string>();

  const uniqueName = (base: string): string => {
    let n = base.trim() || 'Step';
    let i = 2;
    while (used.has(n)) n = `${base} (${i++})`;
    used.add(n);
    return n;
  };

  const pos = (v: DerivedNode, i: number): [number, number] => {
    const p = options.positions?.[v.id];
    return p ? [p.x, p.y] : [220 * (v.depth + 1), 160 * i];
  };

  graph.nodes.forEach((v, i) => {
    const name = uniqueName(v.synthetic ? syntheticName(v) : v.title || v.kind);
    nameOf.set(v.id, name);
    nodes.push(mapNode(v, name, pos(v, i), graph, options, catalog, unmapped));
  });

  /* ── connections ─────────────────────────────────────────────────────────
   * 출력 인덱스: XOR/skip은 갈래 순서가 곧 출력 인덱스다. 그 외는 전부 0.
   * (사용자가 쓴 순서 = 정상 경로 우선, DESIGN §6.5와 같은 규칙) */

  const connections: Record<string, { main: N8nConnection[][] }> = {};
  const outIndexOf = new Map<string, number>();
  for (const v of graph.nodes) {
    const outs = graph.outgoing.get(v.id) ?? [];
    const branching = v.kind === 'branch' && v.branchMode !== 'and';
    outs.forEach((e, k) => outIndexOf.set(e.id, branching ? k : 0));
  }

  for (const v of graph.nodes) {
    const from = nameOf.get(v.id)!;
    const outs = graph.outgoing.get(v.id) ?? [];
    if (outs.length === 0) continue;
    const main: N8nConnection[][] = [];
    for (const e of outs) {
      const idx = outIndexOf.get(e.id) ?? 0;
      while (main.length <= idx) main.push([]);
      main[idx]!.push({ node: nameOf.get(e.target)!, type: 'main', index: 0 });
    }
    connections[from] = { main };
  }

  /* ── 구조적 손실 기록 ───────────────────────────────────────────────── */

  if (graph.nodes.some((n) => n.kind === 'branch' && n.branchMode === 'and')) {
    notes.push(
      'n8n은 병렬 갈래를 동시에 실행하지 않고 순서대로 실행합니다. ' +
        '이 문서의 리드타임 계산(동시 = max)은 실행 시점에는 성립하지 않습니다.',
    );
    for (const n of graph.nodes) {
      if (n.kind === 'branch' && n.branchMode === 'and') {
        unmapped.push({
          nodeId: n.id,
          itemId: n.itemId,
          reason: 'parallel-semantics',
          detail: '동시 실행이 순차 실행으로 바뀝니다.',
        });
      }
    }
  }
  if (graph.acyclic.backEdgeIds.length > 0) {
    notes.push('되돌아가는 흐름(재작업 루프)은 연결만 옮겼습니다. 종료 조건은 비어 있습니다.');
    for (const id of graph.acyclic.backEdgeIds) {
      const e = graph.edges.find((x) => x.id === id)!;
      unmapped.push({
        nodeId: e.source,
        itemId: graph.byId.get(e.source)?.itemId ?? null,
        reason: 'loop-condition',
        detail: '반복을 멈출 조건이 없습니다. n8n에서 직접 채워야 합니다.',
      });
    }
  }
  unmapped.push({
    nodeId: START_ID,
    itemId: null,
    reason: 'no-data-model',
    detail:
      '단계 사이에 무엇이 전달되는지 이 문서에는 없습니다. 모든 노드의 입출력 매핑이 비어 있습니다.',
  });

  const steps = graph.nodes.filter((n) => n.kind === 'task' || n.kind === 'hold');
  const unmappedSteps = new Set(
    unmapped.filter((u) => u.reason === 'no-tool-binding' || u.reason === 'human-task').map((u) => u.nodeId),
  );
  const coverage = steps.length === 0 ? 1 : (steps.length - unmappedSteps.size) / steps.length;

  return {
    workflow: {
      name: options.name,
      nodes,
      connections,
      active: false,
      settings: {},
      pinData: {},
      meta: { generatedBy: 'graph-core', sourceTopologyHash: graph.topologyHash },
    },
    unmapped,
    coverage,
    notes,
  };
}

function syntheticName(v: DerivedNode): string {
  if (v.id === START_ID) return 'Start';
  if (v.id === END_ID) return 'End';
  return `Merge (${v.joinOf ?? ''})`;
}

function mapNode(
  v: DerivedNode,
  name: string,
  position: [number, number],
  graph: DerivedGraph,
  options: ToN8nOptions,
  catalog: NonNullable<ToN8nOptions['toolCatalog']>,
  unmapped: UnmappedItem[],
): N8nNode {
  const base = { id: v.id, name, position, notesInFlow: true };

  if (v.id === START_ID) {
    const t = options.trigger;
    if (t.kind === 'schedule') {
      return { ...base, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'cronExpression', expression: t.cron }] } } };
    }
    if (t.kind === 'webhook') {
      return { ...base, type: 'n8n-nodes-base.webhook', typeVersion: 2, parameters: { path: t.path, httpMethod: 'POST' } };
    }
    return { ...base, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} };
  }

  if (v.id === END_ID) {
    return { ...base, type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} };
  }

  if (v.kind === 'join') {
    const inputs = (graph.incoming.get(v.id) ?? []).length;
    return {
      ...base,
      type: 'n8n-nodes-base.merge',
      typeVersion: 3,
      parameters: { mode: 'combine', combineBy: 'combineAll', numberInputs: Math.max(2, inputs) },
      notes: '모든 갈래가 끝날 때까지 기다리는 지점입니다.',
    };
  }

  if (v.kind === 'branch') {
    const outs = (graph.outgoing.get(v.id) ?? []).filter((e) => e.reason !== 'explicit');
    const labels = outs.map((e) => e.label ?? '조건');
    unmapped.push({
      nodeId: v.id,
      itemId: v.itemId,
      reason: 'condition-unknown',
      detail: `조건 "${labels.join(' / ')}"은 자연어입니다. n8n 표현식으로 자동 변환하지 않습니다.`,
    });
    if (v.branchMode === 'and') {
      return { ...base, type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {}, notes: '여기서 여러 갈래가 시작됩니다.' };
    }
    if (outs.length <= 2) {
      return {
        ...base,
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        parameters: { conditions: { conditions: [] } },
        notes: labels.join(' / '),
      };
    }
    return {
      ...base,
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      parameters: { rules: { values: labels.map((l) => ({ outputKey: l, conditions: { conditions: [] } })) } },
      notes: labels.join(' / '),
    };
  }

  if (v.kind === 'hold') {
    const w = v.waitFor;
    if (w === 'time') {
      return {
        ...base,
        type: 'n8n-nodes-base.wait',
        typeVersion: 1.1,
        parameters: { resume: 'timeInterval', amount: v.attrs.avgWaitH ?? 1, unit: 'hours' },
      };
    }
    unmapped.push({
      nodeId: v.id,
      itemId: v.itemId,
      reason: 'human-task',
      detail: `"${v.title}"은 사람이 개입하는 대기(${w ?? '미지정'})입니다. 대기 껍데기만 나갑니다.`,
    });
    if (typeof v.attrs.timeoutH === 'number') {
      unmapped.push({
        nodeId: v.id,
        itemId: v.itemId,
        reason: 'timeout-escalation',
        detail: `${v.attrs.timeoutH}시간 후 에스컬레이션은 n8n Wait 노드로 표현할 수 없습니다.`,
      });
    }
    return {
      ...base,
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      parameters: { resume: 'webhook' },
      notes: `${v.title} — 사람이 처리해야 합니다.`,
    };
  }

  // task
  const bound = v.toolIds.map((t) => catalog[t]?.n8nNodeType).find((t) => !!t);
  if (!bound) {
    unmapped.push({
      nodeId: v.id,
      itemId: v.itemId,
      reason: 'no-tool-binding',
      detail:
        v.toolIds.length === 0
          ? '사용 도구가 없습니다.'
          : `도구 ${v.toolIds.join(', ')}에 n8n 노드 타입이 매핑되어 있지 않습니다.`,
    });
    return { ...base, type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {}, notes: v.title, disabled: true };
  }
  return { ...base, type: bound, typeVersion: 1, parameters: {}, notes: v.title };
}

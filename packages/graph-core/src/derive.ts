/**
 * packages/graph-core/src/derive.ts
 *
 *   graph = derive(tree) ⊕ overrides                        (D-030)
 *
 * 순수 함수. 같은 입력 → 같은 출력. Date.now() / Math.random() / 전역 상태 없음.
 *
 * 시간 복잡도
 *   전처리     O(n log n)   — 형제 정렬만이 로그 항. 나머지는 선형
 *   컴파일     O(n)         — 각 항목을 정확히 한 번 방문
 *   오버레이   O(m + d)     — m = edges 행 수, d = 파생 엣지 수
 *   사이클     O(V + E)     DFS + back edge당 BFS 1회 → O(B·(V+E)), B는 back edge 수
 *   메트릭     O(V + E)     위상 정렬 1회 + 전/후향 DP 각 1회
 *   전체       O(n log n + B·(V+E)),  실무 범위(n ≤ 500, B ≤ 5)에서 사실상 O(n log n)
 *
 * 공간 O(n).
 */

import type {
  DeriveOptions,
  DerivedEdge,
  DerivedGraph,
  DerivedNode,
  Diagnostic,
  Edge,
  EdgeReason,
  Item,
  NodeId,
} from './types.ts';
import {
  END_ID,
  START_ID,
  derivedEdgeId,
  joinNodeId,
  reservedTarget,
} from './ids.ts';
import {
  branchModeOf,
  caseLabelOf,
  joinBehaviorOf,
  preprocess,
  type PItem,
} from './preprocess.ts';
import { analyzeCycles } from './cycles.ts';
import { computeMetrics } from './metrics.ts';
import { hash32, pushTo } from './util.ts';

/* ────────────────────────────────────────────────────────────────────────── */

const DEFAULT_SKIP_ELSE_LABEL = '해당 없음';

/** 연결의 열린 끝. "다음이 붙으면 이 reason으로 이 노드에서 나간다" */
type Tail = {
  from: NodeId;
  reason: EdgeReason;
  label?: string;
  caseItemId?: string;
};

/**
 * 한 항목(또는 항목 시퀀스)의 컴파일 결과.
 *
 * 불변식: `tails.length === 0` 이면 `fallbackFrom`이 반드시 설정된다.
 *         → 뒤에 무엇이 오든 그래프는 언제나 연결된다 (§3 A7).
 */
type Compiled = {
  head: NodeId | null;
  tails: Tail[];
  fallbackFrom?: NodeId;
};

/* ────────────────────────────────────────────────────────────────────────── */

export function derive(
  items: readonly Item[],
  edges: readonly Edge[],
  options: DeriveOptions = {},
): DerivedGraph {
  const diagnostics: Diagnostic[] = [];
  const skipElseLabel = options.labels?.skipElse ?? DEFAULT_SKIP_ELSE_LABEL;

  const tree = preprocess(items, diagnostics);

  /* ── 그래프 빌더 ─────────────────────────────────────────────────────── */

  const nodes = new Map<NodeId, DerivedNode>();
  const edgeMap = new Map<string, DerivedEdge>();

  const ORDER_STEP = 1000;

  const addNode = (n: DerivedNode): NodeId => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };

  addNode({
    id: START_ID,
    kind: 'start',
    itemId: null,
    title: '시작',
    synthetic: true,
    order: -1,
    depth: 0,
    attrs: {},
    toolIds: [],
  });
  addNode({
    id: END_ID,
    kind: 'end',
    itemId: null,
    title: '끝',
    synthetic: true,
    order: Number.MAX_SAFE_INTEGER,
    depth: 0,
    attrs: {},
    toolIds: [],
  });

  const nodeOfItem = (p: PItem): NodeId =>
    addNode({
      id: p.id,
      kind: p.kind,
      itemId: p.id,
      title: p.item.title,
      synthetic: false,
      order: p.order * ORDER_STEP,
      depth: p.depth,
      attrs: p.item.attrs,
      branchMode: p.kind === 'branch' ? branchModeOf(p) : undefined,
      waitFor: p.kind === 'hold' ? p.item.attrs.waitFor : undefined,
      assigneeId: p.item.assigneeId ?? null,
      durationBand: p.item.durationBand ?? null,
      toolIds: p.item.toolIds ?? [],
      painFlag: p.item.painFlag ?? false,
      lastConfirmedAt: p.item.lastConfirmedAt ?? null,
    });

  const lastOrderInSubtree = (p: PItem): number => {
    let max = p.order;
    for (const c of p.children) max = Math.max(max, lastOrderInSubtree(c));
    return max;
  };

  const nodeOfJoin = (b: PItem): NodeId =>
    addNode({
      id: joinNodeId(b.id),
      kind: 'join',
      itemId: null,
      title: '모두 끝나면',
      synthetic: true,
      order: lastOrderInSubtree(b) * ORDER_STEP + 1,
      depth: b.depth,
      attrs: {},
      toolIds: [],
      joinOf: b.id,
    });

  const addEdge = (
    source: NodeId,
    target: NodeId,
    reason: EdgeReason,
    label?: string,
    caseItemId?: string,
  ): void => {
    const id = derivedEdgeId(reason, source, target, caseItemId);
    if (edgeMap.has(id)) return;
    edgeMap.set(id, {
      id,
      source,
      target,
      origin: 'derived',
      reason,
      label,
      caseItemId,
      isBackEdge: false,
    });
  };

  const diag = (d: Diagnostic): void => {
    diagnostics.push(d);
  };

  /* ── 컴파일 ──────────────────────────────────────────────────────────── */

  /** 형제 시퀀스 → 사슬. 규칙 (a) */
  function compileSequence(list: readonly PItem[]): Compiled {
    let head: NodeId | null = null;
    let prev: Compiled | null = null;

    for (const p of list) {
      const cur = compileStep(p);
      if (cur.head === null) continue;

      if (head === null) {
        head = cur.head;
      } else if (prev) {
        if (prev.tails.length > 0) {
          for (const t of prev.tails) addEdge(t.from, cur.head, t.reason, t.label, t.caseItemId);
        } else if (prev.fallbackFrom) {
          // 모든 갈래가 '여기서 끝'인데 뒤에 형제가 있다 (§3 A7)
          addEdge(prev.fallbackFrom, cur.head, 'fallthrough');
          diag({
            code: 'all-cases-end-with-successor',
            severity: 'repaired',
            nodeIds: [prev.fallbackFrom, cur.head],
            detail:
              '모든 갈래가 joinBehavior:"end"인데 분기 뒤에 형제 단계가 있다. ' +
              '해당 단계가 그래프에서 고립되지 않도록 분기 노드에서 직접 연결했다.',
            userMessage:
              '갈래가 모두 "여기서 끝"이라, 이 단계로 오는 길은 갈래를 타지 않는 경우로 그렸어요.',
          });
        }
      }
      prev = cur;
    }

    if (!prev) return { head: null, tails: [] };
    return { head, tails: prev.tails, fallbackFrom: prev.fallbackFrom };
  }

  /** 한 단계 (task / hold / branch) */
  function compileStep(p: PItem): Compiled {
    if (p.kind === 'branch') return compileBranch(p);

    const node = nodeOfItem(p);

    // 작업/기다림의 자식은 문법상 존재하지 않지만 데이터로는 올 수 있다
    // (붙여넣기 파서, AI 초안, 마이그레이션). 버리지 않고 하위 시퀀스로 잇는다.
    if (p.children.length > 0) {
      diag({
        code: 'task-with-children',
        severity: 'repaired',
        itemIds: [p.id],
        detail:
          `${p.kind} 항목에 하위 항목이 있다. 갈래가 아니므로 "이 단계 다음에 이어지는 ` +
          `하위 단계들"로 해석해 순차 연결했다.`,
        userMessage: null,
      });
      const body = compileSequence(p.children);
      if (body.head !== null) {
        addEdge(node, body.head, 'subtree');
        if (body.tails.length > 0) return { head: node, tails: body.tails };
        return { head: node, tails: [], fallbackFrom: body.fallbackFrom ?? node };
      }
    }

    return { head: node, tails: [{ from: node, reason: 'sequence' }] };
  }

  /** 분기. 규칙 (b) (c) */
  function compileBranch(b: PItem): Compiled {
    const bNode = nodeOfItem(b);
    const mode = branchModeOf(b);
    const cases = b.children; // 전부 role === 'case' (교대 규칙)

    /* A8 · 자식 없는 분기 → 평범한 단계로 강등 */
    if (cases.length === 0) {
      diag({
        code: mode === 'skip' ? 'skip-without-case' : 'branch-without-case',
        severity: 'repaired',
        itemIds: [b.id],
        nodeIds: [bNode],
        detail:
          '갈래가 하나도 없는 분기. 나눌 것이 없으므로 일반 단계처럼 다음으로 이어붙였다. ' +
          '노드는 남긴다 — 사용자가 방금 만들고 아직 채우지 않은 상태일 수 있다.',
        userMessage: null,
      });
      return { head: bNode, tails: [{ from: bNode, reason: 'sequence' }] };
    }

    if (cases.length === 1) {
      diag({
        code: 'branch-single-case',
        severity: 'note',
        itemIds: [b.id],
        nodeIds: [bNode],
        detail:
          `갈래가 1개인 ${mode} 분기. 위상은 그대로 유지한다 — ` +
          `사용자가 두 번째 갈래를 쓰는 중일 수 있고, 노드를 없애면 ID가 사라진다.`,
        userMessage: null,
      });
    }

    /* ── AND: 진짜 병렬. 합류 노드를 실제로 만든다 (§6) ─────────────────── */
    if (mode === 'and' && cases.length >= 2) {
      const joinId = nodeOfJoin(b);
      const allEnd = cases.every((c) => joinBehaviorOf(c) === 'end');

      for (const c of cases) {
        const label = caseLabelOf(c);
        if (joinBehaviorOf(c) === 'end' && !allEnd) {
          diag({
            code: 'and-case-end-ignored',
            severity: 'repaired',
            itemIds: [c.id],
            detail:
              '동시(AND) 분기의 일부 갈래만 "여기서 끝"이다. 그대로 두면 합류 노드가 ' +
              '영원히 기다리는 교착이 된다. 해당 갈래도 합류시킨다.',
            userMessage: '동시에 진행하는 갈래라, 이 갈래도 모두 끝나는 지점에서 합쳐요.',
          });
        }
        const body = compileSequence(c.children);
        if (body.head === null) {
          diag(emptyCaseDiag(c, b));
          addEdge(bNode, joinId, 'and-fork', label, c.id);
          continue;
        }
        addEdge(bNode, body.head, 'and-fork', label, c.id);
        const tails = body.tails.length > 0 ? body.tails : [{ from: body.fallbackFrom! }];
        for (const t of tails) addEdge(t.from, joinId, 'and-join', undefined, c.id);
      }

      if (allEnd) {
        addEdge(joinId, END_ID, 'end');
        return { head: bNode, tails: [], fallbackFrom: joinId };
      }
      return { head: bNode, tails: [{ from: joinId, reason: 'join-out' }] };
    }

    /* A11 · 갈래 1개짜리 AND는 병렬이 아니다 → 합류 노드를 만들지 않는다 */
    if (mode === 'and' && cases.length === 1) {
      diag({
        code: 'and-single-case',
        severity: 'repaired',
        itemIds: [b.id],
        nodeIds: [bNode],
        detail:
          '갈래가 1개인 동시(AND) 분기. 동기화할 대상이 없으므로 합류 노드를 만들지 않는다. ' +
          '리드타임 계산에서 max(단일) = sum(단일)이라 결과도 동일하다.',
        userMessage: null,
      });
    }

    /* ── XOR / skip / 단일 AND ─────────────────────────────────────────── */
    const tails: Tail[] = [];

    for (const c of cases) {
      const label = caseLabelOf(c);
      const ends = joinBehaviorOf(c) === 'end';
      const body = compileSequence(c.children);

      /* A2 · 빈 갈래 = 조건만 적고 단계를 안 적음 → 라벨 붙은 통과 엣지 */
      if (body.head === null) {
        diag(emptyCaseDiag(c, b));
        if (ends) addEdge(bNode, END_ID, 'end', label, c.id);
        else tails.push({ from: bNode, reason: 'branch-case', label, caseItemId: c.id });
        continue;
      }

      addEdge(bNode, body.head, 'branch-case', label, c.id);

      const bodyTails: Tail[] =
        body.tails.length > 0
          ? body.tails
          : [{ from: body.fallbackFrom!, reason: 'fallthrough' }];

      if (ends) {
        for (const t of bodyTails) addEdge(t.from, END_ID, 'end');
      } else {
        for (const t of bodyTails) {
          tails.push({
            from: t.from,
            // 갈래를 빠져나가는 순간 이유는 "합류"다. 중첩 구조가 만든
            // join-out / skip-else 는 그대로 보존해 설명 가능성을 유지한다.
            reason: t.reason === 'sequence' ? 'case-join' : t.reason,
            caseItemId: t.caseItemId,
          });
        }
      }
    }

    /* A12 · skip = XOR + 암묵적 "아무것도 안 함" 경로 */
    if (mode === 'skip') {
      tails.push({ from: bNode, reason: 'skip-else', label: skipElseLabel });
    }

    if (tails.length === 0) {
      return { head: bNode, tails: [], fallbackFrom: bNode };
    }
    return { head: bNode, tails };
  }

  function emptyCaseDiag(c: PItem, b: PItem): Diagnostic {
    return {
      code: 'empty-case',
      severity: 'repaired',
      itemIds: [c.id, b.id],
      detail:
        '단계가 없는 갈래. 노드를 만들지 않고 "조건 라벨이 붙은 통과 엣지"로 그린다. ' +
        '빈 상자를 그리면 사용자는 자기가 뭘 빠뜨렸다고 읽는다.',
      userMessage: null,
    };
  }

  /* ── 루트 ────────────────────────────────────────────────────────────── */

  const root = compileSequence(tree.roots);
  if (root.head === null) {
    // A10 · 전부 tombstone 이거나 애초에 빈 문서
    addEdge(START_ID, END_ID, 'start');
  } else {
    addEdge(START_ID, root.head, 'start');
    for (const t of root.tails) addEdge(t.from, END_ID, 'end', t.label, t.caseItemId);
    // tails가 비어 있으면 모든 경로가 이미 END에 닿아 있다. fallbackFrom은 버린다.
  }

  /* ── 오버레이: suppressed → explicit 순서 ────────────────────────────── */

  const resolve = (raw: string): NodeId | null => {
    if (nodes.has(raw)) return raw;
    const r = reservedTarget(raw);
    if (!r) return null;
    if (!nodes.has(r.itemId)) return null;
    if (r.kind === 'fork') return r.itemId; // fork는 분기 노드의 정규 별칭
    diag({
      code: 'join-alias-unmaterialized',
      severity: 'repaired',
      nodeIds: [r.itemId],
      detail:
        `${raw}는 실체화되지 않은 합류 노드다(XOR/skip 분기는 합류 노드를 만들지 않는다). ` +
        '분기 노드 자체로 해석했다.',
      userMessage: null,
    });
    return r.itemId;
  };

  const sorted = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const e of sorted) {
    if (e.kind !== 'suppressed') continue;
    const s = resolve(e.sourceId);
    const t = resolve(e.targetId);
    let removed = 0;
    if (s && t) {
      for (const [id, de] of [...edgeMap]) {
        if (de.origin === 'derived' && de.source === s && de.target === t) {
          edgeMap.delete(id);
          removed++;
        }
      }
    }
    if (removed === 0) {
      /* A15 · 억제 대상이 없다 — 행은 지우지 않는다 */
      diag({
        code: 'suppress-noop',
        severity: 'note',
        edgeIds: [e.id],
        detail:
          `억제 대상 파생 엣지 없음 (${e.sourceId} → ${e.targetId}). 행은 유지한다 — ` +
          '트리를 되돌리면 그 파생 엣지가 다시 생기고 억제가 그때 발효되어야 한다.',
        userMessage: null,
      });
    }
  }

  for (const e of sorted) {
    if (e.kind !== 'explicit') continue;
    const s = resolve(e.sourceId);
    const t = resolve(e.targetId);

    /* A14 · dangling */
    if (!s || !t) {
      diag({
        code: 'dangling-edge',
        severity: 'repaired',
        edgeIds: [e.id],
        detail:
          `존재하지 않는 노드를 가리키는 명시적 엣지 (${e.sourceId} → ${e.targetId}). ` +
          '그래프에서는 제외하되 DB 행은 유지한다 — 삭제된 항목이 복원되면 되살아나야 한다.',
        userMessage: null,
      });
      continue;
    }
    if (t === START_ID) {
      diag({
        code: 'edge-into-start',
        severity: 'repaired',
        edgeIds: [e.id],
        detail: '시작 노드로 들어오는 엣지는 의미가 없다. 무시했다.',
        userMessage: null,
      });
      continue;
    }
    if (s === END_ID) {
      diag({
        code: 'edge-out-of-end',
        severity: 'repaired',
        edgeIds: [e.id],
        detail: '종료 노드에서 나가는 엣지는 의미가 없다. 무시했다.',
        userMessage: null,
      });
      continue;
    }

    /* A13 · self-loop — 정상이다. "될 때까지 반복"은 실무 패턴이다 */
    if (s === t) {
      diag({
        code: 'self-loop',
        severity: 'note',
        edgeIds: [e.id],
        nodeIds: [s],
        detail:
          '자기 자신을 가리키는 엣지. 길이 1인 사이클로 유지한다. 캔버스는 별도 엣지가 아니라 ' +
          '노드 우상단 ↻ 배지로 렌더링한다(ELK layered의 self-loop 라우팅이 지저분하므로).',
        userMessage: '이 단계는 조건이 맞을 때까지 반복해요.',
      });
    }

    for (const [id, de] of [...edgeMap]) {
      if (de.origin === 'derived' && de.source === s && de.target === t) {
        edgeMap.delete(id);
        diag({
          code: 'explicit-duplicates-derived',
          severity: 'note',
          edgeIds: [e.id, id],
          detail:
            '명시적 엣지가 파생 엣지와 같은 (source, target)이다. 명시가 이긴다 — ' +
            '호버 설명이 "자동으로 이어졌어요"가 아니라 "직접 이으신 연결이에요"가 되어야 한다.',
          userMessage: null,
        });
      }
    }

    edgeMap.set(e.id, {
      id: e.id,
      source: s,
      target: t,
      origin: 'explicit',
      reason: 'explicit',
      label: e.label,
      isBackEdge: false,
    });
  }

  /* ── 정규 순서 부여 ──────────────────────────────────────────────────── */

  const nodeList = [...nodes.values()].sort((a, b) => a.order - b.order);
  nodeList.forEach((n, i) => {
    (n as { order: number }).order = i;
  });
  const rank = new Map<NodeId, number>(nodeList.map((n) => [n.id, n.order]));

  /**
   * 엣지 배열 순서는 그냥 정렬이 아니다 — **ELK model order 그 자체다.**
   * `considerModelOrder`가 이 순서를 갈래의 좌우 배치로 쓴다. 그래서 2차 키가
   * target rank가 아니라 **갈래 항목의 문서 순서**여야 한다. 빈 갈래처럼 몸통이
   * 없는 갈래는 target이 훨씬 뒤 노드가 되는데, target으로 정렬하면 사용자가
   * 첫 번째로 쓴 갈래가 화면 오른쪽 끝으로 밀린다.
   *
   * "사용자가 먼저 쓴 갈래가 항상 최좌측" = 정상 경로가 눈에 먼저 들어온다
   * (DESIGN §6.5). 이 한 줄이 그 규칙을 보장한다.
   */
  const caseOrderOf = (id?: string): number =>
    id ? (tree.byId.get(id)?.order ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  const edgeList = [...edgeMap.values()].sort((a, b) => {
    const s = (rank.get(a.source) ?? 0) - (rank.get(b.source) ?? 0);
    if (s !== 0) return s;
    const c = caseOrderOf(a.caseItemId) - caseOrderOf(b.caseItemId);
    if (c !== 0) return c;
    const t = (rank.get(a.target) ?? 0) - (rank.get(b.target) ?? 0);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const outgoing = new Map<NodeId, DerivedEdge[]>();
  const incoming = new Map<NodeId, DerivedEdge[]>();
  for (const e of edgeList) {
    pushTo(outgoing, e.source, e);
    pushTo(incoming, e.target, e);
  }

  /* ── 사이클 (§5) ─────────────────────────────────────────────────────── */

  const cyc = analyzeCycles(nodeList, edgeList, outgoing, rank, options, diag);

  /* ── 도달 불가 / 종료 불가 관찰 ─────────────────────────────────────── */

  const reachable = new Set<NodeId>([START_ID]);
  {
    const stack: NodeId[] = [START_ID];
    while (stack.length) {
      const v = stack.pop()!;
      for (const e of outgoing.get(v) ?? []) {
        if (!reachable.has(e.target)) {
          reachable.add(e.target);
          stack.push(e.target);
        }
      }
    }
  }
  const unreachable = nodeList.filter((n) => !reachable.has(n.id)).map((n) => n.id);
  if (unreachable.length > 0) {
    diag({
      code: 'unreachable-node',
      severity: 'note',
      nodeIds: unreachable,
      detail:
        'start에서 도달할 수 없는 노드. derive()의 복구 규칙상 정상 입력에서는 발생하지 않는다. ' +
        '발생하면 억제 엣지(suppressed)가 유일한 진입로를 끊은 경우다 — 사용자의 명시적 의도이므로 그대로 둔다.',
      userMessage: null,
    });
  }

  /* ── 메트릭 (§7) ─────────────────────────────────────────────────────── */

  const metrics = computeMetrics({
    nodes: nodeList,
    edges: edgeList,
    outgoing,
    incoming,
    topoOrder: cyc.topoOrder,
    cycles: cyc.cycles,
    tree,
    options,
    diag,
  });

  /* ── 해시 ────────────────────────────────────────────────────────────── */

  const topologyHash = hash32(
    nodeList.map((n) => `${n.id}|${n.kind}|${n.branchMode ?? ''}`).join(';') +
      '::' +
      edgeList.map((e) => `${e.source}>${e.target}|${e.reason}`).join(';'),
  );
  const contentHash = hash32(
    topologyHash +
      '::' +
      nodeList
        .map(
          (n) =>
            `${n.id}|${n.title}|${n.assigneeId ?? ''}|${n.durationBand ?? ''}|` +
            `${[...n.toolIds].sort().join(',')}|${n.painFlag ? 1 : 0}`,
        )
        .join(';') +
      '::' +
      edgeList.map((e) => `${e.id}|${e.label ?? ''}`).join(';'),
  );

  return {
    nodes: nodeList,
    edges: edgeList,
    byId: nodes,
    outgoing,
    incoming,
    acyclic: { topoOrder: cyc.topoOrder, backEdgeIds: cyc.backEdgeIds },
    metrics,
    diagnostics,
    topologyHash,
    contentHash,
  };
}

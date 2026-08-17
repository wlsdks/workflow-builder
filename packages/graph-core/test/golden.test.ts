/**
 * packages/graph-core/test/golden.test.ts
 *
 *   node --test packages/graph-core/test/
 *
 * 골든 픽스처 + 불변식 테스트. 외부 테스트 러너 의존 없음(node:test).
 */

import { deepStrictEqual, ok, strictEqual, notStrictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derive } from '../src/derive.ts';
import { validate } from '../src/validate.ts';
import { formatDiagnostics, formatEdges, formatNodes } from '../src/format.ts';
import { fixtures } from '../src/__fixtures__/golden.ts';
import { build } from '../src/__fixtures__/builder.ts';
import { isReservedId } from '../src/ids.ts';
import { toN8n } from '../src/export/n8n.ts';
import { canApplyCanvasEdit, projectCanvasEdit } from '../src/project/back.ts';
import { recomputeScope } from '../src/incremental.ts';
import type { DerivedGraph } from '../src/types.ts';

const at = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), obj);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

describe('골든 픽스처', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const g = derive(f.items, f.edges, f.options ?? {});

      if (f.expectNodes) deepStrictEqual(formatNodes(g), f.expectNodes, '노드');
      deepStrictEqual(formatEdges(g), f.expectEdges, '엣지');
      if (f.expectDiagnostics) deepStrictEqual(formatDiagnostics(g), f.expectDiagnostics, '진단');

      for (const [path, expected] of Object.entries(f.expectMetrics ?? {})) {
        deepStrictEqual(at(g.metrics, path), expected, `metrics.${path}`);
      }
    });
  }
});

describe('불변식', () => {
  it('순수하다 — 같은 입력이면 같은 출력, 입력을 변형하지 않는다', () => {
    for (const f of fixtures) {
      deepFreeze(f.items);
      deepFreeze(f.edges);
      const a = derive(f.items, f.edges, f.options ?? {});
      const b = derive(f.items, f.edges, f.options ?? {});
      deepStrictEqual(formatEdges(a), formatEdges(b), f.name);
      strictEqual(a.topologyHash, b.topologyHash, f.name);
      strictEqual(a.contentHash, b.contentHash, f.name);
    }
  });

  it('입력 배열 순서에 의존하지 않는다 (Yjs 병합 후 재계산 안전성)', () => {
    for (const f of fixtures) {
      const a = derive(f.items, f.edges, f.options ?? {});
      const b = derive([...f.items].reverse(), [...f.edges].reverse(), f.options ?? {});
      deepStrictEqual(formatNodes(b), formatNodes(a), f.name);
      deepStrictEqual(formatEdges(b), formatEdges(a), f.name);
    }
  });

  it('back edge를 빼면 DAG다 — 모든 노드가 위상 정렬에 들어간다', () => {
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      strictEqual(g.acyclic.topoOrder.length, g.nodes.length, f.name);
      strictEqual(new Set(g.acyclic.topoOrder).size, g.nodes.length, f.name);
    }
  });

  it('start는 들어오는 엣지가 없고 end는 나가는 엣지가 없다', () => {
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      strictEqual((g.incoming.get('start') ?? []).length, 0, f.name);
      strictEqual((g.outgoing.get('end') ?? []).length, 0, f.name);
    }
  });

  it('모든 항목 노드 ID는 항목 ID 그대로다 (위치에서 유도하지 않는다)', () => {
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      for (const n of g.nodes) {
        if (n.synthetic) ok(isReservedId(n.id), `${f.name}: ${n.id}`);
        else strictEqual(n.id, n.itemId, f.name);
      }
    }
  });

  it('모든 엣지가 "왜 생겼는가"에 답할 수 있다', () => {
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      const report = validate(g);
      for (const e of g.edges) {
        ok(report.edgeExplanations.has(e.id), `${f.name}: ${e.id} 설명 없음`);
      }
    }
  });

  it('진단에 error 심각도가 존재하지 않는다', () => {
    for (const f of fixtures) {
      const g = derive(f.items, f.edges, f.options ?? {});
      for (const d of g.diagnostics) ok(d.severity === 'repaired' || d.severity === 'note');
    }
  });
});

describe('레이아웃 게이트 (D-024)', () => {
  const base = build([{ id: 'a', title: '접수' }, { id: 'b', title: '확인' }]);

  it('제목만 바뀌면 topologyHash가 변하지 않는다', () => {
    const g1 = derive(base, []);
    const g2 = derive(
      base.map((i) => (i.id === 'a' ? { ...i, title: '접수합니다' } : i)),
      [],
    );
    strictEqual(g1.topologyHash, g2.topologyHash);
    notStrictEqual(g1.contentHash, g2.contentHash);
  });

  it('reworkRate가 바뀌어도 topologyHash가 변하지 않는다 (확률은 위상이 아니다)', () => {
    const g1 = derive(base, []);
    const g2 = derive(
      base.map((i) => (i.id === 'b' ? { ...i, attrs: { reworkRate: 0.4 } } : i)),
      [],
    );
    strictEqual(g1.topologyHash, g2.topologyHash);
  });

  it('순서가 바뀌면 topologyHash가 변한다', () => {
    const g1 = derive(base, []);
    const g2 = derive(
      base.map((i) => (i.id === 'b' ? { ...i, sortKey: 'A0' } : i)),
      [],
    );
    notStrictEqual(g1.topologyHash, g2.topologyHash);
  });
});

describe('toN8n (§10) — 스모크', () => {
  it('매핑 못 하는 것을 목록으로 정직하게 내보낸다', () => {
    const f = fixtures.find((x) => x.name.startsWith('36'))!;
    const g = derive(f.items, f.edges);
    const r = toN8n(g, {
      name: '계약 프로세스 초안',
      trigger: { kind: 'manual' },
      toolCatalog: {},
    });

    strictEqual(r.workflow.active, false);
    strictEqual(r.workflow.nodes.length, g.nodes.length);
    ok(r.unmapped.some((u) => u.reason === 'condition-unknown'), '자연어 조건은 변환하지 않는다');
    ok(r.unmapped.some((u) => u.reason === 'human-task'), '승인 대기는 사람 몫이다');
    ok(r.unmapped.some((u) => u.reason === 'parallel-semantics'), 'n8n은 병렬을 순차 실행한다');
    ok(r.unmapped.some((u) => u.reason === 'loop-condition'), '반복 종료 조건이 없다');
    ok(r.unmapped.some((u) => u.reason === 'no-data-model'), '데이터 모델이 없다');
    ok(r.coverage < 1, '도구 바인딩이 없으므로 커버리지 100%일 수 없다');

    // 트리거는 추론하지 않는다 — 호출자가 지정한 것이 그대로 나간다
    strictEqual(r.workflow.nodes[0]!.type, 'n8n-nodes-base.manualTrigger');
    // AND 합류는 Merge 노드로
    ok(r.workflow.nodes.some((n) => n.type === 'n8n-nodes-base.merge'));
  });
});

describe('역투영 (§11) — 스모크', () => {
  const items = build([
    { id: 'a' },
    { id: 'br', kind: 'branch', children: [{ id: 'c1', kind: 'branch', children: [{ id: 'x' }] }] },
    { id: 'z' },
  ]);
  const graph = derive(items, []);
  const ctx = {
    graph,
    items,
    keyBetween: (a: string | null, _b: string | null) => (a ?? '') + 'm',
    newId: () => 'new-id',
  };

  it('합성 노드는 옮기거나 지울 수 없다', () => {
    const r = canApplyCanvasEdit(graph, { kind: 'delete-node', nodeId: 'start' });
    notStrictEqual(r, true);
    strictEqual((r as { code: string }).code, 'synthetic-node');
  });

  it('임의의 엣지 긋기는 언제나 오버라이드가 된다 (구조를 건드리지 않는다)', () => {
    const r = projectCanvasEdit(ctx, { kind: 'connect', sourceNodeId: 'z', targetNodeId: 'a' });
    ok(r.ok);
    deepStrictEqual(r.ops, [{ type: 'add_edge', id: 'new-id', sourceId: 'z', targetId: 'a', label: undefined }]);
  });

  it('파생 엣지 끊기는 suppress_edge, 명시적 엣지 끊기는 remove_edge', () => {
    const derivedEdge = graph.edges.find((e) => e.origin === 'derived' && e.reason === 'sequence')!;
    const r = projectCanvasEdit(ctx, { kind: 'disconnect', edgeId: derivedEdge.id });
    ok(r.ok);
    strictEqual(r.ops[0]!.type, 'suppress_edge');
  });

  it('시작으로 들어가는 연결은 만들 수 없다', () => {
    const r = canApplyCanvasEdit(graph, { kind: 'connect', sourceNodeId: 'z', targetNodeId: 'start' });
    strictEqual((r as { code: string }).code, 'terminal-endpoint');
  });

  it('분기를 지우면 갈래 본문이 그 자리로 승격된다', () => {
    const r = projectCanvasEdit(ctx, { kind: 'delete-node', nodeId: 'br' });
    ok(r.ok);
    deepStrictEqual(
      r.ops.map((o) => `${o.type}:${(o as { id: string }).id}`),
      ['move_item:x', 'delete_item:c1', 'delete_item:br'],
    );
  });
});

describe('증분 범위 (§8)', () => {
  it('set_title은 위상·메트릭을 건드리지 않는다', () => {
    deepStrictEqual(recomputeScope([{ type: 'set_title', id: 'a', title: 'x' }]), {
      derive: true,
      topology: false,
      labels: true,
      metrics: false,
      cycles: false,
    });
  });

  it('set_attr{reworkRate}는 메트릭만 건드린다 (확률은 위상이 아니다)', () => {
    const s = recomputeScope([{ type: 'set_attr', id: 'a', patch: { reworkRate: 0.3 } }]);
    strictEqual(s.topology, false);
    strictEqual(s.metrics, true);
  });

  it('set_attr{mode}는 위상을 건드린다 (join 노드 생성/삭제)', () => {
    strictEqual(recomputeScope([{ type: 'set_attr', id: 'a', patch: { mode: 'and' } }]).topology, true);
  });
});

describe('결정적 ID (§2)', () => {
  it('무관한 형제를 추가해도 다른 노드의 ID가 바뀌지 않는다', () => {
    const before = derive(
      build([
        { id: 'a' },
        { id: 'br', kind: 'branch', children: [{ id: 'c1', kind: 'branch', attrs: { mode: undefined } }] },
      ]),
      [],
    );
    const after = derive(
      build([
        { id: 'a' },
        { id: 'zz' },
        { id: 'br', kind: 'branch', children: [{ id: 'c1', kind: 'branch', attrs: { mode: undefined } }] },
      ]),
      [],
    );
    for (const n of before.nodes) ok(after.byId.has(n.id), `사라진 노드 ${n.id}`);
  });

  it('AND 합류 노드 ID는 갈래 편집과 무관하게 분기 항목 ID에서만 나온다', () => {
    const mk = (cases: string[]): DerivedGraph =>
      derive(
        build([
          {
            id: 'sync',
            kind: 'branch',
            attrs: { mode: 'and' },
            children: cases.map((c) => ({ id: `case-${c}`, kind: 'branch' as const, children: [{ id: c }] })),
          },
        ]),
        [],
      );
    ok(mk(['x', 'y']).byId.has('join:sync'));
    ok(mk(['x', 'y', 'z']).byId.has('join:sync'));
    ok(mk(['p', 'q']).byId.has('join:sync'));
  });
});

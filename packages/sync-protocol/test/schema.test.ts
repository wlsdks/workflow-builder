/**
 * packages/sync-protocol/test/schema.test.ts
 *
 * 이 패키지가 지는 유일한 책임은 **신뢰 경계에서 거절하는 것**이다.
 * 그래서 테스트도 "무엇을 받아들이는가"보다 "무엇을 거절하는가"가 본체다.
 */

import { ok, strictEqual, deepStrictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyOp, emptyDoc, type Op } from '@workflow/graph-core';
import { OpSchema } from '../src/ops.ts';
import {
  ApplyOpsRequest,
  ApplyOpsResponse,
  EnvelopeSchema,
  MAX_OPS_PER_BATCH,
  statusOf,
} from '../src/envelope.ts';

const U = (n: number): string => `0000000${n}`.slice(-8) + '-0000-4000-8000-000000000000';
const ITEM = U(1);
const ACTOR = U(2);
const TOOL = U(3);
const DOC = U(4);

function envelope(op: unknown, i = 0): unknown {
  return { opId: U(100 + i), txnId: U(200), actorId: ACTOR, lamport: i, ts: 1700000000000, baseRevision: 0, op };
}

describe('OpSchema — 25종 전부 왕복한다', () => {
  const samples: Op[] = [
    { type: 'insert_item', id: ITEM, parentId: null, sortKey: 'a0', kind: 'task', title: '견적 요청 받기' },
    { type: 'delete_item', id: ITEM },
    { type: 'restore_item', id: ITEM },
    { type: 'move_item', id: ITEM, parentId: null, sortKey: 'a1' },
    { type: 'reorder_item', id: ITEM, sortKey: 'a2' },
    { type: 'set_title', id: ITEM, from: '견적서', to: '견적서 작성' },
    { type: 'set_kind', id: ITEM, from: 'task', to: 'branch' },
    { type: 'set_attr', id: ITEM, from: {}, to: { mode: 'and' } },
    { type: 'set_assignee', id: ITEM, from: null, to: ACTOR },
    { type: 'set_duration', id: ITEM, from: null, to: '1h' },
    { type: 'set_freq', id: ITEM, from: null, to: 3 },
    { type: 'set_automation', id: ITEM, from: null, to: 2 },
    { type: 'set_pain', id: ITEM, from: false, to: true },
    { type: 'confirm_item', id: ITEM, at: 1700000000000 },
    { type: 'add_tool', id: ITEM, toolId: TOOL },
    { type: 'remove_tool', id: ITEM, toolId: TOOL },
    { type: 'add_edge', id: U(5), sourceId: ITEM, targetId: 'end' },
    { type: 'suppress_edge', id: U(6), sourceId: 'start', targetId: ITEM },
    { type: 'remove_edge', id: U(5) },
    { type: 'unsuppress_edge', id: U(6) },
    { type: 'set_edge_label', id: U(5), from: null, to: '반려된 경우' },
    { type: 'set_doc_title', from: '', to: '견적 프로세스' },
    {
      type: 'paste_batch',
      parentId: null,
      items: [{ id: U(7), parentId: null, sortKey: 'b0', kind: 'task', title: '단계 1' }],
      edges: [],
      label: '붙여넣기 1줄',
    },
    {
      type: 'record_conflict',
      itemId: ITEM,
      field: 'title',
      base: JSON.stringify('견적서 작성'),
      variants: [
        { value: JSON.stringify('견적서 검토'), actorId: ACTOR, lamport: 1 },
        { value: JSON.stringify('견적서 승인'), actorId: U(8), lamport: 2 },
      ],
    },
    { type: 'resolve_conflict', itemId: ITEM, field: 'title', chosen: JSON.stringify('견적서 검토'), chosenBy: ACTOR },
  ];

  it('모든 op 타입이 파싱된다', () => {
    strictEqual(samples.length, 25);
    for (const op of samples) {
      const r = OpSchema.safeParse(op);
      ok(r.success, `${op.type}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
    }
  });

  it('JSON 왕복 후에도 같다 (와이어를 통과한다)', () => {
    for (const op of samples) {
      deepStrictEqual(OpSchema.parse(JSON.parse(JSON.stringify(op))), op);
    }
  });

  it('파싱된 op은 graph-core 리듀서에 그대로 들어간다', () => {
    let doc = emptyDoc(DOC);
    for (const raw of samples) {
      const op = OpSchema.parse(raw);
      doc = applyOp(doc, op); // ★ 타입이 어긋나면 여기서 컴파일이 깨진다
    }
    ok(doc.items.has(ITEM));
  });
});

describe('거절해야 하는 것', () => {
  const bad: Array<[string, unknown]> = [
    ['제목의 개행 (Y.Text 전환 지점 오염)', { type: 'set_title', id: ITEM, from: '', to: '가\n나' }],
    ['UUID가 아닌 id (D-031 위반)', { type: 'delete_item', id: 'i1' }],
    ['sortKey의 비 base62 문자', { type: 'reorder_item', id: ITEM, sortKey: 'a-0' }],
    ['없는 op 타입', { type: 'set_tools', id: ITEM, toolIds: [] }],
    ['폐기된 toggle_pain', { type: 'toggle_pain', id: ITEM, painFlag: true }],
    ['from이 빠진 필드 op (D-110)', { type: 'set_title', id: ITEM, to: '견적서' }],
    ['variants가 1개인 충돌', {
      type: 'record_conflict', itemId: ITEM, field: 'title', base: '""',
      variants: [{ value: '"a"', actorId: ACTOR, lamport: 1 }],
    }],
    ['빈 paste_batch', { type: 'paste_batch', parentId: null, items: [], edges: [], label: '' }],
    ['501줄 paste_batch', {
      type: 'paste_batch', parentId: null, label: '너무 큼', edges: [],
      items: Array.from({ length: 501 }, (_, i) => ({ id: U(1000 + i), parentId: null, sortKey: 'a0', kind: 'task', title: 'x' })),
    }],
    ['automationLevel 범위 초과', { type: 'set_automation', id: ITEM, from: null, to: 9 }],
  ];

  for (const [name, value] of bad) {
    it(name, () => strictEqual(OpSchema.safeParse(value).success, false));
  }

  it('set_tools / toggle_pain은 스키마에 존재하지 않는다 (§1.1c)', () => {
    const types = new Set(
      OpSchema.options.map((o) => (o.shape.type as { value: string }).value),
    );
    ok(!types.has('set_tools'));
    ok(!types.has('toggle_pain'));
    ok(types.has('add_tool') && types.has('remove_tool') && types.has('set_pain'));
    strictEqual(types.size, 25);
  });
});

describe('봉투와 배치', () => {
  it('봉투는 op을 감싼다 — op 안에는 ts도 actorId도 없다', () => {
    const parsed = EnvelopeSchema.parse(envelope({ type: 'delete_item', id: ITEM }));
    strictEqual(parsed.op.type, 'delete_item');
    ok(!('ts' in parsed.op));
    ok(!('actorId' in parsed.op));
  });

  it('배치 상한은 클라이언트 MAX_OPS와 같은 200이다 (§4.3)', () => {
    strictEqual(MAX_OPS_PER_BATCH, 200);
    const mk = (n: number): unknown => ({
      docId: DOC,
      baseRevision: 0,
      ops: Array.from({ length: n }, (_, i) => envelope({ type: 'delete_item', id: ITEM }, i)),
    });
    ok(ApplyOpsRequest.safeParse(mk(200)).success);
    strictEqual(ApplyOpsRequest.safeParse(mk(201)).success, false);
    strictEqual(ApplyOpsRequest.safeParse(mk(0)).success, false);
  });

  it('expectedContentHash는 hash32의 길이(7)를 따른다 — 명세의 16이 아니다', () => {
    const base = { docId: DOC, baseRevision: 0, ops: [envelope({ type: 'delete_item', id: ITEM })] };
    ok(ApplyOpsRequest.safeParse({ ...base, expectedContentHash: '1u8m842' }).success);
    strictEqual(ApplyOpsRequest.safeParse({ ...base, expectedContentHash: '0123456789abcdef' }).success, false);
  });

  it('응답 4종과 HTTP 상태', () => {
    const okRes = ApplyOpsResponse.parse({ kind: 'ok', revision: 7, appliedOpIds: [U(100)] });
    strictEqual(statusOf(okRes), 200);
    strictEqual(okRes.kind === 'ok' && okRes.serverOps.length, 0);
    strictEqual(statusOf(ApplyOpsResponse.parse({ kind: 'conflict', serverRevision: 9, missedOps: [] })), 409);
    strictEqual(statusOf(ApplyOpsResponse.parse({ kind: 'gone', revision: 9 })), 410);
    strictEqual(statusOf(ApplyOpsResponse.parse({ kind: 'denied', reason: 'read-only' })), 403);
  });

  it('서버가 network / server-error를 보낼 수는 없다 (와이어에 없는 kind)', () => {
    strictEqual(ApplyOpsResponse.safeParse({ kind: 'network' }).success, false);
  });
});

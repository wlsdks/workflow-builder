/**
 * packages/graph-core/test/ops.test.ts
 *
 *   node --test packages/graph-core/test/
 *
 * SYNC.md §14의 속성을 실행 가능한 형태로 옮긴 것.
 *
 *   P2 교환 표의 정확성 — commutes(x,y)가 true면 실제로 교환 가능하다   (§3, §14.2)
 *   P3 압축 보존       — applyOps(coalesce(ops)) ≡ applyOps(ops)        (§4.2, §14.4)
 *   P4 역연산 정확성   — applyOps([op, ...invertOp(s,op)])(s) ≡ s        (§2.4)
 *   P7 merge3 대칭성   — merge3(b,x,y).text === merge3(b,y,x).text       (§2.5)
 *   P8 전역성          — 어떤 op도 applyOp을 throw시키지 못한다          (§2.3)
 *
 * `≡`의 정의는 §3.1을 따른다: **derive().contentHash 동일**.
 * DocState까지 같아야 하는 곳은 `fullState()`로 따로 본다.
 *
 * 외부 러너·fast-check 의존 없음 — graph-core는 런타임 의존성 0이고(D-119),
 * 테스트도 같은 규율을 지킨다. 난수는 시드 고정 mulberry32다.
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derive } from '../src/derive.ts';
import type { DocState } from '../src/ops/state.ts';
import { emptyDoc, edgesOf, itemsOf } from '../src/ops/state.ts';
import { applyOp, applyOps } from '../src/ops/apply.ts';
import { invertOp } from '../src/ops/invert.ts';
import { batchCommutes, commutes } from '../src/ops/commute.ts';
import { coalesce, coalesceOps } from '../src/ops/coalesce.ts';
import { merge3 } from '../src/ops/merge.ts';
import { burstEnd, TITLE_IDLE_MS } from '../src/ops/burst.ts';
import type { OpEnvelope } from '../src/ops/envelope.ts';
import type { Op } from '../src/ops/types.ts';
import { OP_TYPES } from '../src/ops/types.ts';

/* ────────────────────────────────────────────────────────────────────────────
 * 0. 도구
 * ──────────────────────────────────────────────────────────────────────────── */

/** §3.1이 정의한 동치 — 그림이 같은가 */
function graphHash(s: DocState): string {
  return derive(itemsOf(s), edgesOf(s)).contentHash;
}

/** 키 순서에 의존하지 않는 직렬화 — attrs의 삽입 순서는 관찰 대상이 아니다 */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = stable((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** DocState 전체 — 문서 제목·충돌 레코드까지 본다. contentHash가 못 보는 축 */
function fullState(s: DocState): string {
  return JSON.stringify(stable({
    title: s.title,
    items: [...s.items.values()]
      .map((i) => ({
        ...i,
        lastConfirmedAt: i.lastConfirmedAt ? i.lastConfirmedAt.getTime() : null,
        deletedAt: i.deletedAt ? 1 : null,
        toolIds: [...(i.toolIds ?? [])],
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...s.edges.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    conflicts: [...s.conflicts.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }));
}

function env(op: Op, i = 0): OpEnvelope {
  return { opId: `o${i}`, txnId: 't', actorId: 'a', lamport: i, ts: 0, baseRevision: 0, op };
}

/** 시드 고정 난수. 실패는 시드로 재현한다 (§14.1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

/** i1·i2는 대상, p1·p2는 이동 목적지 부모 */
function baseDoc(): DocState {
  return applyOps(emptyDoc('d'), [
    { type: 'insert_item', id: 'p1', parentId: null, sortKey: 'a0', kind: 'task', title: '부모1' },
    { type: 'insert_item', id: 'p2', parentId: null, sortKey: 'a1', kind: 'task', title: '부모2' },
    { type: 'insert_item', id: 'i1', parentId: null, sortKey: 'b0', kind: 'task', title: '제목' },
    { type: 'insert_item', id: 'i2', parentId: null, sortKey: 'b1', kind: 'task', title: '옆단계' },
    { type: 'add_tool', id: 'i1', toolId: 't1' },
    { type: 'add_edge', id: 'e1', sourceId: 'i1', targetId: 'i2' },
    { type: 'add_edge', id: 'e2', sourceId: 'p1', targetId: 'p2' },
  ]);
}

/** i1이 tombstone인 상태 */
function deletedDoc(): DocState {
  return applyOp(baseDoc(), { type: 'delete_item', id: 'i1' });
}

/** i1·i2가 아예 없는 상태 — insert가 실제로 무언가를 만드는 유일한 상태 */
function sparseDoc(): DocState {
  return applyOps(emptyDoc('d'), [
    { type: 'insert_item', id: 'p1', parentId: null, sortKey: 'a0', kind: 'task', title: '부모1' },
    { type: 'insert_item', id: 'p2', parentId: null, sortKey: 'a1', kind: 'task', title: '부모2' },
  ]);
}

const BASE_STATES: Array<{ name: string; state: DocState }> = [
  { name: '통상', state: baseDoc() },
  { name: 'tombstone', state: deletedDoc() },
  { name: '대상 없음', state: sparseDoc() },
];

/** 두 순서가 같은 결과를 내는가 — 그림 기준(§3.1)과 DocState 기준을 따로 본다 */
function orderIndependent(x: Op, y: Op): { graph: boolean; full: boolean } {
  let graph = true;
  let full = true;
  for (const { state } of BASE_STATES) {
    const a = applyOps(state, [x, y]);
    const b = applyOps(state, [y, x]);
    if (graphHash(a) !== graphHash(b)) graph = false;
    if (fullState(a) !== fullState(b)) full = false;
  }
  return { graph, full };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 교환 가능성 표 — SYNC §3.2 전수 검증
 * ──────────────────────────────────────────────────────────────────────────── */

type Mark = '●' | '◐' | '○' | '—';

const ROWS = [
  'insert_item',
  'delete_item',
  'restore_item',
  'move_item',
  'reorder_item',
  'set_title',
  'set_kind',
  'set_attr',
  'scalar_same',
  'add_tool',
  'remove_tool',
  'add_edge',
  'remove_edge',
  'paste_batch',
  'confirm_item',
  'record_conflict',
  'set_doc_title',
] as const;

const COLS = [
  'ins',
  'del',
  'rest',
  'move',
  'reord',
  'title',
  'kind',
  'attr',
  'scalar_same',
  'scalar_other',
  'add_tool',
  'remove_tool',
  'add_edge',
  'remove_edge',
  'paste',
  'conflict',
] as const;

type Row = (typeof ROWS)[number];
type Col = (typeof COLS)[number];

/** SYNC.md §3.2 표를 **글자 그대로** 옮긴 것. 고치지 말 것 — 이 배열이 명세다 */
const TABLE: Record<Row, readonly Mark[]> = {
  //             ins  del  rest move reord title kind attr scal= scal≠ +tl  -tl  +ed  -ed  pst  cfl
  insert_item: ['◐', '●', '●', '◐', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  delete_item: ['●', '●', '○', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  restore_item: ['●', '○', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  move_item: ['◐', '●', '●', '○', '○', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  reorder_item: ['●', '●', '●', '○', '○', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  set_title: ['●', '●', '●', '●', '●', '○', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  set_kind: ['●', '●', '●', '●', '●', '●', '○', '◐', '●', '●', '●', '●', '●', '●', '●', '●'],
  set_attr: ['●', '●', '●', '●', '●', '●', '◐', '◐', '—', '—', '●', '●', '●', '●', '●', '●'],
  scalar_same: ['●', '●', '●', '●', '●', '●', '●', '—', '○', '●', '●', '●', '●', '●', '●', '●'],
  add_tool: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '○', '●', '●', '●', '●'],
  remove_tool: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '○', '●', '●', '●', '●', '●'],
  add_edge: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '◐', '○', '●', '●'],
  remove_edge: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '○', '●', '●', '●'],
  paste_batch: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  confirm_item: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  record_conflict: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
  set_doc_title: ['●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●', '●'],
};

type Side = 'x' | 'y';

/**
 * 축 라벨 → 대표 op.
 * `same=true`면 두 op이 같은 아이템/엣지/도구를 만진다 (표의 전제: "같은 아이템을 건드릴 때").
 * 값은 좌우가 다르게 준다 — 같으면 무엇이든 교환 가능해져 검사가 무의미해진다.
 */
function opFor(label: Row | Col, side: Side, same: boolean): Op {
  const item = same || side === 'x' ? 'i1' : 'i2';
  const edge = same || side === 'x' ? 'e1' : 'e2';
  const tool = same || side === 'x' ? 't1' : 't2';
  const x = side === 'x';

  switch (label) {
    case 'insert_item':
    case 'ins':
      return {
        type: 'insert_item',
        id: item,
        parentId: null,
        sortKey: x ? 'c0' : 'c1',
        kind: 'task',
        title: x ? '새X' : '새Y',
      };
    case 'delete_item':
    case 'del':
      return { type: 'delete_item', id: item };
    case 'restore_item':
    case 'rest':
      return { type: 'restore_item', id: item };
    case 'move_item':
    case 'move':
      return { type: 'move_item', id: item, parentId: x ? 'p1' : 'p2', sortKey: x ? 'd0' : 'd1' };
    case 'reorder_item':
    case 'reord':
      // 'A*'는 base 상태의 'a0'보다 앞이다 — 순서 변화가 그림에 실제로 보이게
      return { type: 'reorder_item', id: item, sortKey: x ? 'A0' : 'A1' };
    case 'set_title':
    case 'title':
      return { type: 'set_title', id: item, from: '제목', to: x ? '제목X' : '제목Y' };
    case 'set_kind':
    case 'kind':
      return { type: 'set_kind', id: item, from: 'task', to: x ? 'branch' : 'hold' };
    case 'set_attr':
    case 'attr':
      // 같은 키(mode)를 서로 다른 값으로 — ◐¹⁰의 "겹치는 경우"
      return { type: 'set_attr', id: item, from: {}, to: x ? { mode: 'and' } : { mode: 'xor' } };
    case 'scalar_same':
      return { type: 'set_assignee', id: item, from: null, to: x ? 'u1' : 'u2' };
    case 'scalar_other':
      return { type: 'set_duration', id: item, from: null, to: x ? '1h' : '1d+' };
    case 'add_tool':
      return { type: 'add_tool', id: item, toolId: same ? 't9' : tool };
    case 'remove_tool':
      return { type: 'remove_tool', id: item, toolId: same ? 't9' : tool };
    case 'add_edge':
      return {
        type: 'add_edge',
        id: edge,
        sourceId: same || x ? 'i1' : 'p1',
        targetId: same || x ? 'i2' : 'p2',
      };
    case 'remove_edge':
      return { type: 'remove_edge', id: edge };
    case 'paste_batch':
    case 'paste':
      return {
        type: 'paste_batch',
        parentId: null,
        items: [
          {
            id: x ? 'px1' : 'py1',
            parentId: null,
            sortKey: x ? 'q0' : 'q1',
            kind: 'task',
            title: x ? '붙X' : '붙Y',
          },
        ],
        edges: [],
        label: '붙여넣기 1줄',
      };
    case 'confirm_item':
      return { type: 'confirm_item', id: item, at: x ? 1000 : 2000 };
    case 'record_conflict':
    case 'conflict':
      return {
        type: 'record_conflict',
        itemId: item,
        field: 'title',
        base: JSON.stringify('제목'),
        variants: [
          { value: JSON.stringify(x ? 'A' : 'C'), actorId: x ? 'u1' : 'u3', lamport: x ? 1 : 3 },
          { value: JSON.stringify(x ? 'B' : 'D'), actorId: x ? 'u2' : 'u4', lamport: x ? 2 : 4 },
        ],
      };
    case 'set_doc_title':
      return { type: 'set_doc_title', from: '', to: x ? '문서X' : '문서Y' };
  }
}

/**
 * 구현이 표와 **일부러** 다른 칸.
 *
 *   kind: 'wrong'        표가 틀렸다. 아래 테스트가 반례를 실제로 만들어 증명한다
 *   kind: 'wrong-full'   표가 틀렸다. 다만 반례가 contentHash에는 안 보이고 DocState에만 보인다
 *   kind: 'conservative' 실제로는 교환 가능하지만 false를 돌려준다 (§3.4 "애매하면 false")
 *   kind: 'mark'         값은 맞고 기호만 틀렸다 (◐로 적혔지만 항상 ●)
 */
type Deviation = {
  kind: 'wrong' | 'wrong-full' | 'conservative' | 'mark';
  expected: boolean;
  why: string;
};

const DEVIATIONS: Partial<Record<`${Row}×${Col}`, Deviation>> = {
  /* ── 생성자 규칙: insert/paste가 만드는 아이템을 상대가 만지면 순서가 결과를 바꾼다 ── */
  'insert_item×del': { kind: 'wrong', expected: false, why: 'insert 후 delete는 tombstone, 반대는 살아 있는 새 항목' },
  'insert_item×move': { kind: 'wrong', expected: false, why: '없는 항목에 대한 move는 무시된다' },
  'insert_item×reord': { kind: 'wrong', expected: false, why: '없는 항목에 대한 reorder는 무시된다' },
  'insert_item×title': { kind: 'wrong', expected: false, why: '없는 항목에 대한 set_title은 무시된다' },
  'insert_item×kind': { kind: 'wrong', expected: false, why: '없는 항목에 대한 set_kind는 무시된다' },
  'insert_item×attr': { kind: 'wrong-full', expected: false, why: '없는 항목에 대한 set_attr은 무시된다 (attrs는 contentHash에 안 들어간다)' },
  'insert_item×scalar_same': { kind: 'wrong', expected: false, why: '없는 항목에 대한 스칼라 op은 무시된다' },
  'insert_item×scalar_other': { kind: 'wrong', expected: false, why: '없는 항목에 대한 스칼라 op은 무시된다' },
  'insert_item×add_tool': { kind: 'wrong', expected: false, why: '없는 항목에 대한 add_tool은 무시된다' },
  'insert_item×remove_tool': { kind: 'conservative', expected: false, why: '생성자 규칙의 일괄 적용' },
  'insert_item×rest': { kind: 'conservative', expected: false, why: '생성자 규칙의 일괄 적용 — 실제로는 교환 가능' },
  'insert_item×conflict': { kind: 'wrong-full', expected: false, why: 'record_conflict의 liveValue가 항목 존재 여부에 달렸다' },

  'delete_item×ins': { kind: 'wrong', expected: false, why: 'insert_item×del의 대칭' },
  'restore_item×ins': { kind: 'conservative', expected: false, why: 'insert_item×rest의 대칭' },
  'move_item×ins': { kind: 'wrong', expected: false, why: 'insert_item×move의 대칭' },
  'reorder_item×ins': { kind: 'wrong', expected: false, why: 'insert_item×reord의 대칭' },
  'set_title×ins': { kind: 'wrong', expected: false, why: 'insert_item×title의 대칭' },
  'set_kind×ins': { kind: 'wrong', expected: false, why: 'insert_item×kind의 대칭' },
  'set_attr×ins': { kind: 'wrong-full', expected: false, why: 'insert_item×attr의 대칭' },
  'scalar_same×ins': { kind: 'wrong', expected: false, why: 'insert_item×scalar의 대칭' },
  'add_tool×ins': { kind: 'wrong', expected: false, why: 'insert_item×+tool의 대칭' },
  'remove_tool×ins': { kind: 'conservative', expected: false, why: '생성자 규칙의 일괄 적용' },
  'confirm_item×ins': { kind: 'wrong-full', expected: false, why: 'lastConfirmedAt이 항목 존재 여부에 달렸다 (contentHash에는 안 보인다)' },
  'record_conflict×ins': { kind: 'wrong-full', expected: false, why: 'liveValue가 항목 존재 여부에 달렸다' },

  /* ── 기호만 틀린 칸 ── */
  'set_kind×attr': { kind: 'mark', expected: true, why: '각주 9가 "교환 가능하다"라고 직접 말한다. ◐가 아니라 ●' },
  'set_attr×kind': { kind: 'mark', expected: true, why: '각주 9가 "교환 가능하다"라고 직접 말한다. ◐가 아니라 ●' },
};

describe('§3.2 교환 가능성 표 — 17×16 전수 검증', () => {
  const conditional = new Set<string>([
    'insert_item×ins', // ◐¹ 같은 ID면 뒤에 온 insert가 무시된다
    'move_item×ins', // ◐²
    'insert_item×move', // ◐²
    'set_kind×attr', // ◐⁹
    'set_attr×kind', // ◐⁹
    'set_attr×attr', // ◐¹⁰
    'add_edge×add_edge', // ◐¹³
  ]);

  for (const row of ROWS) {
    for (let c = 0; c < COLS.length; c++) {
      const col = COLS[c]!;
      const mark = TABLE[row][c]!;
      if (mark === '—') continue;
      const key = `${row}×${col}` as `${Row}×${Col}`;

      it(`${key} = ${mark}`, () => {
        const x = opFor(row, 'x', true);
        const y = opFor(col, 'y', true);
        const actual = commutes(x, y);
        const dev = DEVIATIONS[key];

        if (dev) {
          strictEqual(actual, dev.expected, `${key}: ${dev.why}`);
          const obs = orderIndependent(x, y);
          if (dev.kind === 'wrong') {
            ok(!obs.graph, `${key}: 표는 ●라고 하지만 반례가 있어야 한다 — ${dev.why}`);
          }
          if (dev.kind === 'wrong-full') {
            ok(obs.graph, `${key}: 그림(contentHash)은 같아야 한다`);
            ok(!obs.full, `${key}: DocState에는 차이가 있어야 한다 — ${dev.why}`);
          }
          if (dev.kind === 'conservative' || dev.kind === 'mark') {
            ok(obs.graph, `${key}: 실제로는 교환 가능해야 한다`);
          }
          return;
        }

        if (mark === '●') {
          strictEqual(actual, true, `${key}: 표가 ●인데 commutes()가 false다`);
          // P2 — true라고 말했으면 실제로 교환 가능해야 한다. 이 방향이 데이터 손실을 막는다
          ok(orderIndependent(x, y).graph, `${key}: commutes()가 true인데 순서에 따라 그림이 갈린다`);
        } else if (mark === '○') {
          strictEqual(actual, false, `${key}: 표가 ○인데 commutes()가 true다`);
        } else {
          ok(conditional.has(key), `${key}: ◐인데 조건이 문서화되지 않았다`);
        }
      });
    }
  }

  it('◐¹ insert × insert — 같은 ID만 교환 불가, 다른 ID는 교환 가능', () => {
    strictEqual(commutes(opFor('insert_item', 'x', true), opFor('ins', 'y', true)), false);
    strictEqual(commutes(opFor('insert_item', 'x', false), opFor('ins', 'y', false)), true);
  });

  it('◐² insert(child) × move(parent) — 서로 다른 아이템이면 교환 가능', () => {
    const ins: Op = { type: 'insert_item', id: 'n1', parentId: 'p1', sortKey: 'z0', kind: 'task', title: '자식' };
    const mv: Op = { type: 'move_item', id: 'p1', parentId: 'p2', sortKey: 'z1' };
    strictEqual(commutes(ins, mv), true);
    ok(orderIndependent(ins, mv).full, '두 순서 모두 "자식은 P 아래, P는 새 위치"로 끝난다');
  });

  it('◐¹⁰ set_attr × set_attr — 키가 겹치면 ○, 안 겹치면 ●', () => {
    const a: Op = { type: 'set_attr', id: 'i1', from: {}, to: { mode: 'and' } };
    const b: Op = { type: 'set_attr', id: 'i1', from: {}, to: { mode: 'xor' } };
    const c: Op = { type: 'set_attr', id: 'i1', from: {}, to: { caseLabel: '반려' } };
    strictEqual(commutes(a, b), false);
    strictEqual(commutes(a, c), true);
    ok(orderIndependent(a, c).full);
  });

  it('◐¹³ add_edge × add_edge — 같은 (source,target)이면 남는 행 ID가 순서에 따라 달라진다', () => {
    // baseDoc에 아직 없는 연결이어야 한다 (이미 있으면 둘 다 중복으로 무시된다)
    const a: Op = { type: 'add_edge', id: 'ea', sourceId: 'i1', targetId: 'p1' };
    const b: Op = { type: 'add_edge', id: 'eb', sourceId: 'i1', targetId: 'p1' };
    strictEqual(commutes(a, b), false);
    // ★ 각주 13은 "contentHash 기준으로는 ●"라고 하지만 derive()는 엣지 ID를 해시에 넣는다
    ok(!orderIndependent(a, b).graph, '각주 13의 근거(“contentHash 기준 ●”)가 실제와 다르다');
    // 다른 (source,target)이면 교환 가능
    strictEqual(commutes(a, { type: 'add_edge', id: 'eb', sourceId: 'p1', targetId: 'p2' }), true);
  });

  it('○¹² add_tool × remove_tool — 같은 도구만 교환 불가', () => {
    strictEqual(commutes({ type: 'add_tool', id: 'i1', toolId: 't1' }, { type: 'remove_tool', id: 'i1', toolId: 't1' }), false);
    strictEqual(commutes({ type: 'add_tool', id: 'i1', toolId: 't1' }, { type: 'remove_tool', id: 'i1', toolId: 't2' }), true);
  });

  it('다른 아이템을 만지는 op은 두 쌍을 빼고 전부 교환 가능하다', () => {
    // 표는 "다른 아이템에 대한 op은 아래 3쌍을 빼고 전부 ●"라고 하지만 실제 예외는 둘이다:
    //   move × move        — 서로를 상대의 하위로 넣으면 사이클 가드가 순서에 따라 다르게 문다
    //   엣지 생성 × 엣지 삭제 — 삭제가 (source,target) 중복 판정 슬롯을 비워 준다 (아래 별도 테스트)
    const isEdgeCreate = (t: Op['type']): boolean => t === 'add_edge' || t === 'suppress_edge';
    const isEdgeDelete = (t: Op['type']): boolean => t === 'remove_edge' || t === 'unsuppress_edge';
    for (const row of ROWS) {
      for (const col of COLS) {
        const x = opFor(row, 'x', false);
        const y = opFor(col, 'y', false);
        const movePair = x.type === 'move_item' && y.type === 'move_item';
        const edgePair =
          (isEdgeCreate(x.type) && isEdgeDelete(y.type)) || (isEdgeCreate(y.type) && isEdgeDelete(x.type));
        strictEqual(commutes(x, y), !(movePair || edgePair), `${row}×${col} (다른 아이템)`);
      }
    }
  });

  it('표에 없는 칸 — 다른 엣지의 add × remove도 교환 불가다', () => {
    // e1은 이미 i1→i2다. 새 엣지 e9도 i1→i2를 그으면 순서가 결과를 바꾼다
    const add: Op = { type: 'add_edge', id: 'e9', sourceId: 'i1', targetId: 'i2' };
    const remove: Op = { type: 'remove_edge', id: 'e1' };
    strictEqual(commutes(add, remove), false);
    ok(!orderIndependent(add, remove).graph, 'ID가 달라도 실제로 갈린다');
  });

  it('표에 없는 칸 — set_doc_title × set_doc_title은 LWW라 교환 불가', () => {
    const a: Op = { type: 'set_doc_title', from: '', to: '견적 프로세스' };
    const b: Op = { type: 'set_doc_title', from: '', to: '계약 프로세스' };
    strictEqual(commutes(a, b), false);
    ok(!orderIndependent(a, b).full);
    // ★ §3.1의 ≡(contentHash)는 문서 제목을 보지 못한다 — 정의 자체의 사각지대
    ok(orderIndependent(a, b).graph, 'contentHash에는 문서 제목이 들어가지 않는다');
  });

  it('표에 없는 칸 — resolve_conflict는 슬롯에 값을 쓴다', () => {
    const resolve: Op = {
      type: 'resolve_conflict',
      itemId: 'i1',
      field: 'title',
      chosen: JSON.stringify('고른 제목'),
      chosenBy: 'u1',
    };
    strictEqual(commutes(resolve, { type: 'set_title', id: 'i1', from: '제목', to: '다른 제목' }), false);
    strictEqual(commutes(resolve, { type: 'set_assignee', id: 'i1', from: null, to: 'u2' }), true);
  });

  it('batchCommutes는 하나라도 걸리면 false다 (§9.4 무침묵 병합의 게이트)', () => {
    const mine: Op[] = [
      { type: 'set_title', id: 'i1', from: '제목', to: '제목A' },
      { type: 'set_assignee', id: 'i2', from: null, to: 'u1' },
    ];
    strictEqual(batchCommutes(mine, [{ type: 'set_duration', id: 'i1', from: null, to: '1h' }]), true);
    strictEqual(batchCommutes(mine, [{ type: 'set_title', id: 'i1', from: '제목', to: '제목B' }]), false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 속성 기반 — 임의 op 시퀀스
 * ──────────────────────────────────────────────────────────────────────────── */

const ITEMS = ['i1', 'i2', 'p1', 'p2', 'n1', 'n2'];
const TOOLS = ['t1', 't2', 't3'];
const EDGES = ['e1', 'e2', 'e3'];
/** 어느 base 상태에도 없는 ID — D-031(클라이언트 발급 UUID)의 시뮬레이션 */
const FRESH = ['f0', 'f1', 'f2'];

/**
 * @param freshInserts insert_item이 **반드시 새 ID**를 쓰게 한다.
 *   실무에서는 항상 참이고(UUID), coalesce의 두 규칙이 이걸 전제한다.
 */
function randomOp(rng: () => number, freshInserts = false): Op {
  const id = pick(rng, freshInserts ? [...ITEMS, ...FRESH] : ITEMS);
  const kinds = ['task', 'branch', 'hold'] as const;
  const roll = Math.floor(rng() * 18);
  switch (roll) {
    case 0:
      return { type: 'insert_item', id: freshInserts ? pick(rng, FRESH) : id, parentId: rng() < 0.5 ? null : pick(rng, ITEMS), sortKey: `k${Math.floor(rng() * 9)}`, kind: pick(rng, kinds), title: `새 ${Math.floor(rng() * 9)}` };
    case 1:
      return { type: 'delete_item', id };
    case 2:
      return { type: 'restore_item', id };
    case 3:
      return { type: 'move_item', id, parentId: rng() < 0.4 ? null : pick(rng, ITEMS), sortKey: `k${Math.floor(rng() * 9)}` };
    case 4:
      return { type: 'reorder_item', id, sortKey: `k${Math.floor(rng() * 9)}` };
    case 5:
      return { type: 'set_title', id, from: '제목', to: `제목 ${Math.floor(rng() * 9)}` };
    case 6:
      return { type: 'set_kind', id, from: 'task', to: pick(rng, kinds) };
    case 7:
      return rng() < 0.5
        ? { type: 'set_attr', id, from: {}, to: { mode: pick(rng, ['xor', 'and', 'skip'] as const) } }
        : { type: 'set_attr', id, from: {}, to: { caseLabel: `조건 ${Math.floor(rng() * 5)}` } };
    case 8:
      return { type: 'set_assignee', id, from: null, to: rng() < 0.3 ? null : `u${Math.floor(rng() * 4)}` };
    case 9:
      return { type: 'set_duration', id, from: null, to: pick(rng, ['1m', '15m', '1h', '1d+'] as const) };
    case 10:
      return { type: 'set_pain', id, from: false, to: rng() < 0.5 };
    case 11:
      return { type: 'add_tool', id, toolId: pick(rng, TOOLS) };
    case 12:
      return { type: 'remove_tool', id, toolId: pick(rng, TOOLS) };
    case 13:
      return { type: 'add_edge', id: pick(rng, EDGES), sourceId: pick(rng, ITEMS), targetId: pick(rng, ITEMS) };
    case 14:
      return { type: 'remove_edge', id: pick(rng, EDGES) };
    case 15:
      return { type: 'confirm_item', id, at: Math.floor(rng() * 5) * 1000 };
    case 16:
      return { type: 'set_freq', id, from: null, to: Math.floor(rng() * 20) };
    default:
      return { type: 'set_doc_title', from: '', to: `문서 ${Math.floor(rng() * 5)}` };
  }
}

describe('P2 — commutes()가 true라고 말한 쌍은 실제로 교환 가능하다', () => {
  it('임의 op 쌍 4000개 × 상태 3종', () => {
    let checked = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const rng = mulberry32(seed * 7919);
      for (let n = 0; n < 1000; n++) {
        const x = randomOp(rng);
        const y = randomOp(rng);
        if (!commutes(x, y)) continue;
        checked++;
        const obs = orderIndependent(x, y);
        ok(obs.graph, `seed=${seed} n=${n} 반례: ${JSON.stringify(x)} / ${JSON.stringify(y)}`);
      }
    }
    ok(checked > 500, `교환 가능 판정이 너무 적다 (${checked}건) — 표본이 편향됐다`);
  });
});

describe('P1 — 교환 가능한 쌍만 남기면 순서를 바꿔도 같은 상태로 수렴한다', () => {
  it('인접 교환(adjacent swap) 100회', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed * 104729);
      const ops = Array.from({ length: 14 }, () => randomOp(rng));
      const start = baseDoc();
      const before = graphHash(applyOps(start, ops));

      // 교환 가능한 인접 쌍만 골라 뒤집는다 — 여러 번 뒤집어도 결과가 같아야 한다
      const shuffled = [...ops];
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i + 1 < shuffled.length; i++) {
          if (rng() < 0.5) continue;
          const a = shuffled[i]!;
          const b = shuffled[i + 1]!;
          if (!commutes(a, b)) continue;
          shuffled[i] = b;
          shuffled[i + 1] = a;
        }
      }
      strictEqual(graphHash(applyOps(start, shuffled)), before, `seed=${seed}`);
    }
  });

  it('batchCommutes가 true면 두 액터의 배치 순서를 바꿔도 수렴한다', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 15485863);
      const mine = Array.from({ length: 5 }, () => randomOp(rng));
      const theirs = Array.from({ length: 5 }, () => randomOp(rng));
      if (!batchCommutes(mine, theirs)) continue;
      checked++;
      const start = baseDoc();
      strictEqual(
        graphHash(applyOps(applyOps(start, mine), theirs)),
        graphHash(applyOps(applyOps(start, theirs), mine)),
        `seed=${seed}`,
      );
    }
    ok(checked > 0, '교환 가능한 배치 조합이 하나도 안 나왔다');
  });
});

describe('P8 — applyOp은 절대 throw하지 않는다', () => {
  it('임의 op × 임의 상태 3000회', () => {
    const states = [emptyDoc('d'), baseDoc(), deletedDoc(), sparseDoc()];
    const rng = mulberry32(20260817);
    for (let n = 0; n < 3000; n++) {
      const s = pick(rng, states);
      applyOp(s, randomOp(rng));
    }
    // 손상된 payload도 마찬가지다 — resolve_conflict의 JSON.parse가 유일한 위험 지점이었다
    const s = applyOp(baseDoc(), {
      type: 'record_conflict',
      itemId: 'i1',
      field: 'title',
      base: '"제목"',
      variants: [
        { value: '"A"', actorId: 'u1', lamport: 1 },
        { value: '"B"', actorId: 'u2', lamport: 2 },
      ],
    });
    const broken: Op = { type: 'resolve_conflict', itemId: 'i1', field: 'title', chosen: '{{{', chosenBy: 'u1' };
    strictEqual(applyOp(s, broken), s, '파싱 실패는 무시로 처리한다 (throw 금지가 상위 계약)');
  });

  it('바뀌는 것이 없으면 같은 참조를 돌려준다 (리렌더 게이트)', () => {
    const s = baseDoc();
    strictEqual(applyOp(s, { type: 'set_title', id: 'i1', from: '제목', to: '제목' }), s);
    strictEqual(applyOp(s, { type: 'set_title', id: '없는아이템', from: 'a', to: 'b' }), s);
    strictEqual(applyOp(s, { type: 'delete_item', id: '없는아이템' }), s);
    strictEqual(applyOp(s, { type: 'add_tool', id: 'i1', toolId: 't1' }), s);
  });

  it('모든 op 타입이 리듀서에 도달한다 (25종)', () => {
    strictEqual(OP_TYPES.length, 25);
    strictEqual(new Set(OP_TYPES).size, 25);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. invertOp — P4 왕복
 * ──────────────────────────────────────────────────────────────────────────── */

describe('P4 — 역연산 왕복', () => {
  it('임의 op × 임의 상태에서 원상 복구된다', () => {
    const states = [baseDoc(), deletedDoc(), sparseDoc()];
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 32452843);
      for (let n = 0; n < 60; n++) {
        const s = pick(rng, states);
        const op = randomOp(rng);
        const inv = invertOp(s, op);
        if (inv === null) continue;
        const round = applyOps(applyOp(s, op), inv);
        strictEqual(
          graphHash(round),
          graphHash(s),
          `seed=${seed} n=${n} op=${JSON.stringify(op)}`,
        );
      }
    }
  });

  it('구조 op은 DocState까지 정확히 되돌린다', () => {
    const s = baseDoc();
    const cases: Op[] = [
      { type: 'move_item', id: 'i1', parentId: 'p1', sortKey: 'zz' },
      { type: 'reorder_item', id: 'i1', sortKey: 'zz' },
      { type: 'set_title', id: 'i1', from: '제목', to: '바뀐 제목' },
      { type: 'set_kind', id: 'i1', from: 'task', to: 'branch' },
      { type: 'set_assignee', id: 'i1', from: null, to: 'u1' },
      { type: 'set_attr', id: 'i1', from: {}, to: { mode: 'and', caseLabel: '반려' } },
      { type: 'add_tool', id: 'i1', toolId: 't7' },
      { type: 'remove_tool', id: 'i1', toolId: 't1' },
      { type: 'set_edge_label', id: 'e1', from: null, to: '예외 경로' },
      { type: 'set_doc_title', from: '', to: '견적 프로세스' },
      { type: 'add_edge', id: 'e9', sourceId: 'p1', targetId: 'i1' },
      { type: 'remove_edge', id: 'e1' },
    ];
    for (const op of cases) {
      const inv = invertOp(s, op)!;
      ok(inv, `${op.type}: 역연산이 있어야 한다`);
      strictEqual(fullState(applyOps(applyOp(s, op), inv)), fullState(s), op.type);
    }
  });

  it('set_attr 역연산은 **새로 생긴 키를 지운다** (명세의 {from:to, to:from}으로는 안 된다)', () => {
    const s = baseDoc();
    const op: Op = { type: 'set_attr', id: 'i1', from: {}, to: { mode: 'and' } };
    const naive = applyOps(applyOp(s, op), [{ type: 'set_attr', id: 'i1', from: op.to, to: op.from }]);
    ok('mode' in (naive.items.get('i1')!.attrs as Record<string, unknown>), '명세대로면 mode가 남는다');
    const correct = applyOps(applyOp(s, op), invertOp(s, op)!);
    ok(!('mode' in (correct.items.get('i1')!.attrs as Record<string, unknown>)));
  });

  it('되돌릴 수 없는 op은 null (undo 스택에 담기지 않는다)', () => {
    const s = baseDoc();
    strictEqual(invertOp(s, { type: 'confirm_item', id: 'i1', at: 1 }), null);
    strictEqual(
      invertOp(s, { type: 'record_conflict', itemId: 'i1', field: 'title', base: '""', variants: [] }),
      null,
    );
    strictEqual(
      invertOp(s, { type: 'resolve_conflict', itemId: 'i1', field: 'title', chosen: '""', chosenBy: 'u' }),
      null,
    );
  });

  it('no-op의 역연산은 빈 배열이다 (살아 있는 항목에 restore를 걸어도 지워지지 않는다)', () => {
    const s = baseDoc();
    deepStrictEqual(invertOp(s, { type: 'restore_item', id: 'i1' }), []);
    deepStrictEqual(invertOp(s, { type: 'add_tool', id: 'i1', toolId: 't1' }), []);
    deepStrictEqual(invertOp(s, { type: 'insert_item', id: 'i1', parentId: null, sortKey: 'z', kind: 'task', title: 'x' }), []);
  });

  it('삭제 역연산은 tombstone 덕분에 한 줄이다 — 내용이 그대로 돌아온다', () => {
    const s = applyOps(baseDoc(), [{ type: 'set_title', id: 'i1', from: '제목', to: '견적서 작성' }]);
    const del: Op = { type: 'delete_item', id: 'i1' };
    const after = applyOp(s, del);
    strictEqual(after.items.get('i1')!.title, '견적서 작성', '삭제해도 바이트는 남는다 (I1·I4)');
    deepStrictEqual(invertOp(s, del), [{ type: 'restore_item', id: 'i1' }]);
    strictEqual(fullState(applyOps(after, invertOp(s, del)!)), fullState(s));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. coalesce — P3
 * ──────────────────────────────────────────────────────────────────────────── */

describe('§4.2 압축', () => {
  it('set_title 100개 → 1개, 최종 상태 동일', () => {
    const envs: OpEnvelope[] = [];
    let prev = '제목';
    for (let i = 0; i < 100; i++) {
      const to = `견적서 작성${'.'.repeat(i)}`;
      envs.push(env({ type: 'set_title', id: 'i1', from: prev, to }, i));
      prev = to;
    }
    const packed = coalesce(envs);
    strictEqual(packed.length, 1);

    const s = baseDoc();
    strictEqual(
      graphHash(applyOps(s, packed.map((e) => e.op))),
      graphHash(applyOps(s, envs.map((e) => e.op))),
    );
    // ★ from이 가장 이른 값이어야 한다 — 여기가 깨지면 동료의 동시 편집이 조용히 덮인다
    const only = packed[0]!.op as { from: string; to: string };
    strictEqual(only.from, '제목');
    strictEqual(only.to, prev);
  });

  it('압축은 3-way merge의 base를 보존한다 (§14.4)', () => {
    const id = 'i1';
    const envs = [
      env({ type: 'set_title', id, from: '견적서', to: '견적서 작성' }, 0),
      env({ type: 'set_title', id, from: '견적서 작성', to: '견적서 작성해서 발송' }, 1),
      env({ type: 'set_title', id, from: '견적서 작성해서 발송', to: '견적서 작성해서 발송하기' }, 2),
    ];
    const packed = coalesce(envs);
    strictEqual(packed.length, 1);
    const op = packed[0]!.op as { from: string; to: string };
    strictEqual(op.from, '견적서');
    strictEqual(op.to, '견적서 작성해서 발송하기');
  });

  it('구조 op은 장벽이다 (§14.4)', () => {
    const envs = [
      env({ type: 'set_title', id: 'i1', from: 'a', to: 'b' }, 0),
      env({ type: 'delete_item', id: 'i1' }, 1),
      env({ type: 'restore_item', id: 'i1' }, 2),
      env({ type: 'set_title', id: 'i1', from: 'b', to: 'c' }, 3),
    ];
    strictEqual(coalesce(envs).length, 4); // 하나도 합쳐지지 않는다
  });

  it('insert 직후의 set_title은 insert에 흡수된다', () => {
    const envs = [
      env({ type: 'insert_item', id: 'n9', parentId: null, sortKey: 'z0', kind: 'task', title: '' }, 0),
      env({ type: 'set_title', id: 'n9', from: '', to: '견적서 작성' }, 1),
    ];
    const packed = coalesce(envs);
    strictEqual(packed.length, 1);
    strictEqual(packed[0]!.op.type, 'insert_item');
    strictEqual((packed[0]!.op as { title: string }).title, '견적서 작성');
  });

  it('만들고 바로 지운 아이템은 아예 보내지 않는다 — 단 ack된 아이템은 예외 없이 보낸다', () => {
    const ops: Op[] = [
      { type: 'insert_item', id: 'n9', parentId: null, sortKey: 'z0', kind: 'task', title: '' },
      { type: 'set_title', id: 'n9', from: '', to: '오타' },
      { type: 'delete_item', id: 'n9' },
    ];
    strictEqual(coalesceOps(ops).length, 0);

    // 서버가 이미 아는 아이템이면 지우면 안 된다 — 다른 사람 화면에 유령이 남는다
    const kept = coalesceOps(ops, { known: new Set(['n9']) });
    ok(kept.length > 0);
    // 상쇄를 끈 경우도 마찬가지
    ok(coalesceOps(ops, { cancelCreateDelete: false }).length > 0);
  });

  it('엣지가 참조하는 아이템은 상쇄하지 않는다', () => {
    const ops: Op[] = [
      { type: 'insert_item', id: 'n9', parentId: null, sortKey: 'z0', kind: 'task', title: 'x' },
      { type: 'add_edge', id: 'e9', sourceId: 'n9', targetId: 'i1' },
      { type: 'delete_item', id: 'n9' },
    ];
    strictEqual(coalesceOps(ops).length, 3);
  });

  it('set_attr은 겹치는 키만 압축한다 — 다른 키의 편집이 사라지지 않는다', () => {
    const envs = [
      env({ type: 'set_attr', id: 'i1', from: {}, to: { mode: 'and', caseLabel: '반려' } }, 0),
      env({ type: 'set_attr', id: 'i1', from: { mode: 'and' }, to: { mode: 'xor' } }, 1),
    ];
    const packed = coalesce(envs);
    strictEqual(packed.length, 2, 'caseLabel을 잃지 않으려면 앞의 op이 남아야 한다');
    const s = baseDoc();
    strictEqual(
      graphHash(applyOps(s, packed.map((e) => e.op))),
      graphHash(applyOps(s, envs.map((e) => e.op))),
    );
  });

  it('도구·확인은 압축 대상이 아니다 (원소 연산·max 병합)', () => {
    const envs = [
      env({ type: 'add_tool', id: 'i1', toolId: 't5' }, 0),
      env({ type: 'add_tool', id: 'i1', toolId: 't6' }, 1),
      env({ type: 'confirm_item', id: 'i1', at: 2000 }, 2),
      env({ type: 'confirm_item', id: 'i1', at: 1000 }, 3),
    ];
    strictEqual(coalesce(envs).length, 4);
  });

  it('P3 — 임의 시퀀스에서 관찰 가능한 결과가 바뀌지 않는다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed * 49979687);
      const ops = Array.from({ length: 24 }, () => randomOp(rng, true));
      const s = baseDoc();
      const direct = applyOps(s, ops);
      const packed = applyOps(s, coalesceOps(ops));
      strictEqual(graphHash(packed), graphHash(direct), `seed=${seed}`);
    }
  });

  /**
   * ★ 명세 §4.2가 적지 않은 전제. 시드 12에서 실제로 반증됐다.
   * insert가 **새 아이템을 만들지 않으면**(id가 이미 있으면) 흡수 규칙이 제목을 삼킨다.
   */
  it('흡수·상쇄는 "insert가 실제로 새 항목을 만든다"를 전제한다', () => {
    const s = baseDoc(); // i1이 이미 있다
    const ops: Op[] = [
      { type: 'insert_item', id: 'i1', parentId: null, sortKey: 'z0', kind: 'task', title: '' },
      { type: 'set_title', id: 'i1', from: '제목', to: '고친 제목' },
    ];
    // 전제를 알려주면 흡수하지 않는다
    const guarded = coalesceOps(ops, { known: new Set(['i1']) });
    strictEqual(guarded.length, 2);
    strictEqual(
      graphHash(applyOps(s, guarded)),
      graphHash(applyOps(s, ops)),
      '전제를 넘기면 압축이 안전하다',
    );
    // 전제를 모르면 제목이 삼켜진다 — 그래서 호출자가 반드시 알려줘야 한다
    strictEqual(applyOps(s, coalesceOps(ops)).items.get('i1')!.title, '제목');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. merge3
 * ──────────────────────────────────────────────────────────────────────────── */

describe('§2.5 3-way merge', () => {
  it('겹치지 않는 편집은 조용히 합쳐진다', () => {
    const r = merge3('견적서 작성', '견적서 작성해서 발송', '매월 견적서 작성');
    ok(r.ok);
    strictEqual(r.text, '매월 견적서 작성해서 발송');
    strictEqual(r.silent, false, '합쳐졌지만 결과 문장이 두 사람 의도를 모두 담고 있다');
  });

  it('한쪽이 안 고쳤으면 조용히(silent) 다른 쪽을 쓴다', () => {
    const r = merge3('견적서 작성', '견적서 작성', '매월 견적서 작성');
    ok(r.ok);
    strictEqual(r.text, '매월 견적서 작성');
    strictEqual(r.silent, true);
  });

  it('같은 구간을 다르게 고치면 실패한다 — 여기가 "두 내용 모두 남겨뒀어요"의 입구', () => {
    const r = merge3('견적서 작성', '견적서 검토', '견적서 승인');
    strictEqual(r.ok, false);
  });

  it('P7 — 대칭성: 어느 쪽을 mine으로 두든 같은 문장이 나온다', () => {
    const rng = mulberry32(777);
    const words = ['견적서', '작성', '검토', '발송', '매월', '팀장', '확인', '  ', '요청'];
    const rand = (): string =>
      Array.from({ length: 1 + Math.floor(rng() * 4) }, () => pick(rng, words)).join(' ');
    for (let n = 0; n < 2000; n++) {
      const base = rand();
      const mine = rng() < 0.3 ? base : rand();
      const theirs = rng() < 0.3 ? base : rand();
      const a = merge3(base, mine, theirs);
      const b = merge3(base, theirs, mine);
      strictEqual(a.ok, b.ok, `n=${n} ${JSON.stringify([base, mine, theirs])}`);
      if (a.ok && b.ok) {
        strictEqual(a.text, b.text, `n=${n} ${JSON.stringify([base, mine, theirs])}`);
      }
    }
  });

  it('P7 — 같은 지점 순수 삽입도 대칭이다 (명세 코드의 반례)', () => {
    const a = merge3('견적서', '견적서 발송', '견적서 검토');
    const b = merge3('견적서', '견적서 검토', '견적서 발송');
    strictEqual(a.ok, b.ok);
    if (a.ok && b.ok) strictEqual(a.text, b.text);
  });

  it('서러게이트 페어를 반으로 쪼개지 않는다', () => {
    const r = merge3('보고 🙂', '보고 🙂 완료', '재보고 🙂');
    ok(r.ok);
    ok(!r.text.includes('�'));
    ok([...r.text].every((c) => c.codePointAt(0) !== 0xd83d));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. derive()와의 통합
 * ──────────────────────────────────────────────────────────────────────────── */

describe('op → derive() 통합', () => {
  it('op으로 만든 문서가 유효한 그래프를 만든다', () => {
    const s = applyOps(emptyDoc('d'), [
      { type: 'insert_item', id: 'a', parentId: null, sortKey: 'a0', kind: 'task', title: '견적 요청 받기' },
      { type: 'insert_item', id: 'b', parentId: null, sortKey: 'a1', kind: 'branch', title: '금액 확인' },
      { type: 'insert_item', id: 'c1', parentId: 'b', sortKey: 'b0', kind: 'branch', title: '100만원 미만' },
      { type: 'insert_item', id: 'c1s', parentId: 'c1', sortKey: 'c0', kind: 'task', title: '바로 발송' },
      { type: 'insert_item', id: 'c2', parentId: 'b', sortKey: 'b1', kind: 'branch', title: '100만원 이상' },
      { type: 'insert_item', id: 'c2s', parentId: 'c2', sortKey: 'c0', kind: 'hold', title: '팀장 승인 대기' },
      { type: 'set_attr', id: 'c2s', from: {}, to: { waitFor: 'approval', avgWaitH: 6 } },
      { type: 'set_duration', id: 'a', from: null, to: '15m' },
      { type: 'set_assignee', id: 'a', from: null, to: 'u1' },
    ]);

    const g = derive(itemsOf(s), edgesOf(s));
    ok(g.byId.has('start') && g.byId.has('end'));
    strictEqual(g.metrics.stepCount, 3, '작업 2 + 기다림 1 (갈래는 단계가 아니다)');
    strictEqual(g.metrics.taskCount, 2);
    strictEqual(g.metrics.holdCount, 1);
    strictEqual(g.metrics.branchCount, 1);
    strictEqual(g.metrics.caseCount, 2);
    // 진단에 error 심각도는 존재하지 않는다
    for (const d of g.diagnostics) ok(d.severity === 'repaired' || d.severity === 'note');
    strictEqual(g.acyclic.topoOrder.length, g.nodes.length);
  });

  it('tombstone은 그림에서 사라지지만 바이트는 남는다', () => {
    const s = applyOps(emptyDoc('d'), [
      { type: 'insert_item', id: 'a', parentId: null, sortKey: 'a0', kind: 'task', title: '접수' },
      { type: 'insert_item', id: 'b', parentId: null, sortKey: 'a1', kind: 'task', title: '검토' },
      { type: 'delete_item', id: 'b' },
    ]);
    strictEqual(s.items.size, 2);
    strictEqual(s.items.get('b')!.title, '검토');
    const g = derive(itemsOf(s), edgesOf(s));
    ok(!g.byId.has('b'));
    ok(g.byId.has('a'));
  });

  it('지워진 부모 아래의 insert도 그림이 끊기지 않는다 (§5.4)', () => {
    const s = applyOps(emptyDoc('d'), [
      { type: 'insert_item', id: 'p', parentId: null, sortKey: 'a0', kind: 'task', title: '부모' },
      { type: 'delete_item', id: 'p' },
      { type: 'insert_item', id: 'c', parentId: 'p', sortKey: 'b0', kind: 'task', title: '자식' },
    ]);
    const g = derive(itemsOf(s), edgesOf(s));
    ok(g.byId.has('c'), '자식은 루트로 승격되어 그려진다');
    ok(g.diagnostics.some((d) => d.code === 'orphan-parent'));
  });

  it('paste_batch 한 번이 12단계를 원자적으로 만든다 (STATES §3)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      parentId: null,
      sortKey: `a${i}`,
      kind: 'task' as const,
      title: `단계 ${i}`,
    }));
    const paste: Op = { type: 'paste_batch', parentId: null, items, edges: [], label: '붙여넣기 12줄' };
    const s = applyOp(emptyDoc('d'), paste);
    strictEqual(s.items.size, 12);
    strictEqual(derive(itemsOf(s), edgesOf(s)).metrics.stepCount, 12);

    // 재전송해도 12개 그대로 (멱등)
    strictEqual(applyOp(s, paste), s);
    // undo 1회로 전부 되돌아간다
    const inv = invertOp(emptyDoc('d'), paste)!;
    strictEqual(inv.length, 12);
    strictEqual(derive(itemsOf(applyOps(s, inv)), []).metrics.stepCount, 0);
  });

  it('충돌 기록은 그림을 바꾸지 않는다 — 슬롯에는 서버 승자가 그대로 있다 (§5.3)', () => {
    const s = baseDoc();
    const withConflict = applyOp(s, {
      type: 'record_conflict',
      itemId: 'i1',
      field: 'title',
      base: JSON.stringify('견적서 작성'),
      variants: [
        { value: JSON.stringify('견적서 검토'), actorId: 'u1', lamport: 1 },
        { value: JSON.stringify('견적서 승인'), actorId: 'u2', lamport: 2 },
      ],
    });
    strictEqual(graphHash(withConflict), graphHash(s));
    const c = withConflict.conflicts.get('i1:title')!;
    strictEqual(c.variants.length, 2, '어느 쪽도 버려지지 않았다');
    strictEqual(c.resolvedAt, null, '자동 해소되지 않았다');

    // 해소해도 레코드는 남는다 — "고른 뒤에도 다른 쪽을 되찾을 수 있다"
    const resolved = applyOp(withConflict, {
      type: 'resolve_conflict',
      itemId: 'i1',
      field: 'title',
      chosen: JSON.stringify('견적서 검토'),
      chosenBy: 'u1',
    });
    strictEqual(resolved.items.get('i1')!.title, '견적서 검토');
    strictEqual(resolved.conflicts.get('i1:title')!.variants.length, 2);
    ok(resolved.conflicts.get('i1:title')!.resolvedAt !== null);
  });

  it('record_conflict는 값 기준 dedup + 정렬로 순서 무관하게 수렴한다 (각주 16)', () => {
    const mk = (v: string, actor: string, lamport: number): Op => ({
      type: 'record_conflict',
      itemId: 'i1',
      field: 'title',
      base: JSON.stringify('제목'),
      variants: [{ value: JSON.stringify(v), actorId: actor, lamport }],
    });
    const a = applyOps(baseDoc(), [mk('A', 'u1', 1), mk('B', 'u2', 2), mk('A', 'u1', 1)]);
    const b = applyOps(baseDoc(), [mk('B', 'u2', 2), mk('A', 'u1', 1), mk('B', 'u2', 2)]);
    deepStrictEqual(
      a.conflicts.get('i1:title')!.variants,
      b.conflicts.get('i1:title')!.variants,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. 타이핑 버스트 경계 (D-109)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('§1.2 타이핑 버스트 경계', () => {
  it('조합 중에는 어떤 경계도 만들지 않는다 (한국어 IME)', () => {
    strictEqual(burstEnd({ kind: 'input', idleMs: 9999, composing: true, lastChar: 'ㅎ' }), null);
    strictEqual(burstEnd({ kind: 'input', idleMs: 0, composing: true, lastChar: ' ' }), null);
  });

  it('idle 500ms / compositionend / blur / 문장부호 / flush에서 닫는다', () => {
    strictEqual(burstEnd({ kind: 'input', idleMs: TITLE_IDLE_MS, composing: false, lastChar: '가' }), 'idle');
    strictEqual(burstEnd({ kind: 'input', idleMs: 10, composing: false, lastChar: '가' }), null);
    strictEqual(burstEnd({ kind: 'input', idleMs: 10, composing: false, lastChar: ' ' }), 'boundary');
    strictEqual(burstEnd({ kind: 'compositionend' }), 'composition');
    strictEqual(burstEnd({ kind: 'blur' }), 'blur');
    strictEqual(burstEnd({ kind: 'flush' }), 'flush');
  });

  it('구조 op 직전에는 반드시 닫는다 — 안 닫으면 직전 글자가 새 줄에 딸려간다', () => {
    strictEqual(
      burstEnd({ kind: 'structural', op: { type: 'insert_item', id: 'x', parentId: null, sortKey: 'a', kind: 'task', title: '' } }),
      'structural',
    );
    strictEqual(
      burstEnd({ kind: 'structural', op: { type: 'set_assignee', id: 'x', from: null, to: 'u1' } }),
      null,
    );
  });

  it('디바운스(800ms)보다 짧다 — 큐가 op을 기다리게 하면 안 된다', () => {
    ok(TITLE_IDLE_MS < 800);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * caseShare — 갈래 비중
 *
 * 균등 분할만 있던 시절, 실제 데이터에서 5갈래 중 하나가 전체의 45%인데
 * 1/5로 계산됐다. leadTimeH가 틀리는데 **아무것도 그걸 알려주지 않았다.**
 * ════════════════════════════════════════════════════════════════════════ */

describe('caseShare (갈래 비중)', () => {
  const mk = (
    id: string, parentId: string | null, sortKey: string,
    kind: 'task' | 'branch', title: string,
    durationBand: string | null = null, attrs: Record<string, unknown> = {},
  ) => ({ id, parentId, sortKey, kind, title, durationBand, attrs }) as never;

  /** CS-01 실제 분포: 5갈래 210건 중 95/55/35/20/5 */
  const CASES = [
    ['배송조회', 95, '5m'], ['단순문의', 55, '15m'], ['환불', 35, '15m'],
    ['불량', 20, '15m'], ['클레임', 5, '1h'],
  ] as const;

  const build = (withShare: boolean) => [
    mk('a', null, 'a0', 'task', '문의 유입 확인', '1m'),
    mk('b', null, 'a1', 'branch', '문의 유형 분류', null, { mode: 'xor' }),
    ...CASES.flatMap(([label, n, band], i) => [
      mk(`c${i}`, 'b', `a${i}`, 'task', label, null, {
        caseLabel: label,
        ...(withShare ? { caseShare: n / 210 } : {}),
      }),
      mk(`c${i}s`, `c${i}`, 'a0', 'task', `${label} 처리`, band),
    ]),
    mk('z', null, 'a2', 'task', '상담 이력 기록', '5m'),
  ];

  const touchOf = (withShare: boolean) => derive(build(withShare), []).metrics.touchH.value;

  it('명시된 비중이 균등 분할과 다른 답을 낸다', () => {
    const even = touchOf(false);
    const stated = touchOf(true);
    ok(Math.abs(even - stated) > 0.05, `균등 ${even} vs 명시 ${stated} — 차이가 없다면 caseShare가 안 읽히고 있다`);
    // 짧은 갈래(5분)가 45%를 차지하므로 명시 비중이 더 작아야 한다
    ok(stated < even, `명시 ${stated} 가 균등 ${even} 보다 커서는 안 된다`);
  });

  it('비중이 하나도 없으면 종전대로 균등 분할이다', () => {
    // 회귀 방어 — caseShare 도입이 기존 문서의 숫자를 바꾸면 안 된다
    const g = derive(build(false), []);
    const outs = g.edges.filter((e) => e.source === 'b');
    strictEqual(outs.length, 5);
  });

  it('갈래 컨테이너는 노드가 아니므로 caseItemId로 찾아야 한다', () => {
    // 이 테스트가 있는 이유: e.target으로 읽으면 언제나 undefined가 나오고
    // **조용히 균등 분할로 되돌아간다.** 그 실수를 여기서 고정한다.
    const g = derive(build(true), []);
    const outs = g.edges.filter((e) => e.source === 'b');
    for (const e of outs) {
      ok(e.caseItemId != null, '분기 출력 엣지는 caseItemId를 실어야 한다');
      strictEqual(g.nodes.find((n) => n.id === e.caseItemId), undefined, '갈래 컨테이너는 노드가 되지 않는다');
    }
  });

  it('합이 1을 넘으면 비례 축소한다 (사용자가 건수를 적었을 때)', () => {
    const items = [
      mk('a', null, 'a0', 'branch', '분류', null, { mode: 'xor' }),
      mk('c0', 'a', 'a0', 'task', 'A', null, { caseLabel: 'A', caseShare: 95 }),
      mk('c0s', 'c0', 'a0', 'task', 'A 처리', '1h'),
      mk('c1', 'a', 'a1', 'task', 'B', null, { caseLabel: 'B', caseShare: 5 }),
      mk('c1s', 'c1', 'a0', 'task', 'B 처리', '1h'),
    ];
    // 95 + 5 = 100 → 0.95 / 0.05 로 축소되어야 하므로 touchH ≈ 1h
    const m = derive(items as never, []).metrics.touchH.value;
    ok(Math.abs(m - 1) < 0.01, `touchH ${m} — 비례 축소가 안 되고 있다`);
  });
});

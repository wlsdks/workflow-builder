/**
 * packages/graph-core/src/ops/coalesce.ts
 *
 * SYNC.md §4.2 — 큐 압축. `set_title` 100번 → 1번.
 *
 * 버스트 확정(§1.2)이 1차 방어, 큐 압축이 2차 방어다. 버스트가 열려 있는데 사용자가
 * 다른 아이템으로 갔다 돌아오면 op이 두 개가 되고, 800ms 창 안에 그런 일이 여러 번 일어난다.
 *
 * 불변식(§14.4가 속성 테스트로 검증한다):
 *   applyOps(s, coalesce(ops)) ≡ applyOps(s, ops)
 *
 * 오른쪽에서 왼쪽으로 훑으며 "이 뒤에 같은 슬롯을 덮어쓰는 op이 있는가"를 본다.
 * 장벽(barrier)을 넘어서는 압축하지 않는다.
 *
 * **압축은 `inflight`를 넘어가지 않는다** (§4.4). 이 함수는 `queued`만 받는다.
 */

import type { OpEnvelope } from './envelope.ts';
import type { Op } from './types.ts';
import { referencedIds } from './types.ts';
import { slots, touchedItems, type Slot } from './commute.ts';

/** 구조 op은 장벽이다 — 이걸 넘어 필드 op을 합치면 순서 의미가 깨진다 */
const BARRIER_TYPES = new Set<Op['type']>([
  'delete_item',
  'restore_item',
  'move_item',
  'paste_batch',
]);

/**
 * ★ 명세 §4.2가 적지 않은 전제.
 *
 * 규칙 (1) insert 흡수와 (2) insert+delete 상쇄는 둘 다
 * **"그 `insert_item`이 실제로 새 아이템을 만든다"**를 전제한다.
 * `applyOp`의 insert는 멱등이라 id가 이미 있으면 무시되고, 그때 뒤따르는
 * `set_title`은 **기존 아이템**에 적용된다. 그 상태에서 제목을 insert로 흡수하면
 * 제목 변경이 통째로 사라진다 (P3 반례 — 시드 12에서 실제로 잡혔다).
 *
 * 실무에서는 D-031(클라이언트 발급 UUID) 덕분에 항상 참이지만, 계약이므로 적어 둔다.
 * 참이 아닐 수 있는 경로(아웃박스 재구성·서버 재생)에서는 `known`을 넘긴다.
 */
export type CoalesceOptions = {
  /** `insert_item(id) … delete_item(id)` 상쇄를 켤지 (§4.2 규칙 2). 기본 true */
  cancelCreateDelete?: boolean;
  /**
   * 이미 존재하거나 서버가 아는 아이템 ID.
   * 여기 있는 id는 흡수·상쇄 대상에서 빠진다 —
   * 이미 서버가 아는 아이템을 큐에서 지우면 다른 사람 화면에 유령 아이템이 남는다.
   */
  known?: ReadonlySet<string>;
};

export function coalesce(
  envelopes: readonly OpEnvelope[],
  options: CoalesceOptions = {},
): OpEnvelope[] {
  let out = dropSuperseded(envelopes);
  out = absorbTitleIntoInsert(out, options.known);
  if (options.cancelCreateDelete !== false) out = cancelCreateDelete(out, options.known);
  return out;
}

/** 봉투 없이 op만 다루는 호출자를 위한 얇은 래퍼 (테스트·서버 재생) */
export function coalesceOps(ops: readonly Op[], options: CoalesceOptions = {}): Op[] {
  const envs = ops.map((op, i) => stubEnvelope(op, i));
  return coalesce(envs, options).map((e) => e.op);
}

/* ── 1) 뒤에서 덮어쓰는 op이 있으면 앞의 것을 버린다 ───────────────────────── */

function dropSuperseded(envelopes: readonly OpEnvelope[]): OpEnvelope[] {
  const kept: OpEnvelope[] = [];
  const seenSlot = new Set<string>(); // `${itemId}:${slot}`
  const barrier = new Set<string>(); // 이 아이템은 이 지점 이후로 압축 금지
  /** 버린 op의 from을 살려 두는 곳 — 3-way merge의 base가 여기서 보존된다 */
  const earliestFrom = new Map<string, unknown>();

  for (let i = envelopes.length - 1; i >= 0; i--) {
    const env = envelopes[i]!;
    const op = env.op;
    const ids = touchedItems(op);

    if (BARRIER_TYPES.has(op.type)) {
      for (const id of ids) barrier.add(id);
      kept.push(env);
      continue;
    }

    const id = [...ids][0];
    if (id === undefined) {
      kept.push(env);
      continue;
    }

    const mySlots = [...slots(op, id)];
    // ★ **모든** 슬롯이 뒤에서 덮어써질 때만 버린다.
    //   set_attr{mode, caseLabel}에서 mode만 덮어써졌다고 통째로 버리면 caseLabel이 사라진다
    const dropped =
      mySlots.length > 0 &&
      isCoalescable(op) &&
      !barrier.has(id) &&
      mySlots.every((slot) => seenSlot.has(`${id}:${slot}`));

    for (const slot of mySlots) {
      const key = `${id}:${slot}`;
      // 버린 op의 `from`은 살려야 3-way merge의 base가 보존된다 (아래 fixFrom)
      if (dropped && 'from' in op) earliestFrom.set(key, op.from);
      seenSlot.add(key);
    }
    if (!dropped) kept.push(env);
  }

  kept.reverse();
  return fixFrom(kept, earliestFrom);
}

/**
 * 슬롯을 통째로 덮어쓰는 op만 압축 대상이다.
 *
 * `set_attr`은 **키별 패치**라서 같은 슬롯(`attr:mode`)을 두 번 만졌다면 덮어쓰기가 맞다.
 * `add_tool`/`remove_tool`은 집합 원소 연산이라 뒤의 op이 앞의 op을 덮어쓰지 않는다
 * (`add(a)` 다음 `add(b)`는 둘 다 살아야 한다). `confirm_item`은 max 병합이라
 * 뒤의 값이 반드시 이기지는 않는다.
 */
function isCoalescable(op: Op): boolean {
  switch (op.type) {
    case 'set_title':
    case 'set_kind':
    case 'set_assignee':
    case 'set_duration':
    case 'set_freq':
    case 'set_automation':
    case 'set_pain':
    case 'set_attr':
    case 'set_edge_label':
    case 'set_doc_title':
    case 'reorder_item':
      return true;
    default:
      return false;
  }
}

/**
 * 압축 후 남은 op의 `from`을 **가장 이른 값**으로 되돌린다.
 *
 * set_title(A→B), set_title(B→C) 를 set_title(B→C)로 줄이면 base가 B가 되어버린다.
 * 그러면 동료가 A에서 갈라져 나갔을 때 3-way merge의 공통 조상이 틀어진다.
 * 반드시 set_title(A→C)로 만들어야 한다. **압축이 병합 품질을 깎으면 안 된다.**
 */
function fixFrom(kept: readonly OpEnvelope[], earliestFrom: ReadonlyMap<string, unknown>): OpEnvelope[] {
  if (earliestFrom.size === 0) return [...kept];
  return kept.map((env) => {
    const op = env.op;
    if (!('from' in op)) return env;
    const ids = touchedItems(op);
    const id = [...ids][0];
    if (id === undefined) return env;
    let next: Op = op;
    let touched = false;
    for (const slot of slots(op, id)) {
      const key = `${id}:${slot}`;
      if (!earliestFrom.has(key)) continue;
      const from = earliestFrom.get(key);
      touched = true;
      if (op.type === 'set_attr') {
        // attrs는 키별 슬롯이므로 키 단위로 base를 되살린다
        const attrKey = slotAttrKey(slot);
        if (attrKey === null) continue;
        const prev = (from as Record<string, unknown>)[attrKey];
        const cur = (next as typeof op).from as Record<string, unknown>;
        next = withFrom(next, { ...cur, [attrKey]: prev });
      } else {
        next = withFrom(next, from);
      }
    }
    return touched ? { ...env, op: next } : env;
  });
}

/** `from` 슬롯 하나만 갈아끼운다. 판별 유니온을 그대로 유지하기 위한 좁은 캐스트 */
function withFrom(op: Op, from: unknown): Op {
  return { ...(op as Record<string, unknown>), from } as unknown as Op;
}

function slotAttrKey(slot: Slot): string | null {
  return slot.startsWith('attr:') ? slot.slice('attr:'.length) : null;
}

/* ── 2) insert 직후의 set_title은 insert에 흡수시킨다 ─────────────────────── */
/**
 * 새 줄에 타이핑하는 가장 흔한 경로:
 *   insert_item(id, title:'') + set_title(id, ''→'견적서 작성')
 *     →  insert_item(id, title:'견적서 작성')
 */
function absorbTitleIntoInsert(
  envelopes: readonly OpEnvelope[],
  known: ReadonlySet<string> | undefined,
): OpEnvelope[] {
  const insertAt = new Map<string, number>();
  for (let i = 0; i < envelopes.length; i++) {
    const op = envelopes[i]!.op;
    // ★ **처음** insert만 대상이다. 같은 id의 두 번째 insert는 리듀서가 무시하므로
    //   거기에 제목을 흡수시키면 제목이 사라진다
    if (op.type === 'insert_item' && !known?.has(op.id) && !insertAt.has(op.id)) {
      insertAt.set(op.id, i);
    }
  }
  if (insertAt.size === 0) return [...envelopes];

  const out = [...envelopes];
  const removed = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    const env = out[i]!;
    const op = env.op;
    if (op.type !== 'set_title') continue;
    const at = insertAt.get(op.id);
    if (at === undefined || at >= i) continue;
    if (hasBarrierBetween(out, at, i, op.id, removed)) continue;

    const insertEnv = out[at]!;
    const insertOp = insertEnv.op;
    if (insertOp.type !== 'insert_item') continue;
    out[at] = { ...insertEnv, op: { ...insertOp, title: op.to } };
    removed.add(i);
  }
  return out.filter((_, i) => !removed.has(i));
}

/** 두 지점 사이에 이 아이템의 생사·위치를 흔드는 op이 있는가 */
function hasBarrierBetween(
  envs: readonly OpEnvelope[],
  from: number,
  to: number,
  id: string,
  removed: ReadonlySet<number>,
): boolean {
  for (let k = from + 1; k < to; k++) {
    if (removed.has(k)) continue;
    const op = envs[k]!.op;
    if (!BARRIER_TYPES.has(op.type)) continue;
    if (touchedItems(op).has(id)) return true;
  }
  return false;
}

/* ── 3) 만들고 바로 지운 아이템은 아예 보내지 않는다 ─────────────────────── */
/**
 * insert_item(id) … delete_item(id)  →  둘 다 제거.
 * 조건: 그 사이 다른 op이 이 id를 참조하지 않고(엣지 포함), id가 아직 ack되지 않았을 것.
 *
 * "Enter 눌렀다가 마음 바뀌어 지움"이 op 로그를 오염시키지 않게 한다.
 * 관찰 동등성은 tombstone이 `derive()`에서 걸러지기 때문에 유지된다 —
 * DocState에는 차이가 남지만 그림·`contentHash`는 같다.
 */
function cancelCreateDelete(
  envelopes: readonly OpEnvelope[],
  known: ReadonlySet<string> | undefined,
): OpEnvelope[] {
  const removed = new Set<number>();
  const seen = new Set<string>();
  for (let i = 0; i < envelopes.length; i++) {
    const op = envelopes[i]!.op;
    if (op.type !== 'insert_item') continue;
    if (known?.has(op.id)) continue;
    // 같은 id의 두 번째 insert는 아무것도 만들지 않는다 — 상쇄 짝이 될 수 없다
    if (seen.has(op.id)) continue;
    seen.add(op.id);

    const del = findCancellingDelete(envelopes, i, op.id, removed);
    if (del === null) continue;
    removed.add(i);
    removed.add(del);
  }
  return removed.size === 0 ? [...envelopes] : envelopes.filter((_, i) => !removed.has(i));
}

function findCancellingDelete(
  envs: readonly OpEnvelope[],
  from: number,
  id: string,
  removed: ReadonlySet<number>,
): number | null {
  let del: number | null = null;
  for (let k = from + 1; k < envs.length; k++) {
    if (removed.has(k)) continue;
    const op = envs[k]!.op;
    if (del === null && op.type === 'delete_item' && op.id === id) {
      del = k;
      continue;
    }
    if (!referencedIds(op).includes(id)) continue;
    // 삭제 **이후**에 이 id를 다시 만지는 op이 있으면 상쇄할 수 없다.
    //   [insert, delete, insert] — 원본에서는 두 번째 insert가 tombstone 때문에 무시되지만
    //   상쇄해 버리면 두 번째 insert가 살아나 없던 단계가 생긴다 (시드 11에서 잡힌 반례)
    if (del !== null) return null;
    // 삭제 이전이라도 부모·엣지 끝점으로 참조되면 남겨야 한다
    if (!isSelfOnly(op, id)) return null;
    if (op.type === 'insert_item' || op.type === 'paste_batch') return null;
  }
  return del;
}

/** 이 op이 오직 자기 자신(그 아이템)만 만지는가 — 부모·엣지 참조가 아니면 상쇄해도 안전하다 */
function isSelfOnly(op: Op, id: string): boolean {
  const refs = referencedIds(op);
  return refs.length === 1 && refs[0] === id;
}

/* ── 헬퍼 ────────────────────────────────────────────────────────────────── */

function stubEnvelope(op: Op, i: number): OpEnvelope {
  return {
    opId: `op-${i}`,
    txnId: 'txn',
    actorId: 'local',
    lamport: i,
    ts: 0,
    baseRevision: 0,
    op,
  };
}

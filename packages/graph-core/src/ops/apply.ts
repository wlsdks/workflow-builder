/**
 * packages/graph-core/src/ops/apply.ts
 *
 * SYNC.md §2.3 — 순수 리듀서.
 *
 * 순수·전역(total) 함수. **절대 throw하지 않는다.**
 *
 * 이유: 같은 리듀서가 (a) 낙관적 로컬 적용 (b) 서버 권위 적용 (c) 오프라인 rebase
 * (d) 스냅샷 복원에서 돌아간다. 이 중 하나라도 예외를 던지면 그 순간 문서가 멈춘다.
 * 적용할 수 없는 op은 **상태를 그대로 돌려주는 것으로 처리**하고, 진단은 derive()가 낸다.
 * (GRAPH-CORE §4.1 "이 함수는 판정하지 않는다"와 같은 철학 — 오류는 없고 복구만 있다)
 *
 * 반환 규칙: 아무것도 바뀌지 않으면 **같은 참조**를 돌려준다.
 * 호출자가 `next === prev`로 리렌더·재파생·큐 적재를 전부 건너뛴다.
 */

import type { Edge, Item, ItemAttrs } from '../types.ts';
import type { DocState, FieldConflict, FieldConflictField } from './state.ts';
import { RESOLVED_MARK, TOMBSTONE } from './state.ts';
import type { Op } from './types.ts';

export function applyOp(state: DocState, op: Op): DocState {
  switch (op.type) {
    /* ── 구조 ─────────────────────────────────────────────────────────── */

    case 'insert_item': {
      // 멱등: 이미 있으면 무시한다. 재전송·재생에서 반드시 필요하다
      if (state.items.has(op.id)) return state;
      const item: Item = {
        id: op.id,
        parentId: op.parentId,
        sortKey: op.sortKey,
        kind: op.kind,
        title: op.title,
        attrs: {},
        assigneeId: null,
        durationBand: null,
        toolIds: [],
        freqLast7d: null,
        automationLevel: null,
        painFlag: false,
        lastConfirmedAt: null,
        deletedAt: null,
      };
      // 부모가 없거나 tombstone이어도 **넣는다.** derive()의 'orphan-parent' 복구가 받아준다
      return { ...state, items: mapSet(state.items, op.id, item) };
    }

    case 'delete_item': {
      const cur = state.items.get(op.id);
      if (!cur || cur.deletedAt) return state;
      // ★ 필드는 하나도 지우지 않는다. deletedAt만 세운다 (I1 + I4)
      //   "지운 단계에 쓰셨던 내용"을 나중에 돌려줄 수 있는 유일한 이유다
      return { ...state, items: mapSet(state.items, op.id, { ...cur, deletedAt: TOMBSTONE }) };
    }

    case 'restore_item': {
      const cur = state.items.get(op.id);
      if (!cur || !cur.deletedAt) return state;
      return { ...state, items: mapSet(state.items, op.id, { ...cur, deletedAt: null }) };
    }

    case 'move_item': {
      const cur = state.items.get(op.id);
      if (!cur) return state;
      // 자기 자신의 하위로 옮기는 것만 막는다. 다른 모든 이상은 derive()가 복구한다
      if (op.parentId !== null && isDescendant(state, op.parentId, op.id)) return state;
      if ((cur.parentId ?? null) === op.parentId && cur.sortKey === op.sortKey) return state;
      return {
        ...state,
        items: mapSet(state.items, op.id, { ...cur, parentId: op.parentId, sortKey: op.sortKey }),
      };
    }

    case 'reorder_item': {
      const cur = state.items.get(op.id);
      if (!cur || cur.sortKey === op.sortKey) return state;
      return { ...state, items: mapSet(state.items, op.id, { ...cur, sortKey: op.sortKey }) };
    }

    /* ── 스칼라 ───────────────────────────────────────────────────────── */
    //  from은 **여기서 검사하지 않는다.** 리듀서는 이미 정해진 순서를 재생할 뿐이고,
    //  from을 볼 자격이 있는 곳은 rebase(§5)와 서버 병합(§9)뿐이다.
    //  리듀서가 from을 보면 재생(replay)이 비결정적이 된다 — 스냅샷 복원이 깨진다.

    case 'set_title':
      return patch(state, op.id, (i) => (i.title === op.to ? null : { title: op.to }));
    case 'set_kind':
      return patch(state, op.id, (i) => (i.kind === op.to ? null : { kind: op.to }));
    case 'set_assignee':
      return patch(state, op.id, (i) => ((i.assigneeId ?? null) === op.to ? null : { assigneeId: op.to }));
    case 'set_duration':
      return patch(state, op.id, (i) =>
        (i.durationBand ?? null) === op.to ? null : { durationBand: op.to },
      );
    case 'set_freq':
      return patch(state, op.id, (i) => ((i.freqLast7d ?? null) === op.to ? null : { freqLast7d: op.to }));
    case 'set_automation':
      return patch(state, op.id, (i) =>
        (i.automationLevel ?? null) === op.to ? null : { automationLevel: op.to },
      );
    case 'set_pain':
      return patch(state, op.id, (i) => ((i.painFlag ?? false) === op.to ? null : { painFlag: op.to }));

    case 'set_attr':
      return patch(state, op.id, (i) => {
        const next: Record<string, unknown> = { ...i.attrs };
        let changed = false;
        for (const [k, v] of Object.entries(op.to)) {
          if (v === undefined) {
            if (k in next) {
              delete next[k];
              changed = true;
            }
          } else if (next[k] !== v) {
            next[k] = v;
            changed = true;
          }
        }
        return changed ? { attrs: next as ItemAttrs } : null;
      });

    case 'confirm_item':
      // 병합은 max — 늦은 확인이 이른 확인을 덮지 않고, 순서와 무관해진다 (교환 가능)
      return patch(state, op.id, (i) => {
        const cur = i.lastConfirmedAt ? i.lastConfirmedAt.getTime() : 0;
        return op.at > cur ? { lastConfirmedAt: new Date(op.at) } : null;
      });

    /* ── 도구 ─────────────────────────────────────────────────────────── */
    //  정렬 저장이 핵심이다. 정렬하지 않으면 같은 집합이 다른 배열이 되고
    //  contentHash가 달라져 §13의 발산 탐지가 거짓 경보를 낸다

    case 'add_tool':
      return patch(state, op.id, (i) =>
        i.toolIds?.includes(op.toolId) ? null : { toolIds: [...(i.toolIds ?? []), op.toolId].sort() },
      );

    case 'remove_tool':
      return patch(state, op.id, (i) =>
        i.toolIds?.includes(op.toolId) ? { toolIds: i.toolIds.filter((t) => t !== op.toolId) } : null,
      );

    /* ── 엣지 ─────────────────────────────────────────────────────────── */

    case 'add_edge':
    case 'suppress_edge': {
      if (state.edges.has(op.id)) return state;
      const kind = op.type === 'add_edge' ? 'explicit' : 'suppressed';
      // 같은 (source,target,kind) 중복은 사용자 의도상 하나다 — 뒤에 온 것은 무시한다
      for (const e of state.edges.values()) {
        if (e.sourceId === op.sourceId && e.targetId === op.targetId && e.kind === kind) return state;
      }
      const edge: Edge = {
        id: op.id,
        sourceId: op.sourceId,
        targetId: op.targetId,
        kind,
        ...(op.type === 'add_edge' && op.label !== undefined ? { label: op.label } : {}),
      };
      return { ...state, edges: mapSet(state.edges, op.id, edge) };
    }

    case 'remove_edge':
    case 'unsuppress_edge': {
      if (!state.edges.has(op.id)) return state;
      const edges = new Map(state.edges);
      edges.delete(op.id);
      // ★ 엣지만은 tombstone이 아니라 실삭제다. 엣지에는 사용자가 쓴 바이트가 label밖에 없고,
      //   label은 undo 스택(§11)이 역연산으로 통째로 들고 있다. tombstone 비용 > 이득
      return { ...state, edges };
    }

    case 'set_edge_label': {
      const cur = state.edges.get(op.id);
      if (!cur || (cur.label ?? null) === op.to) return state;
      const next = { ...cur };
      if (op.to === null) delete next.label;
      else next.label = op.to;
      return { ...state, edges: mapSet(state.edges, op.id, next) };
    }

    /* ── 문서 ─────────────────────────────────────────────────────────── */

    case 'set_doc_title':
      return state.title === op.to ? state : { ...state, title: op.to };

    /* ── 배치 ─────────────────────────────────────────────────────────── */

    case 'paste_batch': {
      let items = state.items;
      for (const raw of op.items) {
        if (items.has(raw.id)) continue; // 멱등
        items = mapSet(items, raw.id, {
          id: raw.id,
          parentId: raw.parentId,
          sortKey: raw.sortKey,
          kind: raw.kind,
          title: raw.title,
          attrs: raw.attrs ?? {},
          assigneeId: raw.assigneeId ?? null,
          durationBand: raw.durationBand ?? null,
          toolIds: [],
          freqLast7d: null,
          automationLevel: null,
          painFlag: false,
          lastConfirmedAt: null,
          deletedAt: null,
        });
      }
      let edges = state.edges;
      for (const e of op.edges) {
        if (edges.has(e.id)) continue;
        edges = mapSet(edges, e.id, {
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          kind: 'explicit',
          ...(e.label !== undefined ? { label: e.label } : {}),
        });
      }
      return items === state.items && edges === state.edges ? state : { ...state, items, edges };
    }

    /* ── 충돌 ─────────────────────────────────────────────────────────── */

    case 'record_conflict': {
      const id = `${op.itemId}:${op.field}`;
      const prev = state.conflicts.get(id);
      // 같은 슬롯의 충돌은 누적한다. 값 기준 dedup — 재전송·양방향 발견에도 하나로 수렴
      const seen = new Set(prev?.variants.map((v) => v.value) ?? []);
      const merged = [...(prev?.variants ?? [])];
      for (const v of op.variants) {
        if (!seen.has(v.value)) {
          merged.push(v);
          seen.add(v.value);
        }
      }
      // ★ 명세(§2.3)의 비교자는 actorId가 같을 때 1을 돌려줘 반대칭성이 깨진다.
      //   value까지 내려가는 전순서로 고쳐야 정렬이 순서 무관해진다 (§3.3 각주 16의 전제)
      merged.sort(
        (a, b) =>
          a.lamport - b.lamport ||
          (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0) ||
          (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
      );
      const live = state.items.get(op.itemId);
      const conflict: FieldConflict = {
        id,
        itemId: op.itemId,
        field: op.field,
        base: prev?.base ?? op.base,
        variants: merged,
        liveValue: safeStringify(readField(live, op.field)),
        resolvedAt: null,
      };
      if (prev && sameConflict(prev, conflict)) return state;
      return { ...state, conflicts: mapSet(state.conflicts, id, conflict) };
    }

    case 'resolve_conflict': {
      const id = `${op.itemId}:${op.field}`;
      const prev = state.conflicts.get(id);
      if (!prev || prev.resolvedAt !== null) return state;
      // ★ 명세는 JSON.parse를 그대로 부른다 — 손상된 payload 하나로 리듀서가 throw한다.
      //   "절대 throw하지 않는다"(§2.3)가 상위 계약이므로 파싱 실패는 무시로 처리한다
      const parsed = safeParse(op.chosen);
      if (!parsed.ok) return state;
      // 1) 고른 값을 실제 슬롯에 반영
      const applied = writeField(state, op.itemId, op.field, parsed.value);
      // 2) 충돌 레코드는 **지우지 않는다.** resolved 표시만 한다 —
      //    "고른 뒤에도 다른 쪽을 되찾을 수 있다"가 I1의 마지막 방어선이다
      const conflicts = mapSet(applied.conflicts, id, { ...prev, resolvedAt: RESOLVED_MARK });
      return { ...applied, conflicts };
    }
  }
}

export function applyOps(state: DocState, ops: readonly Op[]): DocState {
  let s = state;
  for (const op of ops) s = applyOp(s, op);
  return s;
}

/* ── 필드 접근 ───────────────────────────────────────────────────────────── */

/** 충돌 필드 읽기. 아이템이 없으면 null */
export function readField(item: Item | undefined, field: FieldConflictField): unknown {
  if (!item) return null;
  switch (field) {
    case 'title':
      return item.title;
    case 'assigneeId':
      return item.assigneeId ?? null;
    case 'durationBand':
      return item.durationBand ?? null;
    case 'kind':
      return item.kind;
    case 'attrs':
      return item.attrs;
    case 'deleted':
      return item.deletedAt != null;
  }
}

/** 충돌 해소가 고른 값을 슬롯에 쓴다. 타입이 맞지 않으면 아무것도 하지 않는다 */
export function writeField(
  state: DocState,
  itemId: string,
  field: FieldConflictField,
  value: unknown,
): DocState {
  return patch(state, itemId, (i) => {
    switch (field) {
      case 'title':
        return typeof value === 'string' && value !== i.title ? { title: value } : null;
      case 'assigneeId': {
        const v = value === null || typeof value === 'string' ? value : undefined;
        return v !== undefined && v !== (i.assigneeId ?? null) ? { assigneeId: v } : null;
      }
      case 'durationBand': {
        const v = value === null || typeof value === 'string' ? (value as Item['durationBand']) : undefined;
        return v !== undefined && v !== (i.durationBand ?? null) ? { durationBand: v } : null;
      }
      case 'kind': {
        const ok = value === 'task' || value === 'branch' || value === 'hold';
        return ok && value !== i.kind ? { kind: value } : null;
      }
      case 'attrs':
        return value !== null && typeof value === 'object' && !Array.isArray(value)
          ? { attrs: value as ItemAttrs }
          : null;
      case 'deleted': {
        if (typeof value !== 'boolean') return null;
        const isDeleted = i.deletedAt != null;
        if (isDeleted === value) return null;
        return { deletedAt: value ? TOMBSTONE : null };
      }
    }
  });
}

/* ── 헬퍼 ────────────────────────────────────────────────────────────────── */

function mapSet<K, V>(m: ReadonlyMap<K, V>, k: K, v: V): Map<K, V> {
  const next = new Map(m);
  next.set(k, v);
  return next;
}

/** 부분 갱신. fn이 null을 돌려주면 상태 참조를 유지한다 */
function patch(state: DocState, id: string, fn: (i: Item) => Partial<Item> | null): DocState {
  const cur = state.items.get(id);
  if (!cur) return state; // 없는 아이템에 대한 필드 op은 조용히 무시 (§5.4)
  const p = fn(cur);
  if (p === null) return state;
  return { ...state, items: mapSet(state.items, id, { ...cur, ...p }) };
}

export function isDescendant(state: DocState, candidate: string, ancestor: string): boolean {
  let cur: string | null = candidate;
  for (let guard = 0; cur !== null && guard < 10_000; guard++) {
    if (cur === ancestor) return true;
    cur = state.items.get(cur)?.parentId ?? null;
  }
  return false;
}

function sameConflict(a: FieldConflict, b: FieldConflict): boolean {
  return (
    a.base === b.base &&
    a.liveValue === b.liveValue &&
    a.resolvedAt === b.resolvedAt &&
    a.variants.length === b.variants.length &&
    a.variants.every((v, i) => {
      const w = b.variants[i]!;
      return v.value === w.value && v.actorId === w.actorId && v.lamport === w.lamport;
    })
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? 'null';
  } catch {
    return 'null';
  }
}

function safeParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return { ok: false };
  }
}

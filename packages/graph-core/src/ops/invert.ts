/**
 * packages/graph-core/src/ops/invert.ts
 *
 * SYNC.md §2.4 — 역연산. undo(§11)의 재료.
 *
 * **적용 *전* 상태가 있어야 계산할 수 있다** — 이것이 undo를 "나중에 로그만 보고"
 * 만들 수 없는 이유다. 되돌릴 수 없는 op(record_conflict 등)은 null —
 * undo 스택에 담기지 않는다. 되돌릴 것이 없는 op은 `[]`(빈 배열)이다.
 *
 * ── 명세와의 차이 (의도적) ───────────────────────────────────────────────────
 * 명세 §2.4의 스칼라 역연산은 `{from: op.to, to: op.from}`으로 **op의 from을 그대로**
 * 쓴다. 하지만 §2.4의 첫 줄은 "적용 전 상태 기준"이라고 못 박는다. 둘은 `from`이
 * 실제 상태와 일치할 때만 같다. 일치하지 않는 경우가 실제로 있다:
 *   - rebase(§5.1)가 `{...op, from: server}`로 from을 갈아끼운다
 *   - coalesce의 fixFrom(§4.2)이 from을 가장 이른 값으로 되돌린다
 *   - 없는 아이템·같은 값이라 op이 no-op이었던 경우
 * 그래서 여기서는 **before 상태에서 실제 값을 읽는다.** P4(역연산 정확성)는
 * 이 선택이 없으면 임의 상태에서 반증된다.
 */

import type { ItemAttrs } from '../types.ts';
import type { DocState } from './state.ts';
import { applyOp, isDescendant } from './apply.ts';
import type { Op } from './types.ts';

export function invertOp(before: DocState, op: Op): Op[] | null {
  switch (op.type) {
    case 'insert_item':
      return before.items.has(op.id) ? [] : [{ type: 'delete_item', id: op.id }];

    case 'delete_item': {
      const cur = before.items.get(op.id);
      if (!cur || cur.deletedAt) return [];
      // tombstone 덕분에 역연산이 한 줄이다. 필드를 복원할 필요가 없다 (I4의 배당금)
      return [{ type: 'restore_item', id: op.id }];
    }

    case 'restore_item': {
      const cur = before.items.get(op.id);
      // 살아 있는 항목에 대한 restore는 no-op — 되돌리면 안 되는 삭제가 생긴다
      if (!cur || !cur.deletedAt) return [];
      return [{ type: 'delete_item', id: op.id }];
    }

    case 'move_item': {
      const cur = before.items.get(op.id);
      if (!cur) return [];
      if (op.parentId !== null && isDescendant(before, op.parentId, op.id)) return [];
      if ((cur.parentId ?? null) === op.parentId && cur.sortKey === op.sortKey) return [];
      return [{ type: 'move_item', id: op.id, parentId: cur.parentId ?? null, sortKey: cur.sortKey }];
    }

    case 'reorder_item': {
      const cur = before.items.get(op.id);
      if (!cur || cur.sortKey === op.sortKey) return [];
      return [{ type: 'reorder_item', id: op.id, sortKey: cur.sortKey }];
    }

    /* ── 스칼라 — before의 실제 값으로 되돌린다 ─────────────────────────── */

    case 'set_title': {
      const cur = before.items.get(op.id);
      if (!cur || cur.title === op.to) return [];
      return [{ type: 'set_title', id: op.id, from: op.to, to: cur.title }];
    }
    case 'set_kind': {
      const cur = before.items.get(op.id);
      if (!cur || cur.kind === op.to) return [];
      return [{ type: 'set_kind', id: op.id, from: op.to, to: cur.kind }];
    }
    case 'set_assignee': {
      const cur = before.items.get(op.id);
      if (!cur || (cur.assigneeId ?? null) === op.to) return [];
      return [{ type: 'set_assignee', id: op.id, from: op.to, to: cur.assigneeId ?? null }];
    }
    case 'set_duration': {
      const cur = before.items.get(op.id);
      if (!cur || (cur.durationBand ?? null) === op.to) return [];
      return [{ type: 'set_duration', id: op.id, from: op.to, to: cur.durationBand ?? null }];
    }
    case 'set_freq': {
      const cur = before.items.get(op.id);
      if (!cur || (cur.freqLast7d ?? null) === op.to) return [];
      return [{ type: 'set_freq', id: op.id, from: op.to, to: cur.freqLast7d ?? null }];
    }
    case 'set_automation': {
      const cur = before.items.get(op.id);
      if (!cur || (cur.automationLevel ?? null) === op.to) return [];
      return [{ type: 'set_automation', id: op.id, from: op.to, to: cur.automationLevel ?? null }];
    }
    case 'set_pain': {
      const cur = before.items.get(op.id);
      if (!cur || (cur.painFlag ?? false) === op.to) return [];
      return [{ type: 'set_pain', id: op.id, from: op.to, to: cur.painFlag ?? false }];
    }

    /**
     * set_attr는 **키별로** 되돌린다.
     * 명세의 `{from: op.to, to: op.from}`은 op.to가 새로 만든 키(op.from에 없는 키)를
     * 지우지 못한다 — 되돌린 뒤에도 그 키가 남는다. before에서 읽어 undefined로
     * 명시해야 삭제가 된다.
     */
    case 'set_attr': {
      const cur = before.items.get(op.id);
      if (!cur) return [];
      const prev = cur.attrs as Record<string, unknown>;
      const to: Record<string, unknown> = {};
      let changed = false;
      for (const [k, v] of Object.entries(op.to)) {
        const had = k in prev;
        const pv = prev[k];
        if (v === undefined ? !had : pv === v) continue; // 이 키는 바뀌지 않는다
        to[k] = had ? pv : undefined;
        changed = true;
      }
      if (!changed) return [];
      return [{ type: 'set_attr', id: op.id, from: { ...op.to }, to: to as Partial<ItemAttrs> }];
    }

    case 'confirm_item':
      return null; // 신선도 되돌리기는 의미가 없다. 사용자 모델에 없다

    /* ── 도구 — 실제로 바뀐 경우에만 ────────────────────────────────────── */

    case 'add_tool': {
      const cur = before.items.get(op.id);
      if (!cur || cur.toolIds?.includes(op.toolId)) return [];
      return [{ type: 'remove_tool', id: op.id, toolId: op.toolId }];
    }
    case 'remove_tool': {
      const cur = before.items.get(op.id);
      if (!cur || !cur.toolIds?.includes(op.toolId)) return [];
      return [{ type: 'add_tool', id: op.id, toolId: op.toolId }];
    }

    /* ── 엣지 ───────────────────────────────────────────────────────────── */

    case 'add_edge':
    case 'suppress_edge': {
      const kind = op.type === 'add_edge' ? 'explicit' : 'suppressed';
      if (before.edges.has(op.id)) return [];
      for (const e of before.edges.values()) {
        // 중복이라 리듀서가 무시한 경우 — 되돌릴 것이 없다
        if (e.sourceId === op.sourceId && e.targetId === op.targetId && e.kind === kind) return [];
      }
      return [{ type: op.type === 'add_edge' ? 'remove_edge' : 'unsuppress_edge', id: op.id }];
    }

    case 'remove_edge':
    case 'unsuppress_edge': {
      const e = before.edges.get(op.id);
      if (!e) return [];
      return e.kind === 'explicit'
        ? [
            {
              type: 'add_edge',
              id: e.id,
              sourceId: e.sourceId,
              targetId: e.targetId,
              ...(e.label !== undefined ? { label: e.label } : {}),
            },
          ]
        : [{ type: 'suppress_edge', id: e.id, sourceId: e.sourceId, targetId: e.targetId }];
    }

    case 'set_edge_label': {
      const e = before.edges.get(op.id);
      if (!e || (e.label ?? null) === op.to) return [];
      return [{ type: 'set_edge_label', id: op.id, from: op.to, to: e.label ?? null }];
    }

    /* ── 문서 ───────────────────────────────────────────────────────────── */

    case 'set_doc_title':
      return before.title === op.to ? [] : [{ type: 'set_doc_title', from: op.to, to: before.title }];

    /* ── 배치 ───────────────────────────────────────────────────────────── */

    case 'paste_batch': {
      // 붙여넣기 1회 = undo 1회 (STATES §3). op N개가 아니라 op 1개의 역연산 N개다.
      // 이미 있던 아이템은 리듀서가 건너뛰었으므로 지우면 안 된다 (멱등 재생 대비)
      const out: Op[] = [];
      for (const i of op.items) {
        if (!before.items.has(i.id)) out.push({ type: 'delete_item', id: i.id });
      }
      for (const e of op.edges) {
        if (!before.edges.has(e.id)) out.push({ type: 'remove_edge', id: e.id });
      }
      return out;
    }

    case 'record_conflict':
      return null; // 충돌 "발견"은 사용자의 행위가 아니다
    case 'resolve_conflict':
      return null; // 해소는 §11.4에서 별도 처리
  }
}

/**
 * op 열 전체의 역연산. **역순으로** 뒤집는다.
 * 각 단계의 before 상태가 필요하므로 앞에서부터 적용하며 모은다.
 */
export function invertOps(before: DocState, ops: readonly Op[]): Op[] | null {
  const inverses: Op[] = [];
  let s = before;
  for (const op of ops) {
    const inv = invertOp(s, op);
    if (inv === null) return null;
    inverses.unshift(...inv);
    s = applyOp(s, op);
  }
  return inverses;
}

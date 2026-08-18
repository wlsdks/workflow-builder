/**
 * packages/graph-core/src/ops/types.ts
 *
 * SYNC.md §1.5 — op 판별 유니온. **zod 없이 순수 TS 타입.**
 *
 * 런타임 검증은 신뢰 경계(서버 액션 입구)의 관심사이고 `@workflow/sync-protocol`이
 * 소유한다 (D-119). 이 파일은 그 스키마가 맞춰야 할 **타입 계약**이다.
 * sync-protocol의 `OpSchema satisfies z.ZodType<Op>` 한 줄이 둘의 어긋남을
 * 컴파일 타임에 잡는다.
 *
 * ── 입도 원칙 (SYNC §1.1) ────────────────────────────────────────────────────
 *  (a) op의 입도는 "서버가 다른 사람의 변경과 나란히 놓았을 때 의미가 보존되는
 *      최소 단위"다. undo 입도는 `txnId`가 따로 담당한다 (I7 / D-109).
 *  (b) 필드 단위로 쪼갠다. 행 단위로 묶지 않는다.
 *  (c) payload에 컬렉션 전체를 싣지 않는다 — `set_tools`가 아니라
 *      `add_tool`/`remove_tool`, `toggle_pain`이 아니라 `set_pain{from,to}`.
 *
 * ── 모든 필드 op은 `from`을 싣는다 (D-110) ───────────────────────────────────
 *  `from`이 없으면 모든 필드 변경이 무조건 last-write-wins가 되고, "둘 다 보관"(I1)을
 *  구현할 수 없다. `from`은 3-way merge(§2.5)와 rebase(§5.1)의 유일한 입력이다.
 *  **리듀서는 `from`을 읽지 않는다** — 읽는 순간 재생(replay)이 비결정적이 된다.
 */

import type { DurationBand, ItemAttrs, NodeKind } from '../types.ts';
import type { ConflictVariant, FieldConflictField } from './state.ts';

/** items.id 또는 'start' / 'end' / 'join:{uuid}' / 'fork:{uuid}' */
export type NodeRef = string;

/* ── 1) 구조 ─────────────────────────────────────────────────────────────── */

/** id는 ★ 클라이언트 발급 (D-031). title은 버스트 확정 전이면 '' */
export type InsertItemOp = {
  type: 'insert_item';
  id: string;
  parentId: string | null;
  sortKey: string;
  kind: NodeKind;
  title: string;
};

/** tombstone만 세운다. 필드는 하나도 지우지 않는다 (I1 + I4) */
export type DeleteItemOp = { type: 'delete_item'; id: string };
export type RestoreItemOp = { type: 'restore_item'; id: string };

/** 부모가 바뀌는 이동. sortKey도 반드시 함께 바뀐다 (새 형제 목록의 키) */
export type MoveItemOp = { type: 'move_item'; id: string; parentId: string | null; sortKey: string };

/** 같은 부모 안 순서 변경. move_item과 분리하는 이유는 OP_SCOPE가 다르기 때문 */
export type ReorderItemOp = { type: 'reorder_item'; id: string; sortKey: string };

/* ── 2) 스칼라 필드 — 전부 from을 싣는다 ─────────────────────────────────── */

export type SetTitleOp = { type: 'set_title'; id: string; from: string; to: string };
export type SetKindOp = { type: 'set_kind'; id: string; from: NodeKind; to: NodeKind };

/** attrs는 키별 슬롯이다. from/to 모두 부분 객체 — 키가 겹치지 않으면 교환 가능 */
export type SetAttrOp = {
  type: 'set_attr';
  id: string;
  from: Partial<ItemAttrs>;
  to: Partial<ItemAttrs>;
};

/** null = "앞과 같음" (D-055). "모름"이 아니다 */
export type SetAssigneeOp = { type: 'set_assignee'; id: string; from: string | null; to: string | null };
export type SetDurationOp = {
  type: 'set_duration';
  id: string;
  from: DurationBand | null;
  to: DurationBand | null;
};
export type SetFreqOp = { type: 'set_freq'; id: string; from: number | null; to: number | null };
export type SetAutomationOp = {
  type: 'set_automation';
  id: string;
  from: number | null;
  to: number | null;
};
/** 토글이 아니라 대입. 토글은 멱등도 교환도 아니다 (§1.1c) */
export type SetPainOp = { type: 'set_pain'; id: string; from: boolean; to: boolean };

/** 신선도. at은 클라이언트가 싣고 서버가 now로 클램프한다. 병합은 max → 항상 교환 가능 */
export type ConfirmItemOp = { type: 'confirm_item'; id: string; at: number };

/* ── 3) 도구 — 집합이므로 원소 단위 ─────────────────────────────────────── */

export type AddToolOp = { type: 'add_tool'; id: string; toolId: string };
export type RemoveToolOp = { type: 'remove_tool'; id: string; toolId: string };

/* ── 4) 엣지 오버라이드 ─────────────────────────────────────────────────── */

export type AddEdgeOp = {
  type: 'add_edge';
  /** 엣지 ID도 클라이언트 발급 */
  id: string;
  sourceId: NodeRef;
  targetId: NodeRef;
  label?: string;
};

/** 파생 엣지 억제. add_edge와 같은 테이블·다른 kind */
export type SuppressEdgeOp = {
  type: 'suppress_edge';
  id: string;
  sourceId: NodeRef;
  targetId: NodeRef;
};

export type RemoveEdgeOp = { type: 'remove_edge'; id: string };
export type UnsuppressEdgeOp = { type: 'unsuppress_edge'; id: string };
export type SetEdgeLabelOp = {
  type: 'set_edge_label';
  id: string;
  from: string | null;
  to: string | null;
};

/* ── 5) 문서 ─────────────────────────────────────────────────────────────── */

export type SetDocTitleOp = { type: 'set_doc_title'; from: string; to: string };

/* ── 6) 배치 ─────────────────────────────────────────────────────────────── */

export type PasteBatchItem = {
  id: string;
  /** 배치 내부 참조 또는 배치의 parentId */
  parentId: string | null;
  sortKey: string;
  kind: NodeKind;
  title: string;
  attrs?: ItemAttrs;
  assigneeId?: string | null;
  durationBand?: DurationBand | null;
};

export type PasteBatchEdge = {
  id: string;
  sourceId: NodeRef;
  targetId: NodeRef;
  label?: string;
};

/**
 * paste_batch는 **의도적으로 굵다.** §1.1(a)의 유일한 예외.
 * 새로 만든 아이템은 전부 새 UUID라 다른 사람의 편집과 원천적으로 겹치지 않는다 —
 * 굵어도 교환 가능성을 해치지 않는다. 이게 예외를 허용할 수 있는 진짜 이유다.
 * 상한 500줄. 초과분은 batch를 나누되 **같은 txnId를 공유**시켜 undo는 1회로 유지한다.
 */
export type PasteBatchOp = {
  type: 'paste_batch';
  /** 이 배치가 만든 아이템의 최상위 부모 */
  parentId: string | null;
  items: readonly PasteBatchItem[];
  edges: readonly PasteBatchEdge[];
  /** 사용자에게 보여줄 undo 라벨. "붙여넣기 18줄" */
  label: string;
};

/* ── 7) 충돌 — op으로 표현한다 ──────────────────────────────────────────── */

/**
 * 충돌 기록 자체가 op이어야 하는 이유:
 *  (1) 다른 탭·다른 사람에게 같은 경로로 전파돼야 한다
 *  (2) 재생(replay)해도 같은 상태가 나와야 한다 — 스냅샷 복원이 충돌을 잃으면 I1 위반
 *  (3) 클라이언트가 rebase 중에 발견한 충돌과 서버가 발견한 충돌이 같은 모양이어야 한다
 */
export type RecordConflictOp = {
  type: 'record_conflict';
  itemId: string;
  field: FieldConflictField;
  /** JSON.stringify된 공통 조상 값 */
  base: string;
  /** 항상 2개 이상 8개 이하 */
  variants: readonly ConflictVariant[];
};

export type ResolveConflictOp = {
  type: 'resolve_conflict';
  itemId: string;
  field: FieldConflictField;
  /** 사용자가 고른 값(JSON). **자동 선택은 이 op을 발행하지 않는다** */
  chosen: string;
  chosenBy: string;
};

/* ── 합집합 ──────────────────────────────────────────────────────────────── */

export type Op =
  | InsertItemOp
  | DeleteItemOp
  | RestoreItemOp
  | MoveItemOp
  | ReorderItemOp
  | SetTitleOp
  | SetKindOp
  | SetAttrOp
  | SetAssigneeOp
  | SetDurationOp
  | SetFreqOp
  | SetAutomationOp
  | SetPainOp
  | ConfirmItemOp
  | AddToolOp
  | RemoveToolOp
  | AddEdgeOp
  | SuppressEdgeOp
  | RemoveEdgeOp
  | UnsuppressEdgeOp
  | SetEdgeLabelOp
  | SetDocTitleOp
  | PasteBatchOp
  | RecordConflictOp
  | ResolveConflictOp;

export type OpType = Op['type'];

/** 전수 검사용. 새 op을 추가하고 여기를 빼먹으면 아래 타입 검사가 깨진다 */
export const OP_TYPES = [
  'insert_item',
  'delete_item',
  'restore_item',
  'move_item',
  'reorder_item',
  'set_title',
  'set_kind',
  'set_attr',
  'set_assignee',
  'set_duration',
  'set_freq',
  'set_automation',
  'set_pain',
  'confirm_item',
  'add_tool',
  'remove_tool',
  'add_edge',
  'suppress_edge',
  'remove_edge',
  'unsuppress_edge',
  'set_edge_label',
  'set_doc_title',
  'paste_batch',
  'record_conflict',
  'resolve_conflict',
] as const satisfies readonly OpType[];

/** OP_TYPES가 Op을 하나라도 빠뜨리면 컴파일 에러 */
type _AllOpTypesListed = Exclude<OpType, (typeof OP_TYPES)[number]> extends never ? true : never;
const _allListed: _AllOpTypesListed = true;
void _allListed;

/**
 * 구조 op — 큐 인터셉터의 버스트 강제 종료 지점 (§1.2)이자 압축 장벽(§4.2).
 *
 * `set_title` 확정 전에 `insert_item`이 큐에 들어가면 두 op의 순서가 뒤바뀌어
 * **직전에 친 글자가 새 줄에 딸려가는** 버그가 난다.
 */
export const STRUCTURAL_OP_TYPES: ReadonlySet<OpType> = new Set<OpType>([
  'insert_item',
  'delete_item',
  'restore_item',
  'move_item',
  'reorder_item',
  'paste_batch',
]);

export function isStructuralOp(op: Op): boolean {
  return STRUCTURAL_OP_TYPES.has(op.type);
}

/** 이 op이 **새로 만드는** 아이템 ID. 교환 가능성 판정의 1차 게이트 (commute.ts) */
export function createdItems(op: Op): readonly string[] {
  if (op.type === 'insert_item') return [op.id];
  if (op.type === 'paste_batch') return op.items.map((i) => i.id);
  return [];
}

/**
 * 이 op이 **참조하는** 모든 아이템 ID (자기 자신 + 부모 + 엣지 끝점).
 * 압축(§4.2)의 "그 사이 다른 op이 이 id를 참조하지 않는가" 판정에 쓴다.
 */
export function referencedIds(op: Op): readonly string[] {
  switch (op.type) {
    case 'insert_item':
    case 'move_item':
      return op.parentId === null ? [op.id] : [op.id, op.parentId];
    case 'add_edge':
    case 'suppress_edge':
      return [op.id, op.sourceId, op.targetId];
    case 'paste_batch': {
      const out: string[] = [];
      if (op.parentId !== null) out.push(op.parentId);
      for (const i of op.items) {
        out.push(i.id);
        if (i.parentId !== null) out.push(i.parentId);
      }
      for (const e of op.edges) out.push(e.id, e.sourceId, e.targetId);
      return out;
    }
    case 'record_conflict':
    case 'resolve_conflict':
      return [op.itemId];
    case 'set_doc_title':
      return [];
    default:
      return [op.id];
  }
}

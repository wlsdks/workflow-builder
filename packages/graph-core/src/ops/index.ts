/**
 * packages/graph-core/src/ops — op 순수 계층의 공개 API.
 *
 * SYNC.md §2.1의 세 조각 중 **첫 번째 조각**이다.
 *
 *   op 타입 + 순수 리듀서 → 여기 (`graph-core/src/ops`, 런타임 deps 0)
 *   와이어 스키마         → `@workflow/sync-protocol` (zod)
 *   동기화 런타임         → `@workflow/sync-client` (zustand, idb)
 *
 * zod가 여기 들어오지 않는 이유는 D-119다. 검증은 **신뢰 경계의 관심사**이지
 * 순수 계산의 관심사가 아니다.
 */

export type {
  Op,
  OpType,
  NodeRef,
  InsertItemOp,
  DeleteItemOp,
  RestoreItemOp,
  MoveItemOp,
  ReorderItemOp,
  SetTitleOp,
  SetKindOp,
  SetAttrOp,
  SetAssigneeOp,
  SetDurationOp,
  SetFreqOp,
  SetAutomationOp,
  SetPainOp,
  ConfirmItemOp,
  AddToolOp,
  RemoveToolOp,
  AddEdgeOp,
  SuppressEdgeOp,
  RemoveEdgeOp,
  UnsuppressEdgeOp,
  SetEdgeLabelOp,
  SetDocTitleOp,
  PasteBatchOp,
  PasteBatchItem,
  PasteBatchEdge,
  RecordConflictOp,
  ResolveConflictOp,
} from './types.ts';
export { OP_TYPES, STRUCTURAL_OP_TYPES, isStructuralOp, createdItems, referencedIds } from './types.ts';

export type { DocState, FieldConflict, FieldConflictField, ConflictVariant } from './state.ts';
export { emptyDoc, TOMBSTONE, RESOLVED_MARK, itemsOf, edgesOf } from './state.ts';

export type { OpEnvelope } from './envelope.ts';
export { nextLamport, compareEnvelopes } from './envelope.ts';

export { applyOp, applyOps, readField, writeField, isDescendant } from './apply.ts';
export { invertOp, invertOps } from './invert.ts';

export { commutes, batchCommutes, slots, touchedItems, DOC_SLOT_ID } from './commute.ts';
export type { Slot } from './commute.ts';

export { coalesce, coalesceOps } from './coalesce.ts';
export type { CoalesceOptions } from './coalesce.ts';

export { merge3 } from './merge.ts';
export type { Merge3 } from './merge.ts';

export { burstEnd, titleBurstOp, TITLE_IDLE_MS } from './burst.ts';
export type { BurstEnd, BurstSignal } from './burst.ts';

/**
 * packages/sync-protocol — 공개 API.
 *
 * D-119: `graph-core`(의존성 0) / `sync-protocol`(zod) / `analytics-schema`(zod)로 나눈다.
 * 이 패키지가 소유하는 것은 **신뢰 경계의 검증**뿐이다. 리듀서·교환성·병합은
 * `@workflow/graph-core`에 있고 여기서 재수출하지 않는다 — 두 벌이 되면 어긋난다.
 */

export {
  OpSchema,
  InsertItem,
  DeleteItem,
  RestoreItem,
  MoveItem,
  ReorderItem,
  SetTitle,
  SetKind,
  SetAttr,
  SetAssignee,
  SetDuration,
  SetFreq,
  SetAutomation,
  SetPain,
  ConfirmItem,
  AddTool,
  RemoveTool,
  AddEdge,
  SuppressEdge,
  RemoveEdge,
  UnsuppressEdge,
  SetEdgeLabel,
  SetDocTitle,
  PasteBatch,
  RecordConflict,
  ResolveConflict,
} from './ops.ts';
export type { OpInput, OpOutput } from './ops.ts';

export {
  EnvelopeSchema,
  ApplyOpsRequest,
  ApplyOpsInput,
  ApplyOpsResponse,
  OkResponse,
  ConflictResponse,
  GoneResponse,
  DeniedResponse,
  SnapshotSchema,
  MAX_OPS_PER_BATCH,
  statusOf,
} from './envelope.ts';
export type {
  OpEnvelopeT,
  ApplyOpsRequestT,
  ApplyOpsInputT,
  OkResponseT,
  ConflictResponseT,
  GoneResponseT,
  DeniedResponseT,
  ApplyOpsResponseT,
  ApplyOpsResult,
  TransportFailure,
  SnapshotT,
} from './envelope.ts';

/**
 * packages/graph-core — 공개 API.
 *
 * 이 배럴에 없는 것은 내부 구현이다. 앱 코드가 `@workflow/graph-core/src/...`를
 * 직접 import 하면 ESLint `no-restricted-imports`가 막는다.
 *
 * 금지 의존성 (§12): react, react-dom, @xyflow/react, elkjs, drizzle-orm,
 * next, zustand, DOM/Node 전역. tsconfig의 `lib`에서 "DOM"을 빼서
 * `document`/`window` 사용이 **컴파일 에러**가 되게 한다.
 */

export type {
  BranchMode,
  CycleInfo,
  DeriveOptions,
  DerivedEdge,
  DerivedGraph,
  DerivedNode,
  DerivedNodeKind,
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  DurationBand,
  Edge,
  EdgeKind,
  EdgeOrigin,
  EdgeReason,
  Handoff,
  Item,
  ItemAttrs,
  JoinBehavior,
  Measure,
  Metrics,
  NodeId,
  NodeKind,
  NodeMetrics,
  SyntheticKind,
  WaitFor,
} from './types.ts';

export { derive } from './derive.ts';
export { validate, EDGE_REASON_COPY } from './validate.ts';
export type { ValidateOptions, ValidationReport } from './validate.ts';

export { toLayoutEdges } from './cycles.ts';
export { BAND_HOURS, DEFAULT_WAIT_HOURS } from './metrics.ts';

export {
  END_ID,
  START_ID,
  JOIN_PREFIX,
  FORK_PREFIX,
  joinNodeId,
  forkNodeId,
  isSyntheticId,
  isReservedId,
  derivedEdgeId,
} from './ids.ts';

export { compareSortKey } from './preprocess.ts';

export { formatGraph, formatNodes, formatEdges, formatDiagnostics } from './format.ts';

export { recomputeScope, OP_SCOPE, needsLayout, changedNodeIds } from './incremental.ts';
export type { RecomputeScope } from './incremental.ts';

/* ── op 순수 계층 (SYNC.md §2) ──────────────────────────────────────────
 * 리듀서가 graph-core에 사는 이유(§2.1): derive()의 입력을 만드는 함수이고,
 * 소비자가 4곳(브라우저·서버 액션·웹워커·스냅샷 복원)이며, 결정성 계약과
 * 테스트 자산을 그대로 공유한다. zod는 여기 들어오지 않는다 (D-119).
 */
export * from './ops/index.ts';

export { toN8n } from './export/n8n.ts';
export type { N8nExportResult, ToN8nOptions, UnmappedItem } from './export/n8n.ts';

export { projectCanvasEdit, canApplyCanvasEdit } from './project/back.ts';
export type { CanvasEdit, Projection, Rejection } from './project/back.ts';

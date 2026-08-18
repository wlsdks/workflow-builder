/**
 * packages/layout-core — 공개 API.
 *
 * 이 배럴에 없는 것은 내부 구현이다.
 *
 * 금지 의존성 (LAYOUT §14.2): react, react-dom, @xyflow/react, **elkjs**,
 * DOM/Node 전역. tsconfig의 `lib`에서 "DOM"을 빼서 `document`/`window`/`performance`
 * 사용이 **컴파일 에러**가 되게 한다.
 *
 * 경계에서 오가는 것은 정확히 셋이다.
 *   graph-core → layout-core : DerivedGraph (특히 nodes[].order, acyclic, topologyHash)
 *                              toLayoutEdges()  ← back edge 뒤집기는 graph-core 소유
 *   layout-core → apps/web   : LayoutResult   (좌표 · 엣지 기하 · 밴드 · bbox)
 *                              AnchorDecision (뷰포트를 어디로 옮길지)
 */

export type {
  AnchorDecision,
  AnchorHint,
  AnchorRule,
  CommitViewport,
  EdgeGeometry,
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkLayoutOptions,
  ElkNode,
  ElkPoint,
  LadderLevel,
  LayerBand,
  LayoutGraph,
  LayoutInput,
  LayoutKey,
  LayoutResult,
  NodePlacement,
  Point,
  Rect,
  SameZoom,
  Viewport,
  ViewportOwner,
  ViewportSize,
  XY,
} from './types.ts';

export { NODE_H, NODE_W, PILL_H, PILL_W, SPACING } from './types.ts';

export { fnv1a } from './hash.ts';
export { ELK_OPTIONS, elkOptionsHash, optionsFor, optionsHash, setElkVersion } from './options.ts';

export { containerHash, collapsedHash, layoutKeyOf, layoutKeyOfParts, layoutKeyParts } from './key.ts';
export type { LayoutKeyParts } from './key.ts';

export { GATE_TABLE, needsRelayout, rowExpectsRelayout } from './gate.ts';
export type { GateDecision, GateDimension, GateReason, GateRow } from './gate.ts';

export {
  FIT_PADDING,
  SYSTEM_REFIT_DELTA,
  VISIBLE_INSET,
  anchorScreenAt,
  assertZoomPreserved,
  bboxTopCenter,
  easeCubicInOut,
  easeFlow,
  fitsInViewport,
  intersectsViewport,
  maxAnchorDeviation,
  resolveAnchorTransform,
} from './anchor.ts';
export type { AnchorArgs } from './anchor.ts';

export {
  GUTTER_IN,
  PORT_INSET,
  RAIL_GAP,
  RAIL_MARGIN,
  gutterAbove,
  gutterBelow,
  routeBackEdges,
  verifyBackEdgeRouting,
} from './cycle.ts';
export type { RailViolation } from './cycle.ts';

export { bandsOf, fallbackLayout, isPill, sizeOf } from './fallback.ts';
export type { Acyclic, FallbackOptions } from './fallback.ts';

export { ZERO, bboxDelta, jumpScore, translateOf } from './jump.ts';
export type { JumpArgs } from './jump.ts';

export {
  allArrowsEnterFromTop,
  allBackEdgesOnRail,
  allNodesSized,
  bandsMatchLayers,
  caseFirstNodesLeftToRight,
  checkHardInvariants,
  isHappyPathLeftmost,
  layersMatchTopology,
  layoutInvariants,
  minGapInRow,
  noEdgeCrossesNode,
  noNodeOverlap,
  rowOrderMatchesModelOrder,
  rowsOf,
} from './invariants.ts';
export type { HardInvariantOptions, Invariants, Violation } from './invariants.ts';

export { buildElkGraph, pillIds } from './build.ts';
export { readLayout } from './read.ts';
export type { ReadMeta } from './read.ts';

export {
  bboxOf,
  bandIndexOf,
  clamp,
  isAxisAligned,
  layerBands,
  orthPath,
  quantile,
  rectsOverlap,
  segmentEntersRect,
  segments,
  simplifyPolyline,
} from './geometry.ts';

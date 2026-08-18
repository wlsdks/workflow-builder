/**
 * packages/layout-core/src/types.ts — LAYOUT §1.2
 *
 * 순수 타입. React / DOM / elkjs 런타임 의존 없음.
 *
 * `ElkNode` 계열은 **구조적 타입으로만** 다룬다. elkjs를 import 하지 않는다.
 * 이 파일이 ELK의 형태를 아는 유일한 타입 선언이고, 그 형태를 만드는 곳은
 * build.ts, 읽는 곳은 read.ts — 둘뿐이다 (LAYOUT §14.2).
 */

import type { DerivedEdge, DerivedGraph, DerivedNode, NodeId } from '@workflow/graph-core';

/* ── 기하 ─────────────────────────────────────────────────────────────── */

export type XY = { readonly x: number; readonly y: number };
/** XY의 별칭. "점"이라고 부르는 게 자연스러운 문맥용 */
export type Point = XY;

export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** D-023. 렌즈·줌·메타 유무와 무관하게 불변 */
export const NODE_W = 260;
export const NODE_H = 76;
/** start / end / join 합성 노드. 이것도 고정이어야 한다 */
export const PILL_W = 120;
export const PILL_H = 36;

export const SPACING = {
  nodeNode: 40,
  betweenLayers: 64,
  edgeNode: 24,
} as const;

/* ── 뷰포트 ───────────────────────────────────────────────────────────── */

/**
 * React Flow의 어파인 변환. `screen = world · zoom + (x, y)`.
 *
 * layout-core는 뷰포트를 **읽기만** 한다 — `LayoutInput`에는 존재하지 않는다.
 * 앵커 계산(anchor.ts)과 점수 계산(jump.ts)만이 이 타입을 본다.
 */
export type Viewport = { readonly x: number; readonly y: number; readonly zoom: number };
export type ViewportSize = { readonly w: number; readonly h: number };

/**
 * D-102 / L-06 — **재배치 커밋에서 줌을 바꾸지 않는다.**
 *
 * 근거는 미학이 아니라 대수다. 줌이 변하면 앵커 고정 조건
 * `T(s) = s_a − p(s)·z(s)` 가 `s`에 대해 비선형이라, CSS 트랜지션의 선형 보간으로는
 * 성립할 수 없다 (LAYOUT §3.5).
 *
 * 그래서 커밋 뷰포트의 zoom은 **입력 zoom을 그대로 복사한 값임이 브랜드로 보장된
 * 타입**이다. `anchor.ts`의 `sameZoom()` 외에는 이 타입을 만들 수 없으므로,
 * "재배치 중에 줌을 살짝 조정" 하는 코드는 캐스트 없이는 컴파일되지 않는다.
 */
export type SameZoom = number & { readonly __brand: 'SameZoom' };

/** 앵커 보정이 만들어내는 뷰포트. zoom은 입력과 같은 값임이 타입으로 보장된다 */
export type CommitViewport = { readonly x: number; readonly y: number; readonly zoom: SameZoom };

/* ── 결과 ─────────────────────────────────────────────────────────────── */

export type NodePlacement = Rect & { readonly id: NodeId; readonly layer: number };

export type EdgeGeometry = {
  readonly id: string;
  /** 항상 **실제 방향**(source→target)으로 정렬된 직교 폴리라인 */
  readonly points: readonly XY[];
  readonly kind: 'forward' | 'back';
  /** ELK에 뒤집어 넘겼는가 (마커 방향 결정용이 아니라 진단용) */
  readonly reversedForLayout: boolean;
  /** 갈래 라벨 pill의 앵커. L-01에 따라 ELK가 아니라 우리가 정한다 */
  readonly labelAnchor: XY | null;
};

/** 층 밴드. back edge 레일과 페이지 분할이 여기에 의존한다 */
export type LayerBand = { readonly index: number; readonly top: number; readonly bottom: number };

export type LayoutKey = string & { readonly __brand: 'LayoutKey' };

export type LadderLevel = 0 | 1 | 2 | 3 | 4;

export type LayoutResult = {
  readonly rev: number;
  readonly layoutKey: LayoutKey;
  readonly algorithm: 'elk' | 'fallback';
  readonly ladder: LadderLevel;
  readonly nodes: ReadonlyMap<NodeId, NodePlacement>;
  readonly edges: ReadonlyMap<string, EdgeGeometry>;
  readonly bands: readonly LayerBand[];
  /** **노드**의 bbox. back edge 사이드 레일은 이 밖을 지난다 (§4.2) */
  readonly bbox: Rect;
  readonly elapsedMs: number;
};

/* ── 입력 ─────────────────────────────────────────────────────────────── */

/**
 * `LayoutInput`에 **`lens`도 `zoom`도 `viewport`도 없다.**
 * 이건 문서화가 아니라 타입 검사기로 강제한 불변식이다 (LAYOUT §8.3 · §9).
 * 여기에 필드를 추가하려는 PR은 리뷰가 아니라 컴파일에서 막힌다.
 */
export type LayoutInput = {
  readonly graph: DerivedGraph;
  /** 접힌 그룹의 itemId 집합 (§7) */
  readonly collapsed: ReadonlySet<string>;
  /** ELK 컨테이너가 되는 명시적 그룹: groupNodeId → 직속 자식 NodeId[] (L-02) */
  readonly containers: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** 갈래 5개 이상에서 켜지는 팬아웃 스택 모드 (DESIGN §6.5) */
  readonly fanOutStack: boolean;
  readonly ladder: LadderLevel;
};

/**
 * 레이아웃이 실제로 배치하는 것 = 노드 목록 + 엣지 목록.
 *
 * `DerivedGraph`가 구조적으로 여기에 대입 가능하다. 접기(fold)를 적용한
 * 가시 그래프도 같은 모양이므로, fallback/build/read가 둘 다 받는다.
 */
export type LayoutGraph = {
  readonly nodes: readonly DerivedNode[];
  readonly edges: readonly DerivedEdge[];
};

/* ── ELK 구조적 타입 (elkjs를 import 하지 않는다) ──────────────────────── */

export type ElkLayoutOptions = Readonly<Record<string, string>>;

export type ElkPoint = { readonly x: number; readonly y: number };

export type ElkEdgeSection = {
  readonly id?: string;
  readonly startPoint: ElkPoint;
  readonly endPoint: ElkPoint;
  readonly bendPoints?: readonly ElkPoint[];
};

export type ElkExtendedEdge = {
  readonly id: string;
  readonly sources: readonly string[];
  readonly targets: readonly string[];
  readonly sections?: readonly ElkEdgeSection[];
  readonly layoutOptions?: ElkLayoutOptions;
};

/**
 * elkjs의 `ElkNode`와 **구조적으로 호환**되는 최소 형태.
 *
 * `elk.layout(graph)`에 그대로 넘길 수 있고, 결과도 그대로 받는다.
 * 실제 `elkjs` 타입을 import 하면 이 패키지가 500KB짜리 런타임 의존성을 얻는다.
 */
export type ElkNode = {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly children?: readonly ElkNode[];
  readonly edges?: readonly ElkExtendedEdge[];
  readonly layoutOptions?: ElkLayoutOptions;
};

/* ── 앵커 (§3) ────────────────────────────────────────────────────────── */

export type AnchorHint =
  /** 아웃라인에서 캐럿이 있는 블록의 itemId. 가장 강한 신호 */
  | { readonly t: 'item'; readonly itemId: string }
  /** 캔버스 선택 등으로 노드가 직접 지정된 경우 */
  | { readonly t: 'node'; readonly nodeId: NodeId }
  /** 편집 주체가 없다 (붙여넣기·undo·원격 변경·사다리 강등) */
  | { readonly t: 'auto' }
  /** 앵커링을 명시적으로 포기 (최초 로드) */
  | { readonly t: 'none' };

export type AnchorRule =
  | 'focused-item'
  | 'focused-node'
  | 'deleted-predecessor'
  | 'ancestor'
  | 'prev-sibling'
  | 'viewport-nearest'
  | 'bbox-top-center';

export type AnchorDecision =
  | {
      readonly t: 'translate';
      /** D-102: zoom은 입력과 동일한 값임이 타입으로 보장된다 */
      readonly viewport: CommitViewport;
      /** bbox 앵커에는 노드가 없다 */
      readonly anchorId: NodeId | null;
      /** 월드 좌표에서 앵커가 이동한 양. jumpScore의 보정값이 이것이다 */
      readonly delta: XY;
      readonly rule: AnchorRule;
    }
  | { readonly t: 'fit'; readonly reason: 'initial' | 'no-survivor' | 'system-viewport' | 'no-anchor-hint' }
  | {
      readonly t: 'hold';
      /**
       * 'no-move' — 앵커가 안 움직였다. 보정할 것이 없다
       * 'drift'   — 보정하면 **화면이 더 흔들린다**. anchor.ts의 표류 가드 참조
       */
      readonly reason: 'no-move' | 'drift';
      /** 어떤 후보를 골랐었는지. 계측(`anchor_rule`)이 이걸 쓴다 — 부록 A */
      readonly anchorId: NodeId | null;
      readonly rule: AnchorRule | null;
    };

/** 마지막으로 뷰포트를 움직인 주체. 'system' = fitView/프로그램 */
export type ViewportOwner = 'user' | 'system';

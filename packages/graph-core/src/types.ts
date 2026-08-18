/**
 * packages/graph-core/src/types.ts
 *
 * 순수 타입 정의. React / Drizzle / DOM 의존 금지 (D-033).
 *
 * 이 파일의 타입은 두 층으로 나뉜다.
 *   1) 입력층  — DB `items` / `edges` 행의 순수 표현 (Item, Edge)
 *   2) 파생층  — derive()의 결과 (DerivedGraph). 저장하지 않는다 (D-030).
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 입력층
 * ──────────────────────────────────────────────────────────────────────────── */

export type NodeKind = 'task' | 'branch' | 'hold';

/** 분기 모드. AND/XOR 미구분이 리드타임을 과대 계산한다 (D-005) */
export type BranchMode = 'xor' | 'and' | 'skip';

/** 갈래 합류 동작. 기본 continue (D-006) */
export type JoinBehavior = 'continue' | 'end';

export type WaitFor = 'approval' | 'reply' | 'time' | 'resource';

/** 로그 스케일 버킷 (PRD §4.5) — 정밀도를 포기하고 순위 정확도를 산다 */
export type DurationBand = '1m' | '5m' | '15m' | '1h' | 'halfday' | '1d+';

export type ItemAttrs = {
  // branch
  mode?: BranchMode;
  caseLabel?: string;
  joinBehavior?: JoinBehavior;
  // hold
  waitFor?: WaitFor;
  avgWaitH?: number;
  timeoutH?: number;

  /**
   * 갈래가 선택될 상대 비중. `branch`의 **자식(갈래)** 에 붙인다.
   *
   * 없으면 형제끼리 균등 분할한다 — 그런데 그 균등 분할이 조용히 틀린 답을 만든다.
   * 실제 데이터(CS-01)에서 5갈래 중 하나가 전체의 45%인데 1/5로 계산되면
   * `leadTimeH`가 틀리고, **아무것도 그걸 알려주지 않는다.**
   *
   * 정규화는 하지 않는다. 형제 중 **하나라도** 값이 있으면 그 값들로 비례 배분하고,
   * 값이 없는 형제는 나머지를 균등하게 나눠 갖는다. 사용자가 "이건 10번 중 9번"만
   * 알고 나머지는 모를 수 있기 때문이다.
   */
  caseShare?: number;
  // task
  reworkRate?: number;
  returnToItemId?: string;
};

export type Item = {
  /** 클라이언트 발급 UUID. 위치에서 유도하지 않는다 (D-031) */
  id: string;
  parentId: string | null;
  /** base62 fractional index. 비교는 반드시 바이트 순서 (COLLATE "C") */
  sortKey: string;
  kind: NodeKind;
  title: string;
  attrs: ItemAttrs;

  // ── 집계 대상 컬럼 (ARCHITECTURE §2). graph-core에서는 전부 optional ──
  assigneeId?: string | null;
  durationBand?: DurationBand | null;
  toolIds?: readonly string[];
  freqLast7d?: number | null;
  automationLevel?: number | null;
  painFlag?: boolean;
  lastConfirmedAt?: Date | null;

  /** tombstone. CRDT 전제조건 (D-032) */
  deletedAt?: Date | null;
};

export type EdgeKind = 'explicit' | 'suppressed';

export type Edge = {
  id: string;
  /** items.id 또는 'start' / 'end' / 'join:{uuid}' / 'fork:{uuid}' */
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  label?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 파생층
 * ──────────────────────────────────────────────────────────────────────────── */

export type NodeId = string;

/** 자동 생성 노드. 저장되지 않고 결정적 ID로만 존재한다 */
export type SyntheticKind = 'start' | 'end' | 'join';

export type DerivedNodeKind = NodeKind | SyntheticKind;

/**
 * 엣지가 왜 생겼는가. **캔버스 엣지 호버 설명의 유일한 근거** (PRD §4.4).
 * 사용자에게 "이 연결은 왜 생겼나"를 답하지 못하는 엣지는 만들지 않는다.
 */
export type EdgeReason =
  /** start → 첫 단계 */
  | 'start'
  /** 마지막 단계 → end, 또는 joinBehavior:'end' 갈래의 종료 */
  | 'end'
  /** (a) 형제 단계는 순차 연결 */
  | 'sequence'
  /** 작업/기다림의 하위 항목 — 구조 복구로 이어붙인 연결 */
  | 'subtree'
  /** (b) 분기 → 갈래 첫 단계 */
  | 'branch-case'
  /** (c) 갈래 마지막 단계 → 분기의 다음 형제 */
  | 'case-join'
  /** AND 분기 → 갈래 첫 단계 (동시 시작) */
  | 'and-fork'
  /** AND 갈래 마지막 → 합류 노드 (동기화 지점) */
  | 'and-join'
  /** 합류 노드 → 다음 단계 */
  | 'join-out'
  /** skip 분기의 암묵적 "해당 없음" 경로 */
  | 'skip-else'
  /** 모든 갈래가 '여기서 끝'인데 뒤에 형제가 있을 때의 복구 연결 */
  | 'fallthrough'
  /** edges 테이블의 명시적 오버라이드 */
  | 'explicit';

export type EdgeOrigin = 'derived' | 'explicit';

export type DerivedEdge = {
  /** 파생 엣지는 결정적 ID, 명시적 엣지는 DB 행 ID */
  id: string;
  source: NodeId;
  target: NodeId;
  origin: EdgeOrigin;
  reason: EdgeReason;
  label?: string;
  /** branch-case / case-join 계열에서 이 엣지를 낳은 갈래 항목 ID */
  caseItemId?: string;
  /** DFS 기준 역방향 엣지. ELK에 넘길 때 뒤집는다 (§5) */
  isBackEdge: boolean;
};

export type DerivedNode = {
  id: NodeId;
  kind: DerivedNodeKind;
  /** 합성 노드는 null */
  itemId: string | null;
  title: string;
  synthetic: boolean;
  /** 아웃라인 pre-order 인덱스. 정규 순서와 ELK model order의 근거 */
  order: number;
  /** 아웃라인 들여쓰기 깊이 (루트 = 0) */
  depth: number;

  branchMode?: BranchMode;
  waitFor?: WaitFor;
  attrs: ItemAttrs;

  assigneeId?: string | null;
  /** 앞 단계에서 forward-fill 된 담당자. 인계 추론의 근거 (§7) */
  effectiveAssigneeId?: string | null;
  durationBand?: DurationBand | null;
  toolIds: readonly string[];
  painFlag?: boolean;
  lastConfirmedAt?: Date | null;

  /** AND 합류 노드가 동기화하는 분기 항목 ID */
  joinOf?: string;
};

/* ── 진단 ─────────────────────────────────────────────────────────────────── */

/**
 * 진단은 **오류가 아니다.**
 *  - 'repaired' : derive()가 자동 복구했다. 그림은 이미 그려져 있다
 *  - 'note'     : 관찰 사실. 아무것도 바꾸지 않았다
 *
 * severity에 'error'가 없는 것이 이 제품의 설계다 (§4).
 */
export type DiagnosticSeverity = 'repaired' | 'note';

export type DiagnosticCode =
  // 전처리
  | 'duplicate-item-id'
  | 'reserved-item-id'
  | 'orphan-parent'
  | 'parent-cycle'
  | 'duplicate-sort-key'
  // 구조
  | 'branch-without-case'
  | 'branch-single-case'
  | 'empty-case'
  | 'and-single-case'
  | 'and-case-end-ignored'
  | 'all-cases-end-with-successor'
  | 'task-with-children'
  | 'skip-without-case'
  // 오버라이드
  | 'dangling-edge'
  | 'self-loop'
  | 'suppress-noop'
  | 'explicit-duplicates-derived'
  | 'edge-into-start'
  | 'edge-out-of-end'
  | 'join-alias-unmaterialized'
  // 위상
  | 'cycle'
  | 'unreachable-node'
  | 'no-path-to-end'
  | 'rework-rate-clamped'
  // 데이터 커버리지
  | 'duration-missing'
  | 'assignee-missing'
  | 'wait-estimated';

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  itemIds?: readonly string[];
  nodeIds?: readonly NodeId[];
  edgeIds?: readonly string[];
  /** 개발자·CI·AI 검증기용. 화면에 절대 렌더링하지 않는다 */
  detail: string;
  /**
   * 엣지 호버 설명으로만 쓰이는 사용자 문구.
   * null이면 사용자에게 도달하는 경로가 **존재하지 않는다.**
   */
  userMessage: string | null;
};

/* ── 메트릭 ───────────────────────────────────────────────────────────────── */

/** 값 + 커버리지. 데이터가 없을 때 0을 지어내지 않는다 */
export type Measure = {
  value: number;
  /** 해당 값 계산에 쓰인 노드 중 실제 데이터가 있던 비율 0..1 */
  coverage: number;
};

export type CycleInfo = {
  /** 결정적 ID: `cycle:{backEdgeId}` */
  id: string;
  /** 사이클을 구성하는 노드 (진입 노드부터, back edge source에서 끝남) */
  nodes: readonly NodeId[];
  backEdgeId: string;
  /** 반려율. 없으면 null */
  reworkRate: number | null;
  /** 기대 추가 반복 횟수 = p / (1 - p) */
  expectedExtraPasses: number | null;
  /** 클램프가 적용됐는가 */
  clamped: boolean;
};

export type Handoff = {
  from: NodeId;
  to: NodeId;
  fromAssigneeId: string;
  toAssigneeId: string;
  crossDepartment: boolean;
};

export type Metrics = {
  /** 사용자가 "단계"라고 부르는 것 = 작업 + 기다림 */
  stepCount: number;
  taskCount: number;
  holdCount: number;
  branchCount: number;
  caseCount: number;
  /** 합성 노드 포함 전체 */
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;

  peopleCount: number;
  toolCount: number;

  handoffs: readonly Handoff[];
  handoffCount: number;
  crossDepartmentHandoffCount: number;
  toolSwitchCount: number;

  /** 기대 실접촉시간 (XOR 확률 반영, AND 합산, 루프 반복 반영) */
  touchH: Measure;
  /** 모든 갈래가 다 실행된다고 가정한 실접촉시간 상한 */
  touchAllPathsH: Measure;
  /** 기대 대기시간 */
  waitH: Measure;
  /** 기대 리드타임 (XOR = 확률가중, AND = max) */
  leadTimeH: Measure;
  /** 최악 리드타임 = 최장 경로 */
  criticalPathH: Measure;
  criticalPath: readonly NodeId[];
  /** waitH / leadTimeH. leadTimeH가 0이면 null */
  waitRatio: number | null;

  cycles: readonly CycleInfo[];
  cycleCount: number;

  /** 노드별 계산 중간값 — 렌즈·인스펙터·디버깅용 */
  perNode: ReadonlyMap<NodeId, NodeMetrics>;
};

export type NodeMetrics = {
  /** start로부터 이 노드에 도달할 확률 (XOR 분기 균등, AND 병렬 1.0) */
  reachProbability: number;
  /** 루프로 인한 기대 통과 횟수 (≥ 1) */
  expectedPasses: number;
  touchH: number;
  waitH: number;
  /** touchH + waitH */
  leadH: number;
  /** 이 노드에서 end까지의 기대 잔여 리드타임 */
  remainingLeadH: number;
  /** 이 노드에서 end까지의 최장 경로 */
  remainingCriticalH: number;
};

/* ── 결과 ─────────────────────────────────────────────────────────────────── */

export type DerivedGraph = {
  nodes: readonly DerivedNode[];
  edges: readonly DerivedEdge[];

  byId: ReadonlyMap<NodeId, DerivedNode>;
  outgoing: ReadonlyMap<NodeId, readonly DerivedEdge[]>;
  incoming: ReadonlyMap<NodeId, readonly DerivedEdge[]>;

  /** ELK에 넘길 DAG 정보 (§5) */
  acyclic: {
    /** back edge 제거 후 위상 정렬 순서 */
    topoOrder: readonly NodeId[];
    /** DFS 기준 역방향 엣지 ID. ELK에는 뒤집어서 넘긴다 */
    backEdgeIds: readonly string[];
  };

  metrics: Metrics;
  diagnostics: readonly Diagnostic[];

  /**
   * 위상 해시. **구조에만 의존한다** — 제목·담당자·시간은 들어가지 않는다.
   * 값이 같으면 ELK를 돌리지 않는다 (D-024, DESIGN §6.6.2).
   */
  topologyHash: string;
  /** 라벨·메타까지 포함한 해시. 캔버스 리렌더 게이트 */
  contentHash: string;
};

/* ── 옵션 ─────────────────────────────────────────────────────────────────── */

export type DeriveOptions = {
  /** 자동 생성 엣지 라벨. graph-core는 UI 문구를 소유하지 않는다 */
  labels?: {
    skipElse?: string;
    fallthrough?: string;
  };
  /** assigneeId → 부서. 없으면 crossDepartmentHandoffCount = 0 */
  directory?: Readonly<Record<string, { deptId?: string | null }>>;
  /** 소요시간 버킷 → 시간 */
  bands?: Partial<Record<DurationBand, number>>;
  /** waitFor별 기본 대기시간 (avgWaitH 미입력 시) */
  defaultWaitH?: Partial<Record<WaitFor, number>>;
  /** reworkRate 상한. 기본 0.95 → 기대 추가 반복 19회 */
  maxReworkRate?: number;
  /** 보고할 사이클 최대 개수 */
  maxCycles?: number;
};

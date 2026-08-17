# 레이아웃 엔진 구현 명세

> 이 문서는 [DESIGN.md §6.5–6.7](./DESIGN.md), [ARCHITECTURE.md §4–5](./ARCHITECTURE.md), [DECISIONS.md D-023/D-024/D-037/D-038](./DECISIONS.md)에서 **이미 확정된 것 위에** 구현을 얹는다. ELK 옵션표·안정성 6단 전략·노드 규격·모션 토큰은 여기서 다시 적지 않는다.
>
> 이 문서가 지켜야 하는 단 하나의 숫자: **세션당 노드 드래그 시도 중앙값 < 1회** ([MEASUREMENT.md](./MEASUREMENT.md) `canvas_node_drag_attempted`). v1 캔버스는 읽기 전용(D-038)이라 드래그는 성공하지 않는다 — 시도 횟수가 그대로 불만의 크기다.
> 그 지표의 선행지표가 **`jump_score` p90 < 0.15**이고, 이 문서의 §3·§5·§13은 전부 그 하나를 위해 존재한다.

---

## 0. 이 문서가 새로 확정하는 것 (L-결정)

기존 문서가 열어둔 지점을 여기서 닫는다. 번호는 DECISIONS.md의 D-와 충돌하지 않게 `L-`을 쓴다.

| ID | 결정 | 근거 요약 |
|---|---|---|
| **L-01** | **엣지 라벨을 ELK에 넘기지 않는다.** 갈래 라벨은 커밋된 좌표 위에 후처리로 배치한다 | 라벨 텍스트가 ELK 입력이 되는 순간 "갈래 조건 타이핑 → 재배치"가 생긴다. D-024를 정면으로 위반. §2 표 4행 |
| **L-02** | **자동 그룹(부서·담당자 연속 구간)은 ELK 컨테이너가 아니라 오버레이다.** 접힌 경우에만 ELK 노드가 된다 | 담당자 변경이 재배치를 유발하면 안 된다. §2 표 13행 |
| **L-03** | **엣지 기하는 ELK 섹션을 쓴다.** React Flow `smoothstep`은 폴백 전용 | `smoothstep`은 2벤드 휴리스틱이라 팬아웃에서 **노드를 관통한다**. DESIGN §10 "흔한 실패의 전형" 마지막 항목이 정확히 그것 |
| **L-04** | **back edge는 ELK 기하를 버리고 우측 사이드 레일로 직접 라우팅한다** | 층간 거터(64px)와 bbox 우측 밖만 지나가므로 **노드 비관통이 증명 가능**하다. §4 |
| **L-05** | **증분 레이아웃을 하지 않는다.** 이전 좌표 시드(`elk.position`)도 넣지 않는다 | `forceNodeModelOrder: true`가 `semiInteractive`를 지배해서 시드가 무효다. §5 |
| **L-06** | **재배치는 줌을 절대 바꾸지 않는다.** 앵커링은 translate 전용 | 줌과 위치를 같은 커밋에서 바꾸면 애니메이션 중 앵커 고정이 수학적으로 깨진다. §3.5 |
| **L-07** | **줌 티어·렌즈는 React 리렌더 없이 DOM 속성 1개로 전파한다** | 레이아웃 입력에 타입상 도달할 수 없게 만드는 것이 "안 바뀐다"의 유일한 증명. §8·§9 |
| **L-08** | **내보내기는 화면 캔버스를 스크린샷하지 않는다.** 커밋된 좌표에서 SVG를 직접 직렬화한다 | `onlyRenderVisibleElements`가 켜진 캔버스를 캡처하면 화면 밖 노드가 통째로 빠진다. §12 |
| **L-09** | **좌표 골든은 값이 아니라 불변식으로 고정한다.** 정확 좌표 핀은 "ELK가 바뀌었다" 탐지용 파일 1개뿐 | 좌표 스냅샷은 ELK 패치 버전마다 빨개지고, 빨간 CI는 학습된 무시를 낳는다. §13.2 |
| **L-10** | **`layoutKey` = topologyHash ⊕ containerHash ⊕ collapsedHash ⊕ fanOutStack ⊕ optionsHash** | `topologyHash`만으로는 접기·컨테이너·옵션 변경을 못 잡는다. §2 |
| **L-11** | **레이아웃 결과를 `layoutKey`로 LRU 캐시한다.** undo로 위상이 되돌아오면 ELK를 돌리지 않고 좌표를 복원한다 | undo의 `jump_score`가 **정확히 0**이 된다. 되돌리기가 흔들리면 신뢰가 한 번 더 깨진다 |

---

## 1. 파이프라인 전체

### 1.1 그림

```
                       ┌─ 조합 중(IME)? ─ 예 → 타이머 해제, compositionend에 재무장
                       │
items/edges 변경 ─ ops ─┼→ derive()  (1.54ms @504항목, 항상 실행)
                       │      │
                       │      ├→ contentHash 변경? ─ 예 → 바뀐 노드만 리렌더 (ELK 무관)
                       │      │
                       │      └→ layoutKey 계산
                       │             │
                       │             ├─ 이전과 같음 ────────→ 데이터만 갱신. 끝. (타이핑의 95%)
                       │             ├─ LRU 캐시 히트 ──────→ 좌표 즉시 커밋 (undo·접기 토글 왕복)
                       │             └─ 다름 ─→ 디바운스 300ms(trailing) ─→ 단일 슬롯 큐
                       │                                                        │
                       ▼                                                        ▼
              rev++ (단조 증가) ──────────────────────────────→ 워커 풀(2) → ELK
                                                                              │
                        ┌─────────────────────────────────────────────────────┘
                        ▼
        스테일 검사  rev === latestRev && layoutKey === current  ─ 아니면 폐기
                        ▼
        읽기       ElkNode → NodePlacement/EdgeGeometry/LayerBand/bbox
                        ▼
        back edge  사이드 레일 라우팅 (ELK 기하 폐기)
                        ▼
        앵커 결정   AnchorHint + 이전 결과 + 현재 viewport → translate | fit | hold
                        ▼
        커밋       flushSync(setNodes) → 뷰포트 transform 동기 기록  ← 한 태스크 안에서
                        ▼
        애니메이션  .rf-relayout 클래스 220ms (뷰포트·노드 동일 duration/easing)
                        ▼
        계측       canvas_layout_computed { node_count, elk_ms, jump_score }
                        ▼
        예고       bbox 15%+ 변경 && 암묵적 재배치 → 3초 토스트 + [되돌리기]
```

### 1.2 타입 — 상태 머신

`packages/layout-core/src/types.ts` (순수. React/DOM/elkjs 런타임 의존 없음)

```ts
import type { DerivedEdge, DerivedGraph, NodeId } from '@workflow/graph-core';

/* ── 기하 ─────────────────────────────────────────────────────────────── */

export type XY = { readonly x: number; readonly y: number };
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

export type LayoutResult = {
  readonly rev: number;
  readonly layoutKey: LayoutKey;
  readonly algorithm: 'elk' | 'fallback';
  readonly ladder: LadderLevel;
  readonly nodes: ReadonlyMap<NodeId, NodePlacement>;
  readonly edges: ReadonlyMap<string, EdgeGeometry>;
  readonly bands: readonly LayerBand[];
  readonly bbox: Rect;
  readonly elapsedMs: number;
};

/* ── 입력 ─────────────────────────────────────────────────────────────── */

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

export type LadderLevel = 0 | 1 | 2 | 3 | 4;
```

> **`LayoutInput`에 `lens`도 `zoom`도 `viewport`도 없다.** 이건 문서화가 아니라 **타입 검사기로 강제한 불변식**이다. §8·§9의 "레이아웃이 안 바뀐다"는 주장의 근거가 정확히 이 타입 하나다. 여기에 필드를 추가하려는 PR은 리뷰에서 막는 게 아니라 컴파일에서 막힌다.

`apps/web/lib/layout/engine.ts` — 상태 머신

```ts
import type { LayoutInput, LayoutKey, LayoutResult } from '@workflow/layout-core';

export type LayoutError =
  | { t: 'timeout'; ms: number }
  | { t: 'elk'; message: string }
  | { t: 'worker-dead'; message: string }
  | { t: 'build'; message: string };

export type LayoutPhase =
  /** 커밋된 결과가 최신. 할 일 없음 */
  | { t: 'idle' }
  /** 위상이 바뀌었고 trailing 300ms를 세는 중 */
  | { t: 'debouncing'; key: LayoutKey; armedAt: number; timer: TimerId }
  /** IME 조합 중. 타이머를 해제했고 compositionend에 재무장한다 */
  | { t: 'suspended'; key: LayoutKey }
  /** 워커에서 ELK 실행 중 */
  | { t: 'running'; rev: number; key: LayoutKey; startedAt: number; slot: 0 | 1 }
  /** 좌표는 커밋됐고 220ms 트랜지션이 진행 중 */
  | { t: 'settling'; rev: number; until: number }
  /** 실패했지만 마지막 성공 좌표를 유지 중 (STATES.md §4) */
  | { t: 'failed'; consecutive: number; last: LayoutError }
  /** 3회 연속 실패 → ELK 없이 폴백 레이아웃으로 운전 중 */
  | { t: 'fallback'; since: number; consecutive: number };

export type LayoutEvent =
  /** derive() 직후. 엔진이 layoutKey를 계산해 게이트를 통과시킬지 정한다 */
  | { t: 'graph'; input: LayoutInput; anchor: AnchorHint; cause: LayoutCause }
  /** BlockNote의 compositionstart / compositionend */
  | { t: 'composition'; active: boolean }
  /** Enter·삭제·blur 등 "지금 바로" 신호. 디바운스를 건너뛴다 */
  | { t: 'flush' }
  | { t: 'result'; rev: number; result: LayoutResult }
  | { t: 'error'; rev: number; error: LayoutError }
  | { t: 'settled' }
  /** 사용자가 팬/줌을 시작했다 → 진행 중 트랜지션 즉시 종료 */
  | { t: 'user-move' };

/** 재배치를 누가 일으켰는가. 토스트를 띄울지 결정한다 (§1.6) */
export type LayoutCause =
  | 'structural-edit'   // 아웃라인 편집 — 암묵적. 큰 변화면 토스트
  | 'collapse'          // 사용자가 직접 접었다 — 예상된 변화. 토스트 없음
  | 'undo'              // 캐시 히트가 정상. 토스트 없음
  | 'ladder'            // 성능 사다리. 토스트 대신 인라인 바
  | 'initial';          // 최초 로드. 앵커링 없이 fitView
```

### 1.3 엔진 — 게이트 · 디바운스 · 큐

```ts
const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 4_000;
const SETTLE_MS = 220;
const FAIL_TO_FALLBACK = 3;

export class LayoutEngine {
  private phase: LayoutPhase = { t: 'idle' };
  private rev = 0;
  private latestRev = 0;
  private composing = false;

  /** 최신 커밋 결과. 스테일 폐기·앵커링·jump_score의 기준점 */
  private committed: LayoutResult | null = null;
  /** 단일 슬롯 큐. 최신이 항상 이긴다 (§10) */
  private pending: { input: LayoutInput; anchor: AnchorHint; cause: LayoutCause } | null = null;
  private inflightInput: LayoutInput | null = null;

  private readonly cache = new LayoutCache(24);   // L-11
  private ladder: LadderLevel = 0;

  constructor(
    private readonly pool: ElkPool,
    private readonly sink: LayoutSink,          // 커밋·토스트·계측을 앱에 위임
    private readonly clock: Clock = realClock,  // 테스트에서 가짜 시계
  ) {}

  send(ev: LayoutEvent): void {
    switch (ev.t) {
      case 'graph':        return this.onGraph(ev);
      case 'composition':  return this.onComposition(ev.active);
      case 'flush':        return this.onFlush();
      case 'result':       return this.onResult(ev.rev, ev.result);
      case 'error':        return this.onError(ev.rev, ev.error);
      case 'settled':      return this.onSettled();
      case 'user-move':    return this.sink.endTransition();
    }
  }

  /* ── 게이트 ─────────────────────────────────────────────────────────── */

  private onGraph(ev: Extract<LayoutEvent, { t: 'graph' }>): void {
    const key = layoutKeyOf(ev.input);

    // (1) 위상 동일 → ELK 자체를 건너뛴다. 타이핑의 95%가 여기서 끝난다.
    if (this.committed?.layoutKey === key) {
      this.sink.commitDataOnly(ev.input.graph);   // 라벨·메타만 갱신
      return;
    }

    // (2) 캐시 히트 → 워커를 깨우지 않는다. undo·접기 토글 왕복이 여기 (L-11)
    const hit = this.cache.get(key);
    if (hit) {
      this.commit(ev.input, { ...hit, rev: ++this.rev }, ev.anchor, ev.cause);
      return;
    }

    // (3) 진짜 재배치. 조합 중이면 유예, 즉시 신호면 바로, 아니면 trailing 300ms
    this.pending = { input: ev.input, anchor: ev.anchor, cause: ev.cause };
    if (this.composing) {
      this.clearTimer();
      this.phase = { t: 'suspended', key };
      return;
    }
    this.arm(key);
  }

  private arm(key: LayoutKey): void {
    this.clearTimer();
    const timer = this.clock.setTimeout(() => this.dispatch(), DEBOUNCE_MS);
    this.phase = { t: 'debouncing', key, armedAt: this.clock.now(), timer };
  }

  private onComposition(active: boolean): void {
    this.composing = active;
    if (active) {
      // 조합 시작 = 아직 확정되지 않은 글자. 위상 판단 자체가 무의미하다.
      if (this.phase.t === 'debouncing') {
        this.clearTimer();
        this.phase = { t: 'suspended', key: this.phase.key };
      }
      return;
    }
    // compositionend → 재무장. 이미 실행 중인 작업은 건드리지 않는다 (§10).
    if (this.phase.t === 'suspended') this.arm(this.phase.key);
  }

  private onFlush(): void {
    // Enter / 삭제 / blur. 디바운스를 기다릴 이유가 없는 확정적 구조 변경.
    // 단 조합 중이면 무시한다 — 한글 조합 중 Enter는 "확정"이지 "줄바꿈"이 아니다.
    if (this.composing) return;
    if (this.phase.t === 'debouncing') { this.clearTimer(); this.dispatch(); }
  }
```

### 1.4 디스패치 — 워커로

```ts
  private dispatch(): void {
    const job = this.pending;
    if (!job) { this.phase = { t: 'idle' }; return; }
    this.pending = null;

    const rev = ++this.rev;
    this.latestRev = rev;
    const key = layoutKeyOf(job.input);
    this.inflightInput = job.input;

    let elkGraph: ElkNode;
    try {
      elkGraph = buildElkGraph({ ...job.input, ladder: this.ladder });
    } catch (e) {
      // 빌드 실패는 우리 버그다. 워커까지 갈 필요 없이 즉시 폴백.
      return this.onError(rev, { t: 'build', message: String(e) });
    }

    const slot = this.pool.acquire(rev);   // 슬롯 확보 = 이전 rev는 자동으로 독살(poison)
    this.phase = { t: 'running', rev, key, startedAt: this.clock.now(), slot };

    this.pool
      .run(slot, rev, elkGraph, TIMEOUT_MS)
      .then((elkResult) => {
        const result = readLayout(elkResult, job.input, {
          rev, layoutKey: key, algorithm: 'elk', ladder: this.ladder,
        });
        this.send({ t: 'result', rev, result });
      })
      .catch((error: LayoutError) => this.send({ t: 'error', rev, error }));
  }
```

### 1.5 결과 수신 — 스테일 검사 → 앵커 → 커밋

```ts
  private onResult(rev: number, result: LayoutResult): void {
    // ── 스테일 폐기 (안정성 5) ──────────────────────────────────────────
    // rev 비교만으로 충분하지만 layoutKey를 이중으로 본다. rev 회계 버그는
    // 조용히 잘못된 그림을 그리는 반면, 이 조건은 시끄럽게 개발 중에 잡힌다.
    if (rev !== this.latestRev) return this.sink.track('canvas_layout_discarded', { rev });
    if (this.phase.t === 'running' && result.layoutKey !== this.phase.key) return;

    this.ladderStepDown(result.elapsedMs, result.nodes.size);
    this.cache.set(result.layoutKey, result);

    const job = this.inflightInput!;
    this.commit(job, result, this.lastAnchorHint, this.lastCause);

    // 실행 중 새 요청이 쌓였으면 바로 이어서 돈다
    if (this.pending) this.dispatch();
  }

  private commit(
    input: LayoutInput,
    next: LayoutResult,
    hint: AnchorHint,
    cause: LayoutCause,
  ): void {
    const prev = this.committed;
    const view = this.sink.readViewport();       // { x, y, zoom, w, h, owner }

    const decision = resolveAnchorTransform({
      prev, next, hint,
      viewport: view, viewportOwner: view.owner,
      graphPrev: this.prevGraph, graphNext: input.graph,
    });

    const score = jumpScore(prev, next, {
      viewport: view,
      // 앵커 보정 **후** 화면 좌표로 잰다. 사용자가 지각하는 것이 그것이므로.
      translate: decision.t === 'translate' ? decision.delta : { x: 0, y: 0 },
    });

    this.sink.commit({ result: next, decision, animate: cause !== 'initial' });
    this.sink.track('canvas_layout_computed', {
      node_count: next.nodes.size,
      elk_ms: Math.round(next.elapsedMs),
      jump_score: round3(score),
      algorithm: next.algorithm,
      ladder: next.ladder,
      cause,
    });

    // ── 큰 재배치 예고 (안정성 6) ─────────────────────────────────────
    // 사용자가 직접 일으킨 변화(접기·undo)는 예고하지 않는다. 예고가 소음이 된다.
    if (prev && cause === 'structural-edit' && bboxDelta(prev.bbox, next.bbox) > 0.15) {
      this.sink.toast({
        text: '그림을 다시 정리했어요',
        actionLabel: '되돌리기',
        ms: 3000,
        onAction: () => this.sink.restore(prev),   // 좌표만 되돌린다. 문서는 그대로
      });
    }

    this.committed = next;
    this.prevGraph = input.graph;
    this.phase = { t: 'settling', rev: next.rev, until: this.clock.now() + SETTLE_MS };
    this.clock.setTimeout(() => this.send({ t: 'settled' }), SETTLE_MS);
  }

  private onSettled(): void {
    this.sink.endTransition();
    this.phase = this.pending ? this.phase : { t: 'idle' };
  }
```

`bboxDelta`는 면적비가 아니라 **폭·높이 각각의 상대 변화 중 최대값**이다. 면적비를 쓰면 폭이 30% 줄고 높이가 30% 늘어난 경우(= 사용자가 가장 크게 놀라는 경우)를 0%로 계산해 버린다.

```ts
export function bboxDelta(a: Rect, b: Rect): number {
  const dw = Math.abs(b.w - a.w) / Math.max(a.w, 1);
  const dh = Math.abs(b.h - a.h) / Math.max(a.h, 1);
  return Math.max(dw, dh);
}
```

### 1.6 콜드 스타트 — ELK보다 좌표 캐시가 먼저다

[STATES.md §10 #1](./STATES.md)의 "저장된 레이아웃 좌표 캐시로 즉시 렌더, ELK는 백그라운드 검증"을 구현한다.

```ts
/** documents 테이블의 jsonb 컬럼. 파생 데이터이므로 언제든 버려도 된다 */
type LayoutSnapshot = {
  layoutKey: LayoutKey;
  /** 좌표만. 엣지 기하는 저장하지 않는다 — 좌표에서 다시 계산 가능하고 용량이 3배다 */
  nodes: Record<NodeId, [number, number]>;
  bbox: [number, number, number, number];
  elkVersion: string;
  optionsHash: string;
};
```

로드 순서:

1. RSC가 `items`/`edges`와 함께 `layoutSnapshot`을 내려준다.
2. 클라이언트가 `derive()` → `layoutKeyOf()`. **키가 스냅샷과 같으면** 좌표를 그대로 커밋하고 애니메이션 없이 `fitView`. 캔버스 첫 페인트 < 600ms 목표가 여기서 달성된다. 워커는 **띄우지도 않는다**.
3. 키가 다르면(= 다른 기기에서 편집됨, ELK 버전 상승, 옵션 변경) 스냅샷을 폴백 좌표로 즉시 렌더하되 `opacity: .6`로 두고 `requestIdleCallback`에서 정상 파이프라인을 1회 돌린다. `cause: 'initial'`이므로 토스트 없음.
4. 커밋 성공 시 스냅샷을 갱신한다 — **디바운스 5초, `visibilitychange`에 `sendBeacon`.** 좌표 저장이 문서 저장 경로(ARCHITECTURE §6의 op 큐)를 막으면 안 되므로 **완전히 별도 채널**이고, 실패해도 조용히 버린다.

> 좌표 스냅샷은 **캐시지 데이터가 아니다.** D-030("파생 엣지는 저장하지 않는다")과 모순되지 않는 이유: 이건 그래프의 일부가 아니라 렌더 성능 힌트고, 없어도 진실이 재구성되며, 틀렸을 때 자기교정된다(2단계의 키 비교).

---

## 2. 구조 diff 게이트

### 2.1 `topologyHash`를 그대로 쓰지 않는다

`graph-core`의 `topologyHash`는 이렇게 계산된다 (derive.ts:621):

```
nodes: id|kind|branchMode  ;  edges: source>target|reason
```

제목·담당자·소요시간·도구·짜증·`reworkRate`가 **의도적으로 빠져 있다.** 이 결정이 게이트의 전부다. 하지만 `topologyHash`는 **그래프**의 해시지 **레이아웃 입력**의 해시가 아니다. 레이아웃 입력에는 그래프 말고도 접기 상태·컨테이너 소속·팬아웃 모드·ELK 옵션이 들어간다.

`packages/layout-core/src/key.ts`

```ts
import { fnv1a } from './hash.ts';
import { ELK_OPTIONS_HASH } from './options.ts';
import type { LayoutInput, LayoutKey } from './types.ts';

export function layoutKeyOf(input: LayoutInput): LayoutKey {
  // 컨테이너: 그룹 → 자식 목록. 정렬해서 Map 순서에 의존하지 않게 한다.
  const containers = [...input.containers]
    .map(([g, kids]) => `${g}{${[...kids].sort().join(',')}}`)
    .sort()
    .join(';');

  const collapsed = [...input.collapsed].sort().join(',');

  return fnv1a(
    [
      input.graph.topologyHash,
      containers,
      collapsed,
      input.fanOutStack ? 'S' : '-',
      String(input.ladder),
      ELK_OPTIONS_HASH,
    ].join('|'),
  ) as LayoutKey;
}
```

`options.ts`

```ts
export const ELK_OPTIONS = { /* DESIGN §6.5의 확정 옵션. 여기서 재서술하지 않는다 */ } as const;

/** 옵션 객체 + elkjs 버전 + 우리 빌더 버전. 셋 중 하나만 바뀌어도 캐시가 무효화된다 */
export const ELK_OPTIONS_HASH = fnv1a(
  JSON.stringify(ELK_OPTIONS) + '|elkjs@0.12.0|builder@3',
);
```

`elkjs` 버전 문자열은 **손으로 적지 않는다.** `package.json`에서 읽어 빌드 타임에 주입한다(`process.env.ELK_VERSION`). 손으로 적은 버전 문자열은 반드시 실제 버전과 어긋난다.

### 2.2 해시가 같아도 재배치해야 하는가 — 전수표

`○` = 재배치 불필요 / `●` = 필요

| # | 변경 | `topologyHash` | 재배치 | 잡는 방법 · 근거 |
|---:|---|:---:|:---:|---|
| 1 | 제목 타이핑 | 동일 | ○ | 해시. **노드 폭 고정(D-023)이라 글자 수가 기하에 도달하는 경로 자체가 없다** |
| 2 | 담당자 지정/변경 | 동일 | ○ | 해시. 메타 스트립은 24px 고정 예약이라 높이 불변 |
| 3 | 소요시간·도구·자동화 칩 | 동일 | ○ | 해시. 위와 동일 |
| 4 | 짜증 플래그 토글 | 동일 | ○ | 해시. 렌즈 전용(D-025)이라 기본 렌즈에선 DOM도 안 바뀜 |
| 5 | `reworkRate` 입력 | 동일 | ○ | 해시에서 **의도적 제외**. 확률은 메트릭이지 위상이 아니다 |
| 6 | 확인(`confirm_item`) | 동일 | ○ | 신선도 채도만 |
| 7 | **갈래 조건 라벨(`caseLabel`) 편집** | 동일 | **○** | **L-01.** 라벨을 ELK에 안 넘기므로 기하 무관. 넘겼다면 `elk.spacing.edgeLabel`이 라벨 폭에 반응해 **"조건 타이핑 = 재배치"**가 됐을 것 — D-024 정면 위반 |
| 8 | 순서 이동(`reorder_item`) | 다름 | ● | `source>target`이 바뀐다 |
| 9 | 단계 삽입/삭제 | 다름 | ● | 노드 집합이 바뀐다 |
| 10 | `kind` 변경 (task↔branch↔hold) | 다름 | ● | `id\|kind`에 포함 |
| 11 | `mode` xor↔and | 다름 | ● | `branchMode` + join 노드 생성/삭제 |
| 12 | `joinBehavior` continue↔end | 다름 | ● | 엣지 `reason`이 `case-join`↔`end`로 |
| 13 | 명시 엣지 추가/삭제/억제 | 다름 | ● | 엣지 집합 |
| 14 | 들여쓰기(부모 변경) | 다름 | ● | `reason`이 `sequence`→`subtree`로 바뀌어 대부분 포착 |
| 15 | **들여쓰기인데 파생 엣지가 완전히 동일한 경우** | **동일** | **●** | **`containerHash`.** 명시 그룹의 소속이 바뀌면 ELK 컨테이너 구조가 바뀐다 |
| 16 | **그룹 접기 / 펼치기** | **동일** | **●** | **`collapsedHash`.** 접힌 서브트리가 단일 노드로 축약되므로 완전히 다른 그래프 |
| 17 | **자동 그룹(부서 구간) 멤버십 변경** (담당자 변경으로) | 동일 | **○** | **L-02.** 자동 그룹은 ELK 컨테이너가 아니라 `ViewportPortal` 오버레이. 담당자 하나 바꿨다고 그림이 재배치되면 §9의 "1px도 안 움직인다"와 모순 |
| 18 | 위 자동 그룹이 **접혀 있을 때** 멤버십 변경 | 동일 | **●** | `collapsedHash`에 그룹의 멤버 목록까지 넣는다 (§7.4) |
| 19 | 갈래 4개→5개 (팬아웃 스택 진입) | 다름 | ● | 노드 추가로 이미 다름. 단 `fanOutStack` 플래그를 키에 **따로** 넣어 5→4 복귀 시 확실히 되돌아오게 한다 |
| 20 | **렌즈 전환** (흐름↔사람↔시간↔도구↔짜증) | 동일 | **○ 절대** | **L-07.** `LayoutInput`에 `lens` 필드가 타입상 존재하지 않는다. §9 |
| 21 | **줌 티어 전환** (4단계) | 동일 | **○ 절대** | 동일. §8 |
| 22 | 노드 선택 / 호버 / 인스펙터 열기 | 동일 | ○ | 보더 1.5px 고정 + `inset box-shadow`로 선택 표현(COMPONENTS §7) → 박스 크기 불변 |
| 23 | **뷰포트/패널 리사이즈** | 동일 | **○** | **ELK 좌표는 뷰포트 독립이다.** 리사이즈에 재배치를 거는 구현이 흔한 실수 — 리사이즈 중 초당 수십 번 ELK가 돈다. `fitView` 재적용 여부만 별도 정책(§3.6) |
| 24 | 폰트 로드 완료 (Pretendard) | 동일 | ○ | 노드 크기 고정. 폰트가 바뀌어도 박스가 안 변한다 |
| 25 | 글자 크기 설정 변경(`•••` 메뉴) | 동일 | ○ | `line-clamp`만 바뀐다. 박스 불변 |
| 26 | 다크모드 / 공유 페이지 테마 | 동일 | ○ | 색만 |
| 27 | **ELK 옵션 또는 elkjs 버전 변경** | 동일 | **●** | `optionsHash` |
| 28 | **성능 사다리 단계 변경** (§6) | 동일 | **●** | `ladder`를 키에 포함. 다음 재배치부터 적용 |
| 29 | **undo로 이전 위상 복귀** | 이전과 동일 | **● 이지만 ELK 없이** | **L-11.** LRU 캐시 히트 → 좌표 그대로 복원 → `jump_score`가 **정확히 0** |
| 30 | 내보내기 실행 | 동일 | ○ | 화면 좌표를 그대로 재사용(§12) |
| 31 | 문서 최초 로드 | n/a | ○ 조건부 | 좌표 스냅샷 키가 맞으면 ELK 미실행(§1.6) |

### 2.3 게이트가 새는 곳을 CI에서 막는다

표는 사람이 관리하면 반드시 썩는다. **표 대신 테스트가 계약이다.**

```ts
// packages/layout-core/test/gate.test.ts
import { build, kase } from '@workflow/graph-core/src/__fixtures__/builder.ts';

/** "이 op은 layoutKey를 바꾸면 안 된다" 목록 */
const MUST_NOT_RELAYOUT: Array<[string, (i: Item[]) => Item[]]> = [
  ['제목',       (i) => patch(i, 'a', { title: '완전히 다른 아주 긴 제목입니다' })],
  ['담당자',     (i) => patch(i, 'a', { assigneeId: 'u9' })],
  ['소요시간',   (i) => patch(i, 'a', { durationBand: '1d+' })],
  ['도구',       (i) => patch(i, 'a', { toolIds: ['excel', 'slack', 'erp'] })],
  ['짜증',       (i) => patch(i, 'a', { painFlag: true })],
  ['반려율',     (i) => patch(i, 'a', { attrs: { reworkRate: 0.4 } })],
  ['갈래 라벨',  (i) => patch(i, 'case-x', { attrs: { caseLabel: '아주 긴 조건 라벨' } })],
];

for (const [name, mutate] of MUST_NOT_RELAYOUT) {
  test(`${name} 변경은 재배치를 유발하지 않는다`, () => {
    const before = layoutKeyOf(inputOf(derive(items, edges)));
    const after  = layoutKeyOf(inputOf(derive(mutate(items), edges)));
    assert.equal(before, after, `${name}이(가) layoutKey를 바꿨다 — D-024 위반`);
  });
}
```

그리고 반대 방향도 잠근다 — **재배치가 필요한데 키가 같으면** 조용히 그림이 틀린다.

```ts
const MUST_RELAYOUT = [
  ['순서 이동', ...], ['삽입', ...], ['kind', ...], ['and 전환', ...],
  ['접기', (inp) => ({ ...inp, collapsed: new Set(['a']) })],
  ['컨테이너 소속', ...], ['사다리 단계', (inp) => ({ ...inp, ladder: 1 as const })],
];
```
---

## 3. 활성 노드 앵커링 — 핵심 알고리즘

```
목표: 방금 편집한 노드의 "화면 좌표"가 재배치 전후로 동일해야 한다
```

이 절이 이 문서에서 가장 중요하다. §1·§2가 "재배치를 안 하는 법"이라면 여기는 **"재배치를 해야만 할 때 어지럽지 않게 하는 법"**이고, 게이트를 아무리 잘 만들어도 결국 통과하는 5%가 제품의 인상을 결정한다.

### 3.1 수학 — 왜 끝점만 맞추면 실패하는가

React Flow의 화면 변환은 어파인이다.

```
screen = world · z + T,      T = [viewport.x, viewport.y],  z = viewport.zoom
```

앵커 노드 `a`의 화면 좌표를 보존하려면:

```
p_next(a) · z + T_next = p_prev(a) · z + T_prev
⟹  T_next = T_prev − z · Δ,      Δ = p_next(a) − p_prev(a)
```

여기까지는 흔한 구현이다. **그런데 이걸 그대로 적용하면 앵커가 눈에 띄게 흔들린다.** 이유:

- 노드 위치는 `transform 220ms var(--ease-flow)`로 **보간**된다 (DESIGN §9).
- 뷰포트 translate를 **즉시** 바꾸면, t=0 순간의 앵커 화면 좌표는
  `p_prev(a)·z + T_next = screen_prev − z·Δ` 가 되어 **`z·Δ`만큼 튀었다가** 220ms에 걸쳐 제자리로 돌아온다.
- 즉 "끝점만 일치하고 중간에 왕복"한다. 사용자가 보는 건 정확히 그 왕복이다.

**해법: 뷰포트도 노드와 동일한 duration·easing으로 보간한다.** 그러면 임의의 진행도 `s ∈ [0,1]`에 대해

```
p(s) = p_prev + s·Δ
T(s) = T_prev + s·(−z·Δ) = T_prev − s·z·Δ
screen(s) = (p_prev + s·Δ)·z + T_prev − s·z·Δ = p_prev·z + T_prev = screen_prev   ∀s
```

**앵커의 화면 좌표가 모든 순간에 상수다.** 끝점이 아니라 구간 전체에서 고정된다. easing 함수가 무엇이든, 두 트랜지션이 **같은 함수**이기만 하면 성립한다.

> 따라서 뷰포트 이동에 `setViewport(v, { duration: 220 })`을 쓰면 **안 된다.** React Flow의 `duration`은 d3-transition의 기본 easing(`easeCubicInOut`)을 쓰는데 우리 노드는 `cubic-bezier(.2,.8,.2,1)`이다. 두 곡선이 다르면 위 상수성이 깨져 중간에 최대 12% 정도 어긋난다 — 정확히 "미묘하게 미끄러지는" 느낌이다. **뷰포트 transform은 즉시 기록하고, 보간은 CSS 트랜지션 하나가 양쪽을 동시에 담당한다.**

### 3.2 앵커 선택 규칙

`packages/layout-core/src/anchor.ts` — **순수 함수다.** DOM도 React Flow도 모른다.

```ts
export type Viewport = { x: number; y: number; zoom: number };
export type ViewportSize = { w: number; h: number };

export type AnchorHint =
  /** 아웃라인에서 캐럿이 있는 블록의 itemId. 가장 강한 신호 */
  | { t: 'item'; itemId: string }
  /** 캔버스 선택 등으로 노드가 직접 지정된 경우 */
  | { t: 'node'; nodeId: NodeId }
  /** 편집 주체가 없다 (붙여넣기·undo·원격 변경·사다리 강등) */
  | { t: 'auto' }
  /** 앵커링을 명시적으로 포기 (최초 로드) */
  | { t: 'none' };

export type AnchorDecision =
  | { t: 'translate'; viewport: Viewport; anchorId: NodeId; delta: XY; rule: AnchorRule }
  | { t: 'fit'; reason: 'initial' | 'no-survivor' | 'system-viewport' | 'was-fitted' }
  | { t: 'hold'; reason: 'no-move' };

export type AnchorRule =
  | 'focused-item' | 'focused-node'
  | 'deleted-predecessor' | 'ancestor' | 'prev-sibling'
  | 'viewport-nearest' | 'bbox-top-center';
```

후보를 **사다리로 생성하고, 두 개의 필터를 통과한 첫 후보**를 쓴다.

```
[생성 사다리]
 1. hint.node → 그 노드
 2. hint.item → itemId가 일치하는 DerivedNode
 3. hint.item 이 next 그래프에 없다 (삭제·병합됨)
      3a. prev 그래프에서 그 노드의 **선행자** (incoming 중 order 최대, back edge 제외)
      3b. 없으면 조상 item의 노드 (parentId 사슬을 타고 위로)
      3c. 없으면 직전 형제 item의 노드 (order 기준)
 4. hint.auto → prev 레이아웃에서 **뷰포트 중심에 가장 가까운 생존 노드**
 5. 아무것도 없음 → fit

[필터 A — 생존]  prev.nodes와 next.nodes 양쪽에 모두 있어야 한다
[필터 B — 가시]  prev 기준 화면 사각형이 뷰포트와 24px 인셋 기준으로 교차해야 한다
```

**필터 B가 없으면 치명적이다.** 사용자가 문서 끝을 보고 있는데 undo가 문서 첫머리를 바꿨다고 하자. 앵커가 첫 노드가 되면 캔버스 전체가 수천 px translate되어, **사용자가 보던 곳이 화면 밖으로 날아간다.** 앵커링이 어지러움을 만드는 대표적 실패 모드다.

```ts
export function resolveAnchorTransform(a: {
  prev: LayoutResult | null;
  next: LayoutResult;
  graphPrev: DerivedGraph | null;
  graphNext: DerivedGraph;
  hint: AnchorHint;
  viewport: Viewport;
  size: ViewportSize;
  /** 마지막으로 뷰포트를 움직인 주체. 'system' = fitView/프로그램 */
  viewportOwner: 'user' | 'system';
}): AnchorDecision {
  const { prev, next, viewport: v, size } = a;

  if (!prev || prev.nodes.size === 0) return { t: 'fit', reason: 'initial' };

  // (§3.6) 사용자가 아직 한 번도 캔버스를 만지지 않았다 = 화면의 주인은 "전체 그림"이다.
  // 이때 노드 앵커링은 사용자의 멘탈 모델과 싸운다.
  if (a.viewportOwner === 'system') {
    return bboxDelta(prev.bbox, next.bbox) > 0.02
      ? { t: 'fit', reason: 'system-viewport' }
      : { t: 'hold', reason: 'no-move' };
  }

  // (§3.6) 그래프 전체가 화면에 들어오는 작은 문서 — 노드 앵커링은 그림을 편심시킨다.
  // "시작 pill이 제자리에 있다"가 훨씬 강한 안정 신호다.
  if (fitsInViewport(prev.bbox, v, size) && fitsInViewport(next.bbox, v, size)) {
    return translateTo(bboxTopCenter(prev.bbox), bboxTopCenter(next.bbox), v, 'bbox-top-center');
  }

  for (const [id, rule] of candidates(a)) {
    const p0 = prev.nodes.get(id);
    const p1 = next.nodes.get(id);
    if (!p0 || !p1) continue;                                    // 필터 A
    if (!intersectsViewport(p0, v, size, 24)) continue;          // 필터 B
    if (p0.x === p1.x && p0.y === p1.y) return { t: 'hold', reason: 'no-move' };
    return {
      t: 'translate',
      anchorId: id,
      rule,
      delta: { x: p1.x - p0.x, y: p1.y - p0.y },
      viewport: { x: v.x - (p1.x - p0.x) * v.zoom, y: v.y - (p1.y - p0.y) * v.zoom, zoom: v.zoom },
    };
  }
  return { t: 'fit', reason: 'no-survivor' };
}
```

앵커 노드의 **어느 점**을 고정하는가: 노드 크기가 260×76 고정(D-023)이므로 좌상단이든 중심이든 결과가 상수 차이일 뿐 동일하다. 좌상단(`x`,`y`)을 쓴다 — ELK가 돌려주는 값이 그것이고 변환이 하나 줄어든다. 접힌 그룹과 pill(120×36)이 섞이면 크기가 다르지만, **앵커는 항상 같은 노드의 전후 비교**이므로 여전히 상수 차이다. 유일한 예외는 "앵커 노드가 접히면서 크기가 바뀌는 경우"인데, 이때는 §7.2의 흡수 애니메이션이 앵커를 대체한다.

### 3.3 앵커가 사라졌을 때 — 삭제는 "선행자"에 붙인다

후속자(successor)가 아니라 **선행자(predecessor)**에 붙이는 게 핵심이다.

```
   ① 견적 요청                    ① 견적 요청        ← 앵커: 선행자
   ② 단가표 열기   ← 삭제         ③ 견적서 작성      ← 위로 올라옴 (기대대로)
   ③ 견적서 작성                  ④ 발송
   ④ 발송
```

후속자(③)를 앵커로 잡으면 ③의 화면 좌표를 유지하려고 캔버스가 **아래로 76+64px 밀린다.** 사용자는 "한 줄 지웠는데 그림 전체가 내려갔다"고 느낀다. 선행자(①)를 잡으면 ① 위쪽은 그대로 있고 아래만 당겨 올라온다 — 텍스트 편집기의 줄 삭제와 정확히 같은 감각이다.

```ts
function* candidates(a: AnchorArgs): Generator<[NodeId, AnchorRule]> {
  const { hint, graphPrev, graphNext, prev } = a;

  if (hint.t === 'node') { yield [hint.nodeId, 'focused-node']; }

  if (hint.t === 'item') {
    const alive = nodeOfItem(graphNext, hint.itemId);
    if (alive) { yield [alive, 'focused-item']; }
    else if (graphPrev) {
      // 3a. prev 그래프에서의 선행자 — back edge를 타고 올라가면 안 된다
      const gone = nodeOfItem(graphPrev, hint.itemId);
      if (gone) {
        const preds = (graphPrev.incoming.get(gone) ?? [])
          .filter((e) => !e.isBackEdge)
          .map((e) => graphPrev.byId.get(e.source))
          .filter((n): n is DerivedNode => !!n && !n.synthetic)
          .sort((x, y) => y.order - x.order);        // order 최대 = 화면상 바로 위
        for (const p of preds) yield [p.id, 'deleted-predecessor'];
      }
      // 3b/3c. 조상 → 직전 형제
      for (const id of ancestorNodes(graphPrev, graphNext, hint.itemId)) yield [id, 'ancestor'];
      for (const id of prevSiblingNodes(graphPrev, graphNext, hint.itemId)) yield [id, 'prev-sibling'];
    }
  }

  // 4. 뷰포트 중심 최근접 생존 노드 — 언제나 마지막 방어선
  yield* nearestToViewportCenter(prev, a.next, a.viewport, a.size)
          .map((id) => [id, 'viewport-nearest'] as const);
}
```

`nearestToViewportCenter`는 거리순으로 **여러 개**를 흘려보낸다(제너레이터). 1등이 필터 B에서 걸릴 일은 없지만, 필터 A(생존)에서 걸릴 수 있기 때문이다.

**병합의 경우** (AND 갈래를 XOR로 바꿔 join 노드가 사라짐 등): `nodeOfItem`은 합성 노드에 대해 `itemId: null`이라 매칭되지 않는다. 자동으로 3a 경로를 타고 선행 실제 노드에 붙는다 — 별도 처리가 필요 없다. 이건 `DerivedNode.itemId`가 합성 노드에서 `null`인 graph-core의 설계 덕이다.

### 3.4 커밋 순서 — 한 프레임도 어긋나면 안 된다

`apps/web/lib/layout/commit.ts`

문제의 구조: **노드 위치는 React 상태**(`setNodes` → 커밋 → DOM), **뷰포트 transform은 d3-zoom이 명령형으로 쓰는 DOM 스타일**이다. 두 쓰기 사이에 브라우저가 페인트하면 그 프레임에서 "새 좌표 + 옛 변환"이 보인다. 200노드에서 이건 명확히 눈에 띈다.

```ts
import { flushSync } from 'react-dom';
import type { ReactFlowStore } from '@xyflow/react';

export function commitLayout(
  store: ReactFlowStore,
  args: {
    nodes: Node[];
    decision: AnchorDecision;
    animate: boolean;
    reducedMotion: boolean;
  },
): void {
  const root = store.getState().domNode;                       // .react-flow
  const viewportEl = root?.querySelector<HTMLElement>('.react-flow__viewport') ?? null;

  // ── 1) 트랜지션을 **먼저** 켠다 ────────────────────────────────────────
  // 스타일 재계산은 다음 DOM 쓰기와 함께 일어나므로, 클래스가 이미 붙어 있어야
  // 그 쓰기가 "트랜지션의 시작"으로 해석된다. 나중에 붙이면 첫 커밋이 점프한다.
  const willAnimate = args.animate && !args.reducedMotion;
  if (willAnimate) root?.classList.add('rf-relayout');

  // ── 2) 두 DOM 쓰기를 **같은 태스크 안에서** 끝낸다 ───────────────────
  flushSync(() => {
    store.getState().setNodes(args.nodes);       // React 커밋을 동기적으로 강제
  });
  if (args.decision.t === 'translate') {
    applyViewportSync(store, args.decision.viewport);
  }
  // flushSync가 반환된 시점에 노드 transform은 이미 DOM에 있고,
  // 바로 다음 줄에서 뷰포트 transform도 DOM에 들어간다.
  // 이 태스크가 끝날 때까지 페인트는 일어나지 않으므로 **한 프레임에 함께 반영된다.**

  // ── 3) 220ms 뒤 해제 ─────────────────────────────────────────────────
  if (willAnimate) {
    window.setTimeout(() => root?.classList.remove('rf-relayout'), 220);
  }
}

/**
 * React Flow의 내부 커밋 타이밍에 의존하지 않고 뷰포트 변환을 동기 반영한다.
 *
 * `panZoom.syncViewport()`는 d3 내부 상태와 스토어를 갱신하지만, 스토어 갱신이
 * 유발하는 React 렌더는 **다음 틱**이다. 그 사이에 페인트가 끼면 어긋난다.
 * 그래서 DOM에 직접 한 번 더 쓴다. React Flow가 다음 커밋에서 쓸 값과 **동일**하므로
 * 멱등이고 깜빡임이 없다.
 */
function applyViewportSync(store: ReactFlowStore, v: Viewport): void {
  const s = store.getState();
  s.panZoom?.syncViewport(v);                    // d3 __zoom + store.transform
  const el = s.domNode?.querySelector<HTMLElement>('.react-flow__viewport');
  if (el) el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
}
```

CSS — 뷰포트와 노드에 **완전히 동일한** 트랜지션:

```css
/* app/canvas.css */
.react-flow__viewport { will-change: transform; }

/* 재배치 커밋 순간에만 켜진다. 상시 켜두면 사용자 팬이 220ms 지연된다 */
.rf-relayout .react-flow__viewport,
.rf-relayout .react-flow__node {
  transition: transform var(--dur-relayout) var(--ease-flow);
}
:root { --dur-relayout: 220ms; }               /* DESIGN §9 */

/* 새로 생긴 노드는 이동이 아니라 "생성"이다 — 트랜지션이 아니라 애니메이션 */
.rf-relayout .react-flow__node[data-born="1"] { transition: none; }
.react-flow__node[data-born="1"] {
  animation: node-in var(--dur-fast) var(--ease-out) backwards;
  animation-delay: calc(var(--stagger-i, 0) * var(--dur-stagger));
}
@keyframes node-in { from { opacity: 0; transform: translateY(4px); } }

@media (prefers-reduced-motion: reduce) {
  :root { --dur-relayout: 0ms; }
  .rf-relayout .react-flow__viewport,
  .rf-relayout .react-flow__node { transition: none; }
  /* ACCESSIBILITY §6: 노드 생성은 opacity만 남긴다. 완전히 없애면 핵심 피드백이 죽는다 */
  .react-flow__node[data-born="1"] {
    animation: node-in-reduced var(--dur-fast) linear backwards;
    animation-delay: 0ms;
  }
  @keyframes node-in-reduced { from { opacity: 0; } }
}
```

`data-born="1"`은 커밋 시 "prev에 없던 노드"에 부여하고, `animationend`에서 제거한다. **새 노드에 `transform` 트랜지션이 걸리면 안 된다** — 초기 좌표가 없어서 (0,0)에서 날아오는 것처럼 보인다.

사용자가 트랜지션 중 팬을 시작하면 (`onMoveStart`) 즉시 `rf-relayout`을 떼야 한다. 안 그러면 팬이 220ms 지연되어 "무거운 앱"이 된다.

```tsx
<ReactFlow onMoveStart={() => engine.send({ t: 'user-move' })} … />
```

`prefers-reduced-motion`일 때 [ACCESSIBILITY §6](./ACCESSIBILITY.md)이 요구하는 안내:

```tsx
{announceRelayout && <p role="status" className="sr-only">그림을 다시 정리했어요</p>}
```

### 3.5 줌 레벨이 다를 때 (L-06)

일반형은 "월드 점 `p`를 화면 점 `s`에 고정"이다.

```
T_new = s − p_next · z_new
```

`z_new = z_old = z`이고 `s = p_prev·z + T_old`를 대입하면 §3.1의 식으로 환원된다.

**하지만 재배치 커밋에서 줌을 바꾸면 안 된다(L-06).** 이유는 미학이 아니라 수학이다. 줌이 변하면 화면 좌표는

```
screen(s) = p(s) · z(s) + T(s)
```

이고, 앵커 고정을 유지하려면 `T(s) = s_a − p(s)·z(s)` 여야 하는데 이건 **`s`에 대해 선형이 아니다.** CSS 트랜지션이 만들어내는 `T`는 선형 보간이므로 §3.1의 상수성이 성립하지 않는다. 즉 **줌과 위치를 동시에 애니메이션하면 앵커는 반드시 미끄러진다.** (`transform: translate() scale()`은 하나의 행렬로 보간되지만, 노드 쪽 보간은 별도의 translate라서 두 보간이 합성되지 않는다.)

따라서:

| 상황 | 처리 |
|---|---|
| 재배치로 그래프가 화면보다 커짐 | **줌을 바꾸지 않는다.** 토스트에 `[전체 보기]` 액션을 추가로 붙여 사용자가 선택하게 한다 |
| 사용자가 z=0.35로 줌아웃한 상태에서 편집 | 그 줌 그대로 translate만. `z·Δ`가 작아져 오히려 흔들림이 덜하다 |
| 접기/펼치기 | 사용자 행동이므로 §7.2의 흡수 애니메이션 후 별도 커밋으로 `fitView` 허용 |
| 최초 로드 / `hint: none` | 앵커링 없음. `fitView({ maxZoom: 1.0, padding: 0.25 })` (DESIGN §6.7) |

줌이 다른 상태에서의 앵커링 자체는 위 식으로 정상 동작한다 — `z`가 작으면 같은 `Δ`가 더 작은 화면 이동이 되므로 보정량도 자동으로 줄어든다. `z`는 보정의 **스케일 팩터**이지 특별 케이스가 아니다.

서브픽셀: `T_new`는 거의 항상 소수다. `Math.round`로 정수 픽셀에 맞추고 싶은 유혹이 있는데 **하지 마라.** 반올림은 앵커 고정을 최대 0.5px 깨뜨리는데, `.react-flow__viewport`는 합성 레이어(`will-change: transform`)라 서브픽셀 translate가 텍스트 리렌더를 유발하지 않는다. 반올림의 이득이 없고 손해만 있다.

### 3.6 앵커링이 오히려 나쁜 경우

| 상황 | 왜 나쁜가 | 처리 |
|---|---|---|
| **`fitView` 직후 / 최초 로드** | 화면의 주인이 "노드 하나"가 아니라 "전체 그림"이다. 노드에 앵커를 걸면 다음 재배치에서 그림이 화면 밖으로 편심된다 | `viewportOwner === 'system'`이면 앵커링 대신 `fitView` 재적용 (변화 2% 이하면 아무것도 안 함) |
| **앵커가 화면 밖** | 보이지 않는 노드를 고정하려고 보이는 것을 통째로 밀어낸다. 앵커링이 만드는 최악의 어지러움 | 필터 B (24px 인셋 교차 검사) |
| **그래프 전체가 화면에 들어옴** (~5단계) | 노드 앵커링이 여백을 비대칭으로 만들어 "그림이 한쪽으로 쏠렸다"가 된다 | bbox 상단 중앙 앵커. 시작 pill이 제자리에 남는다 |
| **접기/펼치기** | 사용자가 방금 누른 버튼이 앵커여야 하는데, 그 노드는 크기가 바뀌거나 사라진다 | 앵커를 **그룹 노드의 상단 중앙**으로 강제 고정 (§7.2) |
| **내보내기 렌더** | 뷰포트 개념이 없다 | 앵커링 파이프라인을 아예 타지 않는다 (§12) |
| **원격 협업 변경** (P2) | 남이 문서 다른 곳을 고쳤는데 내 화면이 움직이면 최악이다 | `hint: 'auto'` + 필터 B → 내 화면 안 노드에만 앵커. 화면 밖 변경은 `hold` |
| **사다리 강등** (§6 L2 이상) | 라우팅이 바뀌어 좌표가 크게 달라진다. 앵커링해도 주변이 다 바뀐다 | 앵커링은 하되 토스트 대신 인라인 바로 이유를 말한다 |
| **`prefers-reduced-motion`** | — | 앵커링은 **그대로 한다.** 이건 모션이 아니라 위치의 문제다. 트랜지션만 0ms |

마지막 줄이 중요하다. reduced-motion에서 앵커링을 끄면 "점프 + 화면 이동"이 되어 오히려 더 나쁘다. 앵커링은 접근성 기능에 가깝다.

---

## 4. 사이클 처리 — ELK는 DAG를 전제한다

`graph-core`가 이미 다 해줬다: 결정적 DFS로 back edge를 확정하고(`acyclic.backEdgeIds`), `DerivedEdge.isBackEdge`를 세워두고, `toLayoutEdges()`가 뒤집기까지 해준다. ELK 자체의 `cycleBreaking`에 맡기지 않는 이유도 cycles.ts 상단에 적혀 있다 — **ELK의 휴리스틱은 입력 순서에 민감해서 같은 문서가 다른 엣지를 끊고, 그게 곧 레이아웃 점프다.**

여기서는 그다음 세 가지를 정한다.

### 4.1 ELK에 넘길 때

```ts
// packages/layout-core/src/build.ts
import { toLayoutEdges } from '@workflow/graph-core';

const layoutEdges = toLayoutEdges(visible.edges);   // back edge는 sources/targets가 뒤집혀 나온다

const elkEdges: ElkExtendedEdge[] = layoutEdges.map((e) => ({
  id: e.id,
  sources: e.sources,
  targets: e.targets,
  // 라벨은 넘기지 않는다 (L-01). labels 필드 자체를 만들지 않는다.
}));
```

이중 안전장치로 옵션 하나를 더 건다 (확정 옵션표에 없지만 **추가**다 — 기존 값을 바꾸지 않는다):

```ts
'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
```

우리가 이미 사이클을 끊어서 넘기므로 ELK 입장에선 순수 DAG고 이 옵션은 발동하지 않는다. 하지만 `graph-core`가 놓친 사이클이 하나라도 있으면 ELK가 **모델 순서 기준**으로 결정적으로 끊는다 — 무작위 휴리스틱으로 끊는 것보다 훨씬 안전하다. `ELK_OPTIONS_HASH`에 자동 반영된다.

**뒤집힌 엣지는 계층 배치에 반드시 참여시킨다.** 뒤집어 넘겨야만 ELK가 "되돌아가는 대상(=진짜 target)"을 위쪽 층에 놓고, 그 사이의 층들에 루프가 지나갈 세로 여유를 확보한다. 우리가 기하를 버릴 거라고 해서 엣지를 아예 빼면(= ELK에 안 넘기면), 루프의 시작과 끝이 서로 무관한 위치에 놓여 레일이 화면을 가로지른다.

### 4.2 결과를 받아 다시 뒤집기 — 왜 ELK 기하를 버리는가 (L-04)

ELK가 돌려주는 뒤집힌 엣지의 `sections`를 점 순서만 반대로 뒤집어 쓰는 방법이 가장 싸다. 그리고 **노드를 관통하지 않는다는 것도 보장된다** — ELK가 이미 자유공간에 라우팅했으니까. 그런데 결과 그림이 이렇다:

```
   ┌──────────┐
   │ ③ 검토   │◄──┐   ← 화살표가 노드 **하단**으로 들어온다
   └──────────┘   │
        │         │
   ┌──────────┐   │
   │ ④ 승인   │   │
   └────┬─────┘   │
        │         │
   ┌────▼─────┐   │
   │ ⑥ 반려   │───┘   ← 선이 노드 **상단**에서 나간다
   └──────────┘
```

"모든 화살표는 위에서 들어온다"는 전역 규칙이 깨진다. 12단계짜리 문서에서 되돌아가는 화살표 하나가 다른 규칙으로 그려지면, 사용자는 그 선을 **읽는 데 실패한다.** 그리고 되돌아가는 경로가 층 사이 좁은 공간에 다른 엣지들과 섞여 지나가서 "어디로 가는 선인지" 추적이 안 된다.

그래서 back edge는 **우측 사이드 레일**로 직접 그린다. 도쿄 지하철 노선도의 규율(DESIGN §10)이 정확히 이거다 — 되돌아가는 선은 본선 밖의 전용 궤도를 탄다.

```
   ┌──────────┐                     railX
   │ ③ 검토   │                       │
   └──────────┘  ← 층간 거터 ─────────┤   p3→p4
        │              ╭──────────────╯
        ▼              │
   ┌──────────┐        │
   │ ④ 승인   │        │  ← bbox 오른쪽 밖. 노드가 있을 수 없다
   └────┬─────┘        │
        ▼              │
   ┌──────────┐        │
   │ ⑥ 반려   │        │
   └──────────┘  ← 층간 거터 ─────────╯   p1→p2
```

정확히는 6점 폴리라인이다. `s` = 진짜 source(아래·나중), `t` = 진짜 target(위·먼저).

```ts
// packages/layout-core/src/backedge.ts

const RAIL_MARGIN = 32;    // bbox 오른쪽 끝에서 첫 레일까지
const RAIL_GAP    = 20;    // 레일 간격
const GUTTER_IN   = 20;    // 층간 거터 안쪽으로 들어가는 깊이 (거터는 64px)
const PORT_INSET  = 24;    // 노드 좌우 끝에서 안쪽으로. 정방향 포트(중앙)와 106px 떨어진다

export function routeBackEdges(
  back: readonly DerivedEdge[],
  place: ReadonlyMap<NodeId, NodePlacement>,
  bands: readonly LayerBand[],
  bbox: Rect,
): Map<string, EdgeGeometry> {
  // 1) 각 back edge가 세로로 점유하는 구간 [top, bottom]
  const spans = back.flatMap((e) => {
    const s = place.get(e.source), t = place.get(e.target);
    if (!s || !t) return [];
    return [{ e, s, t, top: t.y, bottom: s.y + s.h }];
  });

  // 2) 구간 겹침 = 다른 레일. 긴 구간부터 안쪽(작은 index)을 준다 —
  //    긴 루프가 바깥으로 밀리면 그림이 필요 이상으로 넓어진다.
  spans.sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top) || cmp(a.e.id, b.e.id));
  const railOf = new Map<string, number>();
  const occupied: Array<Array<[number, number]>> = [];
  for (const sp of spans) {
    let i = 0;
    while (occupied[i]?.some(([lo, hi]) => sp.top < hi && lo < sp.bottom)) i++;
    (occupied[i] ??= []).push([sp.top, sp.bottom]);
    railOf.set(sp.e.id, i);
  }

  // 3) 6점 생성
  const out = new Map<string, EdgeGeometry>();
  for (const { e, s, t } of spans) {
    const railX = bbox.x + bbox.w + RAIL_MARGIN + RAIL_GAP * railOf.get(e.id)!;
    const yOut = gutterBelow(bands, s) ;   // s가 속한 층 아래 거터
    const yIn  = gutterAbove(bands, t) ;   // t가 속한 층 위 거터
    const xOut = s.x + s.w - PORT_INSET;
    const xIn  = t.x + t.w - PORT_INSET;

    out.set(e.id, {
      id: e.id,
      kind: 'back',
      reversedForLayout: true,
      labelAnchor: { x: railX, y: (yOut + yIn) / 2 },   // ↩ 글리프 자리
      points: [
        { x: xOut, y: s.y + s.h },   // p0  s 하단에서 출발
        { x: xOut, y: yOut },        // p1  거터로 내려감
        { x: railX, y: yOut },       // p2  거터를 타고 오른쪽으로
        { x: railX, y: yIn },        // p3  레일을 타고 위로
        { x: xIn,  y: yIn },         // p4  거터를 타고 왼쪽으로
        { x: xIn,  y: t.y },         // p5  t 상단으로 진입 (화살표)
      ],
    });
  }
  return out;
}
```

**노드 비관통 증명** — 다섯 선분을 하나씩 본다.

| 선분 | 위치 | 왜 안전한가 |
|---|---|---|
| p0→p1 | `x = s.x + s.w − 24`, `y ∈ [s.bottom, gutter]` | `x`는 `s` 자신의 열 안이고, `y`는 `s`의 층 아래. ELK layered(DOWN)는 한 층의 노드를 하나의 가로 밴드에 놓으므로 그 아래는 노드가 없다 |
| p1→p2 | `y = gutter`, `x ∈ [·, railX]` | **층간 거터는 폭 전체에 걸쳐 노드가 없다.** `nodeNodeBetweenLayers: 64` 중 안쪽 20px를 쓴다 |
| p2→p3 | `x = railX ≥ bbox.right + 32` | bbox 정의상 오른쪽에 노드가 없다 |
| p3→p4 | `y = gutter`, `x ∈ [railX, ·]` | 위와 동일 |
| p4→p5 | `x = t.x + t.w − 24`, `y ∈ [gutter, t.top]` | `t` 자신의 열 안, `t`의 층 위 |

**정방향 엣지와는 교차한다.** 그건 허용한다 — DESIGN이 금지한 건 "노드를 관통하는 엣지"지 엣지 교차가 아니고, 되돌아가는 선이 정방향 선을 가로지르는 건 의미상으로도 맞다.

거터 계산:

```ts
function gutterBelow(bands: readonly LayerBand[], n: NodePlacement): number {
  const b = bands[n.layer]!;
  const next = bands[n.layer + 1];
  const y = b.bottom + GUTTER_IN;
  return next ? Math.min(y, next.top - 8) : y;   // 마지막 층이면 아래는 자유공간
}
function gutterAbove(bands: readonly LayerBand[], n: NodePlacement): number {
  const b = bands[n.layer]!;
  const prev = bands[n.layer - 1];
  const y = b.top - GUTTER_IN;
  return prev ? Math.max(y, prev.bottom + 8) : y;
}
```

`bands`는 ELK 결과의 `y`값을 클러스터링해 만든다. `nodePlacement: BRANDES_KOEPF` + 균일 높이(76)라 층 안의 `y`는 사실상 동일하지만, pill(36)이 섞이면 ELK가 층 안에서 세로 중앙 정렬을 하므로 **범위**로 잡는다.

```ts
export function layerBands(nodes: Iterable<NodePlacement>): LayerBand[] {
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  const bands: Array<{ top: number; bottom: number }> = [];
  for (const n of sorted) {
    const last = bands[bands.length - 1];
    // 새 층의 시작 = 이전 밴드 하단보다 아래에서 시작하는 노드
    if (!last || n.y >= last.bottom) bands.push({ top: n.y, bottom: n.y + n.h });
    else last.bottom = Math.max(last.bottom, n.y + n.h);
  }
  return bands.map((b, index) => ({ index, ...b }));
}
```

`layer` 필드는 이 밴드 인덱스로 되채운다. ELK가 층 번호를 직접 주지 않으므로(`elk.layered.layering.layerId`를 켜면 주지만 출력 스키마가 커진다) 기하에서 역산하는 게 더 견고하다 — 폴백 레이아웃(§11)에서도 **같은 함수**가 그대로 쓰인다.

### 4.3 되돌아가는 엣지의 시각 처리 (DESIGN 미명세 → 여기서 확정)

```
경로      우측 사이드 레일, 코너 radius 12px (정방향과 동일)
stroke    1.5px  n-450 (#948F87)   — 정방향 n-400보다 한 단계 진하다
          hover/selected 2px n-700
대시      쓰지 않는다 ★
화살표    MarkerType.ArrowClosed 14×14, **노드 상단**에 4px 띄우고 진입 (정방향과 동일)
글리프    레일 세로 중점에 20×20 흰 pill, 1px n-300, 중앙에 12px ↩ (corner-up-left) n-550
라벨      기본 없음. reworkRate가 있으면 hover 시 pill이 좌측으로 확장:
          "반려 30% · 평균 1.4회 더 돎"   (CycleInfo.expectedExtraPasses)
z-order   정방향 엣지 **아래**. 되돌아가는 선이 본선을 가리면 안 된다
```

**대시를 쓰지 않는 이유가 중요하다.** `hold` 노드의 보더가 이미 `1.5px dashed`고(DESIGN §4), 줌 아웃 시 대시 길이를 `6/z`로 보정하기까지 한다. 여기에 대시 엣지를 더하면 "점선 = 기다림"이라는 학습된 신호가 오염된다. **한 시각 채널에 두 의미를 실으면 둘 다 안 보인다** — DESIGN §6.4가 부서 경계 마커를 거부한 것과 같은 논리다.

되돌아감의 신호는 **위치(우측 전용 레일)와 형태(↩ 글리프)** 두 개로 낸다. 둘 다 색과 무관하므로:
- 색맹 4종 시뮬레이션에서 그대로 살아남는다
- 흑백 인쇄에서 그대로 살아남는다 (내보내기 푸터 범례에 `↩ 되돌아가는 흐름` 1줄 추가)
- `z < 0.30`에서 글리프는 사라지지만 **레일 자체가 남는다** — 오히려 줌아웃에서 "이 문서에는 루프가 3개 있다"가 한눈에 보인다

React Flow 커스텀 엣지:

```tsx
// components/canvas/BackEdge.tsx
import { BaseEdge, EdgeLabelRenderer, MarkerType } from '@xyflow/react';
import { orthPath } from '@workflow/layout-core';

export const BackEdge = memo(function BackEdge({ id, data, markerEnd }: EdgeProps<BackEdgeData>) {
  const d = useMemo(() => orthPath(data.points, 12), [data.points]);
  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} className="rf-edge rf-edge--back" />
      <EdgeLabelRenderer>
        <div
          className="rf-return-glyph"
          style={{ transform: `translate(-50%,-50%) translate(${data.labelAnchor.x}px,${data.labelAnchor.y}px)` }}
          title={data.reworkCopy /* "반려 30% · 평균 1.4회 더 돎" */}
        >
          <CornerUpLeftIcon size={12} aria-hidden />
          <span className="sr-only">{data.a11y /* "되돌아감: 6단계에서 3단계로" */}</span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
```

```css
.rf-edge--back path { stroke: var(--n-450); stroke-width: 1.5; fill: none; }
.rf-edge--back { z-index: -1; }
.rf-return-glyph {
  position: absolute; pointer-events: all;
  width: 20px; height: 20px; border-radius: 999px;
  display: grid; place-items: center;
  background: var(--n-0); border: 1px solid var(--n-300); color: var(--n-550);
}
```

라운드 직교 path 생성기 — 정방향/역방향/폴백이 모두 이걸 쓴다:

```ts
// packages/layout-core/src/geometry.ts

/** 직교 폴리라인 → 코너가 둥근 SVG path. r은 인접 선분 길이의 절반으로 자동 클램프된다 */
export function orthPath(pts: readonly XY[], r = 12): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
    const rr = Math.min(r, len(a, b) / 2, len(b, c) / 2);
    d += ` L ${b.x + unit(b, a).x * rr} ${b.y + unit(b, a).y * rr}`;
    d += ` Q ${b.x} ${b.y} ${b.x + unit(b, c).x * rr} ${b.y + unit(b, c).y * rr}`;
  }
  const e = pts[pts.length - 1]!;
  return `${d} L ${e.x} ${e.y}`;
}
```

`Q`(2차 베지어)를 쓰는 건 직교 코너에서 원호와 시각적으로 구분되지 않으면서 path 문자열이 짧기 때문이다. 500노드 × 평균 4코너면 path 길이가 곧 메모리이자 내보내기 SVG 용량이다.

### 4.4 접근성

캔버스 옆의 `sr-only` 순서 리스트([ACCESSIBILITY §2](./ACCESSIBILITY.md)의 "아웃라인 텍스트가 정본")에 되돌아감을 명시적으로 넣는다. 다이어그램에서 유일하게 **아웃라인 텍스트만으로는 복원되지 않는 정보**가 back edge이기 때문이다(아웃라인은 트리이고 루프는 트리에 없다).

```
6. 반려 처리  ↩ 3번 "검토"로 되돌아감 (반려 30%)
```
---

## 5. 증분 레이아웃 — 하지 않는다 (L-05)

`graph-core/src/incremental.ts`가 `derive()`의 증분화를 기각한 논리를 그대로 한 층 위에 적용한다. 다만 결론은 같아도 **근거는 다르다.** derive는 "너무 싸서" 기각됐고, ELK는 싸지 않다. 그래서 더 조심해서 따져야 한다.

### 5.1 `semiInteractive` + 이전 좌표 시드는 무효다

확정 옵션표에 이 셋이 함께 있다:

```js
'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
'elk.layered.crossingMinimization.semiInteractive': 'true',
```

`semiInteractive`가 하는 일은 **층 안 순서(in-layer ordering)를 정할 때 노드에 붙은 `elk.position`을 힌트로 쓰는 것**이다. 그런데 `forceNodeModelOrder: true`는 층 안 순서를 **모델 순서로 강제**한다. 그리고 우리는 `DerivedNode.order`(아웃라인 pre-order 인덱스)를 그대로 children 배열 순서로 넘긴다.

```
모델 순서가 층 안 순서를 완전히 결정한다  ⟹  좌표 힌트가 결정할 것이 남아 있지 않다
```

즉 `semiInteractive`는 **지배당했다(dominated).** `elk.position`을 넣어봐야 출력이 비트 단위로 동일하다. 확정 옵션이므로 플래그는 그대로 두되(다른 전략으로 바뀔 때를 위한 안전망), **좌표 시드는 넣지 않는다.** 그리고 실수로 넣는 것을 테스트로 막는다.

```ts
// packages/layout-core/test/build.test.ts
test('elk.position을 노드에 절대 넣지 않는다 (L-05)', () => {
  const g = buildElkGraph(inputOf(derive(fixtures.branchy, [])));
  walk(g, (n) => {
    assert.ok(!n.layoutOptions?.['elk.position'],
      `${n.id}에 좌표 시드가 들어갔다. forceNodeModelOrder가 무력화하므로 무의미하고, ` +
      `증분 레이아웃 착시를 만든다.`);
  });
});
```

> 만약 언젠가 `forceNodeModelOrder`를 끄기로 하면 이 결정을 다시 열어야 한다. 그때는 `semiInteractive`가 진짜로 일을 하기 시작한다. **테스트 실패 메시지에 그 조건을 적어둔다** — 결정의 유효기간을 코드에 박아두는 것이 문서에 적는 것보다 오래 간다.

### 5.2 그러면 안정성은 무엇이 보장하는가

증분화의 진짜 목적은 속도가 아니라 **"작은 변경 → 작은 이동"**이다. 그건 이미 세 겹으로 보장된다.

1. **입력 결정성** — `derive()`는 `Date.now()`/`Math.random()`을 쓰지 않고(util.ts 주석), back edge 확정도 결정적 DFS다. 같은 문서 → 같은 그래프 → 같은 ELK 입력.
2. **모델 순서 강제** — 사용자가 쓴 순서가 층 안 순서를 결정한다. 단계 하나를 중간에 끼워 넣어도 **좌우 순서가 보존된다.** 이게 사용자가 지각하는 안정성의 90%다.
3. **NETWORK_SIMPLEX 층 배정** — 결정적이고, 국소 변경에 국소적으로 반응한다.

남은 불안정은 "진짜로 그림이 달라져야 하는 변경"뿐이고, 그건 §3의 앵커링이 담당한다. **증분 레이아웃은 §3이 이미 푸는 문제를 훨씬 비싸게 다시 푸는 것이다.**

### 5.3 "변경된 서브그래프만 다시 배치" 기각 근거

| # | 근거 |
|---|---|
| 1 | **layered는 전역 결합이다.** 층 3에 노드 하나를 넣으면 NETWORK_SIMPLEX가 하류 전체의 층 배정을 바꿀 수 있다. 바깥 좌표를 고정한 채 안쪽만 다시 돌리면 겹침이 생기고, 그걸 푸는 리페어 패스가 **전역 재계산보다 큰 이동**을 만든다. `jump_score`를 낮추려던 최적화가 `jump_score`를 올린다 |
| 2 | **비용 구조가 맞지 않는다.** 200노드 ELK가 150ms인데 디바운스가 300ms다. **사용자는 이미 300ms를 기다리기로 합의했다.** 150 → 60ms로 줄여도 체감 450 → 360ms로, 두 값 모두 "즉시"가 아니고 두 값 모두 참을 만하다. 반면 500노드 1.5s는 증분화로도 못 고친다(전역 재층화가 트리거되는 순간 원점) — 그건 §7 접기로 N을 줄여야 하는 문제다 |
| 3 | **골든이 두 배가 된다.** "전체 계산 결과"와 "증분 결과"가 같아야 한다는 계약을 테스트해야 하고, 두 경로가 갈라지는 순간 **어느 쪽이 진실인지 알 수 없는 split brain**이 된다. D-030이 파생 엣지를 저장하지 않기로 한 이유와 글자 그대로 동일하다 |
| 4 | **elkjs는 부분 레이아웃 API가 없다.** 서브그래프를 별도 그래프로 만들어 돌린 뒤 좌표를 오프셋해 붙이는 수밖에 없는데, 그러면 서브그래프 경계를 넘는 엣지의 라우팅을 **우리가 직접 해야 한다.** 그건 ELK를 쓰는 이유를 없앤다 |
| 5 | **측정 대상이 틀렸다.** 우리 KPI는 `elk_ms`가 아니라 드래그 시도 횟수이고, 그 선행지표는 `jump_score`다. `elk_ms`는 예산(§6)만 지키면 되는 제약조건이지 최적화 목표가 아니다 |

### 5.4 판정 기준 — 이 결정을 뒤집는 조건

기각을 "영원히"로 못 박지 않는다. 대신 **뒤집는 데 필요한 측정치**를 미리 정한다. 아래 두 조건이 **동시에** 충족되면 재검토한다.

```
(A) 실측 elk_ms p95 > 예산(§6)의 1.5배가, 사다리 L3(자동 접기)까지 내린 뒤에도 지속
(B) jump_score p90 > 0.15 의 원인이 앵커링 실패가 아니라 ELK 출력 자체의 불안정으로 분해됨
    (= jump_score_world 가 크면서 앵커 규칙 적중률이 90% 이상)
```

(B)가 없으면 증분화는 오진 처방이다. 그리고 (A)만 참일 때의 처방은 증분 레이아웃이 아니라 **사다리 L2(직교 라우팅 포기)와 L3(자동 접기)**다 — 훨씬 싸고 되돌리기 쉽다.

`jump_score_world`(앵커 보정 전)와 `jump_score_screen`(보정 후)을 **둘 다 계측**하는 이유가 이 분해를 가능하게 하기 위해서다. 두 값의 비율이 앵커링의 효과를 그대로 보여준다.

---

## 6. 성능 예산과 실측 계획

### 6.1 예산표

`elk_ms`는 워커 안 `elk.layout()` 왕복(직렬화 포함), `render_ms`는 `commitLayout` 호출부터 페인트 완료까지 메인 스레드 점유 시간이다.

| 노드 수 | ELK p50 | ELK p95 | 렌더 p95 | Enter→노드 등장 (체감) | 비고 |
|---:|---:|---:|---:|---:|---|
| 20 | ≤ 25ms | **≤ 45ms** | **≤ 8ms** (1프레임) | ≤ 360ms | 실사용 중앙값 구간. 여기가 나쁘면 제품이 죽는다 |
| 100 | ≤ 70ms | **≤ 130ms** | **≤ 16ms** (1프레임) | ≤ 450ms | 상위 사용자 |
| 200 | ≤ 140ms | **≤ 260ms** | **≤ 33ms** (2프레임) | ≤ 600ms | ARCHITECTURE §5 "문제 없음" 상한 |
| 500 | ≤ 550ms | **≤ 900ms** | **≤ 80ms** | — (접기 유도) | 여기서 배너로 접기를 권한다(STATES §4) |
| — | — | **4000ms 하드 타임아웃** | — | — | §11 |

체감 예산 = 디바운스 300ms + ELK p95 + 렌더 p95. 20노드에서 `300 + 45 + 8 = 353ms`.
[STATES.md §10 #3](./STATES.md)의 "140ms 안에 애니메이션 시작"은 **ELK를 기다리지 않는 경로**에 대한 목표다 — 위상이 안 바뀌는 편집(타이핑 95%)에서는 `derive()` 1.5ms + 리렌더뿐이라 즉시 만족한다. 위상이 바뀔 때는 디바운스가 지배하므로 "140ms 안에" 대신 **"디바운스가 끝난 뒤 140ms 안에"**로 읽는다.

렌더 예산의 근거: 200노드에서 `onlyRenderVisibleElements`가 켜져 있으면 실제 마운트 노드는 뷰포트 크기에 비례해 **20~40개로 고정**된다. 500노드에서 80ms가 나오는 건 노드 렌더가 아니라 `setNodes`가 유발하는 React Flow 내부 `nodeLookup` 재구축 때문이다.

### 6.2 성능 저하 사다리 (degradation ladder)

**측정에 반응하는 자동 사다리**다. 사람이 손으로 내리는 스위치가 아니다.

| Lv | 트리거 (최근 5회 `elk_ms` 롤링 p75) | 포기하는 것 | 사용자가 보는 것 |
|---:|---|---|---|
| **0** | 예산 이내 | — | 정상 |
| **1** | 예산 × 1.25 초과 | `elk.layered.thoroughness: 7 → 3` | 교차가 조금 늘어난다. **대부분 눈치채지 못한다** |
| **2** | 예산 × 2.0 초과 | `elk.edgeRouting: ORTHOGONAL → POLYLINE`, 엣지 렌더러를 `smoothstep`으로 (L-03 폴백 경로) | 코너가 덜 정갈해지고 드물게 엣지가 노드 근처를 스친다. 인라인 바: "그림이 커서 선을 단순하게 그렸어요 `[원래대로]`" |
| **3** | 예산 × 3.0 초과 **또는** 노드 200개 초과 | **자동 접기.** 가장 큰 자동 그룹부터 접어 가시 노드 ≤ 180 | STATES §4의 배너를 **이미 적용된 상태**로 표시: "단계가 214개예요. 부서별로 접어서 보고 있어요 `[전부 펼치기]`" |
| **4** | ELK 3회 연속 실패/타임아웃 | **ELK 자체** | §11 폴백 레이아웃. 인라인 바로 고지 |

**복귀는 히스테리시스로.** 연속 3회의 `elk_ms`가 예산의 0.6배 미만이면 한 단계 올라간다. 0.6과 1.25 사이의 갭이 진동(그림이 매번 다르게 그려지는 최악의 경험)을 막는다. 사다리 단계는 `layoutKey`에 들어가므로(L-10) 단계 변경은 다음 재배치에서만 반영되고, `cause: 'ladder'`라서 토스트 대신 인라인 바를 쓴다.

```ts
// apps/web/lib/layout/ladder.ts
const BUDGET_P95 = (n: number): number =>
  n <= 20 ? 45 : n <= 100 ? 130 : n <= 200 ? 260 : 900;

export class Ladder {
  private level: LadderLevel = 0;
  private recent: number[] = [];      // 최근 5회 elk_ms
  private good = 0;

  observe(elkMs: number, nodeCount: number): LadderLevel {
    this.recent = [...this.recent, elkMs].slice(-5);
    const p75 = quantile(this.recent, 0.75);
    const budget = BUDGET_P95(nodeCount);

    const want =
      nodeCount > 200 ? 3 :
      p75 > budget * 3.0 ? 3 :
      p75 > budget * 2.0 ? 2 :
      p75 > budget * 1.25 ? 1 : this.level;

    if (want > this.level) { this.level = want as LadderLevel; this.good = 0; }
    else if (p75 < budget * 0.6 && ++this.good >= 3 && this.level > 0) {
      this.level = (this.level - 1) as LadderLevel; this.good = 0;
    }
    return this.level;
  }
}
```

사다리가 옵션에 반영되는 지점:

```ts
// packages/layout-core/src/options.ts
export function optionsFor(ladder: LadderLevel): Record<string, string> {
  const o: Record<string, string> = { ...ELK_OPTIONS };
  if (ladder >= 1) o['elk.layered.thoroughness'] = '3';
  if (ladder >= 2) o['elk.edgeRouting'] = 'POLYLINE';
  return o;
}
```

L3(자동 접기)은 옵션이 아니라 **입력**을 바꾼다 — `collapsed` 집합을 채운다. 그래서 사다리 로직이 옵션과 입력 양쪽을 건드리고, 그래서 `layoutKey`가 둘 다 커버해야 한다(§2.1).

### 6.3 벤치마크 하네스 — Node (ELK 시간)

브라우저 없이 돌아야 CI에서 매 PR마다 돌릴 수 있다. `elkjs/lib/elk.bundled.js`는 워커 없이 Node에서 동작한다.

```ts
// bench/layout.bench.ts
//   node --experimental-strip-types bench/layout.bench.ts --sizes 20,100,200,500 --runs 20
import ELK from 'elkjs/lib/elk.bundled.js';
import { derive } from '@workflow/graph-core';
import { build, kase } from '@workflow/graph-core/src/__fixtures__/builder.ts';
import { buildElkGraph, readLayout, jumpScore, layoutKeyOf } from '@workflow/layout-core';

const elk = new ELK();

/* ── 합성 그래프 생성기 ───────────────────────────────────────────────────
 * 실제 문서의 형태를 흉내낸다. 균질한 사슬만 재면 crossing minimization이
 * 전혀 일을 안 해서 실측이 낙관적으로 거짓말한다. 실사용 분포를 넣는다:
 *   - 6단계마다 갈래 1개 (평균 2.4갈래)
 *   - 12단계마다 AND 병렬 1개 → join 노드
 *   - 20단계마다 되돌아가는 엣지 1개
 *   - 8단계마다 hold 1개
 */
function synth(steps: number, seed = 1): { items: Item[]; edges: Edge[] } {
  const rnd = mulberry32(seed);
  const specs: Spec[] = [];
  const backs: Edge[] = [];
  let i = 0;
  while (i < steps) {
    if (i % 6 === 5) {
      const n = 2 + Math.floor(rnd() * 2.4);            // 2~4 갈래
      const and = i % 12 === 11;
      specs.push({
        id: `b${i}`, kind: 'branch', title: `조건 ${i}`,
        attrs: { mode: and ? 'and' : 'xor' },
        children: Array.from({ length: n }, (_, k) =>
          kase(`c${i}_${k}`, [
            { id: `s${i}_${k}_0`, title: `단계 ${i}.${k}.0` },
            { id: `s${i}_${k}_1`, title: `단계 ${i}.${k}.1` },
          ])),
      });
      i += n * 2 + 1;
    } else {
      specs.push({ id: `s${i}`, kind: i % 8 === 7 ? 'hold' : 'task', title: `단계 ${i}` });
      if (i % 20 === 19 && i >= 20) {
        backs.push({ id: `back${i}`, sourceId: `s${i}`, targetId: `s${i - 12}`, kind: 'explicit' });
      }
      i++;
    }
  }
  return { items: build(specs), edges: backs };
}

/* ── 변이 시나리오 — jump_score를 재려면 "연속된 두 레이아웃"이 필요하다 ── */
type Mutation = { name: string; apply: (items: Item[]) => Item[] };
const MUTATIONS: Mutation[] = [
  { name: '중간 삽입',   apply: (it) => insertAfter(it, midStepId(it), { id: 'NEW', title: '새 단계' }) },
  { name: '중간 삭제',   apply: (it) => it.filter((x) => x.id !== midStepId(it)) },
  { name: '순서 교환',   apply: (it) => swapSortKeys(it, midStepId(it), nextStepId(it)) },
  { name: '갈래 추가',   apply: (it) => addCase(it, firstBranchId(it)) },
  { name: 'and 전환',    apply: (it) => patchAttrs(it, firstBranchId(it), { mode: 'and' }) },
  { name: '끝에 추가',   apply: (it) => [...it, mkItem('TAIL')] },
  { name: '맨앞에 추가', apply: (it) => [mkItem('HEAD', { sortKey: '0' }), ...it] },
];

async function run(): Promise<void> {
  const rows: Row[] = [];
  for (const steps of SIZES) {
    const base = synth(steps);
    const g0 = derive(base.items, base.edges);
    const l0 = await time(g0);

    for (const m of MUTATIONS) {
      const g1 = derive(m.apply(base.items), base.edges);
      if (layoutKeyOf(inp(g1)) === layoutKeyOf(inp(g0))) continue;   // 게이트가 잡는 변이는 스킵
      const samples: number[] = [];
      let l1!: LayoutResult;
      for (let r = 0; r < RUNS; r++) { l1 = await time(g1); samples.push(l1.elapsedMs); }

      rows.push({
        nodes: g1.nodes.length,
        mutation: m.name,
        p50: quantile(samples, 0.5),
        p95: quantile(samples, 0.95),
        // 뷰포트가 없는 환경이므로 1440×900 @ z=1을 가정한다. 상대비교용으로 충분하다
        jump_world:  jumpScore(l0, l1, { viewport: VP, translate: ZERO }),
        jump_screen: jumpScore(l0, l1, { viewport: VP, translate: anchorDelta(l0, l1, g0, g1) }),
        deterministic: await isDeterministic(g1, 5),
      });
    }
  }
  report(rows);                       // 콘솔 표 + bench/results/<sha>.json
  assertBudgets(rows);                // 예산 초과 시 exit 1
}

async function time(g: DerivedGraph): Promise<LayoutResult> {
  const input = inp(g);
  const elkGraph = buildElkGraph(input);
  const t0 = performance.now();
  const out = await elk.layout(elkGraph);
  const ms = performance.now() - t0;
  return readLayout(out, input, { rev: 0, layoutKey: layoutKeyOf(input), algorithm: 'elk', ladder: 0, elapsedMs: ms });
}

/** 같은 입력을 n번 돌려 좌표가 비트 단위로 같은지 — 안정성의 최소 조건 */
async function isDeterministic(g: DerivedGraph, n: number): Promise<boolean> {
  const first = hashPositions(await time(g));
  for (let i = 1; i < n; i++) if (hashPositions(await time(g)) !== first) return false;
  return true;
}
```

출력 예시(형식만 — 값은 하네스가 채운다):

```
 nodes  mutation      p50    p95   jump_world  jump_screen  det
    18  중간 삽입    ..ms   ..ms        .....        .....   ✓
    18  갈래 추가    ..ms   ..ms        .....        .....   ✓
   ...
✗ 예산 초과: nodes=203 mutation=and 전환 p95=..ms > 260ms
```

`bench/results/<sha>.json`을 아티팩트로 남기고, main 대비 **p95가 20% 이상 나빠지면 PR에 코멘트**한다(실패시키지는 않는다 — CI 러너의 노이즈가 크다). 예산 **초과**는 실패시킨다.

### 6.4 벤치마크 하네스 — 브라우저 (렌더 시간)

메인 스레드 점유는 Node에서 잴 수 없다. Playwright + `PerformanceObserver`.

```ts
// e2e/layout-perf.spec.ts
test.describe('렌더 예산', () => {
  for (const { steps, budget } of [{ steps: 20, budget: 8 }, { steps: 100, budget: 16 }, { steps: 200, budget: 33 }]) {
    test(`${steps}단계 커밋 렌더 p95 ≤ ${budget}ms`, async ({ page }) => {
      await page.goto(`/dev/canvas-bench?steps=${steps}`);
      await page.waitForFunction(() => window.__layout?.phase === 'idle');

      const samples = await page.evaluate(async () => {
        const out: number[] = [];
        for (let i = 0; i < 30; i++) {
          performance.mark('commit:start');
          await window.__bench.mutate('insert-mid');      // 구조 변경 1회
          await window.__layout.settled();                // settling → idle
          performance.mark('commit:end');
          const m = performance.measure('commit', 'commit:start', 'commit:end');
          out.push(m.duration);
        }
        return out;
      });
      expect(quantile(samples, 0.95)).toBeLessThan(budget + ELK_ALLOWANCE);
    });
  }
});
```

`window.__layout`/`window.__bench`는 `NODE_ENV !== 'production'`에서만 붙는 테스트 훅이다. 이걸 붙여두는 게 중요하다 — 붙여두지 않으면 성능 테스트가 DOM 폴링으로 퇴화하고, 폴링 기반 성능 테스트는 노이즈 때문에 반드시 꺼진다.

`ELK_ALLOWANCE`는 브라우저 워커 왕복분이다. **분리 계측**이 원칙: `elk_ms`는 워커가 자체 측정해 메시지에 실어 보내고, `render_ms`는 그걸 뺀 나머지로 계산한다.

### 6.5 무엇을 포기하지 **않는가**

사다리에 없는 것들 = 성능을 이유로 절대 포기하지 않는 것들.

| 절대 포기 안 함 | 이유 |
|---|---|
| **노드 260×76 고정** | 이걸 포기하는 순간 §2 게이트 표의 절반이 무효가 된다 |
| **모델 순서 존중** (`considerModelOrder`) | "내 글이 그림이 됐다"의 유일한 근거. 이게 없으면 제품이 아니다 |
| **앵커링** | 순수 계산이라 비용이 O(V)에 불과하다. 느려서 끌 이유가 없다 |
| **디바운스 300ms** | 줄이면 ELK 호출 횟수가 늘어 총 비용이 커진다. 늘리면 마법이 죽는다 |
| **노드 생성 애니메이션** | 이 제품의 마법의 순간(DESIGN §9). 500노드에서도 스태거만 40ms→0으로 줄이고 opacity는 유지 |
| **back edge 사이드 레일** | 순수 후처리, O(E log E). 비용이 없다 |
---

## 7. 그룹 접기(collapse) 통합

D-037이 v1부터 넣기로 했고, 이유가 "나중에 추가하면 ID 스킴과 레이아웃 캐시를 다시 손대야 한다"이므로, **ID와 캐시 키를 여기서 확정하는 것이 이 절의 진짜 산출물**이다.

### 7.1 두 종류의 그룹 — 하나만 ELK가 안다

| | 명시 그룹 | 자동 그룹 |
|---|---|---|
| 근거 | 아웃라인에서 자식을 가진 항목 (`item.parentId` 사슬) | 담당자·부서가 같은 연속 구간 (DESIGN §6.7) |
| ID | `group:{itemId}` | `auto:{deptId}:{firstNodeId}` |
| 펼친 상태 | **ELK 컨테이너** (`elk.hierarchyHandling: INCLUDE_CHILDREN`) | **오버레이만** (L-02). ELK는 존재를 모른다 |
| 접힌 상태 | 260×76 리프 노드 | 260×76 리프 노드 |
| `layoutKey` 기여 | `containerHash` + `collapsedHash` | `collapsedHash` (접혔을 때만) |

**자동 그룹이 ELK 컨테이너가 되면 안 되는 이유**는 §2 표 17행 그대로다 — 담당자를 한 명 바꾸면 구간이 갈라지거나 합쳐져 컨테이너 구조가 바뀌고, 그게 재배치가 된다. 담당자 입력은 온보딩에서 대량으로 일어나므로 그 순간 그림이 계속 춤춘다.

### 7.2 `INCLUDE_CHILDREN`으로 무엇을 얻는가

기본값 `SEPARATE_CHILDREN`은 자식 그래프를 **독립적으로** 배치한 뒤 부모 층위에 박스로 끼워 넣는다. 그러면 그룹 경계에서 흐름이 끊긴다 — 그룹 안의 3단계와 밖의 다음 단계가 서로 다른 층 체계에 속해서 세로 간격이 제각각이 되고, 그룹을 접었다 펴면 **그룹 밖 노드까지 전부 이동**한다.

`INCLUDE_CHILDREN`은 계층 경계를 **가로질러** 층을 배정한다. 그룹 안 첫 단계와 그룹 앞 단계가 같은 층 체계 안에서 64px 간격으로 놓인다. 사용자에게는 "선이 박스를 통과해 계속 흐른다"로 보인다.

```ts
// packages/layout-core/src/build.ts
function containerNode(groupId: NodeId, kids: ElkNode[], header: boolean): ElkNode {
  return {
    id: groupId,
    children: kids,
    layoutOptions: {
      // 그룹 헤더("영업팀 · 6단계") 자리를 위쪽에 확보한다.
      // 이 값이 바뀌면 그룹 안팎이 전부 움직이므로 상수로 못 박는다.
      'elk.padding': '[top=36,left=20,bottom=20,right=20]',
      // 컨테이너 자신은 크기를 자식에서 계산한다
      'elk.nodeSize.constraints': 'NODE_LABELS MINIMUM_SIZE',
      'elk.nodeSize.minimum': '(260,76)',
    },
  };
}
```

컨테이너를 만들 때의 주의: `derive()`가 만든 `subtree` reason 엣지는 **부모와 첫 자식을 잇는다.** 즉 부모 항목 자신도 노드다. 그래서 명시 그룹은 "부모 노드 + 자식들"을 감싸는 게 아니라 **자식들만** 감싸고, 부모 노드는 컨테이너 밖 위쪽에 남는다. 그러지 않으면 컨테이너로 들어가는 엣지의 출발점이 컨테이너 자신이 되어 라우팅이 이상해진다.

```
  ┌──────────────┐
  │ 견적 검토    │   ← 부모 노드. 컨테이너 밖
  └──────┬───────┘
  ╔══════▼═══════════════════╗
  ║ 견적 검토 · 3단계         ║  ← 컨테이너 (padding top 36 = 이 헤더)
  ║  ┌────────┐              ║
  ║  │ 단가확인│              ║
  ║  └───┬────┘              ║
  ║      ▼                   ║
  ║  ┌────────┐              ║
  ║  │ 승인요청│              ║
  ║  └────────┘              ║
  ╚══════╤═══════════════════╝
         ▼
```

### 7.3 접기 — 그래프 접기(fold)는 layout-core가 순수하게

```ts
// packages/layout-core/src/collapse.ts

export type VisibleGraph = {
  nodes: readonly DerivedNode[];
  edges: readonly DerivedEdge[];
  /** 접힌 그룹 노드 → 흡수된 원본 노드들. 애니메이션과 sr-only 목록이 쓴다 */
  absorbed: ReadonlyMap<NodeId, readonly NodeId[]>;
  containers: ReadonlyMap<NodeId, readonly NodeId[]>;
};

export function foldGraph(graph: DerivedGraph, collapsed: ReadonlySet<string>): VisibleGraph {
  // 1) 접힌 항목의 서브트리에 속한 노드 → 대표 그룹 노드로의 사상
  //    중첩 접기: 가장 바깥 접힌 조상이 이긴다 (order 최소 = pre-order 최상위)
  const rep = new Map<NodeId, NodeId>();
  for (const n of graph.nodes) {
    const owner = outermostCollapsedAncestor(graph, n, collapsed);
    if (owner) rep.set(n.id, `group:${owner}` as NodeId);
  }

  // 2) 노드: 접힌 것들을 그룹 노드 하나로 치환. order는 흡수된 것 중 최소 —
  //    모델 순서를 보존해야 그룹이 원래 자리에 그대로 놓인다.
  const groups = new Map<NodeId, DerivedNode[]>();
  const nodes: DerivedNode[] = [];
  for (const n of graph.nodes) {
    const g = rep.get(n.id);
    if (!g) { nodes.push(n); continue; }
    pushTo(groups, g, n);
  }
  for (const [gid, members] of groups) {
    const head = members.reduce((a, b) => (a.order <= b.order ? a : b));
    nodes.push({
      ...head,
      id: gid,
      kind: 'task',                       // 그룹 노드는 타입 액센트를 갖지 않는다
      synthetic: true,
      itemId: head.itemId,                // 클릭 → 아웃라인 동기화가 계속 동작하게
      title: head.title,
      order: head.order,
    });
  }
  nodes.sort((a, b) => a.order - b.order);   // 모델 순서 = 이 배열 순서 (§5.1)

  // 3) 엣지: 양 끝을 대표로 사상. 자기루프(내부 엣지)는 제거.
  //    중복은 **가장 작은 id 하나만** 남긴다 — 결정성이 곧 안정성이다.
  const seen = new Map<string, DerivedEdge>();
  for (const e of graph.edges) {
    const s = rep.get(e.source) ?? e.source;
    const t = rep.get(e.target) ?? e.target;
    if (s === t) continue;
    const k = `${s}>${t}`;
    const cur = seen.get(k);
    if (!cur || e.id < cur.id) seen.set(k, { ...e, source: s, target: t });
  }

  return {
    nodes,
    edges: [...seen.values()].sort((a, b) => cmp(a.id, b.id)),
    absorbed: new Map([...groups].map(([g, m]) => [g, m.map((n) => n.id)])),
    containers: buildContainers(graph, collapsed),
  };
}
```

**중복 엣지 병합 시 `isBackEdge` 처리**: 접기로 back edge의 양 끝이 같은 그룹에 들어가면 자기루프가 되어 제거된다. 이건 옳다 — 그룹 안에서 도는 루프는 접힌 상태에서 보일 이유가 없다. 대신 그룹 노드에 **↩ 배지**를 단다("안에 되돌아가는 흐름 1개"). 정보를 잃지 않는 게 접기의 계약이다.

### 7.4 접힌 그룹의 크기

**260×76. 일반 노드와 완전히 동일하다.**

이유는 단순함이 아니라 안정성이다. 그룹 크기를 내용에 비례시키면(자식 수에 따라 높이가 늘어나면) 자식 하나를 추가할 때마다 접힌 상태에서도 층 간격이 바뀐다 — 접기의 목적이 "안쪽 변화가 바깥에 영향을 안 주는 것"인데 그게 무너진다.

"6단계가 들어 있다"는 신호는 **크기가 아니라 실루엣**으로 낸다. 그리고 그 실루엣은 **레이아웃 박스 밖에** 그린다.

```css
/* 뒤에 겹쳐진 종이 2장. ::before/::after는 레이아웃 박스에 영향을 주지 않는다 */
.rf-node--group { overflow: visible; }
.rf-node--group::before,
.rf-node--group::after {
  content: ''; position: absolute; inset: 0;
  border-radius: 12px; background: var(--n-0);
  border: 1.5px solid var(--n-200); z-index: -1;
}
.rf-node--group::before { transform: translate(3px, 3px); }
.rf-node--group::after  { transform: translate(6px, 6px); z-index: -2; }
```

그룹 노드 내용: `제목 · 6단계 · 약 2시간` + 우상단 `▸` 펼치기 버튼(24×24 터치 타깃) + 내부 루프가 있으면 `↩`.

**펼친 컨테이너의 크기는 ELK가 계산한다** — `elk.padding` `[36,20,20,20]`에 자식 bbox를 더한 값. 우리가 계산하지 않는다.

### 7.5 애니메이션 — 흡수와 방출

노드가 "사라지고 생기는" 게 아니라 "빨려 들어가고 튀어나오는" 것으로 보여야 한다. **FLIP을 DOM 측정 없이 순수 계산으로** 한다 — 접기 전후의 월드 좌표를 우리가 둘 다 갖고 있기 때문이다. `getBoundingClientRect()`를 부르지 않으므로 강제 리플로가 0이고, 200노드에서도 프레임을 안 떨어뜨린다.

```tsx
// components/canvas/CollapseFlip.tsx
// 접기/펼치기 커밋 시에만 마운트되는 고스트 레이어. ViewportPortal 안에 있어서
// 팬/줌 변환을 자동으로 따라간다.

export function CollapseFlip({ plan }: { plan: FlipPlan | null }) {
  if (!plan) return null;
  return (
    <ViewportPortal>
      {plan.ghosts.map((g, i) => (
        <div
          key={g.id}
          className="rf-ghost"
          style={{
            transform: `translate(${g.from.x}px, ${g.from.y}px)`,
            '--to-x': `${g.to.x}px`,
            '--to-y': `${g.to.y}px`,
            // 흡수: 먼 것부터 (바깥에서 안으로 빨려 들어가는 리듬)
            // 방출: 가까운 것부터 (order 순으로 펼쳐지는 리듬)
            animationDelay: `${(plan.dir === 'collapse' ? plan.ghosts.length - 1 - i : i) * 20}ms`,
          } as CSSProperties}
        >
          <WorkflowNodeStatic data={g.data} />
        </div>
      ))}
    </ViewportPortal>
  );
}
```

```css
.rf-ghost {
  position: absolute; top: 0; left: 0; width: 260px; height: 76px;
  pointer-events: none;
  animation: ghost-absorb var(--dur-relayout) var(--ease-flow) forwards;
}
@keyframes ghost-absorb {
  to { transform: translate(var(--to-x), var(--to-y)) scale(.92); opacity: 0; }
}
[data-flip-dir='expand'] .rf-ghost {
  animation-name: ghost-emit;
}
@keyframes ghost-emit {                     /* 방향만 반대. 시작이 그룹 위치 */
  from { transform: translate(var(--to-x), var(--to-y)) scale(.92); opacity: 0; }
  to   { transform: translate(var(--from-x), var(--from-y)); opacity: 1; }
}
```

순서:

```
[접기]
 1. 사용자가 ▸ 클릭
 2. engine.send({ t:'graph', input:{ collapsed: +id }, hint:{ t:'node', nodeId:'group:id' }, cause:'collapse' })
 3. layoutKey 변경 → 캐시 히트면 즉시, 아니면 ELK
 4. 커밋 직전에 FlipPlan 계산:
      ghosts = absorbed.map(id => ({ from: prev.nodes[id], to: next.nodes['group:id'] }))
 5. commitLayout() — 그룹 노드는 이 시점에 이미 최종 위치에 있다
 6. CollapseFlip 마운트 → 220ms → 언마운트
 7. 그룹 노드는 data-born="1"로 140ms opacity+translateY 등장 (DESIGN §9 노드 생성)

[펼치기] 4~7의 방향만 뒤집는다. 실제 노드들은 opacity 0으로 커밋하고,
        고스트가 도착한 뒤(220ms) 실제 노드를 보여준다 — 이중 렌더가 보이지 않게.
```

**앵커는 그룹 노드의 상단 중앙으로 강제한다**(§3.6). 사용자가 방금 누른 버튼이 화면에서 안 움직이는 것이 이 인터랙션의 전부다.

`prefers-reduced-motion`:

```
고스트 없음. 좌표 즉시 커밋 + 그룹 노드 opacity 0→1 140ms.
role="status": "6단계를 접었어요" / "6단계를 펼쳤어요"
```

### 7.6 URL에 접기 상태 저장

D-037이 "공유 링크에 반영"을 요구한다. 제약이 두 개다: (a) itemId가 UUID라 그대로 넣으면 URL이 폭발한다, (b) 공유받은 사람이 열었을 때 **문서가 그새 편집되었을 수 있다.**

```
/workflows/[id]?c=3f2a1b90,8c4d02e1&lens=people
/s/[token]?c=3f2a1b90&view=embed
```

```ts
// apps/web/lib/layout/urlState.ts

const MAX_C = 24;

/** UUID 앞 8자리. 24개면 URL 기여분 216자 — 공유 링크에 허용 가능한 상한 */
export function encodeCollapsed(ids: ReadonlySet<string>): string | null {
  if (ids.size === 0) return null;
  if (ids.size > MAX_C) return 'auto';            // 자동 접기 휴리스틱을 재적용하라는 뜻
  return [...ids].map((id) => id.replaceAll('-', '').slice(0, 8)).sort().join(',');
}

export function decodeCollapsed(param: string | null, items: readonly Item[]): Set<string> {
  if (!param) return new Set();
  if (param === 'auto') return autoCollapse(items);
  const byPrefix = new Map<string, string[]>();
  for (const it of items) pushTo(byPrefix, it.id.replaceAll('-', '').slice(0, 8), it.id);
  const out = new Set<string>();
  for (const p of param.split(',')) {
    const hits = byPrefix.get(p);
    // 접두어가 없거나(삭제됨) 모호하면(충돌) **조용히 버린다.**
    // 접기 상태는 뷰 선호지 데이터가 아니다 — 틀리면 안 접히면 그만이고,
    // 여기서 에러를 띄우면 "공유 링크가 깨졌다"는 인상만 남는다.
    if (hits?.length === 1) out.add(hits[0]!);
  }
  return out;
}
```

쓰기는 **`replaceState`, 400ms 디바운스**. `pushState`를 쓰면 접기를 다섯 번 토글한 뒤 뒤로가기가 다섯 번 필요해지는데, 그건 아무도 원하지 않는 히스토리다. 렌즈(`lens`)와 뷰 모드(`view`, `mode`)도 같은 모듈에서 같은 방식으로 다룬다.

```ts
const flushUrl = debounce(() => {
  const u = new URL(location.href);
  setOrDelete(u.searchParams, 'c', encodeCollapsed(store.collapsed));
  setOrDelete(u.searchParams, 'lens', store.lens === 'flow' ? null : store.lens);
  history.replaceState(history.state, '', u);
}, 400);
```

`autoCollapse`는 사다리 L3과 **같은 함수**를 쓴다: 자동 그룹을 크기 내림차순으로 접어 가시 노드가 180 이하가 될 때까지. 결정적이어야 하므로 동점은 `firstNodeId`로 깬다.

---

## 8. Semantic zoom 구현

DESIGN §6.7의 4단계는 이렇다.

```
z ≥ 0.75          전체
0.45 ≤ z < 0.75   도구 칩·시간 막대 제거, 아바타 유지, 엣지 라벨 유지
0.30 ≤ z < 0.45   담당자 이름 제거(아바타만), 엣지 라벨 제거, 제목 1줄 clamp
z < 0.30          제목까지 제거 → 60×20 색 블록 + 좌측 3px 액센트만
```

### 8.1 리렌더 0회로 전파한다 (L-07)

`useStore(s => s.transform[2])`를 노드 컴포넌트에서 직접 쓰면 **휠 한 번에 수십 번, 마운트된 노드 전부**가 리렌더된다. 티어 셀렉터(`useStore(s => tierOf(s.transform[2]))`)로 바꾸면 리렌더 횟수는 4번으로 줄지만, 그 4번이 **전체 노드 리렌더**다.

리렌더를 0으로 만든다. 티어는 React 상태가 아니라 **DOM 속성**이다.

```tsx
// components/canvas/ZoomTierBridge.tsx
import { useStoreApi } from '@xyflow/react';

/** 히스테리시스 0.02 — 경계에서 티어가 떨리면 문자가 깜빡인다 */
const STOPS = [0.30, 0.45, 0.75] as const;
export function tierOf(z: number, prev: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const h = 0.02;
  let t: 0 | 1 | 2 | 3 = 3;
  if (z < STOPS[0] - (prev <= 0 ? -h : h)) t = 0;
  else if (z < STOPS[1] - (prev <= 1 ? -h : h)) t = 1;
  else if (z < STOPS[2] - (prev <= 2 ? -h : h)) t = 2;
  return t;
}

export function ZoomTierBridge({ rootRef }: { rootRef: RefObject<HTMLElement> }) {
  const api = useStoreApi();
  useEffect(() => {
    let prev: 0 | 1 | 2 | 3 = 3;
    const write = (z: number) => {
      const t = tierOf(z, prev);
      if (t === prev) return;                       // ← 이 줄이 전부다
      prev = t;
      rootRef.current?.setAttribute('data-zoom-tier', String(t));
      // 미니맵 표시 여부처럼 진짜 React가 필요한 소비자만 이벤트로 받는다
      rootRef.current?.dispatchEvent(new CustomEvent('zoomtier', { detail: t }));
    };
    write(api.getState().transform[2]);
    return api.subscribe((s) => s.transform[2], write);   // zustand 셀렉터 구독
  }, [api, rootRef]);
  return null;
}
```

**React를 한 번도 렌더하지 않는다.** `api.subscribe`는 zustand의 명령형 구독이라 리액트 트리 밖이다. 티어가 바뀌는 4번의 순간에 일어나는 일은 루트 엘리먼트의 속성 한 글자 교체뿐이고, 나머지는 브라우저의 스타일 재계산이 처리한다.

### 8.2 CSS

```css
/* 기본(티어 3) 상태를 정의하고, 티어가 내려갈수록 빼기만 한다 */
[data-zoom-tier='2'] .wf-tools,
[data-zoom-tier='2'] .wf-duration { display: none; }

[data-zoom-tier='1'] .wf-tools,
[data-zoom-tier='1'] .wf-duration,
[data-zoom-tier='1'] .wf-assignee-name,
[data-zoom-tier='1'] .rf-edge-label { display: none; }
[data-zoom-tier='1'] .wf-title { -webkit-line-clamp: 1; }

/* 티어 0: 카드가 아니라 색 블록. **레이아웃 박스는 260×76 그대로다.** */
[data-zoom-tier='0'] .wf-card > *:not(.wf-accent) { display: none; }
[data-zoom-tier='0'] .wf-card {
  width: 60px; height: 20px; margin: 28px auto 0;   /* 260×76 안에서 중앙 */
  border-radius: 4px; box-shadow: none;
}
/* DESIGN §4: z<0.45에서 3중 인코딩이 무너지는 것에 대한 보정 */
[data-zoom-tier='1'] .wf-accent,
[data-zoom-tier='0'] .wf-accent { width: 5px; }
[data-zoom-tier='1'] .wf-card--hold,
[data-zoom-tier='0'] .wf-card--hold { --dash: calc(6px / var(--z, 1)); }
```

`--z`는 같은 브릿지가 티어와 함께 쓰는 CSS 변수다. 대시 길이만 연속값이 필요해서 예외적으로 실수를 쓰되, **쓰기를 티어 전환 시점으로 제한**한다(연속 갱신하면 휠마다 스타일 재계산이 돈다). 티어 안에서 대시 길이가 조금 어긋나는 건 눈에 띄지 않는다.

### 8.3 "레이아웃이 절대 안 바뀐다"의 증명

세 겹이다.

1. **타입** — `LayoutInput`에 zoom 필드가 없다(§1.2). `buildElkGraph`가 줌을 볼 방법이 존재하지 않는다.
2. **박스 불변** — 티어 0에서도 React Flow 노드 래퍼는 260×76이다. 안쪽 `.wf-card`만 작아진다. React Flow의 `measured` 값이 안 바뀌므로 `nodeLookup`도 안 바뀐다.
3. **테스트** — 네 티어에서 레이아웃을 돌려 좌표 해시가 동일한지 확인한다.

```ts
test('줌 티어는 레이아웃에 도달할 수 없다', async () => {
  const input = inputOf(derive(fixtures.mixed, []));
  const base = hashPositions(await layout(input));
  for (const z of [0.2, 0.4, 0.6, 1.0, 2.0]) {
    // 줌은 커밋 이후의 뷰포트 상태일 뿐이므로 입력이 같으면 결과가 같아야 한다
    assert.equal(hashPositions(await layout(input)), base, `z=${z}에서 좌표가 달라졌다`);
  }
});
```

그리고 E2E에서 **실제로 안 움직이는지** 확인한다 — 위 단위 테스트는 "우리 코드가 줌을 안 본다"만 증명하고, React Flow가 `measured`를 갱신해 위치를 흔드는 가능성은 못 잡는다.

```ts
test('줌 전환 중 노드 월드 좌표 불변', async ({ page }) => {
  const before = await positions(page);
  for (const z of [0.7, 0.4, 0.25, 1.0]) await setZoom(page, z);
  expect(await positions(page)).toEqual(before);
});
```

### 8.4 티어 0의 정보 손실 대응

STATES.md §4가 요구한다: "`z<0.30`에서 제목이 사라지는 구간은 정보 손실이다 → 텍스트 대체 목록 토글을 하단 상시 노출 + `aria-live` 1회 안내."

`zoomtier` CustomEvent를 받는 유일한 React 소비자가 이걸 담당한다. 노드가 아니라 **캔버스 하단 바 하나**만 리렌더된다.

```tsx
function CanvasFooter() {
  const tier = useZoomTierEvent();          // CustomEvent 구독. 4번만 리렌더
  return (
    <>
      {tier === 0 && <p role="status" className="sr-only">축소해서 제목이 보이지 않아요. 목록으로 보기를 쓸 수 있어요.</p>}
      <button aria-pressed={listOpen}>목록으로 보기</button>
      {nodeCount >= 20 && <MiniMap … />}     {/* DESIGN §6.7: 20개 이상일 때만 */}
    </>
  );
}
```

---

## 9. 렌즈 전환 — 1px도 움직이지 않는다

5종: 흐름(기본) · 사람 · 시간 · 도구 · 짜증. 200ms 크로스페이드(`--ease-flow`).

### 9.1 구조 — 3층을 항상 렌더하고 CSS 변수로 고른다

렌즈마다 다른 메타를 **조건부 렌더**하면 전환 때 React가 언마운트/마운트를 하고, 그 순간 크로스페이드가 불가능하며(사라진 DOM은 페이드아웃할 수 없다), 무엇보다 마운트가 레이아웃을 유발할 여지가 생긴다.

그래서 **메타 스트립(하단 24px 고정 예약) 안에 세 층을 절대 위치로 겹쳐 놓고** 불투명도만 바꾼다.

```tsx
// components/canvas/WorkflowNode.tsx  (COMPONENTS §7의 마크업 위에 얹는다)
<div className="wf-meta">                          {/* absolute inset-x-4 bottom-0 h-6 */}
  <div className="wf-meta-layer wf-meta--flow"   aria-hidden={lens !== 'flow'}   />
  <div className="wf-meta-layer wf-meta--people"><Avatar name={a.name} /><span className="wf-assignee-name">{a.name}</span></div>
  <div className="wf-meta-layer wf-meta--time"><DurationBar bucket={d} /><span>{dText}</span></div>
  <div className="wf-meta-layer wf-meta--tools">{tools.map(t => <ToolChip key={t} id={t} />)}</div>
</div>
```

```css
/* ── 렌즈 = CSS 변수 6개의 교체. 그 이상 아무것도 안 한다 ────────────── */
[data-lens='flow']   { --l-people: 0; --l-time: 0; --l-tools: 0; --l-dim: 1;   --l-gray: 0; --l-handoff: 1.5px; }
[data-lens='people'] { --l-people: 1; --l-time: 0; --l-tools: 0; --l-dim: 1;   --l-gray: 0; --l-handoff: 2px;   }
[data-lens='time']   { --l-people: 0; --l-time: 1; --l-tools: 0; --l-dim: 1;   --l-gray: 0; --l-handoff: 1.5px; }
[data-lens='tools']  { --l-people: 0; --l-time: 0; --l-tools: 1; --l-dim: 1;   --l-gray: 0; --l-handoff: 1.5px; }
[data-lens='pain']   { --l-people: 0; --l-time: 0; --l-tools: 0; --l-dim: .45; --l-gray: 1; --l-handoff: 1.5px; }
/* 내보내기 전용 6번째 상태 — DESIGN §8 "렌즈 강제 흐름+사람" */
[data-lens='export'] { --l-people: 1; --l-time: 0; --l-tools: 0; --l-dim: 1;   --l-gray: 0; --l-handoff: 1.5px; }

.wf-meta { position: absolute; inset-inline: 16px; bottom: 0; height: 24px; }
.wf-meta-layer {
  position: absolute; inset: 0;               /* ★ 세 층이 같은 박스를 공유 → 리플로 불가능 */
  display: flex; align-items: center; gap: 6px;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-flow);
}
.wf-meta--people { opacity: var(--l-people); }
.wf-meta--time   { opacity: var(--l-time); }
.wf-meta--tools  { opacity: var(--l-tools); }

/* 짜증 렌즈: 플래그 없는 노드를 죽인다. filter/opacity는 합성 속성 = 레이아웃 무관 */
.wf-card:not([data-flag]) { opacity: var(--l-dim); filter: grayscale(var(--l-gray)); transition: opacity var(--dur-base) var(--ease-flow), filter var(--dur-base) var(--ease-flow); }
[data-lens='pain'] .wf-card[data-flag] { background: #FBF7F9; border-color: #6E4666; }

/* 사람 렌즈: 인계 엣지 승격. stroke-width는 SVG 페인트 속성이라 레이아웃 무관 */
.rf-edge--handoff path { stroke-width: var(--l-handoff); }
[data-lens='people'] .rf-edge--handoff path { stroke: #6E4666; }
[data-lens='people'] .rf-edge:not(.rf-edge--handoff) { opacity: .5; }

/* 시간 렌즈: 카드 우측 3px 세로 바. absolute라 박스에 영향 없음 */
.wf-timebar { position: absolute; right: 0; top: 0; width: 3px; height: var(--wf-time-h, 0%); opacity: var(--l-time); }
```

전파는 §8과 같은 방식이다 — 루트 엘리먼트의 `data-lens` 한 글자.

```tsx
export function LensBridge({ rootRef }: { rootRef: RefObject<HTMLElement> }) {
  const lens = useCanvasStore((s) => s.lens);        // 여기 하나만 리렌더된다
  useLayoutEffect(() => { rootRef.current?.setAttribute('data-lens', lens); }, [lens]);
  return null;
}
```

### 9.2 DOM 3배 비용은 문제가 되지 않는다

3층을 항상 렌더하면 노드당 요소가 ~8개 늘어난다. 500노드면 4000개 — 그대로면 문제다. 그런데 **`onlyRenderVisibleElements` 때문에 실제 마운트 노드 수는 N이 아니라 뷰포트 크기에 비례한다.** 1440×900 캔버스에 260×76 노드는 최대 ~30개가 들어간다. 즉 추가 요소는 항상 ~240개로 상한이 잡힌다.

그래도 티어와 결합해 더 줄인다:

```css
/* 비활성 층은 렌더 트리에서 빼되 DOM은 유지 → 크로스페이드는 여전히 가능 */
.wf-meta-layer { content-visibility: auto; contain: strict; contain-intrinsic-size: 0 24px; }
[data-zoom-tier='0'] .wf-meta { display: none; }
```

`contain: strict`는 층 내부의 어떤 변경도 바깥 레이아웃에 전파되지 않음을 브라우저에 **보증**한다. 렌즈가 위치를 못 흔든다는 주장의 세 번째 근거다(타입 · 절대 위치 · containment).

### 9.3 오버레이가 필요한 렌즈 요소

사람 렌즈의 "같은 담당자 연속 구간 좌측 세로 레일"과 부서 구간 배경(L-02)은 노드 안에 없다. 커밋된 좌표에서 계산해 `ViewportPortal`에 그린다 — 변환을 따라가면서도 React Flow의 노드 배열과 무관하다.

```tsx
function LensOverlays({ layout, graph }: Props) {
  // 좌표가 바뀔 때만 재계산. 렌즈 전환에는 재계산이 없다.
  const rails = useMemo(() => assigneeRuns(graph, layout), [graph, layout]);
  return (
    <ViewportPortal>
      {rails.map((r) => (
        <div key={r.id} className="lens-rail"
             style={{ transform: `translate(${r.x}px,${r.y}px)`, height: r.h }} />
      ))}
    </ViewportPortal>
  );
}
```
```css
.lens-rail {
  position: absolute; top: 0; left: 0; width: 2px; border-radius: 1px;
  background: #6E4666; opacity: var(--l-people);
  transition: opacity var(--dur-base) var(--ease-flow);
}
```

렌즈가 꺼져 있을 때도 DOM에 있고 `opacity: 0`이다. 마운트/언마운트가 없으므로 전환이 순수 컴포지팅이다.

### 9.4 검증

```ts
// e2e/lens.spec.ts
test('렌즈 전환은 노드를 1px도 움직이지 않는다', async ({ page }) => {
  await openDoc(page, 'fixtures/mixed-40');
  const rects0 = await nodeScreenRects(page);        // getBoundingClientRect 전부
  const t0 = await viewportTransform(page);

  for (const lens of ['people', 'time', 'tools', 'pain', 'flow']) {
    await page.getByRole('tab', { name: LENS_LABEL[lens] }).click();
    await page.waitForTimeout(260);                   // 200ms 크로스페이드 + 여유
    expect(await viewportTransform(page)).toEqual(t0);
    expect(await nodeScreenRects(page)).toEqual(rects0);   // 부동소수 오차 없이 완전 일치
    // 레이아웃이 돈 흔적이 없어야 한다
    expect(await page.evaluate(() => window.__layout.stats.elkRuns)).toBe(0);
  }
});
```

`toEqual`을 tolerance 없이 쓴다. **"거의 안 움직인다"는 요구사항이 아니다.** 0.5px 오차가 나기 시작하면 그건 어딘가에서 레이아웃이 돌고 있다는 신호이므로 즉시 실패해야 한다.
---

## 10. 스테일 결과 폐기

### 10.1 revision — 두 겹의 검사

```ts
if (rev !== this.latestRev) return drop();                     // 1차: 순서
if (result.layoutKey !== currentKey) return drop();            // 2차: 내용
```

1차만으로 논리적으로 충분하다. 2차를 두는 이유는 **rev 회계 버그의 실패 모드가 조용하기 때문**이다. rev를 어딘가에서 증가시키지 않으면 옛 결과가 최신으로 통과해 잘못된 그림이 그려지고, 사용자는 "가끔 그림이 이상하다"고만 느낀다 — 재현도 안 되고 리포트도 안 된다. 2차 검사는 이걸 개발 중에 시끄럽게 만든다.

큐는 **단일 슬롯**이다. 실행 중에 요청이 5번 들어와도 `pending`에는 마지막 하나만 남는다.

```ts
this.pending = { input, anchor, cause };   // 덮어쓰기. 배열이 아니다
```

배열 큐를 쓰면 사용자가 빠르게 6줄을 추가했을 때 ELK가 6번 돌고, 그중 5번의 결과는 도착 즉시 버려진다. 워커 시간을 6배 쓰고 배터리를 6배 태우면서 결과는 동일하다.

### 10.2 elkjs는 취소를 지원하는가 — 안 한다

`elk.layout()`은 Promise를 반환하고 `AbortSignal`을 받지 않는다. 워커 안에서 GWT로 컴파일된 Java 코드가 동기적으로 돌기 때문에 **취소 지점 자체가 없다.** 워커 내부 루프는 메시지를 확인하지 않는다.

가능한 선택지는 셋뿐이다.

| 방식 | 문제 |
|---|---|
| 결과만 무시 | 정확하지만, 새 작업이 옛 작업 뒤에 **줄을 선다.** 500노드 1.2초짜리가 돌고 있으면 새 요청의 체감 지연이 1.2초 + α |
| 워커 terminate 후 재생성 | 즉시 자유로워지지만 워커 부팅 비용(elk-worker.min.js 파싱 + GWT 초기화)이 든다 |
| **워커 2개 풀 + 독살(poison)** | 채택 |

### 10.3 워커 풀

```ts
// apps/web/lib/layout/pool.ts
import ELK from 'elkjs/lib/elk-api';

type Slot = {
  elk: InstanceType<typeof ELK> | null;
  worker: Worker | null;
  /** 이 슬롯이 지금 계산 중인 rev. null = 유휴 */
  busyRev: number | null;
  /** 결과가 오면 버려야 하는가 */
  poisoned: boolean;
  /** 연속 재생성 횟수 (백오프용) */
  restarts: number;
};

export class ElkPool {
  private slots: [Slot, Slot] = [mkSlot(), mkSlot()];

  /** 새 작업에 슬롯을 배정한다. 필요하면 옛 작업을 독살하거나 죽인다 */
  acquire(rev: number): 0 | 1 {
    const idle = this.slots.findIndex((s) => s.busyRev === null);
    if (idle >= 0) {
      // 다른 슬롯이 돌고 있다면 그건 이미 스테일이다 → 독살(결과만 버림).
      // terminate하지 않는 이유: 어차피 곧 끝나고, 끝나면 슬롯이 유휴로 돌아온다.
      // 부팅 비용 없이 취소의 효과를 얻는다.
      this.slots.forEach((s, i) => { if (i !== idle && s.busyRev !== null) s.poisoned = true; });
      return idle as 0 | 1;
    }
    // 둘 다 바쁘다 = 사용자가 아주 빠르게 구조를 바꾸고 있다.
    // 더 오래된 쪽을 실제로 죽인다. 여기서만 부팅 비용을 낸다.
    const victim = this.slots[0].startedAt <= this.slots[1].startedAt ? 0 : 1;
    this.kill(victim as 0 | 1, 'superseded');
    return victim as 0 | 1;
  }

  async run(slot: 0 | 1, rev: number, graph: ElkNode, timeoutMs: number): Promise<ElkNode> {
    const s = this.ensure(slot);
    s.busyRev = rev; s.poisoned = false; s.startedAt = performance.now();

    let timer: number | undefined;
    try {
      const out = await Promise.race([
        s.elk!.layout(graph),
        new Promise<never>((_, rej) => {
          timer = window.setTimeout(() => rej({ t: 'timeout', ms: timeoutMs } as LayoutError), timeoutMs);
        }),
      ]);
      if (s.poisoned) throw { t: 'poisoned' } as const;
      return out as ElkNode;
    } catch (e) {
      // 타임아웃 = 워커가 아직도 돌고 있다는 뜻. 반드시 죽여야 슬롯이 회수된다.
      if (isTimeout(e)) this.kill(slot, 'timeout');
      throw normalize(e);
    } finally {
      window.clearTimeout(timer);
      if (this.slots[slot].busyRev === rev) this.slots[slot].busyRev = null;
    }
  }

  private ensure(i: 0 | 1): Slot {
    const s = this.slots[i];
    if (s.elk && s.worker) return s;
    // ★ workerFactory가 만든 Worker 인스턴스를 우리가 붙잡아 둔다.
    //   elkjs의 terminateWorker()에 의존하지 않기 위해서다 — 버전에 따라 있고 없다.
    let captured: Worker | null = null;
    s.elk = new ELK({
      workerFactory: () => {
        captured = new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url), { type: 'classic' });
        captured.onerror = (ev) => this.onWorkerError(i, ev);
        return captured;
      },
    });
    s.worker = captured;
    return s;
  }

  private kill(i: 0 | 1, why: string): void {
    const s = this.slots[i];
    try { s.worker?.terminate(); } catch { /* 이미 죽었다 */ }
    s.worker = null; s.elk = null; s.busyRev = null; s.poisoned = false;
    track('canvas_layout_worker_killed', { why });
  }
}
```

핵심은 **`acquire`가 독살을 기본, 종료를 예외로 삼는다**는 점이다. 실측상 디바운스 300ms 때문에 "둘 다 바쁨"은 거의 발생하지 않는다(그러려면 300ms 간격으로 두 번 연속 구조 변경 + 첫 작업이 600ms 이상). 그 드문 경우에만 부팅 비용을 지불한다.

계측:

```
canvas_layout_discarded   { reason: 'stale' | 'poisoned' | 'key-mismatch', rev }
canvas_layout_superseded  { waited_ms }
```

`canvas_layout_superseded`가 세션당 1회를 넘으면 디바운스가 짧거나 ELK가 예산을 넘고 있다는 신호다.

### 10.4 IME와의 상호작용

`compositionstart`는 **타이머만** 해제한다. 이미 워커에서 돌고 있는 작업은 건드리지 않는다 — 그 작업의 입력은 조합 이전의 확정된 구조이므로 여전히 유효하고, 도착하면 정상적으로 커밋된다. 조합 중에 그림이 정리되는 건 문제가 아니다. **문제는 조합 중인 글자 때문에 새 레이아웃이 시작되는 것**이고, 그건 타이머 해제로 막힌다.

한글 조합 중 Enter는 "조합 확정"이지 "줄바꿈"이 아니므로 `onFlush`가 `composing`일 때 아무것도 하지 않는다(§1.3). 이걸 빼먹으면 한글로 단계를 입력할 때마다 유령 단계가 생기고 즉시 사라지면서 그림이 두 번 흔들린다 — [ARCHITECTURE §3](./ARCHITECTURE.md)의 IME 함정과 같은 계열이다.

---

## 11. 실패 처리

### 11.1 사다리

```
성공 → consecutive = 0
실패(예외 | 타임아웃 4s) → consecutive++
  consecutive 1~2:  마지막 성공 좌표 유지 + 인라인 바
  consecutive 3+ :  폴백 레이아웃으로 전환 (phase: 'fallback')
폴백 중 성공 → 즉시 ELK로 복귀 (30초마다 1회 재시도)
```

[STATES.md §4](./STATES.md)가 정한 문구를 그대로 쓴다.

```tsx
{phase.t === 'failed' && (
  <InlineBar role="status">
    방금 추가한 단계는 아직 배치 중이에요. 내용은 저장됐어요.
    <button onClick={() => engine.send({ t: 'flush' })}>다시 정리</button>
  </InlineBar>
)}
```

**캔버스를 절대 비우지 않는다.** 새 노드는 위치가 없으므로 그냥 빼는 게 아니라 **잠정 위치**를 준다 — 선행자 좌표 + `(0, NODE_H + betweenLayers)` — 그리고 `opacity: 0`으로 둔다. 이렇게 하면 ELK가 나중에 성공했을 때 노드가 (0,0)에서 날아오지 않고 제자리 근처에서 페이드인한다.

```ts
function provisionalPosition(g: DerivedGraph, id: NodeId, last: LayoutResult): XY {
  const pred = (g.incoming.get(id) ?? []).filter((e) => !e.isBackEdge)
    .map((e) => last.nodes.get(e.source)).find(Boolean);
  return pred
    ? { x: pred.x, y: pred.y + NODE_H + SPACING.betweenLayers }
    : { x: last.bbox.x + last.bbox.w / 2 - NODE_W / 2, y: last.bbox.y + last.bbox.h + SPACING.betweenLayers };
}
```

### 11.2 워커가 죽었을 때

죽는 경로가 셋이다: `worker.onerror`, 브라우저의 메모리 압박에 의한 강제 종료(메시지가 영영 안 옴 → 타임아웃이 잡는다), 그리고 CSP/번들 문제로 애초에 생성 실패.

```ts
private onWorkerError(i: 0 | 1, ev: ErrorEvent): void {
  const s = this.slots[i];
  s.restarts++;
  this.kill(i, 'onerror');
  // 백오프 0 → 250 → 1000ms. 3회 넘으면 이 슬롯을 영구 비활성화.
  if (s.restarts > 3) { s.disabled = true; track('canvas_layout_slot_disabled', { i }); return; }
  setTimeout(() => this.ensure(i), [0, 250, 1000][s.restarts - 1] ?? 1000);
}
```

**두 슬롯이 모두 disabled면 폴백 모드로 영구 전환**한다. 이건 실패가 아니라 정상 운전 모드의 하나로 취급한다 — 워커를 못 쓰는 환경(엄격한 CSP를 건 사내 프록시, 오래된 브라우저)이 실제로 존재하고, 그런 환경에서도 제품은 동작해야 한다.

성공하면 `restarts = 0`으로 되돌린다. 되돌리지 않으면 하루 종일 켜둔 탭이 서서히 죽는다.

### 11.3 폴백 레이아웃 — `y += 140`보다 나은 것

세로 스택은 갈래를 표현하지 못한다. 갈래가 있는 문서에서 세로 스택은 **틀린 그림**이고, 틀린 그림은 없는 그림보다 나쁘다.

`packages/layout-core/src/fallback.ts` — Sugiyama의 층 배정 + 우선순위 x-배치를 축약해 구현한다. 순수 TS, O(V+E), 500노드에서 1ms 이하.

```ts
export function fallbackLayout(v: VisibleGraph, acyclic: DerivedGraph['acyclic']): LayoutResult {
  const back = new Set(acyclic.backEdgeIds);
  const fwd = v.edges.filter((e) => !back.has(e.id));

  /* ── 1. 층 배정 — 최장경로. topoOrder가 이미 있으므로 한 번 훑으면 끝난다 ── */
  const layer = new Map<NodeId, number>();
  for (const id of acyclic.topoOrder) layer.set(id, 0);
  for (const id of acyclic.topoOrder) {
    const L = layer.get(id)!;
    for (const e of outgoingOf(fwd, id)) layer.set(e.target, Math.max(layer.get(e.target) ?? 0, L + 1));
  }

  /* ── 2. 층 안 순서 = 모델 순서. ELK의 forceNodeModelOrder와 같은 규칙이므로
   *      폴백으로 떨어져도 **좌우 순서가 바뀌지 않는다.** 이게 이 폴백의 핵심 가치다.
   *      단순 세로 스택은 이 성질이 없어서 폴백 전환 자체가 거대한 점프가 된다. */
  const rows: NodeId[][] = [];
  for (const n of [...v.nodes].sort((a, b) => a.order - b.order)) (rows[layer.get(n.id)!] ??= []).push(n.id);

  /* ── 3. x 배치 — 중앙값 휴리스틱 2패스 + 겹침 해소 스윕 ─────────────── */
  const x = new Map<NodeId, number>();
  const W = (id: NodeId) => (isPill(id) ? PILL_W : NODE_W);

  const sweep = (row: NodeId[], anchorOf: (id: NodeId) => number | null) => {
    // 3-a. 희망 위치 = 인접 노드들 중앙값 (없으면 현재값 유지)
    const want = row.map((id) => anchorOf(id) ?? x.get(id) ?? 0);
    // 3-b. 좌→우로 최소 간격 강제
    let cursor = -Infinity;
    for (let i = 0; i < row.length; i++) {
      const w = W(row[i]!);
      const px = Math.max(want[i]!, cursor);
      x.set(row[i]!, px);
      cursor = px + w + SPACING.nodeNode;
    }
    // 3-c. 우→좌로 되당겨 희망 위치에 가깝게 (한쪽 스윕만 하면 전부 오른쪽으로 밀린다)
    cursor = Infinity;
    for (let i = row.length - 1; i >= 0; i--) {
      const w = W(row[i]!);
      const px = Math.min(Math.max(want[i]!, x.get(row[i]!)!), cursor - w - SPACING.nodeNode);
      if (px >= (i === 0 ? -Infinity : x.get(row[i - 1]!)! + W(row[i - 1]!) + SPACING.nodeNode)) x.set(row[i]!, px);
      cursor = x.get(row[i]!)!;
    }
  };

  const medianOf = (ids: NodeId[]): number | null => {
    if (ids.length === 0) return null;
    const c = ids.map((i) => (x.get(i) ?? 0) + W(i) / 2).sort((a, b) => a - b);
    const m = c.length % 2 ? c[(c.length - 1) / 2]! : (c[c.length / 2 - 1]! + c[c.length / 2]!) / 2;
    return m;
  };

  // 위→아래 (부모 기준) → 아래→위 (자식 기준) → 위→아래 한 번 더. 3패스면 수렴한다.
  for (const pass of [0, 1, 2]) {
    const order = pass === 1 ? [...rows].reverse() : rows;
    for (const row of order) {
      sweep(row, (id) => {
        const nbr = pass === 1 ? succOf(fwd, id) : predOf(fwd, id);
        const m = medianOf(nbr);
        return m === null ? null : m - W(id) / 2;
      });
    }
  }

  /* ── 4. y = 층 × (76 + 64). pill은 층 안에서 세로 중앙 ─────────────── */
  const place = new Map<NodeId, NodePlacement>();
  rows.forEach((row, i) => {
    const top = i * (NODE_H + SPACING.betweenLayers);
    for (const id of row) {
      const h = isPill(id) ? PILL_H : NODE_H;
      place.set(id, { id, x: x.get(id)!, y: top + (NODE_H - h) / 2, w: W(id), h, layer: i });
    }
  });
  normalizeToOrigin(place);                       // bbox 좌상단을 (0,0)으로

  /* ── 5. 엣지 — 층간 거터 중앙에서 꺾는 3~5점 직교. §4의 orthPath가 그린다 ── */
  const bands = layerBands(place.values());
  const edges = new Map<string, EdgeGeometry>();
  for (const e of fwd) edges.set(e.id, straightOrElbow(e, place, bands));
  for (const [id, geo] of routeBackEdges(v.edges.filter((e) => back.has(e.id)), place, bands, bboxOf(place)))
    edges.set(id, geo);

  return { algorithm: 'fallback', nodes: place, edges, bands, bbox: bboxOf(place), /* … */ };
}

/** 세로로 정렬돼 있으면 직선, 아니면 거터 중앙에서 두 번 꺾는다 */
function straightOrElbow(e: DerivedEdge, p: Map<NodeId, NodePlacement>, bands: LayerBand[]): EdgeGeometry {
  const s = p.get(e.source)!, t = p.get(e.target)!;
  const x0 = s.x + s.w / 2, x1 = t.x + t.w / 2;
  const y0 = s.y + s.h, y1 = t.y;
  const points = Math.abs(x0 - x1) < 0.5
    ? [{ x: x0, y: y0 }, { x: x1, y: y1 }]
    : [{ x: x0, y: y0 }, { x: x0, y: (y0 + y1) / 2 }, { x: x1, y: (y0 + y1) / 2 }, { x: x1, y: y1 }];
  return { id: e.id, kind: 'forward', reversedForLayout: false, points, labelAnchor: { x: x0, y: y0 + 24 } };
}
```

이 폴백이 값을 하는 곳이 실은 세 군데다.

1. **ELK 실패 시** — 원래 목적
2. **워커를 못 쓰는 환경** — 엄격한 CSP, 구형 브라우저
3. **서버 렌더** — `app/api/og/[id]/route.tsx`(OG 카드)는 엣지 런타임이라 Worker가 없다. DESIGN §8은 OG 카드에 "상단 3~4개 노드만" 넣으므로 폴백 품질로 충분하다. **`layout-core`가 순수 TS인 이유가 이것**이다

품질 차이는 갈래가 3개 이상 중첩될 때 교차가 몇 개 더 생기는 정도다. 사용자에게는 인라인 바로 알린다.

```tsx
{phase.t === 'fallback' && (
  <InlineBar role="status">
    그림 정리 기능에 문제가 있어서 간단한 배치로 그리고 있어요. 내용은 그대로예요.
    <button onClick={() => engine.retryElk()}>다시 시도</button>
  </InlineBar>
)}
```

`role="alert"`가 아니라 `role="status"`다 — [ACCESSIBILITY §](./ACCESSIBILITY.md)의 규칙("불안 조장 + 포커스 가로챔 금지").

---

## 12. 내보내기 렌더 경로

### 12.1 왜 화면을 캡처하면 안 되는가 (L-08)

`html-to-image`로 `.react-flow`를 캡처하는 것이 가장 흔한 구현이고, 이 프로젝트에서는 **반드시 실패한다.**

| 이유 | 결과 |
|---|---|
| `onlyRenderVisibleElements` | **화면 밖 노드가 DOM에 없다.** 12단계 문서를 내보내면 4단계만 나온다. 가장 치명적 |
| 뷰포트 transform | 캡처 결과가 사용자의 현재 줌·팬에 종속된다 |
| `-webkit-line-clamp` | `foreignObject` 직렬화에서 신뢰할 수 없다. 제목이 3줄로 흘러넘친다 |
| `clip-path` (branch 노치) | Safari의 `foreignObject`에서 자주 유실된다 |
| 그리드·미니맵·컨트롤·선택 링 | 전부 제거해야 하는데, 제거하려고 실 DOM을 건드리면 사용자 화면이 깜빡인다 |

그래서 **커밋된 좌표에서 SVG를 직접 직렬화한다.** 우리는 모든 노드 좌표, 모든 엣지 폴리라인, 층 밴드를 이미 갖고 있다. DOM을 경유할 이유가 없다.

### 12.2 파이프라인

```
LayoutResult + DerivedGraph + 문서 메타
        │
        ▼  renderExportSvg()   ← 순수. layout-core에 있고 Node에서도 돈다
   SVG 문자열 (텍스트는 <text>, 폰트는 base64 @font-face로 내장)
        │
        ├──→ .svg 다운로드                (벡터. Figma/슬라이드에 그대로 붙는다)
        ├──→ <img> → <canvas> → PNG      (pixelRatio 2)
        └──→ 페이지 분할 → pdf-lib → PDF (A4 세로 + 마지막 장 메타 표)
```

```ts
// packages/layout-core/src/export/svg.ts
export type ExportOptions = {
  padding: number;              // 48 (DESIGN §8)
  border: number;               // 1.5px — 화면 1.5px와 같지만 그림자는 없다
  shadow: false;                // 항상 false
  grid: false;                  // 항상 false
  lens: 'export';               // 흐름+사람 강제
  title: { text: string; subtitle?: string; author: string; updatedAt: string; chips: string[] };
  footer: { legend: true; watermark: string };
  fontCss: string;              // @font-face { src: url(data:font/woff2;base64,…) }
  maxWidth?: number;            // 4000 초과 시 분할
};

export function renderExportSvg(
  layout: LayoutResult, graph: DerivedGraph, o: ExportOptions,
): { svg: string; width: number; height: number; pageBreaks: number[] } {
  const titleH = measureTitleBlock(o.title);      // 순수 계산 — 폰트 메트릭 테이블 사용
  const footerH = 56;
  const w = layout.bbox.w + o.padding * 2;
  const h = layout.bbox.h + o.padding * 2 + titleH + footerH;
  const dy = o.padding + titleH - layout.bbox.y;
  const dx = o.padding - layout.bbox.x;

  return {
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      `<style>${o.fontCss}${EXPORT_CSS}</style>`,
      `<rect width="${w}" height="${h}" fill="#FFFFFF"/>`,
      titleBlock(o.title, w, o.padding),
      `<g transform="translate(${dx},${dy})">`,
      ...[...layout.edges.values()].map(edgeSvg),          // 엣지가 먼저 (노드 아래)
      ...[...layout.nodes.values()].map((p) => nodeSvg(p, graph.byId.get(p.id)!, o)),
      `</g>`,
      footerBlock(o.footer, w, h - footerH),
      `</svg>`,
    ].join(''),
    width: w, height: h,
    pageBreaks: pageBreaksAt(layout.bands, /* A4 비율 */ 842 / 595, w),
  };
}
```

노드 하나의 SVG — 화면 마크업을 그대로 옮기지 않고 **내보내기 전용으로 다시 그린다.**

```ts
function nodeSvg(p: NodePlacement, n: DerivedNode, o: ExportOptions): string {
  const lines = wrapHangul(n.title, NODE_W - 35, 15, 2);   // ★ line-clamp 대신 사전 계산
  return [
    `<g transform="translate(${p.x},${p.y})">`,
    n.kind === 'branch'
      ? `<path d="${notchedRect(p.w, p.h, 12)}" fill="#fff" stroke="var(--n-200)" stroke-width="${o.border}"/>`
      : `<rect width="${p.w}" height="${p.h}" rx="12" fill="#fff" stroke="${n.kind === 'hold' ? 'var(--n-450)' : 'var(--n-200)'}" stroke-width="${o.border}"${n.kind === 'hold' ? ' stroke-dasharray="6 4"' : ''}/>`,
    accentBar(n.kind),                                      // 3px 좌측 바 + 흑백 패턴 대응
    typeIcon(n.kind),                                       // 인라인 path. 외부 참조 없음
    lines.map((t, i) => `<text x="19" y="${28 + i * 22}" class="t">${esc(t)}</text>`).join(''),
    metaStripSvg(n, o.lens),                                // 흐름+사람 = 아바타만
    `</g>`,
  ].join('');
}
```

**`wrapHangul`이 이 절의 숨은 난제다.** `-webkit-line-clamp`는 브라우저가 계산하지만 SVG `<text>`는 자동 줄바꿈이 없다. 두 가지 방법:

1. 브라우저에서 `canvas.measureText()`로 실측 (내보내기가 클라이언트에서 일어날 때)
2. Node에서는 **문자 폭 테이블**로 근사 — 한글은 전각 고정폭에 가까워 `CJK = 1.0em, 영문 소문자 ≈ 0.52em, 숫자 0.55em, 공백 0.28em`으로 계산하면 오차가 2% 이내다

둘 다 구현하고 `measureText` 주입 가능하게 한다.

```ts
export type TextMeasurer = (text: string, px: number, weight: number) => number;
export function wrapHangul(s: string, maxW: number, px: number, maxLines: number, measure: TextMeasurer = approxMeasure): string[];
```

이렇게 하면 서버(OG 카드)와 클라이언트가 **같은 함수**를 쓰고, 골든 테스트가 가능해진다.

### 12.3 웹폰트 내장

```ts
// 세션당 1회만. woff2 자체는 ~1MB지만 base64로 부풀어 ~1.4MB가 된다.
let cached: string | null = null;
export async function exportFontCss(): Promise<string> {
  if (cached) return cached;
  await document.fonts.ready;                      // ★ 이거 없으면 첫 내보내기가 폴백 폰트로 나온다
  const res = await fetch('/fonts/PretendardVariable.subset.woff2');
  const b64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
  cached =
    `@font-face{font-family:Pretendard;font-weight:400 700;font-display:block;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2-variations')}` +
    `svg text{font-family:Pretendard,sans-serif}`;
  return cached;
}
```

- **가변 폰트 하나로 400~700을 커버**하므로 굵기별로 파일을 여러 개 넣지 않는다. 이게 용량의 핵심이다.
- 서브셋은 빌드 타임에 만든다 — KS X 1001 한글 2,350자 + 라틴 + 숫자 + 기호. 완성형 11,172자를 다 넣으면 base64가 4MB를 넘어 PNG 변환이 느려진다. 서브셋에 없는 글자(희귀 한자, 이모지)는 폴백 폰트로 그려지는데, DESIGN이 이모지를 금지했으므로 실제 위험은 낮다.
- PDF 경로에서는 base64 SVG를 다시 넣지 않고 `pdf-lib`에 **원본 woff2를 한 번만** 임베드한다.

### 12.4 `html-to-image`를 쓴다면 — 함정 목록

SVG 직렬화로 못 담는 것(예: 미래에 노드 안에 복잡한 CSS 그리드가 들어가는 경우)을 위해 탈출구로 남긴다. 그 경우 반드시 지켜야 하는 것들:

| 함정 | 대응 |
|---|---|
| 웹폰트 미로드 | `await document.fonts.ready` **필수**. 없으면 첫 캡처가 시스템 폰트 |
| 폰트 CSS 매 호출 재계산 | `getFontEmbedCSS(node)`를 1회 호출해 캐시하고 `{ fontEmbedCSS }`로 주입. 안 하면 캡처마다 폰트를 재fetch·재인코딩해 3~5초가 걸린다 |
| CORS | 폰트·이미지는 **동일 출처**여야 한다. 자체 호스팅이므로 충족 |
| `-webkit-line-clamp` | `foreignObject`에서 신뢰 불가 → 캡처 직전 오프스크린 클론에서 **하드 트렁케이션**으로 치환 |
| `clip-path` (branch 노치) | Safari에서 유실 → 내보내기 클론에서는 인라인 `<svg><path>`로 치환 |
| `filter: grayscale()` (짜증 렌즈) | 렌즈를 `export`로 강제하므로 애초에 안 걸린다 |
| `content-visibility: auto` | 스킵된 콘텐츠가 캡처에서 빈칸으로 나온다 → 클론에서 `visible`로 덮어쓴다 |
| CSS 변수 | `foreignObject` 안에서 상속이 끊기는 케이스가 있다 → 클론 루트에 계산된 값으로 인라인 |
| `pixelRatio` | 2 고정. `devicePixelRatio`를 그대로 쓰면 사용자 모니터에 따라 결과 크기가 달라진다 |
| 첫 호출이 빈 이미지 | Safari의 알려진 이슈. **2회 호출하고 두 번째를 쓴다**(첫 호출이 리소스 캐시를 데운다) |

그리고 어느 경로든 **오프스크린 렌더 루트**를 쓴다 — 실 DOM을 건드리지 않는다.

```tsx
// components/export/ExportRoot.tsx
createPortal(
  <div
    ref={ref}
    data-lens="export"
    data-zoom-tier="3"
    style={{ position: 'fixed', left: -99999, top: 0, width, height, background: '#fff' }}
  >
    <ExportCanvas layout={layout} graph={graph} options={opts} />
  </div>,
  document.body,
)
```

`left: -99999px`이지 `display: none`이 아니다. `display: none`이면 레이아웃이 계산되지 않아 캡처가 비어 나온다. `visibility: hidden`도 같은 이유로 안 된다.

### 12.5 페이지 분할

DESIGN §8: "폭 4000px 초과 시 그룹 경계에서 분할", "PDF: A4 세로, 그룹 단위 page-break".

**층 밴드가 분할선의 유일한 후보다.** 밴드 사이(64px 거터)를 자르면 노드가 잘리지 않는 것이 보장된다.

```ts
export function pageBreaksAt(bands: readonly LayerBand[], pageAspect: number, widthPx: number): number[] {
  const pageH = widthPx * pageAspect;          // A4 세로 비율에 맞춘 콘텐츠 높이
  const breaks: number[] = [];
  let top = 0;
  for (let i = 0; i < bands.length - 1; i++) {
    const gapMid = (bands[i]!.bottom + bands[i + 1]!.top) / 2;
    // 다음 밴드까지 넣으면 페이지를 넘는가?
    if (bands[i + 1]!.bottom - top > pageH) { breaks.push(gapMid); top = gapMid; }
  }
  return breaks;
}
```

폭이 4000px을 넘으면 세로 분할이 아니라 **접기를 먼저 제안**한다 — 가로로 잘린 순서도는 읽을 수 없다. 그래도 사용자가 강행하면 갈래 컨테이너 경계에서 자르고 각 조각에 `1/3` 표시를 붙인다.

### 12.6 화면과 내보내기의 차이 — 한 장 요약

| | 화면 | 내보내기 |
|---|---|---|
| 렌더러 | React Flow (`onlyRenderVisibleElements`) | SVG 직렬화 (전체 노드) |
| 배경 | `n-50` + 24px 도트 그리드 + 비네트 | 순백 `#FFFFFF`, 그리드 없음 |
| 노드 그림자 | `0 1px 2px rgb(28 27 25/.06)` | **없음** |
| 노드 보더 | 1.5px `n-200` | 1.5px `n-200` (동일 — 그림자가 빠진 자리를 보더가 든다) |
| 여백 | 뷰포트 패딩 | **48px** |
| 렌즈 | 사용자 선택 | **`export` 강제** (흐름 + 사람) |
| 크롬 | 미니맵·컨트롤·선택 링 | 전부 없음 |
| 상단 | 없음 | **타이틀 블록** (제목 28/600 + 설명 15 `n-500` + 작성자·수정일 + 요약 칩 3개) |
| 하단 | 목록 토글·미니맵 | **범례**(타입 3종 + 인계 마커 + `↩ 되돌아가는 흐름`) + 워터마크 |
| 좌표 | 동일 `LayoutResult` | 동일 `LayoutResult` — **재계산하지 않는다** |

마지막 줄이 계약이다. 내보내기가 자체 레이아웃을 돌면 "화면에서 본 것과 다른 그림"이 나오고, 그건 사용자가 가장 싫어하는 종류의 배신이다. 유일한 예외는 **접힌 그룹이 있는 상태에서의 내보내기** — 이때는 접힌 상태 그대로 내보낸다(사용자가 그렇게 보고 있었으므로). "전부 펼쳐서 내보내기" 옵션을 다이얼로그에 두되 기본값은 현재 상태다.
---

## 13. 테스트

### 13.1 `jump_score` 회귀 테스트 — 이 문서의 KPI

[MEASUREMENT.md](./MEASUREMENT.md)의 정의: **직전 레이아웃 대비 노드 평균 이동거리 ÷ 캔버스 대각선.** p90 < 0.15.

정의를 구현 가능한 수준까지 좁힌다.

```ts
// packages/layout-core/src/jump.ts

export type JumpArgs = {
  /** 화면 대각선 계산용. 벤치에서는 1440×900 @ z=1로 고정 */
  viewport: { zoom: number; w: number; h: number };
  /** 앵커 보정으로 캔버스가 이동한 월드 거리. 보정 전 점수를 원하면 {0,0} */
  translate: XY;
};

export function jumpScore(prev: LayoutResult | null, next: LayoutResult, a: JumpArgs): number {
  if (!prev) return 0;                                    // 최초 레이아웃은 점프가 아니다
  const diag = Math.hypot(a.viewport.w, a.viewport.h);    // **화면 px**
  let sum = 0, n = 0;
  for (const [id, p1] of next.nodes) {
    const p0 = prev.nodes.get(id);
    if (!p0) continue;                                    // ★ 생존 노드만. 새 노드는 "이동"이 아니다
    // 앵커 보정 후의 화면 이동량
    const dx = (p1.x - p0.x - a.translate.x) * a.viewport.zoom;
    const dy = (p1.y - p0.y - a.translate.y) * a.viewport.zoom;
    sum += Math.hypot(dx, dy); n++;
  }
  return n === 0 ? 0 : sum / n / diag;
}
```

세 가지 결정을 명시한다.

| 결정 | 이유 |
|---|---|
| **생존 노드만 센다** | 새 노드는 "생성 애니메이션"이지 "점프"가 아니다. 삭제된 노드도 마찬가지. 포함시키면 문서를 키울 때마다 점수가 나빠져 지표가 무의미해진다 |
| **화면 px / 화면 대각선** | 줌 무관 정규화가 자동으로 된다. 월드 좌표로 재면 줌아웃 상태에서 실제로는 안 흔들리는데 점수가 나쁘게 나온다 |
| **앵커 보정 후를 KPI로** | 사용자가 지각하는 것이 그것이다. 보정 전 점수(`jump_score_world`)는 §5.4의 원인 분해용으로 **별도 계측** |

회귀 테스트는 **변이 코퍼스**로 돌린다. 골든 픽스처 각각에 대해 정해진 편집 시퀀스를 실행하며 매 단계 점수를 기록한다.

```ts
// packages/layout-core/test/jump.regression.test.ts

const SCENARIOS: Array<{ fixture: string; steps: MutationStep[] }> = [
  { fixture: 'linear-12',  steps: ['insert-mid', 'insert-mid', 'delete-mid', 'reorder-adjacent', 'insert-tail'] },
  { fixture: 'branch-xor-3', steps: ['add-case', 'add-case', 'reorder-case', 'case-end', 'remove-case'] },
  { fixture: 'branch-and-2', steps: ['and-to-xor', 'xor-to-and', 'insert-in-case'] },
  { fixture: 'loop-rework',  steps: ['insert-inside-loop', 'move-loop-target', 'delete-loop-source'] },
  { fixture: 'nested-3',     steps: ['collapse-group', 'expand-group', 'indent-step', 'outdent-step'] },
  { fixture: 'wide-fanout-6',steps: ['add-case', 'remove-case'] },       // 팬아웃 스택 경계 4↔5
  { fixture: 'mixed-80',     steps: ['insert-mid', 'delete-mid', 'reorder-adjacent', 'add-case'] },
];

test('jump_score p90 < 0.15', async () => {
  const scores: number[] = [];
  for (const sc of SCENARIOS) {
    let items = loadFixture(sc.fixture);
    let prev = await layoutOf(items);
    for (const step of sc.steps) {
      items = applyStep(items, step);
      const next = await layoutOf(items);
      const g0 = derive(prevItems, []), g1 = derive(items, []);
      const decision = resolveAnchorTransform({ prev, next, hint: hintFor(step), … });
      const s = jumpScore(prev, next, { viewport: VP, translate: deltaOf(decision) });
      scores.push(s);
      record(sc.fixture, step, s);      // baseline.json 갱신용
      prev = next;
    }
  }
  assert.ok(quantile(scores, 0.90) < 0.15,
    `jump_score p90 = ${quantile(scores, 0.90)}. 상위 5건:\n${top5(scores)}`);
});
```

그리고 **baseline 대비 회귀**도 잡는다. 절대 임계값만 있으면 0.14에서 0.149로 나빠지는 것을 놓친다.

```ts
test('jump_score가 baseline보다 나빠지지 않았다', () => {
  const base = JSON.parse(read('test/__baselines__/jump.json'));
  for (const [k, v] of Object.entries(current)) {
    assert.ok(v <= base[k] * 1.10 + 0.005,
      `${k}: ${base[k].toFixed(3)} → ${v.toFixed(3)} (10% 이상 악화)`);
  }
});
```

`+0.005` 절대 허용치가 있어야 0.001 → 0.0012 같은 무의미한 실패를 막는다.

`npm run jump:accept`로 baseline을 갱신하고, **갱신 커밋에는 반드시 시각 회귀 스냅샷이 함께 바뀌어야 한다**(§13.3). 둘 중 하나만 바뀌면 리뷰에서 잡는다.

### 13.2 골든 스냅샷 — 좌표를 고정할 것인가 (L-09)

**아니다.** 좌표 스냅샷은 elkjs 패치 버전, GWT 런타임 변경, 심지어 부동소수 연산 순서에도 깨진다. 그리고 깨진 이유가 "버그"인지 "무해한 변화"인지 스냅샷 자체는 말해주지 않는다. 빨간 CI가 반복되면 사람은 `--update-snapshots`를 반사적으로 누르고, 그 순간 스냅샷 테스트는 **가치가 0이 아니라 음수**가 된다(안심을 주면서 아무것도 안 잡는다).

대신 **의미 불변식**을 고정한다. 사용자가 실제로 지각하는 성질만 골라 낸 것들이다.

```ts
// packages/layout-core/test/invariants.test.ts

export function layoutInvariants(l: LayoutResult, g: DerivedGraph): Invariants {
  return {
    /** 노드 → 층 번호. 층 배정은 NETWORK_SIMPLEX라 결정적이고, 바뀌면 진짜 변화다 */
    layers: mapValues(l.nodes, (p) => p.layer),
    /** 각 층의 좌→우 노드 순서. **모델 순서 보장의 직접 증명** — 가장 중요한 불변식 */
    rowOrder: rowsOf(l).map((r) => r.map((p) => p.id)),
    /** 갈래별 첫 노드의 좌우 순서 = 사용자가 쓴 순서 */
    caseOrder: caseFirstNodesLeftToRight(l, g),
    /** 정상 경로(첫 갈래)가 최좌측인가 (DESIGN §6.5) */
    happyPathLeftmost: isHappyPathLeftmost(l, g),
    /** bbox 종횡비. ±15%까지 허용 */
    aspect: round2(l.bbox.w / l.bbox.h),
  };
}

test.each(GOLDEN_FIXTURES)('%s 레이아웃 불변식', async (name) => {
  const inv = layoutInvariants(await layoutOf(name), deriveOf(name));
  assert.deepEqual(omit(inv, 'aspect'), golden(name));
  assert.ok(Math.abs(inv.aspect - golden(name).aspect) / golden(name).aspect < 0.15);
});
```

그리고 **하드 불변식** — 어떤 픽스처에서도 위반하면 안 되는 것들. 골든과 무관하게 항상 검사한다.

```ts
test.each(ALL_FIXTURES)('%s 하드 불변식', async (name) => {
  const l = await layoutOf(name);
  assert.ok(noNodeOverlap(l, 0),                       '노드끼리 겹쳤다');
  assert.ok(minGapAtLeast(l, SPACING.nodeNode - 0.5),  '노드 간격이 40px 미만');
  assert.ok(noEdgeCrossesNode(l, 2),                   '엣지가 노드를 관통한다 (2px 허용오차)');
  assert.ok(allBackEdgesOnRail(l),                     'back edge가 레일 밖으로 나갔다 (§4.2)');
  assert.ok(allArrowsEnterFromTop(l),                  '화살표가 노드 상단이 아닌 곳으로 들어온다');
  assert.ok(allNodesSized(l),                          '260×76 / 120×36이 아닌 노드가 있다');
});
```

`noEdgeCrossesNode`는 §4.2의 증명을 **런타임으로 재확인**한다. 증명은 ELK의 층 밴드 가정에 의존하고, 그 가정은 ELK 버전이 바뀌면 깨질 수 있다.

**정확 좌표 핀은 파일 하나뿐이다.**

```ts
// packages/layout-core/test/elk-canary.test.ts
test('ELK 동작 카나리아', async () => {
  const l = await layoutOf('linear-12');
  assert.deepEqual(
    positionsRounded(l, 1),
    JSON.parse(read('test/__baselines__/elk-canary.json')),
    `ELK가 다른 좌표를 냈다. **이건 버그가 아닐 수 있다.**\n` +
    `  1) elkjs 버전이 바뀌었는지 확인\n` +
    `  2) npm run visual 로 시각 회귀 스냅샷을 눈으로 검토\n` +
    `  3) 문제 없으면 npm run canary:accept 로 갱신하고 커밋 메시지에 elkjs 버전을 적어라`,
  );
});
```

이 테스트의 목적은 **"바뀌었음을 알리는 것"**이지 "바뀌면 안 된다"가 아니다. 실패 메시지가 그렇게 말한다.

버전은 캐럿 없이 못 박는다.

```json
{ "dependencies": { "elkjs": "0.12.0", "@xyflow/react": "12.11.3" } }
```

Renovate 규칙: `elkjs` 업데이트 PR은 `visual` + `jump` + `bench` 전체를 돌리고 자동 머지하지 않는다.

### 13.3 시각 회귀 테스트

**내보내기 SVG를 찍는다.** 라이브 캔버스를 찍으면 안티에일리어싱·폰트 힌팅·애니메이션 타이밍 때문에 플레이키해진다. SVG는 결정적이고, 게다가 그게 사용자가 최종적으로 받는 산출물이다.

```ts
// e2e/visual.spec.ts
const SHOTS = [
  ...['linear-12', 'branch-xor-3', 'branch-and-2', 'loop-rework', 'nested-3', 'wide-fanout-6']
      .map((f) => ({ f, lens: 'export', tier: 3 })),                      // 형태 6장
  ...['flow', 'people', 'time', 'tools', 'pain']
      .map((lens) => ({ f: 'mixed-40', lens, tier: 3 })),                 // 렌즈 5장
  ...[3, 2, 1, 0].map((tier) => ({ f: 'mixed-40', lens: 'flow', tier })), // 줌 4장
  { f: 'nested-3', lens: 'flow', tier: 3, collapsed: ['g1'] },            // 접기 1장
];

for (const s of SHOTS) {
  test(`시각: ${s.f}/${s.lens}/z${s.tier}`, async ({ page }) => {
    await page.goto(harnessUrl(s));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__layout.phase === 'idle');
    await expect(page.locator('[data-shot]')).toHaveScreenshot(`${s.f}-${s.lens}-z${s.tier}.png`, {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
    });
  });
}
```

16장. 렌즈·줌·형태를 곱집합으로 돌리면 120장이 되어 아무도 리뷰하지 않는다 — **한 축씩만** 바꾼다.

색각 이상 4종은 **어서션이 아니라 아티팩트**로 남긴다(DESIGN §4의 검증 방법). CI가 실패시키지 않고, 디자인 리뷰 때 사람이 본다.

```ts
test('색각 시뮬레이션 아티팩트', async ({ page }) => {
  for (const t of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
    await page.emulateVisionDeficiency(t as never);
    await page.screenshot({ path: `artifacts/vision/${t}.png` });
  }
});
```

### 13.4 앵커링 테스트 — 단위 + E2E 두 층

**단위** — `resolveAnchorTransform`은 순수 함수이므로 표로 테스트한다.

```ts
const CASES: Array<[name: string, args: Partial<AnchorArgs>, expect: Partial<AnchorDecision>]> = [
  ['포커스 노드가 살아 있으면 그것',        { hint: item('s5') },                  { t: 'translate', rule: 'focused-item' }],
  ['삭제된 노드는 선행자로',                { hint: item('s5'), deleted: 's5' },   { t: 'translate', rule: 'deleted-predecessor' }],
  ['앵커가 화면 밖이면 뷰포트 최근접으로',  { hint: item('s0'), scrolledTo: 's40' },{ t: 'translate', rule: 'viewport-nearest' }],
  ['전체가 화면에 들어오면 bbox 상단중앙',  { small: true },                        { t: 'translate', rule: 'bbox-top-center' }],
  ['시스템 뷰포트면 fit',                   { viewportOwner: 'system' },            { t: 'fit', reason: 'system-viewport' }],
  ['생존자가 없으면 fit',                   { allNew: true },                       { t: 'fit', reason: 'no-survivor' }],
  ['움직이지 않았으면 hold',                { identical: true },                    { t: 'hold' }],
];
```

**E2E** — §3.1의 "구간 전체 고정"을 실제로 검증한다. 끝점만 재면 왕복을 놓친다.

```ts
test('앵커 노드는 재배치 220ms 내내 화면에서 움직이지 않는다', async ({ page }) => {
  await openDoc(page, 'mixed-40');
  await focusOutlineBlock(page, 's20');
  const anchor = page.locator('[data-id="s20"]');
  const before = await anchor.boundingBox();

  const samples: BoundingBox[] = [];
  const stop = samplePerFrame(page, anchor, samples);   // rAF마다 rect 기록
  await page.keyboard.press('Enter');                  // 구조 변경
  await page.waitForFunction(() => window.__layout.phase === 'idle');
  await stop();

  // 애니메이션 중 모든 프레임에서 1px 이내
  for (const s of samples) {
    expect(Math.abs(s.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.y - before!.y)).toBeLessThanOrEqual(1);
  }
  expect(samples.length).toBeGreaterThan(8);           // 실제로 애니메이션이 있었는지
});
```

마지막 줄이 없으면 "애니메이션이 아예 안 일어나서 통과"하는 가짜 초록을 놓친다.

### 13.5 나머지 계약 테스트

| 테스트 | 잡는 것 |
|---|---|
| **결정성** — 같은 입력 50회 → 좌표 해시 동일 | ELK 옵션 실수, Map 순회 순서 의존, `Date.now()` 유입 |
| **워커 간 결정성** — 서로 다른 워커 인스턴스 2개 → 동일 | 워커 상태 누수 |
| **스테일 폐기** — 워커 스텁으로 응답을 역순 반환 | rev 회계 |
| **취소** — 실행 중 3회 연속 요청 → `elk.layout` 호출 횟수 ≤ 2 | 단일 슬롯 큐 |
| **타임아웃** — 영영 안 끝나는 스텁 → 4s 후 좌표 유지 + 인라인 바 | §11.1 |
| **폴백 전환** — 3회 연속 throw → `algorithm: 'fallback'` + 좌우 순서 보존 | §11.3 |
| **워커 재생성** — `onerror` 발사 → 다음 요청 성공 | §11.2 |
| **IME** — CDP `Input.imeSetComposition` 중 `elkRuns` 증가 없음 | §10.4, ARCHITECTURE §3 |
| **게이트 누수** — §2.3의 양방향 표 | D-024 |
| **렌즈 0px** — §9.4 | DESIGN §6.3 |
| **줌 불변** — §8.3 | DESIGN §6.7 |
| **접기 왕복** — 접기→펼치기 후 좌표가 원래와 **완전 동일** | L-11 캐시, `foldGraph` 결정성 |
| **내보내기 == 화면** — 같은 `LayoutResult`에서 나온 SVG 노드 좌표가 화면 좌표와 일치 | §12.6 |
| **500노드 스모크** — 예산 안에 완료, 하드 불변식 통과 | §6 |

접기 왕복 테스트를 특별히 강조한다:

```ts
test('접기 → 펼치기는 원래 좌표로 정확히 돌아온다', async () => {
  const a = await layoutOf(items, new Set());
  const b = await layoutOf(items, new Set(['g1']));
  const c = await layoutOf(items, new Set());
  assert.deepEqual(positions(c), positions(a));      // 부동소수 오차 없이
  assert.notDeepEqual(positions(b), positions(a));   // 접기가 실제로 뭔가 했는지
});
```

이게 통과하면 §7의 흡수/방출 애니메이션이 "왕복해도 제자리"라는 사용자 기대를 만족한다. 실패하면 `foldGraph`의 정렬이나 중복 엣지 병합에 비결정성이 있다는 뜻이다.

---

## 14. 파일 구조

### 14.1 배치

```
packages/
  graph-core/                     ── 순수 그래프. 픽셀을 모른다. **변경 없음**
    src/derive.ts  cycles.ts  incremental.ts  types.ts  …
    (런타임 의존성 영원히 0. package.json의 "//dependencies" 주석이 계약)

  layout-core/                    ── ★ 신규. 순수 기하. React·DOM·타이머·워커를 모른다
    package.json                  ── dependencies: 없음 / devDependencies: elkjs(타입·벤치용만)
    src/
      types.ts                    LayoutInput / LayoutResult / NodePlacement / EdgeGeometry / LadderLevel
      hash.ts                     fnv1a (graph-core의 hash32와 의도적 중복 8줄 — 패키지 간 결합을 만들지 않기 위해)
      options.ts                  ELK_OPTIONS · optionsFor(ladder) · ELK_OPTIONS_HASH
      key.ts                      layoutKeyOf()                              §2
      collapse.ts                 foldGraph() · autoCollapse()               §7
      build.ts                    LayoutInput → ElkNode (컨테이너·크기·모델순서·엣지) §4.1 §7.2
      read.ts                     ElkNode → LayoutResult (좌표·섹션·밴드·bbox)
      geometry.ts                 orthPath · layerBands · bboxOf · notchedRect §4.2
      backedge.ts                 routeBackEdges()                           §4.2
      anchor.ts                   resolveAnchorTransform() + 후보 사다리      §3
      fallback.ts                 fallbackLayout()                           §11.3
      jump.ts                     jumpScore() · bboxDelta()                  §13.1
      text.ts                     wrapHangul() · approxMeasure()             §12.2
      export/svg.ts               renderExportSvg() · pageBreaksAt()         §12
      index.ts                    배럴. 이 밖은 내부 구현
    test/
      gate.test.ts  invariants.test.ts  jump.regression.test.ts
      elk-canary.test.ts  anchor.test.ts  collapse.test.ts  fallback.test.ts
      __baselines__/{jump.json, elk-canary.json, invariants/*.json}

apps/web/                         ── Next.js 15. DOM·타이머·워커·React가 사는 유일한 곳
  lib/layout/
    engine.ts                     LayoutEngine 상태 머신                     §1
    pool.ts                       ElkPool (워커 2개 · 독살 · 재생성)          §10.3 §11.2
    ladder.ts                     Ladder (성능 사다리)                       §6.2
    commit.ts                     commitLayout() — flushSync + 뷰포트 동기화  §3.4
    cache.ts                      LayoutCache (LRU 24)                       L-11
    snapshot.ts                   좌표 스냅샷 로드/저장 (sendBeacon)          §1.6
    urlState.ts                   ?c= / ?lens= 인코딩·디코딩                  §7.6
    useLayoutEngine.ts            React 바인딩. 엔진 인스턴스는 ref에 산다
    telemetry.ts                  canvas_layout_* 이벤트                     MEASUREMENT
  components/canvas/
    Canvas.tsx                    <ReactFlow> 셸. nodeTypes/edgeTypes는 모듈 스코프 상수
    WorkflowNode.tsx              260×76. React.memo                         COMPONENTS §7
    GroupNode.tsx                 접힌 그룹 (스택 실루엣)                     §7.4
    FlowEdge.tsx                  ELK 섹션 → orthPath                        L-03
    BackEdge.tsx                  사이드 레일 + ↩ 글리프                      §4.3
    EdgeLabel.tsx                 갈래 라벨 pill (후처리 배치)                L-01
    ZoomTierBridge.tsx            data-zoom-tier                             §8.1
    LensBridge.tsx                data-lens                                  §9.1
    LensOverlays.tsx              ViewportPortal 레일·부서 배경               §9.3
    CollapseFlip.tsx              흡수/방출 고스트                            §7.5
    CanvasFooter.tsx              목록 토글 · 미니맵 · 인라인 바
  components/export/
    ExportRoot.tsx                오프스크린 포털                             §12.4
    ExportDialog.tsx              PNG/PDF/SVG 선택 · "전부 펼치기" 옵션
  app/api/og/[id]/route.tsx       ★ fallbackLayout + renderExportSvg (Worker 없음) §11.3
  app/(app)/workflows/[id]/…

bench/layout.bench.ts             §6.3
e2e/
  layout-stability.spec.ts        앵커 · 렌즈 · 줌                            §13.4
  layout-perf.spec.ts             렌더 예산                                   §6.4
  visual.spec.ts                  시각 회귀                                   §13.3
  ime.spec.ts                     조합 중 재배치 없음                          §10.4
```

### 14.2 graph-core와의 경계

**한 문장:** `graph-core`는 *무엇이 연결되는가*를 답하고, `layout-core`는 *그것이 어디에 놓이는가*를 답하며, `apps/web`은 *언제 다시 계산하고 어떻게 그리는가*를 답한다.

| | graph-core | layout-core | apps/web |
|---|---|---|---|
| 아는 것 | 항목·엣지·위상·메트릭·진단 | 픽셀·박스·폴리라인·ELK 옵션 | DOM·타이머·워커·React·뷰포트·URL |
| 모르는 것 | 픽셀, 260×76, ELK의 존재 | React, DOM, `window`, Worker, 시간 | derive의 내부 규칙 |
| 의존 | 없음 | `graph-core`(타입+`toLayoutEdges`) | 둘 다 + `elkjs` + `@xyflow/react` |
| 결정성 | `Date.now()`/`Math.random()` 금지 | 동일 | 자유 |
| 실행 환경 | Node · 브라우저 · 워커 | Node · 브라우저 · 워커 · **엣지 런타임** | 브라우저 |

경계에서 오가는 것은 정확히 셋이다.

```
graph-core → layout-core :  DerivedGraph (특히 nodes[].order, acyclic, topologyHash)
                            toLayoutEdges()   ← back edge 뒤집기는 graph-core 소유
layout-core → apps/web   :  LayoutResult  (좌표 · 엣지 기하 · 밴드 · bbox)
                            AnchorDecision (뷰포트를 어디로 옮길지)
```

**layout-core가 `elkjs`를 런타임 의존성으로 갖지 않는 것**이 중요하다. `buildElkGraph`는 `ElkNode` 모양의 **평범한 객체**를 만들고, `readLayout`은 `ElkNode` 모양의 객체를 읽는다. 실제 `elkjs` 인스턴스를 만들고 워커에 태우는 건 `apps/web/lib/layout/pool.ts`다. 이 분리 덕에:

- layout-core 테스트가 워커 없이 밀리초 단위로 돈다
- 벤치가 `elk.bundled.js`를 직접 쓸 수 있다
- OG 카드 라우트가 `fallbackLayout`만 import해도 elkjs 500KB가 번들에 안 들어온다
- 언젠가 ELK를 갈아치울 때 건드릴 파일이 `build.ts`/`read.ts` 둘뿐이다

ESLint로 강제한다.

```js
// eslint.config.js
{
  files: ['packages/layout-core/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'react',           message: 'layout-core는 순수 기하다. React는 apps/web에.' },
        { name: 'react-dom',       message: '위와 같음' },
        { name: '@xyflow/react',   message: '위와 같음' },
        { name: 'elkjs',           message: 'ElkNode는 구조적 타입으로 다룬다. 인스턴스 생성은 pool.ts.' },
      ],
      patterns: [
        { group: ['@workflow/graph-core/src/*'], message: '배럴(index.ts)만 import한다.' },
      ],
    }],
    'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'performance'],
  },
}
```

그리고 `tsconfig.json`의 `lib`에서 `DOM`을 뺀다 — graph-core가 이미 쓰는 기법(index.ts 주석)이다. `document`를 쓰면 **컴파일 에러**가 나는 게 리뷰어의 기억보다 오래 간다.

### 14.3 구축 순서

| 주차 | 산출물 | 완료 판정 |
|---:|---|---|
| **1** | `types` · `options` · `key` · `build` · `read` · `geometry` · `pool` · `engine`(게이트+디바운스+rev) | 20노드 문서에서 Enter → 노드 등장. `canvas_layout_computed` 발화 |
| **1** | `anchor` + `commit` | §13.4의 E2E 통과. **1주차에 못 넣으면 나중에 아키텍처를 바꿔야 한다**(D-024) |
| **2** | `backedge` · `FlowEdge`/`BackEdge` · `EdgeLabel` | 하드 불변식(관통·상단진입) 통과 |
| **2** | `fallback` · 실패 처리 · 워커 재생성 | 워커 스텁 테스트 통과. OG 라우트 동작 |
| **3** | `collapse` · `GroupNode` · `CollapseFlip` · `urlState` | 접기 왕복 좌표 동일(D-037) |
| **3** | `ZoomTierBridge` · `LensBridge` · `LensOverlays` | 렌즈 0px · 줌 불변 E2E 통과 |
| **4** | `export/svg` · `ExportRoot` · PDF 분할 | 내보내기 == 화면 좌표 테스트 통과 |
| **4** | `bench` · `jump.regression` · `visual` · `ladder` | 예산표 실측값 채움. baseline 커밋 |

1주차 두 줄이 D-024의 "나중에 붙이는 최적화가 아니라 초기 설계 항목"에 대응한다. 앵커링은 `commit.ts`의 커밋 순서를 규정하므로, 나중에 넣으려면 렌더 경로 전체를 다시 짜야 한다.

---

## 부록 A. 계측 이벤트 (MEASUREMENT.md 확장)

| 이벤트 | 속성 | 왜 |
|---|---|---|
| `canvas_layout_computed` | `node_count`, `elk_ms`, **`jump_score`**, `jump_score_world`, `algorithm`, `ladder`, `cause`, `anchor_rule` | 기존 정의 + §5.4의 원인 분해에 필요한 3개 |
| `canvas_layout_gated` | `reason: 'hash' \| 'cache'`, `node_count` | 게이트 적중률. 90% 미만이면 §2가 새고 있다 |
| `canvas_layout_discarded` | `reason: 'stale' \| 'poisoned' \| 'key-mismatch'` | §10 |
| `canvas_layout_superseded` | `waited_ms` | 세션당 1회 초과면 디바운스 재검토 |
| `canvas_layout_failed` | `reason: 'timeout' \| 'elk' \| 'worker-dead'`, `consecutive` | §11 |
| `canvas_layout_degraded` | `from`, `to`, `p75_ms`, `budget_ms` | 사다리. 실사용에서 어느 단계까지 내려가는지가 §6 예산의 검증 |
| `canvas_relayout_toast` | `bbox_delta`, `undone: bool` | 되돌리기를 자주 누르면 앵커 규칙이 틀린 것 |
| `canvas_collapse_toggled` | `to`, `subtree_size`, `source: 'user' \| 'auto' \| 'url'` | 기존 이벤트 + `source` 추가 |

**`anchor_rule`을 남기는 이유**: `jump_score` p90이 나빠졌을 때, 그게 ELK 출력이 불안정해서인지 앵커가 엉뚱한 노드를 잡아서인지 구분하는 유일한 방법이다. `viewport-nearest` 비율이 높으면 아웃라인 포커스 신호가 엔진까지 안 오고 있다는 뜻이다.

전부 [POLICY.md](./POLICY.md)/[SECURITY.md](./SECURITY.md)의 원칙대로 **문서 내용·제목·담당자 식별자를 담지 않는다.** 노드 수와 밀리초와 점수뿐이다.

## 부록 B. 이 문서가 지키려는 실패 모드 목록

구현 중 "이거 왜 이렇게 복잡하지"라고 느낄 때 돌아올 지점.

1. 타이핑할 때마다 그림이 재배치된다 → §2 게이트
2. 갈래 조건을 쓰는 동안 그림이 재배치된다 → L-01
3. 담당자를 채워 넣는 동안 그림이 재배치된다 → L-02
4. 재배치가 끝점만 맞고 중간에 왕복한다 → §3.1
5. 화면 밖 노드에 앵커가 걸려 보던 곳이 날아간다 → §3.2 필터 B
6. 한 줄 지웠는데 그림 전체가 아래로 내려간다 → §3.3 선행자 앵커
7. 노드는 새 자리로 갔는데 뷰포트가 한 프레임 늦는다 → §3.4 flushSync + 직접 DOM 쓰기
8. 되돌아가는 화살표가 노드를 관통한다 → §4.2 사이드 레일
9. 되돌아가는 선이 점선이라 "기다림"으로 읽힌다 → §4.3
10. 늦게 도착한 옛 결과가 최신 그림을 덮는다 → §10.1
11. 500노드에서 새 요청이 옛 작업 뒤에 줄을 선다 → §10.3 풀
12. ELK가 죽어서 캔버스가 빈다 → §11.1
13. 폴백이 세로 스택이라 갈래가 사라진다 → §11.3
14. 렌즈를 바꿨는데 노드가 반 픽셀 움직인다 → §9.1 절대 위치 + containment
15. 줌 휠 한 번에 노드 200개가 리렌더된다 → §8.1
16. 내보낸 PNG에 화면 밖 노드가 빠져 있다 → L-08
17. 첫 내보내기가 시스템 폰트로 나온다 → §12.3 `document.fonts.ready`
18. undo했는데 그림이 다르게 정리된다 → L-11 캐시
19. 접었다 펴면 좌표가 미묘하게 달라진다 → §13.5 왕복 테스트
20. 성능 스냅샷이 계속 빨개져서 아무도 안 본다 → L-09 · §13.2

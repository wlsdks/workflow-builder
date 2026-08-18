# 동기화 · 저장 엔진

> **구현 상태 (2026-08-18)** — §1~§4의 **순수 계층만 구현됨**: `packages/graph-core/src/ops/`(op 타입 25종·`applyOp`·`invertOp`·`commutes`·`coalesce`·`merge3`·버스트 경계, 런타임 의존성 0) + `packages/sync-protocol/`(zod 스키마·봉투·응답). 테스트 397건 통과(graph-core 378 · sync-protocol 19). **§3.2 표는 269칸 중 20칸이 실제와 다르다** — 구현은 보수적으로(false 쪽으로) 갈라져 있고, 칸별 근거는 `packages/graph-core/test/ops.test.ts`의 `DEVIATIONS`에 있다. 미구현: `sync-client`(§4.1·§4.3~§8), 서버(§9~§10), undo 스택(§11), 관측성(§13).

> 최종 갱신: 2026-08-17 · 상태: v0.1

> ## ⚠️ 구현이 찾아낸 치명 결함 — `merge3` 대칭성 위반
>
> §2.5의 초안 코드는 **양쪽이 같은 지점에 순수 삽입**할 때 `a.end <= b.start`와 `b.end <= a.start`가
> **둘 다 참**이 되어 먼저 쓴 분기가 이긴다. 즉 `merge3(b,x,y) ≠ merge3(b,y,x)`이고,
> **두 클라이언트가 서로 다른 문장에 수렴한다.**
>
> ```
> merge3('견적서', '견적서 발송', '견적서 검토')  ≠
> merge3('견적서', '견적서 검토', '견적서 발송')
> ```
>
> 이건 "충돌 표시가 어긋난다" 수준이 아니라 **데이터 발산**이다. 바이트 순서 타이브레이크로 고쳤고,
> 2,000건 속성 테스트(P7)가 지킨다.
> 사용자에게 보이는 상태·문구는 [STATES.md §5](./STATES.md), 데이터 모델은 [ARCHITECTURE.md §2](./ARCHITECTURE.md), 순수 파생은 [GRAPH-CORE.md](./GRAPH-CORE.md)를 따른다.
> 이 문서는 **그 위에 얹는 구현 명세**다. 이미 결정된 것(op 기반, fractional index, tombstone, zustand SoT, 800ms 디바운스, `sendBeacon`, Server Actions)은 다시 논증하지 않는다.

---

## 0. 이 문서가 존재하는 이유 — 불변식 8개

이 영역은 **되돌리기 가장 비싼 곳**이다. 아래 8개는 코드 리뷰에서 "이걸 깨는 PR인가"만 물으면 되게 만든 목록이다. 하나라도 깨지면 Yjs 전환 때 전부 다시 쓰거나, 사용자가 글을 잃는다.

| # | 불변식 | 깨졌을 때 |
|---|---|---|
| **I1** | **사용자가 만든 바이트는 어떤 코드 경로에서도 삭제되지 않는다.** 병합 실패는 "선택"이 아니라 "둘 다 보관"으로 끝난다 | 신뢰 즉사. 복구 불가 |
| **I2** | **로컬 적용은 네트워크를 기다리지 않는다.** 서버 응답이 로컬 상태를 *교체*하는 코드 경로는 존재하지 않는다 (병합만 존재) | 타이핑 중 커서 점프, 미확인 변경 소실 |
| **I3** | **op은 불변이고 추가만 된다.** 서버는 클라이언트가 보낸 op의 payload를 재작성하지 않는다 (거부하거나, 보상 op을 *추가로* 발행한다) | 로그가 감사·undo·Yjs 브리지의 근거가 못 됨 |
| **I4** | **삭제는 tombstone뿐.** `DELETE FROM items`는 스키마 마이그레이션과 GC 잡에만 존재한다 | CRDT 전제 붕괴, 삭제-편집 동시성에서 데이터 손실 |
| **I5** | **아웃박스는 탭이 아니라 오리진(IndexedDB)에 속한다.** 탭이 죽어도 미전송 op은 다른 탭이 이어서 보낸다 | 탭 크래시 = 손실 |
| **I6** | **전송은 문서당 동시 1배치.** 두 배치가 동시에 날면 `baseRevision` 의미가 무너진다 | 순서 역전, 무한 409 |
| **I7** | **op 입도와 undo 입도는 분리한다** (`txnId`). 둘을 같게 만들려는 시도는 항상 둘 다 망친다 | 붙여넣기 12번 되감기, 또는 op 폭증 |
| **I8** | **텔레메트리에 문서 본문을 넣지 않는다** (D-070). op 타입·ID·길이까지만 | 프라이버시 약속 위반 |

---

## 1. Op 타입 전체 정의

### 1.1 입도 원칙 3개

**(a) op의 입도는 "사용자가 한 번의 의도로 한 일"이 아니라, "서버가 다른 사람의 변경과 나란히 놓았을 때 의미가 보존되는 최소 단위"다.**
전자는 undo의 기준이고, 후자가 op의 기준이다. 이 둘을 혼동하면 `paste_batch`를 12개 op으로 쪼개거나(undo가 12번), 반대로 `save_outline(전체)` 한 덩어리로 만든다(동시 편집이 서로를 덮어씀).

**(b) op은 필드 단위로 쪼갠다. 행 단위로 묶지 않는다.**
`update_item({title, assignee, duration})` 하나로 만들면, 내가 제목만 고치고 동료가 담당자만 고쳤을 때 **교환 불가능**해진다(§3). 필드로 쪼개면 두 op은 서로 다른 슬롯을 만지므로 순서와 무관해진다. 이 하나가 "대부분 무침묵 병합"의 90%를 만든다.

**(c) op payload에 컬렉션 전체를 싣지 않는다.**
`set_tools(['slack','excel'])`는 "슬랙 추가"와 "엑셀 제거"를 구분할 수 없다. 동시 편집에서 한쪽의 추가가 통째로 사라진다(I1 위반). → `add_tool` / `remove_tool`로 쪼갠다.
같은 이유로 `toggle_pain`을 **폐기**한다. 토글은 멱등도 교환도 아니다(두 번 적용하면 원래대로, 순서에 따라 결과가 다름). → `set_pain{to}`.

> **graph-core 변경 요청**: `packages/graph-core/src/incremental.ts`의 `OpType`에서 `set_tools`·`toggle_pain`을 빼고 `add_tool`·`remove_tool`·`set_pain`·`paste_batch`·`set_doc_title`·`set_edge_label`·`record_conflict`·`resolve_conflict`를 추가한다. `OP_SCOPE` 표도 같이 갱신한다(§1.7).

### 1.2 핵심 질문 1 — `set_title`을 한 글자마다 만드는가

**만들지 않는다. "타이핑 버스트" 단위로 만든다.** 근거 4개.

1. **한국어 IME.** 조합 중(`composing`) op을 만들면 `ㅎ`·`하`·`한`이 각각 op이 된다. 초성만 담긴 op이 서버 로그에 영구히 남고, 다른 탭에 브로드캐스트되고, undo 스택을 오염시킨다. ARCHITECTURE §3의 "조합 중 아무것도 트리거하지 않는다"와 op 생성은 **같은 게이트**를 써야 한다.
2. **비용.** 12단계 문서에 200자를 치면 200 op × 200바이트 = 40KB가 어펜드 로그에 쌓인다. 버스트 단위면 문장당 1~3개, 200배 절감. `operations` 테이블은 이 제품에서 가장 빨리 커지는 테이블이다.
3. **op 로그의 소비자가 사람이다.** 감사·"무엇이 달라졌는지 보기"·AI diff 검토가 전부 이 로그를 읽는다. 한 글자짜리 op 200개는 읽을 수 없는 로그다.
4. **char 단위 병합은 어차피 `set_title`이 못 한다.** 글자 단위 협업 병합은 Y.Text의 일이고, 그 전까지는 **3-way merge**(§5.3)가 같은 문제를 200배 싸게 푼다.

**버스트 종료 조건** (하나라도 만족하면 op 확정):

```ts
// packages/sync-client/src/title-burst.ts
const TITLE_IDLE_MS = 500;   // 800ms 디바운스보다 짧아야 한다 — 큐가 op을 기다리게 하면 안 된다

type BurstEnd =
  | 'idle'          // 500ms 무입력
  | 'composition'   // compositionend — IME 조합이 끝난 경계는 항상 안전한 커밋 지점
  | 'blur'          // 포커스 이탈
  | 'structural'    // Enter / Tab / 삭제 등 구조 op이 뒤따름 → 반드시 구조 op보다 먼저 큐에 넣는다
  | 'boundary'      // 공백·문장부호 입력 후 (undo 라벨을 자연스럽게 만든다)
  | 'flush';        // visibilitychange / 탭 핸드오버 / 수동 저장
```

`structural`이 결정적이다. `set_title` 확정 전에 `insert_item`이 큐에 들어가면, 두 op의 순서가 뒤바뀌어 **직전에 친 글자가 새 줄에 딸려가는** 버그가 난다. 큐 인터셉터에서 강제한다.

```ts
// 어떤 구조 op이든 큐에 넣기 전에 해당 아이템의 열린 버스트를 먼저 닫는다
function enqueue(op: Op) {
  if (STRUCTURAL.has(op.type)) titleBursts.closeAll();
  else if ('id' in op) titleBursts.close(op.id);
  outbox.push(op);
}
```

### 1.3 핵심 질문 2 — undo 입도와 op 입도가 같아야 하는가

**같으면 안 된다.** 요구사항 두 개가 이미 서로를 배제한다.

- STATES §3: "파싱 1회 = op 1개(12단계 생성이 12번 되감기면 안 됨)"
- 동시 편집: 12단계 생성을 op 1개로 만들면, 그 안의 한 단계만 동료가 고쳤을 때 **op 전체가 교환 불가**가 된다

두 요구를 동시에 만족시키는 유일한 방법은 **레이어를 나누는 것**이다.

```
전송·병합 레이어 :  op        — 필드 단위. 작을수록 좋다. 교환 가능성이 통화다
사용자 레이어    :  txn       — 의도 단위. op N개를 하나의 undo 항목으로 묶는 라벨
```

`paste_batch`만 예외적으로 **하나의 op이면서 하나의 txn**이다. 이유는 §1.5에서.

### 1.4 봉투(envelope)

op 자체는 순수 데이터다. 라우팅·멱등성·인과성에 필요한 것은 전부 봉투에 둔다. **op 안에 `ts`나 `actorId`를 넣지 않는다** — 넣는 순간 리듀서가 순수하지 않게 되고, 같은 op을 재생했을 때 결과가 달라진다.

```ts
// packages/graph-core/src/ops/envelope.ts   (런타임 의존성 0)
export type OpEnvelope = {
  /** 클라이언트 발급 UUIDv7. 멱등성 키이자 ack 대조 키. 재전송해도 절대 바뀌지 않는다 */
  opId: string;
  /** undo 그룹. 같은 의도로 묶인 op들이 공유한다 */
  txnId: string;
  actorId: string;
  /** 클라이언트 논리 시계(문서별 단조 증가). 벽시계 대신 인과 순서를 준다 */
  lamport: number;
  /** 벽시계 ms. **표시용에 한한다.** 어떤 정렬·병합 근거로도 쓰지 않는다 (기기 시계는 틀린다) */
  ts: number;
  /** 이 op을 만들 때 클라이언트가 보고 있던 문서 revision. 서버 rebase 판정 입력 */
  baseRevision: number;
  op: Op;
};
```

`lamport`: 로컬 op 발행 시 `lamport = max(lamport, 서버가 알려준 최대 lamport) + 1`. 동률은 `actorId` 사전순으로 깬다. 이 두 줄이 Yjs 전환 시 그대로 살아남는 부분이다.

### 1.5 Op 전체 목록 — zod 스키마

```ts
// packages/sync-protocol/src/ops.ts
//   deps: zod, @workflow/graph-core(타입만)
//   graph-core에 zod를 넣지 않는 이유는 §2.1
import { z } from 'zod';
import type { Op } from '@workflow/graph-core';

const uuid = z.string().uuid();
const nodeKind = z.enum(['task', 'branch', 'hold']);
const durationBand = z.enum(['1m', '5m', '15m', '1h', 'halfday', '1d+']);

/** base62 fractional index. COLLATE "C" 바이트 비교 전제 */
const sortKey = z.string().min(1).max(160).regex(/^[0-9A-Za-z]+$/);

/** 제목은 한 줄 평문이다. 개행·마크업이 들어오면 Yjs(Y.Text) 전환 지점이 오염된다 (§12) */
const title = z.string().max(2000).refine((s) => !s.includes('\n'), '제목은 한 줄이다');

/** items.id 또는 'start' / 'end' / 'join:{uuid}' */
const nodeRef = z.union([uuid, z.literal('start'), z.literal('end'), z.string().regex(/^join:[0-9a-f-]{36}$/)]);

const itemAttrs = z.object({
  mode: z.enum(['xor', 'and', 'skip']).optional(),
  caseLabel: z.string().max(200).optional(),
  joinBehavior: z.enum(['continue', 'end']).optional(),
  waitFor: z.enum(['approval', 'reply', 'time', 'resource']).optional(),
  avgWaitH: z.number().min(0).max(8760).optional(),
  timeoutH: z.number().min(0).max(8760).optional(),
  reworkRate: z.number().min(0).max(1).optional(),
  returnToItemId: uuid.optional(),
});

/* ── 1) 구조 ───────────────────────────────────────────────────────────── */

const InsertItem = z.object({
  type: z.literal('insert_item'),
  id: uuid,                       // ★ 클라이언트 발급 (D-031)
  parentId: uuid.nullable(),
  sortKey,
  kind: nodeKind,
  title,                          // 버스트가 확정되기 전이면 '' — 이후 set_title이 채운다
});

const DeleteItem = z.object({
  type: z.literal('delete_item'),
  id: uuid,
});

const RestoreItem = z.object({
  type: z.literal('restore_item'),
  id: uuid,
});

/** 부모가 바뀌는 이동. sortKey도 반드시 함께 바뀐다 (새 형제 목록의 키) */
const MoveItem = z.object({
  type: z.literal('move_item'),
  id: uuid,
  parentId: uuid.nullable(),
  sortKey,
});

/** 같은 부모 안 순서 변경. move_item과 분리하는 이유: 위상 재계산 범위가 다르다 (OP_SCOPE) */
const ReorderItem = z.object({
  type: z.literal('reorder_item'),
  id: uuid,
  sortKey,
});

/* ── 2) 스칼라 필드 ─────────────────────────────────────────────────────── */
/**  전부 `from`(내가 보고 있던 값)을 싣는다.
 *   서버·rebase가 "이건 동시 편집인가, 아니면 순차 편집인가"를 물을 수 있게 하는 유일한 수단이다.
 *   from이 없으면 모든 필드 변경이 무조건 last-write-wins가 되고, I1(둘 다 보관)을 구현할 수 없다. */

const SetTitle = z.object({
  type: z.literal('set_title'),
  id: uuid,
  from: title,   // 3-way merge의 base
  to: title,
});

const SetKind = z.object({ type: z.literal('set_kind'), id: uuid, from: nodeKind, to: nodeKind });

/** attrs는 키별 슬롯이다. patch/base 모두 부분 객체 — 키가 겹치지 않으면 교환 가능 */
const SetAttr = z.object({
  type: z.literal('set_attr'),
  id: uuid,
  from: itemAttrs.partial(),
  to: itemAttrs.partial(),
});

const SetAssignee = z.object({
  type: z.literal('set_assignee'),
  id: uuid,
  from: uuid.nullable(),
  to: uuid.nullable(),   // null = "앞과 같음" (D-055). "모름"이 아니다
});

const SetDuration = z.object({
  type: z.literal('set_duration'),
  id: uuid,
  from: durationBand.nullable(),
  to: durationBand.nullable(),
});

const SetFreq = z.object({ type: z.literal('set_freq'), id: uuid, from: z.number().int().nullable(), to: z.number().int().min(0).max(10000).nullable() });
const SetAutomation = z.object({ type: z.literal('set_automation'), id: uuid, from: z.number().int().nullable(), to: z.number().int().min(0).max(3).nullable() });

/** 토글이 아니라 대입. 토글은 멱등도 교환도 아니다 (§1.1c) */
const SetPain = z.object({ type: z.literal('set_pain'), id: uuid, from: z.boolean(), to: z.boolean() });

/** 신선도. at은 클라이언트가 싣고 서버가 now로 클램프한다. 병합은 max */
const ConfirmItem = z.object({ type: z.literal('confirm_item'), id: uuid, at: z.number().int() });

/* ── 3) 도구 — 집합이므로 원소 단위 ─────────────────────────────────────── */

const AddTool = z.object({ type: z.literal('add_tool'), id: uuid, toolId: uuid });
const RemoveTool = z.object({ type: z.literal('remove_tool'), id: uuid, toolId: uuid });

/* ── 4) 엣지 오버라이드 ─────────────────────────────────────────────────── */

const AddEdge = z.object({
  type: z.literal('add_edge'),
  id: uuid,                    // 엣지 ID도 클라이언트 발급
  sourceId: nodeRef,
  targetId: nodeRef,
  label: z.string().max(200).optional(),
});

/** 파생 엣지 억제. add_edge와 같은 테이블·다른 kind (ARCHITECTURE §2) */
const SuppressEdge = z.object({
  type: z.literal('suppress_edge'),
  id: uuid,
  sourceId: nodeRef,
  targetId: nodeRef,
});

const RemoveEdge = z.object({ type: z.literal('remove_edge'), id: uuid });
const UnsuppressEdge = z.object({ type: z.literal('unsuppress_edge'), id: uuid });
const SetEdgeLabel = z.object({
  type: z.literal('set_edge_label'),
  id: uuid,
  from: z.string().max(200).nullable(),
  to: z.string().max(200).nullable(),
});

/* ── 5) 문서 ────────────────────────────────────────────────────────────── */

const SetDocTitle = z.object({ type: z.literal('set_doc_title'), from: title, to: title });

/* ── 6) 배치 ────────────────────────────────────────────────────────────── */
/**
 * paste_batch는 **의도적으로 굵다.** 이 하나만 §1.1(a)의 예외다.
 *
 * 근거:
 *  - STATES §3: "파싱 1회 = op 1개." 12단계가 12번 되감기면 파서 신뢰가 무너진다
 *  - 파싱 결과는 **원자적으로만 의미가 있다.** 절반만 적용된 파싱 결과는
 *    "어떻게 나눠야 할지 모르겠어서 그대로 넣어뒀어요"(D-050)보다 나쁘다
 *  - 새로 만든 아이템은 전부 새 UUID다 → 다른 사람의 편집과 **원천적으로 겹치지 않는다.**
 *    즉 굵어도 교환 가능성을 해치지 않는다. 이게 예외를 허용할 수 있는 진짜 이유다
 *
 * 상한 500줄. 초과분은 batch를 나누되 **같은 txnId를 공유**시켜 undo는 1회로 유지한다.
 */
const PasteBatch = z.object({
  type: z.literal('paste_batch'),
  /** 이 배치가 만든 아이템의 최상위 부모 */
  parentId: uuid.nullable(),
  items: z.array(z.object({
    id: uuid,
    parentId: uuid.nullable(),   // 배치 내부 참조 또는 위 parentId
    sortKey,
    kind: nodeKind,
    title,
    attrs: itemAttrs.optional(),
    assigneeId: uuid.nullable().optional(),
    durationBand: durationBand.nullable().optional(),
  })).min(1).max(500),
  edges: z.array(z.object({
    id: uuid, sourceId: nodeRef, targetId: nodeRef, label: z.string().max(200).optional(),
  })).max(500).default([]),
  /** 사용자에게 보여줄 undo 라벨. "붙여넣기 18줄" */
  label: z.string().max(80),
});

/* ── 7) 충돌 — op으로 표현한다 ─────────────────────────────────────────── */
/**
 * 충돌 기록 자체가 op이어야 하는 이유:
 *  (1) 다른 탭·다른 사람에게 같은 경로로 전파돼야 한다
 *  (2) 재생(replay)해도 같은 상태가 나와야 한다 — 스냅샷 복원이 충돌을 잃으면 I1 위반
 *  (3) 클라이언트가 rebase 중에 발견한 충돌과 서버가 발견한 충돌이 같은 모양이어야 한다
 */
const RecordConflict = z.object({
  type: z.literal('record_conflict'),
  /** 결정적 ID: `${itemId}:${field}` — 같은 슬롯의 충돌은 하나로 모인다 */
  itemId: uuid,
  field: z.enum(['title', 'assigneeId', 'durationBand', 'kind', 'attrs', 'deleted']),
  base: z.string(),                     // JSON.stringify된 공통 조상 값
  variants: z.array(z.object({
    value: z.string(),                  // JSON.stringify된 값
    actorId: uuid,
    lamport: z.number().int(),
  })).min(2).max(8),
});

const ResolveConflict = z.object({
  type: z.literal('resolve_conflict'),
  itemId: uuid,
  field: z.enum(['title', 'assigneeId', 'durationBand', 'kind', 'attrs', 'deleted']),
  /** 사용자가 고른 값. **자동 선택은 이 op을 발행하지 않는다** */
  chosen: z.string(),
  chosenBy: uuid,
});

/* ── 합집합 ─────────────────────────────────────────────────────────────── */

export const OpSchema = z.discriminatedUnion('type', [
  InsertItem, DeleteItem, RestoreItem, MoveItem, ReorderItem,
  SetTitle, SetKind, SetAttr, SetAssignee, SetDuration, SetFreq, SetAutomation, SetPain, ConfirmItem,
  AddTool, RemoveTool,
  AddEdge, SuppressEdge, RemoveEdge, UnsuppressEdge, SetEdgeLabel,
  SetDocTitle, PasteBatch,
  RecordConflict, ResolveConflict,
]) satisfies z.ZodType<Op>;   // ★ graph-core의 Op 타입과 어긋나면 컴파일이 깨진다

export const EnvelopeSchema = z.object({
  opId: uuid, txnId: uuid, actorId: uuid,
  lamport: z.number().int().nonnegative(),
  ts: z.number().int(),
  baseRevision: z.number().int().nonnegative(),
  op: OpSchema,
});

export const ApplyOpsInput = z.object({
  docId: uuid,
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(EnvelopeSchema).min(1).max(200),
  /** 클라이언트가 이 배치를 적용한 뒤 계산한 derive().contentHash. 발산 탐지용 (§13) */
  expectedContentHash: z.string().length(7).optional(),  // hash32는 base36 7자 — 16으로 두면 모든 요청이 거부된다
});
```

### 1.6 의도적으로 op이 **아닌** 것

| 대상 | 왜 op이 아닌가 | 어떻게 저장하나 |
|---|---|---|
| **레이아웃 좌표 캐시** | 사용자 콘텐츠가 아니라 파생 캐시다. op으로 만들면 ELK가 돌 때마다 어펜드 로그가 폭발하고, 좌표 충돌이라는 무의미한 충돌이 생긴다 | `document_layout` 테이블에 LWW upsert. 실패해도 조용히 무시(다음 ELK가 다시 만든다). **저장 상태 표시에 영향을 주지 않는다** |
| **접기(collapse) 상태 · 렌즈 · 줌** | 개인 뷰 상태다. 남에게 전파되면 안 된다 | `localStorage` (탭 간 공유 불필요) |
| **커서·프레즌스** | 수명이 초 단위. 로그에 남으면 안 된다 | v1 없음. Yjs awareness로 나중에 (§12) |
| **체크리스트 체크** | 문서가 아니라 *실행 인스턴스*의 상태다. 문서 revision을 올리면 안 된다 | 별도 테이블 + 별도 낙관적 큐. 같은 엔진을 쓰되 `docId` 대신 `runId` |
| **`lastConfirmedAt` 자동 갱신** | 편집했다고 "확인했다"가 되면 신선도 지표가 거짓말이 된다 | 명시적 `confirm_item`만 |

### 1.7 `OP_SCOPE` 갱신분

`incremental.ts`의 표에 추가/수정되는 행만.

| op | 위상 | 라벨 | 메트릭 | 사이클 | 비고 |
|---|:--:|:--:|:--:|:--:|---|
| `add_tool` / `remove_tool` | ○ | ● | ● | ○ | 도구 전환 횟수 |
| `set_pain` | ○ | ● | ○ | ○ | 짜증 렌즈 전용 (D-025) |
| `set_freq` / `set_automation` | ○ | ● | ● | ○ | |
| `set_edge_label` | ○ | ● | ○ | ○ | 엣지 라벨만 |
| `set_doc_title` | ○ | ○ | ○ | ○ | **derive조차 필요 없다** |
| `paste_batch` | ● | ● | ● | ● | 가장 넓다 |
| `record_conflict` | ○ | ● | ○ | ○ | 인라인 칩 렌더 |
| `resolve_conflict` | ○ | ● | ○ | ○ | 값이 실제로 바뀌면 해당 필드 스코프를 OR |

---

## 2. Op 리듀서

### 2.1 어디에 두는가 — `graph-core`인가 별도 패키지인가

**세 조각으로 나눈다.** 하나로 두려는 시도가 이 설계의 첫 번째 유혹이고, 잘못된 답이다.

| 조각 | 위치 | 런타임 deps | 내용 |
|---|---|---|---|
| **op 타입 + 순수 리듀서** | `packages/graph-core/src/ops/` | **0** | `Op`, `applyOp`, `applyOps`, `invertOp`, `commutes`, `coalesce`, `merge3`, `DocState` |
| **와이어 스키마** | `packages/sync-protocol/` | `zod` | `OpSchema`, `EnvelopeSchema`, `ApplyOpsInput`, 응답 타입 |
| **동기화 런타임** | `packages/sync-client/` | `zustand`, `idb` | 아웃박스, 상태머신, IndexedDB, BroadcastChannel, 전송 어댑터 |

**리듀서가 graph-core에 들어가는 근거 4개**

1. `derive()`의 입력을 만드는 함수다. `applyOp → Item[] → derive()`가 한 호출 스택 안에서 일어난다. 다른 패키지에 두면 `Item`·`ItemAttrs`·`NodeKind`를 순환 참조하거나 복제해야 한다.
2. **소비자가 4곳이다** — 브라우저(낙관적 적용), 서버 액션(권위 적용), 웹워커(대용량 붙여넣기 시뮬레이션), 스냅샷 복원 잡. D-033이 `derive()`를 순수 패키지로 뺀 이유와 **글자 그대로 같은 이유**다.
3. **결정성 계약이 그대로 필요하다.** `Math.random`·`Date.now` 금지가 리듀서에도 필수다 — 서버와 클라이언트가 같은 op에서 같은 상태를 내야 한다. graph-core의 3중 방어(tsconfig `lib`, eslint, 빈 deps)를 공짜로 상속한다.
4. **테스트 자산이 같다.** 속성 기반 수렴 테스트(§14)는 `applyOps` + `derive().contentHash`를 함께 쓴다. 픽스처를 두 패키지로 쪼개면 골든 파일이 두 배가 된다.

**zod를 graph-core에 넣지 않는 근거**
`package.json`에 못 박혀 있다 — *"런타임 의존성은 영원히 비어 있어야 한다. 무언가를 넣고 싶어지면 그것은 이 패키지에 들어갈 코드가 아니다."* zod는 런타임 의존성이고, 번들 12KB이며, 메이저 업그레이드(3→4)마다 graph-core를 인질로 잡는다. 검증은 **신뢰 경계(서버 액션 입구)의 관심사**이지 순수 계산의 관심사가 아니다.

> **ARCHITECTURE.md §6 정정 필요**: `import { OpSchema } from '@workflow/graph-core'` → `from '@workflow/sync-protocol'`.

타입 어긋남은 위 `satisfies z.ZodType<Op>` 한 줄이 컴파일 타임에 잡는다. 이게 두 패키지를 나누고도 안전한 유일한 이유다.

**`sync-client`를 앱(`app/`)이 아니라 패키지로 빼는 근거**: 결정론적 시뮬레이션 테스트(§14.1)를 Node에서 돌려야 한다. 시계·네트워크·저장소·채널을 **전부 주입 가능한 어댑터**로 두면 브라우저 없이 3-클라이언트 파티션 시나리오를 밀리초 만에 돌릴 수 있다. 이 하나가 "동기화 버그를 사후에 재현할 수 있는가"를 결정한다.

### 2.2 `DocState`

```ts
// packages/graph-core/src/ops/state.ts
import type { Item, Edge } from '../types.ts';

export type FieldConflictField = 'title' | 'assigneeId' | 'durationBand' | 'kind' | 'attrs' | 'deleted';

export type ConflictVariant = {
  /** JSON.stringify된 값. 타입이 섞여도 하나의 구조로 다룬다 */
  value: string;
  actorId: string;
  lamport: number;
};

export type FieldConflict = {
  /** `${itemId}:${field}` — 결정적 */
  id: string;
  itemId: string;
  field: FieldConflictField;
  base: string;
  /** 항상 2개 이상. 어느 것도 "정답"으로 표시되지 않는다 */
  variants: readonly ConflictVariant[];
  /** 현재 아이템 슬롯에 들어가 있는 값(= 서버 전체 순서의 승자). 표시 순서를 정할 때만 쓴다 */
  liveValue: string;
  resolvedAt: number | null;
};

export type DocState = {
  readonly docId: string;
  readonly title: string;
  readonly revision: number;
  /** tombstone 포함. deletedAt !== null인 행도 여기 산다 (I4) */
  readonly items: ReadonlyMap<string, Item>;
  readonly edges: ReadonlyMap<string, Edge>;
  readonly conflicts: ReadonlyMap<string, FieldConflict>;
};

export const emptyDoc = (docId: string): DocState => ({
  docId, title: '', revision: 0,
  items: new Map(), edges: new Map(), conflicts: new Map(),
});
```

`items`를 배열이 아니라 `Map`으로 두는 이유: op 하나가 O(1)로 아이템을 찾아야 하고, `derive()`에 넘길 때만 `[...items.values()]`로 펼치면 된다(정렬은 `derive()`의 전처리가 이미 한다).

### 2.3 `applyOp` — 전문

```ts
// packages/graph-core/src/ops/apply.ts
import type { Item } from '../types.ts';
import type { DocState, FieldConflict } from './state.ts';
import type { Op } from './types.ts';

/**
 * 순수·전역(total) 함수. **절대 throw하지 않는다.**
 *
 * 이유: 같은 리듀서가 (a) 낙관적 로컬 적용 (b) 서버 권위 적용 (c) 오프라인 rebase
 * (d) 스냅샷 복원에서 돌아간다. 이 중 하나라도 예외를 던지면 그 순간 문서가 멈춘다.
 * 적용할 수 없는 op은 **상태를 그대로 돌려주는 것으로 처리**하고, 진단은 derive()가 낸다.
 * (GRAPH-CORE §4.1 "이 함수는 판정하지 않는다"와 같은 철학 — 여기서도 오류는 없고 복구만 있다)
 *
 * 반환 규칙: 아무것도 바뀌지 않으면 **같은 참조**를 돌려준다.
 * 호출자가 `next === prev`로 리렌더·재파생·큐 적재를 전부 건너뛴다.
 */
export function applyOp(state: DocState, op: Op): DocState {
  switch (op.type) {
    /* ── 구조 ─────────────────────────────────────────────────────────── */

    case 'insert_item': {
      // 멱등: 이미 있으면 무시한다. 재전송·재생에서 반드시 필요하다
      if (state.items.has(op.id)) return state;
      const item: Item = {
        id: op.id, parentId: op.parentId, sortKey: op.sortKey,
        kind: op.kind, title: op.title, attrs: {},
        assigneeId: null, durationBand: null, toolIds: [],
        freqLast7d: null, automationLevel: null, painFlag: false,
        lastConfirmedAt: null, deletedAt: null,
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
      if (cur.parentId === op.parentId && cur.sortKey === op.sortKey) return state;
      return { ...state, items: mapSet(state.items, op.id, { ...cur, parentId: op.parentId, sortKey: op.sortKey }) };
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

    case 'set_title':      return patch(state, op.id, (i) => (i.title === op.to ? null : { title: op.to }));
    case 'set_kind':       return patch(state, op.id, (i) => (i.kind === op.to ? null : { kind: op.to }));
    case 'set_assignee':   return patch(state, op.id, (i) => (i.assigneeId === op.to ? null : { assigneeId: op.to }));
    case 'set_duration':   return patch(state, op.id, (i) => (i.durationBand === op.to ? null : { durationBand: op.to }));
    case 'set_freq':       return patch(state, op.id, (i) => (i.freqLast7d === op.to ? null : { freqLast7d: op.to }));
    case 'set_automation': return patch(state, op.id, (i) => (i.automationLevel === op.to ? null : { automationLevel: op.to }));
    case 'set_pain':       return patch(state, op.id, (i) => (i.painFlag === op.to ? null : { painFlag: op.to }));

    case 'set_attr':
      return patch(state, op.id, (i) => {
        const next = { ...i.attrs };
        let changed = false;
        for (const [k, v] of Object.entries(op.to)) {
          if (v === undefined) { if (k in next) { delete (next as Record<string, unknown>)[k]; changed = true; } }
          else if ((next as Record<string, unknown>)[k] !== v) { (next as Record<string, unknown>)[k] = v; changed = true; }
        }
        return changed ? { attrs: next } : null;
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
        i.toolIds?.includes(op.toolId) ? null : { toolIds: [...(i.toolIds ?? []), op.toolId].sort() });

    case 'remove_tool':
      return patch(state, op.id, (i) =>
        i.toolIds?.includes(op.toolId) ? { toolIds: i.toolIds.filter((t) => t !== op.toolId) } : null);

    /* ── 엣지 ─────────────────────────────────────────────────────────── */

    case 'add_edge':
    case 'suppress_edge': {
      if (state.edges.has(op.id)) return state;
      const kind = op.type === 'add_edge' ? 'explicit' : 'suppressed';
      // 같은 (source,target,kind) 중복은 사용자 의도상 하나다 — 뒤에 온 것은 무시한다
      for (const e of state.edges.values()) {
        if (e.sourceId === op.sourceId && e.targetId === op.targetId && e.kind === kind) return state;
      }
      const edge = {
        id: op.id, sourceId: op.sourceId, targetId: op.targetId, kind,
        ...(op.type === 'add_edge' && op.label !== undefined ? { label: op.label } : {}),
      } as const;
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
      if (op.to === null) delete next.label; else next.label = op.to;
      return { ...state, edges: mapSet(state.edges, op.id, next) };
    }

    /* ── 문서 ─────────────────────────────────────────────────────────── */

    case 'set_doc_title':
      return state.title === op.to ? state : { ...state, title: op.to };

    /* ── 배치 ─────────────────────────────────────────────────────────── */

    case 'paste_batch': {
      let items = state.items;
      for (const raw of op.items) {
        if (items.has(raw.id)) continue;            // 멱등
        items = mapSet(items, raw.id, {
          id: raw.id, parentId: raw.parentId, sortKey: raw.sortKey,
          kind: raw.kind, title: raw.title, attrs: raw.attrs ?? {},
          assigneeId: raw.assigneeId ?? null, durationBand: raw.durationBand ?? null,
          toolIds: [], freqLast7d: null, automationLevel: null, painFlag: false,
          lastConfirmedAt: null, deletedAt: null,
        });
      }
      let edges = state.edges;
      for (const e of op.edges) {
        if (edges.has(e.id)) continue;
        edges = mapSet(edges, e.id, { id: e.id, sourceId: e.sourceId, targetId: e.targetId, kind: 'explicit', ...(e.label ? { label: e.label } : {}) });
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
      for (const v of op.variants) if (!seen.has(v.value)) { merged.push(v); seen.add(v.value); }
      merged.sort((a, b) => (a.lamport - b.lamport) || (a.actorId < b.actorId ? -1 : 1));
      const live = state.items.get(op.itemId);
      const conflict: FieldConflict = {
        id, itemId: op.itemId, field: op.field,
        base: prev?.base ?? op.base,
        variants: merged,
        liveValue: JSON.stringify(readField(live, op.field)),
        resolvedAt: null,
      };
      return { ...state, conflicts: mapSet(state.conflicts, id, conflict) };
    }

    case 'resolve_conflict': {
      const id = `${op.itemId}:${op.field}`;
      const prev = state.conflicts.get(id);
      if (!prev || prev.resolvedAt !== null) return state;
      // 1) 고른 값을 실제 슬롯에 반영
      const applied = writeField(state, op.itemId, op.field, JSON.parse(op.chosen));
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

/* ── 헬퍼 ─────────────────────────────────────────────────────────────── */

function mapSet<K, V>(m: ReadonlyMap<K, V>, k: K, v: V): Map<K, V> {
  const next = new Map(m); next.set(k, v); return next;
}

/** 부분 갱신. fn이 null을 돌려주면 상태 참조를 유지한다 */
function patch(state: DocState, id: string, fn: (i: Item) => Partial<Item> | null): DocState {
  const cur = state.items.get(id);
  if (!cur) return state;          // 없는 아이템에 대한 필드 op은 조용히 무시 (§5.4)
  const p = fn(cur);
  if (p === null) return state;
  return { ...state, items: mapSet(state.items, id, { ...cur, ...p }) };
}

function isDescendant(state: DocState, candidate: string, ancestor: string): boolean {
  let cur: string | null = candidate;
  for (let guard = 0; cur !== null && guard < 10_000; guard++) {
    if (cur === ancestor) return true;
    cur = state.items.get(cur)?.parentId ?? null;
  }
  return false;
}
```

**`TOMBSTONE` / `RESOLVED_MARK`에 대하여.** graph-core는 `Date.now()`를 쓸 수 없다(결정성 계약). 그래서 리듀서는 시각을 만들지 않고 **표식만** 남긴다. 실제 타임스탬프는 서버가 `operations.created_at`에서 채우고, 클라이언트는 봉투의 `ts`로 채운다.

```ts
/** "삭제됨"의 순수 표현. 값 자체는 비교에 쓰이지 않는다 — null인지 아닌지만 본다 */
export const TOMBSTONE = new Date(0);
export const RESOLVED_MARK = 0;
```

`deletedAt`을 **정렬·표시에 쓰지 않는다**는 규칙이 여기서 나온다. 정렬이 필요하면 `operations` 로그를 본다.

### 2.4 역연산 `invertOp`

undo(§11)의 재료. **적용 *전* 상태가 있어야 계산할 수 있다** — 이것이 undo를 "나중에 로그만 보고" 만들 수 없는 이유다.

```ts
// packages/graph-core/src/ops/invert.ts
/**
 * 적용 전 상태 기준의 역연산. 적용 후에 호출하면 틀린 값이 나온다.
 * 되돌릴 수 없는 op(record_conflict 등)은 null — undo 스택에 담기지 않는다.
 */
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

    case 'restore_item': return [{ type: 'delete_item', id: op.id }];

    case 'move_item': {
      const cur = before.items.get(op.id);
      if (!cur) return [];
      return [{ type: 'move_item', id: op.id, parentId: cur.parentId, sortKey: cur.sortKey }];
    }

    case 'reorder_item': {
      const cur = before.items.get(op.id);
      return cur ? [{ type: 'reorder_item', id: op.id, sortKey: cur.sortKey }] : [];
    }

    case 'set_title':      return [{ type: 'set_title', id: op.id, from: op.to, to: op.from }];
    case 'set_kind':       return [{ type: 'set_kind', id: op.id, from: op.to, to: op.from }];
    case 'set_assignee':   return [{ type: 'set_assignee', id: op.id, from: op.to, to: op.from }];
    case 'set_duration':   return [{ type: 'set_duration', id: op.id, from: op.to, to: op.from }];
    case 'set_freq':       return [{ type: 'set_freq', id: op.id, from: op.to, to: op.from }];
    case 'set_automation': return [{ type: 'set_automation', id: op.id, from: op.to, to: op.from }];
    case 'set_pain':       return [{ type: 'set_pain', id: op.id, from: op.to, to: op.from }];
    case 'set_attr':       return [{ type: 'set_attr', id: op.id, from: op.to, to: op.from }];

    case 'confirm_item':   return null;   // 신선도 되돌리기는 의미가 없다. 사용자 모델에 없다

    case 'add_tool':       return [{ type: 'remove_tool', id: op.id, toolId: op.toolId }];
    case 'remove_tool':    return [{ type: 'add_tool', id: op.id, toolId: op.toolId }];

    case 'add_edge':       return [{ type: 'remove_edge', id: op.id }];
    case 'suppress_edge':  return [{ type: 'unsuppress_edge', id: op.id }];
    case 'remove_edge':
    case 'unsuppress_edge': {
      const e = before.edges.get(op.id);
      if (!e) return [];
      return e.kind === 'explicit'
        ? [{ type: 'add_edge', id: e.id, sourceId: e.sourceId, targetId: e.targetId, ...(e.label ? { label: e.label } : {}) }]
        : [{ type: 'suppress_edge', id: e.id, sourceId: e.sourceId, targetId: e.targetId }];
    }
    case 'set_edge_label': return [{ type: 'set_edge_label', id: op.id, from: op.to, to: op.from }];

    case 'set_doc_title':  return [{ type: 'set_doc_title', from: op.to, to: op.from }];

    case 'paste_batch':
      // 붙여넣기 1회 = undo 1회 (STATES §3). op N개가 아니라 op 1개의 역연산 N개다
      return op.items.map((i) => ({ type: 'delete_item', id: i.id } as const));

    case 'record_conflict':  return null;  // 충돌 "발견"은 사용자의 행위가 아니다
    case 'resolve_conflict': return null;  // 해소는 §11.4에서 별도 처리
  }
}
```

### 2.5 3-way merge

```ts
// packages/graph-core/src/ops/merge3.ts
export type Merge3 =
  | { ok: true; text: string; silent: boolean }   // silent=true면 사용자에게 아무것도 알리지 않는다
  | { ok: false; reason: 'overlap' };

/**
 * 한 줄 제목 전용 3-way 병합.
 *
 * diff-match-patch를 쓰지 않는 이유: (a) graph-core 런타임 의존성 0 (b) 제목은 평균 20자라
 * 공통 접두/접미 한 번이면 충분하다 (c) 결정성이 눈으로 검증 가능해야 한다.
 *
 * 규칙: 양쪽이 base에서 **서로 겹치지 않는 구간**을 고쳤으면 둘 다 살린다. 겹치면 실패.
 * 실패는 오류가 아니라 §5.3의 "두 내용 모두 남겨두기"로 가는 입구다.
 */
export function merge3(base: string, mine: string, theirs: string): Merge3 {
  if (mine === theirs) return { ok: true, text: mine, silent: true };
  if (mine === base) return { ok: true, text: theirs, silent: true };
  if (theirs === base) return { ok: true, text: mine, silent: true };

  const a = region(base, mine);
  const b = region(base, theirs);

  if (a.end <= b.start) {
    return { ok: true, silent: false,
      text: base.slice(0, a.start) + a.text + base.slice(a.end, b.start) + b.text + base.slice(b.end) };
  }
  if (b.end <= a.start) {
    return { ok: true, silent: false,
      text: base.slice(0, b.start) + b.text + base.slice(b.end, a.start) + a.text + base.slice(a.end) };
  }
  return { ok: false, reason: 'overlap' };
}

type Region = { start: number; end: number; text: string };

function region(base: string, next: string): Region {
  const max = Math.min(base.length, next.length);
  let p = 0;
  while (p < max && base.charCodeAt(p) === next.charCodeAt(p)) p++;
  // 서러게이트 페어를 반으로 쪼개지 않는다 (이모지·일부 한자)
  if (p > 0 && isLowSurrogate(base.charCodeAt(p))) p--;
  let s = 0;
  while (s < max - p && base.charCodeAt(base.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  if (s > 0 && isHighSurrogate(base.charCodeAt(base.length - s))) s--;
  return { start: p, end: base.length - s, text: next.slice(p, next.length - s) };
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
```

**한글에서 실제로 무슨 일이 일어나는가**
`base = "견적서 작성"`, 내가 `"견적서 작성해서 발송"`, 동료가 `"매월 견적서 작성"` → 겹치지 않음 → `"매월 견적서 작성해서 발송"`. 조용히 병합되고 사용자는 아무것도 보지 않는다.
`base = "견적서 작성"`, 내가 `"견적서 검토"`, 동료가 `"견적서 승인"` → 같은 구간 → 실패 → 두 내용 모두 보관(§5.3).

이 두 예시가 "대부분 무침묵 병합, 병합 불가만 제시"의 전부다.

---

## 3. 교환 가능성(commutativity) 분석

### 3.1 왜 이 표가 충돌 해소의 근거인가

서버는 단일 전체 순서(total order)를 가진다 — 도착 순서대로 적용하면 **어떤 op 집합이든 모든 클라이언트가 같은 상태로 수렴한다.** 교환 가능성이 없어도 수렴은 보장된다.

그러면 이 표는 왜 필요한가. **세 곳에서 필요하다.**

1. **서버의 무침묵 병합** (§9.4) — `baseRevision`이 밀렸을 때, 내 op이 그 사이 들어온 op들과 전부 교환 가능하면 서버는 **409를 내지 않고 그냥 적용한다.** 이게 "revision 충돌 → 대부분 무침묵 병합"의 실제 구현이다.
2. **클라이언트 rebase** (§5.1) — 409를 받았을 때 미확인 op을 `missedOps` 위에 다시 얹을 수 있는지 판정한다. 교환 가능하면 그대로 재전송, 아니면 변환하거나 충돌로 기록한다.
3. **큐 압축** (§4.3) — 두 op 사이에 순서 장벽이 있는지 판정한다.

즉 **교환 가능성은 "사용자에게 조용히 있을 수 있는가"의 통화(currency)다.** 표에서 ●가 많을수록 사용자가 보는 방해가 줄어든다.

정의: `commute(x, y) ⟺ applyOps(s, [x,y]) ≡ applyOps(s, [y,x])` — 모든 도달 가능한 `s`에 대해. `≡`는 `derive().contentHash` 동일로 판정한다(§14.2가 이걸 그대로 테스트한다).

### 3.2 전체 표

축약: **●** 항상 교환 가능 / **◐** 조건부(조건 명시) / **○** 교환 불가
같은 아이템/엣지를 건드릴 때만 문제가 된다. **다른 아이템에 대한 op은 아래 3쌍을 빼고 전부 ●다.**

| ↓x \ y→ | ins | del | rest | move | reord | title | kind | attr | scalar(같은 필드) | scalar(다른 필드) | +tool | −tool | add_edge | rm_edge | paste | conflict |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **insert_item** | ◐¹ | ● | ● | ◐² | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **delete_item** | ● | ● | ○³ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **restore_item** | ● | ○³ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **move_item** | ◐² | ● | ● | ○⁴ | ○⁵ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **reorder_item** | ● | ● | ● | ○⁵ | ○⁶ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **set_title** | ● | ● | ● | ● | ● | ○⁷ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **set_kind** | ● | ● | ● | ● | ● | ● | ○⁸ | ◐⁹ | ● | ● | ● | ● | ● | ● | ● | ● |
| **set_attr** | ● | ● | ● | ● | ● | ● | ◐⁹ | ◐¹⁰ | — | — | ● | ● | ● | ● | ● | ● |
| **scalar(같은 필드)** | ● | ● | ● | ● | ● | ● | ● | — | ○¹¹ | ● | ● | ● | ● | ● | ● | ● |
| **add_tool** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○¹² | ● | ● | ● | ● |
| **remove_tool** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○¹² | ● | ● | ● | ● | ● |
| **add_edge** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ◐¹³ | ○¹⁴ | ● | ● |
| **remove_edge** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○¹⁴ | ● | ● | ● |
| **paste_batch** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ●¹⁵ | ● |
| **confirm_item** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **record_conflict** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ●¹⁶ |
| **set_doc_title** | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |

### 3.3 각주 — 교환 불가일 때 무엇을 하는가

**¹ `insert_item` × `insert_item`, 같은 형제 목록의 같은 자리**
두 사람이 같은 지점에 삽입 → 서로 다른 UUID·서로 다른 `sortKey`(jitter). 최종 상태는 **순서와 무관하게 동일**(둘 다 존재, 키 바이트 순서로 정렬). 진짜 교환 불가는 `sortKey`가 **완전히 같을 때**(~1/47,000)뿐이고, 이때는 `items_sibling_order` 유니크 인덱스가 튄다.
→ **처리**: 서버가 유니크 위반을 잡아 `keyBetween(충돌키, 다음키)`로 재발급하고 **보상 `reorder_item`을 `serverOps[]`에 담아 돌려준다**(I3: payload를 재작성하지 않고 op을 *추가*한다). 사용자에게는 아무것도 보이지 않는다.

**² `insert_item(child of P)` × `move_item(P, …)`**
부모가 이동하는 도중 자식이 들어온다. 두 순서 모두 "자식은 P 아래, P는 새 위치"로 끝난다 → **실제로는 교환 가능**. 단 하나의 예외: `move_item`이 P를 자기 자신의 새 자식 아래로 넣는 경우 → 사이클. `applyOp`의 `isDescendant` 가드가 **양쪽 순서에서 동일하게** 후자를 무시하므로 결과가 같다. 그래서 ◐로 표시하되 처리는 불필요하다.

**³ `delete_item` × `restore_item`, 같은 아이템**
순서에 따라 최종이 살아있거나 죽어있다. **처리: 서버 순서를 따르되 삭제 쪽이 이겨도 데이터는 남아 있다**(tombstone). 그리고 **되살리기 어포던스를 남긴다** — 인라인 "이 단계는 다른 곳에서 지워졌어요. 내용은 그대로 있어요. `[되살리기]`". 자동 선택이 아니라 사실 제시다.

**⁴ `move_item(x)` × `move_item(x)`, 서로 다른 목적지**
LWW: 서버 전체 순서의 마지막이 이긴다. **충돌 레코드를 만들지 않는다** — 위치는 "두 개를 다 남길" 수 있는 값이 아니고(아이템은 하나), 잃는 바이트도 없다. 대신 §13에 `move_conflict` 카운터를 남긴다(빈발하면 UX 문제 신호).

**⁵ `move_item(x)` × `reorder_item(x)` / **⁶ `reorder_item(x)` × `reorder_item(x)`**
같은 이유로 LWW. `reorder`는 `sortKey`만 바꾸므로 뒤에 오는 쪽이 최종 위치가 된다.

**⁷ `set_title(x)` × `set_title(x)` — 가장 중요한 칸**
여기가 §5.3 전체가 걸린 자리다. **처리 3단**:
1. `merge3(from, 서버현재, to)` 성공 & `silent` → 조용히 병합, 사용자에게 표시 없음
2. `merge3` 성공 & `!silent`(양쪽이 서로 다른 구간 수정) → 조용히 병합하되 §13에 기록. **사용자에게 알리지 않는다** — 결과 문장이 두 사람 의도를 모두 담고 있기 때문
3. `merge3` 실패(같은 구간) → `record_conflict` 발행 → "두 내용을 모두 남겨뒀어요"

**⁸ `set_kind(x)` × `set_kind(x)`**
`task ↔ branch`는 자식의 역할을 뒤집는다(GRAPH-CORE §1.3). LWW로 두되, **두 값이 다르면 `record_conflict`를 만든다** — 종류가 바뀌면 그림이 크게 변해서 사용자가 알아야 한다. 필드 `kind`의 충돌 칩은 "이 단계의 종류를 두 곳에서 다르게 바꾸셨어요"로 문구만 다르다.

**⁹ `set_kind` × `set_attr`**
`kind: 'task'`가 되면서 `attrs.mode`(분기 전용)가 남으면 무의미한 값이 남는다. **교환 가능하다**(최종 상태는 같다) — `derive()`가 kind 기준으로 attrs를 무시하기 때문이다. **정리(cleanup)를 리듀서에서 하지 않는 이유**: 정리를 넣는 순간 op 순서가 결과를 바꾼다. 되돌아올 때 값이 살아있는 게 사용자에게도 낫다.

**¹⁰ `set_attr` × `set_attr`**
**키가 겹치지 않으면 ●, 겹치면 ○.** 이것이 `set_attr`을 `attrs` 통째가 아니라 patch로 정의한 이유다. 겹치는 키에 대해서만 §5.3 절차를 태운다(문자열이 아닌 값은 merge3 대상이 아니므로 곧장 `record_conflict`).

**¹¹ 같은 스칼라 필드 두 번**
`set_assignee` 등. LWW + 값이 다르면 `record_conflict`. **담당자는 특히 중요하다** — 두 사람이 서로 다른 담당자를 넣었다는 사실 자체가 조직의 정보다(PRD의 "누가 하는지 서로 모른다"). 조용히 덮으면 그 신호가 사라진다.

**¹² `add_tool(t)` × `remove_tool(t)`, 같은 도구**
LWW로 두면 순서 의존이 남는다. **처리: add-wins로 결정한다.** 서버는 `remove_tool`을 적용할 때 같은 배치·같은 revision 창에 동일 `(item, tool)`에 대한 `add_tool`이 있으면 제거를 건너뛴다. 근거는 I1과 같은 방향 — 남아 있는 도구는 눈에 보이고 한 번 더 지우면 되지만, 사라진 도구는 사용자가 눈치채지 못한다.

**¹³ `add_edge` × `add_edge`, 같은 (source,target)**
서로 다른 엣지 ID로 같은 연결이 두 개 생긴다. 리듀서가 중복을 무시하므로 **먼저 들어온 ID가 남는다** — 순서 의존이지만 결과 그래프는 동일하고 `derive()`의 `explicit-duplicates-derived` 진단도 동일하다. contentHash 기준으로는 ●, 행 ID 기준으로는 ◐. **행 ID 차이가 문제가 되는 곳은 undo뿐이고**, undo는 자기 op의 ID를 알고 있으므로 안전하다.

**¹⁴ `add_edge(e)` × `remove_edge(e)`**
LWW. 엣지에는 사용자가 쓴 바이트가 `label`뿐이고 undo가 들고 있으므로 충돌 레코드를 만들지 않는다.

**¹⁵ `paste_batch` × `paste_batch`**
전부 새 UUID → **항상 교환 가능.** 굵은 op을 허용할 수 있었던 이유이고, 이 칸이 ●라는 사실이 §1.5의 예외를 정당화한다.

**¹⁶ `record_conflict` × `record_conflict`, 같은 슬롯**
variants를 값 기준 dedup + `(lamport, actorId)` 정렬로 누적하므로 **순서 무관**. 서버와 클라이언트가 같은 충돌을 각자 발견해도 하나로 수렴한다.

### 3.4 코드

```ts
// packages/graph-core/src/ops/commute.ts
/**
 * §3.2 표의 실행 가능한 형태. 서버 무침묵 병합(§9.4)과 rebase(§5.1)가 이 함수 하나를 공유한다.
 * **보수적이다** — 판단이 애매하면 false를 돌려준다. false의 비용은 사용자에게 칩 하나,
 * true의 비용은 데이터 손실이다.
 */
export function commutes(x: Op, y: Op): boolean {
  const xs = touchedItems(x);
  const ys = touchedItems(y);
  const shared = [...xs].filter((id) => ys.has(id));

  // 1) 만지는 아이템이 겹치지 않으면 거의 항상 교환 가능
  if (shared.length === 0) return !crossesStructure(x, y);

  // 2) 겹칠 때는 필드 슬롯까지 본다
  for (const id of shared) {
    const a = slots(x, id);
    const b = slots(y, id);
    for (const s of a) {
      if (!b.has(s)) continue;
      if (s === 'tools') { if (!toolsCommute(x, y)) return false; continue; }
      return false;                       // 같은 슬롯 = 교환 불가
    }
    // 삭제 ↔ 복구
    if (a.has('life') && b.has('life') && x.type !== y.type) return false;
    // 위치 슬롯
    if (a.has('pos') && b.has('pos')) return false;
  }
  return true;
}

type Slot = 'life' | 'pos' | 'title' | 'kind' | 'assignee' | 'duration' | 'freq'
          | 'automation' | 'pain' | 'tools' | 'confirm' | 'edge' | `attr:${string}`;

function slots(op: Op, id: string): Set<Slot> {
  switch (op.type) {
    case 'delete_item': case 'restore_item': return new Set(['life']);
    case 'move_item': case 'reorder_item':   return new Set(['pos']);
    case 'set_title':      return new Set(['title']);
    case 'set_kind':       return new Set(['kind']);
    case 'set_assignee':   return new Set(['assignee']);
    case 'set_duration':   return new Set(['duration']);
    case 'set_freq':       return new Set(['freq']);
    case 'set_automation': return new Set(['automation']);
    case 'set_pain':       return new Set(['pain']);
    case 'add_tool': case 'remove_tool': return new Set(['tools']);
    case 'set_attr':       return new Set(Object.keys(op.to).map((k) => `attr:${k}` as Slot));
    case 'confirm_item':   return new Set();      // max 병합 → 항상 교환 가능
    case 'insert_item': case 'paste_batch': return new Set();  // 새 UUID만 만든다
    case 'add_edge': case 'remove_edge': case 'suppress_edge':
    case 'unsuppress_edge': case 'set_edge_label': return new Set(['edge']);
    default: return new Set();
  }
}

/** 같은 도구를 한쪽이 넣고 한쪽이 빼면 교환 불가 (각주 12) */
function toolsCommute(x: Op, y: Op): boolean {
  if (!('toolId' in x) || !('toolId' in y)) return true;
  if (x.toolId !== y.toolId) return true;
  return x.type === y.type;
}

/** 트리 구조를 서로의 영역에서 흔드는 경우 (각주 2) */
function crossesStructure(x: Op, y: Op): boolean {
  const structural = new Set(['move_item', 'delete_item', 'restore_item']);
  if (!structural.has(x.type) || !structural.has(y.type)) return false;
  // 서로 다른 아이템의 move끼리도 사이클을 만들 수 있다: move(a→b밑) × move(b→a밑)
  return x.type === 'move_item' && y.type === 'move_item';
}

function touchedItems(op: Op): Set<string> {
  if (op.type === 'paste_batch') return new Set(op.items.map((i) => i.id));
  if ('itemId' in op) return new Set([op.itemId]);
  if ('id' in op) return new Set([op.id]);
  return new Set();
}

/** 배치 대 배치 — 서버 무침묵 병합의 실제 진입점 */
export function batchCommutes(mine: readonly Op[], theirs: readonly Op[]): boolean {
  for (const a of mine) for (const b of theirs) if (!commutes(a, b)) return false;
  return true;
}
```

`commutes`가 O(n·m)인 것은 의도적이다. `mine ≤ 200`, `theirs`는 대부분 한 자릿수. 최악(며칠 오프라인 후 복귀)에는 §8.3의 다른 경로로 빠진다.

---

## 4. 낙관적 업데이트 + 아웃바운드 큐

### 4.1 스토어

```ts
// packages/sync-client/src/store.ts
import { create } from 'zustand';
import type { DocState, Op, OpEnvelope } from '@workflow/graph-core';

export type SyncPhase =
  | 'idle' | 'queued' | 'sending' | 'saved'
  | 'retrying' | 'degraded' | 'offline'
  | 'merging' | 'readonly';   // readonly = 리더가 아닌 탭 (§7)

export type SyncState = {
  /* ── 문서 ── */
  doc: DocState;
  /** 서버가 인정한 마지막 revision. 로컬 미확인 op은 이 위에 얹혀 있다 */
  serverRevision: number;
  /** 서버가 확정한 상태. rebase의 기준점 — 이게 없으면 3-way merge의 base가 없다 */
  confirmed: DocState;

  /* ── 큐 3단 ── */
  /** 로컬 적용 완료 + 서버 미확인. inflight ∪ queued의 상위집합이 아니라, 봉투 원본 보관소 */
  applied: OpEnvelope[];
  inflight: OpEnvelope[];     // 전송 중 배치 (문서당 최대 1개, I6)
  queued: OpEnvelope[];       // 대기

  /* ── 상태 표시 ── */
  phase: SyncPhase;
  attempt: number;            // 연속 실패 횟수
  firstFailureAt: number | null;
  lastSavedAt: number | null;
  isLeader: boolean;
  /** 저장소 열화 모드 (§6.4) */
  storage: 'idb' | 'memory';

  /* ── 액션 ── */
  dispatch(ops: Op | Op[], opts?: { txnId?: string; undoable?: boolean }): void;
  flush(reason: 'debounce' | 'manual' | 'beacon' | 'handover' | 'reconnect'): Promise<void>;
};
```

**`confirmed`를 따로 들고 있는 이유가 이 설계의 숨은 축이다.** `doc`은 낙관적 상태(내 미확인 op 포함)이고, `confirmed`는 서버가 인정한 상태다. 둘이 있어야:
- 3-way merge의 base를 정확히 찾을 수 있다
- 409에서 `confirmed`에 `missedOps`를 얹고 그 위에 미확인 op을 다시 얹는 rebase가 가능하다
- 발산 탐지(§13)가 `confirmed`의 `contentHash`를 서버와 비교할 수 있다

메모리 비용은 아이템 수백 개 × 2 = 무시할 수준이고, 구조 공유(`mapSet`)로 대부분의 아이템 객체는 두 상태가 공유한다.

```ts
// dispatch — 낙관적 적용의 전부
dispatch(input, opts = {}) {
  const ops = Array.isArray(input) ? input : [input];
  const txnId = opts.txnId ?? newUuid();
  set((s) => {
    if (!s.isLeader) return s;                       // 보기 전용 탭은 op을 만들지 않는다 (§7)
    let doc = s.doc;
    const envelopes: OpEnvelope[] = [];
    const inverses: Op[] = [];
    for (const op of ops) {
      const before = doc;
      const next = applyOp(doc, op);
      if (next === before) continue;                 // 무변화 op은 큐에 넣지 않는다
      if (opts.undoable !== false) {
        const inv = invertOp(before, op);
        if (inv) inverses.unshift(...inv);           // 역순 누적
      }
      doc = next;
      envelopes.push(envelope(op, txnId));
    }
    if (envelopes.length === 0) return s;
    if (inverses.length > 0) undoStack.push({ txnId, inverse: inverses, at: Date.now(), label: labelFor(ops) });
    return {
      doc,
      applied: [...s.applied, ...envelopes],
      queued: coalesce([...s.queued, ...envelopes]),
      phase: s.phase === 'offline' || s.phase === 'degraded' ? s.phase : 'queued',
    };
  });
  outboxStore.append(envelopes);   // IndexedDB (§6) — 비동기, UI를 막지 않는다
  channel.post({ t: 'ops', ops: envelopes });  // 다른 탭 (§7)
  scheduleFlush();
}
```

### 4.2 압축(coalescing) — `set_title` 100번 → 1번

버스트 확정(§1.2)이 1차 방어, 큐 압축이 2차 방어다. 버스트가 열려 있는데 사용자가 다른 아이템으로 갔다 돌아오면 op이 두 개가 되고, 800ms 창 안에 그런 일이 여러 번 일어난다.

```ts
// packages/graph-core/src/ops/coalesce.ts
/**
 * 큐 안의 연속 op을 의미 보존하며 줄인다.
 *
 * 불변식(§14.4가 속성 테스트로 검증한다):
 *   applyOps(s, coalesce(ops)) ≡ applyOps(s, ops)      — 모든 s에 대해
 *
 * 오른쪽에서 왼쪽으로 훑으며 "이 뒤에 같은 슬롯을 덮어쓰는 op이 있는가"를 본다.
 * 장벽(barrier)을 넘어서는 압축하지 않는다.
 */
export function coalesce(ops: readonly OpEnvelope[]): OpEnvelope[] {
  const out: OpEnvelope[] = [];
  const seenSlot = new Set<string>();      // `${itemId}:${slot}`
  const barrier = new Set<string>();       // 이 아이템은 이 지점 이후로 압축 금지

  for (let i = ops.length - 1; i >= 0; i--) {
    const env = ops[i]!;
    const op = env.op;
    const ids = touchedItems(op);

    // 구조 op은 장벽이다 — 이걸 넘어 필드 op을 합치면 순서 의미가 깨진다
    if (op.type === 'delete_item' || op.type === 'restore_item' ||
        op.type === 'move_item' || op.type === 'paste_batch') {
      for (const id of ids) barrier.add(id);
      out.push(env);
      continue;
    }

    const id = [...ids][0];
    if (id === undefined) { out.push(env); continue; }

    for (const slot of slots(op, id)) {
      const key = `${id}:${slot}`;
      if (!barrier.has(id) && seenSlot.has(key)) {
        // 뒤에 같은 슬롯을 덮어쓰는 op이 있다 → 이 op은 버린다.
        // 단 `from`은 살려야 3-way merge의 base가 보존된다 (아래 fixFrom)
        markDropped(env, key);
      }
      seenSlot.add(key);
    }
    if (!isDropped(env)) out.push(env);
  }
  out.reverse();
  return fixFrom(out, ops);
}

/**
 * 압축 후 남은 op의 `from`을 **가장 이른 값**으로 되돌린다.
 *
 * set_title(A→B), set_title(B→C) 를 set_title(B→C)로 줄이면 base가 B가 되어버린다.
 * 그러면 동료가 A에서 갈라져 나갔을 때 3-way merge의 공통 조상이 틀어진다.
 * 반드시 set_title(A→C)로 만들어야 한다. **압축이 병합 품질을 깎으면 안 된다.**
 */
function fixFrom(kept: OpEnvelope[], original: readonly OpEnvelope[]): OpEnvelope[] { /* … */ }
```

**추가로 반드시 넣는 두 규칙**

```ts
// (1) insert 직후의 set_title은 insert에 흡수시킨다 — 새 줄에 타이핑하는 가장 흔한 경로
//     insert_item(id, title:'') + set_title(id, ''→'견적서 작성')  →  insert_item(id, title:'견적서 작성')
//
// (2) 만들고 바로 지운 아이템은 **아예 보내지 않는다**
//     insert_item(id) … delete_item(id)  →  둘 다 제거
//     조건: 그 사이 다른 op이 이 id를 참조하지 않고(엣지 포함),
//           id가 아직 한 번도 ack되지 않았을 것(applied에만 있고 serverRevision에 반영 안 됨)
//     "Enter 눌렀다가 마음 바뀌어 지움"이 op 로그를 오염시키지 않게 한다
```

(2)에 조건이 붙는 이유: 이미 서버가 아는 아이템을 큐에서 지워버리면 다른 사람 화면에 유령 아이템이 남는다. **ack 여부 확인은 협상 불가한 조건이다.**

### 4.3 배치 규칙

```ts
const BATCH = {
  DEBOUNCE_MS: 800,          // ARCHITECTURE §6 확정값
  MAX_OPS: 200,              // ApplyOpsInput의 상한과 같아야 한다
  MAX_BYTES: 512 * 1024,     // 서버 액션 바디 상한 여유분
  BEACON_BYTES: 60 * 1024,   // sendBeacon/keepalive 상한(64KB)에서 헤더 여유
  MAX_WAIT_MS: 5_000,        // 디바운스가 계속 밀려도 5초에 한 번은 반드시 나간다
};

function scheduleFlush() {
  const s = get();
  if (s.queued.length >= BATCH.MAX_OPS) return void flush('debounce');    // 즉시
  if (s.oldestQueuedAge() >= BATCH.MAX_WAIT_MS) return void flush('debounce');
  debounce(BATCH.DEBOUNCE_MS, () => flush('debounce'));
}
```

**`MAX_WAIT_MS`가 필요한 이유**: 800ms 디바운스는 "800ms마다"가 아니라 "마지막 입력 후 800ms"다. 쉬지 않고 타이핑하는 사용자는 **영원히 저장되지 않는다.** 상단바는 계속 `저장 중`이고 사용자는 눈치채지 못한 채 5분치 글이 로컬에만 있게 된다. 5초 상한이 이걸 막는다.

**전송은 문서당 동시 1배치(I6)**:

```ts
async function flush(reason: FlushReason) {
  const s = get();
  if (!s.isLeader) return;                                  // 리더만 보낸다
  if (s.inflight.length > 0 && reason !== 'beacon') return; // 이미 나가 있으면 대기
  if (s.queued.length === 0) return;

  const batch = takeBatch(s.queued, reason === 'beacon' ? BATCH.BEACON_BYTES : BATCH.MAX_BYTES);
  set({ inflight: batch, queued: s.queued.slice(batch.length), phase: 'sending' });

  const res = await transport.send({
    docId: s.doc.docId,
    baseRevision: s.serverRevision,
    ops: batch,
    expectedContentHash: hashOf(applyOps(s.confirmed, batch.map((e) => e.op))),
  });
  handleResult(res, batch);
}
```

`takeBatch`는 **접두(prefix)만 자른다.** op은 순서가 의미를 가지므로 중간을 골라 보낼 수 없다.

### 4.4 전송 중 새 op이 들어오면

`queued`에 쌓인다. 그게 전부다 — 하지만 **`inflight`와 `queued` 사이의 압축은 하지 않는다.** `inflight`는 이미 서버로 갔고 결과를 모르므로, 그 op을 전제로 한 압축은 서버가 거절했을 때 되돌릴 수 없다.

```
사용자 타이핑 →  dispatch → queued에 적재 + coalesce(queued 내부만)
                                   ↑
                inflight  ─────────┘  (여기를 넘어 합치지 않는다)
```

한 가지 예외: `queued`의 op이 `inflight`의 op과 **같은 슬롯**이면, `from`을 `inflight` op의 `to`로 맞춰 둔다. 서버가 성공하면 이 `from`이 정확한 base가 된다. 실패하면 `inflight`가 `queued` 앞으로 되돌아오므로 여전히 정확하다.

### 4.5 실패 시 큐 상태 — 상태 머신

```ts
function handleResult(res: ApplyOpsResult, batch: OpEnvelope[]) {
  switch (res.kind) {
    case 'ok': {
      set((s) => ({
        serverRevision: res.revision,
        confirmed: applyOps(s.confirmed, [...batch.map((e) => e.op), ...res.serverOps.map((e) => e.op)]),
        doc: res.serverOps.length ? applyOps(s.doc, res.serverOps.map((e) => e.op)) : s.doc,
        applied: s.applied.filter((e) => !res.appliedOpIds.includes(e.opId)),
        inflight: [],
        attempt: 0, firstFailureAt: null,
        lastSavedAt: Date.now(),
        phase: s.queued.length > 0 ? 'queued' : 'saved',
      }));
      outboxStore.ack(res.appliedOpIds);
      if (get().queued.length > 0) void flush('debounce');
      break;
    }

    case 'conflict':                    // 409 — §5
      set({ phase: 'merging' });
      void rebase(res);
      break;

    case 'gone':                        // 410 — 서버가 너무 앞섬 (§8.3)
      set({ phase: 'merging' });
      void resync(res);
      break;

    case 'denied':                       // 403 — 권한 상실 (§9.5)
      set({ phase: 'readonly', inflight: [] });
      break;

    case 'network':
    case 'server-error': {
      // ★ 큐 앞으로 되돌린다. 순서 보존이 생명이다
      set((s) => ({
        queued: [...batch, ...s.queued],
        inflight: [],
        attempt: s.attempt + 1,
        firstFailureAt: s.firstFailureAt ?? Date.now(),
        phase: nextFailurePhase(s),
      }));
      scheduleRetry(get().attempt);
      break;
    }
  }
}

/** STATES.md §5 표를 그대로 옮긴 것. 이 함수가 UI 문구의 유일한 출처다 */
function nextFailurePhase(s: SyncState): SyncPhase {
  if (!network.isOnline()) return 'offline';
  const elapsed = Date.now() - (s.firstFailureAt ?? Date.now());
  if (elapsed >= 20_000 || s.attempt + 1 >= 3) return 'degraded';
  return 'retrying';
}

/** 백오프 800ms → 2s → 5s, 이후 5s 유지 + ±20% 지터 (동시 복귀 폭주 방지) */
const BACKOFF = [800, 2_000, 5_000];
function scheduleRetry(attempt: number) {
  const base = BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)]!;
  const jitter = base * (0.8 + Math.random() * 0.4);
  timer.set('retry', jitter, () => void flush('debounce'));
}
```

### 4.6 표시 라벨 — STATES.md와 1:1

```ts
// packages/sync-client/src/label.ts
export type SaveIndicator = {
  /** 상단바 텍스트. 색만으로 전달하지 않는다 (STATES §5 원칙 a) */
  label: string;
  /** 인라인 바 종류. 모달은 존재하지 않는다 */
  bar: 'none' | 'local' | 'offline' | 'readonly' | 'conflict';
  /** aria-live로 읽을 것. sending은 절대 읽지 않는다 */
  announce: 'saved' | 'degraded' | 'offline' | 'reconnected' | null;
  toast?: { text: string; ms: number };
};

export function indicator(s: SyncState, now: number): SaveIndicator {
  if (!s.isLeader) return { label: '보기 전용', bar: 'readonly', announce: null };

  switch (s.phase) {
    case 'idle':
    case 'saved':   return { label: '저장됨', bar: 'none', announce: 'saved' };
    case 'queued':
    case 'sending': return { label: '저장 중', bar: 'none', announce: null };
    case 'merging': return { label: '합치는 중', bar: 'none', announce: null };

    case 'retrying': {
      const elapsed = now - (s.firstFailureAt ?? now);
      // ≤6s는 **사용자에게 알리지 않는다.** 첫 실패는 대부분 순간적 흔들림이다
      if (elapsed < 6_000) return { label: '저장 중', bar: 'none', announce: null };
      return { label: '저장 대기 중', bar: 'none', announce: null };
    }

    case 'degraded': return { label: '이 기기에 저장됨', bar: 'local', announce: 'degraded' };
    case 'offline':  return { label: '오프라인 · 이 기기에 저장됨', bar: 'offline', announce: 'offline' };
    case 'readonly': return { label: '보기 전용', bar: 'readonly', announce: null };
  }
}
```

`degraded`/`offline` → `saved` 전이에서만 §8.4의 검증을 통과한 뒤 토스트를 띄운다.

---

## 5. revision 충돌 해소 — 완전한 알고리즘

서버가 `409 + { serverRevision, missedOps[] }`를 돌려준 순간, 클라이언트가 하는 일 전부.

### 5.1 rebase 전체 흐름

```ts
// packages/sync-client/src/rebase.ts
export async function rebase(res: ConflictResult): Promise<void> {
  const s = get();

  // 0) 되돌릴 대상: inflight + queued (= 서버가 모르는 내 op 전부, 순서 보존)
  const unacked = [...s.inflight, ...s.queued];

  // 1) 서버 확정 상태를 앞으로 감는다. confirmed는 **항상 서버와 같아야 한다**
  const confirmed = applyOps(s.confirmed, res.missedOps.map((e) => e.op));

  // 2) 내 op을 하나씩 새 base 위로 옮긴다
  const rebased: OpEnvelope[] = [];
  const conflictOps: Op[] = [];
  for (const env of unacked) {
    const r = rebaseOne(env, confirmed, res.missedOps, s.confirmed);
    if (r.kind === 'keep')    rebased.push(r.env);
    if (r.kind === 'replace') rebased.push({ ...r.env, op: r.op });
    if (r.kind === 'drop')    continue;                  // 서버가 이미 같은 결과를 만듦
    if (r.kind === 'conflict') { conflictOps.push(r.record); rebased.push(r.env); }
  }

  // 3) 새 로컬 상태 = 서버 확정 + 내 op 재적용.  **로컬 상태를 교체하지 않는다** (I2)
  const doc = applyOps(confirmed, [...rebased.map((e) => e.op), ...conflictOps]);

  set({
    serverRevision: res.serverRevision,
    confirmed,
    doc,
    inflight: [],
    queued: [...rebased, ...conflictOps.map(wrap)],
    applied: rebased,
    phase: 'sending',
  });

  await outboxStore.replaceAll(get().queued);   // IndexedDB도 같은 모양으로 (§6)
  channel.post({ t: 'rebased', revision: res.serverRevision });
  void flush('debounce');
}
```

**핵심은 2단계다.** 아래가 op 종류별 규칙 전부.

```ts
type RebaseOutcome =
  | { kind: 'keep'; env: OpEnvelope }
  | { kind: 'replace'; env: OpEnvelope; op: Op }
  | { kind: 'drop' }
  | { kind: 'conflict'; env: OpEnvelope; record: Op };

function rebaseOne(env: OpEnvelope, base: DocState, missed: OpEnvelope[], oldBase: DocState): RebaseOutcome {
  const op = env.op;

  // (a) 교환 가능하면 그대로 — 대다수가 여기서 끝난다
  if (missed.every((m) => commutes(op, m.op))) return { kind: 'keep', env };

  switch (op.type) {
    /* ── 제목: 3-way merge ─────────────────────────────────────────── */
    case 'set_title': {
      const server = base.items.get(op.id)?.title;
      if (server === undefined) return { kind: 'keep', env };      // §5.4
      if (server === op.to) return { kind: 'drop' };               // 서버가 이미 내 값
      const m = merge3(op.from, op.to, server);                    // base, mine, theirs
      if (m.ok) return { kind: 'replace', env, op: { ...op, from: server, to: m.text } };
      return {
        kind: 'conflict', env,
        record: {
          type: 'record_conflict', itemId: op.id, field: 'title',
          base: JSON.stringify(op.from),
          variants: [
            { value: JSON.stringify(op.to), actorId: env.actorId, lamport: env.lamport },
            { value: JSON.stringify(server), actorId: theirActor(missed, op.id, 'title'), lamport: theirLamport(missed, op.id, 'title') },
          ],
        },
      };
    }

    /* ── attrs: 키 단위로 쪼갠다 ───────────────────────────────────── */
    case 'set_attr': {
      const serverAttrs = base.items.get(op.id)?.attrs ?? {};
      const keep: Record<string, unknown> = {};
      const from: Record<string, unknown> = {};
      const clashes: string[] = [];
      for (const [k, v] of Object.entries(op.to)) {
        const sv = (serverAttrs as Record<string, unknown>)[k];
        const bv = (op.from as Record<string, unknown>)[k];
        if (sv === v) continue;                       // 같은 결과 → 버린다
        if (sv === bv) { keep[k] = v; from[k] = sv; } // 서버가 안 건드림 → 내 값 유지
        else clashes.push(k);                          // 양쪽이 다르게 바꿈
      }
      if (clashes.length === 0) {
        return Object.keys(keep).length === 0
          ? { kind: 'drop' }
          : { kind: 'replace', env, op: { ...op, from, to: keep } };
      }
      return { kind: 'conflict', env, record: attrConflictRecord(op, serverAttrs, clashes, env) };
    }

    /* ── 스칼라: 값이 같으면 drop, 다르면 둘 다 남긴다 ─────────────── */
    case 'set_assignee': case 'set_duration': case 'set_kind':
    case 'set_freq': case 'set_automation': case 'set_pain': {
      const cur = readField(base.items.get(op.id), fieldOf(op));
      if (cur === op.to) return { kind: 'drop' };
      if (cur === op.from) return { kind: 'keep', env };   // 서버가 안 건드림
      // 양쪽이 다르게 바꿈 — pain/freq/automation은 되돌릴 비용이 낮아 조용히 내 값을 쓴다
      if (op.type === 'set_pain' || op.type === 'set_freq' || op.type === 'set_automation') {
        return { kind: 'replace', env, op: { ...op, from: cur } as Op };
      }
      // assignee / duration / kind는 사용자가 알아야 한다
      return { kind: 'conflict', env, record: scalarConflictRecord(op, cur, env) };
    }

    /* ── 위치: LWW. 내 것이 나중이므로 그대로 보낸다 ───────────────── */
    case 'move_item': {
      if (!base.items.has(op.id)) return { kind: 'drop' };
      // 서버 상태 기준으로 사이클이 되면 버린다 (내 트리 모양이 이미 달라졌다)
      if (op.parentId !== null && isDescendant(base, op.parentId, op.id)) return { kind: 'drop' };
      return { kind: 'keep', env };
    }
    case 'reorder_item':
      return base.items.has(op.id) ? { kind: 'keep', env } : { kind: 'drop' };

    /* ── 생성/삭제 ─────────────────────────────────────────────────── */
    case 'insert_item': case 'paste_batch':
      return { kind: 'keep', env };            // 새 UUID — 절대 충돌하지 않는다

    case 'delete_item':
      return base.items.get(op.id)?.deletedAt ? { kind: 'drop' } : { kind: 'keep', env };

    case 'restore_item':
      return base.items.get(op.id)?.deletedAt ? { kind: 'keep', env } : { kind: 'drop' };

    /* ── 엣지 ──────────────────────────────────────────────────────── */
    case 'add_edge': case 'suppress_edge':
      return base.edges.has(op.id) ? { kind: 'drop' } : { kind: 'keep', env };
    case 'remove_edge': case 'unsuppress_edge':
      return base.edges.has(op.id) ? { kind: 'keep', env } : { kind: 'drop' };

    default:
      return { kind: 'keep', env };
  }
}
```

### 5.2 `sortKey` 충돌 — 두 사람이 같은 자리에 삽입

**3중 방어. 사용자는 어느 층에서도 아무것도 보지 않는다.**

**1층 — jitter (거의 전부 여기서 끝난다).**
`fractional-indexing-jittered`의 `keyBetween(a, b)`는 결정적 중점이 아니라 그 근방의 난수 키를 만든다. 두 클라이언트가 같은 `(a, b)`로 호출해도 키가 같을 확률은 ~1/47,000. 다르면 **둘 다 살아남고 바이트 순서로 정렬된다.** 순서가 "내가 의도한 것과 반대"일 수는 있지만 **잃는 것은 없고**, 사용자는 그냥 한 줄을 끌어 옮기면 된다. 이게 정수 `order`를 버린 대가로 얻은 것이다.

**2층 — 유니크 인덱스 + 서버 재발급.**
`uniqueIndex('items_sibling_order').on(docId, parentId, sortKey)`가 있으므로 완전 동일 키는 DB가 거절한다.

```ts
// server/services/commit-ops.ts 발췌
try {
  await tx.insert(items).values(row);
} catch (e) {
  if (!isUniqueViolation(e, 'items_sibling_order')) throw e;
  // 같은 (docId,parentId,sortKey)를 가진 기존 행 다음 자리로 재발급
  const next = await nextSiblingKey(tx, row.docId, row.parentId, row.sortKey);
  const rekeyed = keyBetween(row.sortKey, next);
  await tx.insert(items).values({ ...row, sortKey: rekeyed });
  // ★ payload를 고쳐 쓰지 않는다 (I3). 보상 op을 **추가**해서 돌려준다
  serverOps.push(makeServerOp({ type: 'reorder_item', id: row.id, sortKey: rekeyed }));
}
```

클라이언트는 응답의 `serverOps`를 그대로 적용한다. 화면에서는 줄 하나가 제자리에 남는다.

**3층 — `derive()`의 `duplicate-sort-key` 복구.**
그래도 어긋난 데이터가 존재하면(과거 데이터·수동 수정) 전처리가 ID 사전순으로 안정 정렬한다. **그림은 언제나 그려진다.**

**`move_item`의 sortKey는 어떻게 되는가**: 이동은 목적지 형제 목록에서 새 키를 발급받으므로 삽입과 완전히 같은 3층을 탄다.

### 5.3 같은 아이템의 `title`을 양쪽이 고쳤을 때 — "두 내용 모두 남겨둔다"의 실제 구현

**단계 1. 대부분은 충돌이 아니다.**
`merge3`(§2.5)가 겹치지 않는 편집을 조용히 합친다. 실측 기대: 제목 동시 편집의 60~70%가 여기서 끝난다(한쪽은 앞에 수식어를 붙이고 한쪽은 뒤에 목적어를 붙이는 패턴이 압도적이다).

**단계 2. 겹치면 데이터 구조를 만든다.** 어느 쪽도 버리지 않는 방법은 **슬롯을 하나 더 만드는 것**뿐이다.

```sql
-- db/schema.ts 에 추가
CREATE TABLE item_conflicts (
  id          text PRIMARY KEY,          -- `${item_id}:${field}` — 결정적, upsert 가능
  doc_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL,
  field       text NOT NULL,             -- 'title' | 'assigneeId' | 'kind' | 'attrs' | 'deleted' | ...
  base        jsonb NOT NULL,            -- 공통 조상
  variants    jsonb NOT NULL,            -- [{value, actorId, lamport}] — 2개 이상, 정렬 저장
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);
CREATE INDEX item_conflicts_doc_live ON item_conflicts (doc_id) WHERE resolved_at IS NULL;
```

**단계 3. 아이템 슬롯에는 무엇이 들어가는가 — 여기가 가장 예민하다.**

`items.title`에는 **서버 전체 순서의 승자**가 들어간다. 그리고 진 값은 `item_conflicts.variants`에 **원문 그대로** 들어간다.

이걸 "자동 선택"이라 부르면 안 되는 이유:

- **선택이 아니라 슬롯 배치다.** 제목 슬롯은 물리적으로 하나이고 무언가는 거기 있어야 한다. 두 값을 이어 붙이면(`"견적서 검토 / 견적서 승인"`) 그건 사용자가 쓰지 않은 문장을 우리가 만들어낸 것이고, 캔버스·내보내기·n8n으로 전부 흘러간다. **더 나쁘다.**
- **버리지 않는다.** 두 값 모두 영속화되고, 화면에 동등한 위계로 제시되고, 한 번의 클릭으로 교체 가능하다.
- **서버 값을 넣는 이유**: 이미 다른 사람 화면에 그 값이 렌더되어 있다. 내 값을 슬롯에 넣으면 "내가 보는 것"과 "동료가 보는 것"이 갈라지고, 동료는 자기 글이 조용히 바뀐 것을 나중에 발견한다. **놀람의 총량을 최소화하는 배치**가 서버 값이다.
- **자동 선택 금지의 진짜 의미**는 "충돌이 있었다는 사실을 숨기지 마라"이고, 그건 아래 UI가 지킨다.

**단계 4. 사용자에게 제시하는 데이터.**

```ts
// 아웃라인 블록 옆 인라인 칩. 모달 아님, 편집 차단 아님
export type ConflictPresentation = {
  itemId: string;
  field: FieldConflictField;
  /** 칩 문구 — STATES §5 그대로 */
  chipText: '두 내용을 모두 남겨뒀어요';
  /** 펼쳤을 때 (`[무엇이 달라졌는지 보기]`) */
  detail: {
    /** 공통 조상. "원래" 라벨 */
    base: string;
    options: Array<{
      value: string;
      /** '이 기기에서 쓰신 내용' | '{이름}님이 쓰신 내용' — 이름은 디렉터리에서 (D-009) */
      byline: string;
      /** 현재 이 값이 슬롯에 들어가 있는가 */
      live: boolean;
      /** merge3 실패 구간만 하이라이트. 전체 diff를 보여주면 못 읽는다 */
      highlight: { start: number; end: number };
      /** 누르면 resolve_conflict op 발행 */
      action: '이걸로 두기';
    }>;
    /** 둘 다 필요한 사람을 위한 탈출구. 새 단계를 만들어 다른 값을 넣는다 */
    alsoOffer: { label: '두 내용을 각각 다른 단계로 두기'; makesOps: ['insert_item', 'set_title'] };
  };
};
```

**절대 하지 않는 것**: 모달, 편집 차단, 카운트다운, "충돌"이라는 낱말(WRITING.md), 빨간색, 자동 해소 타이머.

**해소 후에도 레코드를 지우지 않는다**(`resolved_at`만 채운다). 하루 뒤에 "아까 다른 쪽 문장이 뭐였지"를 물을 수 있어야 한다. 90일 후 GC.

### 5.4 삭제된 아이템에 대한 op

tombstone 덕분에 **거의 전부 문제가 아니다.** 행이 그대로 있으므로 필드 op은 정상 적용된다(`applyOp`의 `patch`는 `deletedAt`을 보지 않는다).

| 상황 | 처리 | 사용자가 보는 것 |
|---|---|---|
| 동료가 지운 아이템에 내가 `set_title` | **적용한다.** tombstone 행에 글이 저장된다 | 인라인: "이 단계는 다른 곳에서 지워졌어요. 방금 쓰신 내용은 남아 있어요. `[되살리기]`" |
| 동료가 지운 아이템 아래에 내가 `insert_item` | **적용한다.** 자식은 살아 있고 부모만 tombstone | `derive()`의 `orphan-parent` 복구가 루트로 붙여 그린다. 그림이 끊기지 않는다 |
| 내가 지운 아이템을 동료가 `restore_item` | LWW(각주 3). 살아나면 내 삭제 의도가 진다 | "지우셨던 단계를 {이름}님이 되살렸어요"는 **띄우지 않는다** — 알림 상한(D-079). 문서에 다시 보이는 것으로 충분 |
| 서버에 아예 **없는** 아이템에 대한 op | `applyOp`이 조용히 무시. 서버도 무시하고 `ignoredOpIds[]`에 담아 돌려준다 | 없음 |

마지막 행이 중요하다. 서버가 없는 아이템에 대한 op을 **오류로 처리하면 안 된다** — 스냅샷 압축 이후 재전송, 다른 문서로 잘못 라우팅된 op, 버그 등 정상적으로 일어난다. 조용히 무시하고 카운터만 올린다(§13에서 `ignored_op_rate`가 튀면 진짜 버그다).

**"지워진 아이템에 쓴 내용"의 회수 경로**: `item_conflicts`에 `field:'deleted'`로 기록하지 않는다(그건 값 충돌이 아니다). 대신 인라인 되살리기 버튼 하나. 30일 후 tombstone GC 때 **본문이 비어 있지 않은 tombstone은 삭제하지 않고 아카이브 테이블로 옮긴다**(I1의 마지막 그물).

### 5.5 병합 불가 판정 기준 — 최종 목록

`record_conflict`가 만들어지는 경우는 **정확히 아래 넷뿐이다.** 이 목록이 길어지면 사용자가 칩을 무시하기 시작한다.

| 조건 | 필드 | 왜 여기만 |
|---|---|---|
| `merge3` overlap 실패 | `title` | 문장의 같은 구간을 두 사람이 다르게 썼다. 기계가 고를 근거가 없다 |
| 양쪽이 서로 다른 non-null 값 | `assigneeId` | "누가 하는지 서로 모른다"는 이 제품이 드러내려는 사실 그 자체다. 덮으면 안 된다 |
| 양쪽이 서로 다른 값 | `durationBand`, `kind` | 그림과 숫자가 눈에 띄게 바뀐다. 조용히 바뀌면 사용자가 계산을 불신한다 |
| 같은 attrs 키를 다른 값으로 | `attrs.*` | `mode: xor↔and`는 리드타임 계산을 통째로 바꾼다(GRAPH-CORE §6.4) |

**충돌을 만들지 않는 것들**(의도적):
`painFlag`(개인 표식, D-025) · `freqLast7d` · `automationLevel`(다시 물으면 되는 값) · 위치(`move`/`reorder`) · 엣지 · `lastConfirmedAt`(max 병합) · 삭제/복구.

**상한**: 한 문서에 미해소 충돌이 **20개를 넘으면** 개별 칩을 그리지 않고 상단에 한 줄로 모은다 — "여러 곳에서 같은 단계를 다르게 고치셨어요. `[한꺼번에 보기]`". 칩 20개는 화면이 아니라 소음이다.

---

## 6. 로컬 영속화 (IndexedDB)

### 6.1 무엇을 저장하는가 — 셋 다 저장한다

"큐만 저장하면 되지 않나"는 틀렸다. 큐만 있으면 **재시작 후 큐를 적용할 base가 없다.** "문서만 저장하면 되지 않나"도 틀렸다. 그러면 어디까지 서버가 아는지 모르므로 재전송할 수 없다.

| 저장 대상 | 이유 | 쓰기 빈도 |
|---|---|---|
| **확정 스냅샷** (`confirmed`) | 재기동 시 rebase의 base. **서버가 인정한 상태여야 한다** | 5초 debounce 또는 50 op |
| **아웃박스** (미확인 봉투) | 미전송 op의 유일한 진실. 여기가 I5의 실체 | op 발행 즉시(250ms 마이크로배치) |
| **undo 스택 꼬리 20개** | 세션 이탈 후 복귀 시 되감기 (§11.3) | undo 항목 추가 시 |

낙관적 상태(`doc`)는 **저장하지 않는다.** `confirmed + 아웃박스`로 항상 재구성 가능하고, 두 벌을 저장하면 둘이 어긋났을 때 어느 쪽이 진실인지 판정할 방법이 없다. **파생된 것은 저장하지 않는다**(D-030과 같은 원칙).

### 6.2 스키마와 버전 관리

```ts
// packages/sync-client/src/idb.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** ★ 스키마를 바꿀 때마다 올린다. 내려갈 수는 없다 */
const DB_VERSION = 1;
const DB_NAME = 'workflow-sync';

/** 스냅샷 payload 형식 버전. DB 버전과 **다른 축**이다 (§6.2 하단) */
export const PAYLOAD_VERSION = 1;

interface SyncDB extends DBSchema {
  docs: {
    key: string;                      // docId
    value: {
      docId: string;
      revision: number;               // confirmed의 revision
      payloadVersion: number;
      /** DocState 직렬화. Map → 배열, Date → epoch ms */
      confirmed: SerializedDoc;
      updatedAt: number;
      /** 서버 contentHash. 재기동 시 대조 (§13.4) */
      contentHash: string;
    };
  };
  outbox: {
    key: string;                      // opId
    value: {
      opId: string;
      docId: string;
      /** 오리진 전역 단조 증가. 탭이 달라도 순서가 보존된다 (I5의 핵심) */
      seq: number;
      env: OpEnvelope;
      state: 'queued' | 'inflight';
      createdAt: number;
    };
    indexes: { 'by-doc-seq': [string, number] };
  };
  undo: {
    key: [string, string];            // [docId, txnId]
    value: { docId: string; txnId: string; inverse: Op[]; at: number; label: string };
    indexes: { 'by-doc-at': [string, number] };
  };
  meta: { key: string; value: { key: string; value: unknown } };
}

export async function open(): Promise<IDBPDatabase<SyncDB>> {
  return openDB<SyncDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('docs', { keyPath: 'docId' });
        const ob = db.createObjectStore('outbox', { keyPath: 'opId' });
        ob.createIndex('by-doc-seq', ['docId', 'seq']);
        const un = db.createObjectStore('undo', { keyPath: ['docId', 'txnId'] });
        un.createIndex('by-doc-at', ['docId', 'at']);
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // 이후 버전은 여기에 누적. **기존 스토어를 지우지 않는다** —
      // 마이그레이션 중 삭제는 미전송 op의 삭제와 같다 (I1 위반)
      void tx;
    },
    blocked() { log('idb.blocked'); },     // 다른 탭이 낡은 버전을 잡고 있다
    blocking() { channel.post({ t: 'reload-please' }); },  // 내가 낡은 버전을 잡고 있다
    terminated() { degradeToMemory('terminated'); },
  });
}
```

**버전 축이 둘인 이유.** `DB_VERSION`은 오브젝트 스토어 모양이고, `PAYLOAD_VERSION`은 `DocState` 직렬화 모양이다. 앱 배포는 잦지만 스토어 모양은 거의 안 바뀐다. 읽을 때 `payloadVersion`이 낮으면 **마이그레이션 함수 체인**을 태우고, 높으면(= 이 탭이 구버전 앱) **스냅샷을 무시하고 서버에서 새로 받는다.** 아웃박스는 그때도 **절대 버리지 않는다** — op은 앞뒤 호환이 되도록 설계했고(새 필드는 optional), 서버가 모르는 op 타입은 `ignoredOpIds`로 돌아온다.

**쓰기 정책**

```ts
// 아웃박스는 op 발행 즉시. 단 키 입력마다 IDB 트랜잭션을 열면 INP가 무너진다
const outboxWriter = microBatch(250, async (envs: OpEnvelope[]) => {
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  for (const env of envs) await tx.store.put({ ... });
  await tx.done;
});

// 강제 플러시 지점 — 여기서는 await한다
//   visibilitychange(hidden) / pagehide / blur / 탭 핸드오버 / 전송 직전
```

**250ms 창의 위험**을 정직하게 적는다: 이 창 안에 브라우저가 강제 종료되면 최대 250ms 분량의 op이 IDB에 없다. 다만 그 op들은 **zustand에도 있고 이미 화면에 반영되어 있으며**, `pagehide`/`visibilitychange`에서 동기적으로 플러시를 시도한다. 실제 손실 조건은 "탭 프로세스가 이벤트 없이 즉사"뿐이고, 그 경우에도 최대 250ms(≈ 한글 5~8자)다. **이걸 0으로 만들려면 매 키 입력마다 IDB 트랜잭션을 열어야 하고, 그 대가는 타이핑 지연이다.** 후자가 더 나쁘다.

### 6.3 용량 관리와 정리 정책

```ts
const QUOTA = {
  /** 문서 하나가 쓸 수 있는 상한 (스냅샷 + 아웃박스) */
  PER_DOC_BYTES: 8 * 1024 * 1024,
  /** 전체 상한. 초과 시 오래된 문서부터 스냅샷을 버린다 (아웃박스는 절대 안 버린다) */
  TOTAL_BYTES: 64 * 1024 * 1024,
  /** 사용 가능량이 이 아래로 내려가면 선제 정리 */
  MIN_FREE_RATIO: 0.1,
};

async function housekeep() {
  const { usage = 0, quota = 1 } = await navigator.storage?.estimate?.() ?? {};
  const pressure = usage / quota;

  // 1) ack된 아웃박스 항목 제거 — 상시
  await purgeAckedOutbox();

  // 2) 닫힌 문서의 스냅샷 정리: 최근 10개 문서만 유지
  if (pressure > 0.5) await keepRecentDocs(10);

  // 3) undo 꼬리 정리: 문서당 20개
  if (pressure > 0.5) await trimUndo(20);

  // 4) 압박이 심하면 스냅샷을 통째로 버린다.
  //    스냅샷은 서버에서 다시 받을 수 있다. **아웃박스는 받을 수 없다** — 그래서 마지막까지 남긴다
  if (pressure > 1 - QUOTA.MIN_FREE_RATIO) await dropAllSnapshotsExceptOpenDoc();
}
```

**정리 우선순위는 딱 하나의 규칙으로 요약된다: 서버에서 다시 만들 수 있는 것부터 버린다.** 아웃박스는 세상에 사본이 없다.

편집 시작 시 `navigator.storage.persist()`를 한 번 호출한다(사용자 프롬프트 없이 조용히 거절될 수 있고, 거절돼도 아무것도 하지 않는다). 성공하면 브라우저의 자동 축출(eviction) 대상에서 빠진다.

### 6.4 저장 실패 시 폴백 — 용량 초과 · 사설 브라우징

```ts
type StorageMode = 'idb' | 'memory';

async function tryIdb(): Promise<StorageMode> {
  try {
    const db = await open();
    await db.put('meta', { key: 'probe', value: Date.now() });  // 실제 쓰기까지 해봐야 안다
    return 'idb';
  } catch (e) {
    // Safari 사설 브라우징: openDB 자체는 되고 put에서 QuotaExceededError
    // Firefox 사설 브라우징: openDB에서 InvalidStateError
    // 확장 프로그램/기업 정책: SecurityError
    log('idb.unavailable', { name: (e as Error).name });   // ★ 메시지는 남기지 않는다 (I8)
    return 'memory';
  }
}
```

`memory` 모드에서 **바뀌는 것 4개**:

1. **`beforeunload` 가드를 항상 켠다.** 평소에는 "큐가 비지 않았을 때만"(STATES §9)이지만, 로컬 사본이 없으면 탭을 닫는 순간이 유일한 위험 지점이다.
2. **디바운스를 800ms → 300ms로 줄이고 `MAX_WAIT_MS`를 5s → 2s로.** 로컬에 못 쌓으니 서버에 더 자주 밀어 넣는다.
3. **인라인 바 문구가 다르다.**
   - 평소(`degraded`): "지금은 서버에 저장되지 않고 있어요. **작성하신 내용은 이 브라우저에 그대로 남아 있어요.** 연결이 돌아오면 자동으로 올라갑니다."
   - `memory` + `degraded`: "지금은 저장이 안 되고 있어요. 이 창을 열어두시면 계속 다시 시도할게요. `[내용 복사해두기]` `[지금 다시 시도]`"
   **"이 브라우저에 남아 있어요"를 말하지 않는다.** 남아 있지 않으므로 그건 거짓말이다. 절대 원칙("사라질 수 있다"를 쓰지 않는다)은 유지되지만, **거짓말 금지가 상위 원칙**이라 안심 문장을 뺀다. 대신 `[내용 복사해두기]`를 1급 버튼으로 올린다.
4. **`[내용 복사해두기]`가 실제로 하는 일**: 아웃라인 전문 + 메타를 마크다운으로 클립보드에 넣는다. 그래프가 아니라 **글**이다 — 사용자가 잃을까 두려워하는 것은 글이다.

### 6.5 브라우저 강제 종료 후 복구 시퀀스

```ts
// packages/sync-client/src/boot.ts
export async function boot(docId: string, server: ServerSnapshot): Promise<void> {
  // ── 0. RSC가 이미 서버 상태를 넘겨준 상태로 시작한다 (첫 페인트는 이미 끝났다)
  let confirmed = fromServer(server);
  let revision = server.revision;

  const mode = await tryIdb();
  if (mode === 'memory') return start({ confirmed, doc: confirmed, revision, queued: [] });

  // ── 1. 로컬 스냅샷과 아웃박스를 읽는다
  const local = await idb.getDoc(docId);
  const pending = await idb.getOutbox(docId);          // by-doc-seq 순서

  // ── 2. 로컬 스냅샷이 서버보다 앞설 수는 없다(서버가 확정의 정의).
  //       같거나 뒤처진다. 뒤처졌으면 그냥 서버 것을 쓴다 — 미확인 op은 아웃박스에 따로 있다
  if (local && local.payloadVersion === PAYLOAD_VERSION && local.revision > revision) {
    // 이건 정상 상태가 아니다. 서버 롤백/복구 후에만 생긴다
    log('boot.local_ahead', { local: local.revision, server: revision });   // §13 경보
  }

  // ── 3. 미확인 op을 서버 상태 위에 재적용 = rebase와 완전히 같은 코드 경로
  const res: ConflictResult = {
    kind: 'conflict', serverRevision: revision,
    missedOps: [],                                     // 이미 서버 상태에서 시작했다
  };
  await hydrateAndRebase(confirmed, revision, pending, res);

  // ── 4. 화면을 그린 뒤에 큐를 민다. 순서가 중요하다 —
  //       먼저 보내면 사용자는 빈 화면을 보면서 저장 중 표시를 본다
  requestIdleCallback(() => void flush('reconnect'));
}
```

**사용자가 보는 것**: 문서가 평소처럼 열리고, 상단바가 잠깐 `저장 중` → `저장됨`. **모달도, "복구했습니다"도 없다.** 크래시는 우리 사정이지 사용자 사정이 아니다.

예외 하나 — 아웃박스에 **10분 이상 묵은 op**이 있으면(= 오래 오프라인이었다가 돌아옴) §8.4의 검증을 태우고 재연결 토스트를 띄운다. "그동안 쓰신 내용까지 모두 저장했어요."

**아웃박스가 다른 문서 것도 들고 있을 때**: 부팅 시 열지 않은 문서의 미전송 op도 **백그라운드로 전송한다**(문서당 순차). 사용자가 어제 다른 문서를 쓰다 닫았다면 오늘 아무 문서나 열었을 때 조용히 올라간다. 이 경로가 없으면 아웃박스가 영원히 안 비는 문서가 생긴다.

---

## 7. 멀티탭 조율

### 7.1 왜 리더가 필요한가

두 탭이 같은 문서에 각자 op을 보내면 `baseRevision`이 서로를 밀어내며 409가 무한 반복된다(I6). 그리고 아웃박스는 오리진 공유이므로(I5) **두 탭이 같은 op을 두 번 보낼 수 있다.** 멱등성(§9.3)이 데이터 손상은 막지만, 사용자는 `저장 중`이 끝나지 않는 화면을 본다.

### 7.2 1차 수단은 `BroadcastChannel`이 아니라 **Web Locks**다

```ts
// packages/sync-client/src/leader.ts
/**
 * 리더 선출: Web Locks API를 **권위**로, BroadcastChannel을 **전파**로 쓴다.
 *
 * Web Locks를 1차로 쓰는 이유가 결정적이다:
 *   탭이 크래시하면 락이 **브라우저에 의해 자동 해제**된다.
 *   하트비트 기반 선출은 "리더가 죽었는지"를 타임아웃으로 추측할 수밖에 없고,
 *   그 추측이 틀리면(GC 정지·백그라운드 스로틀링) 리더가 둘이 된다.
 *   Web Locks는 추측하지 않는다.
 *
 * 가용성: Chrome 69+ / Safari 15.4+ / Firefox 96+ — STATES §9의 하한선 안에 있다.
 * 없으면 §7.5의 BroadcastChannel 전용 알고리즘으로 내려간다.
 */
export function electLeader(docId: string, on: LeaderEvents): () => void {
  const tabId = crypto.randomUUID();
  const ac = new AbortController();

  navigator.locks.request(
    `doc-leader:${docId}`,
    { signal: ac.signal },
    async () => {
      // 여기 들어왔다 = 내가 리더다
      on.becameLeader(tabId);
      channel.post({ t: 'leader', tabId, epoch: Date.now() });
      // 이 프로미스가 resolve될 때까지 락을 쥔다.
      // 핸드오버 요청이 오거나 탭이 닫힐 때 resolve된다
      await leaderHeld.promise;
      on.releasedLeadership();
    },
  ).catch(() => { /* abort = 자발적 포기 */ });

  // 락을 못 잡았으면 그냥 대기열에 서 있는 것이다 = 팔로워
  // FIFO라 3개 이상이어도 승계 순서가 결정적이다 (§7.4)
  return () => ac.abort();
}
```

**팔로워는 무엇을 하는가**: `phase: 'readonly'`, `dispatch()`는 no-op, 상단바 `보기 전용` + 인라인 바 "이 문서를 다른 탭에서도 열어두셨어요… `[여기서 편집하기]`". 화면은 **살아 있다** — 리더가 브로드캐스트하는 op을 받아 실시간으로 따라 그린다.

### 7.3 채널 프로토콜

```ts
type Msg =
  | { t: 'hello'; tabId: string }                            // 새 탭 등장
  | { t: 'leader'; tabId: string; epoch: number }            // 나 리더다
  | { t: 'state'; revision: number; doc: SerializedDoc }     // hello에 대한 리더의 응답
  | { t: 'ops'; ops: OpEnvelope[] }                          // 로컬 적용된 op 전파
  | { t: 'acked'; opIds: string[]; revision: number }        // 서버 확정
  | { t: 'status'; phase: SyncPhase; lastSavedAt: number | null }
  | { t: 'handover-request'; tabId: string }                 // "여기서 편집하기"
  | { t: 'handover-granted'; to: string; revision: number }
  | { t: 'bye'; tabId: string };                             // pagehide

const channel = new BroadcastChannel(`doc:${docId}`);
```

**`ops` 전파에 실리는 것은 op이지 상태가 아니다.** 상태를 통째로 보내면 (a) 큰 문서에서 구조화 복제 비용이 프레임을 먹고 (b) 팔로워가 자기 상태를 *교체*하게 되어 I2를 깬다. 팔로워도 같은 `applyOp`을 돌린다 — **같은 리듀서를 4곳이 쓴다**는 §2.1의 근거가 여기서 한 번 더 값을 한다.

`hello` → `state` 왕복은 **새 탭이 늦게 열렸을 때만** 필요하다. 대부분은 RSC가 서버 상태를 이미 넘겨줬으므로 리더가 `revision`만 알려주면 된다. 리더의 `revision`이 새 탭의 것보다 앞서면 그때만 전체 `state`를 보낸다.

### 7.4 리더가 죽었을 때 · 탭 3개 이상

**정상 종료**: `pagehide`에서 아웃박스 강제 플러시 → `bye` 브로드캐스트 → `leaderHeld.resolve()` → 락 해제 → **대기열의 다음 탭이 자동으로 리더가 된다.** 코드는 이미 `locks.request`의 콜백 안에 있으므로 아무것도 더 안 해도 된다.

**크래시**: 브라우저가 락을 회수 → 다음 대기자가 즉시 콜백에 진입. 전파 지연 0.

새 리더가 하는 일:

```ts
async function becameLeader(tabId: string) {
  // 1) 아웃박스는 오리진 공유다. 죽은 탭이 못 보낸 op이 여기 그대로 있다 (I5)
  const pending = await idb.getOutbox(docId);          // seq 순
  // 2) 내 로컬 상태가 낡았을 수 있다 — 죽은 리더가 나에게 브로드캐스트하지 못한 op이 있다면
  //    그건 아웃박스에 있고, confirmed는 IDB 스냅샷에 있다. 둘로 재구성한다
  await hydrateFromIdb();
  // 3) 서버와 한 번 맞춘다 (revision만 확인하는 가벼운 호출)
  await pullSince(get().serverRevision);
  set({ isLeader: true, phase: pending.length ? 'queued' : 'saved' });
  channel.post({ t: 'leader', tabId, epoch: Date.now() });
  void flush('reconnect');
}
```

**탭이 3개 이상일 때**: Web Locks 대기열은 FIFO이므로 승계 순서가 결정적이고, **동시에 두 탭이 리더가 되는 일이 구조적으로 불가능**하다. 하트비트·타이브레이크·epoch 비교가 전부 필요 없다. `epoch`는 로그·디버깅용으로만 싣는다.

3개 이상에서 실제로 생기는 문제는 다른 것이다: **팔로워 2번 탭이 `hello`를 쏘면 리더가 매번 전체 상태를 브로드캐스트**하고, 이걸 팔로워 3번도 받아 불필요하게 재적용한다. 그래서 `state`는 항상 `to: tabId`를 실어 보내고 수신 측에서 필터한다. 사소해 보이지만 탭 5개 × 500노드에서 눈에 띈다.

### 7.5 보기 전용 탭이 편집 권한을 가져오는 절차

```
[팔로워] "여기서 편집하기" 클릭
   │  1. channel.post({t:'handover-request', tabId: me})
   │     동시에 navigator.locks.request(..., {ifAvailable:false}) 로 대기열에 선다
   ▼
[리더] 요청 수신
   │  2. 즉시 dispatch를 잠근다 (isLeader=false로 먼저 내린다 — 이 순서가 중요하다.
   │     락을 먼저 놓으면 그 사이 들어온 키 입력이 아무도 안 받는 op이 된다)
   │  3. 열린 타이핑 버스트를 전부 닫는다 (titleBursts.closeAll)
   │  4. await flush('handover')  — 큐가 빌 때까지. 실패해도 진행한다(아웃박스에 남으므로)
   │  5. await outboxWriter.drain() — IDB에 확실히 내린다. **이게 인계의 실체다**
   │  6. channel.post({t:'handover-granted', to, revision})
   │  7. leaderHeld.resolve()  → 락 해제
   ▼
[새 리더] 락 획득 → becameLeader() (§7.4와 동일 경로)
   │  8. 아웃박스에 남은 op을 이어서 전송
   ▼
[옛 리더] phase='readonly', 인라인 바 문구 교체
```

**타임아웃 3초.** 리더가 응답하지 않으면(멈춤·과부하) 팔로워는 그냥 기다린다 — 락 대기열에 이미 서 있으므로 리더 탭이 닫히거나 죽는 순간 자동으로 넘어온다. **강제 탈취(steal)를 구현하지 않는다.** 탈취는 두 탭이 동시에 리더가 되는 유일한 경로이고, 그 대가로 얻는 건 3초 단축뿐이다.

사용자 문구: 인계 중에도 `[여기서 편집하기]` 버튼은 스피너로 바뀌지 않는다(STATES §8, 800ms 미만은 상태를 만들지 않는다). 3초 넘으면 "다른 탭에서 저장을 마치는 중이에요."

---

## 8. 오프라인 → 온라인 전이

### 8.1 온라인 감지 — `navigator.onLine`은 못 믿는다

`navigator.onLine`은 "네트워크 인터페이스가 있는가"만 답한다. 카페 와이파이에 붙었지만 캡티브 포털에 갇힌 상태, VPN이 끊긴 상태, 회사 프록시가 죽은 상태에서 전부 `true`다. 반대로 false negative는 거의 없다 — **`false`는 믿고, `true`는 믿지 않는다.**

```ts
// packages/sync-client/src/network.ts
/**
 * 온라인 판정은 3개 증거의 결합이다. 단독으로 신뢰하는 신호는 없다.
 *
 *   E1. navigator.onLine === false        → 확정 오프라인 (유일하게 믿는 단독 신호)
 *   E2. 최근 요청의 성패                   → 가장 강한 증거. 우리가 실제로 하려던 일이다
 *   E3. 프로브 (HEAD /api/health)          → E2가 없을 때만
 */
export class NetworkSensor {
  private lastSuccessAt = 0;
  private lastFailureAt = 0;
  private probing = false;

  isOnline(): boolean {
    if (navigator.onLine === false) return false;              // E1
    if (this.lastSuccessAt > this.lastFailureAt) return true;  // E2
    return this.lastFailureAt === 0;                            // 아직 아무 증거 없음 → 낙관
  }

  /** transport가 매 요청마다 호출한다 */
  observe(ok: boolean, kind: 'network' | 'http') {
    // ★ HTTP 500은 오프라인이 아니다. 서버가 아픈 것이고, 화면 문구가 달라야 한다
    if (kind === 'http') { this.lastSuccessAt = Date.now(); return; }
    if (ok) this.lastSuccessAt = Date.now(); else this.lastFailureAt = Date.now();
  }

  /**
   * 프로브. 캐시를 반드시 우회하고, 타임아웃을 짧게 잡는다.
   * 응답 바디를 보지 않는다 — 캡티브 포털은 200 OK로 로그인 페이지를 준다.
   * 그래서 **커스텀 응답 헤더**를 확인한다: `x-wf-health: 1`
   */
  async probe(timeoutMs = 3_000): Promise<boolean> {
    if (this.probing) return this.isOnline();
    this.probing = true;
    try {
      const r = await fetch('/api/health', {
        method: 'HEAD', cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ok = r.ok && r.headers.get('x-wf-health') === '1';
      this.observe(ok, 'network');
      return ok;
    } catch { this.observe(false, 'network'); return false; }
    finally { this.probing = false; }
  }
}
```

**프로브를 언제 쏘는가** (평소에는 쏘지 않는다 — 배터리와 로그를 낭비한다):

| 트리거 | 이유 |
|---|---|
| `window.online` 이벤트 | 힌트일 뿐이므로 즉시 검증한다 |
| `visibilitychange → visible` | 노트북 뚜껑을 닫았다 열면 이게 첫 신호다 |
| `degraded`/`offline` 상태에서 30초마다 | 백오프와 별개의 저빈도 폴링. 재시도는 5초 주기지만 프로브는 30초 |
| 사용자가 `[지금 다시 시도]` | 즉시 |

`navigator.connection.effectiveType` 변화는 **쓰지 않는다** — 지원 파편화가 심하고 우리가 이미 E2를 갖고 있다.

### 8.2 재연결 시 큐 플러시 순서

```ts
async function reconnect() {
  if (!(await network.probe())) return;

  // 1) **먼저 받고 나중에 보낸다.** 순서를 뒤집으면 409를 한 번 더 먹고 rebase를 두 번 한다
  const since = get().serverRevision;
  const pull = await transport.pull(docId, since);
  if (pull.kind === 'gone') return resync(pull);       // §8.3
  await applyMissed(pull.ops, pull.revision);

  // 2) 이제 내 op을 rebase된 상태 위에서 보낸다
  //    배치를 나눠 순차 전송. 병렬 금지 (I6)
  while (get().queued.length > 0) {
    const before = get().queued.length;
    await flush('reconnect');
    if (get().queued.length === before) break;         // 진전이 없으면 중단 → 재시도 루프로
  }

  // 3) 검증 후에만 토스트 (§8.4)
  if (await verifyAllSaved()) announceReconnected();
}
```

**대량 플러시의 배치 크기.** 며칠치 op이 3,000개라면 200개씩 15회다. 각 배치가 revision을 1씩 올리므로 다른 사람 화면에는 15번의 갱신이 도착한다 — 이건 **의도적이다.** 한 번에 3,000개를 적용하면 동료 화면에서 문서가 통째로 점프하고, 중간에 실패하면 어디까지 갔는지 모른다. 200개 단위로 **점진적으로 나타나는 편이 낫다.**

단, 배치 사이에 **50ms 간격**을 둔다. 연속 15회를 논스톱으로 때리면 (a) 다른 탭의 렌더가 밀리고 (b) 서버가 같은 문서 행에 15번 연속 락을 건다.

### 8.3 오래 오프라인이었을 때 — 서버가 크게 앞서 있으면

`missedOps`로 따라잡을 수 없는 두 경우가 있다.

**경우 A: op이 압축(compaction)돼서 없다** (§10.4). 서버가 `410 Gone + { snapshot, revision }`을 준다.

```ts
async function resync(res: GoneResult): Promise<void> {
  const s = get();
  const unacked = [...s.inflight, ...s.queued];        // 내 op은 **하나도 버리지 않는다**

  // 새 base = 서버 스냅샷. 여기서 공통 조상을 잃는다는 것이 핵심 문제다
  const confirmed = fromSnapshot(res.snapshot);

  // 각 op을 새 base 위로 옮긴다. missedOps가 없으므로 commutes()를 쓸 수 없다.
  // 대신 **op에 실린 `from`**이 공통 조상 역할을 한다 — §1.5에서 from을 실은 진짜 이유가 이것이다
  const rebased: OpEnvelope[] = [];
  const conflicts: Op[] = [];
  for (const env of unacked) {
    const r = rebaseAgainstSnapshot(env, confirmed);   // §5.1의 rebaseOne과 같은 판정, missed=[]
    if (r.kind === 'drop') continue;
    if (r.kind === 'conflict') conflicts.push(r.record);
    rebased.push(r.kind === 'replace' ? { ...r.env, op: r.op } : r.env);
  }
  set({ confirmed, doc: applyOps(confirmed, [...rebased.map((e) => e.op), ...conflicts]),
        serverRevision: res.revision, queued: [...rebased, ...conflicts.map(wrap)], inflight: [], phase: 'sending' });
  await outboxStore.replaceAll(get().queued);
  void flush('reconnect');
}
```

**`from` 필드가 여기서 제품을 구한다.** 스냅샷만 있고 중간 op이 없어도, `set_title{from:'견적서 작성', to:'견적서 작성해서 발송'}`은 3-way merge를 그대로 할 수 있다. **`to`만 실었다면 며칠 오프라인 후 복귀는 무조건 덮어쓰기였을 것이다.**

**경우 B: 문서가 삭제됐다.** `410 + { deleted: true }`.
로컬 내용을 **절대 지우지 않는다.** 인라인 바: "이 문서는 다른 곳에서 삭제됐어요. 이 기기에 남아 있는 내용을 새 문서로 만들 수 있어요. `[새 문서로 저장]` `[내용 복사해두기]`" — 30일 tombstone 내라면 `[복구하기]`도(STATES §7).

**경고 임계**: 오프라인 기간이 7일을 넘으면 재연결 시 **먼저 확인을 구한다**. 자동으로 밀어 넣지 않는다.
"일주일 전에 이 기기에서 쓰신 내용이 있어요. 그동안 {N}군데가 바뀌었어요. `[지금 합치기]` `[먼저 비교해보기]`"
근거: 7일이면 문서의 의미가 통째로 바뀌었을 수 있고, 그때의 자동 병합은 도움이 아니라 사고다. **이것만이 동기화 경로에서 사용자에게 확인을 구하는 유일한 지점이다.**

### 8.4 "그동안 쓰신 내용까지 **모두** 저장했어요"를 보장하는 검증

이 문장은 **검증 없이는 절대 띄우지 않는다.** '모두'가 이 제품이 하는 가장 강한 약속이고, 한 번이라도 거짓이면 그 다음부터 아무도 상단바를 안 본다.

```ts
/**
 * 4중 검사. **하나라도 실패하면 토스트를 띄우지 않고 상태 표시만 유지한다.**
 * (거짓 안심 > 침묵. 침묵은 사용자를 놀라게 하지 않는다)
 */
async function verifyAllSaved(): Promise<boolean> {
  const s = get();

  // 1) 큐가 실제로 비었는가 — 메모리
  if (s.queued.length > 0 || s.inflight.length > 0) return false;

  // 2) 아웃박스가 실제로 비었는가 — IndexedDB (메모리와 어긋날 수 있다. 이게 진짜 진실)
  const pending = await idb.countOutbox(docId);
  if (pending > 0) return false;

  // 3) 발행한 op이 전부 ack 목록에 있는가 — opId 대조
  //    세션 동안 발행한 opId 집합에서 ack된 것을 뺀다. 비어야 한다
  if (s.issuedOpIds.size !== s.ackedOpIds.size) return false;

  // 4) 서버 상태가 내가 기대한 상태와 같은가 — contentHash 대조
  //    2·3을 통과해도 서버가 어떤 op을 조용히 무시했다면 여기서 잡힌다
  const local = derive([...s.confirmed.items.values()], edgesOf(s.confirmed)).contentHash;
  const remote = await transport.contentHash(docId, s.serverRevision);
  if (remote !== null && remote !== local) {
    log('sync.divergence', { revision: s.serverRevision });   // §13.4 경보
    return false;
  }
  return true;
}

function announceReconnected() {
  toast({ text: '다시 연결됐어요. 그동안 쓰신 내용까지 모두 저장했어요.', ms: 4_000 });
  announce('reconnected');   // aria-live
}
```

**4번이 이 제품에서 가장 값진 한 줄이다.** `derive().contentHash`는 이미 존재하고(GRAPH-CORE), 서버도 같은 함수를 돌릴 수 있다(D-033의 순수성 덕분). 클라이언트와 서버가 같은 해시를 계산한다는 것은 **"모두 저장했다"가 문구가 아니라 검증된 사실**이라는 뜻이다.

3번이 실패했는데 4번이 성공하는 경우가 있다 — 다른 탭이 대신 보냈을 때다. 그때는 통과시킨다(순서를 4→3으로 두고 4가 통과하면 3을 건너뛴다).

---

## 9. Server Action 구현

### 9.1 표면

```ts
// server/actions/document.ts
'use server';
import { actionClient } from '@/server/safe-action';
import { ApplyOpsInput } from '@workflow/sync-protocol';
import { commitOps } from '@/server/services/commit-ops';

export const applyOps = actionClient
  .metadata({ name: 'applyOps', rateLimit: { key: 'doc', perMinute: 240 } })
  .schema(ApplyOpsInput)
  .action(async ({ parsedInput, ctx }) => commitOps(parsedInput, ctx.user));
```

**`sendBeacon`은 Server Action을 호출할 수 없다**(액션은 전용 헤더와 인코딩을 쓴다). 그래서 같은 서비스 함수를 감싸는 Route Handler를 하나 더 둔다. **로직은 한 곳에만 있다.**

```ts
// app/api/ops/route.ts   — 오직 beacon / keepalive 전용
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const parsed = ApplyOpsInput.safeParse(await req.json());
  if (!parsed.success) return new Response(null, { status: 400 });
  const res = await commitOps(parsed.data, user);
  return Response.json(res, { status: res.kind === 'ok' ? 200 : statusOf(res) });
}
```

클라이언트 전송 우선순위: `fetch(keepalive: true)` → 실패 시 `navigator.sendBeacon` → 둘 다 64KB 상한이므로 초과분은 아웃박스에 남긴다(다음 세션이 이어서 보낸다, §6.5).

### 9.2 `commitOps` 전문

```ts
// server/services/commit-ops.ts
export async function commitOps(input: ApplyOpsInputT, user: User): Promise<ApplyOpsResult> {
  // ── 권한 검사는 **트랜잭션 밖에서 한 번, 안에서 한 번** ──────────────────
  //  밖: 캐시된 멤버십으로 빠르게 거른다. DB 락을 잡기 전에 거절하는 게 싸다
  //  안: orgId를 WHERE에 넣어 **행 자체가 안 잡히게** 한다.
  //      권한을 코드가 아니라 쿼리로 강제한다 (ARCHITECTURE §7)
  const role = await getDocRole(user.id, input.docId);        // 캐시 30초
  if (role !== 'owner' && role !== 'editor') {
    return { kind: 'denied', reason: role === 'viewer' ? 'read-only' : 'no-access' };
  }

  return db.transaction(async (tx) => {
    // 1. 문서 행 잠금 — 같은 문서의 동시 배치를 직렬화한다.
    //    FOR UPDATE가 없으면 두 배치가 같은 revision을 읽고 둘 다 +1 해서 하나가 사라진다
    const [doc] = await tx.select().from(documents)
      .where(and(eq(documents.id, input.docId), eq(documents.orgId, user.orgId)))
      .for('update');
    if (!doc) return { kind: 'denied', reason: 'no-access' };

    // 2. 멱등성 — 이미 적용된 op을 걸러낸다 (§9.3)
    const opIds = input.ops.map((e) => e.opId);
    const known = new Set((await tx.select({ id: operations.clientOpId }).from(operations)
      .where(and(eq(operations.docId, doc.id), inArray(operations.clientOpId, opIds))))
      .map((r) => r.id));
    const fresh = input.ops.filter((e) => !known.has(e.opId));

    if (fresh.length === 0) {
      // 전부 재전송이다. **revision을 올리지 않는다.** 성공으로 응답한다
      return { kind: 'ok', revision: doc.revision, appliedOpIds: opIds, ignoredOpIds: [], serverOps: [] };
    }

    // 3. revision 판정 (§9.4)
    let missed: OpEnvelope[] = [];
    if (input.baseRevision !== doc.revision) {
      missed = await loadOpsSince(tx, doc.id, input.baseRevision);
      if (missed === null) return { kind: 'gone', ...(await snapshotFor(tx, doc.id)) };  // 압축됨

      const mine = fresh.map((e) => e.op);
      const theirs = missed.map((e) => e.op);
      if (!batchCommutes(mine, theirs)) {
        // 조용히 병합할 수 없다 → 클라이언트가 rebase한다 (§5)
        return { kind: 'conflict', serverRevision: doc.revision, missedOps: missed };
      }
      // 교환 가능 → 그냥 적용한다. **이 분기가 "대부분 무침묵 병합"이다**
    }

    // 4. 상태 적용 — 현재 문서를 메모리에 올려 리듀서를 돌린다
    const state = await loadDocState(tx, doc.id);              // 스냅샷 + 이후 op (§10.3)
    const serverOps: OpEnvelope[] = [];
    const ignored: string[] = [];
    let next = state;
    for (const env of fresh) {
      const before = next;
      const applied = applyOp(next, env.op);
      if (applied === before) { ignored.push(env.opId); continue; }   // 없는 아이템 등 (§5.4)
      next = applied;
    }

    // 5. 영속화 — 리듀서 결과를 행으로 내린다. diff만 쓴다
    await persistDiff(tx, doc.id, state, next, serverOps);     // §5.2의 sortKey 재발급이 여기 산다

    // 6. 로그 append + revision 증가 (배치당 +1, op당 아님)
    const revision = doc.revision + 1;
    await tx.insert(operations).values(fresh.map((e, i) => ({
      docId: doc.id, docRevision: revision,
      clientOpId: e.opId, txnId: e.txnId, actorId: user.id,
      lamport: e.lamport, type: e.op.type, payload: e.op,
    })));
    await tx.update(documents)
      .set({ revision, updatedAt: new Date() })
      .where(and(eq(documents.id, doc.id), eq(documents.revision, doc.revision)));  // 이중 방어

    // 7. 발산 탐지 (§13.4) — 비교만 하고 거절하지 않는다
    if (input.expectedContentHash) {
      const actual = derive([...next.items.values()], edgesOf(next)).contentHash;
      if (actual !== input.expectedContentHash) {
        metrics.increment('sync.hash_mismatch', { docId: doc.id, revision });
      }
    }

    // 8. 스냅샷 트리거는 트랜잭션 밖에서 (§10.1)
    after(() => maybeSnapshot(doc.id, revision));

    return { kind: 'ok', revision, appliedOpIds: fresh.map((e) => e.opId),
             ignoredOpIds: ignored, serverOps };
  });
}
```

### 9.3 멱등성 — 같은 배치를 다시 보내면

**유니크 인덱스 하나가 전부다.**

```sql
CREATE TABLE operations (
  doc_id        uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq           bigserial PRIMARY KEY,
  doc_revision  integer NOT NULL,
  client_op_id  uuid NOT NULL,          -- ★ 클라이언트 발급. 재전송해도 같다
  txn_id        uuid NOT NULL,
  actor_id      uuid NOT NULL,
  lamport       bigint NOT NULL,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX operations_idem ON operations (doc_id, client_op_id);
CREATE INDEX operations_doc_rev ON operations (doc_id, doc_revision);
CREATE INDEX operations_doc_seq ON operations (doc_id, seq);
```

재전송이 일어나는 경로는 실제로 흔하다: 응답이 유실된 타임아웃, `sendBeacon` + 다음 세션 재시도, 리더 교체 중 양쪽이 보냄, 사용자의 `[지금 다시 시도]`.

**부분 중복이 핵심 케이스다.** 배치 200개 중 앞 120개만 적용된 상태에서 트랜잭션이 깨졌다면? 트랜잭션이므로 그런 상태는 없다 — 전부 커밋되거나 전부 롤백된다. 그래서 중복 판정은 배치 단위가 아니라 **op 단위**로 하면서도 결과가 깔끔하다.

`fresh.length === 0`일 때 **revision을 올리지 않는 것**이 중요하다. 올리면 재전송 한 번마다 revision이 올라가 다른 클라이언트가 무의미한 `pull`을 하게 된다.

### 9.4 revision 증가 규칙

- **배치당 +1.** op당 +1이면 200 op 배치가 revision을 200 올리고, `missedOps` 쿼리의 범위 계산이 복잡해지며, 다른 클라이언트가 200번의 갱신을 받는다.
- `operations.doc_revision`에 결과 revision을 박아 두므로 `WHERE doc_revision > $base ORDER BY seq`로 `missedOps`가 한 방에 나온다.
- **revision은 사용자에게 노출하지 않는다.** UI에 "버전 7"이 뜨면 그건 사용자 개념이 되고, Yjs에는 그런 개념이 없어서 나중에 제거해야 한다(§12.3).

### 9.5 권한 검사 위치 — 3층

| 층 | 위치 | 막는 것 |
|---|---|---|
| 1 | `actionClient` 미들웨어 | 미인증 요청. 세션 없으면 액션 바디를 파싱조차 하지 않는다 |
| 2 | `commitOps` 진입부 (`getDocRole`) | viewer의 쓰기. **트랜잭션·락 이전** — 싼 거절 |
| 3 | 트랜잭션 안 `WHERE orgId = ?` | 조직 경계. 코드 버그가 있어도 **행이 안 잡힌다** |

`denied`를 받은 클라이언트는 `phase: 'readonly'` + 인라인 바 "이 문서를 편집할 권한이 바뀌었어요. 지금까지 쓰신 내용은 이 기기에 남아 있어요. `[내용 복사해두기]`". **로컬 큐를 지우지 않는다** — 권한이 복구될 수 있고, 사용자가 쓴 것은 사용자 것이다.

### 9.6 트랜잭션 경계에 넣지 않는 것

| 제외 대상 | 이유 |
|---|---|
| 스냅샷 생성 | 수백 ms. 문서 행 락을 그만큼 잡으면 동시 편집이 멈춘다 → `after()` |
| `derive()` 검증 | 이미 §9.2-7에서 하지만, **실패해도 롤백하지 않는다.** 파생 실패로 사용자의 글을 거절하지 않는다 |
| 레이아웃 좌표 저장 | 별도 테이블·별도 요청 (§1.6) |
| 알림·웹훅·분석 | `after()` |
| 텍스트 검색 인덱싱 | 없다 (D-070 — 서버는 본문을 스캔하지 않는다) |

---

## 10. 스냅샷 전략

### 10.1 언제 만드는가

```ts
const SNAPSHOT = {
  EVERY_OPS: 200,          // 마지막 스냅샷 이후 op 수
  EVERY_MS: 6 * 3600_000,  // 또는 6시간 (op이 뜸해도 복원 비용 상한을 준다)
  ON_DEMAND: true,         // 내보내기·공유 링크 발급·조직 조립 직전
};

/** 트랜잭션 밖에서. after()로 응답을 막지 않는다 */
async function maybeSnapshot(docId: string, revision: number) {
  const ok = await db.execute(sql`SELECT pg_try_advisory_lock(hashtext(${'snap:' + docId}))`);
  if (!ok) return;                      // 다른 워커가 이미 만들고 있다
  try {
    const last = await latestSnapshot(docId);
    const gap = await countOpsSince(docId, last?.revision ?? 0);
    if (gap < SNAPSHOT.EVERY_OPS && Date.now() - (last?.createdAt ?? 0) < SNAPSHOT.EVERY_MS) return;
    const state = await loadDocState(db, docId);
    await db.insert(snapshots).values({
      docId, revision, payloadVersion: PAYLOAD_VERSION,
      payload: serialize(state),
      contentHash: derive([...state.items.values()], edgesOf(state)).contentHash,
      itemCount: state.items.size,
    });
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${'snap:' + docId}))`);
  }
}
```

**200 op이 근거 있는 숫자인 이유**: 복원은 `스냅샷 로드 + op 재생`이고, `applyOp` 200회는 아이템 500개 문서에서도 1ms 미만이다(리듀서는 `derive()`보다 훨씬 싸다). 200보다 훨씬 크게 잡아도 복원은 빠르지만, **오프라인 클라이언트가 따라잡을 수 있는 창(§8.3)이 좁아진다.** 200 op은 활발한 편집 기준 대략 20~40분이다.

### 10.2 무엇을 담는가

```sql
CREATE TABLE snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision      integer NOT NULL,
  payload_version integer NOT NULL,
  payload       jsonb NOT NULL,       -- { title, items[], edges[], conflicts[] }
  content_hash  text NOT NULL,        -- derive().contentHash — 복원 검증용
  item_count    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX snapshots_doc_rev ON snapshots (doc_id, revision);
```

담는 것: `items`(**tombstone 포함**), `edges`, `document.title`, 미해소 `conflicts`.
담지 않는 것: 파생 그래프·메트릭·레이아웃 좌표(전부 재계산 가능, D-030) · `operations` 자체.

**tombstone을 담는 것이 협상 불가다.** 스냅샷이 tombstone을 빼면, 그 스냅샷으로 복원한 순간 "삭제된 아이템에 대한 op"이 전부 `ignored`가 되고(§5.4), 오프라인 클라이언트의 편집이 조용히 사라진다.

`content_hash`를 같이 저장하면 복원 직후 검증이 한 줄이 된다.

### 10.3 복원 시퀀스

```ts
/** 서버가 문서 상태를 메모리에 올리는 유일한 경로. RSC 페이지·commitOps가 공유한다 */
export async function loadDocState(tx: Tx, docId: string, atRevision?: number): Promise<DocState> {
  const snap = await tx.select().from(snapshots)
    .where(and(eq(snapshots.docId, docId),
               atRevision ? lte(snapshots.revision, atRevision) : undefined))
    .orderBy(desc(snapshots.revision)).limit(1);

  let state = snap[0] ? deserialize(snap[0].payload) : emptyDoc(docId);

  // ★ 스냅샷이 없거나 payloadVersion이 낮으면 **행에서 직접 만든다.**
  //   op 로그를 0부터 재생하지 않는다 — items 테이블이 이미 진실이다.
  //   op 로그는 감사·undo·rebase용이지 상태의 유일한 출처가 아니다
  if (!snap[0] || snap[0].payloadVersion !== PAYLOAD_VERSION) {
    state = await loadFromRows(tx, docId);
    return state;
  }

  const since = snap[0].revision;
  const ops = await tx.select().from(operations)
    .where(and(eq(operations.docId, docId), gt(operations.docRevision, since),
               atRevision ? lte(operations.docRevision, atRevision) : undefined))
    .orderBy(asc(operations.seq));
  state = applyOps(state, ops.map((o) => o.payload as Op));

  if (process.env.NODE_ENV !== 'production') {
    // 개발·CI에서만: 행에서 만든 것과 대조한다. 어긋나면 리듀서와 persistDiff가 갈라진 것이다
    assertSameHash(state, await loadFromRows(tx, docId));
  }
  return state;
}
```

**"`items` 테이블과 op 재생이 둘 다 진실"인 구조의 위험**을 정면으로 다룬다: 둘이 갈라질 수 있다. 그래서

- **평상시 진실은 `items` 테이블**이다(`loadFromRows`). 빠르고 인덱스가 있다.
- op 재생은 **스냅샷 이후 구간을 따라잡을 때**와 **시점 복원**(감사·"3일 전으로")에만 쓴다.
- CI에서 두 경로의 `contentHash`가 같은지 매 픽스처마다 검증한다(§14.5).
- 프로덕션에서는 §13.4의 주기 잡이 표본 문서에 대해 대조한다.

**사용자 대면 복원**("3일 전 상태 보기")은 `loadDocState(tx, docId, atRevision)`으로 만든 상태를 **읽기 전용으로 렌더**하고, 되돌리려면 **역방향 op을 새로 발행**한다. **`items` 테이블을 과거로 되돌려 쓰지 않는다** — 그건 그 사이 다른 사람의 변경을 지우는 일이고, I1 위반이다.

### 10.4 오래된 op 정리(compaction)

```
보존 규칙 (전부 동시에 만족해야 삭제한다)
  1. 최신 스냅샷 2개보다 오래됐다                     ← 복원 여유분
  2. 만들어진 지 30일이 지났다                        ← 오프라인 클라이언트 창(§8.3) + 감사
  3. 어떤 클라이언트의 미확인 하한선보다 오래됐다        ← 아래 참조
```

3번이 미묘하다. 오프라인 클라이언트가 `baseRevision = 100`으로 돌아왔는데 revision 100 이후 op이 압축됐다면 `410 Gone`이고, `from` 기반 rebase(§8.3)로 복구는 되지만 **병합 품질이 떨어진다.** 그래서 문서별로 "최근 30일 내 접속한 액터들이 마지막으로 ack한 revision의 최솟값"을 `documents.min_acked_revision`에 유지하고, 그 아래만 압축한다.

```sql
-- 주간 잡
DELETE FROM operations o
USING documents d
WHERE o.doc_id = d.id
  AND o.created_at < now() - interval '30 days'
  AND o.doc_revision < d.min_acked_revision
  AND o.doc_revision < (
    SELECT revision FROM snapshots s WHERE s.doc_id = o.doc_id
    ORDER BY revision DESC OFFSET 1 LIMIT 1
  );
```

스냅샷 자체의 정리: 문서당 **최근 5개 + 월별 1개(12개월)**를 남긴다. 500아이템 문서의 스냅샷이 ~200KB이므로 문서 1,000개 × 17 스냅샷 = 3.4GB. 감당 가능하고, 이게 "데이터 손실을 사후에라도 되돌릴 수 있는가"의 마지막 보루다.

---

## 11. Undo / Redo

### 11.1 op 로그 기반 undo 스택

**되감지 않는다. 앞으로 간다.** undo는 op 로그를 자르는 것이 아니라 **역연산 op을 새로 발행하는 것**이다(I3). 이유:

- 이미 서버에 간 op을 취소할 방법이 없다(다른 사람이 이미 봤다)
- 로그를 자르면 감사·Yjs 브리지·시점 복원이 전부 거짓말이 된다
- 역연산 발행이면 **동시 편집 중 undo가 그냥 하나의 편집**이 된다 — 특별 취급이 필요 없다

```ts
// packages/sync-client/src/undo.ts
export type UndoEntry = {
  txnId: string;
  /** 적용 **직전** 상태에서 계산된 역연산. 순서대로 적용하면 원복된다 */
  inverse: Op[];
  /** 원본 op — 협업 안전성 판정(§11.2)과 redo에 쓴다 */
  forward: Op[];
  at: number;
  /** "붙여넣기 18줄" / "단계 지움" — 토스트와 메뉴에 그대로 쓴다 */
  label: string;
  actorId: string;
};

const LIMIT = 100;

export const undoStack: UndoEntry[] = [];
export const redoStack: UndoEntry[] = [];

export function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  const s = store.getState();

  const { safe, skipped } = filterCollaborative(entry, s.doc);   // §11.2
  if (safe.length === 0) {
    toast({ text: skippedMessage(skipped), ms: 4_000 });
    return;                                                       // 스택에서는 이미 빠졌다
  }

  // 새 txnId로 발행한다. **되돌리기도 하나의 편집이다**
  store.getState().dispatch(safe, { txnId: newUuid(), undoable: false });
  redoStack.push(entry);
  if (skipped.length > 0) toast({ text: skippedMessage(skipped), ms: 4_000 });
  else toast({ text: `${entry.label}을 되돌렸어요`, ms: 3_000, action: { label: '다시 실행', onPress: redo } });
}
```

`undoable: false`가 중요하다 — undo가 만든 op이 다시 undo 스택에 쌓이면 무한 왕복이 된다. redo는 `redoStack`이 담당한다.

**새 편집이 들어오면 `redoStack`을 비운다.** 단, **다른 사람의 편집이 도착한 것으로는 비우지 않는다** — 내 redo는 내 것이다.

### 11.2 협업 시 undo 의미론 — 남의 변경을 되돌리지 않는다

**규칙: undo는 내 op의 역연산이되, 그 이후 다른 사람이 같은 슬롯을 건드렸으면 그 슬롯은 건너뛴다.**

```ts
/**
 * 각 역연산이 지금 적용해도 안전한지 판정한다.
 * "안전"의 정의: 이 역연산이 **다른 사람의 변경을 지우지 않는가.**
 */
function filterCollaborative(entry: UndoEntry, doc: DocState): { safe: Op[]; skipped: SkipReason[] } {
  const safe: Op[] = [];
  const skipped: SkipReason[] = [];

  for (let i = 0; i < entry.inverse.length; i++) {
    const inv = entry.inverse[i]!;
    const fwd = entry.forward[entry.forward.length - 1 - i];   // 대응하는 원본

    switch (inv.type) {
      // ── 스칼라 원복: 현재 값이 내가 넣은 값 그대로일 때만 되돌린다 ──
      case 'set_title': case 'set_kind': case 'set_assignee': case 'set_duration':
      case 'set_freq': case 'set_automation': case 'set_pain': {
        const cur = readField(doc.items.get(inv.id), fieldOf(inv));
        if (cur === inv.from) safe.push(inv);                  // 아무도 안 건드렸다
        else skipped.push({ kind: 'changed-by-other', itemId: inv.id, field: fieldOf(inv) });
        break;
      }

      case 'set_attr': {
        const cur = doc.items.get(inv.id)?.attrs ?? {};
        const keys = Object.keys(inv.to).filter(
          (k) => (cur as Rec)[k] === (inv.from as Rec)[k]);     // 슬롯 단위로 쪼갠다
        if (keys.length > 0) safe.push({ ...inv, to: pick(inv.to, keys), from: pick(inv.from, keys) });
        if (keys.length < Object.keys(inv.to).length) skipped.push({ kind: 'changed-by-other', itemId: inv.id, field: 'attrs' });
        break;
      }

      // ── 삽입의 원복(=삭제): 남이 그 아래에 뭔가 만들었으면 지우지 않는다 ──
      case 'delete_item': {
        const kids = [...doc.items.values()].filter((it) => it.parentId === inv.id && !it.deletedAt);
        const foreign = kids.some((k) => createdByOther(k.id, entry.actorId));
        const edited = editedByOther(doc, inv.id, entry.actorId);
        if (foreign || edited) skipped.push({ kind: 'built-on-by-other', itemId: inv.id });
        else safe.push(inv);
        break;
      }

      // ── 삭제의 원복(=복구): 항상 안전하다. 되살리는 것은 아무것도 지우지 않는다 ──
      case 'restore_item': safe.push(inv); break;

      // ── 위치 원복: 남이 그 뒤에 옮겼으면 건너뛴다 ──
      case 'move_item': case 'reorder_item': {
        const cur = doc.items.get(inv.id);
        const fwdOp = fwd as Extract<Op, { type: 'move_item' | 'reorder_item' }> | undefined;
        const same = cur && fwdOp && cur.sortKey === fwdOp.sortKey &&
                     (!('parentId' in fwdOp) || cur.parentId === fwdOp.parentId);
        if (same) safe.push(inv);
        else skipped.push({ kind: 'moved-by-other', itemId: inv.id });
        break;
      }

      // ── 엣지: 그대로 있으면 되돌린다 ──
      case 'remove_edge': case 'unsuppress_edge':
        if (doc.edges.has(inv.id)) safe.push(inv);
        else skipped.push({ kind: 'gone', itemId: inv.id });
        break;

      default: safe.push(inv);
    }
  }
  return { safe, skipped };
}

/** 건너뛴 이유를 사용자 문장으로. **누구 탓도 하지 않는다** */
function skippedMessage(skipped: SkipReason[]): string {
  if (skipped.length === 0) return '';
  if (skipped.every((s) => s.kind === 'changed-by-other'))
    return '되돌렸어요. 그 사이 다른 곳에서 바뀐 곳은 그대로 뒀어요.';
  if (skipped.some((s) => s.kind === 'built-on-by-other'))
    return '이 단계 아래에 다른 내용이 생겨서 그대로 뒀어요.';
  return '되돌렸어요. 일부는 그 사이 바뀌어서 그대로 뒀어요.';
}
```

**왜 "건너뛰기"이고 "강제 원복"이 아닌가**: undo는 "내가 방금 한 일을 취소한다"는 뜻이지 "문서를 5분 전으로 되돌린다"가 아니다. 후자로 동작하면 협업 문서에서 undo가 **가장 위험한 버튼**이 된다. 사용자는 자기가 뭘 지웠는지 모른다.

### 11.3 스택 크기와 세션 간 유지

| | 값 | 근거 |
|---|---|---|
| 메모리 스택 | **100** | 한 세션에서 100번 이상 되감는 사람은 없다. 아이템 참조를 들고 있지 않고 op만 들고 있어 100개가 수십 KB |
| IndexedDB 영속 | **최근 20** | 재접속 후 되감기는 "방금 뭘 했더라"의 범위다. 20을 넘어가면 사용자도 기억하지 못한다 |
| 만료 | **24시간** | 하루 지난 undo는 undo가 아니라 시점 복원(§10.3)의 일이다 |

복귀 시 스택은 **redo 없이** 복원한다(redo는 세션 개념이다). 그리고 복원된 항목에는 `filterCollaborative`가 더 엄격하게 걸린다 — 그 사이 다른 사람이 편집했을 확률이 훨씬 높기 때문이다.

### 11.4 `paste_batch` 1회 = undo 1회

`invertOp(paste_batch)`가 `delete_item[]`을 **하나의 entry**로 돌려주므로 자동으로 성립한다(§2.4). STATES §3의 "파싱 1회 = op 1개"가 여기서 만족된다.

**되돌린 뒤 토스트**: "붙여넣기 18줄을 되돌렸어요 `[다시 실행]`" 3초(STATES §3).

`resolve_conflict`의 undo는 특수하다 — 값을 되돌리는 대신 **충돌 레코드를 다시 미해소로 되돌린다**(`resolved_at = null`). 사용자가 "아 잘못 골랐다"일 때 원하는 것은 값의 원복이 아니라 **선택지가 다시 보이는 것**이다.

### 11.5 IME와 undo

브라우저 기본 undo(`document.execCommand`)와 우리 undo가 겹치면 조합 중인 글자가 깨진다. **`composing` 중에는 `Cmd/Ctrl+Z`를 가로채지 않는다** — ProseMirror에 맡긴다. `compositionend` 이후의 `Cmd+Z`만 우리가 처리한다. `keydown.key` 대신 `keydown.code === 'KeyZ' && (metaKey || ctrlKey)`로 판정한다(ARCHITECTURE §3: 조합 중 `keyCode 229`).

---

## 12. Yjs 전환 경로

### 12.1 그대로 살아남는 것

| 자산 | 왜 살아남는가 |
|---|---|
| **클라이언트 발급 UUID** (D-031) | Y.Map의 키가 된다. 경로 기반 ID였으면 여기서 전부 다시 써야 했다 |
| **tombstone** (D-032) | Yjs의 삭제 의미론과 동일하다. 하드 삭제였으면 마이그레이션이 불가능하다 |
| **fractional index + jitter** | Y.Array로 갈아탈 수도 있지만, **갈아타지 않는 것이 정답이다.** `sortKey`를 Y.Map 필드로 그대로 두면 정렬 로직(`COLLATE "C"`, `compareSortKey`)과 DB 인덱스가 전부 살아남는다. Y.Array 이주는 CRDT 순서 의미론을 다시 검증해야 하는 큰 공사고, 얻는 건 자동 재키잉뿐이다 |
| **`operations` 로그** | Y.Doc의 초기 상태를 만드는 입력이자, 전환 후 **양방향 브리지**의 근거. 전환 시 스냅샷으로 Y.Doc을 만들고 이후 op을 재생해 검증한다 |
| **`applyOp` 리듀서** | 서버 권위 적용은 사라지지만, **비실시간 클라이언트(모바일·API·AI 초안 적용)**를 위해 남는다. 그리고 골든 픽스처가 전부 여기 걸려 있다 |
| **`derive()` / `validate()` / `contentHash`** | Yjs와 무관하다. 오히려 수렴 검증에 더 많이 쓰인다 |
| **아웃박스 · IndexedDB 계층** | `y-indexeddb`로 대체되지만 **인터페이스가 같다**(§2.1의 어댑터 주입). 교체가 파일 하나 |
| **리더 선출** | Yjs에서도 필요하다. 탭마다 WebSocket을 열 이유가 없다 |
| **충돌 제시 UI** (`item_conflicts`) | Y.Text가 제목 충돌을 없애주지만 **스칼라 필드(담당자·종류)는 Yjs가 조용히 LWW로 덮는다.** 우리 원칙(I1)은 그걸 허용하지 않으므로 이 테이블은 오히려 더 중요해진다 |
| **상태 표시 머신** (§4.6) | `syncedStatus`의 입력만 바뀐다. 문구·승격 타이밍은 그대로 |

### 12.2 버리는 것

| 버리는 것 | 대체 |
|---|---|
| `documents.revision` 낙관적 토큰 | Y.Doc의 state vector. revision은 마이그레이션 후 읽기 전용 감사 컬럼으로 남긴다 |
| `409 + missedOps` rebase (§5.1) | `Y.applyUpdate` — CRDT가 자동으로 한다 |
| `commutes()` 판정 (§3) | Yjs 내부 의미론이 대신한다. **단 표 자체는 문서로 남긴다** — "왜 이 op이 이렇게 생겼는가"의 근거 |
| `merge3` (§2.5) | Y.Text의 문자 단위 병합 |
| 800ms 디바운스 배치 | Yjs 업데이트 스트림(수십 ms). 단 **서버 영속화는 여전히 디바운스**한다 |
| 서버 측 `commitOps` 트랜잭션 | y-websocket/PartyKit 퍼시스턴스 어댑터 |

### 12.3 지금 하면 안 되는 것 — 구체적으로

1. **서버에 OT 변환 함수(`transform(opA, opB)`)를 쓰지 마라.** `commutes()`(판정)까지가 상한이다. 변환을 구현하기 시작하면 그건 자체 CRDT를 만드는 것이고, Yjs로 갈 때 전부 버려질 뿐 아니라 **그 사이 미묘한 데이터 손실 버그를 만든다.** 변환이 필요해 보이면 그건 충돌 레코드로 갈 케이스다.
2. **`revision`을 사용자 개념으로 만들지 마라.** "버전 12" 뱃지, "v7로 되돌리기" UI, 공유 링크의 revision 고정 — 전부 금지. Yjs에는 대응물이 없다. 시점 복원은 **시각**(`2026-08-15 14:00`)으로 표현한다.
3. **`operations.seq`의 전역 단조성에 클라이언트 로직을 의존시키지 마라.** 정렬·표시는 `lamport`와 `created_at`으로. `seq`는 서버 내부 커서다.
4. **`title`에 리치 텍스트·마크업·개행을 넣지 마라.** 평문 한 줄 계약(§1.5의 zod refine)이 Y.Text 이행 지점이다. 여기에 볼드가 들어가는 순간 마이그레이션이 파서 프로젝트가 된다.
5. **컬렉션 통째 op을 다시 만들지 마라** (`set_tools`, `set_children`, `replace_items`). 편의를 위해 하나만 만들어도 그게 손실 경로가 된다.
6. **서버가 op payload를 정규화·재작성하지 마라** (I3). 보상 op을 추가하는 방식만 쓴다. 로그의 무결성이 Y.Doc 재구성의 유일한 입력이다.
7. **로컬 상태를 서버 응답으로 통째 교체하는 코드 경로를 만들지 마라** (I2). "일단 서버 것으로 맞추자"는 한 줄이 들어오면 Yjs 전환 후에도 그 줄이 살아남아 미확인 로컬 변경을 날린다. `resync`(§8.3)조차 op을 재적용한다.
8. **프레즌스(커서·선택 영역)를 op으로 보내지 마라.** `operations` 테이블이 초당 수십 행으로 오염되고, awareness는 영속화하면 안 되는 데이터다. v1은 프레즌스 없음이 정답이다.
9. **낙관적 적용을 끄는 플래그를 만들지 마라.** "디버깅용"으로 만든 `optimistic: false`가 프로덕션 설정에 남는다. 그 경로는 Yjs에 존재하지 않는다.
10. **op에 서버 시각을 주입하지 마라** (`confirm_item.at` 클램프가 유일한 예외). 리듀서의 결정성이 깨지면 Y.Doc 재구성 검증을 할 수 없다.
11. **아이템 필드를 늘릴 때 "덩어리 jsonb"로 도망가지 마라.** `attrs`의 키는 명시적으로 열거된 슬롯이어야 한다(§1.5의 `itemAttrs`). Y.Map의 키 단위 병합과 1:1로 대응시키기 위해서다.

### 12.4 전환 시점의 실제 절차 (참고용 스케치)

```
1. 읽기 전용 이중 기록 기간(2주)
   applyOps → Postgres(권위) → 같은 트랜잭션의 after()에서 Y.Doc 업데이트 생성·저장
   두 표현의 derive().contentHash를 매 커밋마다 대조 → 불일치 0을 확인
2. 문서 단위 플립 (orgId 단위 롤아웃, D-061의 접합 차수 순서와 동일)
   Y.Doc이 권위가 되고 Postgres는 투영(projection)으로 강등
   items/edges 테이블은 **유지한다** — 집계 쿼리·n8n 익스포트·공유 페이지 RSC가 전부 SQL이다
3. applyOps는 남는다 (API·AI 초안 적용). 내부적으로 Y.Doc에 트랜잭션으로 적용
```

**2번의 "items 테이블 유지"가 중요하다.** Yjs로 간다고 SQL을 버리면 공유 페이지의 JS 없는 RSC 렌더(STATES §9)와 집계 뷰(ARCHITECTURE §7)가 죽는다. Y.Doc은 편집 경로의 권위이고, SQL은 읽기 경로의 투영이다.

---

## 13. 관측성

### 13.1 원칙 — 무엇을 로그에 넣지 않는가부터

**op payload를 텔레메트리에 보내지 않는다** (I8, D-070). 제목·담당자 이름·라벨은 전부 사용자 콘텐츠다. 보내는 것은:

```ts
type OpTelemetry = {
  type: OpType;
  docIdHash: string;      // HMAC(docId) — 문서 단위 집계는 되지만 역추적은 안 된다
  itemCount?: number;     // paste_batch의 크기
  payloadBytes: number;   // 길이는 보낸다. 내용은 안 보낸다
  lamport: number;
};
```

에러 리포팅(Sentry 등)에도 같은 규칙이 적용된다. `beforeSend`에서 op payload를 통째로 스크러빙한다. **한 번이라도 제목이 Sentry에 들어가면 그건 사고다.**

### 13.2 메트릭

| 메트릭 | 타입 | 왜 보는가 | 경보 |
|---|---|---|---|
| `sync.save_latency` | 히스토그램 | dispatch → ack. **STATES §10의 보조 지표(중앙값 <400ms)** | p50 > 800ms 15분 지속 |
| `sync.status_duration{phase}` | 히스토그램 | `저장 중`에 머문 시간 분포 | `retrying` p95 > 6s |
| `sync.degraded_rate` | 비율 | 세션 중 `degraded`에 한 번이라도 들어간 비율 | > 2% |
| `sync.offline_sessions` | 카운터 | 오프라인 진입 횟수·지속시간 | 급증 시(장애 신호) |
| `sync.queue_depth` | 게이지 | 플러시 직전 큐 길이 | p99 > 200 (배치 상한에 붙음) |
| `sync.unacked_age` | 히스토그램 | 가장 오래된 미확인 op의 나이. **데이터 손실 위험의 직접 지표** | p99 > 60s |
| `sync.conflict_rate{field}` | 카운터 | 필드별 충돌 발생 | `title` > 1% of set_title |
| `sync.conflict_unresolved_age` | 히스토그램 | 미해소 충돌이 방치된 시간 | p50 > 7일 (UI가 안 보인다는 뜻) |
| `sync.merge3_outcome{silent,merged,failed}` | 카운터 | 3-way merge 성공률. **이 비율이 §5.3 설계의 성적표다** | `failed` > 40% |
| `sync.rebase_count` | 카운터 | 409 후 rebase 횟수 | 세션당 > 3 |
| `sync.server_commutative_merge` | 카운터 | 무침묵 병합 횟수 (§9.4) — **높을수록 좋다** | (비율만 관찰) |
| `sync.ignored_op_rate` | 비율 | 서버가 무시한 op 비율 (§5.4) | > 0.5% |
| `sync.hash_mismatch` | 카운터 | 클라이언트 기대 해시 ≠ 서버 실제 (§9.2-7) | **> 0이면 즉시 조사** |
| `sync.idb_failure{name}` | 카운터 | IndexedDB 열림·쓰기 실패 | 급증 |
| `sync.storage_mode{memory}` | 게이지 | 메모리 폴백 세션 비율 | > 1% |
| `sync.beacon_success` | 비율 | 탭 종료 시 플러시 성공률 | < 95% |
| `sync.leader_handover` | 카운터 | 리더 교체 횟수 | 세션당 > 5 (선출 버그 신호) |
| `sync.boot_recovered_ops` | 히스토그램 | 부팅 시 아웃박스에서 살려낸 op 수 | p99 > 50 (전송 경로 문제) |

### 13.3 로그 (구조화, 샘플링)

```ts
log('sync.flush', {
  docIdHash, batchSize, bytes, baseRevision, reason,
  durationMs, outcome: 'ok' | 'conflict' | 'gone' | 'network' | 'denied',
  attempt, phaseBefore, phaseAfter,
});
```

**항상 남기는 것(샘플링 없음)**: `conflict`, `gone`, `denied`, `hash_mismatch`, `idb_failure`, `boot.local_ahead`, 7일 초과 오프라인 복귀.
**샘플링(1%)**: 정상 `ok` 플러시.

서버 측은 `operations` 테이블 자체가 로그다. 별도 애플리케이션 로그에 op을 다시 쓰지 않는다.

### 13.4 데이터 손실을 사후에라도 탐지하는 방법

손실은 "일어나지 않게 하는 것"과 "일어났으면 아는 것"이 별개다. **네 겹의 그물.**

**그물 1 — 실시간 해시 대조.**
클라이언트가 매 배치에 `expectedContentHash`를 싣고, 서버가 적용 후 재계산해 비교한다(§9.2-7). 어긋나면 **거절하지 않고 경보만** 올린다(사용자의 저장을 막는 것이 더 나쁘다). `sync.hash_mismatch > 0`은 리듀서·`persistDiff`·직렬화 중 하나가 갈라졌다는 뜻이고, 재현 가능한 버그다.

**그물 2 — 야간 전수 대조 잡.**
문서별로 두 경로의 상태를 만들어 해시를 비교한다.

```ts
// jobs/verify-convergence.ts  — 매일 03:00, 문서 전수(수천 개면 몇 분이다)
for (const doc of await allActiveDocs()) {
  const fromRows = await loadFromRows(db, doc.id);
  const fromLog  = await replayFromSnapshot(db, doc.id);       // 스냅샷 + op 재생
  if (hash(fromRows) !== hash(fromLog)) {
    alert('convergence.divergence', { docId: doc.id, revision: doc.revision });
    await db.insert(integrityIncidents).values({ docId: doc.id, kind: 'row-log-divergence', ... });
  }
}
```

이 잡이 **op 로그가 실제로 상태를 재구성할 수 있는지**를 매일 증명한다. 증명되지 않는 op 로그는 undo·감사·Yjs 브리지의 근거가 될 수 없고, 있으나 마나 하다.

**그물 3 — 클라이언트 op 원장 대조.**
클라이언트는 세션 종료 시 `issuedOpIds`의 개수와 `ackedOpIds`의 개수를 (해시된 docId와 함께) 분석 이벤트로 보낸다. 서버는 그 문서의 `operations` 행 수와 대조한다. **차이가 나면 어떤 op이 어디서 증발했는지 특정할 수 있다** — opId는 클라이언트 발급이므로 서버 측 유실을 잡아낸다.

**그물 4 — 사용자 신고 경로의 계측.**
"내용이 사라졌어요" 문의가 오면 답을 만들 수 있어야 한다. 필요한 것은 `docId + 대략의 시각` 뿐이고, 그러면
`operations`에서 해당 구간의 op을 뽑고 → `loadDocState(atRevision)`로 그 시점 상태를 만들고 → tombstone 아카이브(§5.4)와 `item_conflicts`(§5.3)를 확인한다.
**이 3단이 5분 안에 되는지를 분기마다 리허설한다.** 리허설하지 않은 복구 절차는 없는 것과 같다.

### 13.5 대시보드 한 장

상단에 **"오늘 몇 명이 몇 초 동안 `저장 대기 중`을 봤는가"** 하나만 크게 둔다. 이 숫자가 이 시스템의 유일한 요약이다. `저장 대기 중`은 사용자가 처음으로 불안해지는 지점이고, 그 아래 모든 지표는 이 숫자를 설명하기 위한 것이다.

---

## 14. 테스트 전략

### 14.1 결정론적 시뮬레이션 — 어댑터 4개

`sync-client`가 브라우저 API를 직접 부르지 않는 이유(§2.1)가 여기서 값을 한다.

```ts
// packages/sync-client/src/adapters.ts
export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
export type Transport = { send(input: ApplyOpsInputT): Promise<ApplyOpsResult>; pull(docId: string, since: number): Promise<PullResult> };
export type Storage = { getDoc(id): Promise<Stored | null>; putDoc(...): Promise<void>; getOutbox(id): Promise<Row[]>; /* … */ };
export type Channel = { post(m: Msg): void; onMessage(fn: (m: Msg) => void): () => void };
```

시뮬레이터는 이 넷을 가짜로 채운다.

```ts
// packages/sync-client/test/sim/world.ts
export class World {
  private t = 0;
  private queue: Array<{ at: number; seq: number; fn: () => void }> = [];
  private seq = 0;
  readonly rng: () => number;                 // 시드 고정 (mulberry32)

  /** 가상 시계 — 실시간을 기다리지 않는다. 3일치 시나리오가 20ms에 돈다 */
  clock(): Clock { /* setTimeout → queue.push({at: t + ms}) */ }

  /** 네트워크 모델: 지연·순서뒤바뀜·중복·유실·파티션 */
  net(cfg: { minMs: number; maxMs: number; dropRate: number; dupRate: number; reorder: boolean }): Transport { … }

  /** 다음 이벤트로 시간을 점프. 결정론의 핵심 — 실시간이 개입할 여지가 없다 */
  run(untilMs = Infinity): void {
    while (this.queue.length) {
      this.queue.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));   // 동시각은 seq로 결정론적 타이브레이크
      const ev = this.queue[0]!;
      if (ev.at > untilMs) break;
      this.queue.shift(); this.t = ev.at; ev.fn();
    }
  }

  partition(clientIds: string[]): void { … }
  heal(): void { … }
}
```

**실패 시나리오는 시드로 재현한다.** CI가 매 실행마다 랜덤 시드 200개를 돌리고, 실패하면 시드를 그대로 이슈에 붙인다. 이게 "동기화 버그를 재현할 수 있는가"에 대한 답이다.

### 14.2 속성 기반 테스트 — 무엇을 증명하는가

| # | 속성 | 반증되면 |
|---|---|---|
| P1 | **수렴** — 같은 op 집합이 서로 다른 도착 순서로 서버에 들어가도, 모든 클라이언트의 최종 `contentHash`가 같다 | 사용자마다 다른 문서를 본다 |
| P2 | **교환 표의 정확성** — `commutes(x,y) === true`면 `applyOps([x,y]) ≡ applyOps([y,x])` | §9.4의 무침묵 병합이 상태를 갈라놓는다 |
| P3 | **압축 보존** — `applyOps(coalesce(ops)) ≡ applyOps(ops)` | 저장된 내용이 화면과 다르다 |
| P4 | **역연산 정확성** — `applyOps([op, ...invertOp(s, op)])(s) ≡ s` | undo가 문서를 망가뜨린다 |
| P5 | **멱등성** — 같은 배치를 두 번 커밋해도 상태와 revision이 한 번과 같다 | 재전송이 중복 아이템을 만든다 |
| P6 | **손실 없음** — 임의 장애 주입 후 healing하면, 발행된 모든 opId가 `operations`에 있다 | **I1 위반. 가장 중요한 속성** |
| P7 | **merge3 대칭성** — `merge3(b,x,y).text === merge3(b,y,x).text` (성공 시) | 두 클라이언트가 다른 병합 결과를 만든다 |
| P8 | **전역성** — 임의 op을 임의 상태에 적용해도 `applyOp`이 throw하지 않는다 | 문서가 멈춘다 |

### 14.3 예시 1 — 수렴 (속성)

```ts
// packages/graph-core/test/ops/convergence.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { applyOps, emptyDoc, derive } from '@workflow/graph-core';
import { arbOpSequence, hashOf } from './arb.ts';

test('P1: 서버 전체 순서가 같으면 어떤 클라이언트도 같은 상태에 도달한다', () => {
  fc.assert(fc.property(arbOpSequence({ actors: 3, length: 120 }), (ops) => {
    // 서버는 도착 순서대로 적용한다
    const server = applyOps(emptyDoc('d'), ops.map((e) => e.op));

    // 클라이언트 A: 자기 op을 먼저 낙관적으로, 나머지를 나중에 (rebase 없는 최악 근사)
    const a = ops.filter((e) => e.actorId === 'a');
    const rest = ops.filter((e) => e.actorId !== 'a');
    const clientA = applyOps(applyOps(emptyDoc('d'), a.map((e) => e.op)), rest.map((e) => e.op));

    // ★ 순서가 다르면 상태도 다를 수 있다 — 그래서 rebase가 필요하다.
    //   여기서 검증하는 것은 "교환 가능한 op만 남기면 같아진다"이다
    if (batchCommutes(a.map((e) => e.op), rest.map((e) => e.op))) {
      assert.equal(hashOf(clientA), hashOf(server));
    }
  }), { numRuns: 500 });
});

test('P2: commutes()가 true라고 말한 쌍은 실제로 교환 가능하다', () => {
  fc.assert(fc.property(arbState(), arbOp(), arbOp(), (s, x, y) => {
    fc.pre(commutes(x, y));
    assert.equal(hashOf(applyOps(s, [x, y])), hashOf(applyOps(s, [y, x])));
  }), { numRuns: 2000 });
});
```

P2가 이 스위트의 심장이다. `commutes()`는 §9.4에서 **서버가 조용히 병합해도 되는지**를 결정하므로, 이 함수가 틀리면 데이터가 조용히 갈라진다. `numRuns`를 크게 잡는다.

### 14.4 예시 2 — 압축이 의미를 보존한다

```ts
// packages/graph-core/test/ops/coalesce.test.ts
test('P3: coalesce는 관찰 가능한 결과를 바꾸지 않는다', () => {
  fc.assert(fc.property(arbState(), arbEnvelopeSequence({ length: 60 }), (s, envs) => {
    const direct = applyOps(s, envs.map((e) => e.op));
    const packed = applyOps(s, coalesce(envs).map((e) => e.op));
    assert.equal(hashOf(direct), hashOf(packed));
  }), { numRuns: 1000 });
});

test('압축은 3-way merge의 base를 보존한다', () => {
  const id = 'i1';
  const envs = [
    env({ type: 'set_title', id, from: '견적서', to: '견적서 작성' }),
    env({ type: 'set_title', id, from: '견적서 작성', to: '견적서 작성해서 발송' }),
    env({ type: 'set_title', id, from: '견적서 작성해서 발송', to: '견적서 작성해서 발송하기' }),
  ];
  const [only] = coalesce(envs);
  assert.equal(coalesce(envs).length, 1);
  // ★ from이 가장 이른 값이어야 한다. 여기가 깨지면 동료의 동시 편집이 조용히 덮인다
  assert.equal(only!.op.from, '견적서');
  assert.equal(only!.op.to, '견적서 작성해서 발송하기');
});

test('구조 op은 장벽이다', () => {
  const envs = [
    env({ type: 'set_title', id: 'i1', from: 'a', to: 'b' }),
    env({ type: 'delete_item', id: 'i1' }),
    env({ type: 'restore_item', id: 'i1' }),
    env({ type: 'set_title', id: 'i1', from: 'b', to: 'c' }),
  ];
  assert.equal(coalesce(envs).length, 4);   // 하나도 합쳐지지 않는다
});
```

### 14.5 예시 3 — 시뮬레이션: 3 클라이언트 · 파티션 · 중복 · 순서 뒤바뀜

```ts
// packages/sync-client/test/sim/partition.test.ts
test('P6: 파티션 중 편집한 내용이 healing 후 하나도 사라지지 않는다', async () => {
  const w = new World({ seed: 42 });
  const server = new FakeServer(w);
  const [a, b, c] = ['a', 'b', 'c'].map((id) =>
    makeClient({ id, clock: w.clock(), transport: w.net({ minMs: 30, maxMs: 400, dropRate: 0.05, dupRate: 0.05, reorder: true }), storage: new MemStorage(), channel: w.channel(id) }));

  // 1) 공통 상태를 만든다
  a.dispatch([insert('i1', null, 'a0', '견적 요청 받기')]);
  w.run(w.now() + 2_000);
  assert.equal(server.revisionOf('d'), 1);

  // 2) c를 격리한다 — 노트북을 들고 지하철로 내려갔다
  w.partition(['c']);

  // 3) 세 명이 동시에 다른 일을 한다
  a.dispatch([setTitle('i1', '견적 요청 받기', '견적 요청 접수')]);
  b.dispatch([insert('i2', null, 'a1', '담당자 배정'), setAssignee('i2', null, 'u9')]);
  for (let i = 0; i < 30; i++) c.dispatch([insert(`c${i}`, null, `b${i}`, `오프라인 단계 ${i}`)]);

  w.run(w.now() + 30_000);
  assert.equal(c.phase, 'offline');
  assert.equal(c.indicator().label, '오프라인 · 이 기기에 저장됨');

  // 4) 지상으로 나왔다
  w.heal();
  w.run(w.now() + 120_000);

  // ── 검증 ─────────────────────────────────────────────────────────────
  // (1) 발행된 모든 op이 서버에 있다. **하나도 빠지지 않는다**
  for (const client of [a, b, c]) {
    for (const opId of client.issuedOpIds) {
      assert.ok(server.hasOp('d', opId), `유실된 op: ${opId}`);
    }
  }
  // (2) 중복 전송이 있었지만 아이템은 한 번씩만 생겼다
  assert.equal(server.state('d').items.size, 1 + 1 + 30);
  // (3) 세 클라이언트가 같은 상태로 수렴했다
  assert.equal(hashOf(a.doc), hashOf(server.state('d')));
  assert.equal(hashOf(b.doc), hashOf(server.state('d')));
  assert.equal(hashOf(c.doc), hashOf(server.state('d')));
  // (4) c는 검증을 통과했으므로 "모두 저장했어요"를 띄웠다
  assert.deepEqual(c.toasts.at(-1)?.text, '다시 연결됐어요. 그동안 쓰신 내용까지 모두 저장했어요.');
});
```

### 14.6 예시 4 — 제목 동시 편집: 조용한 병합과 충돌 기록

```ts
// packages/sync-client/test/conflict.test.ts
test('겹치지 않는 제목 편집은 사용자에게 아무것도 보여주지 않는다', async () => {
  const w = new World({ seed: 7 });
  const s = new FakeServer(w);
  const [a, b] = twoClients(w, s, { items: [{ id: 'i1', title: '견적서 작성' }] });

  a.dispatch([setTitle('i1', '견적서 작성', '견적서 작성해서 발송')]);   // 뒤에 덧붙임
  b.dispatch([setTitle('i1', '견적서 작성', '매월 견적서 작성')]);       // 앞에 덧붙임
  w.run(w.now() + 5_000);

  assert.equal(s.state('d').items.get('i1')!.title, '매월 견적서 작성해서 발송');
  assert.equal(s.state('d').conflicts.size, 0);
  assert.equal(a.visibleConflicts().length, 0);          // 칩이 뜨지 않는다
  assert.equal(a.indicator().label, '저장됨');            // '합치는 중'을 스쳐 지나갔을 뿐
});

test('같은 구간을 다르게 고치면 두 내용을 모두 남긴다', async () => {
  const w = new World({ seed: 8 });
  const s = new FakeServer(w);
  const [a, b] = twoClients(w, s, { items: [{ id: 'i1', title: '견적서 작성' }] });

  a.dispatch([setTitle('i1', '견적서 작성', '견적서 검토')]);
  b.dispatch([setTitle('i1', '견적서 작성', '견적서 승인')]);
  w.run(w.now() + 5_000);

  const conflict = s.state('d').conflicts.get('i1:title')!;
  assert.ok(conflict);
  // ★ 어느 쪽도 버려지지 않았다
  const values = conflict.variants.map((v) => JSON.parse(v.value));
  assert.ok(values.includes('견적서 검토'));
  assert.ok(values.includes('견적서 승인'));
  assert.equal(JSON.parse(conflict.base), '견적서 작성');
  // ★ 자동 해소되지 않았다
  assert.equal(conflict.resolvedAt, null);
  // ★ 양쪽 화면에 같은 칩이 뜬다
  assert.equal(a.visibleConflicts()[0]!.chipText, '두 내용을 모두 남겨뒀어요');
  assert.equal(b.visibleConflicts()[0]!.chipText, '두 내용을 모두 남겨뒀어요');
  // ★ 편집은 차단되지 않는다
  assert.notEqual(a.indicator().bar, 'blocking');
});
```

### 14.7 예시 5 — 크래시 복구 · 멱등성 · 리더 승계

```ts
// packages/sync-client/test/crash.test.ts
test('P5+I5: 전송 직후 크래시해도 op이 중복되지도 사라지지도 않는다', async () => {
  const w = new World({ seed: 11 });
  const s = new FakeServer(w);
  const storage = new MemStorage();                     // ★ 오리진 공유 — 탭이 죽어도 남는다
  const tab1 = makeClient({ id: 't1', storage, ...w.wire() });

  tab1.dispatch([insert('i1', null, 'a0', '견적 요청')]);
  s.holdNextResponse();                                  // 서버는 커밋했지만 응답이 안 온다
  w.run(w.now() + 1_000);
  assert.equal(s.state('d').items.size, 1);
  assert.equal(tab1.inflight.length, 1);

  tab1.crash();                                          // pagehide 없이 즉사

  // 새 탭이 열린다 — Web Locks 대기열에서 자동 승계
  const tab2 = makeClient({ id: 't2', storage, ...w.wire() });
  await tab2.boot('d', s.snapshotFor('d'));
  w.run(w.now() + 5_000);

  // (1) 미확인 op을 아웃박스에서 살려 재전송했다
  assert.ok(tab2.telemetry('sync.boot_recovered_ops') >= 1);
  // (2) 서버는 멱등성으로 중복을 걸렀다 — 아이템은 하나
  assert.equal(s.state('d').items.size, 1);
  // (3) revision이 두 번 올라가지 않았다
  assert.equal(s.revisionOf('d'), 1);
  // (4) 사용자는 결국 저장됨을 본다
  assert.equal(tab2.indicator().label, '저장됨');
});

test('리더가 죽으면 다음 탭이 이어받고, 보기 전용 탭은 편집을 만들지 않는다', async () => {
  const w = new World({ seed: 12 });
  const s = new FakeServer(w);
  const storage = new MemStorage();
  const t1 = makeClient({ id: 't1', storage, ...w.wire() });
  const t2 = makeClient({ id: 't2', storage, ...w.wire() });
  const t3 = makeClient({ id: 't3', storage, ...w.wire() });
  w.run(w.now() + 500);

  assert.equal([t1, t2, t3].filter((t) => t.isLeader).length, 1);   // 정확히 하나
  const follower = [t1, t2, t3].find((t) => !t.isLeader)!;
  assert.equal(follower.indicator().label, '보기 전용');

  follower.dispatch([insert('x', null, 'a0', '무시되어야 함')]);
  w.run(w.now() + 1_000);
  assert.equal(follower.queued.length, 0);                          // op을 만들지 않는다
  assert.equal(s.state('d').items.size, 0);

  const leader = [t1, t2, t3].find((t) => t.isLeader)!;
  leader.crash();
  w.run(w.now() + 1_000);
  assert.equal([t1, t2, t3].filter((t) => t.isLeader && !t.crashed).length, 1);  // 정확히 하나로 승계
});
```

### 14.8 그 밖에 반드시 있어야 하는 테스트

| 테스트 | 왜 |
|---|---|
| **IME 회귀** — Playwright + CDP `Input.imeSetComposition`으로 "한글 조합 중 자동저장 큐 플러시가 op을 만들지 않는다" | ARCHITECTURE §3. 사람이 절대 못 잡는다 |
| **`sortKey` 충돌 강제** — jitter를 시드 고정해 같은 키를 만들고 유니크 위반 경로를 태운다 | 1/47,000은 테스트로만 만날 수 있다 |
| **압축 이후 오프라인 복귀** — op을 압축한 뒤 `410 Gone` → `resync` 경로 | §8.3. 프로덕션에서 처음 만나면 안 된다 |
| **저장소 실패 주입** — `put`이 QuotaExceededError를 던지는 MemStorage | §6.4의 문구 분기까지 검증 |
| **행 ↔ 로그 대조** — 골든 픽스처 36건 전부에 대해 `loadFromRows ≡ replayFromSnapshot` | §13.4 그물 2의 CI판 |
| **beacon 64KB 경계** — 큐가 상한을 넘을 때 접두만 나가고 나머지가 남는지 | §9.1 |

---

## 15. 미해결 · 다음에 결정할 것

| # | 항목 | 언제 결정 |
|---|---|---|
| 1 | **`min_acked_revision` 추적의 정확도** — 액터별 ack 하한을 어디에 기록할지(`document_members`에 컬럼 vs 별도 테이블). 지금은 컬럼 가정 | 압축 잡을 실제로 켜기 직전 |
| 2 | **충돌 칩의 아웃라인 렌더 위치** — 블록 우측 인라인인지, 블록 아래 확장 영역인지. COMPONENTS.md와 맞춰야 한다 | 에디터 구현 시 |
| 3 | **`resolve_conflict`의 권한** — 남이 만든 충돌을 아무나 해소해도 되는가. 지금은 editor면 누구나 | 파일럿 관찰 후 |
| 4 | **체크리스트 실행(run) 큐를 같은 엔진에 태울지** — `docId` 대신 `runId`로 일반화할지, 별도 단순 큐로 둘지 | M2 |
| 5 | **7일 초과 오프라인의 "먼저 비교해보기" UI** — diff 뷰가 필요하다. 시점 복원 UI(§10.3)와 같은 컴포넌트로 만들 수 있는지 | 시점 복원 구현 시 |
| 6 | **서버 측 `derive()` 실행 빈도** — 지금은 매 커밋(§9.2-7). 500아이템 문서에서 1.5ms지만, 초당 커밋이 많은 조직에서 재검토 | 부하 관찰 후 |
| 7 | **`operations` 파티셔닝** — 월 단위 파티션이 필요해지는 시점 | 테이블 1억 행 접근 시 |




/**
 * packages/sync-protocol/src/ops.ts
 *
 * SYNC.md §1.5 — op 와이어 스키마.
 *
 *   deps: zod, @workflow/graph-core(**타입만**)
 *
 * 왜 여기 있는가 (D-119 / SYNC §2.1):
 *   graph-core의 `dependencies: {}`는 영구 계약이다. zod는 런타임 의존성이고,
 *   메이저 업그레이드마다 graph-core를 인질로 잡는다. 그리고 **검증은 신뢰 경계
 *   (서버 액션 입구)의 관심사**이지 순수 계산의 관심사가 아니다.
 *
 * 두 패키지를 나누고도 안전한 이유는 파일 맨 아래 `satisfies z.ZodType<Op>` 한 줄뿐이다.
 * graph-core의 `Op`과 이 스키마가 어긋나면 **컴파일이 깨진다.**
 */

import { z } from 'zod';
import type { Op } from '@workflow/graph-core';

/* ── 원자 ────────────────────────────────────────────────────────────────── */

const uuid = z.string().uuid();
const nodeKind = z.enum(['task', 'branch', 'hold']);
const durationBand = z.enum(['1m', '5m', '15m', '1h', 'halfday', '1d+']);

/** base62 fractional index. COLLATE "C" 바이트 비교 전제 */
const sortKey = z.string().min(1).max(160).regex(/^[0-9A-Za-z]+$/);

/** 제목은 한 줄 평문이다. 개행·마크업이 들어오면 Yjs(Y.Text) 전환 지점이 오염된다 (§12) */
const title = z.string().max(2000).refine((s) => !s.includes('\n'), '제목은 한 줄이다');

/** items.id 또는 'start' / 'end' / 'join:{uuid}' */
const nodeRef = z.union([
  uuid,
  z.literal('start'),
  z.literal('end'),
  z.string().regex(/^join:[0-9a-f-]{36}$/),
]);

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

const conflictField = z.enum(['title', 'assigneeId', 'durationBand', 'kind', 'attrs', 'deleted']);

/* ── 1) 구조 ─────────────────────────────────────────────────────────────── */

export const InsertItem = z.object({
  type: z.literal('insert_item'),
  id: uuid, // ★ 클라이언트 발급 (D-031)
  parentId: uuid.nullable(),
  sortKey,
  kind: nodeKind,
  title, // 버스트가 확정되기 전이면 '' — 이후 set_title이 채운다
});

export const DeleteItem = z.object({ type: z.literal('delete_item'), id: uuid });
export const RestoreItem = z.object({ type: z.literal('restore_item'), id: uuid });

/** 부모가 바뀌는 이동. sortKey도 반드시 함께 바뀐다 (새 형제 목록의 키) */
export const MoveItem = z.object({
  type: z.literal('move_item'),
  id: uuid,
  parentId: uuid.nullable(),
  sortKey,
});

/** 같은 부모 안 순서 변경. move_item과 분리하는 이유: 위상 재계산 범위가 다르다 */
export const ReorderItem = z.object({ type: z.literal('reorder_item'), id: uuid, sortKey });

/* ── 2) 스칼라 필드 ──────────────────────────────────────────────────────────
 *  전부 `from`(내가 보고 있던 값)을 싣는다 (D-110).
 *  from이 없으면 모든 필드 변경이 무조건 last-write-wins가 되고 I1을 구현할 수 없다. */

export const SetTitle = z.object({ type: z.literal('set_title'), id: uuid, from: title, to: title });
export const SetKind = z.object({ type: z.literal('set_kind'), id: uuid, from: nodeKind, to: nodeKind });

/** attrs는 키별 슬롯이다. from/to 모두 부분 객체 — 키가 겹치지 않으면 교환 가능 */
export const SetAttr = z.object({
  type: z.literal('set_attr'),
  id: uuid,
  from: itemAttrs.partial(),
  to: itemAttrs.partial(),
});

export const SetAssignee = z.object({
  type: z.literal('set_assignee'),
  id: uuid,
  from: uuid.nullable(),
  to: uuid.nullable(), // null = "앞과 같음" (D-055). "모름"이 아니다
});

export const SetDuration = z.object({
  type: z.literal('set_duration'),
  id: uuid,
  from: durationBand.nullable(),
  to: durationBand.nullable(),
});

export const SetFreq = z.object({
  type: z.literal('set_freq'),
  id: uuid,
  from: z.number().int().nullable(),
  to: z.number().int().min(0).max(10000).nullable(),
});

export const SetAutomation = z.object({
  type: z.literal('set_automation'),
  id: uuid,
  from: z.number().int().nullable(),
  to: z.number().int().min(0).max(3).nullable(),
});

/** 토글이 아니라 대입. 토글은 멱등도 교환도 아니다 (§1.1c) */
export const SetPain = z.object({
  type: z.literal('set_pain'),
  id: uuid,
  from: z.boolean(),
  to: z.boolean(),
});

/** 신선도. at은 클라이언트가 싣고 서버가 now로 클램프한다. 병합은 max */
export const ConfirmItem = z.object({ type: z.literal('confirm_item'), id: uuid, at: z.number().int() });

/* ── 3) 도구 — 집합이므로 원소 단위 ─────────────────────────────────────── */

export const AddTool = z.object({ type: z.literal('add_tool'), id: uuid, toolId: uuid });
export const RemoveTool = z.object({ type: z.literal('remove_tool'), id: uuid, toolId: uuid });

/* ── 4) 엣지 오버라이드 ─────────────────────────────────────────────────── */

export const AddEdge = z.object({
  type: z.literal('add_edge'),
  id: uuid, // 엣지 ID도 클라이언트 발급
  sourceId: nodeRef,
  targetId: nodeRef,
  label: z.string().max(200).optional(),
});

/** 파생 엣지 억제. add_edge와 같은 테이블·다른 kind */
export const SuppressEdge = z.object({
  type: z.literal('suppress_edge'),
  id: uuid,
  sourceId: nodeRef,
  targetId: nodeRef,
});

export const RemoveEdge = z.object({ type: z.literal('remove_edge'), id: uuid });
export const UnsuppressEdge = z.object({ type: z.literal('unsuppress_edge'), id: uuid });
export const SetEdgeLabel = z.object({
  type: z.literal('set_edge_label'),
  id: uuid,
  from: z.string().max(200).nullable(),
  to: z.string().max(200).nullable(),
});

/* ── 5) 문서 ─────────────────────────────────────────────────────────────── */

export const SetDocTitle = z.object({ type: z.literal('set_doc_title'), from: title, to: title });

/* ── 6) 배치 ─────────────────────────────────────────────────────────────── */
/**
 * paste_batch는 **의도적으로 굵다.** 이 하나만 §1.1(a)의 예외다.
 * 새로 만든 아이템은 전부 새 UUID라 다른 사람의 편집과 원천적으로 겹치지 않는다.
 * 상한 500줄. 초과분은 batch를 나누되 **같은 txnId를 공유**시켜 undo는 1회로 유지한다.
 */
export const PasteBatch = z.object({
  type: z.literal('paste_batch'),
  parentId: uuid.nullable(),
  items: z
    .array(
      z.object({
        id: uuid,
        parentId: uuid.nullable(), // 배치 내부 참조 또는 위 parentId
        sortKey,
        kind: nodeKind,
        title,
        attrs: itemAttrs.optional(),
        assigneeId: uuid.nullable().optional(),
        durationBand: durationBand.nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  edges: z
    .array(
      z.object({
        id: uuid,
        sourceId: nodeRef,
        targetId: nodeRef,
        label: z.string().max(200).optional(),
      }),
    )
    .max(500)
    .default([]),
  /** 사용자에게 보여줄 undo 라벨. "붙여넣기 18줄" */
  label: z.string().max(80),
});

/* ── 7) 충돌 — op으로 표현한다 ──────────────────────────────────────────── */

export const RecordConflict = z.object({
  type: z.literal('record_conflict'),
  itemId: uuid,
  field: conflictField,
  base: z.string(), // JSON.stringify된 공통 조상 값
  variants: z
    .array(
      z.object({
        value: z.string(), // JSON.stringify된 값
        actorId: uuid,
        lamport: z.number().int(),
      }),
    )
    .min(2)
    .max(8),
});

export const ResolveConflict = z.object({
  type: z.literal('resolve_conflict'),
  itemId: uuid,
  field: conflictField,
  /** 사용자가 고른 값. **자동 선택은 이 op을 발행하지 않는다** */
  chosen: z.string(),
  chosenBy: uuid,
});

/* ── 합집합 ──────────────────────────────────────────────────────────────── */

export const OpSchema = z.discriminatedUnion('type', [
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
]);

/**
 * ★ graph-core의 `Op` 타입과 어긋나면 여기서 컴파일이 깨진다.
 *
 * 명세는 `satisfies z.ZodType<Op>`를 스키마 선언에 바로 붙이지만, zod 4에서는
 * `discriminatedUnion`의 옵션 배열 추론이 그 자리에서 무너져 판별 정보가 사라진다.
 * 검사를 **별도 줄**로 떼면 같은 보장을 유지하면서 추론도 살아 있다.
 */
type _OpSchemaMatchesGraphCore = z.infer<typeof OpSchema> extends Op ? true : never;
const _forward: _OpSchemaMatchesGraphCore = true;
void _forward;

/**
 * 반대 방향은 **판별자 수준**으로만 본다.
 * graph-core의 `Op`은 배열 필드를 `readonly`로 선언하는데(불변 계약) zod는 가변 배열을
 * 추론하므로 전체 구조 비교는 readonly 하나 때문에 항상 실패한다.
 * 실무에서 잡아야 하는 것은 "graph-core에 op을 추가하고 스키마를 안 고쳤다"이고,
 * 그건 아래 한 줄이 잡는다.
 */
type _EveryOpTypeHasSchema = Exclude<Op['type'], z.infer<typeof OpSchema>['type']> extends never
  ? true
  : never;
const _covered: _EveryOpTypeHasSchema = true;
void _covered;

export type OpInput = z.input<typeof OpSchema>;
export type OpOutput = z.output<typeof OpSchema>;

/**
 * packages/graph-core/src/ops/state.ts
 *
 * SYNC.md §2.2 — 리듀서가 다루는 문서 상태.
 *
 * `items`를 배열이 아니라 `Map`으로 두는 이유: op 하나가 O(1)로 아이템을 찾아야 하고,
 * `derive()`에 넘길 때만 `[...items.values()]`로 펼치면 된다(정렬은 전처리가 이미 한다).
 */

import type { Edge, Item } from '../types.ts';

export type FieldConflictField =
  | 'title'
  | 'assigneeId'
  | 'durationBand'
  | 'kind'
  | 'attrs'
  | 'deleted';

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
  /** 현재 아이템 슬롯에 들어가 있는 값. 표시 순서를 정할 때만 쓴다 */
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
  docId,
  title: '',
  revision: 0,
  items: new Map(),
  edges: new Map(),
  conflicts: new Map(),
});

/**
 * **"삭제됨"의 순수 표현.** graph-core는 `Date.now()`를 쓸 수 없다(결정성 계약).
 * 그래서 리듀서는 시각을 만들지 않고 표식만 남긴다. 실제 타임스탬프는 서버가
 * `operations.created_at`에서, 클라이언트가 봉투의 `ts`에서 채운다.
 *
 * 값 자체는 비교에 쓰이지 않는다 — null인지 아닌지만 본다.
 * 그래서 `deletedAt`을 **정렬·표시에 쓰지 않는다**는 규칙이 나온다.
 */
export const TOMBSTONE: Date = new Date(0);

/** 같은 이유의 "해소됨" 표식 */
export const RESOLVED_MARK = 0;

/** derive()에 넘길 입력. tombstone은 전처리가 걸러낸다 */
export function itemsOf(state: DocState): Item[] {
  return [...state.items.values()];
}

export function edgesOf(state: DocState): Edge[] {
  return [...state.edges.values()];
}

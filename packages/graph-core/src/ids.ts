/**
 * packages/graph-core/src/ids.ts
 *
 * 자동 생성 노드·엣지의 **결정적 ID** 규칙 (§2).
 *
 * 불변식 3개:
 *   I1. ID는 오직 `items.id`(클라이언트 발급 UUID)와 고정 리터럴로만 구성된다.
 *       인덱스·깊이·정렬키·제목·해시가 ID에 들어가지 않는다.
 *   I2. 따라서 트리의 **어느 부분이 바뀌어도 무관한 노드의 ID는 바뀌지 않는다.**
 *       (형제 삽입/삭제/이동은 sortKey만 바꾸고 ID에는 닿지 않는다)
 *   I3. 예약 네임스페이스와 사용자 UUID는 충돌할 수 없다.
 *       UUID는 ':'를 포함하지 않고 'start'/'end'와 같을 수 없다.
 *       그럼에도 방어적으로 검사하고, 충돌 시 그 항목을 복구 처리한다.
 */

import type { EdgeReason, NodeId } from './types.ts';

export const START_ID = 'start' as const;
export const END_ID = 'end' as const;

export const JOIN_PREFIX = 'join:' as const;
export const FORK_PREFIX = 'fork:' as const;

/**
 * AND 합류 노드.
 *
 * 분기 **항목 ID**에서 유도한다. 갈래를 추가/삭제/재정렬해도, 심지어 갈래를
 * 전부 지웠다 다시 만들어도 합류 노드 ID는 그대로다. 캔버스 좌표 캐시·코멘트·
 * 접기 상태가 여기에 붙어도 안전한 이유다.
 */
export function joinNodeId(branchItemId: string): NodeId {
  return `${JOIN_PREFIX}${branchItemId}`;
}

/**
 * fork 노드는 **만들지 않는다.** 분기 항목 자체가 AND-split이기 때문이다
 * (사용자가 "동시에 진행"이라고 쓴 그 카드가 곧 fork다).
 * `fork:{id}`는 익스포터·역투영이 쓸 수 있는 **정규 별칭**으로만 존재하고,
 * 항상 분기 항목 노드로 해석된다.
 */
export function forkNodeId(branchItemId: string): NodeId {
  return `${FORK_PREFIX}${branchItemId}`;
}

export function isSyntheticId(id: string): boolean {
  return id === START_ID || id === END_ID || id.startsWith(JOIN_PREFIX);
}

/** 사용자 항목이 가질 수 없는 ID인가 */
export function isReservedId(id: string): boolean {
  return (
    id === START_ID ||
    id === END_ID ||
    id.startsWith(JOIN_PREFIX) ||
    id.startsWith(FORK_PREFIX)
  );
}

/** `join:xxx` / `fork:xxx` → `xxx` */
export function reservedTarget(id: string): { kind: 'join' | 'fork'; itemId: string } | null {
  if (id.startsWith(JOIN_PREFIX)) return { kind: 'join', itemId: id.slice(JOIN_PREFIX.length) };
  if (id.startsWith(FORK_PREFIX)) return { kind: 'fork', itemId: id.slice(FORK_PREFIX.length) };
  return null;
}

/**
 * 파생 엣지 ID.
 *
 * (reason, source, target)만으로는 유일하지 않다 — 빈 갈래가 두 개면 둘 다
 * `branch → 다음 단계`가 되기 때문이다. 그래서 갈래를 낳은 **갈래 항목 ID**를
 * 판별자로 붙인다. 이것도 UUID라 I1을 지킨다.
 */
export function derivedEdgeId(
  reason: EdgeReason,
  source: NodeId,
  target: NodeId,
  discriminator?: string,
): string {
  const base = `e:${reason}:${source}->${target}`;
  return discriminator === undefined ? base : `${base}#${discriminator}`;
}

/** 사이클 ID — 사이클을 닫는 back edge에서 유도 */
export function cycleId(backEdgeId: string): string {
  return `cycle:${backEdgeId}`;
}

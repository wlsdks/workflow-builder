/**
 * packages/graph-core/src/ops/envelope.ts
 *
 * SYNC.md §1.4 — 봉투.
 *
 * op 자체는 순수 데이터다. 라우팅·멱등성·인과성에 필요한 것은 전부 봉투에 둔다.
 * **op 안에 `ts`나 `actorId`를 넣지 않는다** — 넣는 순간 리듀서가 순수하지 않게 되고,
 * 같은 op을 재생했을 때 결과가 달라진다.
 */

import type { Op } from './types.ts';

export type OpEnvelope = {
  /** 클라이언트 발급 UUIDv7. 멱등성 키이자 ack 대조 키. 재전송해도 절대 바뀌지 않는다 */
  opId: string;
  /** undo 그룹. 같은 의도로 묶인 op들이 공유한다 (I7) */
  txnId: string;
  actorId: string;
  /** 클라이언트 논리 시계(문서별 단조 증가). 벽시계 대신 인과 순서를 준다 */
  lamport: number;
  /** 벽시계 ms. **표시용에 한한다.** 어떤 정렬·병합 근거로도 쓰지 않는다 */
  ts: number;
  /** 이 op을 만들 때 클라이언트가 보고 있던 문서 revision. 서버 rebase 판정 입력 */
  baseRevision: number;
  op: Op;
};

/**
 * 로컬 op 발행 시의 논리 시계.
 * `lamport = max(로컬, 서버가 알려준 최대) + 1`. 이 두 줄이 Yjs 전환 시 그대로 살아남는다.
 */
export function nextLamport(local: number, seenFromServer: number): number {
  return Math.max(local, seenFromServer) + 1;
}

/**
 * 인과 순서. 동률은 `actorId` 사전순으로 깬다.
 * **벽시계(`ts`)는 정렬에 절대 쓰지 않는다** — 기기 시계는 틀린다.
 */
export function compareEnvelopes(a: OpEnvelope, b: OpEnvelope): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.actorId !== b.actorId) return a.actorId < b.actorId ? -1 : 1;
  return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}

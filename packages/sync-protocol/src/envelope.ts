/**
 * packages/sync-protocol/src/envelope.ts
 *
 * SYNC.md §1.4 (봉투) · §9.1 (표면) · §9.2 (응답) — 와이어 계약.
 *
 * 서버 액션과 beacon용 Route Handler가 **같은 스키마**를 쓴다. 로직은 한 곳에만 있다.
 */

import { z } from 'zod';
import { OpSchema } from './ops.ts';

const uuid = z.string().uuid();

/**
 * op 자체는 순수 데이터다. 라우팅·멱등성·인과성에 필요한 것은 전부 봉투에 둔다.
 * **op 안에 ts나 actorId를 넣지 않는다** — 넣는 순간 리듀서가 순수하지 않게 된다.
 */
export const EnvelopeSchema = z.object({
  /** 클라이언트 발급 UUIDv7. 멱등성 키이자 ack 대조 키. 재전송해도 절대 바뀌지 않는다 */
  opId: uuid,
  /** undo 그룹. 같은 의도로 묶인 op들이 공유한다 (I7) */
  txnId: uuid,
  actorId: uuid,
  /** 클라이언트 논리 시계(문서별 단조 증가). 벽시계 대신 인과 순서를 준다 */
  lamport: z.number().int().nonnegative(),
  /** 벽시계 ms. **표시용에 한한다** */
  ts: z.number().int(),
  /** 이 op을 만들 때 클라이언트가 보고 있던 문서 revision */
  baseRevision: z.number().int().nonnegative(),
  op: OpSchema,
});

/* ── 요청 ────────────────────────────────────────────────────────────────── */

/**
 * `MAX_OPS = 200`은 §4.3의 배치 상한과 **반드시 같아야 한다.**
 * 클라이언트가 자르는 값과 서버가 거절하는 값이 어긋나면 큐가 영원히 안 빈다.
 */
export const MAX_OPS_PER_BATCH = 200;

export const ApplyOpsRequest = z.object({
  docId: uuid,
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(EnvelopeSchema).min(1).max(MAX_OPS_PER_BATCH),
  /**
   * 이 배치를 적용한 뒤 클라이언트가 계산한 derive().contentHash. 발산 탐지용 (§13).
   *
   * ★ 명세 §1.5는 `.length(16)`이라고 적었지만, graph-core의 `hash32`는
   *   FNV-1a 32bit를 base36으로 찍고 7자리로 padStart한다 — **항상 7자**다.
   *   16으로 두면 모든 요청이 400으로 거절된다.
   */
  expectedContentHash: z.string().length(7).optional(),
});

/** SYNC.md가 쓰는 이름. 같은 스키마다 */
export const ApplyOpsInput = ApplyOpsRequest;

/* ── 응답 ────────────────────────────────────────────────────────────────── */

/**
 * 200 — 적용됨.
 *
 * `serverOps`는 서버가 **추가로 발행한** op이다 (I3: 클라이언트 payload를 재작성하지 않는다).
 * sortKey 유니크 충돌 재발급이 여기로 돌아온다 (§5.2).
 * `ignoredOpIds`는 오류가 아니다 — 없는 아이템에 대한 op은 조용히 무시된다 (§5.4).
 */
export const OkResponse = z.object({
  kind: z.literal('ok'),
  revision: z.number().int().nonnegative(),
  appliedOpIds: z.array(uuid),
  ignoredOpIds: z.array(uuid).default([]),
  serverOps: z.array(EnvelopeSchema).default([]),
});

/** 409 — baseRevision이 밀렸고 무침묵 병합이 불가능하다. 클라이언트가 rebase한다 (§5) */
export const ConflictResponse = z.object({
  kind: z.literal('conflict'),
  serverRevision: z.number().int().nonnegative(),
  /** baseRevision 이후 서버가 받은 op 전부. 순서 보존 */
  missedOps: z.array(EnvelopeSchema),
});

/** 스냅샷 payload — items는 **tombstone을 포함한다.** 빠지면 오프라인 편집이 조용히 사라진다 (§10.2) */
export const SnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  payloadVersion: z.number().int().positive(),
  title: z.string(),
  items: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  conflicts: z.array(z.record(z.string(), z.unknown())).default([]),
  /** derive().contentHash — 복원 직후 검증이 한 줄이 된다 */
  contentHash: z.string(),
});

/**
 * 410 — 따라잡을 수 없다.
 *   deleted=false: op이 압축돼서 없다 → 스냅샷으로 resync (§8.3 경우 A)
 *   deleted=true : 문서가 삭제됐다 → **로컬 내용을 절대 지우지 않는다** (§8.3 경우 B)
 */
export const GoneResponse = z.object({
  kind: z.literal('gone'),
  revision: z.number().int().nonnegative(),
  deleted: z.boolean().default(false),
  snapshot: SnapshotSchema.optional(),
});

/** 403 — 권한이 바뀌었다. 클라이언트는 phase:'readonly'로 가되 **로컬 큐를 지우지 않는다** (§9.5) */
export const DeniedResponse = z.object({
  kind: z.literal('denied'),
  reason: z.enum(['read-only', 'no-access']),
});

export const ApplyOpsResponse = z.discriminatedUnion('kind', [
  OkResponse,
  ConflictResponse,
  GoneResponse,
  DeniedResponse,
]);

/* ── 타입 ────────────────────────────────────────────────────────────────── */

export type OpEnvelopeT = z.infer<typeof EnvelopeSchema>;
export type ApplyOpsRequestT = z.infer<typeof ApplyOpsRequest>;
export type ApplyOpsInputT = ApplyOpsRequestT;
export type OkResponseT = z.infer<typeof OkResponse>;
export type ConflictResponseT = z.infer<typeof ConflictResponse>;
export type GoneResponseT = z.infer<typeof GoneResponse>;
export type DeniedResponseT = z.infer<typeof DeniedResponse>;
export type ApplyOpsResponseT = z.infer<typeof ApplyOpsResponse>;
export type SnapshotT = z.infer<typeof SnapshotSchema>;

/**
 * 클라이언트가 추가로 다루는 두 결과는 **와이어에 없다.**
 * `network`(응답 자체가 없음)와 `server-error`(5xx)는 전송 어댑터가 만든다.
 * 스키마에 넣으면 서버가 그런 kind를 보낼 수 있다는 뜻이 되어 계약이 흐려진다.
 */
export type TransportFailure = { kind: 'network' } | { kind: 'server-error'; status: number };
export type ApplyOpsResult = ApplyOpsResponseT | TransportFailure;

/** HTTP 상태 — beacon용 Route Handler가 쓴다 (§9.1) */
export function statusOf(res: ApplyOpsResponseT): number {
  switch (res.kind) {
    case 'ok':
      return 200;
    case 'conflict':
      return 409;
    case 'gone':
      return 410;
    case 'denied':
      return 403;
  }
}

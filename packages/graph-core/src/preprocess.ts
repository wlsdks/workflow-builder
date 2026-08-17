/**
 * packages/graph-core/src/preprocess.ts
 *
 * derive() 1단계: 행 배열 → 정렬된 트리.
 *
 * 여기서 하는 일은 전부 **복구**다. 어떤 입력도 거절하지 않는다 (§4).
 * 입력이 깨져 있으면 그림이 안 그려지는 게 아니라, 덜 정확한 그림이 그려진다.
 */

import type { Diagnostic, Item, NodeKind } from './types.ts';
import { isReservedId } from './ids.ts';

export type ItemRole = 'step' | 'case';

export type PItem = {
  readonly item: Item;
  readonly id: string;
  readonly kind: NodeKind;
  /**
   * 역할은 **kind가 아니라 위치**로 정해진다.
   *   isCase(x) ⟺ parent 존재 ∧ parent.kind === 'branch' ∧ ¬isCase(parent)
   * 이 교대 규칙 하나로 중첩 분기가 자동으로 맞아떨어진다:
   * 갈래의 자식은 항상 본문 단계이고, 본문 단계가 분기면 그 자식이 다시 갈래다.
   */
  readonly role: ItemRole;
  readonly depth: number;
  /** pre-order 인덱스. ELK model order와 정규 순서의 근거 */
  order: number;
  readonly children: PItem[];
  readonly parent: PItem | null;
};

export type Preprocessed = {
  readonly roots: readonly PItem[];
  readonly byId: ReadonlyMap<string, PItem>;
  /** pre-order 전체 목록 */
  readonly all: readonly PItem[];
};

/**
 * sortKey 비교. Postgres `COLLATE "C"`(바이트 순서)와 일치시켜야 한다.
 * JS 문자열의 `<`는 UTF-16 코드 유닛 순서이고 base62 문자 집합에서는
 * 바이트 순서와 동일하다. `localeCompare`를 쓰면 **조용히 틀어진다.**
 */
export function compareSortKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSiblings(a: Item, b: Item): number {
  const s = compareSortKey(a.sortKey, b.sortKey);
  if (s !== 0) return s;
  // 동시 삽입으로 키가 충돌해도 순서는 결정적이어야 한다 → ID로 tie-break
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function preprocess(items: readonly Item[], diag: Diagnostic[]): Preprocessed {
  /* ── 1. 중복 ID 제거 ─────────────────────────────────────────────────────
   * 입력 순서에 의존하면 결정성이 깨진다. (sortKey, id) 최소를 남긴다. */
  const rows = new Map<string, Item>();
  const dupes: string[] = [];
  for (const it of items) {
    const prev = rows.get(it.id);
    if (!prev) {
      rows.set(it.id, it);
      continue;
    }
    dupes.push(it.id);
    if (compareSiblings(it, prev) < 0) rows.set(it.id, it);
  }
  if (dupes.length > 0) {
    diag.push({
      code: 'duplicate-item-id',
      severity: 'repaired',
      itemIds: [...new Set(dupes)].sort(),
      detail: `중복 항목 ID ${dupes.length}건. (sortKey, id) 최소 행만 남겼다.`,
      userMessage: null,
    });
  }

  /* ── 2. tombstone 제거 ───────────────────────────────────────────────── */
  for (const [id, it] of [...rows]) {
    if (it.deletedAt != null) rows.delete(id);
  }

  /* ── 3. 예약 ID 침범 ─────────────────────────────────────────────────────
   * UUID는 구조적으로 여기 걸릴 수 없다. 걸렸다면 마이그레이션·수기 입력·
   * AI 생성 데이터다. 항목을 버리지 않고 **트리에서만 제외**한다. */
  const reserved: string[] = [];
  for (const [id] of [...rows]) {
    if (isReservedId(id)) {
      reserved.push(id);
      rows.delete(id);
    }
  }
  if (reserved.length > 0) {
    diag.push({
      code: 'reserved-item-id',
      severity: 'repaired',
      itemIds: reserved.sort(),
      detail: `예약 네임스페이스(start/end/join:/fork:)와 충돌하는 항목 ID. 그래프에서 제외했다.`,
      userMessage: null,
    });
  }

  /* ── 4. 부모 해석: 없는 부모 / 삭제된 부모 → 루트로 승격 ─────────────── */
  const orphans: string[] = [];
  const parentOf = new Map<string, string | null>();
  for (const [id, it] of rows) {
    const p = it.parentId;
    if (p == null) {
      parentOf.set(id, null);
    } else if (!rows.has(p)) {
      orphans.push(id);
      parentOf.set(id, null);
    } else {
      parentOf.set(id, p);
    }
  }
  if (orphans.length > 0) {
    diag.push({
      code: 'orphan-parent',
      severity: 'repaired',
      itemIds: orphans.sort(),
      detail:
        '부모가 없거나 삭제된 항목. 내용을 버리지 않기 위해 루트 단계로 승격했다. ' +
        '부모가 복원되면 다음 derive()에서 원래 자리로 돌아간다.',
      userMessage: null,
    });
  }

  /* ── 5. 부모 사이클 (a→b→a) → 사이클 내 최소 ID를 루트로 절단 ────────── */
  const cycled: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0 미방문 / 1 스택 / 2 완료
  for (const id of [...rows.keys()].sort()) {
    if (state.get(id) === 2) continue;
    const path: string[] = [];
    let cur: string | null = id;
    while (cur != null && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        // 사이클 발견 — path에서 cur부터가 사이클
        const start = path.indexOf(cur);
        const ring = path.slice(start).sort();
        const cut = ring[0]!;
        parentOf.set(cut, null);
        cycled.push(...ring);
        break;
      }
      state.set(cur, 1);
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    for (const n of path) state.set(n, 2);
  }
  if (cycled.length > 0) {
    diag.push({
      code: 'parent-cycle',
      severity: 'repaired',
      itemIds: [...new Set(cycled)].sort(),
      detail:
        '부모 참조가 순환한다. 사이클 내 최소 ID 항목을 루트로 절단했다(결정적). ' +
        '트리에는 사이클이 있을 수 없다 — 그래프의 사이클(§5)과 혼동하지 말 것.',
      userMessage: null,
    });
  }

  /* ── 6. 형제 정렬 + 중복 sortKey 관찰 ───────────────────────────────── */
  const childrenRaw = new Map<string | null, Item[]>();
  for (const [id, it] of rows) {
    const p = parentOf.get(id) ?? null;
    const list = childrenRaw.get(p);
    if (list) list.push(it);
    else childrenRaw.set(p, [it]);
  }
  const dupKeys: string[] = [];
  for (const list of childrenRaw.values()) {
    list.sort(compareSiblings);
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.sortKey === list[i - 1]!.sortKey) dupKeys.push(list[i]!.id);
    }
  }
  if (dupKeys.length > 0) {
    diag.push({
      code: 'duplicate-sort-key',
      severity: 'note',
      itemIds: dupKeys.sort(),
      detail:
        'sortKey 충돌(jittered fractional index 기준 약 1/47,000). ID로 tie-break했다. ' +
        '순서는 결정적이지만 사용자가 의도한 순서와 다를 수 있다.',
      userMessage: null,
    });
  }

  /* ── 7. 역할·깊이·pre-order 부여 ────────────────────────────────────── */
  const byId = new Map<string, PItem>();
  const all: PItem[] = [];
  let counter = 0;

  const build = (item: Item, parent: PItem | null, depth: number): PItem => {
    const parentIsBranchStep = parent !== null && parent.kind === 'branch' && parent.role !== 'case';
    const node: PItem = {
      item,
      id: item.id,
      kind: item.kind,
      role: parentIsBranchStep ? 'case' : 'step',
      depth,
      order: counter++,
      children: [],
      parent,
    };
    byId.set(node.id, node);
    all.push(node);
    for (const child of childrenRaw.get(item.id) ?? []) {
      node.children.push(build(child, node, depth + 1));
    }
    return node;
  };

  const roots = (childrenRaw.get(null) ?? []).map((it) => build(it, null, 0));

  return { roots, byId, all };
}

/** 갈래 라벨: caseLabel 우선, 없으면 제목 (사용자가 조건을 제목 칸에 적는 경우) */
export function caseLabelOf(c: PItem): string | undefined {
  const l = c.item.attrs.caseLabel ?? c.item.title;
  const t = l?.trim();
  return t ? t : undefined;
}

/** 갈래 합류 동작. 기본 continue (D-006) */
export function joinBehaviorOf(c: PItem): 'continue' | 'end' {
  return c.item.attrs.joinBehavior ?? 'continue';
}

/** 분기 모드. 기본 xor */
export function branchModeOf(b: PItem): 'xor' | 'and' | 'skip' {
  return b.item.attrs.mode ?? 'xor';
}

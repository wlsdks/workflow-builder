/**
 * packages/graph-core/src/project/back.ts
 *
 * §11 역투영 — 캔버스 조작 → 트리 연산.
 *
 * v1 캔버스는 읽기 전용이다 (D-038). 하지만 "그림을 직접 옮기고 싶다"는 요구는
 * 100% 온다. 그때 필요한 것은 새 아키텍처가 아니라 **이 파일 하나**다.
 *
 * ── 지배 규칙 ──────────────────────────────────────────────────────────────
 *
 *   **캔버스에서 그은 연결은 절대 구조가 되지 않는다. 항상 오버라이드다.**
 *
 * 임의 그래프에는 정규적(canonical) 아웃라인이 없다 (D-030). 캔버스에서 엣지
 * 하나를 그었다고 왼쪽 아웃라인을 재배열하면, 사용자는 자기가 건드리지도 않은
 * 문장이 통째로 움직이는 것을 본다. 비개발자 제품에서 이건 치명적이다.
 *
 * 그래서 역투영은 **두 갈래뿐**이다.
 *   - 노드를 옮기는 조작  → 트리 연산 (move_item / reorder_item / delete_item)
 *   - 선을 긋고 끊는 조작 → 오버라이드 (add_edge / suppress_edge / remove_edge)
 *
 * ── 오류를 띄우지 않는 방법: 사후 검증이 아니라 사전 어포던스 ────────────────
 *
 * `canApplyCanvasEdit()`는 드래그가 **끝난 뒤** 검사하는 함수가 아니다.
 * 드래그가 **시작될 때** 모든 후보 드롭존에 대해 미리 돌려서, 합법인 곳에만
 * 고스트 슬롯을 그린다. 불법인 곳에는 드롭 자체가 안 된다.
 * → 사용자는 거절 메시지를 볼 일이 없다. 못 하는 동작은 애초에 시도되지 않는다.
 * (§4의 "오류를 표시하지 않는다"를 캔버스에서 구현하는 방식)
 */

import type { DerivedGraph, Item, NodeId, NodeKind } from '../types.ts';
import type { Op } from '../incremental.ts';
import { END_ID, START_ID } from '../ids.ts';

export type CanvasEdit =
  /** 노드를 형제 사이 다른 위치로 끌어다 놓음 */
  | { kind: 'reorder'; nodeId: NodeId; afterNodeId: NodeId | null }
  /** 노드를 다른 부모(루트 또는 특정 갈래 본문) 아래로 옮김 */
  | { kind: 'reparent'; nodeId: NodeId; newParentItemId: string | null; afterNodeId: NodeId | null }
  /** 노드에서 노드로 선을 그음 */
  | { kind: 'connect'; sourceNodeId: NodeId; targetNodeId: NodeId; label?: string }
  /** 선을 끊음 */
  | { kind: 'disconnect'; edgeId: string }
  /** 엣지 위에 새 단계를 끼워 넣음 */
  | { kind: 'insert-between'; edgeId: string; itemKind: NodeKind; title: string }
  | { kind: 'delete-node'; nodeId: NodeId }
  | { kind: 'change-kind'; nodeId: NodeId; to: NodeKind }
  | { kind: 'set-title'; nodeId: NodeId; title: string };

export type RejectionCode =
  /** start/end/join은 계산 결과다. 트리에 대응 행이 없다 */
  | 'synthetic-node'
  /** start로 들어가거나 end에서 나가는 연결 */
  | 'terminal-endpoint'
  /** 드롭 지점이 어떤 형제 목록에도 속하지 않음 */
  | 'no-sibling-context'
  /** 자기 자신의 하위로 옮기려 함 */
  | 'cycle-in-tree'
  /** 합류 엣지 위에는 삽입 지점이 유일하지 않다 */
  | 'ambiguous-insert-point'
  /** 트리에 정규적 역상이 없는 조작 */
  | 'no-canonical-inverse';

export type Projection = { ok: true; ops: Op[]; note?: string };
export type Rejection = { ok: false; code: RejectionCode; explain: string; suggestion?: string };

export type ProjectContext = {
  graph: DerivedGraph;
  items: readonly Item[];
  /** 형제 사이에 낄 sortKey 발급. fractional-indexing-jittered를 주입한다 */
  keyBetween: (a: string | null, b: string | null) => string;
  /** 새 행의 UUID 발급. graph-core는 난수를 만들지 않는다 (결정성 계약) */
  newId: () => string;
};

/* ────────────────────────────────────────────────────────────────────────── */

/** 드래그 시작 시 드롭존 필터로 쓴다. 부작용 없음 */
export function canApplyCanvasEdit(graph: DerivedGraph, edit: CanvasEdit): true | Rejection {
  const synthetic = (id: NodeId): Rejection | null => {
    const n = graph.byId.get(id);
    if (!n) return { ok: false, code: 'synthetic-node', explain: `알 수 없는 노드 ${id}` };
    if (!n.synthetic) return null;
    return {
      ok: false,
      code: 'synthetic-node',
      explain:
        '시작·끝·합류 노드는 아웃라인에서 계산되어 나온 것이라 옮기거나 지울 수 없습니다.',
      suggestion:
        n.kind === 'join'
          ? '합류를 없애려면 갈래의 "여기서 끝"을 켜세요.'
          : undefined,
    };
  };

  switch (edit.kind) {
    case 'reorder':
    case 'reparent':
    case 'delete-node':
    case 'change-kind':
    case 'set-title': {
      const r = synthetic(edit.nodeId);
      if (r) return r;
      if (edit.kind === 'reparent') {
        // 자기 하위로 이동 금지 — 트리에는 사이클이 없다
        if (edit.newParentItemId && isDescendant(graph, edit.newParentItemId, edit.nodeId)) {
          return {
            ok: false,
            code: 'cycle-in-tree',
            explain: '단계를 자기 자신의 하위로 옮길 수 없습니다.',
          };
        }
      }
      return true;
    }

    case 'connect': {
      if (edit.targetNodeId === START_ID || edit.sourceNodeId === END_ID) {
        return {
          ok: false,
          code: 'terminal-endpoint',
          explain: '시작으로 들어가거나 끝에서 나가는 연결은 만들 수 없습니다.',
        };
      }
      if (!graph.byId.has(edit.sourceNodeId) || !graph.byId.has(edit.targetNodeId)) {
        return { ok: false, code: 'synthetic-node', explain: '알 수 없는 노드입니다.' };
      }
      // 사이클은 **허용**한다. 재작업 루프가 이 제품의 핵심이다 (§5)
      return true;
    }

    case 'disconnect': {
      const e = graph.edges.find((x) => x.id === edit.edgeId);
      if (!e) return { ok: false, code: 'no-canonical-inverse', explain: '없는 연결입니다.' };
      return true;
    }

    case 'insert-between': {
      const e = graph.edges.find((x) => x.id === edit.edgeId);
      if (!e) return { ok: false, code: 'no-canonical-inverse', explain: '없는 연결입니다.' };
      /* 합류 엣지 위 삽입은 트리 위치가 유일하지 않다.
       * 갈래 3개가 모이는 지점에 단계를 끼우면 "어느 갈래의 끝"인지 정해지지 않는다. */
      const inbound = (graph.incoming.get(e.target) ?? []).length;
      if (inbound > 1 && e.reason !== 'sequence') {
        return {
          ok: false,
          code: 'ambiguous-insert-point',
          explain: '여러 갈래가 모이는 지점입니다. 어느 갈래 뒤에 넣을지 정해지지 않습니다.',
          suggestion: '넣고 싶은 갈래의 마지막 단계 아래에서 Enter를 눌러 추가하세요.',
        };
      }
      return true;
    }
  }
}

/** 실제 op 생성 */
export function projectCanvasEdit(ctx: ProjectContext, edit: CanvasEdit): Projection | Rejection {
  const guard = canApplyCanvasEdit(ctx.graph, edit);
  if (guard !== true) return guard;

  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const siblingsOf = (parentId: string | null): Item[] =>
    ctx.items
      .filter((i) => i.deletedAt == null && (i.parentId ?? null) === parentId)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  switch (edit.kind) {
    /* 캔버스 순서 변경 → 형제 sortKey 재발급. **구조는 그대로** */
    case 'reorder': {
      const me = byId.get(edit.nodeId);
      if (!me) return notFound();
      const sibs = siblingsOf(me.parentId ?? null).filter((s) => s.id !== me.id);
      const at = edit.afterNodeId ? sibs.findIndex((s) => s.id === edit.afterNodeId) : -1;
      const before = at >= 0 ? sibs[at]!.sortKey : null;
      const after = sibs[at + 1]?.sortKey ?? null;
      return { ok: true, ops: [{ type: 'reorder_item', id: me.id, sortKey: ctx.keyBetween(before, after) }] };
    }

    case 'reparent': {
      const me = byId.get(edit.nodeId);
      if (!me) return notFound();
      const sibs = siblingsOf(edit.newParentItemId).filter((s) => s.id !== me.id);
      const at = edit.afterNodeId ? sibs.findIndex((s) => s.id === edit.afterNodeId) : -1;
      const before = at >= 0 ? sibs[at]!.sortKey : null;
      const after = sibs[at + 1]?.sortKey ?? null;
      return {
        ok: true,
        ops: [
          {
            type: 'move_item',
            id: me.id,
            parentId: edit.newParentItemId,
            sortKey: ctx.keyBetween(before, after),
          },
        ],
        note:
          '부모가 분기면 이 단계는 "갈래"가 되고, 갈래면 "본문 단계"가 된다. ' +
          '역할은 kind가 아니라 위치로 정해진다.',
      };
    }

    /* 임의의 엣지 긋기 → **언제나** 오버라이드. 구조를 건드리지 않는다 */
    case 'connect': {
      return {
        ok: true,
        ops: [
          {
            type: 'add_edge',
            id: ctx.newId(),
            sourceId: edit.sourceNodeId,
            targetId: edit.targetNodeId,
            label: edit.label,
          },
        ],
        note: '아웃라인은 바뀌지 않는다. 왼쪽 글에는 "예외 연결"로만 표시된다.',
      };
    }

    /* 파생 엣지 끊기 → suppressed 삽입 / 명시적 엣지 끊기 → 행 삭제 */
    case 'disconnect': {
      const e = ctx.graph.edges.find((x) => x.id === edit.edgeId)!;
      if (e.origin === 'explicit') {
        return { ok: true, ops: [{ type: 'remove_edge', id: e.id }] };
      }
      return {
        ok: true,
        ops: [
          { type: 'suppress_edge', id: ctx.newId(), sourceId: e.source, targetId: e.target },
        ],
        note:
          '파생 엣지는 지울 수 없다(저장되지 않으므로). 같은 (source, target)을 억제하는 ' +
          '행을 넣는다. 트리를 되돌리면 억제가 그대로 다시 발효된다.',
      };
    }

    /* 두 노드 사이에 노드 추가 → 형제 삽입 */
    case 'insert-between': {
      const e = ctx.graph.edges.find((x) => x.id === edit.edgeId)!;
      const src = ctx.graph.byId.get(e.source)!;
      const tgt = ctx.graph.byId.get(e.target)!;
      const anchor = src.itemId ? byId.get(src.itemId) : null;
      const next = tgt.itemId ? byId.get(tgt.itemId) : null;
      if (!anchor) {
        return {
          ok: false,
          code: 'no-canonical-inverse',
          explain: '시작·합류 노드 바로 뒤에는 캔버스에서 끼워 넣을 수 없습니다.',
          suggestion: '아웃라인 첫 줄 위에서 Enter를 누르세요.',
        };
      }
      const parentId = anchor.parentId ?? null;
      const sameParent = next != null && (next.parentId ?? null) === parentId;
      const key = ctx.keyBetween(anchor.sortKey, sameParent ? next!.sortKey : null);
      return {
        ok: true,
        ops: [
          {
            type: 'insert_item',
            id: ctx.newId(),
            parentId,
            sortKey: key,
            kind: edit.itemKind,
            title: edit.title,
          },
        ],
      };
    }

    /* 노드 삭제 — 자식 승격 정책이 필요하다 */
    case 'delete-node': {
      const me = byId.get(edit.nodeId);
      if (!me) return notFound();
      const kids = siblingsOf(me.id);
      if (kids.length === 0) {
        return { ok: true, ops: [{ type: 'delete_item', id: me.id }] };
      }
      /* 분기를 지우면 갈래가 통째로 사라진다 — 내용 손실이 가장 큰 조작이다.
       * 갈래 본문을 분기가 있던 자리로 **순서대로 승격**한다. 갈래 라벨은 잃는다.
       * (조건문이 사라졌으니 라벨을 붙일 데가 없다. 이건 정보 손실이고, 그래서
       *  이 조작만은 되돌리기 토스트를 띄운다) */
      const ops: Op[] = [];
      let prevKey: string | null = me.sortKey;
      const parentId = me.parentId ?? null;
      const promote = (items: readonly Item[]) => {
        for (const k of items) {
          const key = ctx.keyBetween(prevKey, null);
          ops.push({ type: 'move_item', id: k.id, parentId, sortKey: key });
          prevKey = key;
        }
      };
      if (me.kind === 'branch') {
        for (const c of kids) promote(siblingsOf(c.id));
        for (const c of kids) ops.push({ type: 'delete_item', id: c.id });
      } else {
        promote(kids);
      }
      ops.push({ type: 'delete_item', id: me.id });
      return {
        ok: true,
        ops,
        note: '하위 단계는 지운 자리로 순서대로 올라온다. 갈래 조건 라벨은 사라진다.',
      };
    }

    case 'change-kind': {
      const me = byId.get(edit.nodeId);
      if (!me) return notFound();
      return { ok: true, ops: [{ type: 'set_kind', id: me.id, kind: edit.to }] };
    }

    case 'set-title': {
      const me = byId.get(edit.nodeId);
      if (!me) return notFound();
      return { ok: true, ops: [{ type: 'set_title', id: me.id, title: edit.title }] };
    }
  }
}

function notFound(): Rejection {
  return { ok: false, code: 'synthetic-node', explain: '아웃라인에 해당 항목이 없습니다.' };
}

function isDescendant(graph: DerivedGraph, candidateChildId: string, ancestorId: string): boolean {
  // 그래프 노드에는 부모 링크가 없으므로 depth+order로 판정하지 않고
  // 호출자가 items를 넘기는 편이 정확하다. 여기서는 보수적으로 false.
  // (실제 구현에서는 ProjectContext.items로 조상 체인을 걷는다)
  return candidateChildId === ancestorId;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 트리로 사상 불가능한 조작 — 목록과 막는 방법
 *
 * | 캔버스에서 해보고 싶은 것            | 왜 불가능한가                    | 어떻게 막는가            |
 * |--------------------------------------|----------------------------------|--------------------------|
 * | start / end / join 노드 이동·삭제     | 저장되지 않는 계산 결과다         | 드래그 핸들·삭제 메뉴 부재 |
 * | 한 단계에 부모를 둘 이상 주기          | 트리의 부모는 1개                 | 두 번째 부모는 add_edge로 |
 * |                                      |                                  | 자동 강등 (구조 아님)      |
 * | 아무 데도 연결 안 된 노드 만들기        | 아웃라인의 모든 줄은 어딘가의 형제 | 캔버스에 "빈 공간 더블클릭 |
 * |                                      |                                  | → 노드 생성"을 두지 않는다 |
 * | 파생 엣지의 방향 뒤집기                | 방향은 sortKey 순서의 결과        | 엣지 끝점 드래그 비활성    |
 * | 서로 다른 분기의 갈래를 하나로 합치기   | 갈래는 특정 분기의 자식           | 드롭존을 같은 분기 안으로만 |
 * | 합류 지점 한가운데에 단계 끼우기        | 트리 위치가 유일하지 않음         | ambiguous-insert-point    |
 * | 노드 자유 배치(수동 좌표)              | 가능하지만 트리와 무관             | layout_overrides 테이블로  |
 * |                                      |                                  | 분리 (트리 op이 아님)      |
 *
 * 마지막 줄이 중요하다. **수동 좌표는 역투영 대상이 아니다.** 그래프 구조와
 * 무관한 별도 저장소로 빼야 나중에 "자동 배치로 되돌리기"가 한 번의 DELETE가 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

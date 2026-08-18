/**
 * packages/layout-core/src/build.ts — LAYOUT §4.1 · §7.2 · L-05
 *
 * `LayoutInput` → ELK 입력 그래프.
 *
 * **여기와 read.ts만이 ELK의 형태를 안다.** 둘 다 `elkjs`를 import 하지 않고
 * types.ts의 구조적 타입만 쓴다. 언젠가 ELK를 갈아치울 때 건드릴 파일이 이 둘뿐인
 * 이유이고, OG 카드 라우트에 500KB가 들어오지 않는 이유다 (§14.2).
 */

import { optionsFor } from './options.ts';
import { isPill, sizeOf } from './fallback.ts';
import { NODE_H, NODE_W } from './types.ts';
import type { ElkExtendedEdge, ElkNode, LayoutInput } from './types.ts';
import { toLayoutEdges } from '@workflow/graph-core';
import type { DerivedNode, NodeId } from '@workflow/graph-core';

/**
 * 명시 그룹 컨테이너 (§7.2).
 *
 * 기본값 `SEPARATE_CHILDREN`은 자식 그래프를 독립적으로 배치한 뒤 부모 층위에
 * 박스로 끼워 넣어서 그룹 경계에서 흐름이 끊긴다. `INCLUDE_CHILDREN`은 계층 경계를
 * **가로질러** 층을 배정하므로 사용자에게 "선이 박스를 통과해 계속 흐른다"로 보인다.
 *
 * 헤더("영업팀 · 6단계") 자리는 padding top 36으로 확보한다. 이 값이 바뀌면
 * 그룹 안팎이 전부 움직이므로 상수로 못 박는다.
 */
function containerNode(groupId: NodeId, kids: readonly ElkNode[]): ElkNode {
  return {
    id: groupId,
    children: kids,
    layoutOptions: {
      'elk.padding': '[top=36,left=20,bottom=20,right=20]',
      'elk.nodeSize.constraints': 'NODE_LABELS MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${NODE_W},${NODE_H})`,
    },
  };
}

function leafNode(n: DerivedNode): ElkNode {
  const { w, h } = sizeOf(n);
  // ★ layoutOptions에 좌표 시드를 넣지 않는다 (L-05 / D-101).
  //   forceNodeModelOrder가 semiInteractive를 지배해서 출력이 비트 단위로 동일하고,
  //   "증분 레이아웃을 하고 있다"는 착시만 만든다.
  return { id: n.id, width: w, height: h };
}

export function buildElkGraph(input: LayoutInput): ElkNode {
  const { graph, containers } = input;

  // 모델 순서 = children 배열 순서. `considerModelOrder`가 이걸 그대로 읽는다 (§5.1).
  const ordered = [...graph.nodes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  const memberOf = new Map<NodeId, NodeId>();
  for (const [groupId, kids] of containers) for (const k of kids) memberOf.set(k, groupId);

  const leaves = new Map<NodeId, ElkNode>(ordered.map((n) => [n.id, leafNode(n)]));

  const children: ElkNode[] = [];
  const emittedGroup = new Set<NodeId>();
  for (const n of ordered) {
    const groupId = memberOf.get(n.id);
    if (!groupId) {
      children.push(leaves.get(n.id)!);
      continue;
    }
    if (emittedGroup.has(groupId)) continue;
    emittedGroup.add(groupId);
    // 컨테이너는 **자식들만** 감싼다. 부모 노드는 컨테이너 밖 위쪽에 남는다 —
    // 그러지 않으면 컨테이너로 들어가는 엣지의 출발점이 컨테이너 자신이 되어
    // 라우팅이 이상해진다 (§7.2).
    const kids = (containers.get(groupId) ?? [])
      .map((k) => leaves.get(k))
      .filter((k): k is ElkNode => !!k);
    children.push(containerNode(groupId, kids));
  }

  // back edge는 sources/targets가 뒤집혀 나온다. **뒤집힌 채로 계층 배치에 참여시킨다** —
  // 그래야 ELK가 진짜 target을 위쪽 층에 놓고 그 사이 층에 루프가 지나갈 여유를 만든다.
  // 아예 빼면 루프의 시작과 끝이 서로 무관한 위치에 놓여 레일이 화면을 가로지른다 (§4.1).
  const edges: ElkExtendedEdge[] = toLayoutEdges(graph.edges)
    .filter((e) => e.sources[0] !== e.targets[0])
    .map((e) => ({
      id: e.id,
      sources: [e.sources[0]],
      targets: [e.targets[0]],
      // 라벨은 넘기지 않는다 (L-01). `labels` 필드 자체를 만들지 않는다 —
      // 넘기는 순간 elk.spacing.edgeLabel이 라벨 폭에 반응해
      // "갈래 조건 타이핑 = 재배치"가 된다. D-024 정면 위반.
    }));

  return {
    id: 'root',
    layoutOptions: {
      ...optionsFor(input.ladder),
      // 팬아웃 스택 모드: 갈래 5개 이상에서 폭 대신 높이를 쓴다 (DESIGN §6.5)
      ...(input.fanOutStack ? { 'elk.layered.nodePlacement.strategy': 'SIMPLE' } : {}),
    },
    children,
    edges,
  };
}

/** 진단용 — 이 그래프가 pill로 다루는 노드들 */
export function pillIds(input: LayoutInput): NodeId[] {
  return input.graph.nodes.filter(isPill).map((n) => n.id);
}

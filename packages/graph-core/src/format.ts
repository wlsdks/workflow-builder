/**
 * packages/graph-core/src/format.ts
 *
 * 골든 픽스처와 디버깅을 위한 결정적 텍스트 덤프.
 *
 * 스냅샷 파일(.snap)을 쓰지 않는 이유: 스냅샷은 **아무도 안 읽는다.**
 * 기대값을 사람이 손으로 적고 ASCII 다이어그램 주석과 나란히 두어야
 * "규칙이 바뀐 것"과 "규칙이 깨진 것"을 리뷰에서 구분할 수 있다.
 */

import type { DerivedGraph } from './types.ts';

/** `a:task`, `join:B:join` */
export function formatNodes(g: DerivedGraph): string[] {
  return g.nodes.map((n) => `${n.id}:${n.kind}`);
}

/**
 * `source -reason(label)-> target`
 * 명시적 엣지는 `=>`, back edge는 뒤에 ` ↺`.
 */
export function formatEdges(g: DerivedGraph): string[] {
  return g.edges.map((e) => {
    const label = e.label ? `(${e.label})` : '';
    const arrow = e.origin === 'explicit' ? '=>' : '->';
    const back = e.isBackEdge ? ' ↺' : '';
    return `${e.source} -${e.reason}${label}${arrow} ${e.target}${back}`;
  });
}

export function formatGraph(g: DerivedGraph): string {
  return [
    'nodes:',
    ...formatNodes(g).map((s) => '  ' + s),
    'edges:',
    ...formatEdges(g).map((s) => '  ' + s),
  ].join('\n');
}

/** 진단 코드만 정렬해 반환 — 픽스처에서 "무엇이 복구됐는가"를 고정한다 */
export function formatDiagnostics(g: DerivedGraph): string[] {
  return [...new Set(g.diagnostics.map((d) => `${d.severity}:${d.code}`))].sort();
}

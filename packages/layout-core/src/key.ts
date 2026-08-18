/**
 * packages/layout-core/src/key.ts — LAYOUT §2.1 · L-10 · D-105
 *
 * `layoutKey = topologyHash ⊕ containerHash ⊕ collapsedHash ⊕ fanOutStack ⊕ ladder ⊕ optionsHash`
 *
 * `topologyHash`만으로는 접기·컨테이너·팬아웃·옵션 변경을 못 잡는다.
 * `topologyHash`는 **그래프**의 해시지 **레이아웃 입력**의 해시가 아니다.
 */

import { fnv1a } from './hash.ts';
import { optionsHash } from './options.ts';
import type { LayoutInput, LayoutKey } from './types.ts';

/** 컨테이너: 그룹 → 자식 목록. 정렬해서 Map 순회 순서에 의존하지 않게 한다 */
export function containerHash(containers: LayoutInput['containers']): string {
  return [...containers]
    .map(([g, kids]) => `${g}{${[...kids].sort().join(',')}}`)
    .sort()
    .join(';');
}

export function collapsedHash(collapsed: LayoutInput['collapsed']): string {
  return [...collapsed].sort().join(',');
}

/**
 * 키의 성분을 **따로 꺼낼 수 있게** 한다.
 * gate.ts가 "무엇이 달라져서 재배치가 필요한가"를 답하려면 성분별 비교가 필요하고,
 * 그 답이 `canvas_layout_computed`의 진단을 가능하게 한다 (부록 A).
 */
export type LayoutKeyParts = {
  readonly topology: string;
  readonly containers: string;
  readonly collapsed: string;
  readonly fanOut: string;
  readonly ladder: string;
  readonly options: string;
};

export function layoutKeyParts(input: LayoutInput): LayoutKeyParts {
  return {
    topology: input.graph.topologyHash,
    containers: containerHash(input.containers),
    collapsed: collapsedHash(input.collapsed),
    fanOut: input.fanOutStack ? 'S' : '-',
    ladder: String(input.ladder),
    options: optionsHash(),
  };
}

export function layoutKeyOfParts(p: LayoutKeyParts): LayoutKey {
  return fnv1a([p.topology, p.containers, p.collapsed, p.fanOut, p.ladder, p.options].join('|')) as LayoutKey;
}

export function layoutKeyOf(input: LayoutInput): LayoutKey {
  return layoutKeyOfParts(layoutKeyParts(input));
}

/**
 * packages/layout-core/src/options.ts — LAYOUT §2.1 · §6.2
 *
 * ELK 옵션은 **문자열 딕셔너리**다. elkjs 타입을 import 하지 않는다.
 * 옵션표 자체는 DESIGN §6.5가 소유한다 — 여기서 재서술하지 않고 그대로 옮긴다.
 */

import { fnv1a } from './hash.ts';
import type { LadderLevel } from './types.ts';

/**
 * DESIGN §6.5의 확정 옵션.
 *
 * 여기서 새로 **추가**된 것은 `cycleBreaking.strategy`뿐이다 (LAYOUT §4.1).
 * 우리가 이미 결정적으로 사이클을 끊어 넘기므로 발동하지 않지만,
 * graph-core가 놓친 사이클이 하나라도 있으면 ELK가 무작위 휴리스틱 대신
 * **모델 순서 기준**으로 끊는다.
 */
export const ELK_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.thoroughness': '7',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.spacing.edgeNode': '24',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
} as const;

/**
 * 사다리 단계가 옵션에 반영되는 유일한 지점 (§6.2).
 * L3(자동 접기)은 옵션이 아니라 **입력**(`collapsed`)을 바꾸므로 여기에 없다.
 */
export function optionsFor(ladder: LadderLevel): Record<string, string> {
  const o: Record<string, string> = { ...ELK_OPTIONS };
  if (ladder >= 1) o['elk.layered.thoroughness'] = '3';
  if (ladder >= 2) o['elk.edgeRouting'] = 'POLYLINE';
  return o;
}

/**
 * elkjs 버전 문자열을 **손으로 적지 않는다** (§2.1).
 * 손으로 적은 버전은 반드시 실제 버전과 어긋난다. 앱이 빌드 타임에 주입한다.
 * layout-core는 `process`를 모르므로(순수 계약) 기본값은 `unknown`이고,
 * 앱이 `setElkVersion()`으로 한 번 못 박는다.
 */
let elkVersion = 'unknown';
/** 빌더 자신의 버전. build.ts의 출력 형태가 바뀌면 손으로 올린다 */
const BUILDER_VERSION = 3;

export function setElkVersion(v: string): void {
  elkVersion = v;
}

/** 옵션 객체 + elkjs 버전 + 빌더 버전. 셋 중 하나만 바뀌어도 캐시가 무효화된다 */
export function elkOptionsHash(ladder: LadderLevel = 0): string {
  return fnv1a(`${JSON.stringify(optionsFor(ladder))}|elkjs@${elkVersion}|builder@${BUILDER_VERSION}`);
}

/**
 * `layoutKey`에 들어가는 옵션 성분.
 *
 * ladder는 `layoutKeyOf`가 **따로** 넣으므로 여기서는 사다리 0 기준으로만 잡는다
 * — 그래야 "옵션 변경"과 "사다리 변경"이 키에서 구분되어 진단이 가능하다.
 */
export function optionsHash(): string {
  return elkOptionsHash(0);
}

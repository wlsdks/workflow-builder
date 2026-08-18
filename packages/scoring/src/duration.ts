/**
 * packages/scoring/src/duration.ts — 밴드 → 시간 환산.
 *
 * 점추정은 **graph-core의 `BAND_HOURS`와 같은 값이어야 한다.**
 * 캔버스에 보이는 숫자와 리포트의 숫자가 다르면 그 순간 신뢰가 끝난다.
 *
 * 그런데 이 패키지는 graph-core를 런타임으로 물지 않는다(의존성 0 유지).
 * 그래서 값을 복제하고, **테스트가 원본과 대조한다** — 두 벌 관리를 사람 기억이
 * 아니라 CI에 맡긴다. golden.test.ts의 「BAND_HOURS 동기화」가 그 테스트다.
 *
 * 구간(BAND_RANGE_H)은 ANALYTICS-ENGINE §2.1이 새로 정의한 것이라 여기가 정본이다.
 */

import type { DurationBand } from './types.ts';

/** PRD §4.5 로그 스케일 버킷 → 시간 (graph-core `BAND_HOURS` 사본) */
export const BAND_HOURS: Record<DurationBand, number> = {
  '1m': 1 / 60,
  '5m': 5 / 60,
  '15m': 0.25,
  '1h': 1,
  halfday: 4,
  '1d+': 8,
};

/**
 * 불확실성 구간. 반드시 `BAND_HOURS[b] ∈ [lo, hi]`를 만족한다 (테스트로 강제).
 *
 * `1d+`의 상한 16h는 **"상한 없음을 2일로 자른 것"** 이다. 무한대는 계산 불가이고,
 * 1건에 3일 붙는 업무는 밴드가 아니라 별도 문서로 쪼개져야 한다.
 */
export const BAND_RANGE_H: Record<DurationBand, readonly [number, number]> = {
  '1m': [0.5 / 60, 3 / 60],
  '5m': [3 / 60, 10 / 60],
  '15m': [10 / 60, 30 / 60],
  '1h': [0.5, 2],
  halfday: [2, 6],
  '1d+': [6, 16],
};

/** 밴드 사이의 거리 — 동료 합의 판정(±1밴드)에 쓴다 */
export const BAND_ORDER: readonly DurationBand[] = ['1m', '5m', '15m', '1h', 'halfday', '1d+'];

export function bandDistance(a: DurationBand, b: DurationBand): number {
  return Math.abs(BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
}

/**
 * 스코프 안의 한 단계. graph-core `perNode`의 부분집합을 **숫자로만** 받는다.
 *
 * `touchH`가 있으면 그것을 쓴다 — graph-core가 이미 계산한 값이 정본이고,
 * 여기서 밴드를 다시 환산하면 두 벌의 정의가 생긴다.
 */
export type ScopeStep = {
  id: string;
  band: DurationBand | null;
  /** graph-core `perNode.touchH`. 없으면 밴드에서 환산한다 */
  touchH?: number;
  /** XOR 갈래 확률. AND 갈래는 1 */
  reachProbability: number;
  /** 재작업 루프의 기대 통과 횟수 (≥ 1) */
  expectedPasses: number;
  /** 합성 노드(start/end/join)는 제외 대상 */
  synthetic?: boolean;
  /** 소요시간을 물어볼 수 있는 단계인가 (task | hold) */
  isStep?: boolean;
};

/**
 * 기대 실접촉시간 = Σ p·k·touch.
 *
 * ★ 병렬 구간을 여기서 해석하지 않는다. graph-core가 이미
 *   AND = 합산 · XOR = 확률가중으로 계산했고, 후보 스코프는 그 항들의 부분합이다.
 *   여기서 AND를 다시 해석하려 들면 두 벌의 정의가 생기고 반드시 어긋난다.
 */
export function scopeTouchH(steps: readonly ScopeStep[]): number {
  let sum = 0;
  for (const s of steps) {
    if (s.synthetic) continue;
    const t = s.touchH ?? (s.band ? BAND_HOURS[s.band] : 0);
    sum += s.reachProbability * s.expectedPasses * t;
  }
  return sum;
}

/** 같은 스코프의 [하한, 상한]. 밴드 구간을 그대로 밀어 넣는다 */
export function scopeTouchRangeH(steps: readonly ScopeStep[]): readonly [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of steps) {
    if (s.synthetic || !s.band) continue;
    const w = s.reachProbability * s.expectedPasses;
    const [a, b] = BAND_RANGE_H[s.band];
    lo += w * a;
    hi += w * b;
  }
  return [lo, hi];
}

/** 커버리지 = 스코프 안의 단계 중 소요시간이 실제로 채워진 비율 */
export function scopeTouchCoverage(steps: readonly ScopeStep[]): number {
  let total = 0;
  let filled = 0;
  for (const s of steps) {
    if (s.synthetic || s.isStep === false) continue;
    total++;
    if (s.band != null) filled++;
  }
  return total === 0 ? 0 : filled / total;
}

/**
 * packages/layout-core/src/jump.ts — LAYOUT §13.1
 *
 * `jump_score` — 이 문서의 KPI다. MEASUREMENT.md의 정의를 구현 가능한 수준까지 좁힌다.
 *
 *   직전 레이아웃 대비 **생존 노드**의 평균 이동거리(화면 px) ÷ 화면 대각선
 *   목표: p90 < 0.15
 *
 * 세 가지 결정:
 *
 * | 결정 | 이유 |
 * |---|---|
 * | 생존 노드만 센다 | 새 노드는 "생성 애니메이션"이지 "점프"가 아니다. 포함시키면 문서를 키울 때마다 점수가 나빠져 지표가 무의미해진다 |
 * | 화면 px / 화면 대각선 | 줌 무관 정규화가 자동으로 된다. 월드 좌표로 재면 줌아웃 상태에서 실제로는 안 흔들리는데 점수가 나쁘게 나온다 |
 * | 앵커 보정 **후**를 KPI로 | 사용자가 지각하는 것이 그것이다. 보정 전(`jump_score_world`)은 원인 분해용으로 별도 계측 (§5.4) |
 */

import type { AnchorDecision, LayoutResult, Rect, XY } from './types.ts';

export type JumpArgs = {
  /** 화면 대각선 계산용. 벤치에서는 1440×900 @ z=1로 고정 */
  readonly viewport: { readonly zoom: number; readonly w: number; readonly h: number };
  /** 앵커 보정으로 캔버스가 이동한 **월드** 거리. 보정 전 점수를 원하면 {0,0} */
  readonly translate: XY;
};

export const ZERO: XY = { x: 0, y: 0 };

export function jumpScore(prev: LayoutResult | null, next: LayoutResult, a: JumpArgs): number {
  if (!prev) return 0; // 최초 레이아웃은 점프가 아니다
  const diag = Math.hypot(a.viewport.w, a.viewport.h); // **화면 px**
  if (diag === 0) return 0;

  let sum = 0;
  let n = 0;
  for (const [id, p1] of next.nodes) {
    const p0 = prev.nodes.get(id);
    if (!p0) continue; // ★ 생존 노드만
    const dx = (p1.x - p0.x - a.translate.x) * a.viewport.zoom;
    const dy = (p1.y - p0.y - a.translate.y) * a.viewport.zoom;
    sum += Math.hypot(dx, dy);
    n++;
  }
  return n === 0 ? 0 : sum / n / diag;
}

/** 앵커 결정에서 보정 벡터를 꺼낸다. translate가 아니면 보정이 없다 */
export function translateOf(decision: AnchorDecision): XY {
  return decision.t === 'translate' ? decision.delta : ZERO;
}

/**
 * `bboxDelta`는 면적비가 아니라 **폭·높이 각각의 상대 변화 중 최대값**이다.
 *
 * 면적비를 쓰면 폭이 30% 줄고 높이가 30% 늘어난 경우 — 즉 사용자가 가장 크게
 * 놀라는 경우 — 를 0%로 계산해 버린다.
 */
export function bboxDelta(a: Rect, b: Rect): number {
  const dw = Math.abs(b.w - a.w) / Math.max(a.w, 1);
  const dh = Math.abs(b.h - a.h) / Math.max(a.h, 1);
  return Math.max(dw, dh);
}

/**
 * packages/layout-core/src/geometry.ts — LAYOUT §4.2
 *
 * 순수 기하 유틸. 화면·ELK·그래프를 모른다. 좌표와 사각형만 안다.
 */

import type { LayerBand, NodePlacement, Rect, XY } from './types.ts';

export const EPS = 1e-6;

export function len(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function unit(from: XY, to: XY): XY {
  const d = len(from, to);
  return d < EPS ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

/**
 * 직교 폴리라인 → 코너가 둥근 SVG path. r은 인접 선분 길이의 절반으로 자동 클램프.
 *
 * `Q`(2차 베지어)를 쓰는 건 직교 코너에서 원호와 시각적으로 구분되지 않으면서
 * path 문자열이 짧기 때문이다. 500노드 × 평균 4코너면 path 길이가 곧 메모리이자
 * 내보내기 SVG 용량이다.
 */
export function orthPath(pts: readonly XY[], r = 12): string {
  if (pts.length < 2) return '';
  const first = pts[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const rr = Math.min(r, len(a, b) / 2, len(b, c) / 2);
    const ua = unit(b, a);
    const uc = unit(b, c);
    d += ` L ${b.x + ua.x * rr} ${b.y + ua.y * rr}`;
    d += ` Q ${b.x} ${b.y} ${b.x + uc.x * rr} ${b.y + uc.y * rr}`;
  }
  const e = pts[pts.length - 1]!;
  return `${d} L ${e.x} ${e.y}`;
}

/** 연속된 같은 점 / 일직선 위의 중간점을 제거한다. 폴리라인 비교를 안정화한다 */
export function simplifyPolyline(pts: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const collinearV = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const collinearH = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    if (collinearV || collinearH) out.splice(i, 1);
  }
  return out;
}

/**
 * 층 밴드 — ELK 결과의 y값을 클러스터링해 만든다.
 *
 * `layer` 필드는 이 밴드 인덱스로 되채운다. ELK가 층 번호를 직접 주지 않으므로
 * 기하에서 역산하는 게 더 견고하다 — **폴백 레이아웃에서도 같은 함수가 쓰인다.**
 */
export function layerBands(nodes: Iterable<NodePlacement>): LayerBand[] {
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Array<{ top: number; bottom: number }> = [];
  for (const n of sorted) {
    const last = bands[bands.length - 1];
    // 새 층의 시작 = 이전 밴드 하단보다 아래에서 시작하는 노드
    if (!last || n.y >= last.bottom) bands.push({ top: n.y, bottom: n.y + n.h });
    else last.bottom = Math.max(last.bottom, n.y + n.h);
  }
  return bands.map((b, index) => ({ index, top: b.top, bottom: b.bottom }));
}

export function bandIndexOf(bands: readonly LayerBand[], p: NodePlacement): number {
  for (const b of bands) if (p.y >= b.top - EPS && p.y + p.h <= b.bottom + EPS) return b.index;
  // 밴드 밖(있을 수 없지만): 가장 가까운 밴드
  let best = 0;
  let bestD = Infinity;
  for (const b of bands) {
    const d = Math.abs((b.top + b.bottom) / 2 - (p.y + p.h / 2));
    if (d < bestD) {
      bestD = d;
      best = b.index;
    }
  }
  return best;
}

export function bboxOf(rects: Iterable<Rect>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + a.w - tolerance > b.x + tolerance &&
    b.x + b.w - tolerance > a.x + tolerance &&
    a.y + a.h - tolerance > b.y + tolerance &&
    b.y + b.h - tolerance > a.y + tolerance
  );
}

/**
 * 축 정렬 선분이 사각형의 **내부**를 지나는가.
 *
 * 경계에 닿는 것은 관통이 아니다 — 엣지는 노드의 상/하단 경계에서 시작하고 끝난다.
 * `inset`만큼 사각형을 줄여서 판정하므로, 경계 접촉은 통과하고 실제 침범만 잡힌다.
 */
export function segmentEntersRect(a: XY, b: XY, r: Rect, inset: number): boolean {
  const rx0 = r.x + inset;
  const ry0 = r.y + inset;
  const rx1 = r.x + r.w - inset;
  const ry1 = r.y + r.h - inset;
  if (rx1 <= rx0 || ry1 <= ry0) return false;

  const sx0 = Math.min(a.x, b.x);
  const sx1 = Math.max(a.x, b.x);
  const sy0 = Math.min(a.y, b.y);
  const sy1 = Math.max(a.y, b.y);

  // 축 정렬 선분의 AABB와 축소된 사각형이 겹치면 = 내부를 지난다.
  // (선분이 축 정렬이라 AABB가 곧 선분이므로 이 판정이 정확하다.)
  return sx1 > rx0 + EPS && rx1 > sx0 + EPS && sy1 > ry0 + EPS && ry1 > sy0 + EPS;
}

/** 폴리라인의 인접 점 쌍 */
export function* segments(pts: readonly XY[]): Generator<readonly [XY, XY]> {
  for (let i = 0; i + 1 < pts.length; i++) yield [pts[i]!, pts[i + 1]!] as const;
}

export function isAxisAligned(a: XY, b: XY): boolean {
  return Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo]!;
  const b = s[hi]!;
  return a + (b - a) * (pos - lo);
}

/**
 * packages/graph-core/src/util.ts
 *
 * 의존성 없는 순수 유틸. Date.now() / Math.random() 금지 — 결정성이 계약이다.
 */

/** FNV-1a 32bit. 암호학적 용도 아님. 위상 해시 전용 */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 부동소수 잡음 제거. 메트릭 비교/스냅샷 안정성용 */
export function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f + Number.EPSILON) / f;
}

export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

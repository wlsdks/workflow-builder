/**
 * packages/layout-core/src/hash.ts
 *
 * FNV-1a 32bit. graph-core의 `hash32`와 **의도적으로 중복된 8줄**이다
 * (LAYOUT §14.1). 이걸 공유하려고 graph-core의 배럴에 유틸을 노출시키면
 * 패키지 경계가 "타입 + toLayoutEdges" 셋에서 넷으로 늘어난다.
 * 8줄이 경계 하나보다 싸다.
 */

export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

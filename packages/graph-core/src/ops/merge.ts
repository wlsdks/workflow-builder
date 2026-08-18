/**
 * packages/graph-core/src/ops/merge.ts
 *
 * SYNC.md §2.5 — 한 줄 제목 전용 3-way 병합 (D-110).
 *
 * diff-match-patch를 쓰지 않는 이유: (a) graph-core 런타임 의존성 0 (D-119)
 * (b) 제목은 평균 20자라 공통 접두/접미 한 번이면 충분하다
 * (c) 결정성이 눈으로 검증 가능해야 한다.
 *
 * 규칙: 양쪽이 base에서 **서로 겹치지 않는 구간**을 고쳤으면 둘 다 살린다. 겹치면 실패.
 * 실패는 오류가 아니라 §5.3의 "두 내용 모두 남겨두기"로 가는 입구다.
 *
 *   base = "견적서 작성", 내가 "견적서 작성해서 발송", 동료가 "매월 견적서 작성"
 *     → 겹치지 않음 → "매월 견적서 작성해서 발송". 사용자는 아무것도 보지 않는다
 *   base = "견적서 작성", 내가 "견적서 검토", 동료가 "견적서 승인"
 *     → 같은 구간 → 실패 → 두 내용 모두 보관
 */

export type Merge3 =
  /** silent=true면 사용자에게 아무것도 알리지 않는다 */
  | { ok: true; text: string; silent: boolean }
  | { ok: false; reason: 'overlap' };

export function merge3(base: string, mine: string, theirs: string): Merge3 {
  if (mine === theirs) return { ok: true, text: mine, silent: true };
  if (mine === base) return { ok: true, text: theirs, silent: true };
  if (theirs === base) return { ok: true, text: mine, silent: true };

  const a = region(base, mine);
  const b = region(base, theirs);

  const aFirst = a.end <= b.start;
  const bFirst = b.end <= a.start;

  /**
   * ★ 명세에 없는 분기. 양쪽이 **같은 지점에 순수 삽입**만 했으면 두 조건이 동시에 참이 되고,
   *   명세 코드는 먼저 걸리는 가지(a 우선)를 택한다. 그러면
   *   `merge3(b,x,y).text !== merge3(b,y,x).text`가 되어 P7(대칭성)이 깨지고,
   *   **두 클라이언트가 서로 다른 문장으로 수렴한다.**
   *   삽입 텍스트의 바이트 순서로 결정적 타이브레이크를 넣는다.
   */
  if (aFirst && bFirst) {
    const [first, second] = a.text <= b.text ? [a, b] : [b, a];
    return {
      ok: true,
      silent: false,
      text: base.slice(0, a.start) + first.text + second.text + base.slice(a.end),
    };
  }

  if (aFirst) {
    return {
      ok: true,
      silent: false,
      text: base.slice(0, a.start) + a.text + base.slice(a.end, b.start) + b.text + base.slice(b.end),
    };
  }
  if (bFirst) {
    return {
      ok: true,
      silent: false,
      text: base.slice(0, b.start) + b.text + base.slice(b.end, a.start) + a.text + base.slice(a.end),
    };
  }
  return { ok: false, reason: 'overlap' };
}

type Region = { start: number; end: number; text: string };

/** base에서 next로 바뀐 최소 구간. 공통 접두 + 공통 접미를 한 번씩만 본다 */
function region(base: string, next: string): Region {
  const max = Math.min(base.length, next.length);
  let p = 0;
  while (p < max && base.charCodeAt(p) === next.charCodeAt(p)) p++;
  // 서러게이트 페어를 반으로 쪼개지 않는다 (이모지·일부 한자)
  if (p > 0 && isLowSurrogate(base.charCodeAt(p))) p--;
  let s = 0;
  while (s < max - p && base.charCodeAt(base.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  if (s > 0 && isHighSurrogate(base.charCodeAt(base.length - s))) s--;
  return { start: p, end: base.length - s, text: next.slice(p, next.length - s) };
}

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * packages/paste-parse/src/lossless.ts  (PARSING §10.4)
 *
 * **이 문서에서 가장 중요한 함수.**
 *
 * 불변식: `items[].sourceRange` ∪ `dropped[].range` ∪ `unparsedTailRange`는 서로 겹치지 않고,
 * 그 사이의 빈틈은 **공백 문자뿐**이다. ⇒ 어떤 문자도 "설명되지 않은 채 사라지지" 않는다.
 *
 * 주석이 아니라 **런타임 assert**다. 개발·운영 양쪽에서 돈다. 비용은 O(N) 한 번이다.
 * 실패하면 파싱 결과를 통째로 버리고 "원문 1덩어리" 폴백으로 내려간다.
 * **틀리게 나누느니 안 나눈다.**
 */

import type { ParseResult, Span } from './types.ts';
import { MARKERS } from './lines.ts';

export type LossCode = 'overlap' | 'gap' | 'tail' | 'title_drift' | 'oob';

export class LossError extends Error {
  readonly code: LossCode;
  readonly at: number;

  constructor(code: LossCode, at: number) {
    super(`lossless violation: ${code} at ${at}`);
    this.name = 'LossError';
    this.code = code;
    this.at = at;
  }
}

/** 제목에서 지워도 되는 것들 — 마커·멘션 프리픽스 (§11 읽는 법: sourceRange는 마커를 포함한다) */
export function stripMarker(s: string): string {
  let t = s.replace(/^[\s　]+/, '');
  for (const m of MARKERS) {
    const ex = m.re.exec(t);
    if (ex) {
      t = t.slice(ex[0].length);
      break;
    }
  }
  return t.replace(/^@[가-힣A-Za-z][가-힣A-Za-z0-9._-]{0,20}\s*[:：]?\s*/, '');
}

/** 상한을 걸어 O(n·cap)로 자르는 편집거리 (§12.2) */
export function levenshteinCapped(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return Math.min(prev[b.length]!, cap + 1);
}

/** a가 b의 부분수열인가 — "지우기만 했는가"를 O(n)으로 답한다 */
function isSubsequence(a: string, b: string): boolean {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i++;
  return i === a.length;
}

/** 어미 보정이 바꿀 수 있는 꼬리의 상한 (§4.6 폐쇄표의 최장 치환) */
const ENDING_SLACK = 5;

export const TITLE_DRIFT_MAX = 0.25;

/**
 * 제목이 원문에서 유래했는가.
 *
 * ★ 명세의 원안은 편집거리 하나만 본다. 그러면 §11 F1-05처럼 **꼬리의 괄호 힌트를
 *   떼기만 한** 제목(`"… 조회한다. (약 10분)"` → `"… 조회한다"`)이 0.29로 걸려버린다.
 *   제목 생성이 하는 일은 두 가지뿐이다 — (a) 지우기, (b) §4.6 폐쇄 어미표 적용.
 *   그래서 **부분수열이면 통과**시키고, 아니면 원래대로 편집거리를 본다.
 *   § 13에서 LLM이 들어와도 이 검사가 그대로 환각 방어 장치가 된다.
 */
export function titleDrift(rawSpanText: string, title: string): number {
  // 마커 제거는 **허용**이지 의무가 아니다. 시퀀스 검증에서 강등된 가짜 마커(§3.2)는
  // 제목에 그대로 남는 것이 맞다 → 두 형태 모두와 대조한다
  const full = rawSpanText.replace(/\s+/g, '');
  const raw = stripMarker(rawSpanText).replace(/\s+/g, '');
  const ttl = title.replace(/\s+/g, '');
  if (ttl.length === 0) return 0;
  // (a) 지우기만 했다 → 통과. (b) 꼬리 ENDING_SLACK자만 어미표로 갈아끼웠다 → 통과.
  for (let k = 0; k <= Math.min(ENDING_SLACK, ttl.length); k++) {
    const stem = ttl.slice(0, ttl.length - k);
    if (isSubsequence(stem, full) || isSubsequence(stem, raw)) return 0;
  }
  return (
    Math.min(levenshteinCapped(raw, ttl, 8), levenshteinCapped(full, ttl, 8)) / Math.max(Math.min(raw.length, full.length), 1)
  );
}

export function assertLossless(orig: string, r: ParseResult): void {
  const spans: Span[] = [
    ...r.items.map((i) => i.sourceRange),
    ...r.dropped.map((d) => d.range),
    ...(r.unparsedTailRange ? [r.unparsedTailRange] : []),
  ].sort((a, b) => a[0] - b[0]);

  let pos = 0;
  for (const [s, e] of spans) {
    if (s < 0 || e > orig.length || s > e) throw new LossError('oob', s);
    if (s < pos) throw new LossError('overlap', s); // 구간이 겹치면 원문이 중복된다
    if (/\S/.test(orig.slice(pos, s))) throw new LossError('gap', pos); // ★ 설명되지 않은 문자
    pos = e;
  }
  if (/\S/.test(orig.slice(pos))) throw new LossError('tail', pos);

  for (const it of r.items) {
    if (titleDrift(orig.slice(it.sourceRange[0], it.sourceRange[1]), it.title) > TITLE_DRIFT_MAX) {
      throw new LossError('title_drift', it.sourceRange[0]);
    }
  }
}

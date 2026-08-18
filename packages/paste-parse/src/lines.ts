/**
 * packages/paste-parse/src/lines.ts  (PARSING §3.1 · §3.2 · §3.3 · §6.1)
 *
 * S3 라인 분할. 파이프라인이 여기서 한 번 `Line[]`으로 좁아진다 —
 * 부록 C 4번(HTML 붙여넣기)이 나중에 **대체 프론트엔드**로 붙을 수 있는 이유가 그것이다.
 */

import type { Detection, Line, Marker, MarkerClass, Span } from './types.ts';

export const HANGUL_ORDER = '가나다라마바사아자차카타파하';

const ROMAN_MAP: Record<string, number> = { Ⅰ: 1, Ⅱ: 2, Ⅲ: 3, Ⅳ: 4, Ⅴ: 5, Ⅵ: 6, Ⅶ: 7, Ⅷ: 8, Ⅸ: 9, Ⅹ: 10 };
const ROMAN_ASCII: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

export function romanValue(s: string): number {
  return ROMAN_MAP[s] ?? ROMAN_ASCII[s.toLowerCase()] ?? 0;
}

/**
 * 마커 표. **순서가 곧 우선순위다.**
 * `decimalMulti`가 `decimalDot`보다 먼저여야 `1.2.3`이 `1.`로 잘리지 않는다.
 */
export const MARKERS: readonly { cls: MarkerClass; re: RegExp; val?: (m: RegExpExecArray) => number }[] = [
  { cls: 'checkbox', re: /^[-*+]\s*\[\s*([ xX✓])\s*\]\s+/ },
  { cls: 'heading', re: /^(#{1,6})\s+/, val: (m) => m[1]!.length },
  { cls: 'step', re: /^(?:STEP|Step|step|단계)\s*(\d{1,2})\s*[.):]?\s+/, val: (m) => +m[1]! },
  { cls: 'decimalMulti', re: /^(\d{1,2}(?:[.\-]\d{1,2}){1,3})\.?\s+/, val: (m) => +m[1]!.split(/[.\-]/).pop()! },
  { cls: 'decimalWrap', re: /^\((\d{1,3})\)\s+/, val: (m) => +m[1]! },
  { cls: 'decimalParen', re: /^(\d{1,3})\)\s+/, val: (m) => +m[1]! },
  { cls: 'decimalDot', re: /^(\d{1,3})\.\s+/, val: (m) => +m[1]! },
  { cls: 'circledNum', re: /^([①-⑳])\s*/, val: (m) => m[1]!.charCodeAt(0) - 0x245f },
  { cls: 'circledHangul', re: /^([㉠-㉾])\s*/, val: (m) => m[1]!.charCodeAt(0) - 0x325f },
  { cls: 'hangulOrder', re: /^([가-하])[.)]\s+/, val: (m) => HANGUL_ORDER.indexOf(m[1]!) + 1 },
  { cls: 'roman', re: /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])[.)]\s+/, val: (m) => romanValue(m[1]!) },
  { cls: 'alpha', re: /^([a-zA-Z])[.)]\s+/, val: (m) => m[1]!.toLowerCase().charCodeAt(0) - 96 },
  { cls: 'bullet', re: /^([-*+•‣◦▪▫·※○●□■◇◆–—])\s+/ },
  { cls: 'arrow', re: /^([→⇒▶》])\s*/ },
];

const TAB_COLS = 4;

/** 탭=4열, 전각 공백=2열로 확장한 **시각적** 열 수 (§6.1) */
export function indentWidth(raw: string): number {
  let w = 0;
  for (const c of raw) w += c === '\t' ? TAB_COLS - (w % TAB_COLS) : c === '　' ? 2 : 1;
  return w;
}

export function matchMarker(body: string): Marker | null {
  for (const m of MARKERS) {
    const ex = m.re.exec(body);
    if (!ex) continue;
    return { cls: m.cls, raw: ex[0], value: m.val ? m.val(ex) : null, consumed: ex[0].length };
  }
  return null;
}

export function splitLines(work: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  let blank = 0;
  let i = 0;
  while (pos <= work.length) {
    let nl = work.indexOf('\n', pos);
    if (nl < 0) nl = work.length;
    const text = work.slice(pos, nl);
    if (text.trim().length === 0) {
      blank++;
    } else {
      const rawIndent = /^[\s　]*/.exec(text)![0];
      const body = text.slice(rawIndent.length);
      out.push({
        i: i++,
        span: [pos, nl],
        text,
        indentWidth: indentWidth(rawIndent),
        rawIndent,
        marker: matchMarker(body),
        blankBefore: blank,
      });
      blank = 0;
    }
    if (nl === work.length) break;
    pos = nl + 1;
  }
  return out;
}

/**
 * §3.2 — 마커는 개별 줄이 아니라 **"수열"로 검증한다.**
 *
 * `^([가-하])[.)]\s+`는 `"다. 확인 후 넘긴다"` 같은 평범한 문장을 마커로 오인할 수 있고,
 * 숫자 마커도 `"3. 5억 이상은…"`에서 오작동한다. 이 한 함수가 오탐의 대부분을 잡는다.
 * `bullet`·`checkbox`·`arrow`는 값이 없으므로 검증 대상이 아니다(수열 개념이 없다).
 *
 * @returns 강등된 마커 수 (부록 B `R1.demoted` — **오탐 감시의 핵심 지표**)
 */
export function validateMarkerRuns(lines: readonly Line[]): number {
  const byClass = new Map<MarkerClass, Line[]>();
  for (const l of lines) {
    if (l.marker?.value == null) continue;
    const arr = byClass.get(l.marker.cls) ?? [];
    arr.push(l);
    byClass.set(l.marker.cls, arr);
  }

  let demoted = 0;
  const demote = (ls: readonly Line[]) => {
    for (const l of ls) {
      if (l.marker && !l.marker.demoted) {
        l.marker.demoted = true;
        demoted++;
      }
    }
  };

  for (const [cls, ls] of byClass) {
    if (ls.length === 1) {
      // 단발 마커는 문맥으로만 인정한다.
      // ★ 명세 본문(§3.2)은 `"3. 5억 이상은"` 앞에 `2.`가 없으면 마커가 아니라고 했는데
      //   함께 실린 코드는 단발 숫자를 통과시킨다. 본문이 맞다 —
      //   **수열의 첫 항(1)이 아닌 단발 마커는 수열이 아니다.**
      if (cls === 'hangulOrder' || cls === 'alpha' || cls === 'roman' || ls[0]!.marker!.value !== 1) demote(ls);
      continue;
    }
    let ok = 0;
    for (let k = 1; k < ls.length; k++) {
      const p = ls[k - 1]!.marker!.value!;
      const c = ls[k]!.marker!.value!;
      if (c === p + 1) ok++;
      else if (c === 1 && ls[k]!.indentWidth !== ls[k - 1]!.indentWidth) ok++; // 하위 목록 재시작
      else if (c === p) ok += 0.5; // 워드 자동번호 붕괴 흔적
    }
    if (ok / (ls.length - 1) < 0.6) demote(ls); // ★ 수열이 아니면 마커가 아니다
  }
  return demoted;
}

/** 검증을 통과한 마커만 R1 경계가 된다 */
export const liveMarker = (l: Line): Marker | null => (l.marker && !l.marker.demoted ? l.marker : null);

const RE_CONT_TAIL = /(?:[,·、]|(?:[가-힣](?:고|서|며|면서|면|다가|는데|지만|여|어|아))|[을를이가은는와과의에도만로])$/;
const RE_TERMINAL_TAIL = /(?:[.!?…]|[다요음함임까죠네])\s*$/;

/**
 * §3.3 줄바꿈 복원 — R5 이전에 돈다.
 *
 * hwp·PDF·일부 메일 클라이언트에서 복사하면 문단 중간에 개행이 들어온다.
 * 이걸 안 되돌리면 **줄마다 단계가 생겨 최악의 과분할**이 난다.
 * `mergeLine`은 **구간을 잇기만 한다** — 두 줄 사이 개행 문자는 병합된 구간 안에
 * 그대로 들어 있다 → 무손실.
 */
export function rejoinWrapped(lines: readonly Line[], d: Detection, work: string): { lines: Line[]; rejoined: number } {
  if (!d.traits.has('wrapped')) return { lines: [...lines], rejoined: 0 };
  const out: Line[] = [];
  let rejoined = 0;
  for (const l of lines) {
    const prev = out[out.length - 1];
    const joinable =
      prev != null &&
      l.marker == null &&
      prev.marker?.cls !== 'heading' &&
      l.blankBefore === 0 &&
      !RE_TERMINAL_TAIL.test(prev.text) &&
      Math.abs(l.indentWidth - prev.indentWidth) <= 1 &&
      (RE_CONT_TAIL.test(prev.text.trim()) || prev.text.length >= d.meta.modalWidth * 0.9);
    if (joinable) {
      const span: Span = [prev.span[0], l.span[1]];
      out[out.length - 1] = { ...prev, span, text: work.slice(span[0], span[1]) };
      rejoined++;
      continue;
    }
    out.push(l);
  }
  return { lines: out, rejoined };
}

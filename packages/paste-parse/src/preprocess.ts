/**
 * packages/paste-parse/src/preprocess.ts  (PARSING §1.1 · §8)
 *
 * S1 정규화 + S4 노이즈 **표시**.
 *
 * 이 파일에서 지워지는 문자는 하나도 없다.
 *   - S1은 좌표를 잃지 않는 정규화다 (`TextMap`이 원문 좌표를 보존한다)
 *   - S4는 삭제가 아니라 두 등급의 **표시**다 (§8.1 strip / demote)
 *
 * ★ 순서 주의: 노이즈 표시는 **경계 판정 전에** 해야 헤더가 단계로 승격되지 않는다.
 */

import type { Detection, Dropped, DropReason, Line, Span } from './types.ts';
import { stdev } from './detect.ts';
import {
  RE_KAKAO_MOBILE, RE_KAKAO_PC, RE_KAKAO_SYS, RE_MAIL_ADDR, RE_MAIL_HEADER, RE_MAIL_ORIG, RE_MAIL_QUOTE,
  RE_MD_HEADING, RE_MINUTES_HEAD, RE_MINUTES_SEC, RE_PAGE_NUM, RE_SIGN_CLOSE, RE_SIGN_CONTACT, RE_SIGN_TITLE,
} from './detect.ts';
import { hasActionPredicate } from './lexicon/verbs.ts';

/* ────────────────────────────────────────────────────────────────────────────
 * §1.1 좌표를 잃지 않는 정규화
 * ──────────────────────────────────────────────────────────────────────────── */

const ZERO_WIDTH = /[​-‍⁠﻿­]/;
const JAMO = /[ᄀ-ᇿꥠ-꥿ힰ-퟿]/;
const JAMO_L = /[ᄀ-ᅟ]/;
const JAMO_V = /[ᅠ-ᆧ]/;
const JAMO_T = /[ᆨ-ᇿ]/;

/**
 * macOS에서 복사한 한글은 NFD(자모 분리)로 들어온다. `"확인"`이 2자가 아니라
 * 4~6 코드유닛이 된다. 정규화하지 않으면 모든 한글 정규식이 조용히 실패하고,
 * 그냥 정규화하면 `sourceRange`가 원문과 어긋난다. → 역인덱스맵을 들고 다닌다.
 */
export class TextMap {
  readonly orig: string;
  readonly work: string;
  /** work 인덱스 → orig 인덱스. 길이 = work.length + 1 (끝 경계 포함). null = 항등 사상 */
  private readonly idx: Int32Array | null;

  private constructor(orig: string, work: string, idx: Int32Array | null) {
    this.orig = orig;
    this.work = work;
    this.idx = idx;
  }

  /** work 좌표 구간 → 원문 좌표 구간 */
  toOrig(span: Span): Span {
    if (!this.idx) return [span[0], span[1]];
    return [this.idx[span[0]]!, this.idx[span[1]]!];
  }

  static of(orig: string): TextMap {
    // ── fast path: 손댈 게 없으면 배열조차 만들지 않는다 (입력의 99% 이상)
    if (!JAMO.test(orig) && !orig.includes('\r') && !ZERO_WIDTH.test(orig)) {
      return new TextMap(orig, orig, null);
    }
    const out: string[] = [];
    const idx: number[] = [];
    for (let i = 0; i < orig.length; ) {
      const c = orig[i]!;
      if (c === '\r') {
        // CRLF/CR → LF
        if (orig[i + 1] === '\n') {
          i++;
          continue;
        }
        out.push('\n');
        idx.push(i);
        i++;
        continue;
      }
      if (ZERO_WIDTH.test(c)) {
        i++;
        continue;
      }
      if (JAMO_L.test(c)) {
        // NFD 한글 음절 = L(+V)(+T)
        let j = i + 1;
        if (j < orig.length && JAMO_V.test(orig[j]!)) j++;
        if (j < orig.length && JAMO_T.test(orig[j]!)) j++;
        out.push(orig.slice(i, j).normalize('NFC'));
        idx.push(i);
        i = j;
        continue;
      }
      out.push(c);
      idx.push(i);
      i++;
    }
    idx.push(orig.length); // 끝 경계
    return new TextMap(orig, out.join(''), Int32Array.from(idx));
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * §8.2 노이즈 감지기 — 각 감지기는 Span만 반환한다
 * ──────────────────────────────────────────────────────────────────────────── */

export const RE_GREETING =
  /^\s*(?:안녕하세요[.!,~\s]*|수고\s?많으십니다[.!,\s]*|[가-힣]{1,8}(?:팀|부)?\s*[가-힣]{2,4}입니다[.!,\s]*|반갑습니다[.!,\s]*)$/;
export const RE_ACK =
  /^\s*(?:넵?|네{1,3}|예|웅|응|ㅇㅋ|오케이|확인했습니다|확인했어요|알겠습니다|알겠어요|감사합니다|ㄳ|굿|좋아요|👍|ok|OK)[.!~\s]*$/;
/**
 * §11 F3의 `"법인카드 정산은 아래 순서로 진행하시면 됩니다."`가 lead_in으로 버려지려면
 * 문두 앵커만으로는 부족하다. 앞에 주제어 3어절까지 허용한다 (수량자는 {0,3}으로 고정 — ReDoS 차단).
 */
export const RE_LEAD_IN =
  /^\s*(?:\S{1,20}\s){0,3}(?:아래|다음)(?:와\s?같이|\s?순서로|\s?내용)?\s*(?:참고|진행|확인)?(?:하시면\s?됩니다|해\s?주세요|드립니다|입니다)[.!\s]*$/;
export const RE_RULER = /^\s*(?:[-=_*~·—–]{3,}|[─━]{3,})\s*$/;
export const RE_EMOJI_ONLY = /^\s*(?:[ㅋㅎㅠㅜ]{1,}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]{1,5})\s*$/u;
export const RE_META_STAT = /(?:한\s?건에|보통|평균|대개|하루에|한\s?달에)\s?.{0,20}(?:분|시간|건|번).{0,12}(?:걸리|들|와요|옵니다|정도)/;
export const RE_SCHEDULE = /^\s*[-•]?\s*(?:다음|차기|next)\s?(?:회의|미팅|일정)\s*[:：]/i;
export const RE_DOC_TITLE_BRACKET = /^\s*[[【(]\s*\S[\s\S]{0,60}?\s*[\]】)]\s*$/;

const ACTION_SECTIONS = /(?:액션\s?아이템|Action\s?Items?|실행\s?항목|후속\s?조치|To-?Do|할\s?일|업무\s?분장|결정\s?사항)/i;
const CONTEXT_SECTIONS = /(?:논의\s?(?:내용|사항)|배경|현황|참고|공유\s?사항|이슈|안건|기타)/;

/** 화자 프리픽스 (타임스탬프+화자). **발화 본문은 절대 건드리지 않는다** (§2.4) */
export type ChatPrefix = { line: number; span: Span; speaker: string };

export function chatPrefixes(lines: readonly Line[]): ChatPrefix[] {
  const out: ChatPrefix[] = [];
  for (const l of lines) {
    const pc = RE_KAKAO_PC.exec(l.text);
    if (pc) {
      out.push({ line: l.i, span: [l.span[0], l.span[0] + pc[0].length], speaker: pc[2]!.trim() });
      continue;
    }
    const mo = RE_KAKAO_MOBILE.exec(l.text);
    if (mo) out.push({ line: l.i, span: [l.span[0], l.span[0] + mo[0].length], speaker: mo[1]!.trim() });
  }
  return out;
}

/**
 * §8.3 서명 꼬리 탐색 — 뒤에서 앞으로, 상한을 걸고.
 * 서명은 "위치 + 밀도"로만 안전하게 잡힌다. 정규식 하나로 잡으려 하면 본문을 먹는다.
 */
export function signatureTail(lines: readonly Line[], totalChars: number): Span[] {
  const last = lines.length - 1;
  if (last < 3) return [];
  const MAX_LINES = 8;
  const MAX_RATIO = 0.15; // 문서의 15% 넘게 서명일 수 없다

  let start = -1;
  for (let i = last; i >= Math.max(0, last - MAX_LINES); i--) {
    const t = lines[i]!.text.trim();
    if (!t) continue;
    const signalish =
      RE_SIGN_CONTACT.test(t) ||
      RE_MAIL_ADDR.test(t) ||
      RE_SIGN_TITLE.test(t) ||
      /^https?:\/\//.test(t) ||
      /^[가-힣]{2,4}$/.test(t) ||
      /(?:주식회사|㈜|Inc\.|Corp\.|Ltd\.)/.test(t) ||
      /^\s*(?:드림|올림|배상)\s*$/.test(t);
    if (!signalish) break; // ★ 본문을 만나면 즉시 멈춘다
    if (hasActionPredicate(t) && t.length > 12) break; // ★ 동작 문장이면 서명이 아니다
    start = i;
  }
  if (start < 0) return [];
  const span: Span = [lines[start]!.span[0], lines[last]!.span[1]];
  if ((span[1] - span[0]) / Math.max(1, totalChars) > MAX_RATIO) return []; // 상한 초과 → 포기
  return [span];
}

/**
 * §8.4 반복 헤더/푸터 — **간격 검증이 필수다.**
 * `hasActionPredicate` 가드와 간격 검증, 이 둘이 `"확인한다"`가 세 번 나온다고
 * 지워버리는 사고를 막는다.
 */
export function repeatedLines(lines: readonly Line[]): Span[] {
  const key = (t: string) => t.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const groups = new Map<string, number[]>();
  for (const l of lines) {
    const t = l.text.trim();
    if (!t || t.length > 40) continue;
    const k = key(t);
    const arr = groups.get(k) ?? [];
    arr.push(l.i);
    groups.set(k, arr);
  }

  const out: Span[] = [];
  for (const [, idxs] of groups) {
    if (idxs.length < 3) continue;
    const sample = lines.find((l) => l.i === idxs[0])!;
    if (hasActionPredicate(sample.text.trim())) continue; // ★ 동작 문장은 반복돼도 본문이다
    const gaps = idxs.slice(1).map((v, k) => v - idxs[k]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean < 5) continue; // 연속 반복은 목록이지 헤더가 아니다
    if (stdev(gaps) / mean > 0.35) continue; // 불규칙하면 본문
    for (const i of idxs) out.push(lines.find((l) => l.i === i)!.span);
  }
  return out;
}

export type NoiseInput = {
  lines: readonly Line[];
  work: string;
  detection: Detection;
  prefixes: readonly ChatPrefix[];
  /** 줄 번호 → 프리픽스를 뺀 본문 구간 */
  content: ReadonlyMap<number, Span>;
};

export type NoiseOutput = { dropped: Dropped[]; docTitleHint?: string };

const isStrip = (r: DropReason): boolean =>
  r === 'mail_header' || r === 'quoted' || r === 'signature' || r === 'chat_meta' || r === 'page_number' ||
  r === 'running_head' || r === 'separator' || r === 'minutes_header';

/** S4 — 노이즈 후보를 **표시**한다. 삭제하지 않는다 */
export function markNoise(input: NoiseInput): NoiseOutput {
  const { lines, work, detection, prefixes, content } = input;
  const traits = detection.traits;
  const out: Dropped[] = [];
  const claimed = new Set<number>(); // 줄 단위로 이미 처리된 것
  const push = (range: Span, reason: DropReason) => {
    if (range[1] <= range[0]) return;
    out.push({ range, reason, tier: isStrip(reason) ? 'strip' : 'demote' });
  };

  // ── 1. 대화 프리픽스 — 타임스탬프+화자만. 발화 본문은 건드리지 않는다 ─────────
  for (const p of prefixes) push(p.span, 'chat_meta');

  // ── 2. 메일 헤더 블록 (선두 연속 구간만) ────────────────────────────────────
  if (traits.has('mail_headered')) {
    for (const l of lines) {
      if (!RE_MAIL_HEADER.test(l.text)) break;
      push(l.span, 'mail_header');
      claimed.add(l.i);
    }
  }

  // ── 3. 인용 블록 (연속 줄을 한 덩어리로) ────────────────────────────────────
  if (traits.has('quoted')) {
    let block: Line[] = [];
    const flush = () => {
      if (block.length) push([block[0]!.span[0], block[block.length - 1]!.span[1]], 'quoted');
      for (const b of block) claimed.add(b.i);
      block = [];
    };
    for (const l of lines) {
      if (RE_MAIL_QUOTE.test(l.text)) block.push(l);
      else flush();
    }
    flush();
  }

  // ── 4. 서명 꼬리 (이미 버려진 줄은 빼고 본다) ───────────────────────────────
  const bodyLines = lines.filter((l) => !claimed.has(l.i));
  const totalChars = lines.reduce((a, l) => a + (l.span[1] - l.span[0]), 0);
  for (const s of signatureTail(bodyLines, totalChars)) {
    push(s, 'signature');
    for (const l of lines) if (l.span[0] >= s[0] && l.span[1] <= s[1]) claimed.add(l.i);
  }

  // ── 5. 줄 단위 확정 노이즈 ────────────────────────────────────────────────
  for (const l of lines) {
    if (claimed.has(l.i)) continue;
    const t = l.text.trim();
    if (RE_PAGE_NUM.test(t) && !/[가-힣A-Za-z]/.test(t)) {
      push(l.span, 'page_number');
      claimed.add(l.i);
    } else if (RE_RULER.test(t) || RE_MAIL_ORIG.test(t)) {
      push(l.span, 'separator');
      claimed.add(l.i);
    } else if (RE_MINUTES_HEAD.test(t)) {
      push(l.span, 'minutes_header');
      claimed.add(l.i);
    } else if (RE_KAKAO_SYS.test(t)) {
      push(l.span, 'chat_meta');
      claimed.add(l.i);
    }
  }

  // ── 6. 반복 머리말/꼬리말 ──────────────────────────────────────────────────
  for (const s of repeatedLines(lines.filter((l) => !claimed.has(l.i)))) {
    push(s, 'running_head');
    for (const l of lines) if (l.span[0] === s[0]) claimed.add(l.i);
  }

  // ── 7. 문서 제목 (첫 heading / 괄호 제목 1개) ──────────────────────────────
  let docTitleHint: string | undefined;
  const first = lines.find((l) => !claimed.has(l.i));
  if (first) {
    const t = first.text.trim();
    const isHeading = RE_MD_HEADING.test(t);
    const isBracket = RE_DOC_TITLE_BRACKET.test(t);
    if ((isHeading || isBracket) && !hasActionPredicate(t.replace(/^[[【(#\s]+|[\]】)\s]+$/g, ''))) {
      push(first.span, 'doc_title');
      claimed.add(first.i);
      // 여는 괄호로 시작한 제목만 닫는 괄호를 뗀다. `"온보딩 (인사팀)"`의 괄호는 제목의 일부다
      const stripped = t.replace(/^#{1,6}\s*/, '').trim();
      docTitleHint = isBracket ? stripped.replace(/^[[【(]\s*/, '').replace(/\s*[\]】)]$/, '').trim() : stripped;
    }
  }

  // ── 8. 섹션 게이팅 (§8.5) — trait.sectioned일 때만 켠다 ─────────────────────
  if (traits.has('sectioned')) {
    const heads = lines.filter((l) => !claimed.has(l.i) && RE_MINUTES_SEC.test(l.text));
    const hasAction = heads.some((h) => ACTION_SECTIONS.test(h.text));
    // **"확실히 액션이 어디 있는지 아는 경우에만" 나머지를 내린다**
    if (hasAction) {
      for (let k = 0; k < heads.length; k++) {
        const h = heads[k]!;
        const next = heads[k + 1];
        if (ACTION_SECTIONS.test(h.text)) {
          push(h.span, 'section_header');
          claimed.add(h.i);
          continue;
        }
        if (!CONTEXT_SECTIONS.test(h.text)) continue;
        const body = lines.filter((l) => l.i >= h.i && (next ? l.i < next.i : true) && !claimed.has(l.i));
        if (!body.length) continue;
        push([body[0]!.span[0], body[body.length - 1]!.span[1]], 'context_section');
        for (const b of body) claimed.add(b.i);
      }
    } else {
      for (const h of heads) {
        push(h.span, 'section_header');
        claimed.add(h.i);
      }
    }
  }

  // ── 9. 본문 구간 단위 demote (인사·확인·리드인·이모티콘·일정·메타통계) ───────
  for (const l of lines) {
    if (claimed.has(l.i)) continue;
    const span = content.get(l.i) ?? l.span;
    const t = work.slice(span[0], span[1]).trim();
    if (!t) continue;
    // ★ meta_stat은 **문장 단위** 감지기다. 줄 단위로 걸면 §11 F6처럼 세 문장 중
    //   한 문장만 통계인 줄이 통째로 사라진다 (그리고 G-a 롤백이 걸려 전부 되살아난다).
    const reason = textNoiseReason(t);
    if (reason && reason !== 'meta_stat') {
      push(span, reason);
      claimed.add(l.i);
    }
  }

  out.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  return docTitleHint == null ? { dropped: out } : { dropped: out, docTitleHint };
}

/**
 * 구간 텍스트 하나가 노이즈인가. **세그먼트 단위로도 다시 불린다** —
 * §11 F6처럼 한 줄 안의 세 번째 문장만 메타 통계인 경우가 있기 때문이다.
 */
export function textNoiseReason(t: string): DropReason | null {
  if (RE_GREETING.test(t)) return 'greeting';
  if (RE_ACK.test(t)) return 'ack';
  if (RE_SIGN_CLOSE.test(t)) return 'closing';
  if (RE_LEAD_IN.test(t)) return 'lead_in';
  if (RE_SCHEDULE.test(t)) return 'schedule';
  if (RE_EMOJI_ONLY.test(t)) return 'emoticon';
  if (RE_META_STAT.test(t)) return 'meta_stat';
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * §8.6 과잉 제거 방어 — 예산제 + 하드 가드
 * ──────────────────────────────────────────────────────────────────────────── */

export const NOISE_BUDGET = 0.35; // 원문 비공백 문자의 35%

const countNonWhitespace = (s: string): number => s.replace(/\s/g, '').length;

const REASON_ORDER: DropReason[] = [
  'mail_header', 'chat_meta', 'page_number', 'separator', 'running_head', 'minutes_header', 'quoted', 'signature',
];

/**
 * ★ 예산에서 빼는 두 가지.
 *
 * 카톡 내보내기는 **구조상** 40%가 타임스탬프+화자 프리픽스이고, 회신 메일은 헤더만으로
 * 20%를 넘긴다 (§11 F2·F3이 정확히 그렇다). 이 둘은 추정이 아니라 **줄 모양으로 확정되는
 * 메타**여서 본문일 수가 없다. 예산은 "본문을 잘못 지우는 것"을 막는 장치이므로,
 * 확정 메타가 예산을 다 먹고 진짜 위험한 감지기(서명·인용·반복 머리말)를 통과시키는
 * 결과가 되면 안 된다. → 확정 메타는 예산 밖에 두고, 예산은 추정 기반 제거에만 건다.
 */
const BUDGET_EXEMPT = new Set<DropReason>(['chat_meta', 'mail_header']);

export function applyNoise(cands: Dropped[], work: string): { kept: Dropped[]; overBudget: number } {
  const total = Math.max(1, countNonWhitespace(work));
  let list = cands;

  // 하드 가드 1: 문서 중앙 60% 구간의 signature/closing 은 strip 금지 → demote 강등
  for (const d of list) {
    const mid = (d.range[0] + d.range[1]) / 2 / Math.max(1, work.length);
    if (d.tier === 'strip' && (d.reason === 'signature' || d.reason === 'closing') && mid > 0.2 && mid < 0.8) {
      d.tier = 'demote';
    }
  }
  // 하드 가드 2: 인용이 문서의 80% 이상이면 **인용이 본문이다** → 인용 제거 전량 취소
  const quoted = list.filter((d) => d.reason === 'quoted').reduce((a, d) => a + countNonWhitespace(work.slice(...d.range)), 0);
  if (quoted / total > 0.8) list = list.filter((d) => d.reason !== 'quoted');

  // 예산: strip을 신뢰도 순으로 적용하다 예산을 넘으면 이후는 demote로 강등
  const rank = (r: DropReason) => {
    const i = REASON_ORDER.indexOf(r);
    return i < 0 ? REASON_ORDER.length : i;
  };
  let used = 0;
  let over = 0;
  for (const d of [...list].sort((a, b) => rank(a.reason) - rank(b.reason) || a.range[0] - b.range[0])) {
    if (BUDGET_EXEMPT.has(d.reason)) continue;
    const n = countNonWhitespace(work.slice(...d.range));
    if (d.tier === 'strip' && (used + n) / total > NOISE_BUDGET) {
      d.tier = 'demote';
      d.reason = 'over_budget';
      over += n;
      continue;
    }
    if (d.tier === 'strip') used += n;
  }
  return { kept: list, overBudget: over };
}

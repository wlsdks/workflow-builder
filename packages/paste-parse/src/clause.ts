/**
 * packages/paste-parse/src/clause.ts  (PARSING §3.6 · §12.1)
 *
 * R7 — 한 문단 안의 여러 동작을 어떻게 쪼개는가. **가장 어려운 부분이자
 * 이 파서에서 유일하게 임계값을 갖는 규칙이다.**
 *
 * 핵심 아이디어 (D-051):
 *   **연결어미는 "여기서 끊을 수 있다"만 말해준다. "끊어야 한다"는 문맥이 말해준다.**
 *   한국어 연결어미는 다의적이다 — `-고`는 나열이기도 하고(`받고 정리하고`)
 *   보조용언 구성이기도 하며(`하고 있다`) 인용이기도 하고(`된다고 했다`)
 *   그냥 명사다(`재고`, `보고`, `참고`). 그래서 **어미 패턴 단독으로는 절대 쪼개지 않는다.**
 *
 * 가장 강력한 문맥 증거는 **도구 전환**이다. 이 제품은 도구 카탈로그와 조직 디렉터리를
 * 갖고 있다 — 범용 형태소 분석기가 못 쓰는 이점이다.
 */

import type { PersonHit, Span, ToolHit, Trait } from './types.ts';
import { hasActionPredicate } from './lexicon/verbs.ts';
import { isReceivingCondition } from './lexicon/branch.ts';

export const CLAUSE_THRESHOLD = 0.75; // ★ 미분할 편향의 수치적 정체 (D-050)
export const MIN_CLAUSE = 6; // 자
export const MAX_SPLIT_PER_SENTENCE = 4;

/* ────────────────────────────────────────────────────────────────────────────
 * §12.1 병목 1 — 단위마다 한 번만 스캔하고, 이후엔 이분 탐색으로 답한다.
 *   후보마다 문자열 두 개를 새로 만들던 것이 인덱스 비교 두 번이 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

export class HitIndex<T extends { span: Span; id: string }> {
  private readonly hits: readonly T[];

  /** @param hits span[0] 오름차순으로 정렬돼 있어야 한다 */
  constructor(hits: readonly T[]) {
    this.hits = hits;
  }

  private lowerBound(i: number): number {
    let lo = 0;
    let hi = this.hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.hits[mid]!.span[0] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 위치 i 앞에서 끝나는 마지막 히트 */
  lastBefore(i: number): T | undefined {
    for (let k = this.lowerBound(i) - 1; k >= 0; k--) {
      const h = this.hits[k]!;
      if (h.span[1] <= i) return h;
    }
    return undefined;
  }

  /** 위치 i 뒤에서 시작하는 첫 히트 */
  firstAfter(i: number): T | undefined {
    for (let k = this.lowerBound(i); k < this.hits.length; k++) {
      const h = this.hits[k]!;
      if (h.span[0] >= i) return h;
    }
    return undefined;
  }

  get length(): number {
    return this.hits.length;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * (1) 후보 스캔 — 1-pass
 * ──────────────────────────────────────────────────────────────────────────── */

export const RE_CLAUSE_CANDIDATE = new RegExp(
  [
    // ── 순차 강 (거의 항상 별개 동작)
    '(?<seqA>(?:하고|되고)\\s*(?:나서|난\\s*(?:뒤|후|다음)))',
    '(?<seqB>[가-힣]{1,12}?(?:한|된|하신)?\\s*(?:뒤|후|다음)에?)',
    '(?<imm>[가-힣]자마자)',
    // ── 대안 갈래의 시작 — 분할점은 이 토큰 **앞**이다 (§11 F2-06)
    '(?<alt>아니면|그렇지\\s?않으면|그\\s?외에는|해당\\s?없으면|이외의\\s?경우)',
    // ── 조건 (분기 후보 — §5)
    '(?<condT>^\\s*[가-힣]{1,6}[한된인]\\s[가-힣]{1,6}[은는])',
    '(?<cond>[가-힣](?:으면|면|라면|이면|거든))',
    '(?<condN>(?:인|일|할|한|하는|되는)\\s*경우(?:에는|에|엔)?|[가-힣]{1,10}\\s*시(?:에는|에)?)',
    // ── 나열/계속
    '(?<go>[가-힣]고)',
    '(?<seo>[가-힣](?:아서|어서|여서|해서))',
    // ── 약함
    '(?<sim>[가-힣](?:며|면서))',
    '(?<trans>[가-힣]다가)',
    // ── 분할 금지 (매칭되면 그 지점은 경계가 **아니라고 확정한다**)
    '(?<never>[가-힣](?:지만|는데|은데|려고|러|도록|게끔|더라도|아도|어도|든지|거나|나마))',
  ].join('|'),
  'gu',
);

export const BASE_WEIGHT = {
  seqA: 0.8, seqB: 0.8, imm: 0.7, alt: 0.75, condT: 0.65, cond: 0.6, condN: 0.65,
  go: 0.55, seo: 0.45, sim: 0.3, trans: 0.3, never: -1,
} as const;

export type ClauseKind = keyof typeof BASE_WEIGHT;
export type ClauseSplit = { at: number; score: number; kind: ClauseKind };

/* ────────────────────────────────────────────────────────────────────────────
 * (2) 게이트 — 후보를 죽이는 조건 (하나라도 걸리면 즉시 탈락)
 * ──────────────────────────────────────────────────────────────────────────── */

/** -고로 끝나지만 동사가 아닌 명사들. 이게 없으면 `"재고 확인하고"`가 `"재고"` + `"확인하고"`로 갈린다 */
export const NOUN_GO = new Set([
  '재고', '보고', '참고', '신고', '공고', '광고', '원고', '예고', '통고', '경고',
  '최고', '중고', '창고', '사고', '삼고', '회고', '권고', '충고', '조고', '비고', '상고', '수고',
]);

/**
 * 뒤에 오면 -고가 보조용언 구성인 것들: `"하고 있다"`, `"받아 놓고 있다"`.
 *
 * ★ 명세의 원안은 `(?:[가-힣]|$)`였다. 그러면 `"알려주고 나중에"`의 `"나중에"`가
 *   보조용언 `"나다"`로 잘못 읽혀 §11 F6의 정본 분할이 죽는다. 보조용언은 **활용 어미를
 *   달고 온다** — 뒤따르는 형태를 어미 집합으로 좁힌다.
 */
export const AUX_AFTER = /^(?:있|계시|싶|말|나|보|주|드리|버리|두|놓|가|오|치우|대|앉|서)(?:다|고|는|어|아|었|겠|습니다|어요|아요|세요|지|자|기|시|음)/;

/** -고 앞이 진짜 동사 어간인가 (표면형 화이트리스트 + X하/X되 패턴) */
export const RE_GO_VERB =
  /(?:[가-힣]+(?:하|되|시키|당하)|받|보내|넣|올리|내리|적|쓰|주|가|오|만들|묶|맞추|채우|열|닫|찍|누르|눌러|뽑|고르|나누|합치|붙이|붙여넣|매기|알리|끝내|남기|옮기|바꾸|모으|찾|묻|보|듣|읽|앉히|걸)고$/;

/** 인용의 -고: `"된다고"`, `"하라고"`, `"왔냐고"`, `"가자고"` */
export const RE_QUOTE_GO = /[다라냐자][고]$/;

/** -아서/어서의 앞절이 준비 동작이면 별개 단계가 아니다: `"엑셀 열어서 붙여넣고"` */
export const PREP_VERB = /(?:열|켜|들어가|접속하|로그인하|실행하|띄우|찾|가|와)(?:아서|어서|여서|해서)$/;

export type SegCtx = {
  toolIdx: HitIndex<ToolHit>;
  peopleIdx: HitIndex<PersonHit>;
  traits: ReadonlySet<Trait>;
  /** 부록 B `R7.gated.*` — **"몇 번 잡았나"보다 "몇 번 참았나"가 편향의 작동을 알려준다** */
  gated: Record<string, number>;
};

const RE_LOCATIVE = /[가-힣]{2,}(?:에|에서|으로|로|한테|에게|께)\s/;

/**
 * (3) 채점 — 어미 강도 + **독립 증거**
 *
 * @param text  단위(문장/발화) 텍스트. 좌표는 이 문자열 기준이다
 */
export function scoreClauseSplits(text: string, ctx: SegCtx): ClauseSplit[] {
  const raw: { kind: ClauseKind; end: number; word: string }[] = [];
  const forbid: number[] = [];

  const re = new RegExp(RE_CLAUSE_CANDIDATE.source, RE_CLAUSE_CANDIDATE.flags);
  re.lastIndex = 0; // §12.1 규칙 2
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const g = Object.entries(m.groups ?? {}).find(([, v]) => v != null);
    if (!g) continue;
    const kind = g[0] as ClauseKind;
    const tok = g[1] as string;
    // ★ 대안 표지는 **다음 갈래의 머리**다. 다른 어미와 달리 토큰 앞에서 끊는다
    const end = kind === 'alt' ? m.index : m.index + tok.length;

    if (kind === 'alt') {
      // 문장 맨 앞이면 이미 경계다. 그리고 왼쪽이 절로 끝나지 않으면
      // `"하나라도 안 되면"`처럼 조건절 내부를 자르게 된다 → 대안이 아니다
      if (end === 0 || !hasActionPredicate(text.slice(0, end))) continue;
      raw.push({ kind, end, word: tok });
      continue;
    }
    // 어미 뒤에 공백이 없으면 어미가 아니다 (`"고객"` 안의 '고')
    if (end < text.length && !/[\s,]/.test(text[end]!)) continue;
    if (kind === 'never') {
      forbid.push(end);
      continue;
    }
    raw.push({ kind, end, word: tok });
  }

  const out: ClauseSplit[] = [];
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k]!;
    const { kind, end } = c;

    // ── 게이트 ────────────────────────────────────────────────────────────
    if (kind === 'go') {
      const word = /[가-힣]+고$/.exec(text.slice(0, end))?.[0] ?? '';
      if (NOUN_GO.has(word)) {
        ctx.gated['nounGo'] = (ctx.gated['nounGo'] ?? 0) + 1;
        continue;
      }
      if (RE_QUOTE_GO.test(word)) {
        ctx.gated['quote'] = (ctx.gated['quote'] ?? 0) + 1;
        continue;
      }
      if (!RE_GO_VERB.test(word)) {
        ctx.gated['notVerb'] = (ctx.gated['notVerb'] ?? 0) + 1;
        continue;
      }
      if (AUX_AFTER.test(text.slice(end).trimStart())) {
        ctx.gated['aux'] = (ctx.gated['aux'] ?? 0) + 1;
        continue;
      }
    }
    if (kind === 'cond' && isReceivingCondition(text.slice(0, end))) {
      // 수령형 조건 — 분기가 아니라 앞 단계와의 이음새. 끊되 분기로 승격하지 않는다
      out.push({ at: end, score: 0.5, kind: 'seqB' });
      continue;
    }

    let s: number = BASE_WEIGHT[kind];
    if (kind === 'seo' && PREP_VERB.test(text.slice(0, end).split(/\s/).pop() ?? '')) {
      s -= 0.3;
      ctx.gated['prep'] = (ctx.gated['prep'] ?? 0) + 1;
    }

    // ── 독립 증거 가산 (§12.1대로 문자열 슬라이스 없이 인덱스 비교로) ─────────
    const lTool = ctx.toolIdx.lastBefore(end);
    const rTool = ctx.toolIdx.firstAfter(end);
    if (lTool && rTool && lTool.id !== rTool.id) s += 0.25; // ★ 도구 전환
    const lPerson = ctx.peopleIdx.lastBefore(end);
    const rPerson = ctx.peopleIdx.firstAfter(end);
    if (rPerson && lPerson?.id !== rPerson.id) s += 0.2; // 담당자 전환
    if (RE_LOCATIVE.test(text.slice(end, end + 24))) s += 0.15; // 처소·도구 부사구
    if (hasActionPredicate(text.slice(0, end)) && hasActionPredicate(text.slice(end))) s += 0.15; // 양쪽에 서술어

    // ── 감산 ──────────────────────────────────────────────────────────────
    const prevEnd = out.length ? out[out.length - 1]!.at : 0;
    const nextEnd = raw[k + 1]?.end ?? text.length;
    const lLen = end - prevEnd;
    const rLen = nextEnd - end;
    // ★ 조건절은 원래 짧다. 초단문 감점을 조건 후보에 그대로 물리면 §11 F6의
    //   `"급한 건은"` 같은 정상 분기가 전부 죽는다 → 좌측 감점만 면제한다.
    const condHead = kind === 'cond' || kind === 'condN' || kind === 'condT';
    if ((lLen < MIN_CLAUSE && !condHead) || rLen < MIN_CLAUSE) {
      s -= 0.2;
      ctx.gated['short'] = (ctx.gated['short'] ?? 0) + 1;
    }
    // ★ 조건절을 떼어내면 그 조건은 **분기**가 되고, 뒤따르는 절들이 갈래가 된다.
    //   그런데 뒤에 절이 하나뿐이면 갈래가 하나뿐인 분기 — §6.3이 금지한 빈 갈래다.
    //   `"휴폐업 사업자인 경우 반려한다"`는 분기가 아니라 **조건부 작업 한 단계**다.
    //   갈래가 둘 이상 될 수 있을 때만 조건을 떼어낸다 (§11 F1-06 vs F2-04를 가르는 규칙).
    if (condHead && k + 1 >= raw.length) {
      s -= 0.3;
      ctx.gated['lonelyCond'] = (ctx.gated['lonelyCond'] ?? 0) + 1;
    }
    if (ctx.traits.has('numbered') || ctx.traits.has('bulleted') || ctx.traits.has('checkbox')) s -= 0.1; // 저자가 이미 나눴다
    if (out.length >= MAX_SPLIT_PER_SENTENCE - 1) s -= 0.3; // 잘게 부수기 방지

    out.push({ at: end, score: s, kind });
  }

  return out
    .filter((c) => c.score >= CLAUSE_THRESHOLD && !forbid.some((f) => Math.abs(f - c.at) < 3))
    .slice(0, MAX_SPLIT_PER_SENTENCE);
}

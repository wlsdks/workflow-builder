/**
 * packages/paste-parse/src/lexicon/branch.ts  (PARSING §4.2)
 *
 * `branchMode` 결정:
 *   alternative | approvalPair 존재  → 'xor'
 *   parallel 존재                    → 'and'
 *   conditional|caseNoun 만 존재     → 'skip'   ← 갈래가 하나뿐이라 빈칸을 요구하지 않는다
 *   perAxis 존재                     → 'xor' + "갈래를 나열해달라" 후속 질문
 *
 * `skip`으로 떨어뜨리는 게 중요하다. 조건은 있는데 대안이 없을 때 `xor`로 만들면
 * 사용자가 **빈 갈래**를 마주한다 — 빈 화면 공포의 재발이다.
 */

export const BRANCH_MARKERS = {
  /** 조건 도입 — 문두에 오면 강함 */
  opener: /(?:^|\s)(?:만약|만일|혹시|가령|예를\s?들어|경우에\s?따라|상황에\s?따라|케바케)/,

  /** 조건 어미 */
  conditional: /[가-힣](?:으면|면|라면|이면|거든|더라도)(?=\s|,|$)/,
  caseNoun: /(?:인|일|할|한|하는|되는|아닌|없는|있는)\s*경우(?:에는|에|엔|만)?|[가-힣]{1,10}\s*시(?:에는|에)?(?=\s)/,

  /** 대안 표지 — ★ 이게 있어야 진짜 XOR 분기다 */
  alternative:
    /(?:^|\s)(?:아니면|그렇지\s?않으면|그\s?외에는|안\s?되면|불가하면|반려되면|거절되면|미승인|실패하면|아닐\s?때|없으면|해당\s?없으면|이외의\s?경우)/,

  /** 승인/반려 쌍 — 결재 흐름의 전형 */
  approvalPair: /(?:승인(?:되면|나면|되는\s?경우)|가결)[\s\S]{0,80}?(?:반려|부결|거절|미승인)/,

  /** 분류 기준 (택1 아님 — 반복 축) */
  perAxis: /(?:[가-힣]{1,10})(?:별로|마다|에\s?따라|기준으로)(?=\s)/,

  /** 동시 (AND) */
  parallel: /(?:동시에|병행(?:해서|하여)?|같이|나란히|각각|양쪽\s?다|모두)/,

  /** 조건 스킵 (갈래가 하나뿐) */
  skipOnly: /(?:에만|일\s?때만|인\s?경우에만|해당하면|필요하면|필요\s?시)(?=\s|$)/,
} as const;

/**
 * 대안 갈래로 시작하는가 (§6.3 `isAlt`).
 * 이게 참이면 분기 스코프를 닫지 않고 **자식으로 받는다.**
 */
export const RE_ALT_HEAD = /^(?:승인|반려|가결|부결)/;

/**
 * 조건절이지만 분기가 아닌 것: **앞 단계의 산출물 수령** (§3.6 (2)).
 * `"자료 받으면"`, `"결재 완료되면"` — 이건 갈래가 아니라 이음새다.
 */
export const RE_RECEIVING_COND =
  /(?:받으면|오면|도착하면|되면|나면|끝나면|완료되면|채워지면|들어오면|생기면)$/;

/** 수령형 어절 (정확히 이 낱말일 때만) */
const RECEIVING_WORDS = new Set(['받으면', '오면', '도착하면', '나면', '끝나면', '채워지면', '들어오면', '생기면', '왔으면']);

/**
 * ★ 명세의 `RE_RECEIVING_COND`를 어절 끝에 그냥 걸면 `"차이나면"`이 `"나면"`으로 읽혀
 *   §11 F2-04의 진짜 분기가 이음새로 흡수된다. 수령형은
 *   **(a) 그 낱말 자체이거나 (b) `X되면`/`X지면`처럼 피동 파생일 때**만이다.
 *   `"안 되면"`은 (b)의 어간이 비어 있으므로 수령형이 아니다 — 분기가 맞다 (§11 F4-05).
 */
export function isReceivingCondition(condText: string): boolean {
  const words = condText.trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  if (RECEIVING_WORDS.has(last)) return true;
  // `"다 되면"` = 앞 단계가 끝났다는 이음새. 단 `"안 되면"`·`"못 되면"`은 **예외 분기**다
  if (last === '되면') return !/^(?:안|못)$/.test(words[words.length - 2] ?? '');
  return /[가-힣]{2,}(?:되면|지면)$/.test(last);
}

export type ConditionMatch = { at: number; end: number; text: string; via: 'conditional' | 'caseNoun' | 'topic' };

/**
 * 이 세그먼트에 조건절이 있는가. 있으면 **그 구간**을 돌려준다.
 *
 * `topic`은 명세 본문에는 없고 §11 F6-05(`"급한 건은"`)만 요구하는 형태다.
 * 조건 명사구 + 주제격 조사는 한국 실무 문장에서 조건절의 축약형으로 아주 흔하다
 * (`"급한 건은 …"` = `"급한 건인 경우 …"`). 세그먼트 **전체**가 그 꼴일 때만 인정한다 —
 * 문장 중간의 `"~은/는"`까지 조건으로 읽으면 거짓 분기가 폭증한다 (§5.1).
 */
export function matchCondition(t: string): ConditionMatch | null {
  const s = t.trim();

  const c = BRANCH_MARKERS.caseNoun.exec(s);
  if (c) return { at: 0, end: c.index + c[0].length, text: s.slice(0, c.index + c[0].length), via: 'caseNoun' };

  const k = BRANCH_MARKERS.conditional.exec(s);
  if (k) return { at: 0, end: k.index + k[0].length, text: s.slice(0, k.index + k[0].length), via: 'conditional' };

  const topic = /^(?:[가-힣]{2,6}[은는]|[가-힣]{1,6}[한된는]\s[가-힣]{1,6}[은는])$/.exec(s.replace(/[.!?…,\s]+$/, ''));
  if (topic) return { at: 0, end: topic[0].length, text: topic[0], via: 'topic' };

  return null;
}

const JAMO_BASE = 0xac00;
const FINAL_M = 16; // 종성 'ㅁ'의 인덱스

/**
 * 조건 표현을 명사형으로 접는다. `"차이나면"` → `"차이남"`, `"10건 이상이면"` → `"10건 이상"`.
 *
 * 표에 없으면 **원문을 그대로 둔다** (§4.6 폴백 2와 같은 규율). 어색한 조건보다
 * 틀린 조건이 훨씬 비싸고, `sourceRange`가 원문을 가리키고 있으므로 언제든 되살릴 수 있다.
 */
export function nominalizeCondition(text: string): string {
  let s = text.trim().replace(/[,.\s]+$/, '');

  if (/(?:이면|이라면)$/.test(s)) return s.replace(/(?:이면|이라면)$/, '');
  if (/[가-힣]은$|[가-힣]는$/.test(s) && s.length <= 12) return s.slice(0, -1);
  if (/(?:으면|면)$/.test(s)) {
    s = s.replace(/(?:으면|면)$/, '');
    const last = s.charCodeAt(s.length - 1) - JAMO_BASE;
    // 받침이 없는 음절에만 'ㅁ'을 붙인다. 받침이 있으면 손대지 않는다 (추측하지 않는다)
    if (last >= 0 && last < 11172 && last % 28 === 0) {
      return s.slice(0, -1) + String.fromCharCode(JAMO_BASE + last + FINAL_M);
    }
    return s;
  }
  return s;
}

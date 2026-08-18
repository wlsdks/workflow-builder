/**
 * packages/doc-gen/src/lang.ts
 *
 * 한국어 조사·수사·단위 표기. 문장 조립의 바닥층.
 *
 * ★ 여기 있는 함수는 **엔진 문장**을 만드는 데만 쓴다.
 *   사용자 원문에 조사를 붙일 때도 원문 자체는 건드리지 않고 뒤에 이어 붙이기만 한다.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 마지막 글자에 받침이 있는가. 한글이 아니면 null (판정 불가) */
export function finalConsonant(word: string): number | null {
  const s = word.trimEnd();
  const ch = s.codePointAt(s.length - 1);
  if (ch === undefined) return null;
  if (ch < HANGUL_START || ch > HANGUL_END) return null;
  return (ch - HANGUL_START) % 28;
}

const hasBatchim = (word: string): boolean => {
  const f = finalConsonant(word);
  return f === null ? false : f !== 0;
};

/** 을/를 */
export const objectParticle = (w: string): string => (hasBatchim(w) ? '을' : '를');
/** 이/가 */
export const subjectParticle = (w: string): string => (hasBatchim(w) ? '이' : '가');
/** 은/는 */
export const topicParticle = (w: string): string => (hasBatchim(w) ? '은' : '는');
/** 와/과 */
export const withParticle = (w: string): string => (hasBatchim(w) ? '과' : '와');

/**
 * 로/으로 — ㄹ 받침은 '로'를 쓴다 (엑셀로, 메일로).
 * 한글이 아니면 '로'. `더존 ERP로`가 이 규칙에서 나온다.
 */
export function instrumentParticle(w: string): string {
  const f = finalConsonant(w);
  if (f === null) return '로';
  if (f === 0) return '로';
  if (f === 8) return '로'; // ㄹ
  return '으로';
}

/** 이면/면 */
export const conditionParticle = (w: string): string => (hasBatchim(w) ? '이면' : '면');

/**
 * 명사형 라벨(`맞음`, `안 맞음`)을 조건형(`맞으면`, `안 맞으면`)으로 바꾼다.
 *
 * **이건 사용자 원문을 다시 쓰는 것에 가장 가까운 조작이다.** 그래서
 *   - §4.3이 명시적으로 `{caseLabel}{이면/면}`을 지시한 범위 안에서만 하고,
 *   - `CaseSpec.condition`이 있으면 **무조건 그쪽이 이긴다.**
 * `차이 있음 → 차이가 있으면`처럼 조사가 끼어드는 변환은 규칙으로 하지 않는다.
 * 그건 사람이 적어야 한다.
 */
export function toCondition(label: string): string {
  const s = label.trimEnd();
  const last = s.codePointAt(s.length - 1);
  if (last !== undefined && last >= HANGUL_START && last <= HANGUL_END) {
    const jong = (last - HANGUL_START) % 28;
    // 종성 ㅁ(16) = 명사형 어미 '-(으)ㅁ'
    if (jong === 16) {
      const stem = String.fromCodePoint(last - 16);
      const head = s.slice(0, -1);
      // 어간에 받침이 남아 있으면 '으면', 없으면 '면'
      const stemJong = (stem.codePointAt(0)! - HANGUL_START) % 28;
      return head + stem + (stemJong === 0 ? '면' : '으면');
    }
  }
  return s + conditionParticle(s);
}

/* ── 수사 ─────────────────────────────────────────────────────────────────── */

const NATIVE = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** `세 가지`, `여섯 개`, `두 군데` — 열까지는 고유어, 그 위는 숫자 */
export function countWord(n: number, unit: string): string {
  const w = n >= 1 && n <= 10 ? NATIVE[n] : String(n);
  return `${w} ${unit}`;
}

const DAY_WORD = ['', '하루', '이틀', '사흘'];

/** 대기 길이 자연어 — 하루/이틀/사흘, 그 위는 `{n}일` (주 단위로 바꾸지 않는다) */
export function waitPhrase(hours: number): string {
  if (hours <= 2) return '금방';
  if (hours <= 8) return `${trimNum(hours)}시간`;
  if (hours <= 24) return '하루';
  const days = hours / 24;
  const whole = Math.round(days);
  if (Math.abs(days - whole) < 1e-9 && whole >= 1 && whole <= 3) return DAY_WORD[whole]!;
  return `${trimNum(days)}일`;
}

/** 표에 쓰는 짧은 형태 — `4일`, `1일` */
export function waitCompact(hours: number): string {
  if (hours < 24) return `${trimNum(hours)}시간`;
  return `${trimNum(hours / 24)}일`;
}

/** 타임아웃 자연어 — `사흘`, `3일`. 대기와 같은 표를 쓴다 */
export const timeoutPhrase = (hours: number): string => waitPhrase(hours);

/** 표에 쓰는 타임아웃 — `3일` */
export const timeoutCompact = (hours: number): string => waitCompact(hours);

function trimNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ── 시간 버킷 ────────────────────────────────────────────────────────────── */

export const BAND_LABEL: Record<string, string> = {
  '1m': '1분',
  '5m': '5분',
  '15m': '15분',
  '1h': '1시간',
  halfday: '반나절',
  '1d+': '하루 넘게',
};

/** graph-core의 BAND_HOURS와 같은 값. 값으로 import 하지 않으려고 복제한다 */
export const BAND_HOURS: Record<string, number> = {
  '1m': 1 / 60,
  '5m': 5 / 60,
  '15m': 0.25,
  '1h': 1,
  halfday: 4,
  '1d+': 8,
};

/** 갈래 번호의 가/나/다 */
export const CASE_LETTERS = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'] as const;

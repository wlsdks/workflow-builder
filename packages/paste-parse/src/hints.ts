/**
 * packages/paste-parse/src/hints.ts  (PARSING §7)
 *
 * S8 메타 힌트. **이 절 전체가 재현율 편향이다** (§0.2) — 틀려도 배지 클릭 1회다.
 *
 * 단 하나의 예외: `assigneeHint`는 자유 텍스트로 저장되지 않는다. 파서는 후보 문자열만
 * 내고, 확정은 디렉터리 대조 화면에서 한다 (ARCHITECTURE의 `assignee_id` FK).
 */

import type { DurationBand, PersonHit, Span, ToolHit } from './types.ts';
import { toolScanner } from './lexicon/tools.ts';

export { toolScanner };

/* ────────────────────────────────────────────────────────────────────────────
 * §7.2 담당자
 * ──────────────────────────────────────────────────────────────────────────── */

export const RE_MENTION = /@([가-힣]{2,4}|[A-Za-z][A-Za-z0-9._-]{1,20})/g;
export const RE_ORG =
  /([가-힣A-Za-z]{1,8}(?:팀|부서|파트|실|본부|센터|과|국|지점|영업소|공장|법인))(?=[\s,.]|에서|에게|께|으로|로|이|가|은|는|의|$)/g;
/**
 * ★ 명세의 원안은 이름과 직급 사이에 `\s*`를 허용한다. 그러면 `"되면 팀장님께"`가
 *   `"되면팀장"`이라는 없는 사람을 만든다. 이름+직급은 **붙어 있을 때만** 한 사람이다.
 */
export const RE_RANK =
  /([가-힣]{1,3})?(사장|부사장|전무|상무|이사|본부장|실장|팀장|파트장|그룹장|부장|차장|과장|대리|주임|사원|매니저|담당자|담당|점장|소장|기사|반장|대표)(님|씨)?(?=[\s,.)\]]|$|에게|한테|께|이|가|은|는|을|를|의|와|과|랑|로|으로|에서|에|님|씨)/g;
export const RE_NAME_HON = /([가-힣]{2,4})\s*(?:님|씨)(?=[\s,.]|에게|한테|께|이|가|은|는|의|$)/g;
export const RE_SELF = /(?:^|\s)(?:제가|내가|저는|나는|본인이|직접)(?=\s)/;

const HONORIFIC_STRIP = /(?:님|씨|분)$/;
const ROLE_ONLY = new Set(['담당자', '담당', '실무자', '작성자', '승인자', '결재자', '요청자', '고객', '거래처', '업체', '상대방', '사용자']);
const RANK_WORDS = new Set([
  '사장', '부사장', '전무', '상무', '이사', '본부장', '실장', '팀장', '파트장', '그룹장', '부장', '차장',
  '과장', '대리', '주임', '사원', '매니저', '점장', '소장', '기사', '반장', '대표',
]);

/**
 * 격조사로 방향을 읽는다 — 이게 담당자와 상대방을 가른다 (§7.2 표).
 *   ~에게/한테/께/로  수신자 → 다음 단계의 담당자 후보 (인계)
 *   ~에서/이/가       행위자 → 이 단계의 담당자
 *   ~와/과 함께/랑    협업자 → 담당자로 쓰지 않는다
 */
function direction(after: string): PersonHit['direction'] {
  if (/^(?:에게|한테|께|으로|로)/.test(after)) return 'recipient';
  if (/^(?:에서|이|가)/.test(after)) return 'actor';
  if (/^(?:와|과|랑|이랑)/.test(after)) return 'collab'; // 협업자는 담당자로 쓰지 않는다
  return 'none';
}

/** 우선순위대로 훑으면서 이미 잡힌 구간은 건너뛴다 (§7.2 1~7) */
export function scanPeople(text: string, offset = 0): PersonHit[] {
  const hits: PersonHit[] = [];
  const taken: Span[] = [];
  const free = (s: number, e: number) => !taken.some((t) => t[0] < e && s < t[1]);
  const add = (s: number, e: number, kind: PersonHit['kind'], name: string) => {
    if (!free(s, e)) return;
    taken.push([s, e]);
    hits.push({
      id: `${kind}:${name}`,
      kind,
      name,
      direction: direction(text.slice(e, e + 3)),
      span: [s + offset, e + offset],
    });
  };
  const run = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    r.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.exec(text))) {
      if (m[0].length === 0) r.lastIndex++;
      else fn(m);
    }
  };

  // 1) @멘션 (가장 강함)
  run(RE_MENTION, (m) => add(m.index, m.index + m[0].length, 'person', m[1]!));
  // 2·3) 이름+직급+님 / 이름+님
  run(RE_NAME_HON, (m) => {
    const name = m[1]!.replace(HONORIFIC_STRIP, '');
    if (!name) return;
    add(m.index, m.index + m[0].length, RANK_WORDS.has(name) ? 'role' : 'person', name);
  });
  // 4·6) 조직+직급 / 직급 단독
  run(RE_RANK, (m) => {
    const prefix = m[1] ?? '';
    const rank = m[2]!;
    // 역할만 있는 말(`담당자`, `고객`)은 담당자 후보가 아니다 — 디렉터리에 대조할 대상이 없다
    if (ROLE_ONLY.has(rank) && !prefix) return;
    add(m.index, m.index + m[0].length, 'role', `${prefix}${rank}`);
  });
  // 5) 조직
  run(RE_ORG, (m) => add(m.index, m.index + m[1]!.length, 'role', m[1]!));
  // 7) 1인칭
  const self = RE_SELF.exec(text);
  if (self) add(self.index, self.index + self[0].length, 'self', '나');

  return hits.sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * 여러 후보가 잡히면 **행위자 > 수신자 > 조직** 순으로 하나만 넣고 나머지는 버린다.
 * 두 명을 넣을 자리가 스키마에 없고, 넣어도 사용자가 지워야 한다 (§7.2).
 */
export function pickAssignee(people: readonly PersonHit[]): string | undefined {
  if (!people.length) return undefined;
  const score = (p: PersonHit) =>
    (p.kind === 'person' ? 4 : p.kind === 'role' ? 2 : 0) +
    (p.direction === 'actor' ? 2 : p.direction === 'recipient' ? 1 : 0);
  const best = [...people].filter((p) => p.kind !== 'self').sort((a, b) => score(b) - score(a) || a.span[0] - b.span[0])[0];
  return best?.name;
}

/* ────────────────────────────────────────────────────────────────────────────
 * §7.3 소요시간
 * ──────────────────────────────────────────────────────────────────────────── */

const NUM_KO: Record<string, number> = {
  반: 0.5, 한: 1, 두: 2, 세: 3, 네: 4, 댓: 5, 다섯: 5, 여섯: 6,
  일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열다섯: 15, 스무: 20, 서른: 30,
};

export const RE_DURATION =
  /(?:약|대략|한)?\s*(\d{1,3}(?:[.~-]\d{1,3})?|반|한|두|세|네|댓|다섯|여섯|일곱|여덟|아홉|열|열다섯|스무|서른)\s*(분|시간|일|주일?|개월|달|년)\s*(?:정도|쯤|가량|내외|씩|남짓|이상|넘게)?/g;
/**
 * ★ 명세의 원안에는 `바로`가 있다. 그런데 `"바로 연락"`의 `바로`는 소요시간이 아니라
 *   **즉시성 부사**다 (§11 F4-05가 durationHint 없이 나와야 하는 이유). 목록에서 뺀다.
 */
export const RE_DURATION_WORD =
  /(잠깐|금방|순식간|한나절|반나절|하루\s?종일|온종일|하루|이틀|사흘|나흘|닷새|일주일|열흘|보름|한\s?달)/g;

const WORD_MIN: Record<string, number> = {
  잠깐: 2, 금방: 2, 순식간: 1, 한나절: 240, 반나절: 240, '하루 종일': 480, 온종일: 480,
  하루: 480, 이틀: 960, 사흘: 1440, 나흘: 1920, 닷새: 2400, 일주일: 2400, 열흘: 4800, 보름: 7200, '한 달': 9600,
};
const UNIT_MIN: Record<string, number> = { 분: 1, 시간: 60, 일: 480, 주: 2400, 주일: 2400, 개월: 9600, 달: 9600, 년: 115200 };

/** ARCHITECTURE.md `items.duration_band` 로 접는다 */
export function toBand(min: number): DurationBand {
  if (min <= 2) return '1m';
  if (min <= 7) return '5m';
  if (min <= 20) return '15m';
  if (min <= 90) return '1h';
  if (min <= 300) return 'halfday';
  return '1d+';
}

/**
 * 시점·마감·주기는 durationHint가 **아니다** (§7.3).
 * `"입사 3일 전"`, `"D+1까지"`, `"8/20까지"`, `"매월 5일에"` — 전부 기한이다.
 */
const RE_AFTER_TIMEPOINT = /^\s*(?:전|후|이내|이후|이상|이하|째|차|종료|시점|간|까지|에|부터|동안)/;
const RE_BEFORE_FREQ = /(?:매월|매주|매달|매년|매|하루에|주에|월에)\s*$/;

export function extractDuration(text: string): { hint: string; band: DurationBand } | null {
  const numeric = new RegExp(RE_DURATION.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(text))) {
    const end = m.index + m[0].length;
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    if (RE_BEFORE_FREQ.test(before)) continue;
    if (RE_AFTER_TIMEPOINT.test(text.slice(end, end + 4))) continue;
    const numTok = m[1]!;
    const unit = m[2]!;
    const n = NUM_KO[numTok] ?? Number.parseFloat(numTok.split(/[~-]/)[0] ?? '0');
    if (!Number.isFinite(n) || n <= 0) continue;
    return { hint: `${numTok}${unit}`, band: toBand(n * (UNIT_MIN[unit] ?? 1)) };
  }
  const word = new RegExp(RE_DURATION_WORD.source, 'g');
  while ((m = word.exec(text))) {
    const end = m.index + m[0].length;
    if (RE_AFTER_TIMEPOINT.test(text.slice(end, end + 4))) continue;
    const key = m[1]!;
    const min = WORD_MIN[key] ?? WORD_MIN[key.replace(/\s/g, ' ')];
    if (min == null) continue;
    return { hint: key, band: toBand(min) };
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * §7.4 빈도
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ★ 명세의 원안은 `매주`가 `매주 화요일`보다 앞에 있어서 항상 짧은 쪽이 잡힌다
 *   (§11 F2-01의 기대값은 `"매주 화요일"`이다). 정규식 대안은 **긴 것부터** 놓는다.
 */
export const RE_FREQ = new RegExp(
  [
    '매주\\s?[월화수목금토일]요일', '매\\s?[월화수목금토일]요일', '매월\\s?말일', '매월\\s?\\d{1,2}일',
    '주\\s?[1-9]\\s?회', '월\\s?[1-9]\\s?회', '연\\s?[1-9]\\s?회', '하루에\\s?\\d{1,2}\\s?(?:번|건)',
    '매일', '날마다', '일일', '매주', '매월', '매달', '매년', '격주', '격월',
    '분기(?:마다|별|에\\s?한\\s?번)?', '반기', '월말', '월초', '말일', '초일',
    '수시로', '필요할\\s?때마다', '요청\\s?시(?:마다)?', '건별로', '건건이', '틈틈이', '비정기(?:적)?', '부정기',
  ].join('|'),
  'g',
);

/** `freqLast7d` 추정치 — PRD의 "지난 7일 동안 몇 번" 축에 맞춘다 */
export const FREQ_TO_7D: Record<string, number> = {
  매일: 5, 날마다: 5, 일일: 5,
  매주: 1, '주 1회': 1, '주 2회': 2, '주 3회': 3, '주 5회': 5,
  격주: 0, 매월: 0, 매달: 0, 월말: 0, 말일: 0, 격월: 0,
  분기: 0, 반기: 0, 매년: 0,
  수시로: 3, 건별로: 3, 건건이: 3, 틈틈이: 3,
};

export function extractFreq(text: string): string | null {
  const re = new RegExp(RE_FREQ.source, 'g');
  const m = re.exec(text);
  return m ? m[0] : null;
}

/** `0`이 나오는 항목은 freqLast7d를 **저장하지 않는다** — 집계에서 업무가 사라진다 (§7.4) */
export function freqToLast7d(hint: string): number | null {
  const key = Object.keys(FREQ_TO_7D).find((k) => hint.startsWith(k));
  if (!key) return null;
  const v = FREQ_TO_7D[key]!;
  return v > 0 ? v : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 문서 1회 스캔 (§12.1 병목 1)
 * ──────────────────────────────────────────────────────────────────────────── */

export type DocScan = { tools: ToolHit[]; people: PersonHit[]; unmatched: string[] };

export function scanDocument(work: string): DocScan {
  const tools = toolScanner.scan(work);
  return { tools, people: scanPeople(work), unmatched: dedupe(toolScanner.unmatched(work, tools)) };
}

const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)];

export const within = (span: Span, hitSpan: Span): boolean => hitSpan[0] >= span[0] && hitSpan[1] <= span[1];

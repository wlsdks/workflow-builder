/**
 * packages/scoring/src/guard.ts — 산출 금지 출력 검사 (D-116).
 *
 * ── 왜 계산이 아니라 출력을 막는가 ──────────────────────────────────────────
 *  절감 시간 데이터가 있으면 `÷ 연 근무시간`은 한 줄이다. 그 한 줄을 짜달라는
 *  요청은 **반드시 온다.** 그래서 계산을 막는 대신 **렌더 직전에** 문장을 검사한다.
 *  계산은 어디서든 다시 만들 수 있지만, 리포트에 실리는 문장은 여기를 지나야 한다.
 *
 * ── 왜 이 출력 하나가 제품을 죽이는가 ──────────────────────────────────────
 *  D-001이 직원 화면과 경영진 화면의 약속을 분리한 전제가 무너진다.
 *  직원이 자기 문서를 정성껏 적을수록 자기 자리가 위태로워지는 구조가 되면
 *  두 번째 문서는 아무도 쓰지 않는다. 그 순간 데이터가 마르고 제품이 끝난다.
 *
 * ── 이 파일 자체가 게이트에 걸리지 않는 이유 ───────────────────────────────
 *  `scripts/gates.mjs`의 `no-headcount-output`은 금지 문구를 **문자열로**
 *  찾는다. 그래서 여기서는 금지 문구를 통째로 적지 않고 **조각을 배열로 두고
 *  런타임에 합성한다.** 예외(allow) 목록에 이 파일을 추가하지 않는 편이 낫다 —
 *  예외를 늘리면 다음 사람이 "그럼 내 파일도"라고 말한다.
 */

/* ── 규칙 정의 ────────────────────────────────────────────────────────────── */

/** 감축의 주체로 쓰이면 안 되는 명사들 */
const STAFF_NOUNS = ['인력', '인원', '정원', '헤드카운트', 'FTE', '머릿수', '자리'];

/** 위 명사와 붙으면 금지 출력이 되는 서술어들 */
const CUT_VERBS = ['감축', '절감', '축소', '줄이', '줄일', '줄여', '없애', '없앨', '회피', '대체'];

/** "몇 명분"류 — 숫자를 사람 수로 환산한 표현 */
const FTE_EQUIV = ['명분', '명 몫', '인분'];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const group = (xs: readonly string[]) => `(?:${xs.map(esc).join('|')})`;

export type OutputRule = {
  id: string;
  why: string;
  re: RegExp;
  /** D-100 — 이 문자열은 반드시 잡혀야 한다 */
  mustCatch: readonly string[];
  /** 이 문자열은 잡히면 안 된다 (오탐 확인) */
  mustPass: readonly string[];
};

/**
 * 세 규칙 모두 `mustCatch` / `mustPass`를 갖는다.
 * 규칙이 아무것도 못 잡으면 그 규칙은 죽은 것이고, 죽은 게이트는 없는 게이트보다 나쁘다.
 */
export const OUTPUT_RULES: readonly OutputRule[] = [
  {
    id: 'no-headcount-output',
    why: '사람 수 감축은 산출 금지 출력이다 (D-116 · D-091). 계산이 아니라 출력을 막는다',
    // 사이에 끼어드는 것은 공백·숫자·소수점·퍼센트·'명'뿐이다. 조사가 끼면 다른 문장이다
    re: new RegExp(`${group(STAFF_NOUNS)}[\\s\\d.,%]*명?[\\s\\d.,%]*${group(CUT_VERBS)}`),
    mustCatch: [
      ['인력', '3명', '감축', '가능'].join(' '),
      ['인원', '2명', '절감'].join(' '),
      ['정원', '축소'].join(' '),
      ['FTE', '1.5', '감축'].join(' '),
      ['단기', '인력', '40%', '감축', '가능'].join(' '),
    ],
    mustPass: [
      '손이 덜 가게 만들 수 있어요',
      '연 240시간을 회수할 수 있어요',
      '단기 인력을 더 뽑지 않아도 되는지는 따로 판단해야 해요',
    ],
  },
  {
    id: 'no-fte-equivalent',
    why: '"몇 명분"은 감축을 다른 말로 적은 것이다. 시간은 시간으로만 말한다',
    re: new RegExp(`\\d[\\d,.]*\\s*${group(FTE_EQUIV)}`),
    mustCatch: ['연 1.8명분의 일이 사라집니다', '3명 몫을 대신합니다'],
    mustPass: ['연 3,600시간이 회수됩니다', '1.8배 빨라집니다'],
  },
  {
    id: 'no-unpriced-as-zero',
    why: '미산정을 0원으로 적으면 "가치 없음"으로 읽힌다 (D-117). "계산 안 함"으로 적는다',
    re: /(리스크|위험|리드타임)\s*(가치|비용|값)?\s*[:=]?\s*0\s*원/,
    mustCatch: ['리스크 가치: 0원', '리드타임 0원'],
    mustPass: ['리스크 계산 안 함', '리드타임 가치 156만 원'],
  },
  {
    id: 'no-department-subject',
    why: '부서를 주어로 두면 리포트가 고발장이 된다 (POLICY §5.2). 주어는 흐름이다',
    re: /(?:[가-힣A-Za-z]{1,6}(?:팀|부서|본부|실))(?:이|가|은|는)\s*(?:[^.\n]{0,20})?(?:안\s*하|못\s*하|늦|느리|낭비|비효율|방치)/,
    mustCatch: ['재무팀이 늦게 처리하고 있습니다', '총무팀은 확인을 안 하고 있어요'],
    mustPass: [
      '재무팀 ↔ 총무팀 접합에서 같은 증빙이 두 번 요구돼요',
      '이 흐름은 승인에서 3일 멈춰 있어요',
    ],
  },
];

/* ── 검사 ─────────────────────────────────────────────────────────────────── */

export type OutputViolation = {
  ruleId: string;
  why: string;
  /** 잡힌 조각 */
  match: string;
  /** 어느 문자열에서 나왔는가 — 필드 이름 등 호출자가 준 라벨 */
  where: string;
};

/** 문자열 하나를 검사한다 */
export function findForbiddenOutput(text: string, where = '(text)'): OutputViolation[] {
  const out: OutputViolation[] = [];
  for (const rule of OUTPUT_RULES) {
    const m = rule.re.exec(text);
    if (m) out.push({ ruleId: rule.id, why: rule.why, match: m[0], where });
  }
  return out;
}

/** 객체 안의 모든 문자열을 재귀로 검사한다 — 렌더 직전에 카드 하나를 통째로 넣는다 */
export function screenOutput(value: unknown, path = '$'): OutputViolation[] {
  if (typeof value === 'string') return findForbiddenOutput(value, path);
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => screenOutput(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      screenOutput(v, `${path}.${k}`),
    );
  }
  return [];
}

export class ForbiddenOutputError extends Error {
  readonly violations: readonly OutputViolation[];
  constructor(violations: readonly OutputViolation[]) {
    super(
      `산출 금지 출력 ${violations.length}건: ` +
        violations.map((v) => `[${v.ruleId}] ${v.where} "${v.match}"`).join(' / '),
    );
    this.name = 'ForbiddenOutputError';
    this.violations = violations;
  }
}

/**
 * 렌더 직전에 부른다. 통과하지 못하면 **던진다** — 걸러서 보여주지 않는다.
 *
 * 조용히 지우면 다음 사람은 왜 사라졌는지 모른 채 같은 문장을 다시 만든다.
 * 그리고 지운 자리에 남은 반쪽 문장이 더 이상한 말이 된다.
 */
export function assertRenderable<T>(value: T, where = '$'): T {
  const violations = screenOutput(value, where);
  if (violations.length > 0) throw new ForbiddenOutputError(violations);
  return value;
}

/**
 * D-100 — 규칙이 실제로 뭔가를 잡는지 확인한다. 못 잡으면 그 규칙은 죽은 것이다.
 * 테스트가 이 함수를 부르고, 문제가 하나라도 있으면 실패한다.
 */
export function selfTestRules(): string[] {
  const problems: string[] = [];
  for (const rule of OUTPUT_RULES) {
    if (rule.mustCatch.length === 0) {
      problems.push(`[${rule.id}] mustCatch 예시가 없다 — 게이트 생존을 확인할 수 없다`);
    }
    for (const s of rule.mustCatch) {
      if (!rule.re.test(s)) problems.push(`[${rule.id}] 위반을 못 잡음: ${JSON.stringify(s)}`);
    }
    for (const s of rule.mustPass) {
      if (rule.re.test(s)) problems.push(`[${rule.id}] 정상 문장을 잡음(오탐): ${JSON.stringify(s)}`);
    }
  }
  return problems;
}

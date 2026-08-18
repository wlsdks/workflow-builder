/**
 * packages/scoring/src/volume.ts — F(빈도) · N_people(인원) · 그 둘의 결합.
 *
 * 이 파일의 계약 한 줄:
 *   **`nPeople`을 `*` 연산자의 오른쪽에 두는 코드는 이 파일 안에 딱 한 줄뿐이다.**
 *   바깥은 `monthlyEvents()` / `annualEvents()`만 부른다.
 */

import { clamp01, median, type Volume } from './types.ts';

/* ── Volume 생성자 ────────────────────────────────────────────────────────── */

export function perPersonVolume(fPerPersonMonth: number, nPeople: number): Volume {
  return { kind: 'per-person', fPerPersonMonth, nPeople: Math.max(1, Math.round(nPeople)) };
}

/**
 * 조직 합계. **`nPeople` 필드가 없다** — 곱할 대상이 없으므로 중복 계산이 불가능하다.
 * L4(조직 집계)에서만 만들어진다. L2는 절대 org-total을 만들지 않는다.
 */
export function orgTotalVolume(fOrgMonth: number): Volume {
  return { kind: 'org-total', fOrgMonth };
}

/** Value 공식이 쓰는 유일한 접근자 */
export function monthlyEvents(v: Volume): number {
  // ↓ 이 곱셈이 코드베이스 전체에서 nPeople이 곱해지는 유일한 지점이다
  return v.kind === 'per-person' ? v.fPerPersonMonth * v.nPeople : v.fOrgMonth;
}

export function annualEvents(v: Volume): number {
  return monthlyEvents(v) * 12;
}

/**
 * per-person 볼륨들을 조직 합계로 승격한다 (L4에서만).
 * 승격 결과에는 nPeople이 없으므로, 승격 후 다시 인원을 곱하는 경로가 존재하지 않는다.
 */
export function rollupToOrgTotal(members: readonly Volume[]): Volume {
  let sum = 0;
  for (const m of members) sum += monthlyEvents(m);
  return orgTotalVolume(sum);
}

/* ── F — freqLast7d와 프로세스 주기 (D-086) ──────────────────────────────── */

export type Cadence =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  /** 사건 구동 (문의가 오면, 주문이 들어오면) — 주기가 없고 건수만 있다 */
  | 'per-event';

export type FreqSource =
  | 'measured-7d'
  | 'cadence'
  | 'both-agree'
  | 'both-conflict'
  | 'counter'
  | 'none';

export type FreqResult = {
  perMonth: number;
  source: FreqSource;
  coverage: number;
  /** 불일치 배수 (both-conflict일 때만) */
  conflictRatio?: number;
  /** 실측 승격 큐로 보내야 하는가 — 3배를 넘는 불일치 */
  needsMeasurement: boolean;
};

/** 주기 → 월 환산 발생 횟수. daily가 21.7인 이유: 업무는 주말에 안 난다 */
const CADENCE_PER_MONTH: Record<Exclude<Cadence, 'per-event'>, number> = {
  daily: 21.7,
  weekly: 4.35,
  biweekly: 2.17,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

/** 주기 1회의 길이(일). 회상창(7일)과 비교하는 데 쓴다 */
const CADENCE_PERIOD_DAYS: Record<Exclude<Cadence, 'per-event'>, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30.4,
  quarterly: 91,
  yearly: 365,
};

const RECALL_WINDOW_DAYS = 7;
const WEEKS_PER_MONTH = 30.44 / 7; // 4.348

export type MeasuredFreq = { perMonth: number; promoted: boolean };

export function resolveFrequency(input: {
  freqLast7d: number | null | undefined;
  cadence: Cadence | null;
  /** 주기 1회당 몇 건 (월마감 = 1, 급여이체 = 1) */
  occurrencesPerCycle?: number | null;
  /** §7.3 "했음" 카운터 */
  measured?: MeasuredFreq | null;
}): FreqResult {
  const { freqLast7d, cadence, occurrencesPerCycle, measured } = input;

  // 0. 실측이 있으면 무조건 실측. 다른 신호를 보지 않는다
  if (measured && measured.promoted) {
    return { perMonth: measured.perMonth, source: 'counter', coverage: 1, needsMeasurement: false };
  }

  const hasFreq =
    typeof freqLast7d === 'number' && Number.isFinite(freqLast7d) && freqLast7d >= 0;
  const cadenceKnown = cadence != null && cadence !== 'per-event';

  // 1. ★ D-086 — 회상창보다 주기가 길면 freqLast7d를 무시한다.
  //    "지난 7일 동안 0번"은 월마감에서 데이터가 아니라 달력의 결과다.
  if (cadenceKnown && CADENCE_PERIOD_DAYS[cadence] > RECALL_WINDOW_DAYS) {
    return {
      perMonth: CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1),
      source: 'cadence',
      coverage: 0.8,
      needsMeasurement: false,
    };
  }

  // 2. 사건 구동은 주기가 없다. 7일 회상이 유일한 신호다
  if (cadence === 'per-event') {
    if (!hasFreq) return { perMonth: 0, source: 'none', coverage: 0, needsMeasurement: true };
    return {
      perMonth: freqLast7d! * WEEKS_PER_MONTH,
      source: 'measured-7d',
      coverage: 0.7,
      needsMeasurement: false,
    };
  }

  // 3. 둘 다 있다 — 실제로 가장 자주 일어나는 경우
  if (hasFreq && cadenceKnown) {
    const fromFreq = freqLast7d! * WEEKS_PER_MONTH;
    const fromCad = CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1);
    const hi = Math.max(fromFreq, fromCad);
    const lo = Math.min(fromFreq, fromCad);
    const ratio = lo === 0 ? Number.POSITIVE_INFINITY : hi / lo;

    if (ratio <= 1.5) {
      return {
        perMonth: (fromFreq + fromCad) / 2,
        source: 'both-agree',
        coverage: 0.95,
        needsMeasurement: false,
      };
    }
    // ★ 불일치 → 낮은 쪽. Value는 곱셈이라 과대 추정이 순위를 통째로 뒤집는다.
    //   과소 추정으로 놓치는 후보는 실측 승격(§7.3)에서 회수된다.
    return {
      perMonth: lo,
      source: 'both-conflict',
      coverage: 0.4,
      conflictRatio: Number.isFinite(ratio) ? ratio : 99,
      needsMeasurement: ratio > 3,
    };
  }

  if (hasFreq) {
    return {
      perMonth: freqLast7d! * WEEKS_PER_MONTH,
      source: 'measured-7d',
      coverage: 0.7,
      needsMeasurement: false,
    };
  }
  if (cadenceKnown) {
    return {
      perMonth: CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1),
      source: 'cadence',
      coverage: 0.6,
      needsMeasurement: false,
    };
  }
  return { perMonth: 0, source: 'none', coverage: 0, needsMeasurement: true };
}

/* ── N_people — 넷 다 틀리는 신호를 결합한다 ─────────────────────────────── */

export type PeopleSignals = {
  /** ① 그룹에 실제 기여한 서로 다른 사람 수 (fork 형제는 1명으로 접는다). 과소 편향 */
  observedContributors: number;
  /** ② 기여자들의 자기보고 "나 말고 N명". 과대 편향 → 중앙값만 쓴다 */
  selfReportedPeers: readonly number[];
  /** ③ 같은 시드 템플릿에서 파생된 문서의 서로 다른 소유자 수 */
  seedSiblingOwners: number;
  /** ④ 같은 부서·직무 인원수. 과대이지만 **물리적 상한**이라 하드 캡으로 쓴다 */
  roleCohortSize: number | null;
};

export type PeopleResult = { nPeople: number; coverage: number; basis: string };

export function resolveNPeople(s: PeopleSignals): PeopleResult {
  const observed = Math.max(1, s.observedContributors, s.seedSiblingOwners);

  // 자기보고는 중앙값. 평균은 "부서 전원 30명" 한 명이 전체를 끌어올린다
  const claimed =
    s.selfReportedPeers.length > 0 ? median(s.selfReportedPeers) + 1 : null; // "나 말고 N명" → 나 포함

  const cap = s.roleCohortSize ?? Number.POSITIVE_INFINITY;

  // 실측이 하한, 역할 코호트가 상한, 자기보고는 그 사이에서만 발언권이 있다
  let n = observed;
  if (claimed !== null) n = Math.max(observed, Math.min(claimed, cap));
  n = Math.max(observed, Math.min(n, cap));

  const signals =
    (s.observedContributors > 1 ? 1 : 0) +
    (s.selfReportedPeers.length > 0 ? 1 : 0) +
    (s.seedSiblingOwners > 1 ? 1 : 0) +
    (s.roleCohortSize != null ? 1 : 0);
  const coverage = signals === 0 ? 0.2 : Math.min(0.9, 0.3 + 0.2 * signals);

  const basis =
    claimed === null
      ? `기여자 ${observed}명 실측`
      : claimed > observed
        ? `기여자 ${observed}명 + 자기보고 ${claimed}명`
        : `기여자 ${observed}명 (자기보고보다 많음)`;

  return { nPeople: Math.round(n), coverage: clamp01(coverage), basis };
}

/**
 * L2가 만드는 유일한 Volume — 언제나 per-person이다.
 * `freqLast7d`는 **개인이 자기 손으로 한 횟수**이므로 조직 합계가 될 수 없다.
 */
export function volumeFromStep(freq: FreqResult, people: PeopleResult): Volume {
  return perPersonVolume(freq.perMonth, people.nPeople);
}

/**
 * packages/scoring/src/value.ts
 *
 *   Value = (T_touch × F × N_people × 12 × Rate) × SaveRate + LeadTimeValue + RiskValue
 *
 * ── 이 파일이 지키는 것 ─────────────────────────────────────────────────────
 *  · 인원은 `annualEvents(volume)`만 통과한다 (D-084). 여기에 `nPeople`이 없다.
 *  · **RiskValue의 기본값은 0이 아니라 `unpriced`다** (D-117). 0으로 접으면
 *    리드타임 가치가 큰 후보(SEED D-2)가 조용히 순위에서 사라진다.
 *  · 미산정 항이 하나라도 있으면 합계에 "이상"이 붙는다. 화면 문구가 아니라
 *    `ValueBreakdown.atLeast` 필드다 — 렌더러가 잊을 수 없게.
 */

import {
  priced,
  sumMoney,
  unpriced,
  type Money,
  type ValueBreakdown,
  type Volume,
} from './types.ts';
import { annualEvents } from './volume.ts';
import type { StabilityDomain } from './feasibility.ts';

/* ── 인시 절감 ────────────────────────────────────────────────────────────── */

export function laborValue(input: {
  /** 건당 기대 실접촉시간 */
  touchH: number;
  volume: Volume;
  rateKrwPerH: number;
  /** SAVE_RATE[level] */
  saveRate: number;
}): Money {
  const perYear = annualEvents(input.volume);
  const krw = input.touchH * perYear * input.rateKrwPerH * input.saveRate;
  return priced(krw, `건당 ${round2(input.touchH)}시간 × 연 ${Math.round(perYear)}건 × 절감률 ${input.saveRate}`);
}

/* ── LeadTimeValue ────────────────────────────────────────────────────────── */

/**
 * 단위지연비용 모델.
 *
 * ★ ANALYTICS-ENGINE §4.1의 원안과 다른 점 하나 — **모델마다 단위가 다르다.**
 *   원안은 모든 모델을 `원/일/건`으로 보고 `deltaDays × 연건수 × per`를 곱했다.
 *   그런데 `customer-wait`의 정의(`재문의 감소건수 × 재문의 처리단가`)는 이미
 *   **건당 총액**이지 일당 단가가 아니다. 거기에 deltaDays(0.15일)를 다시 곱하면
 *   값이 7배 작아진다 — SEED D-3의 손계산(343만 원)이 규칙으로 49만 원이 된다.
 *
 *   그래서 단위를 타입에 실었다. `unit`이 계산식을 고르고, 잘못된 곱셈이
 *   컴파일 단계에서 불가능해진다. (§11의 「단위를 섞으면 3배 틀린다」의 확장)
 */
export type DelayCostModel =
  /** 현금흐름형 — 하루 늦으면 하루치 이자. 진짜로 원/일/건이다 */
  | { kind: 'cash-flow'; avgAmountKrw: number; annualRatePct: number }
  /** 내부생산성형 — 대기 인원이 하루 노는 비용 */
  | { kind: 'internal-productivity'; waitingHeadcount: number; dailyValueKrw: number }
  /** 마감형 — 마감 참여 인원이 하루 덜 붙는다 */
  | { kind: 'deadline'; participants: number; rateKrwPerH: number }
  /** ★ 고객대기형 — 건당 총액이다. 일수로 나누지 않는다 */
  | { kind: 'customer-wait'; reinquiryRate: number; handlingH: number; rateKrwPerH: number }
  /** 규정기한형 — 기한을 지키는 한 단축의 금전 가치는 없다. 의도적으로 0 */
  | { kind: 'statutory' }
  /** ★ 0이 아니라 미산정 */
  | { kind: 'unpriced'; note: string };

export type DelayCostUnit = 'per-day-per-event' | 'per-event' | 'zero' | 'unpriced';

export function delayCostUnit(m: DelayCostModel): DelayCostUnit {
  switch (m.kind) {
    case 'cash-flow':
    case 'internal-productivity':
    case 'deadline':
      return 'per-day-per-event';
    case 'customer-wait':
      return 'per-event';
    case 'statutory':
      return 'zero';
    case 'unpriced':
      return 'unpriced';
  }
}

/** 모델의 단가. 단위는 `delayCostUnit()`이 말한다 */
export function delayCostRate(m: DelayCostModel): number | null {
  switch (m.kind) {
    case 'cash-flow':
      return (m.avgAmountKrw * (m.annualRatePct / 100)) / 365;
    case 'internal-productivity':
      return m.waitingHeadcount * m.dailyValueKrw;
    case 'deadline':
      return m.participants * m.rateKrwPerH * 8;
    case 'customer-wait':
      return m.reinquiryRate * m.handlingH * m.rateKrwPerH;
    case 'statutory':
      return 0;
    case 'unpriced':
      return null; // ★ null이 파이프라인 끝까지 간다. 0으로 접지 않는다
  }
}

export type LeadTimeResult = { money: Money; deltaDays: number };

/**
 * 리드타임은 **달력 시간**이다. `avgWaitH = 24`가 하루를 뜻하므로 `/24`가 맞다.
 * 반면 `dailyValueKrw`는 근무시간 기준이라 `Rate × 8`이다. 이 둘을 섞으면 3배 틀린다.
 */
export function leadTimeValue(input: {
  beforeH: number;
  afterH: number;
  volume: Volume;
  model: DelayCostModel;
}): LeadTimeResult {
  const deltaDays = Math.max(0, (input.beforeH - input.afterH) / 24);
  const perYear = annualEvents(input.volume);
  const unit = delayCostUnit(input.model);
  const rate = delayCostRate(input.model);

  if (unit === 'unpriced' || rate === null) {
    const note =
      input.model.kind === 'unpriced'
        ? input.model.note
        : `리드타임이 ${fmtDays(deltaDays)} 줄지만, 그 가치를 계산할 정보가 없어요`;
    return { money: unpriced(note), deltaDays };
  }

  if (deltaDays <= 0) {
    return { money: priced(0, '리드타임이 줄지 않아요'), deltaDays: 0 };
  }

  const krw = unit === 'per-day-per-event' ? deltaDays * perYear * rate : perYear * rate;

  return {
    money: priced(
      krw,
      unit === 'per-day-per-event'
        ? `${fmtDays(deltaDays)} 단축 × 연 ${Math.round(perYear)}건`
        : `연 ${Math.round(perYear)}건의 되묻기가 사라짐`,
    ),
    deltaDays,
  };
}

/**
 * 자동화 후 리드타임 추정 — 단계 유형별 결정적 규칙 4개.
 * "AI가 예측"하지 않는다. 각 규칙은 근거 한 줄과 함께 나간다.
 */
export type LeadTimeStep = {
  kind: 'task' | 'hold';
  waitFor?: 'approval' | 'reply' | 'time' | 'resource';
  reachProbability: number;
  expectedPasses: number;
  touchH: number;
  waitH: number;
  /** 이 단계의 SaveRate (SAVE_RATE[level]) */
  saveRate: number;
};

export function estimatedLeadTimeAfterH(steps: readonly LeadTimeStep[]): number {
  let after = 0;
  for (const n of steps) {
    const w = n.reachProbability * n.expectedPasses;
    if (n.kind === 'hold') {
      // R1. 자원·시각 대기는 자동화해도 안 줄어든다. 세상이 기다리는 시간이다
      if (n.waitFor === 'time' || n.waitFor === 'resource') {
        after += w * n.waitH;
        continue;
      }
      // R2. 응답 대기는 자동 재촉/알림으로 절반까지 준다 (보수적)
      if (n.waitFor === 'reply') {
        after += w * n.waitH * 0.5;
        continue;
      }
      // R3. 승인 대기는 알림 자동화만으로는 안 줄어든다. 줄이려면 ECRS다
      //     → 여기서는 그대로 두고 제거 후보 쪽에서 값을 잡는다 (이중 계산 금지)
      after += w * n.waitH;
      continue;
    }
    // R4. 작업 단계는 자동화 수준만큼 접촉시간이 줄고, 줄어든 만큼 리드타임도 준다
    after += w * n.touchH * (1 - n.saveRate);
  }
  return after;
}

/* ── RiskValue — 기본은 미산정이다 (D-117) ───────────────────────────────── */

/** 법정 가산세·과태료 — 금액이 법령에 있으므로 우리가 지어내지 않는다 */
export type StatutoryPenalty = {
  code: string;
  label: string;
  basis: { kind: 'rate'; pct: number } | { kind: 'fixed'; krw: number };
  applies: readonly StabilityDomain[];
};

export const STATUTORY_PENALTIES: readonly StatutoryPenalty[] = [
  {
    code: 'tax-invoice-late',
    label: '세금계산서 지연발급 가산세',
    basis: { kind: 'rate', pct: 1 },
    applies: ['statutory', 'accounting'],
  },
  {
    code: 'tax-invoice-none',
    label: '세금계산서 미발급 가산세',
    basis: { kind: 'rate', pct: 2 },
    applies: ['statutory', 'accounting'],
  },
  {
    code: 'insurance-late',
    label: '4대보험 신고 지연 과태료',
    basis: { kind: 'fixed', krw: 30_000 },
    applies: ['statutory'],
  },
];

export type RiskInput = {
  domain: StabilityDomain | null;
  /** 이 프로세스에서 실제로 실수가 난 빈도. 모르면 null — 0이 아니다 */
  incidentRatePerEvent: number | null;
  avgAmountKrw: number | null;
  volume: Volume;
  /** 조직이 직접 입력한 리스크 금액. 사람이 채운 값이면 그대로 쓴다 */
  manualKrwPerYear: number | null;
};

/**
 * 리스크는 무한히 부풀릴 수 있다. *"고객을 잃을 수도 있으니 연 1억"* 이 한 번
 * 리포트에 실리면 그 리포트 전체가 죽는다. **자동 산출은 금액이 법으로 정해진
 * 경우에만 한다.**
 *
 * 절대 하지 않는 것 셋:
 *   ① 재작업 비용을 여기 넣지 않는다 — 이미 `expectedPasses`로 T_touch에 있다
 *   ② 평판·이탈 손실을 자동 계산하지 않는다
 *   ③ "사고가 안 난 것"을 절감으로 세지 않는다 — 사고율 0이 아니라 **미산정**이다
 */
export function riskValue(x: RiskInput): Money {
  // 1. 사람이 넣은 값이 있으면 그것이 이긴다. 우리가 추정하지 않는다
  if (x.manualKrwPerYear != null) {
    return priced(x.manualKrwPerYear, '직접 입력한 값');
  }

  // 2. 법정 벌칙 — 도메인 + 사고율 + 금액이 셋 다 있을 때만
  const p = x.domain
    ? STATUTORY_PENALTIES.find((q) => q.applies.includes(x.domain!))
    : undefined;

  if (p && x.incidentRatePerEvent != null) {
    const perEvent =
      p.basis.kind === 'fixed'
        ? p.basis.krw
        : x.avgAmountKrw != null
          ? x.avgAmountKrw * (p.basis.pct / 100)
          : null;
    if (perEvent != null) {
      const perYear = annualEvents(x.volume);
      return priced(
        x.incidentRatePerEvent * perYear * perEvent,
        `${p.label} 회피 (100번 중 ${round2(x.incidentRatePerEvent * 100)}번 발생 기준)`,
      );
    }
    return unpriced(`${p.label} — 건당 금액을 넣으면 계산돼요`);
  }

  // 3. ★ 그 외 전부 미산정. 0이 아니다
  return unpriced('실수가 났을 때의 비용 — 아직 계산하지 않았어요');
}

/* ── 합성 ─────────────────────────────────────────────────────────────────── */

export function composeValue(parts: {
  labor: Money;
  leadTime: Money;
  risk: Money;
}): ValueBreakdown {
  const { krw, unpriced: missing, atLeast } = sumMoney([parts.labor, parts.leadTime, parts.risk]);
  return {
    labor: parts.labor,
    leadTime: parts.leadTime,
    risk: parts.risk,
    totalKrw: krw,
    unpriced: missing,
    atLeast,
  };
}

/**
 * Priority = Value × Feasibility × Confidence (PRD §4.8).
 *
 * 정렬은 `priorityP10Krw`로 한다 (D-090) — 상한 정렬은 가장 불확실한 후보를
 * 1위로 올린다. 여기서 P10은 "미산정 항을 뺀, 접촉시간 하한 기준" 값이다.
 */
export function priority(value: number, feasibility: number, confidence: number): number {
  return value * feasibility * confidence;
}

/* ── 표기 ─────────────────────────────────────────────────────────────────── */

/**
 * "계산 안 함"과 "0원"은 다르게 보여야 한다.
 * 0원은 "가치 없음"이고 미산정은 "우리가 모름"이다.
 */
export function formatMoney(m: Money): string {
  return m.kind === 'priced' ? `${fmtKrw(m.krw)}` : '계산 안 함';
}

export function fmtKrw(krw: number): string {
  const man = krw / 10_000;
  if (man >= 10_000) return `${round2(man / 10_000)}억 원`;
  if (man >= 1) return `${Math.round(man).toLocaleString('ko-KR')}만 원`;
  return `${Math.round(krw).toLocaleString('ko-KR')}원`;
}

export function fmtDays(d: number): string {
  if (d >= 1) return `${round1(d)}일`;
  const h = d * 24;
  if (h >= 1) return `${round1(h)}시간`;
  return `${Math.round(h * 60)}분`;
}

export function fmtHours(h: number): string {
  if (h >= 8) return `${round1(h / 8)}일(근무일 기준)`;
  if (h >= 1) return `${round1(h)}시간`;
  return `${Math.round(h * 60)}분`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

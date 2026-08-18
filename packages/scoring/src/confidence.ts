/**
 * packages/scoring/src/confidence.ts — 신뢰도의 가법 분해 (D-115 · D-008).
 *
 * ── 왜 가법인가 ────────────────────────────────────────────────────────────
 *  `0.5 / 0.75 / 1.0`은 세 개의 라벨이지만 승격은 **부분적으로** 일어난다.
 *  가장 흔한 상태는 **빈도만 실측되고 시간은 자가추정**인 상태다.
 *  그때 0.5도 1.0도 정직하지 않다.
 *
 * ── 그리고 그 비대칭은 영구적이다 (D-115) ─────────────────────────────────
 *  빈도는 "했음" 탭으로 셀 수 있다. 사람이 자기 손으로 누른다.
 *  시간은 스톱워치를 붙여야 세지는데, **스톱워치를 만들지 않기로 했다** —
 *  붙이는 순간 D-002가 막으려는 것과 같은 감시 도구가 되기 때문이다.
 *
 *  그래서 `durationMeasured`는 대부분의 후보에서 **영원히 false**다.
 *  이 사실을 숨기지 않고 `timeIsSelfReported`로 표면에 올린다.
 *  숨기면 리포트가 "실측"이라고 말하면서 실은 기억을 근거로 삼게 된다.
 */

import { bandDistance } from './duration.ts';
import {
  median,
  type Confidence,
  type ConfidenceEvidence,
  type ConfidenceLabel,
  type DurationBand,
  type DurationEvidence,
  type FrequencyEvidence,
} from './types.ts';

export const CONFIDENCE_BASE = 0.5;

export const CONFIDENCE_DELTA = {
  peerAgreement: 0.25,
  freqMeasured: 0.25,
  durationMeasured: 0.25,
  /** 작은 가산. 라벨을 바꾸지 않는다 */
  saveRateConfirmed: 0.05,
} as const;

/** 빈도가 실측되었는가 — 승격된 카운터 세션만 인정한다 */
export function isFrequencyMeasured(e: FrequencyEvidence): boolean {
  return e.kind === 'counter' && e.promoted;
}

/**
 * 시간이 실측되었는가.
 *
 * ★ `checklist-proxy` **하나뿐**이고, 그것도 짧은 흐름에서만 성립한다.
 *   체크리스트 시작~완료 간격은 원래 **리드타임**이지 접촉시간이 아니다.
 *   단계 5개 이하 · 예상 리드타임 1시간 이하일 때만 접촉시간의 근사로 쓴다 (§7.4).
 *
 *   `retrospective`(2주 세션 마지막 날 1문항)는 자가추정보다 신선하지만
 *   여전히 **사람이 기억으로 답한 값**이다. 실측으로 세지 않는다.
 */
export function isDurationMeasured(e: DurationEvidence): boolean {
  return e.kind === 'checklist-proxy' && e.stepCount <= 5 && e.leadTimeH <= 1;
}

/** 신선도 감쇠 — ASSEMBLY의 링크 신선도와 **같은 계수**를 쓴다. 두 벌을 만들지 않는다 */
export function freshnessDecay(daysSinceConfirmed: number | null): number {
  if (daysSinceConfirmed == null) return 1;
  if (daysSinceConfirmed > 365) return 0.7;
  if (daysSinceConfirmed > 180) return 0.85;
  return 1;
}

export function confidenceLabel(value: number): ConfidenceLabel {
  return value >= 0.95 ? '실측' : value >= 0.7 ? '동료 확인' : '본인 추정';
}

/**
 * 세 라벨은 이 가법 구조의 **대표점**이다:
 *   자가추정만            = 0.50
 *   동료합의              = 0.75
 *   동료합의 + 빈도 실측   = 1.00
 *   빈도 + 시간 실측       = 1.00
 */
export function confidence(e: ConfidenceEvidence): Confidence {
  const parts: { key: string; delta: number; because: string }[] = [];
  let c = CONFIDENCE_BASE;

  if (e.peerAgreement) {
    c += CONFIDENCE_DELTA.peerAgreement;
    parts.push({
      key: 'peerAgreement',
      delta: CONFIDENCE_DELTA.peerAgreement,
      because: '여러 사람이 따로 적었는데 내용이 비슷해요',
    });
  }

  const freqMeasured = isFrequencyMeasured(e.frequency);
  if (freqMeasured) {
    c += CONFIDENCE_DELTA.freqMeasured;
    const f = e.frequency as Extract<FrequencyEvidence, { kind: 'counter' }>;
    parts.push({
      key: 'freqMeasured',
      delta: CONFIDENCE_DELTA.freqMeasured,
      because: `${f.answeredDays}일 동안 ${f.observedEvents}번 하신 걸 직접 세어주셨어요`,
    });
  }

  const durationMeasured = isDurationMeasured(e.duration);
  if (durationMeasured) {
    c += CONFIDENCE_DELTA.durationMeasured;
    parts.push({
      key: 'durationMeasured',
      delta: CONFIDENCE_DELTA.durationMeasured,
      because: '체크리스트로 진행한 기록이 있어요',
    });
  }

  if (e.saveRateConfirmed) {
    c += CONFIDENCE_DELTA.saveRateConfirmed;
    parts.push({
      key: 'saveRateConfirmed',
      delta: CONFIDENCE_DELTA.saveRateConfirmed,
      because: '어떻게 하는 일인지 직접 확인해주셨어요',
    });
  }

  const decay = freshnessDecay(e.daysSinceConfirmed);
  const value = Math.min(1, c) * decay;

  return {
    value,
    label: confidenceLabel(value),
    parts,
    timeIsSelfReported: !durationMeasured,
    decay,
  };
}

/* ── 7.2 동료 합의 ────────────────────────────────────────────────────────── */

export type PeerMember = {
  docId: string;
  ownerId: string;
  forkOfDocId: string | null;
  /** 이 사람이 다른 멤버 문서를 열람한 적이 있는가 (열람 로그) */
  viewedOthers: boolean;
  band: DurationBand | null;
  freqPerMonth: number | null;
  /** 정규화 단계 라벨 집합 */
  stepSet: ReadonlySet<string>;
};

/**
 * ★ 독립 기여자의 정의 — 이 함수가 §7.2의 핵심이다.
 *   아무 정의나 쓰면 fork로 복제한 문서 3개가 "합의"로 잡힌다.
 */
export function independentMembers(members: readonly PeerMember[]): PeerMember[] {
  const seenForkRoots = new Set<string>();
  const out: PeerMember[] = [];
  for (const m of members) {
    // ① fork 형제는 1명으로 접는다. 복제본 3개는 합의가 아니라 복사다
    const root = m.forkOfDocId ?? m.docId;
    if (seenForkRoots.has(root)) continue;
    seenForkRoots.add(root);
    // ② 남의 문서를 보고 쓴 사람은 독립 관측이 아니다
    if (m.viewedOthers) continue;
    out.push(m);
  }
  return out;
}

export type PeerAgreementResult = {
  agreed: boolean;
  independentCount: number;
  because: string;
  /** 합의가 안 된 축 — 이것 자체가 §6.3 변동성 리포트의 산출물이다 */
  disagreeAxes: readonly string[];
};

export function peerAgreement(members: readonly PeerMember[]): PeerAgreementResult {
  const ind = independentMembers(members);
  if (ind.length < 3) {
    return {
      agreed: false,
      independentCount: ind.length,
      because: `서로 따로 적은 사람이 ${ind.length}명이에요 (3명 필요)`,
      disagreeAxes: [],
    };
  }

  // ① 시간 밴드: 최빈 밴드로부터 ±1밴드 안에 2/3 이상
  const bands = ind.map((m) => m.band).filter((b): b is DurationBand => b != null);
  const modeBand = modeOf(bands);
  const bandOk =
    bands.length >= 3 &&
    modeBand != null &&
    bands.filter((b) => bandDistance(b, modeBand) <= 1).length / bands.length >= 2 / 3;

  // ② 빈도: 중앙값의 ±50% 안에 2/3 이상
  const freqs = ind.map((m) => m.freqPerMonth).filter((v): v is number => v != null);
  const medF = median(freqs);
  const freqOk =
    freqs.length >= 3 &&
    freqs.filter((f) => f >= medF * 0.5 && f <= medF * 1.5).length / freqs.length >= 2 / 3;

  // ③ 단계 구성: 평균 쌍별 Jaccard ≥ 0.6
  const stepOk = meanPairwiseJaccard(ind.map((m) => m.stepSet)) >= 0.6;

  const disagreeAxes = [
    !bandOk ? '걸리는 시간' : null,
    !freqOk ? '횟수' : null,
    !stepOk ? '단계 구성' : null,
  ].filter((v): v is string => v !== null);

  const agreed = bandOk && freqOk && stepOk;
  return {
    agreed,
    independentCount: ind.length,
    because: agreed
      ? `${ind.length}명이 따로 적었는데 내용이 비슷해요`
      : `${ind.length}명이 적었지만 ${disagreeAxes.join('·')}이(가) 서로 달라요`,
    disagreeAxes,
  };
}

/* ── 7.3 실측 승격 — "했음" 탭 카운터 ────────────────────────────────────── */

export type CounterState = {
  workdaysElapsed: number;
  /** 0도 답이다. 응답한 날 */
  answeredDays: number;
  totalEvents: number;
  /** 자가추정으로 예측한 2주치 건수 */
  expectedEvents: number;
};

export const PROMOTION_RULES = {
  minAnsweredDays: 6,
  minEventsHighFreq: 10,
  minCoverageLowFreq: 0.6,
  lowFreqThreshold: 10,
} as const;

export type PromotionVerdict =
  | { promoted: true; measuredPerMonth: number; reason: 'ok'; copy: string }
  | {
      promoted: false;
      reason: 'not-enough-days' | 'fewer-than-expected';
      copy: string;
      downgradeFreq?: boolean;
    };

export function evaluatePromotion(s: CounterState): PromotionVerdict {
  const R = PROMOTION_RULES;
  if (s.answeredDays < R.minAnsweredDays) {
    return {
      promoted: false,
      reason: 'not-enough-days',
      copy: `${s.answeredDays}일 답해주셨어요. ${R.minAnsweredDays}일이면 정확한 값으로 바꿀 수 있어요`,
    };
  }
  const lowFreq = s.expectedEvents < R.lowFreqThreshold;
  const ok = lowFreq
    ? s.totalEvents >= s.expectedEvents * R.minCoverageLowFreq
    : s.totalEvents >= R.minEventsHighFreq;

  if (!ok) {
    // ★ 관측이 예상보다 훨씬 적다 = "안 하는 일"이라는 정보다. 실패가 아니다
    return {
      promoted: false,
      reason: 'fewer-than-expected',
      copy: '생각보다 자주 하는 일이 아니었네요. 순위를 다시 계산할게요',
      downgradeFreq: true,
    };
  }

  // 근무일 → 월 환산. 관측일 기준이지 달력 기준이 아니다
  const perMonth = (s.totalEvents / s.answeredDays) * 21.7;
  return {
    promoted: true,
    measuredPerMonth: perMonth,
    reason: 'ok',
    copy: `2주 동안 ${s.totalEvents}번 하셨어요`,
  };
}

/* ── 유틸 ─────────────────────────────────────────────────────────────────── */

function modeOf<T>(xs: readonly T[]): T | null {
  if (xs.length === 0) return null;
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function meanPairwiseJaccard(sets: readonly ReadonlySet<string>[]): number {
  if (sets.length < 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      sum += jaccard(sets[i]!, sets[j]!);
      n++;
    }
  }
  return n === 0 ? 1 : sum / n;
}

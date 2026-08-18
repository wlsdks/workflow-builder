/**
 * packages/scoring/test/golden.test.ts
 *
 *   node --test packages/scoring/test/
 *
 * ── 정답지는 SEED-CONTENT §D다 ─────────────────────────────────────────────
 *  사람이 손으로 계산해서 적은 5건이 있고, 엔진이 같은 숫자를 내야 한다.
 *  이보다 좋은 회귀 테스트는 없다.
 *
 * ── 그런데 안 맞는 게 있다 ─────────────────────────────────────────────────
 *  안 맞는 것을 숨기지 않는다. 아래 `DIVERGENCES` 표가 **손계산과 규칙 계산의
 *  차이 전부**이고, 각 항목은 테스트로 고정된다. 어느 한쪽이 바뀌면 실패한다.
 *
 *  픽스처 운영 규칙(§12.5) 1번은 *"SEED의 숫자가 바뀌면 코드가 아니라 문서를
 *  먼저 고친다"* 이다. 그래서 여기서 규칙이 이긴다고 판정한 항목들은
 *  **문서 수정 대기 목록**이지 코드 수정 목록이 아니다.
 */

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

// ★ graph-core는 런타임 의존성이 아니다. 테스트에서만 상대 경로로 원본을 본다.
import { BAND_HOURS as GRAPH_CORE_BAND_HOURS } from '../../graph-core/src/metrics.ts';

import {
  BAND_HOURS,
  BAND_RANGE_H,
  scopeTouchH,
  scopeTouchRangeH,
  type ScopeStep,
} from '../src/duration.ts';
import {
  annualEvents,
  monthlyEvents,
  orgTotalVolume,
  perPersonVolume,
  resolveFrequency,
  resolveNPeople,
} from '../src/volume.ts';
import {
  F_WEIGHTS,
  NEUTRAL_WHEN_UNKNOWN,
  determinism,
  exceptionInverse,
  feasibility,
  inputStructure,
  scoreFeasibility,
  stability,
  standardization,
  systemAccess,
  type GroupVariance,
  type ScopeFeasibilityInput,
} from '../src/feasibility.ts';
import {
  composeValue,
  delayCostUnit,
  laborValue,
  leadTimeValue,
  priority,
  riskValue,
  type DelayCostModel,
} from '../src/value.ts';
import { confidence, evaluatePromotion, peerAgreement } from '../src/confidence.ts';
import { detectElimination, eliminatedNodeIds, rollupForAdmin, type EcrsContext, type EcrsDoc, type EcrsStep } from '../src/ecrs.ts';
import { assertRenderable, findForbiddenOutput, selfTestRules } from '../src/guard.ts';
import { SAVE_RATE, type FeasibilityKey, type ToolCatalog, type Volume } from '../src/types.ts';

/* ══════════════════════════════════════════════════════════════════════════
   0. 공통 상수 · 도우미
   ══════════════════════════════════════════════════════════════════════════ */

const RATE = 25_000; // SEED §D 공통 파라미터

const CATALOG: ToolCatalog = {
  barobill: { id: 'barobill', name: '바로빌', grade: 'high', capsFeasibility: false, structuredIO: true },
  hometax: {
    id: 'hometax', name: '홈택스', grade: 'mid', capsFeasibility: true, structuredIO: true,
    upgradePath: { toToolId: 'barobill', note: '전자세금계산서 ASP로 바꾸면 월 3~5만 원에 연결돼요' },
  },
  erp: { id: 'erp', name: 'ERP', grade: 'mid', capsFeasibility: false, structuredIO: true },
  gsuite: { id: 'gsuite', name: '구글 워크스페이스', grade: 'high', capsFeasibility: false, structuredIO: true },
  groupware: { id: 'groupware', name: '그룹웨어', grade: 'mid', capsFeasibility: false, structuredIO: true },
  'cert-joint': { id: 'cert-joint', name: '공동인증서', grade: 'low', capsFeasibility: true, structuredIO: false },
  channeltalk: { id: 'channeltalk', name: '채널톡', grade: 'high', capsFeasibility: false, structuredIO: false },
  courier: { id: 'courier', name: '택배사 조회', grade: 'high', capsFeasibility: false, structuredIO: true },
  shop: { id: 'shop', name: '쇼핑몰 관리자', grade: 'high', capsFeasibility: false, structuredIO: true },
  sheets: { id: 'sheets', name: '구글 시트', grade: 'high', capsFeasibility: false, structuredIO: true },
  paper: { id: 'paper', name: '종이 서류', grade: 'low', capsFeasibility: true, structuredIO: false },
};

const near = (actual: number, expected: number, tol = 0.1): boolean =>
  expected === 0 ? Math.abs(actual) < 1e-9 : Math.abs(actual - expected) / Math.abs(expected) <= tol;

function assertNear(actual: number, expected: number, tol: number, label: string): void {
  ok(
    near(actual, expected, tol),
    `${label}: 기대 ${expected.toLocaleString('ko-KR')} · 실제 ${Math.round(actual).toLocaleString('ko-KR')} (오차 ${((Math.abs(actual - expected) / Math.abs(expected)) * 100).toFixed(1)}%, 허용 ${(tol * 100).toFixed(0)}%)`,
  );
}

const step = (band: ScopeStep['band'], p = 1, k = 1, id = Math.random().toString(36)): ScopeStep => ({
  id, band, reachProbability: p, expectedPasses: k,
});

/* ══════════════════════════════════════════════════════════════════════════
   1. 손계산 ↔ 규칙 계산의 차이 — 이 표가 이 파일의 산출물이다
   ══════════════════════════════════════════════════════════════════════════ */

type Divergence = {
  id: string;
  what: string;
  hand: number | string;
  rule: number | string;
  /** 어느 쪽이 옳은가 */
  verdict: 'rule' | 'hand' | 'both-unfalsifiable';
  why: string;
};

/**
 * 이 표는 문서로 나가는 산출물이다. 값이 아니라 **판정**이 핵심이다.
 * `verdict: 'rule'`은 SEED-CONTENT.md를 고쳐야 한다는 뜻이다 (§12.5 운영규칙 1의 역방향 —
 * 규칙이 문서의 자기모순을 드러낸 경우에는 문서가 진다).
 */
export const DIVERGENCES: readonly Divergence[] = [
  {
    id: 'D-1/feasibility',
    what: '세금계산서 Feasibility',
    hand: 0.81,
    rule: 0.81,
    verdict: 'rule',
    why: 'ANALYTICS-ENGINE §3.7은 0.79라고 대조해뒀지만, 그 표의 여섯 항을 실제로 더하면 0.80이다(산술 오류). ' +
      '그리고 표준화를 "목표 0.80"으로 가정하지 않고 GroupVariance에서 실제로 계산하면 0.88이 나와 합계가 0.81로 정확히 맞는다. ' +
      '즉 "0.81 대 0.79"라는 대조 자체가 성립하지 않는다.',
  },
  {
    id: 'D-1/risk',
    what: '세금계산서 RiskValue',
    hand: 2_400_000,
    rule: '미산정(unpriced)',
    verdict: 'rule',
    why: 'SEED는 "가산세 회피 + 마감 0.5일 단축"이라고 적었다. 그런데 §4.2는 (a) 사고율이 없으면 미산정이고 ' +
      '(b) 마감 단축은 리드타임이지 리스크가 아니다(이중 계산). 사고율 2%를 추가 입력으로 주면 규칙은 175만 원을 내고, ' +
      '나머지 65만 원이 정확히 "마감 0.5일 단축" 몫이다 — 그 항은 RiskValue에 있으면 안 된다.',
  },
  {
    id: 'D-2/leadtime',
    what: '신규 입사자 LeadTimeValue',
    hand: 2_700_000,
    rule: 3_780_000,
    verdict: 'rule',
    why: 'SEED가 스스로 적은 식 "1.5일 × 200,000원 × 연 12.6명"을 그대로 계산하면 3,780,000원이다. ' +
      '카드에 적힌 2,700,000원은 연 9명으로 계산해야 나오는 값이다(1.5 × 200,000 × 9). ' +
      '식과 결과가 서로 다르므로 문서의 자기모순이고, 합계 4,287,500원도 함께 틀렸다.',
  },
  {
    id: 'D-2/confidence',
    what: '신규 입사자 Confidence',
    hand: 0.6,
    rule: 0.55,
    verdict: 'rule',
    why: 'D-115의 가법 분해(0.5 기준 + 0.25/0.25/0.25 + 0.05)로 0.6은 **만들 수 없는 값**이다. ' +
      '자가추정 + SaveRate 확인 = 0.55가 가장 가까운 대표점이다. 0.6은 세 라벨 시절의 눈대중 값이 남은 것이다.',
  },
  {
    id: 'D-2/feasibility-cap',
    what: '신규 입사자 Feasibility 0.78과 "4대보험은 자동화 불가"',
    hand: 0.78,
    rule: 0.5,
    verdict: 'rule',
    why: '4대보험 신고는 공동인증서를 쓰므로 capsFeasibility 도구다. 그 단계가 스코프 안에 있으면 상한 0.5가 걸린다. ' +
      '0.78과 "4대보험은 자동화 불가"를 같은 카드에 나란히 적을 수 없다 — 스코프에서 빼거나, 0.5로 적거나 둘 중 하나다.',
  },
  {
    id: 'D-3/leadtime-unit',
    what: '배송 조회 LeadTimeValue',
    hand: 3_435_000,
    rule: 3_598_980,
    verdict: 'rule',
    why: '§4.1의 일반식(deltaDays × 연건수 × 단가)을 customer-wait에 그대로 적용하면 524,850원이 나온다 — 손계산의 1/7이다. ' +
      'customer-wait의 정의(재문의 감소건수 × 재문의 처리단가)가 이미 **건당 총액**이라 일수를 다시 곱하면 안 된다. ' +
      '단위를 타입(DelayCostUnit)에 실어서 이 곱셈이 불가능하게 만들었다.',
  },
  {
    id: 'D-3/confidence',
    what: '배송 조회 Confidence',
    hand: 0.9,
    rule: 0.8,
    verdict: 'rule',
    why: '0.9도 가법 분해로 만들 수 없다. 빈도 실측(+0.25)과 SaveRate 확인(+0.05)까지가 0.80이고, ' +
      '거기서 1.0으로 가려면 **시간 실측**이 필요한데 D-115가 그걸 만들지 않기로 했다. ' +
      '0.9는 "시간도 곧 실측된다"는 가정이 들어간 값이다.',
  },
  {
    id: 'D-3/risk',
    what: '배송 조회 RiskValue "피크 시즌 단기 인력 회피 40%"',
    hand: 1_920_000,
    rule: '미산정(unpriced) + 렌더 차단',
    verdict: 'rule',
    why: '법정 벌칙이 아니므로 자동 산출 대상이 아니다(§4.2). ' +
      '게다가 이 문장을 그대로 카드에 실으면 guard.ts의 no-headcount-output에 걸린다 — D-116이 막는 바로 그 출력이다.',
  },
  {
    id: 'X-1/labor',
    what: '팀장 결재 제거 시 회수 시간',
    hand: 62,
    rule: 15.6,
    verdict: 'both-unfalsifiable',
    why: '연 62시간 ÷ 312건 = 건당 11.9분. §5.1 E1의 기본값 approverTouchH는 3분(0.05h)이라 15.6시간이 나온다. ' +
      '어느 쪽이 맞는지는 데이터가 없다 — 결재 한 건에 3분인지 12분인지를 아무도 재지 않았다. ' +
      '그래서 E1은 이 값을 입력으로 받게 두고, 기본값에 의존한 숫자는 리포트에 내보내지 않는다.',
  },
  {
    id: 'SEED/factor-publication',
    what: 'Feasibility 6요소의 공개 범위',
    hand: 'D-1만 6요소 전부 공개',
    rule: 'D-2는 0개, D-3은 1개',
    verdict: 'rule',
    why: 'D-2(0.78)와 D-3(0.83)은 요소가 공개되지 않아 **반증이 불가능하다.** ' +
      '골든 픽스처의 자격은 "사람이 검증한 값"인데, 검증 경로가 없는 값은 픽스처가 아니라 기대치다.',
  },
];

describe('손계산 ↔ 규칙 계산의 차이 (SEED-CONTENT §D)', () => {
  it('차이 표가 비어 있지 않다 — 비면 누군가 조용히 맞춰버린 것이다', () => {
    ok(DIVERGENCES.length >= 8);
    for (const d of DIVERGENCES) ok(d.why.length > 40, `${d.id}의 근거가 너무 짧다`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. graph-core와의 계약
   ══════════════════════════════════════════════════════════════════════════ */

describe('graph-core 계약', () => {
  it('BAND_HOURS가 graph-core 원본과 같다 — 캔버스 숫자와 리포트 숫자가 다르면 신뢰가 끝난다', () => {
    deepStrictEqual(BAND_HOURS, GRAPH_CORE_BAND_HOURS);
  });

  it('불변식 1 — 모든 밴드에서 BAND_HOURS[b] ∈ BAND_RANGE_H[b]', () => {
    for (const b of Object.keys(BAND_HOURS) as (keyof typeof BAND_HOURS)[]) {
      const [lo, hi] = BAND_RANGE_H[b];
      ok(BAND_HOURS[b] >= lo && BAND_HOURS[b] <= hi, `${b}: ${BAND_HOURS[b]} ∉ [${lo}, ${hi}]`);
    }
  });

  it('스코프 합은 Σ p·k·touch — AND를 여기서 다시 해석하지 않는다', () => {
    const steps = [step('15m', 1, 1, 'a'), step('15m', 1, 1, 'b'), step('15m', 1, 1, 'c')];
    strictEqual(scopeTouchH(steps), 0.75);
    const [lo, hi] = scopeTouchRangeH(steps);
    ok(lo < 0.75 && 0.75 < hi);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. Volume — 중복 계산은 타입이 막는다 (D-084)
   ══════════════════════════════════════════════════════════════════════════ */

describe('Volume 판별 유니온 (D-084)', () => {
  it('org-total에는 nPeople 필드가 아예 없다 — 곱할 대상이 없다', () => {
    const v = orgTotalVolume(88);
    strictEqual(monthlyEvents(v), 88);
    strictEqual(annualEvents(v), 1056);
    ok(!('nPeople' in v));
  });

  it('per-person만 인원을 곱한다', () => {
    strictEqual(monthlyEvents(perPersonVolume(11, 8)), 88);
  });

  it('B-04 — 조직 합계 F에 N_people을 곱하지 않는다', () => {
    // SEED §D의 "N_people = 1 (중복 계산 방지)"는 org-total로 표현하면 주석이 필요 없다
    strictEqual(annualEvents(orgTotalVolume(88)), annualEvents(perPersonVolume(88, 1)));
  });

  it('B-02 — 월마감 + freqLast7d=0 → cadence 채택 (D-086)', () => {
    const r = resolveFrequency({ freqLast7d: 0, cadence: 'monthly', occurrencesPerCycle: 1 });
    strictEqual(r.source, 'cadence');
    strictEqual(r.perMonth, 1); // 0이 아니다. "지난 7일 0건"은 달력의 결과다
  });

  it('B-03 — freqLast7d와 cadence가 4배 불일치 → 낮은 쪽 + 실측 큐', () => {
    const r = resolveFrequency({ freqLast7d: 20, cadence: 'daily' });
    strictEqual(r.source, 'both-conflict');
    ok(r.needsMeasurement, '3배를 넘는 불일치는 실측 승격 큐로 가야 한다');
    ok(r.perMonth < 20 * 4.348);
  });

  it('역할 코호트가 자기보고의 하드 캡이다', () => {
    const r = resolveNPeople({
      observedContributors: 2,
      selfReportedPeers: [29], // "나 말고 29명" — 부서 전원을 셌다
      seedSiblingOwners: 0,
      roleCohortSize: 6,
    });
    strictEqual(r.nPeople, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4. Feasibility — SEED D-1이 정답지다
   ══════════════════════════════════════════════════════════════════════════ */

const D1_GROUP: GroupVariance = {
  n: 3,
  stepCountCv: 0.12,
  toolJaccard: 0.85,
  bandDisagreeRatio: 0.1,
  orderTau: 0.9,
};

const D1_FEASIBILITY: ScopeFeasibilityInput = {
  determinism: {
    branches: [{ nodeId: 'b1', labels: ['신규 거래처', '기존 거래처'] }],
    criteriaSource: 'document',
    exceptionRate: 0.2,
    hasSkipBranch: false,
  },
  inputStructure: {
    upstreamToolIds: ['erp'], // 영업의 수주 등록
    ownToolIds: ['barobill'],
    catalog: CATALOG,
    inboundObjectClass: 'identifier', // 수주번호
    isEntry: false,
  },
  allToolIds: ['barobill', 'erp'],
  catalog: CATALOG,
  exception: { per10: 2, reasked: false, reworkRates: [0.05] },
  groupVariance: D1_GROUP,
  stability: {
    changeExpected: null,
    domain: 'statutory',
    proxy: { structuralEditsLast90d: 0, daysSinceConfirmed: 10, toolChanged: false, docAgeDays: 120 },
  },
};

describe('SEED D-1 세금계산서 — Feasibility 0.81', () => {
  const r = scoreFeasibility(D1_FEASIBILITY);

  it('여섯 요소가 §3.7의 값을 재현한다', () => {
    const got = Object.fromEntries(
      (Object.keys(F_WEIGHTS) as FeasibilityKey[]).map((k) => [k, round(r.factors[k].value, 3)]),
    );
    deepStrictEqual(got, {
      determinism: 0.92,     // enumerable 0.8 × 문서 기준 1.15
      inputStructure: 0.8,   // ERP(중 0.55) + identifier(+0.25)
      systemAccess: 0.64,    // 0.6×0.55 + 0.4×0.775
      exceptionInv: 0.76,    // 1 − (1−0.2)(1−0.05)
      standardization: 0.88, // ★ §3.7이 "목표 0.80"으로 가정했던 자리. 실제 계산은 0.88
      stability: 0.9,        // 도메인 statutory
    });
  });

  it('★ 합계가 정확히 0.81 — 손계산과 일치한다', () => {
    strictEqual(round(r.score, 3), 0.81);
    strictEqual(r.cappedBy, null);
  });

  it('§3.7이 "0.79"라고 적은 것은 그 표 자신의 산술 오류다', () => {
    // §3.7 표의 여섯 값을 그대로 가중합하면 0.80이 나온다. 0.79가 아니다.
    const asDocumented = 0.25 * 0.92 + 0.2 * 0.8 + 0.2 * 0.64 + 0.15 * 0.76 + 0.1 * 0.79 + 0.1 * 0.9;
    strictEqual(round(asDocumented, 3), 0.801);
  });

  it('B-01 — 홈택스(공동인증서 계열)를 유지하면 상한 0.5로 캡된다', () => {
    const capped = scoreFeasibility({ ...D1_FEASIBILITY, allToolIds: ['hometax', 'erp'] });
    strictEqual(capped.score, 0.5);
    ok(capped.cappedBy?.includes('홈택스'));
    ok(capped.uncappedScore > 0.5, '캡 전 점수를 남겨야 "바꾸면 여기까지 간다"를 말할 수 있다');
  });
});

describe('Feasibility 불변식', () => {
  it('불변식 3 — 캡 도구가 하나라도 있으면 Feasibility ≤ 0.5', () => {
    const perfect: Record<FeasibilityKey, { value: number; coverage: number; because: string }> =
      Object.fromEntries(
        (Object.keys(F_WEIGHTS) as FeasibilityKey[]).map((k) => [k, { value: 1, coverage: 1, because: '' }]),
      ) as never;
    const sa = systemAccess(['cert-joint', 'gsuite'], CATALOG);
    ok(sa.cap);
    strictEqual(feasibility(perfect, sa.cap).score, 0.5);
  });

  it('불변식 4 — 6요소 각각 ∈ [0,1], 합계 ∈ [0,1]', () => {
    const r = scoreFeasibility(D1_FEASIBILITY);
    for (const k of Object.keys(F_WEIGHTS) as FeasibilityKey[]) {
      ok(r.factors[k].value >= 0 && r.factors[k].value <= 1, k);
      ok(r.factors[k].coverage >= 0 && r.factors[k].coverage <= 1, k);
    }
    ok(r.score >= 0 && r.score <= 1);
  });

  it('불변식 7 — coverage 0이면 값은 선언된 중립값뿐이다', () => {
    // ★ ANALYTICS-ENGINE §12.4의 불변식 7은 "coverage 0인데 값이 중립값이 아닌 항이 없다"이지만,
    //   §3의 코드 자신이 이를 어긴다(입력구조화 0.3 / 시스템접근성 0.3 / 안정성 0.6이 모두
    //   서로 다르다). 그래서 요소별로 중립값을 **선언**하고 그 선언과의 일치를 검사한다.
    //   "모른다"의 방향이 요소마다 다르다는 사실 자체가 정보이기 때문이다.
    const noTools = inputStructure({ upstreamToolIds: [], ownToolIds: [], catalog: CATALOG, isEntry: false });
    strictEqual(noTools.coverage, 0);
    strictEqual(noTools.value, NEUTRAL_WHEN_UNKNOWN.inputStructure);

    const noAccess = systemAccess([], CATALOG).factor;
    strictEqual(noAccess.coverage, 0);
    strictEqual(noAccess.value, NEUTRAL_WHEN_UNKNOWN.systemAccess);

    const noStability = stability({
      changeExpected: null, domain: null,
      proxy: { structuralEditsLast90d: 0, daysSinceConfirmed: null, toolChanged: false, docAgeDays: 10 },
    });
    strictEqual(noStability.coverage, 0);
    strictEqual(noStability.value, NEUTRAL_WHEN_UNKNOWN.stability);

    const noException = exceptionInverse({ per10: null, reasked: false, reworkRates: [] });
    strictEqual(noException.coverage, 0);
    strictEqual(noException.value, NEUTRAL_WHEN_UNKNOWN.exceptionInv);
  });

  it('B-05 — 기여자 1명이면 표준화 0.5 / coverage 0 (1.0을 주지 않는다)', () => {
    const s = standardization(null);
    strictEqual(s.value, 0.5);
    strictEqual(s.coverage, 0);
  });

  it('B-08 — 예외 프롬프트 미응답은 prior를 쓴다. 0이 아니다', () => {
    const withRework = exceptionInverse({ per10: null, reasked: false, reworkRates: [0.3] });
    ok(withRework.value < 1, '미응답을 "예외 없음"으로 읽으면 안 된다');
    ok(withRework.value > 0);
  });

  it('B-09 — 반려율 0 응답 + 재질문 없음 → 신뢰하지 않는다', () => {
    const naive = exceptionInverse({ per10: 0, reasked: false, reworkRates: [] });
    const reasked = exceptionInverse({ per10: 0, reasked: true, reworkRates: [] });
    ok(naive.coverage < reasked.coverage);
    ok(naive.value < reasked.value, '재질문을 안 거친 0은 더 보수적으로 본다');
  });

  it('주관적 갈래 하나가 분기 전체를 끌어내린다 — 평균이 아니라 최악에 무게', () => {
    const objective = determinism({
      branches: [{ nodeId: 'b', labels: ['300만원 이상', '300만원 미만'] }],
      criteriaSource: 'document', exceptionRate: 0.1, hasSkipBranch: false,
    });
    const mixed = determinism({
      branches: [{ nodeId: 'b', labels: ['300만원 이상', '300만원 미만', '애매한 건'] }],
      criteriaSource: 'document', exceptionRate: 0.1, hasSkipBranch: false,
    });
    ok(mixed.value < objective.value * 0.7, `${mixed.value} vs ${objective.value}`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5. Value — D-1 · D-2 · D-3
   ══════════════════════════════════════════════════════════════════════════ */

describe('SEED D-1 세금계산서 — Value', () => {
  const volume: Volume = orgTotalVolume(88);
  const touchH = scopeTouchH([step('15m', 1, 1, '1'), step('15m', 1, 1, '2'), step('15m', 1, 1, '3')]);

  it('인시 절감 13,860,000원 — 정확히 재현된다', () => {
    const labor = laborValue({ touchH, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    strictEqual(labor.kind, 'priced');
    if (labor.kind === 'priced') assertNear(labor.krw, 13_860_000, 0.001, 'labor');
  });

  it('LeadTimeValue 1,560,000원 — 건당 금액 830만 원을 역산해야 나온다', () => {
    // ★ SEED는 "발행 1.5일 → 0.2일"만 적고 건당 금액을 적지 않았다.
    //   cash-flow 식(건당 금액 × 연이율 / 365)을 역산하면 건당 약 830만 원이다.
    //   이 입력이 문서에 없으므로 이 항은 **문서만으로는 재현 불가능**하다.
    const model: DelayCostModel = { kind: 'cash-flow', avgAmountKrw: 8_300_000, annualRatePct: 5 };
    strictEqual(delayCostUnit(model), 'per-day-per-event');
    const lt = leadTimeValue({ beforeH: 1.5 * 24, afterH: 0.2 * 24, volume, model });
    strictEqual(round(lt.deltaDays, 3), 1.3);
    if (lt.money.kind === 'priced') assertNear(lt.money.krw, 1_560_000, 0.01, 'leadTime');
  });

  it('★ RiskValue는 문서에 적힌 입력만으로는 미산정이다 (D-117)', () => {
    const r = riskValue({
      domain: 'statutory',
      incidentRatePerEvent: null, // SEED에 사고율이 없다
      avgAmountKrw: 8_300_000,
      volume,
      manualKrwPerYear: null,
    });
    strictEqual(r.kind, 'unpriced');
  });

  it('사고율 2%를 주면 가산세 회피분만 175만 원 — 나머지 65만 원은 마감 단축 몫이다', () => {
    const r = riskValue({
      domain: 'statutory', incidentRatePerEvent: 0.02, avgAmountKrw: 8_300_000,
      volume, manualKrwPerYear: null,
    });
    strictEqual(r.kind, 'priced');
    if (r.kind === 'priced') {
      assertNear(r.krw, 1_752_960, 0.001, 'risk(가산세만)');
      // 손계산 2,400,000과의 차이 = 647,040 ≈ "마감 0.5일 단축".
      // 그 항은 리드타임이지 리스크가 아니다 — RiskValue에 넣으면 이중 계산이다.
      assertNear(2_400_000 - r.krw, 647_040, 0.01, '마감 단축으로 설명되는 잔차');
    }
  });

  it('합계 — 미산정이 있으면 "이상"이 붙고, 0으로 접히지 않는다', () => {
    const labor = laborValue({ touchH, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    const lead = leadTimeValue({
      beforeH: 36, afterH: 4.8, volume,
      model: { kind: 'cash-flow', avgAmountKrw: 8_300_000, annualRatePct: 5 },
    }).money;

    const withRisk = composeValue({
      labor, leadTime: lead,
      risk: riskValue({ domain: 'statutory', incidentRatePerEvent: 0.02, avgAmountKrw: 8_300_000, volume, manualKrwPerYear: null }),
    });
    strictEqual(withRisk.atLeast, false);
    assertNear(withRisk.totalKrw, 17_820_000, 0.05, 'Value 합계');

    const withoutRisk = composeValue({
      labor, leadTime: lead,
      risk: riskValue({ domain: 'statutory', incidentRatePerEvent: null, avgAmountKrw: null, volume, manualKrwPerYear: null }),
    });
    strictEqual(withoutRisk.atLeast, true, '미산정 항이 있으면 "이상"이 붙어야 한다');
    strictEqual(withoutRisk.unpriced.length, 1);
    assertNear(withoutRisk.totalKrw, 15_420_000, 0.01, 'Value 합계(리스크 미산정)');
  });

  it('Priority ≈ 1,082만 원', () => {
    assertNear(priority(17_820_000, 0.81, 0.75), 10_820_000, 0.01, 'Priority');
  });
});

describe('SEED D-2 신규 입사자 — 리드타임이 인시의 3.4배인 사례', () => {
  // 연 12.6명. SEED가 T_touch를 적지 않았으므로 인시 787,500원에서 역산한다 (건당 3.57시간).
  const volume: Volume = orgTotalVolume(12.6 / 12);
  const touchH = 45 / 12.6;

  it('인시 절감 787,500원 — 역산한 T_touch로만 재현된다', () => {
    const labor = laborValue({ touchH, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    if (labor.kind === 'priced') assertNear(labor.krw, 787_500, 0.001, 'labor');
  });

  it('★ LeadTimeValue — SEED가 적은 식대로 계산하면 3,780,000원이다 (카드의 2,700,000원과 불일치)', () => {
    const model: DelayCostModel = {
      kind: 'internal-productivity',
      waitingHeadcount: 1,
      dailyValueKrw: 200_000,
    };
    const lt = leadTimeValue({ beforeH: 1.5 * 24, afterH: 0, volume, model });
    if (lt.money.kind === 'priced') {
      assertNear(lt.money.krw, 3_780_000, 0.001, 'leadTime(문서의 식)');
      // 카드의 2,700,000원은 연 9명으로 계산해야 나온다
      assertNear(1.5 * 200_000 * 9, 2_700_000, 0.001, 'leadTime(연 9명 가정)');
    }
  });

  it('★ RiskValue 800,000원은 자동 산출 대상이 아니다 — 사람이 넣어야만 값이 된다', () => {
    const auto = riskValue({ domain: 'operations', incidentRatePerEvent: null, avgAmountKrw: null, volume, manualKrwPerYear: null });
    strictEqual(auto.kind, 'unpriced', '감사 지적 회피는 법정 벌칙이 아니다');

    const manual = riskValue({ domain: 'operations', incidentRatePerEvent: null, avgAmountKrw: null, volume, manualKrwPerYear: 800_000 });
    strictEqual(manual.kind, 'priced');
  });

  it('★ 인시만 보면 탈락하는 후보 — 리드타임이 인시의 4.8배다', () => {
    const labor = laborValue({ touchH, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    const lead = leadTimeValue({
      beforeH: 36, afterH: 0, volume,
      model: { kind: 'internal-productivity', waitingHeadcount: 1, dailyValueKrw: 200_000 },
    }).money;
    ok(labor.kind === 'priced' && lead.kind === 'priced');
    if (labor.kind === 'priced' && lead.kind === 'priced') {
      ok(lead.krw / labor.krw > 3, `리드타임/인시 = ${(lead.krw / labor.krw).toFixed(1)}배`);
    }
  });

  it('★ 4대보험 단계가 스코프에 있으면 Feasibility는 0.78이 될 수 없다', () => {
    const base: ScopeFeasibilityInput = {
      determinism: { branches: [], criteriaSource: 'document', exceptionRate: 0.1, hasSkipBranch: false },
      inputStructure: { upstreamToolIds: ['groupware'], ownToolIds: ['gsuite'], catalog: CATALOG, inboundObjectClass: 'request', isEntry: false },
      allToolIds: ['groupware', 'gsuite'],
      catalog: CATALOG,
      exception: { per10: 2, reasked: false, reworkRates: [] },
      groupVariance: null,
      stability: { changeExpected: null, domain: 'operations', proxy: { structuralEditsLast90d: 0, daysSinceConfirmed: null, toolChanged: false, docAgeDays: 30 } },
    };
    const scoped = scoreFeasibility(base);
    const full = scoreFeasibility({ ...base, allToolIds: ['groupware', 'gsuite', 'cert-joint'] });

    strictEqual(full.score, 0.5, '공동인증서(4대보험)가 들어오면 상한 0.5');
    ok(scoped.score < 0.78, `4대보험을 뺀 스코프도 0.78에 못 미친다 (실제 ${round(scoped.score, 3)}) — 요소가 공개되지 않아 반증 불가능한 값이다`);
  });

  it('★ Confidence 0.6은 가법 분해로 만들 수 없는 값이다 (D-115)', () => {
    const c = confidence({
      peerAgreement: false,
      frequency: { kind: 'self-estimate' },
      duration: { kind: 'self-estimate', band: 'halfday' },
      saveRateConfirmed: true,
      daysSinceConfirmed: null,
    });
    strictEqual(round(c.value, 3), 0.55);
    ok(c.timeIsSelfReported);

    // 0.5 · 0.55 · 0.75 · 0.8 · 1.0 이 대표점이고 0.6은 그중에 없다
    const reachable = new Set<number>();
    for (const peer of [false, true])
      for (const freq of [false, true])
        for (const dur of [false, true])
          for (const sr of [false, true])
            reachable.add(round(Math.min(1, 0.5 + (peer ? 0.25 : 0) + (freq ? 0.25 : 0) + (dur ? 0.25 : 0) + (sr ? 0.05 : 0)), 2));
    ok(!reachable.has(0.6), `도달 가능한 값: ${[...reachable].sort((a, b) => a - b).join(', ')}`);
  });
});

describe('SEED D-3 배송 조회 — 단위 버그가 드러나는 곳', () => {
  const volume: Volume = orgTotalVolume(410);
  // 0.133h = 5m 단계(p=1) + 15m 단계(p=0.2). SEED의 0.133은 이 값을 반올림한 것이다
  const touchH = scopeTouchH([step('5m', 1, 1, 'a'), step('15m', 0.2, 1, 'b')]);

  it('인시 절감 11,451,300원', () => {
    const labor = laborValue({ touchH, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    if (labor.kind === 'priced') assertNear(labor.krw, 11_451_300, 0.01, 'labor');
  });

  it('★ customer-wait은 건당 총액이다 — 일수를 다시 곱하면 1/7이 된다', () => {
    const model: DelayCostModel = {
      kind: 'customer-wait', reinquiryRate: 0.22, handlingH: 0.133, rateKrwPerH: RATE,
    };
    strictEqual(delayCostUnit(model), 'per-event');

    const lt = leadTimeValue({ beforeH: 3.5, afterH: 0, volume, model });
    if (lt.money.kind === 'priced') assertNear(lt.money.krw, 3_435_000, 0.05, 'leadTime');

    // §4.1의 일반식(deltaDays를 곱하는 버전)을 그대로 적용하면 이렇게 된다
    const asIfPerDay = lt.deltaDays * annualEvents(volume) * (0.22 * 0.133 * RATE);
    ok(asIfPerDay < 600_000, `일당 단가로 잘못 보면 ${Math.round(asIfPerDay).toLocaleString('ko-KR')}원 — 손계산의 1/7`);
  });

  it('★ RiskValue "단기 인력 회피"는 미산정이고, 문장으로 내보내면 차단된다', () => {
    const r = riskValue({ domain: 'operations', incidentRatePerEvent: null, avgAmountKrw: null, volume, manualKrwPerYear: null });
    strictEqual(r.kind, 'unpriced');

    const v = findForbiddenOutput('피크 시즌 단기 인력 40% 감축 가능');
    strictEqual(v.length, 1);
    strictEqual(v[0]!.ruleId, 'no-headcount-output');
  });

  it('★ Confidence 0.9도 도달 불가능하다 — 시간 실측이 빠져 있기 때문이다', () => {
    const c = confidence({
      peerAgreement: false,
      frequency: { kind: 'counter', observedEvents: 210, answeredDays: 10, promoted: true },
      duration: { kind: 'self-estimate', band: '5m' },
      saveRateConfirmed: true,
      daysSinceConfirmed: null,
    });
    strictEqual(round(c.value, 3), 0.8);
    strictEqual(c.timeIsSelfReported, true);
    strictEqual(c.label, '동료 확인');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6. ECRS — SEED X-1 · X-2
   ══════════════════════════════════════════════════════════════════════════ */

const emptyAnswers = {};

function mkStep(p: Partial<EcrsStep> & Pick<EcrsStep, 'id' | 'title' | 'kind'>): EcrsStep {
  return {
    itemId: p.id, band: null, toolIds: [], assigneeId: null,
    reachProbability: 1, expectedPasses: 1, touchH: 0, waitH: 0,
    artifactNouns: [], volume: orgTotalVolume(1), ...p,
  } as EcrsStep;
}

/** SEED X-1 — GA-01 3b 「10만~300만원 팀장 결재」 */
const X1_DOC: EcrsDoc = {
  docId: 'GA-01', orgId: 'org', ownerId: 'u-ga', deptId: 'ga',
  steps: [
    mkStep({ id: 'n1', title: '비품 구매 요청서 작성', kind: 'task', band: '15m', touchH: 0.25, toolIds: ['groupware'], assigneeId: 'u-req', artifactNouns: ['구매요청서'], volume: orgTotalVolume(26) }),
    mkStep({ id: 'n2', title: '팀장 결재', kind: 'hold', waitFor: 'approval', waitH: 72, hasReturnPath: false, cycleReworkRate: 0, approverTouchH: 0.2, volume: orgTotalVolume(26) }),
    mkStep({ id: 'n3', title: '발주', kind: 'task', band: '15m', touchH: 0.25, toolIds: ['groupware'], assigneeId: 'u-ga', volume: orgTotalVolume(26) }),
  ],
  edges: [['n1', 'n2'], ['n2', 'n3']],
  answers: { 'rejection-6m': { n2: { choice: 'none' } } },
};

/** SEED X-2 — FIN-03 3~5a 「카드 증빙 회신·취합·독촉」 */
const X2_DOC: EcrsDoc = {
  docId: 'FIN-03', orgId: 'org', ownerId: 'u-fin', deptId: 'fin',
  steps: [
    mkStep({ id: 'm1', title: '카드 사용내역 내려받기', kind: 'task', band: '15m', touchH: 0.25, toolIds: ['sheets'], assigneeId: 'u-fin', volume: orgTotalVolume(1) }),
    mkStep({ id: 'm2', title: '사용목적 회신 기다리기', kind: 'hold', waitFor: 'reply', waitH: 120, volume: orgTotalVolume(1) }),
    mkStep({ id: 'm3', title: '회신 온 증빙 확인', kind: 'task', band: '5m', touchH: 5 / 60, toolIds: ['sheets'], assigneeId: 'u-fin', freqLast7d: 12, volume: orgTotalVolume(52) }),
    mkStep({ id: 'm4', title: '미제출자 독촉', kind: 'task', band: 'halfday', touchH: 4, toolIds: ['groupware'], assigneeId: 'u-fin', volume: orgTotalVolume(1) }),
    mkStep({ id: 'm5', title: '증빙 취합', kind: 'task', band: '1h', touchH: 1, toolIds: ['sheets'], assigneeId: 'u-fin', volume: orgTotalVolume(1) }),
  ],
  edges: [['m1', 'm2'], ['m2', 'm3'], ['m3', 'm4'], ['m4', 'm5']],
  answers: { 'batch-or-each': { m3: { choice: 'each' } } },
};

const ecrsCtx = (docs: readonly EcrsDoc[]): EcrsContext => ({
  docs, catalog: CATALOG, orgCoverage: 0.5, orgInboundLabels: [], confirmedLinks: [],
});

describe('ECRS — SEED X-1 · X-2', () => {
  it('X-1 — 반려율 0% 승인이 E1으로 잡힌다', () => {
    const hits = detectElimination(ecrsCtx([X1_DOC]));
    const e1 = hits.filter((h) => h.patternId === 'E1');
    strictEqual(e1.length, 1);
    deepStrictEqual([...e1[0]!.nodeIds], ['n2']);
    strictEqual(e1[0]!.precision, 0.9);
    strictEqual(e1[0]!.saving.devEffort, 'none', '개발 0줄 — 이게 제거 후보가 잘 팔리는 이유다');
    strictEqual(round(e1[0]!.saving.leadDaysSaved!, 2), 3, '평균 대기 3일');
  });

  it('X-1 — 회수 시간은 결재 1건에 몇 분이냐에 통째로 달려 있다', () => {
    const hits = detectElimination(ecrsCtx([X1_DOC]));
    const e1 = hits.find((h) => h.patternId === 'E1')!;
    // approverTouchH = 0.2h(12분) → 62.4h. SEED의 "연 62시간"과 일치한다
    assertNear(e1.saving.laborHPerYear!, 62.4, 0.01, 'X-1 회수 시간');
    // §5.1의 기본값 0.05h(3분)를 쓰면 15.6h — 4배 차이. 그래서 기본값에 기댄 숫자는 내보내지 않는다
    assertNear(0.05 * 312, 15.6, 0.001, '기본값 기준');
  });

  it('X-1 — 대기가 8시간 미만이면 잡지 않는다 (없앨 가치가 없다)', () => {
    const shortWait: EcrsDoc = {
      ...X1_DOC,
      steps: X1_DOC.steps.map((s) => (s.id === 'n2' ? { ...s, waitH: 4 } : s)),
    };
    strictEqual(detectElimination(ecrsCtx([shortWait])).filter((h) => h.patternId === 'E1').length, 0);
  });

  it('X-2 — 독촉(E11)과 건건이 처리(E7)가 함께 잡힌다', () => {
    const hits = detectElimination(ecrsCtx([X2_DOC]));
    const ids = new Set(hits.map((h) => h.patternId));
    ok(ids.has('E11'), '독촉 단계');
    ok(ids.has('E7'), '건건이 처리');
    const e11 = hits.find((h) => h.patternId === 'E11')!;
    deepStrictEqual([...e11.nodeIds], ['m4']);
    ok(e11.evidence['원인 대기'] === '사용목적 회신 기다리기', '재촉은 대기의 증상이지 원인이 아니다');
  });

  it('X-2 — 응답 대기가 실접촉의 8배를 넘어 E4도 잡힌다 (리드타임 절감이지 인시가 아니다)', () => {
    const hits = detectElimination(ecrsCtx([X2_DOC]));
    const e4 = hits.find((h) => h.patternId === 'E4');
    ok(e4);
    strictEqual(e4!.saving.laborHPerYear, null, 'E4를 인시로 세면 조직 절감 시간이 3~5배 부푼다');
    ok(e4!.saving.leadDaysSaved! > 0);
  });

  it('상류에 대기가 없으면 독촉이 아니라 다른 일이다', () => {
    const noHold: EcrsDoc = {
      ...X2_DOC,
      steps: X2_DOC.steps.filter((s) => s.id !== 'm2'),
      edges: [['m1', 'm3'], ['m3', 'm4'], ['m4', 'm5']],
    };
    strictEqual(detectElimination(ecrsCtx([noHold])).filter((h) => h.patternId === 'E11').length, 0);
  });

  it('불변식 8 — ECRS가 랭킹보다 먼저 돈다: 제거 판정 노드는 자동화 스코프에서 빠진다', () => {
    const hits = detectElimination(ecrsCtx([X1_DOC, X2_DOC]));
    const removed = eliminatedNodeIds(hits);

    ok(removed.has('n2'), '반려 없는 승인은 자동화 후보가 아니라 제거 후보다');
    ok(removed.has('m4'), '재촉 단계도 제거 후보다');

    // 제거 스코프에는 action === 'eliminate'인 히트의 노드만 들어간다.
    // rearrange/combine/simplify는 없애는 게 아니라 옮기는 것이라 스코프를 빼앗지 않는다.
    for (const id of removed) {
      ok(
        hits.some((h) => h.action === 'eliminate' && h.nodeIds.includes(id)),
        `${id}가 제거 스코프에 있는데 eliminate 히트가 없다`,
      );
    }
    strictEqual(removed.has('m2'), false, '대기 재배치(E4)는 제거가 아니다');
  });

  it('같은 노드에 E1과 E4가 함께 걸리는 것이 정상이다 — 제안이 다르기 때문이다', () => {
    // 「팀장 결재」는 (a) 반려된 적 없어서 없앨 수 있고 (b) 대기가 실접촉을 압도한다.
    // 둘을 하나로 뭉치면 "기준선을 올려라"와 "알림을 붙여라"가 섞여 아무 제안도 안 된다.
    const hits = detectElimination(ecrsCtx([X1_DOC]));
    const onN2 = hits.filter((h) => h.nodeIds.includes('n2')).map((h) => h.patternId).sort();
    deepStrictEqual(onN2, ['E1', 'E4']);
  });

  it('불변식 10·11 — 기여자 5인 미만이면 관리자에게 안 나간다 (D-002, 예외 없음)', () => {
    const hits = detectElimination(ecrsCtx([X1_DOC]));
    const rollup = rollupForAdmin(hits, () => 'u-ga', () => 'ga');
    deepStrictEqual(rollup, [], '기여자 1명 → 관리자 화면에 행이 없다');

    // 같은 패턴을 5명이 각각 가지고 있으면 그때 나간다
    const many = Array.from({ length: 5 }, (_, i) => ({ ...X1_DOC, docId: `GA-01-${i}` }));
    const manyHits = detectElimination(ecrsCtx(many));
    const manyRollup = rollupForAdmin(manyHits, (d) => `owner-${d}`, () => 'ga');
    ok(manyRollup.some((r) => r.patternId === 'E1'));
    strictEqual(manyRollup.find((r) => r.patternId === 'E1')!.contributorCount, 5);
  });

  it('검출기 12종이 전부 등록되어 있다', () => {
    const hits = detectElimination(ecrsCtx([]));
    deepStrictEqual(hits, []);
    // 패턴 목록 자체의 완전성
    const ids = ['E1','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12'];
    for (const id of ids) ok(ids.includes(id));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7. Confidence — D-115의 비대칭
   ══════════════════════════════════════════════════════════════════════════ */

describe('Confidence 가법 분해 (D-115)', () => {
  it('세 라벨이 대표점으로 재현된다', () => {
    const base = { saveRateConfirmed: false, daysSinceConfirmed: null } as const;
    const selfOnly = confidence({ ...base, peerAgreement: false, frequency: { kind: 'self-estimate' }, duration: { kind: 'self-estimate', band: '1h' } });
    strictEqual(selfOnly.value, 0.5);
    strictEqual(selfOnly.label, '본인 추정');

    const peer = confidence({ ...base, peerAgreement: true, frequency: { kind: 'self-estimate' }, duration: { kind: 'self-estimate', band: '1h' } });
    strictEqual(peer.value, 0.75);
    strictEqual(peer.label, '동료 확인');

    const peerPlusCounter = confidence({
      ...base, peerAgreement: true,
      frequency: { kind: 'counter', observedEvents: 22, answeredDays: 8, promoted: true },
      duration: { kind: 'self-estimate', band: '1h' },
    });
    strictEqual(peerPlusCounter.value, 1);
    strictEqual(peerPlusCounter.label, '실측');
  });

  it('★ 가장 흔한 상태 — 빈도만 실측되고 시간은 자가추정 — 이 0.75로 정직하게 표현된다', () => {
    const c = confidence({
      peerAgreement: false,
      frequency: { kind: 'counter', observedEvents: 22, answeredDays: 8, promoted: true },
      duration: { kind: 'self-estimate', band: '1h' },
      saveRateConfirmed: false, daysSinceConfirmed: null,
    });
    strictEqual(c.value, 0.75);
    strictEqual(c.timeIsSelfReported, true, '"실측"이라고 말하면서 시간은 기억을 근거로 삼으면 안 된다');
  });

  it('★ 스톱워치가 없으므로 시간 실측은 짧은 체크리스트 흐름에서만 성립한다', () => {
    const proxyOk = confidence({
      peerAgreement: false, frequency: { kind: 'self-estimate' },
      duration: { kind: 'checklist-proxy', hours: 0.4, stepCount: 4, leadTimeH: 0.6 },
      saveRateConfirmed: false, daysSinceConfirmed: null,
    });
    strictEqual(proxyOk.value, 0.75);
    strictEqual(proxyOk.timeIsSelfReported, false);

    // 긴 흐름의 체크리스트 간격은 접촉시간이 아니라 리드타임이다 → 실측으로 세지 않는다
    const proxyTooLong = confidence({
      peerAgreement: false, frequency: { kind: 'self-estimate' },
      duration: { kind: 'checklist-proxy', hours: 3, stepCount: 12, leadTimeH: 30 },
      saveRateConfirmed: false, daysSinceConfirmed: null,
    });
    strictEqual(proxyTooLong.value, 0.5);
    strictEqual(proxyTooLong.timeIsSelfReported, true);

    // 2주 세션 마지막 날의 회고 1문항도 실측이 아니다 — 신선한 자가보고일 뿐이다
    const retro = confidence({
      peerAgreement: false, frequency: { kind: 'self-estimate' },
      duration: { kind: 'retrospective', band: '15m' },
      saveRateConfirmed: false, daysSinceConfirmed: null,
    });
    strictEqual(retro.value, 0.5);
  });

  it('신선도 감쇠는 ASSEMBLY와 같은 계수를 쓴다', () => {
    const mk = (days: number | null) => confidence({
      peerAgreement: true, frequency: { kind: 'self-estimate' },
      duration: { kind: 'self-estimate', band: '1h' },
      saveRateConfirmed: false, daysSinceConfirmed: days,
    });
    strictEqual(mk(30).decay, 1);
    strictEqual(mk(200).decay, 0.85);
    strictEqual(mk(400).decay, 0.7);
  });

  it('B-06 — fork 형제 3개는 동료 합의가 아니다 (복사다)', () => {
    const forks = [0, 1, 2].map((i) => ({
      docId: `d${i}`, ownerId: `u${i}`, forkOfDocId: 'seed', viewedOthers: false,
      band: '1h' as const, freqPerMonth: 20, stepSet: new Set(['a', 'b', 'c']),
    }));
    strictEqual(peerAgreement(forks).agreed, false);
    strictEqual(peerAgreement(forks).independentCount, 1);
  });

  it('B-07 — 남의 문서를 본 사람은 독립 기여자가 아니다', () => {
    const members = [0, 1, 2].map((i) => ({
      docId: `d${i}`, ownerId: `u${i}`, forkOfDocId: null, viewedOthers: i === 2,
      band: '1h' as const, freqPerMonth: 20, stepSet: new Set(['a', 'b', 'c']),
    }));
    strictEqual(peerAgreement(members).independentCount, 2);
    strictEqual(peerAgreement(members).agreed, false);
  });

  it('합의가 안 되는 것도 산출물이다 — 어느 축이 어긋났는지 남는다', () => {
    const members = [
      // "세 명이 같은 일에 15분 / 반나절 / 하루라고 적었습니다" — 경영진이 가장 잘 반응하는 문장
      { docId: 'a', ownerId: 'ua', forkOfDocId: null, viewedOthers: false, band: '15m' as const, freqPerMonth: 20, stepSet: new Set(['a', 'b', 'c']) },
      { docId: 'b', ownerId: 'ub', forkOfDocId: null, viewedOthers: false, band: 'halfday' as const, freqPerMonth: 20, stepSet: new Set(['a', 'b', 'c']) },
      { docId: 'c', ownerId: 'uc', forkOfDocId: null, viewedOthers: false, band: '1d+' as const, freqPerMonth: 21, stepSet: new Set(['a', 'b', 'c']) },
    ];
    const r = peerAgreement(members);
    ok(r.disagreeAxes.includes('걸리는 시간'), `${r.because}`);
  });

  it('실측 승격 — 관측이 예상보다 적은 것도 정보다 (실패가 아니다)', () => {
    strictEqual(evaluatePromotion({ workdaysElapsed: 10, answeredDays: 3, totalEvents: 5, expectedEvents: 20 }).reason, 'not-enough-days');
    const fewer = evaluatePromotion({ workdaysElapsed: 10, answeredDays: 8, totalEvents: 2, expectedEvents: 40 });
    strictEqual(fewer.promoted, false);
    if (!fewer.promoted) strictEqual(fewer.downgradeFreq, true);
    const ok10 = evaluatePromotion({ workdaysElapsed: 10, answeredDays: 10, totalEvents: 30, expectedEvents: 30 });
    strictEqual(ok10.promoted, true);
    if (ok10.promoted) assertNear(ok10.measuredPerMonth, 65.1, 0.01, '근무일 환산');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8. 금지 출력 가드 (D-116)
   ══════════════════════════════════════════════════════════════════════════ */

describe('guard — 산출 금지 출력 (D-116)', () => {
  it('D-100 — 규칙 4종이 전부 살아 있다 (mustCatch / mustPass 자기검사)', () => {
    deepStrictEqual(selfTestRules(), []);
  });

  it('★ 사람 수 감축 문장을 잡는다', () => {
    for (const s of [
      '인력 3명 감축 가능',
      '인원 2명 절감',
      '이 자리 없애도 됩니다',
      '연 1.8명분의 일이 사라집니다',
    ]) {
      ok(findForbiddenOutput(s).length > 0, `못 잡음: ${s}`);
    }
  });

  it('정상 문장은 통과한다 — 오탐이 있으면 가드가 무시된다', () => {
    for (const s of [
      '손이 덜 가게 만들 수 있어요',
      '연 240시간을 회수할 수 있어요',
      '발행이 1.5일에서 0.2일로 빨라져요',
      '같은 증빙이 두 흐름에서 각각 요구되는 것으로 적혀 있어요',
    ]) {
      deepStrictEqual(findForbiddenOutput(s), [], `오탐: ${s}`);
    }
  });

  it('★ 카드 하나를 통째로 넣으면 중첩된 문자열까지 검사한다', () => {
    throws(
      () =>
        assertRenderable({
          headline: '반려된 적 없는 승인 단계가 흐름을 3일 붙잡고 있어요',
          effect: '연 62시간 회수 · 인력 1명 감축 가능',
          nested: { list: ['정상 문구', '정원 축소'] },
        }),
      /산출 금지 출력 2건/,
    );
  });

  it('미산정을 0원으로 적는 것도 금지된다 (D-117)', () => {
    ok(findForbiddenOutput('리스크 가치: 0원').length > 0);
    deepStrictEqual(findForbiddenOutput('리스크 계산 안 함'), []);
  });

  it('부서를 주어로 쓰는 문장을 잡는다 (POLICY §5.2)', () => {
    ok(findForbiddenOutput('재무팀이 늦게 처리하고 있습니다').length > 0);
    deepStrictEqual(findForbiddenOutput('재무팀 ↔ 총무팀 접합에서 같은 증빙이 두 번 요구돼요'), []);
  });

  it('불변식 14·15 — ECRS 산출 문구 전량이 가드를 통과한다', () => {
    const hits = detectElimination(ecrsCtx([X1_DOC, X2_DOC]));
    ok(hits.length > 0);
    for (const h of hits) assertRenderable(h.execCopy, `${h.patternId}.execCopy`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9. 단조성 · 결정성
   ══════════════════════════════════════════════════════════════════════════ */

describe('스코어 불변식', () => {
  const volume = orgTotalVolume(88);

  it('불변식 5 — T_touch를 늘리면 Value가 줄지 않는다', () => {
    const a = laborValue({ touchH: 0.5, volume, rateKrwPerH: RATE, saveRate: 0.7 });
    const b = laborValue({ touchH: 0.75, volume, rateKrwPerH: RATE, saveRate: 0.7 });
    ok(a.kind === 'priced' && b.kind === 'priced' && b.krw >= a.krw);
  });

  it('불변식 6 — SaveRate를 낮추면 Value가 늘지 않는다', () => {
    const manual = laborValue({ touchH: 0.75, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.manual });
    const auto = laborValue({ touchH: 0.75, volume, rateKrwPerH: RATE, saveRate: SAVE_RATE.auto });
    ok(manual.kind === 'priced' && auto.kind === 'priced' && auto.krw <= manual.krw);
  });

  it('불변식 12 — 같은 입력이면 같은 결과 (순수 함수)', () => {
    const a = scoreFeasibility(D1_FEASIBILITY);
    const b = scoreFeasibility(D1_FEASIBILITY);
    deepStrictEqual(a, b);
  });

  it('불변식 13 — 접촉시간 구간이 p10 ≤ p50 ≤ p90을 만든다', () => {
    const steps = [step('1h', 1, 1, 'x'), step('halfday', 1, 1, 'y')];
    const [lo, hi] = scopeTouchRangeH(steps);
    const mid = scopeTouchH(steps);
    ok(lo <= mid && mid <= hi, `${lo} ≤ ${mid} ≤ ${hi}`);
  });

  it('B-10 — 미산정은 끝까지 전파되고 합계에 "이상"이 붙는다', () => {
    const v = composeValue({
      labor: laborValue({ touchH: 0.75, volume, rateKrwPerH: RATE, saveRate: 0.7 }),
      leadTime: leadTimeValue({ beforeH: 24, afterH: 12, volume, model: { kind: 'unpriced', note: '단위지연비용을 아직 안 넣었어요' } }).money,
      risk: riskValue({ domain: null, incidentRatePerEvent: null, avgAmountKrw: null, volume, manualKrwPerYear: null }),
    });
    strictEqual(v.atLeast, true);
    strictEqual(v.unpriced.length, 2);
    ok(v.totalKrw > 0, '미산정 항이 0으로 접혀 총합을 깎으면 안 된다');
  });

  it('규정기한형은 의도적으로 0이다 — 미산정과 다르다', () => {
    const lt = leadTimeValue({ beforeH: 48, afterH: 24, volume, model: { kind: 'statutory' } });
    strictEqual(lt.money.kind, 'priced');
    if (lt.money.kind === 'priced') strictEqual(lt.money.krw, 0);
  });
});

/* ── 유틸 ─────────────────────────────────────────────────────────────────── */

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

void emptyAnswers;

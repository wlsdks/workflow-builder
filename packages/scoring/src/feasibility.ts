/**
 * packages/scoring/src/feasibility.ts — Feasibility 6요소.
 *
 *   Feasibility = 0.25·규칙결정성 + 0.20·입력구조화 + 0.20·시스템접근성
 *               + 0.15·(1 − 예외율) + 0.10·표준화 + 0.10·안정성
 *
 * ── 여섯 요소는 성질이 다르다 ───────────────────────────────────────────────
 *   셋(규칙결정성·입력구조화·시스템접근성)은 **데이터에서** 나온다
 *   하나(예외율)는 **질문에서** 나온다
 *   하나(표준화)는 **여러 사람이 있어야만** 나온다 — 혼자면 계산 자체가 불가능하다
 *   하나(안정성)는 **데이터로 못 나온다** — 미래에 대한 질문이고 우리 데이터엔 과거만 있다
 *
 * 여섯을 같은 방식으로 계산하는 척하면 안 된다. 그래서 각 요소가 `coverage`를
 * 함께 반환하고, coverage 0인 요소는 아래 `NEUTRAL_WHEN_UNKNOWN`의 값만 낼 수 있다.
 * 그 불변식이 "없는 데이터를 지어내지 않는다"의 기계적 표현이다.
 */

import { clamp01, type FeasibilityFactor, type FeasibilityKey, type FeasibilityResult,
         type ToolCatalog, type ToolEntry, type ToolGrade } from './types.ts';

export const F_WEIGHTS: Record<FeasibilityKey, number> = {
  determinism: 0.25,
  inputStructure: 0.2,
  systemAccess: 0.2,
  exceptionInv: 0.15,
  standardization: 0.1,
  stability: 0.1,
};

/**
 * coverage가 0일 때 각 요소가 낼 수 있는 **유일한** 값.
 *
 * 값이 요소마다 다른 것은 의도다. "모른다"의 방향이 요소마다 다르기 때문이다:
 *   - 도구가 안 적혀 있으면 자동화 가능성은 **낮게** 보는 게 맞다 (0.3)
 *   - 사람이 한 명뿐이면 표준화는 **중립** 말고 할 말이 없다 (0.5)
 *   - 안정성은 아무 데이터도 없을 때 낙관도 비관도 아닌 값 (0.6)
 *
 * 중요한 것은 값의 크기가 아니라 **선언되어 있다는 것**이다. 선언되어 있으면
 * 테스트가 "coverage 0인데 값이 제멋대로인" 코드를 잡을 수 있다.
 */
export const NEUTRAL_WHEN_UNKNOWN: Record<FeasibilityKey, number> = {
  determinism: 0.6,
  inputStructure: 0.3,
  systemAccess: 0.3,
  exceptionInv: 0.5,
  standardization: 0.5,
  stability: 0.6,
};

export const FEASIBILITY_CAP = 0.5;

/* ── 3.1 규칙결정성 (0.25) — 판단이 개입하는가 ────────────────────────────── */

export type LabelClass = 'quantitative' | 'enumerable' | 'temporal' | 'subjective' | 'unknown';

/** 정량 — 숫자·단위·비교어가 함께 나온다 */
const QUANT_RE =
  /(\d[\d,]*\s*(원|만원|억|천|개|건|장|명|%|퍼센트|kg|박스))|(\d+\s*(이상|이하|초과|미만|넘|넘으면))/;
/** 시간·기간 — 역시 기계가 판정 가능 */
const TEMPORAL_RE =
  /(\d+\s*(일|영업일|시간|주|개월|분)\s*(이내|이상|이하|넘|지나|경과))|(마감|당일|익일|월말|월초|분기말|연말)/;
/** 열거 가능한 상태값 — 시스템 필드로 존재할 가능성이 높다 */
const ENUM_WORDS = [
  '승인', '반려', '반송', '취소', '완료', '미완료', '신규', '기존', '재구매',
  '국내', '해외', '개인', '법인', '사업자', '유료', '무료', '재고 있', '품절',
  '카드', '현금', '계좌이체', '선결제', '후결제', '정상', '불량', '파손',
  '배송중', '출고', '미출고',
];
/** 주관 — 사람 머릿속에만 있는 기준 */
const SUBJECTIVE_WORDS = [
  '복잡', '단순', '간단', '애매', '어려운', '쉬운', '중요', '급한', '긴급',
  '큰 건', '작은 건', '심한', '괜찮', '문제 있', '이상한', '보통', '웬만',
  '상황에 따라', '케이스', '경우에 따라', '판단', '재량', '알아서', '적당',
];

export function classifyCaseLabel(label: string): LabelClass {
  const s = label.trim();
  if (s.length === 0) return 'unknown';
  if (SUBJECTIVE_WORDS.some((w) => s.includes(w))) return 'subjective'; // 주관이 이긴다
  if (QUANT_RE.test(s)) return 'quantitative';
  if (TEMPORAL_RE.test(s)) return 'temporal';
  if (ENUM_WORDS.some((w) => s.includes(w))) return 'enumerable';
  return 'unknown';
}

const CLASS_SCORE: Record<LabelClass, number> = {
  quantitative: 1.0,
  temporal: 0.95,
  enumerable: 0.8,
  /** 못 읽었다 ≠ 주관이다. 그러나 낙관도 하지 않는다 */
  unknown: 0.4,
  subjective: 0.1,
};

export type DeterminismInput = {
  /** 스코프 안의 분기 노드들과 그 갈래 라벨 */
  branches: readonly { nodeId: string; labels: readonly string[] }[];
  /** "판단 기준이 문서에 있나요, 경험으로 아시나요?" */
  criteriaSource: 'document' | 'experience' | null;
  /** 스코프의 예외율 — 분기가 없을 때 "숨은 판단"을 가려내는 데 쓴다 */
  exceptionRate: number | null;
  /** 조건스킵 분기가 있는가 */
  hasSkipBranch: boolean;
};

export function determinism(x: DeterminismInput): FeasibilityFactor {
  const labels = x.branches.flatMap((b) => b.labels);

  // ── 분기가 하나도 없다 ──────────────────────────────────────────────────
  // 두 가지 뜻이 있고, 예외율이 그 둘을 가른다.
  //   (a) 정말 일직선 업무   → 자동화하기 좋다
  //   (b) 판단을 안 적었을 뿐 → 숨은 분기가 있다
  if (labels.length === 0) {
    const ex = x.exceptionRate;
    if (ex === null) {
      return {
        value: NEUTRAL_WHEN_UNKNOWN.determinism,
        coverage: 0,
        because: '갈라지는 곳이 없는 일이에요 (예외를 아직 안 물어봤어요)',
      };
    }
    if (ex <= 0.1) {
      return { value: 0.9, coverage: 0.8, because: '갈라지는 곳 없이 늘 같은 순서로 흘러가요' };
    }
    // 분기는 없는데 예외는 많다 = 판단이 글로 안 나온 상태. 가장 위험한 조합
    return {
      value: 0.45,
      coverage: 0.6,
      because: '갈래는 없는데 예외가 잦아요 — 적히지 않은 판단이 있는 것 같아요',
    };
  }

  // ── 라벨 분류 → "최악 절반" 가중 평균 ──────────────────────────────────
  // 평균이 아니라 가장 주관적인 갈래에 무게를 싣는다. 갈래 하나가 사람 판단이면
  // 그 분기 전체가 무인 실행이 안 된다.
  const scores = labels.map((l) => CLASS_SCORE[classifyCaseLabel(l)]);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  let value = 0.5 * min + 0.5 * mean;

  // 암묵지 보정 — TOOLS.md가 "자동화 난이도 핵심 지표"라고 못 박은 문항
  if (x.criteriaSource === 'experience') value *= 0.6;
  if (x.criteriaSource === 'document') value = Math.min(1, value * 1.15);

  // 조건스킵은 "건너뛸지 말지"를 사람이 판단하는 구조라 기본 감점
  if (x.hasSkipBranch) value *= 0.85;

  const unknownRatio =
    labels.filter((l) => classifyCaseLabel(l) === 'unknown').length / labels.length;
  const coverage = (x.criteriaSource !== null ? 0.5 : 0.3) + 0.5 * (1 - unknownRatio);

  const worst = labels[scores.indexOf(min)] ?? '';
  const because =
    min <= 0.2
      ? `"${worst}" 같은 판단은 사람이 해야 해요`
      : min >= 0.8
        ? '갈라지는 기준이 숫자와 상태값으로 적혀 있어요'
        : '기준이 일부만 명확해요';

  return { value: clamp01(value), coverage: clamp01(coverage), because };
}

/* ── 3.2 입력구조화 (0.20) — 들어오는 데이터가 구조화되어 있는가 ──────────── */

const STRUCTURE_SCORE: Record<ToolGrade, number> = { high: 1.0, mid: 0.55, low: 0.15 };

export type ObjectClass =
  | 'request' | 'approval' | 'evidence' | 'record' | 'identifier' | 'physical' | 'notice';

export type InputStructureInput = {
  /** 선행 단계들의 도구 (없으면 = 흐름의 시작 = 외부 입력) */
  upstreamToolIds: readonly string[];
  /** 이 단계 자신의 도구 — 선행이 없을 때의 폴백 */
  ownToolIds: readonly string[];
  catalog: ToolCatalog;
  /** 접합 소켓의 산출물 클래스 ('identifier'는 조인 강도 최상) */
  inboundObjectClass?: ObjectClass;
  /** 흐름의 첫 단계인가 = 입력이 조직 밖에서 온다 */
  isEntry: boolean;
};

/**
 * ★ 이 요소는 **선행 노드의 도구**를 본다. 이 단계의 입력은 앞 단계의 출력이기 때문이다.
 *   그래서 시스템접근성(§3.3)과 겹치지 않는다.
 */
export function inputStructure(x: InputStructureInput): FeasibilityFactor {
  const ids = x.upstreamToolIds.length > 0 ? x.upstreamToolIds : x.ownToolIds;
  const tools = ids.map((id) => x.catalog[id]).filter((t): t is ToolEntry => Boolean(t));

  if (tools.length === 0) {
    return {
      value: NEUTRAL_WHEN_UNKNOWN.inputStructure,
      coverage: 0,
      because: '무엇으로 받는지가 아직 안 적혀 있어요',
    };
  }

  // 여러 곳에서 들어오면 가장 나쁜 입력이 병목이다 — 최소값
  const base = Math.min(...tools.map((t) => STRUCTURE_SCORE[t.grade]));
  // structuredIO가 false면(메신저·메일 본문·종이) 등급과 무관하게 깎는다.
  // 슬랙은 연결성 '상'이지만 슬랙 대화에서 오는 입력은 구조화 데이터가 아니다.
  const anyUnstructured = tools.some((t) => !t.structuredIO);
  let value = anyUnstructured ? Math.min(base, 0.4) : base;

  // 산출물이 식별자(주문번호·품의번호)면 구조화의 최강 신호
  if (x.inboundObjectClass === 'identifier') value = Math.min(1, value + 0.25);
  if (x.inboundObjectClass === 'physical') value = Math.min(value, 0.15);

  // 흐름의 시작 = 외부(고객·거래처)에서 들어옴. 통제 밖이라 감점
  if (x.isEntry) value *= 0.85;

  const worst = tools.reduce((a, b) =>
    STRUCTURE_SCORE[a.grade] <= STRUCTURE_SCORE[b.grade] ? a : b,
  );
  return {
    value: clamp01(value),
    coverage: 0.8,
    because: anyUnstructured
      ? `${worst.name}에서 오는 정보는 정해진 형식이 없어요`
      : `${worst.name}에서 정해진 형식으로 들어와요`,
  };
}

/* ── 3.3 시스템접근성 (0.20) + 캡 ────────────────────────────────────────── */

const GRADE_SCORE: Record<ToolGrade, number> = { high: 1.0, mid: 0.55, low: 0.15 };

/** 카탈로그가 정본이고 여기는 설명용 문구다 */
export const CAP_TOOL_NOTE: Record<string, string> = {
  'cert-joint': '공동인증서가 필요해서 무인 실행이 사실상 안 돼요',
  hometax: '홈택스는 공식 API가 없어요 (바로빌 같은 ASP로 바꾸면 달라져요)',
  kakaotalk: '카카오톡 개인 대화는 읽어올 방법이 없어요',
  hwp: '한글 파일은 다루는 표준 방법이 없어요',
  phone: '전화는 기록 자체가 남지 않아요',
  paper: '종이 서류는 시스템에서 못 봐요',
  seal: '도장은 사람이 찍어야 해요',
  verbal: '말로 하는 요청은 어디에도 안 남아요',
};

export type FeasibilityCap = { limit: number; reason: string; toolId: string };

export function systemAccess(
  toolIds: readonly string[],
  catalog: ToolCatalog,
): { factor: FeasibilityFactor; cap: FeasibilityCap | null } {
  const tools = toolIds.map((id) => catalog[id]).filter((t): t is ToolEntry => Boolean(t));

  if (tools.length === 0) {
    return {
      factor: {
        value: NEUTRAL_WHEN_UNKNOWN.systemAccess,
        coverage: 0,
        because: '쓰는 도구가 아직 안 적혀 있어요',
      },
      cap: null,
    };
  }

  const scores = tools.map((t) => GRADE_SCORE[t.grade]);
  const min = Math.min(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // ★ 체인은 가장 약한 고리에서 끊긴다. 그래서 최소값에 더 큰 무게.
  //   슬랙(상)+홈택스(중)+종이(하)의 평균 0.57은 현실을 완전히 왜곡한다.
  const value = 0.6 * min + 0.4 * mean;

  // 캡은 요소가 아니라 **최종 점수에 걸리는 천장**이다. 가중합에 섞으면
  // 나머지 다섯 요소가 만점일 때 0.5를 넘어버린다.
  const capper = tools.find((t) => t.capsFeasibility);
  const cap: FeasibilityCap | null = capper
    ? {
        limit: FEASIBILITY_CAP,
        reason: CAP_TOOL_NOTE[capper.id] ?? `${capper.name}은(는) 사람 손이 반드시 필요해요`,
        toolId: capper.id,
      }
    : null;

  const worst = tools[scores.indexOf(min)]!;
  return {
    factor: {
      value: clamp01(value),
      coverage: 0.9,
      because:
        min >= 1 ? '쓰는 도구가 전부 연결 가능한 것들이에요' : `${worst.name}이(가) 연결의 병목이에요`,
    },
    cap,
  };
}

export type PreconditionSuggestion = {
  fromToolId: string;
  toToolId: string;
  note: string;
  /** 캡이 풀렸을 때의 Feasibility. 캡 전 원점수를 그대로 쓴다 */
  liftsCapTo: number | null;
};

/**
 * 캡이 걸린 후보는 **버리지 않는다.** "도구를 바꾸면 상이 됨" 형태의
 * 선행 개선 후보로 분리 출력한다. 경영진에게 가장 잘 팔리는 형태 중 하나다.
 */
export function precondition(
  toolIds: readonly string[],
  catalog: ToolCatalog,
  uncappedScore: number | null = null,
): PreconditionSuggestion | null {
  const tools = toolIds.map((id) => catalog[id]).filter((t): t is ToolEntry => Boolean(t));
  const capper = tools.find((t) => t.capsFeasibility && t.upgradePath);
  if (!capper?.upgradePath) return null;
  return {
    fromToolId: capper.id,
    toToolId: capper.upgradePath.toToolId,
    note: capper.upgradePath.note,
    liftsCapTo: uncappedScore,
  };
}

/* ── 3.4 (1 − 예외율) (0.15) ─────────────────────────────────────────────── */

export type ExceptionInput = {
  /** "10번 중 몇 번은 이렇게 안 흘러가나요" 응답 0..10. 미응답이면 null */
  per10: number | null;
  /** 0이라 답한 뒤 재질문("정말 한 번도요?")을 거쳤는가 */
  reasked: boolean;
  /** 스코프 안 사이클들의 반려율 — 예외의 다른 얼굴이다 */
  reworkRates: readonly number[];
  /** 조직 사전값. 없으면 전역 0.2 */
  priorRate?: number;
};

/** 사람은 예외를 구조적으로 과소보고한다. 0은 존재하지 않는 값으로 본다 */
const EXCEPTION_FLOOR = 0.05;
const DEFAULT_PRIOR_EXCEPTION = 0.2;

export function exceptionInverse(x: ExceptionInput): FeasibilityFactor {
  const prior = x.priorRate ?? DEFAULT_PRIOR_EXCEPTION;
  let promptRate: number;
  let coverage: number;

  if (x.per10 === null) {
    // ★ 미응답을 0으로 읽지 않는다. "예외가 없다"가 아니라 "안 물어봤다"이다
    promptRate = prior;
    coverage = 0;
  } else if (x.per10 === 0) {
    // 0 응답: 재질문을 거쳤으면 바닥값, 안 거쳤으면 신뢰하지 않는다
    promptRate = x.reasked ? EXCEPTION_FLOOR : Math.max(EXCEPTION_FLOOR, prior * 0.5);
    coverage = x.reasked ? 0.7 : 0.3;
  } else {
    promptRate = Math.min(1, x.per10 / 10);
    coverage = 1;
  }

  // 재작업 루프는 "이렇게 안 흘러간 경우"의 이미 관측된 형태다.
  // 두 확률을 독립으로 보고 결합한다 — 더하면 1을 넘고, max를 쓰면 정보를 버린다.
  const rework = x.reworkRates.length > 0 ? Math.max(...x.reworkRates) : 0;
  const combined = 1 - (1 - promptRate) * (1 - rework);

  // coverage 0인데 값이 중립값이 아니면 계약 위반이다.
  // 미응답 + 재작업 정보도 없음 = 우리가 아는 게 없다 → 중립값으로 접는다.
  if (coverage === 0 && x.reworkRates.length === 0) {
    return {
      value: NEUTRAL_WHEN_UNKNOWN.exceptionInv,
      coverage: 0,
      because: '예외가 얼마나 나는지 아직 안 물어봤어요',
    };
  }

  return {
    value: clamp01(1 - combined),
    coverage: clamp01(x.reworkRates.length > 0 ? Math.min(1, coverage + 0.2) : coverage),
    because:
      combined >= 0.4
        ? `10번 중 ${Math.round(combined * 10)}번은 다르게 흘러가요`
        : combined <= 0.1
          ? '거의 늘 같은 방식으로 흘러가요'
          : `가끔(10번 중 ${Math.round(combined * 10)}번) 다르게 흘러가요`,
  };
}

/* ── 3.5 표준화 (0.10) — 여러 사람이 있어야만 계산된다 ───────────────────── */

export type GroupVariance = {
  /** 그룹 기여자 수 */
  n: number;
  /** ① 단계 수 변동계수 (표준편차 / 평균) */
  stepCountCv: number;
  /** ② 도구 집합 평균 Jaccard 유사도 (1 = 전원 같은 도구) */
  toolJaccard: number;
  /** ③ 시간 밴드 불일치 — 2밴드 이상 벌어진 단계쌍 비율 */
  bandDisagreeRatio: number;
  /** ④ 단계 순서 일치도 — 정규화 Kendall tau (1 = 완전 같은 순서) */
  orderTau: number;
};

/**
 * 혼자 쓴 문서에서는 계산할 수 없다. 이때 1.0을 주면 안 된다 —
 * "혼자 하니까 표준"은 거짓이고, 1인 문서가 전부 Feasibility 상위로 올라간다.
 */
export function standardization(v: GroupVariance | null): FeasibilityFactor {
  if (v === null || v.n < 2) {
    return {
      value: NEUTRAL_WHEN_UNKNOWN.standardization,
      coverage: 0,
      because: '이 일을 적은 사람이 아직 한 명이라 비교할 수 없어요',
    };
  }

  const stepAgree = clamp01(1 - v.stepCountCv); // CV 0 → 1, CV 1 → 0
  const value =
    0.25 * stepAgree +
    0.3 * v.toolJaccard +
    0.25 * (1 - v.bandDisagreeRatio) +
    0.2 * v.orderTau;

  // 사람이 많을수록 이 측정을 더 믿는다
  const coverage = Math.min(0.95, 0.3 + 0.15 * v.n);

  const axes: [string, number][] = [
    ['단계 수', stepAgree],
    ['쓰는 도구', v.toolJaccard],
    ['걸리는 시간', 1 - v.bandDisagreeRatio],
    ['순서', v.orderTau],
  ];
  const weakest = axes.reduce((a, b) => (a[1] <= b[1] ? a : b))[0];

  return {
    value: clamp01(value),
    coverage,
    because:
      value >= 0.75
        ? `${v.n}명이 거의 같은 방식으로 적었어요`
        : `${v.n}명이 적은 내용 중 ${weakest}이(가) 서로 달라요`,
  };
}

/* ── 3.6 안정성 (0.10) — 데이터로 못 얻는다 (D-087) ──────────────────────── */

export type StabilityDomain =
  | 'statutory'   // 법정 절차 (4대보험·세금계산서·급여·부가세)
  | 'accounting'
  | 'contract'
  | 'operations'
  | 'sales'
  | 'marketing';

const DOMAIN_PRIOR: Record<StabilityDomain, number> = {
  statutory: 0.9,
  accounting: 0.8,
  contract: 0.65,
  operations: 0.6,
  sales: 0.5,
  marketing: 0.35,
};

const ANSWER_SCORE = { 'will-change': 0.25, unknown: 0.55, stable: 0.9 } as const;

export type StabilityInput = {
  /** 3층: 사람이 직접 답한 것. 있으면 무조건 이것이 이긴다 */
  changeExpected: 'will-change' | 'unknown' | 'stable' | null;
  /** 2층: 도메인 사전값 */
  domain: StabilityDomain | null;
  /** 1층: 프록시 (관측 가능한 과거) */
  proxy: {
    structuralEditsLast90d: number;
    daysSinceConfirmed: number | null;
    toolChanged: boolean;
    /** 문서 나이(일) — 60일 미만이면 편집 이력은 "불안정"이 아니라 "작성 중"이다 */
    docAgeDays: number;
  };
};

/**
 * *"앞으로 이 프로세스가 얼마나 안 바뀔 것인가"* 는 미래에 대한 질문이고
 * 우리 데이터에는 과거만 있다. **지어내는 대신 세 층으로 폴백하고,
 * 어느 층에서 나온 값인지를 `coverage`와 `because`로 드러낸다.**
 *
 * 이것이 6요소 중 유일하게 "데이터로 계산할 수 없는" 요소를 다루는 방식이다.
 */
export function stability(x: StabilityInput): FeasibilityFactor {
  // ── 3층 ── 상위 후보 진입 시점에만 딱 한 문항 묻는다
  if (x.changeExpected) {
    return {
      value: ANSWER_SCORE[x.changeExpected],
      coverage: 1,
      because:
        x.changeExpected === 'will-change'
          ? '곧 방식이 바뀔 예정이라고 하셨어요'
          : x.changeExpected === 'stable'
            ? '당분간 안 바뀐다고 하셨어요'
            : '바뀔지 모르겠다고 하셨어요',
    };
  }

  // ── 1층 프록시 ──
  const proxyUsable = x.proxy.docAgeDays >= 60;
  let proxyScore: number | null = null;
  if (proxyUsable) {
    const edits = x.proxy.structuralEditsLast90d;
    proxyScore = edits === 0 ? 0.9 : edits <= 2 ? 0.7 : edits <= 5 ? 0.5 : 0.3;
    if (x.proxy.toolChanged) proxyScore -= 0.15;
    // 오래 확인 안 된 문서는 "안 바뀐 것"이 아니라 "모르는 것"이다 → 중립으로 끌어당긴다
    if ((x.proxy.daysSinceConfirmed ?? 0) > 180) {
      proxyScore = proxyScore * 0.5 + NEUTRAL_WHEN_UNKNOWN.stability * 0.5;
    }
  }

  // ── 2층 도메인 prior ──
  const prior = x.domain ? DOMAIN_PRIOR[x.domain] : null;

  if (proxyScore !== null && prior !== null) {
    return {
      value: clamp01(0.5 * proxyScore + 0.5 * prior),
      coverage: 0.5,
      because: '지금까지 바뀐 이력과 업무 종류로 추정한 값이에요',
    };
  }
  if (prior !== null) {
    return { value: prior, coverage: 0.3, because: '업무 종류로 추정한 값이에요' };
  }
  if (proxyScore !== null) {
    return {
      value: clamp01(proxyScore),
      coverage: 0.3,
      because: '지금까지 이 문서가 바뀐 이력으로 추정한 값이에요',
    };
  }
  return {
    value: NEUTRAL_WHEN_UNKNOWN.stability,
    coverage: 0,
    because: '이 항목은 아직 추정값이에요',
  };
}

/* ── 3.7 조립 ─────────────────────────────────────────────────────────────── */

export function feasibility(
  f: Record<FeasibilityKey, FeasibilityFactor>,
  cap: FeasibilityCap | null,
): FeasibilityResult {
  let score = 0;
  let covWeighted = 0;
  for (const k of Object.keys(F_WEIGHTS) as FeasibilityKey[]) {
    score += F_WEIGHTS[k] * f[k].value;
    covWeighted += F_WEIGHTS[k] * f[k].coverage;
  }
  const uncapped = clamp01(score);
  if (cap && uncapped > cap.limit) {
    return {
      score: cap.limit,
      factors: f,
      cappedBy: cap.reason,
      uncappedScore: uncapped,
      coverage: clamp01(covWeighted),
    };
  }
  return {
    score: uncapped,
    factors: f,
    cappedBy: null,
    uncappedScore: uncapped,
    coverage: clamp01(covWeighted),
  };
}

export type ScopeFeasibilityInput = {
  determinism: DeterminismInput;
  inputStructure: InputStructureInput;
  /** 스코프 전체의 도구 — 캡 판정은 여기서만 난다 */
  allToolIds: readonly string[];
  catalog: ToolCatalog;
  exception: ExceptionInput;
  groupVariance: GroupVariance | null;
  stability: StabilityInput;
};

export function scoreFeasibility(x: ScopeFeasibilityInput): FeasibilityResult {
  const sa = systemAccess(x.allToolIds, x.catalog);
  return feasibility(
    {
      determinism: determinism(x.determinism),
      inputStructure: inputStructure(x.inputStructure),
      systemAccess: sa.factor,
      exceptionInv: exceptionInverse(x.exception),
      standardization: standardization(x.groupVariance),
      stability: stability(x.stability),
    },
    sa.cap,
  );
}

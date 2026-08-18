/**
 * packages/scoring/src/types.ts
 *
 * 이 파일이 막는 버그는 셋이고, 셋 다 **주석으로는 못 막는 것**이다.
 *
 *  ① 중복 계산  — `Volume` 판별 유니온. F와 N_people 중 하나만 조직 규모를 담는다 (D-084)
 *  ② 0 = 미산정 — `Money` 판별 유니온. 미산정을 0으로 접는 코드가 컴파일되지 않는다 (D-117)
 *  ③ 시간 실측  — `DurationEvidence`에 스톱워치 변형이 **없다** (D-115)
 */

/* ── 시간 밴드 ────────────────────────────────────────────────────────────── */

/** graph-core의 `DurationBand`와 같은 값이어야 한다. golden.test.ts가 대조한다 */
export type DurationBand = '1m' | '5m' | '15m' | '1h' | 'halfday' | '1d+';

/* ── 도구 ─────────────────────────────────────────────────────────────────── */

/** TOOLS.md 연결성 등급 — 상 / 중 / 하 */
export type ToolGrade = 'high' | 'mid' | 'low';

export type ToolEntry = {
  id: string;
  name: string;
  grade: ToolGrade;
  /** 이 도구가 붙으면 Feasibility 상한이 0.5로 캡된다 (공동인증서·전화·종이·HWP·카톡·구두) */
  capsFeasibility: boolean;
  /** 입력이 구조화 데이터인가 — 시트/ERP/쇼핑몰 = true, 메신저/메일본문/종이 = false */
  structuredIO: boolean;
  /** "이 도구를 X로 바꾸면 상이 된다" — 선행 개선 후보용 */
  upgradePath?: { toToolId: string; note: string };
};

export type ToolCatalog = Readonly<Record<string, ToolEntry>>;

/* ── 자동화 수준 ──────────────────────────────────────────────────────────── */

export type AutomationLevel = 'manual' | 'semi' | 'auto';

/** PRD §4.8 확정값. 곱이 아니라 계수 */
export const SAVE_RATE: Record<AutomationLevel, number> = {
  manual: 0.7,
  semi: 0.4,
  auto: 0.1,
};

/* ── ① Volume — 중복 계산을 타입이 막는다 (D-084) ─────────────────────────── */

/**
 * 규모는 둘 중 하나로만 표현된다. **두 필드를 동시에 노출하지 않는다.**
 *
 *   per-person : "한 사람이 월 20건" × "그런 사람이 8명"
 *   org-total  : "조직 전체 월 88건"   ← 인원은 이미 건수에 녹아 있다
 *
 * SEED-CONTENT §D의 `N_people = 1 (중복 계산 방지)` 주석이 이 버그의 흔적이다.
 * 주석은 6개월이면 지워진다. 타입은 안 지워진다.
 *
 * `org-total`에는 `nPeople` **필드 자체가 없으므로** 곱할 대상이 없다.
 */
export type Volume =
  | { readonly kind: 'per-person'; readonly fPerPersonMonth: number; readonly nPeople: number }
  | { readonly kind: 'org-total'; readonly fOrgMonth: number };

/* ── ② Money — 0과 미산정은 다른 것이다 (D-117) ───────────────────────────── */

/**
 * 금액 항. `number | null`이 아닌 이유:
 *   `krw ?? 0`은 컴파일된다. `money.krw`는 컴파일되지 않는다.
 *
 * 0원은 **"가치 없음"** 이고 미산정은 **"우리가 모름"** 이다.
 * 이 구분이 사라지면 리드타임 가치가 큰 후보(SEED D-2)가 조용히 순위에서 사라진다.
 */
export type Money =
  | { readonly kind: 'priced'; readonly krw: number; readonly basis: string }
  | { readonly kind: 'unpriced'; readonly note: string };

export function priced(krw: number, basis: string): Money {
  return { kind: 'priced', krw, basis };
}

export function unpriced(note: string): Money {
  return { kind: 'unpriced', note };
}

/** 미산정은 0이 아니라 **빠진다**. 합계에는 "이상"이 붙는다 */
export function sumMoney(terms: readonly Money[]): {
  krw: number;
  unpriced: readonly string[];
  atLeast: boolean;
} {
  let krw = 0;
  const missing: string[] = [];
  for (const t of terms) {
    if (t.kind === 'priced') krw += t.krw;
    else missing.push(t.note);
  }
  return { krw, unpriced: missing, atLeast: missing.length > 0 };
}

/* ── ③ Confidence — 빈도와 시간의 비대칭 (D-115) ──────────────────────────── */

/**
 * 빈도 실측의 증거.
 * "했음" 탭 카운터는 사람이 **자기 손으로 눌러서** 세는 것이고, 감시가 아니다.
 */
export type FrequencyEvidence =
  | { readonly kind: 'self-estimate' }
  | { readonly kind: 'cadence' }
  | {
      readonly kind: 'counter';
      readonly observedEvents: number;
      readonly answeredDays: number;
      readonly promoted: boolean;
    };

/**
 * 시간 추정의 증거. **여기에 스톱워치 변형이 없는 것이 D-115의 전부다.**
 *
 *   타이머를 붙이는 순간 이 제품은 D-002가 막으려는 것과 같은 감시 도구가 된다.
 *   그래서 시간은 구조적으로 자가추정에 머문다. 유일한 예외가 `checklist-proxy`이고,
 *   그것도 **단계 5개 이하 · 예상 리드타임 1시간 이하**의 짧은 흐름에서만 성립한다
 *   (체크리스트 시작~완료 간격은 원래 리드타임이지 접촉시간이 아니기 때문에).
 *
 * 이 유니온에 `{ kind: 'stopwatch' }`를 추가하자는 PR이 온다면, 그것이 거절해야 할
 * PR이다. 타입을 넓히는 한 줄이 제품의 성격을 바꾼다.
 */
export type DurationEvidence =
  | { readonly kind: 'self-estimate'; readonly band: DurationBand }
  /** 2주 세션 마지막 날의 회고 1문항 (§7.4). 자가추정보다 신선하지만 여전히 자가보고다 */
  | { readonly kind: 'retrospective'; readonly band: DurationBand }
  /** 동료 중앙값 — 관측이 아니라 합의다. Confidence의 peerAgreement 항이 담당한다 */
  | { readonly kind: 'peer-median'; readonly band: DurationBand; readonly peers: number }
  /** 유일한 관측. 짧은 흐름에서만 접촉시간의 근사로 쓴다 */
  | {
      readonly kind: 'checklist-proxy';
      readonly hours: number;
      readonly stepCount: number;
      readonly leadTimeH: number;
    };

export type ConfidenceEvidence = {
  /** §7.2 — 독립 기여자 3명 이상이 시간·빈도·단계 구성에서 일치 */
  peerAgreement: boolean;
  frequency: FrequencyEvidence;
  duration: DurationEvidence;
  /** 추론된 SaveRate를 사람이 확인했는가 (§2.4) */
  saveRateConfirmed: boolean;
  /** 마지막 확인으로부터 경과일. 신선도 감쇠에 쓴다 */
  daysSinceConfirmed: number | null;
};

export type ConfidenceLabel = '본인 추정' | '동료 확인' | '실측';

export type Confidence = {
  value: number;
  label: ConfidenceLabel;
  /** 가법 분해의 항별 기여. 화면에 "무엇이 신뢰도를 올렸는지" 그대로 보여준다 */
  parts: readonly { key: string; delta: number; because: string }[];
  /** ★ 시간이 여전히 자가보고인가. 거의 언제나 true다 — 그게 D-115의 결과다 */
  timeIsSelfReported: boolean;
  /** 신선도 감쇠 계수 (1 / 0.85 / 0.7) */
  decay: number;
};

/* ── Feasibility ──────────────────────────────────────────────────────────── */

export type FeasibilityFactor = {
  /** 0..1 */
  value: number;
  /** 0..1 — 이 값이 얼마나 데이터에 근거하는가. 0이면 value는 중립값이어야 한다 */
  coverage: number;
  /** 화면에 그대로 나가는 근거 한 줄 */
  because: string;
};

export type FeasibilityKey =
  | 'determinism'
  | 'inputStructure'
  | 'systemAccess'
  | 'exceptionInv'
  | 'standardization'
  | 'stability';

export type FeasibilityResult = {
  score: number;
  factors: Record<FeasibilityKey, FeasibilityFactor>;
  /** 캡이 걸렸으면 그 이유. null이면 캡 없음 */
  cappedBy: string | null;
  /** 캡 전 원점수 — "도구를 바꾸면 여기까지 간다"를 말하기 위해 남긴다 */
  uncappedScore: number;
  coverage: number;
};

/* ── 후보 ─────────────────────────────────────────────────────────────────── */

export type CandidateKind = 'eliminate' | 'automate' | 'precondition';

export type ValueBreakdown = {
  /** (T_touch × 연간건수 × Rate) × SaveRate */
  labor: Money;
  leadTime: Money;
  risk: Money;
  totalKrw: number;
  /** 계산하지 못한 항목의 사람 말 목록. 카드에 그대로 나간다 */
  unpriced: readonly string[];
  /** true면 표기에 반드시 "이상"이 붙는다 */
  atLeast: boolean;
};

export type Candidate = {
  id: string;
  kind: CandidateKind;
  docId: string;
  itemIds: readonly string[];
  value: ValueBreakdown;
  feasibility: FeasibilityResult;
  confidence: Confidence;
  /** Value × Feasibility × Confidence (PRD §4.8) */
  priorityKrw: number;
  /** 하한 정렬 키 (D-090). 미산정 항을 뺀 보수적 값 */
  priorityP10Krw: number;
  coverage: number;
};

/* ── 프롬프트 응답 ────────────────────────────────────────────────────────── */

export type PromptKind =
  | 'exception-per-10'
  | 'rejection-6m'
  | 'criteria-source'
  | 'batch-or-each'
  | 'output-reader'
  | 'peer-count'
  | 'delegable'
  | 'push-or-poll'
  | 'deadline-crunch'
  | 'change-expected'
  | 'removal-impact';

export type PromptValue = {
  num?: number;
  choice?: string;
  text?: string;
  /** 재질문("정말 한 번도요?") 후의 응답인가 */
  reasked?: boolean;
};

/** kind → itemId → 값. 문서 전체 응답은 itemId = '@doc' */
export type PromptAnswers = Readonly<Record<string, Readonly<Record<string, PromptValue>>>>;

export const DOC_SCOPE = '@doc';

export function answerOf(
  answers: PromptAnswers,
  kind: PromptKind,
  itemId: string | null,
): PromptValue | null {
  const byItem = answers[kind];
  if (!byItem) return null;
  return byItem[itemId ?? DOC_SCOPE] ?? byItem[DOC_SCOPE] ?? null;
}

/* ── 작은 유틸 ────────────────────────────────────────────────────────────── */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

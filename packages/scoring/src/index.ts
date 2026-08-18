/**
 * packages/scoring — 공개 API.
 *
 * 의존 방향은 한 방향이다:
 *   graph-core (구조·시간 DP)  →  [숫자]  →  scoring (스코어·ECRS·가드)
 *
 * scoring은 graph-core를 **런타임으로 물지 않는다.** 그래프 의미론을 여기서
 * 다시 해석하지 않기 위해서다. 대신 골든 테스트가 `BAND_HOURS`를 원본과 대조한다.
 */

export type {
  AutomationLevel,
  Candidate,
  CandidateKind,
  Confidence,
  ConfidenceEvidence,
  ConfidenceLabel,
  DurationBand,
  DurationEvidence,
  FeasibilityFactor,
  FeasibilityKey,
  FeasibilityResult,
  FrequencyEvidence,
  Money,
  PromptAnswers,
  PromptKind,
  PromptValue,
  ToolCatalog,
  ToolEntry,
  ToolGrade,
  ValueBreakdown,
  Volume,
} from './types.ts';

export { SAVE_RATE, DOC_SCOPE, answerOf, clamp01, median, priced, sumMoney, unpriced } from './types.ts';

export {
  BAND_HOURS,
  BAND_ORDER,
  BAND_RANGE_H,
  bandDistance,
  scopeTouchCoverage,
  scopeTouchH,
  scopeTouchRangeH,
} from './duration.ts';
export type { ScopeStep } from './duration.ts';

export {
  annualEvents,
  monthlyEvents,
  orgTotalVolume,
  perPersonVolume,
  resolveFrequency,
  resolveNPeople,
  rollupToOrgTotal,
  volumeFromStep,
} from './volume.ts';
export type {
  Cadence,
  FreqResult,
  FreqSource,
  MeasuredFreq,
  PeopleResult,
  PeopleSignals,
} from './volume.ts';

export {
  CAP_TOOL_NOTE,
  FEASIBILITY_CAP,
  F_WEIGHTS,
  NEUTRAL_WHEN_UNKNOWN,
  classifyCaseLabel,
  determinism,
  exceptionInverse,
  feasibility,
  inputStructure,
  precondition,
  scoreFeasibility,
  stability,
  standardization,
  systemAccess,
} from './feasibility.ts';
export type {
  DeterminismInput,
  ExceptionInput,
  FeasibilityCap,
  GroupVariance,
  InputStructureInput,
  LabelClass,
  ObjectClass,
  PreconditionSuggestion,
  ScopeFeasibilityInput,
  StabilityDomain,
  StabilityInput,
} from './feasibility.ts';

export {
  STATUTORY_PENALTIES,
  composeValue,
  delayCostRate,
  delayCostUnit,
  estimatedLeadTimeAfterH,
  fmtDays,
  fmtHours,
  fmtKrw,
  formatMoney,
  laborValue,
  leadTimeValue,
  priority,
  riskValue,
} from './value.ts';
export type {
  DelayCostModel,
  DelayCostUnit,
  LeadTimeResult,
  LeadTimeStep,
  RiskInput,
  StatutoryPenalty,
} from './value.ts';

export {
  CONFIDENCE_BASE,
  CONFIDENCE_DELTA,
  PROMOTION_RULES,
  confidence,
  confidenceLabel,
  evaluatePromotion,
  freshnessDecay,
  independentMembers,
  isDurationMeasured,
  isFrequencyMeasured,
  jaccard,
  peerAgreement,
} from './confidence.ts';
export type {
  CounterState,
  PeerAgreementResult,
  PeerMember,
  PromotionVerdict,
} from './confidence.ts';

export {
  E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12,
  PATTERNS,
  PATTERN_BY_ID,
  detectElimination,
  eliminatedNodeIds,
  normalizeKo,
  precisionTier,
  rollupForAdmin,
  simKo,
} from './ecrs.ts';
export type {
  EcrsAction,
  EcrsContext,
  EcrsDoc,
  EcrsStep,
  EliminationHit,
  EliminationPattern,
  EliminationRollup,
  EliminationSaving,
  ExecCopy,
  OverlapLink,
  PrecisionTier,
} from './ecrs.ts';

export {
  ForbiddenOutputError,
  OUTPUT_RULES,
  assertRenderable,
  findForbiddenOutput,
  screenOutput,
  selfTestRules,
} from './guard.ts';
export type { OutputRule, OutputViolation } from './guard.ts';

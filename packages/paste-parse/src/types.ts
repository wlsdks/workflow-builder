/**
 * packages/paste-parse/src/types.ts
 *
 * 순수 타입 정의. React / Drizzle / DOM 의존 금지 (D-033).
 *
 * 이 파일의 중심은 `Span`이다. PARSING §0.1 —
 *   **파서는 문자열을 자르지 않는다. 전 파이프라인이 원문 위의 구간 대수로만 동작한다.**
 * 그래서 여기 있는 거의 모든 타입이 문자열이 아니라 `[시작, 끝)` 인덱스를 들고 다닌다.
 */

/** 원문(또는 work) 위의 반열린 구간 `[시작, 끝)`. 이 파서의 유일한 1급 값 */
export type Span = [number, number];

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 도메인 (graph-core의 입력층과 어휘를 맞춘다)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ItemKind = 'task' | 'branch' | 'hold';
export type BranchMode = 'xor' | 'and' | 'skip';
export type WaitFor = 'approval' | 'reply' | 'time' | 'resource';
export type DurationBand = '1m' | '5m' | '15m' | '1h' | 'halfday' | '1d+';
export type Confidence = 'low' | 'mid' | 'high';

/** MEASUREMENT.md가 정의한 4종과 정확히 일치한다 (§10.1) */
export type FailureReason = 'too_short' | 'no_delimiter' | 'single_block' | 'over_limit';

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 소스 감지 (§2)
 * ──────────────────────────────────────────────────────────────────────────── */

export type SourceHint =
  | 'word_sop' | 'kakao' | 'email' | 'table' | 'notion'
  | 'minutes' | 'prose' | 'ppt' | 'unknown';

export type Trait =
  | 'numbered' | 'bulleted' | 'checkbox' | 'heading'     // 구조 마커
  | 'tabbed' | 'indented' | 'wrapped'                     // 레이아웃
  | 'timestamped' | 'speakered' | 'emoticon'              // 대화
  | 'mail_headered' | 'quoted' | 'signed'                 // 메일
  | 'sectioned' | 'mentioned'                             // 회의록
  | 'noun_ended' | 'short_lines';                         // PPT

export type Detection = {
  hint: SourceHint;
  /** 0..1 — §9 신뢰도 산출에 그대로 들어간다 */
  certainty: number;
  traits: Set<Trait>;
  meta: { lineCount: number; charLen: number; modalWidth: number; tabCols: number | null };
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 라인 모델 (§3.1)
 * ──────────────────────────────────────────────────────────────────────────── */

export type MarkerClass =
  | 'checkbox' | 'heading' | 'decimalMulti' | 'decimalDot' | 'decimalParen' | 'decimalWrap'
  | 'circledNum' | 'hangulOrder' | 'circledHangul' | 'roman' | 'alpha' | 'bullet' | 'arrow' | 'step';

export type Marker = {
  cls: MarkerClass;
  raw: string;
  value: number | null;
  /** 프리픽스 길이 (들여쓰기 제외, 마커 뒤 공백 포함) */
  consumed: number;
  /** 시퀀스 검증(§3.2)에서 가짜로 판정돼 강등됐는가 */
  demoted?: boolean;
};

export type Line = {
  i: number;
  /** work 좌표, 개행 제외 */
  span: Span;
  text: string;
  /** 탭=4열로 확장한 시각적 열 수 */
  indentWidth: number;
  rawIndent: string;
  marker: Marker | null;
  /** 직전 연속 빈 줄 수 */
  blankBefore: number;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 노이즈 (§8)
 * ──────────────────────────────────────────────────────────────────────────── */

export type DropReason =
  | 'mail_header' | 'quoted' | 'signature' | 'chat_meta' | 'page_number'
  | 'running_head' | 'separator'
  | 'doc_title' | 'section_header' | 'minutes_header' | 'greeting' | 'closing'
  | 'lead_in' | 'ack' | 'emoticon' | 'context_section' | 'schedule' | 'meta_stat'
  | 'empty' | 'over_budget';

/**
 * 삭제가 아니라 **보류**다 (§8.1).
 *   strip  — 확실한 비본문. 결과 화면에서 "숨긴 줄 N개 보기"로만 접근
 *   demote — 본문일 수도 있는 것. 회색 텍스트로 **그대로 화면에 남는다**
 */
export type Dropped = { range: Span; reason: DropReason; tier: 'strip' | 'demote' };

/* ────────────────────────────────────────────────────────────────────────────
 * 5. 경계 판정 (§3.4)
 * ──────────────────────────────────────────────────────────────────────────── */

/** 부록 B의 규칙 ID. 문자열로 두는 이유는 텔레메트리 축이 확장되기 때문이다 */
export type RuleId = string;

export type Segment = {
  /** work 좌표. 앞뒤 공백은 이미 잘라낸 상태 */
  span: Span;
  text: string;
  line: Line;
  /** 이 세그먼트가 나온 줄 번호 */
  originLine: number;
  /** 같은 줄 안에서 몇 번째 문장인가 — §6.3 sameSentence 판정의 축 */
  originSentence: number;
  marker: Marker | null;
  indentWidth: number;
  blankBefore: number;
  speaker: string | null;
  boundaryBy: RuleId;
  boundaryConfidence: number;
  /** R7 절 분할로 생긴 항목인가 — §9 clauseRatio */
  fromClause: boolean;
  /** R2 표 행일 때의 열 매핑 결과 (§3.5). 열이 곧 스키마다 */
  cells?: { title: string; assigneeHint?: string; toolHint?: string; durationHint?: string; branchCondition?: string };
};

/* ────────────────────────────────────────────────────────────────────────────
 * 6. 출력 (부록 A)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ParsedItem = {
  id: string;
  title: string;
  kind: ItemKind;
  depth: number;
  branchCondition?: string;
  branchMode?: BranchMode;
  waitFor?: WaitFor;
  toolHints: string[];
  assigneeHint?: string;
  durationHint?: string;
  durationBand?: DurationBand;
  freqHint?: string;
  sourceRange: Span;

  /** depth만으로는 형제/자식 관계가 유일하게 복원되지 않는다 (부록 A) */
  parentId?: string;
  /** §9.2 점선 UI · §13.4 (2) — **소급 계산할 수 없는 유일한 값** */
  boundaryConfidence: number;
  boundaryBy: RuleId;
  classifyRule: string;
  /** 부속절에만 대기 어휘가 있음 → 질문 연쇄가 회수 (§5.3) */
  holdSuspect?: boolean;
  /** 종결 어휘 감지 → 그래프 end 노드 연결 힌트 (§4.4) */
  isTerminal?: boolean;
};

export type RuleHits = {
  // ★ MEASUREMENT.md 계약 — 이벤트로 나가는 3개
  /** R4 + R5 로 만들어진 경계 수 */
  newline: number;
  /** R1 + R2 */
  numbering: number;
  /** R6 + R7 (동사·어미 패턴) */
  verb: number;
  /** 내부 세부 (이벤트로 나가지 않음) — 부록 B */
  detail: Record<RuleId, number>;
};

export type ParseResult = {
  items: ParsedItem[];
  dropped: Dropped[];
  confidence: Confidence;
  ruleHits: RuleHits;
  unparsedTail?: string;
  /** ★ 문자열만 주면 무손실 검증을 할 수 없다 (§10.2) */
  unparsedTailRange?: Span;
  failure?: { reason: FailureReason; at?: number };

  docTitleHint?: string;
  /** 흐름 전체에 걸린 메타 (§11 F6) */
  docHints?: { durationHint?: string; freqHint?: string };
  sourceHint: SourceHint;
  traits: Trait[];
  ruleVersion: string;
  pipelineId: string;
  /** §9.1 — 왜 낮았는가 */
  confidenceReasons: string[];
  confidenceScore: number;
  /** TOOLS.md 카탈로그 확장 큐 (§7.1) */
  unmatchedToolCandidates: string[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * 7. 힌트 (§7)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ToolHit = { id: string; display: string; span: Span };
export type PersonHit = {
  id: string;
  kind: 'person' | 'role' | 'self';
  name: string;
  /** 격조사로 읽은 방향 (§7.2) */
  direction: 'actor' | 'recipient' | 'collab' | 'none';
  span: Span;
};

export type Hints = {
  tools: ToolHit[];
  people: PersonHit[];
  durationHint?: string;
  durationBand?: DurationBand;
  freqHint?: string;
};

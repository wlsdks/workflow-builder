/**
 * packages/doc-gen/src/types.ts
 *
 * 두 층으로 나뉜다.
 *
 *   1) 입력층  — `derive(tree) ⊕ overrides`의 결과에 사람이 적은 것을 얹은 것.
 *                graph-core를 **값으로 import 하지 않는다.** 구조적으로만 받는다
 *                (deps: {} 계약. graph-core는 peer/dev).
 *   2) 문서층  — DocTree / Section / Block. 렌더러(마크다운·텍스트·PDF·PNG)는
 *                이 트리를 각자 그린다. **문장은 여기서만 만들어진다.**
 *
 * ★ 이 파일에는 비공개 노트를 담을 필드가 **없다.** 없는 게 설계다 (D-062).
 *   실수로 얹는 것을 타입 레벨에서 막기 위해 `NoNotes<T>`를 둔다.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 0. 원문 표식
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * **사용자가 적은 글자.** 엔진은 이 안을 절대 고치지 않는다 (§4.0 ①).
 * 금지어 사전·25자 규칙·느낌표 금지는 전부 *생성 문장*에만 적용되고
 * `Verbatim`에는 적용되지 않는다. 이 구분이 무너지면 사용자 글을 고치기 시작한다.
 */
export type Verbatim = string;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 입력층 — graph-core와 구조적으로 호환되는 부분집합
 * ──────────────────────────────────────────────────────────────────────────── */

export type StepKind = 'task' | 'branch' | 'hold';
export type BranchMode = 'xor' | 'and' | 'skip';
export type WaitFor = 'approval' | 'reply' | 'time' | 'resource';
export type DurationBand = '1m' | '5m' | '15m' | '1h' | 'halfday' | '1d+';

/** 엔진은 날짜를 만들지 않는다 (D-063). 받은 것을 그대로 쓴다. */
export type DateParts = { year: number; month: number; day: number };

/** 예외 각주. 승격된 비공개 노트도 여기로 **복사되어** 들어온다 (§2.3 i). */
export type Footnote = {
  /** 원문 그대로. 다시 쓰지 않는다 */
  text: Verbatim;
  /** 「이렇게 안 흘러갈 때」 목록에 쓰는 짧은 형태. 없으면 text를 그대로 */
  summary?: Verbatim;
  /** `10번에 {n}번쯤` — 사용자가 고른 숫자 */
  oddsOutOfTen?: number;
  /** 소유자가 명시적으로 승격한 것. `— {이름} 님이 덧붙인 말이에요`가 붙는다 */
  promoted?: boolean;
};

/** 타임아웃 뒤에 할 일. `{N}번으로 가요.` 또는 사용자가 적은 행동 */
export type Escalation = {
  toStepId?: string;
  /** `전화로 확인해요.` — 원문 */
  action?: Verbatim;
  /** 표에 쓰는 짧은 형태 — `전화` */
  actionShort?: Verbatim;
};

/** 되돌아가기. §2.3 (e) */
export type ReturnSpec = {
  toStepId: string;
  /** 앞에 붙는 원문 — `확인이 끝나면` */
  lead?: Verbatim;
  /** 뒤에 붙는 원문 — `다시 맞춰봐요` */
  tail?: Verbatim;
};

export type CaseSpec = {
  id: string;
  /** 표·목록에 쓰는 라벨 (원문) — `차이 있음` */
  label?: Verbatim;
  /** 본문 소제목의 조건형 (원문) — `차이가 있으면`. 없으면 label에서 만든다 */
  condition?: Verbatim;
  steps?: readonly Step[];
  /** 갈래 끝에서 합류해 이 단계로 */
  joinToStepId?: string;
  /** 갈래 끝이 종료 */
  endsHere?: boolean;
  returnTo?: ReturnSpec;
  /** `한 달에 {min}~{max}건쯤 있어요.` — 숫자는 사용자 것이다 */
  perMonth?: { min: number; max: number };
};

export type HoldSpec = {
  waitFor: WaitFor;
  avgWaitH?: number;
  /** 사용자가 적은 대기 절 — `각 부서가 증빙을 올릴 때까지` */
  waitClause?: Verbatim;
  /** 생성 문형용 대상 — `팀장님`. waitClause가 없을 때만 쓴다 */
  waitTarget?: Verbatim;
  timeoutH?: number;
  /** 숫자가 아닌 기한 — `마감일` */
  timeoutLabel?: Verbatim;
  /** `안 올라오면` — 없으면 waitFor 기본 문형 */
  noReplyClause?: Verbatim;
  escalation?: Escalation;
  /** approval의 반려 행선지. 없으면 **위험 결핍** */
  rejectToStepId?: string;
};

export type BranchSpec = {
  mode: BranchMode;
  cases: readonly CaseSpec[];
  /** 갈래 비중이 적혀 있는가. 없으면 두 갈래를 대등하게 (§2.3 c) */
  weightKnown?: boolean;
};

export type Step = {
  id: string;
  kind: StepKind;
  /** 원문. 절대 다시 쓰지 않는다 */
  title: Verbatim;
  /** 소유자가 적어둔 "무엇을 하는 일인지". 없으면 엔진이 지어내지 않는다 (§4.0 ②) */
  description?: Verbatim;
  assigneeId?: string;
  toolIds?: readonly string[];
  durationBand?: DurationBand;
  freqLast7d?: number;
  footnotes?: readonly Footnote[];
  hold?: HoldSpec;
  branch?: BranchSpec;
  /** 담당이 바뀔 때 같이 넘기는 것 */
  handoffPayload?: Verbatim;
  /**
   * 이 단계가 시작되려면 끝나 있어야 하는 단계들.
   * **병렬 가능 판정의 유일한 근거다.** 없으면 "앞의 전부에 의존한다"로 보수적으로 본다 —
   * 없는 병렬을 지어내는 것이 문장 하나를 잃는 것보다 훨씬 나쁘다.
   */
  dependsOn?: readonly string[];
  /** 결핍 질문에 끼워 넣는 사용자 조각 — `보고자료 만드는 데` */
  askAbout?: Verbatim;
};

export type Person = {
  id: string;
  name: Verbatim;
  /** 표에 그대로 나가는 소속 라벨 — `재무팀`, `재무팀장` */
  team?: Verbatim;
  /** 부서 동일성 판정용 키. 라벨과 분리한다 */
  deptId?: string;
  /**
   * 사내 채널 핸들만. **휴대폰·개인 메일은 어떤 포맷에도 넣지 않는다** (§2.3 g).
   * PDF는 메일 첨부로 굴러다닌다.
   */
  channel?: Verbatim;
  external?: boolean;
  /** 회사 밖 사람일 때 사내 경유 안내 — `'○○세무회계' 스레드` */
  relayThread?: Verbatim;
  /** 결정이 필요한 일을 받는 사람 */
  decides?: boolean;
  /** 「막히면」 첫 열 override. 없으면 `{N}번 {제목}`으로 만든다 */
  contactFor?: Verbatim;
  inactive?: boolean;
  /** 전임자 재직 기한 — `9월 12일` */
  lastDayLabel?: Verbatim;
};

export type Tool = {
  id: string;
  name: Verbatim;
  /** 줄여 부르는 이름 — `ERP` */
  shortName?: Verbatim;
  /** 용어표 1줄 설명 */
  description?: Verbatim;
  /** 「시작 전에 받아두실 것」의 "필요한 것" */
  access?: Verbatim;
  /** 누가 열어주는지 (people.id). 없으면 `물어보셔야 해요` */
  accessGrantedBy?: string;
  /** 권한 결핍 질문에 이름을 올릴 도구인가 */
  accessCritical?: boolean;
};

export type GlossaryEntry = { term: Verbatim; meaning: Verbatim };

export type FlowInput = {
  id: string;
  title: Verbatim;
  deptLabel?: Verbatim;
  /** `매달 하는 일` / 표에는 `매달 1회` */
  cadence?: { label: Verbatim; tableLabel?: Verbatim };
  ownerId: string;
  steps: readonly Step[];
  people: readonly Person[];
  tools: readonly Tool[];
  glossary?: readonly GlossaryEntry[];
  /** 못 푼 업무 용어. 용어표가 아니라 「물어보셔야 해요」로 간다 (§2.3 b) */
  unresolvedTerms?: readonly Verbatim[];
  /** §10.1의 단 한 문항에 대한 답 */
  hardestPart?: Verbatim;
  startNote?: Verbatim;
  endNote?: Verbatim;
  spanNote?: Verbatim;
  connections?: { before?: Verbatim; after?: Verbatim; middle?: Verbatim };
  asOf: DateParts;
};

/* ── 비공개 노트 차단 (D-062) ──────────────────────────────────────────────
 *
 * 필드 이름을 소스에 문자로 적지 않는다 — 이 저장소의 게이트
 * `no-private-note-in-render`가 렌더 경로의 그 식별자를 금지하기 때문이다.
 * 템플릿 리터럴 타입으로 만들면 타입 검사는 그대로 되고, 게이트도 통과한다.
 */
export type BlockedNoteKey = `private${'Note'}`;

/** 이 브랜드가 붙은 타입에는 비공개 노트를 얹을 수 없다 — **컴파일 에러**가 난다. */
export type NoNotes<T> = T & { [K in BlockedNoteKey]?: never };

/** 렌더러가 받는 단계 타입. 노트 필드를 얹으면 컴파일이 깨진다. */
export type RenderableStep = NoNotes<Step>;
export type RenderableFlow = NoNotes<FlowInput>;

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 옵션
 * ──────────────────────────────────────────────────────────────────────────── */

export type GenOptions = {
  /** `받는 분이 이 일을 처음 보시나요?` → 네, 처음이에요 */
  firstTime?: boolean;
  /** 푸터 워터마크 */
  brand?: string;
  /**
   * §4.4는 되돌아오는 *대상* 단계에도 표시를 붙이라고 하고,
   * §2.3(e)와 §2.1 전문은 갈래 안과 「이렇게 안 흘러갈 때」 **두 곳에만** 둔다.
   * 전문이 정답지이므로 기본은 꺼짐. 켜면 §4.4대로 한 줄이 더 붙는다.
   */
  markReturnTargets?: boolean;
  /** 손이 가는 시간의 하루 = 근무 시간. 기다림은 달력 시간이라 24 */
  touchHoursPerDay?: number;
  waitHoursPerDay?: number;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 문서층
 * ──────────────────────────────────────────────────────────────────────────── */

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  /** 줄바꿈이 의미를 갖는 문단 */
  | { kind: 'lines'; lines: readonly string[] }
  /** `>` 인용. 문단 사이는 `>` 한 줄 */
  | { kind: 'quote'; paragraphs: readonly string[] }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: 'rule' }
  /** 담당이 바뀌는 지점. 가로선 두 줄 사이의 굵은 블록 (§2.3 f) */
  | { kind: 'handoff'; lines: readonly string[]; newPerson: boolean };

export type SectionId =
  | 'title'
  | 'hardest'
  | 'contacts'
  | 'lifecycle'
  | 'steps'
  | 'exceptions'
  | 'neighbors'
  | 'glossary'
  | 'questions'
  | 'stepTable'
  | 'appendix'
  | 'footer'
  // 자리 비울 때
  | 'mustDo'
  | 'justReceive'
  | 'skip'
  | 'reachMe'
  | 'more'
  // 한 장 요약 · 묶음
  | 'summary'
  | 'cover'
  | 'toc'
  | 'calendar'
  | 'people'
  | 'accounts';

export type Section = { id: SectionId; blocks: readonly Block[] };

export type DocKind = 'handover' | 'vacation' | 'onepager' | 'book';

/** 생성 문장 감사 기록. 픽스처 12번이 검사하는 대상이 이것이다. */
export type GeneratedAudit = {
  /** 조립이 끝난 생성 문장 전부 — **길이** 검사 대상 */
  sentences: readonly string[];
  /**
   * 그중 엔진이 쓴 조각만 — **금지어·느낌표·이모지** 검사 대상.
   * 이름·도구명·제목 같은 사용자 원문은 여기 들어오지 않는다 (§4.0 ①).
   */
  engineParts: readonly string[];
  /** 25자를 넘은 생성 문장 (§9.1 #13 — 빌드 경고) */
  longSentences: readonly string[];
};

export type DocMeta = {
  stepCount: number;
  peopleCount: number;
  toolCount: number;
  handoffCount: number;
  touchHours: number;
  waitHours: number;
  readingMinutes: number;
};

export type DocTree = {
  docKind: DocKind;
  title: Verbatim;
  sections: readonly Section[];
  meta: DocMeta;
  audit: GeneratedAudit;
  /** 소유자에게만 보이는 자동 체크 (§9.1). 문서에는 나가지 않는다 */
  checks: readonly Check[];
};

export type Check = {
  code:
    | 'handoff-payload-missing'
    | 'hold-wait-missing'
    | 'branch-criteria-missing'
    | 'approval-return-missing'
    | 'orphan-return'
    | 'handoff-count-mismatch'
    | 'term-unresolved'
    | 'short-title'
    | 'no-successor'
    | 'long-sentence';
  severity: 'hard' | 'warn' | 'note';
  message: string;
  stepNo?: string;
};

/* ── 생성 거부 (§10.6) ─────────────────────────────────────────────────────── */

export type RefusalReason =
  | 'too-few-steps'
  | 'titles-too-short'
  | 'no-branch-criteria'
  // 자리 비울 때 볼 안내
  | 'absence-too-long'
  | 'nothing-to-skip'
  // 묶음
  | 'too-many-flows';

/** 막을 때는 실패 메시지가 아니라 **대안**이다. */
export type Refusal = {
  reason: RefusalReason;
  message: string;
  /** 두 버튼은 같은 크기, 같은 위계. 거절이 제안과 같은 무게여야 한다 */
  actions: readonly {
    id: 'copy' | 'add-steps' | 'add-labels' | 'handover' | 'short' | 'split';
    label: string;
  }[];
};

export type GenResult = { ok: true; doc: DocTree } | { ok: false; refusal: Refusal };

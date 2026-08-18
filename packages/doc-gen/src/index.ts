/**
 * packages/doc-gen — 공개 API.
 *
 * `doc-gen`은 **순수 함수 패키지**다. 입력은 `derive(tree) ⊕ overrides`의 결과에
 * 사람이 적은 것을 얹은 것, 출력은 문서 트리. 렌더러(웹·PDF·마크다운·PNG)는 같은
 * 트리를 각자 그린다. **문장은 한 곳에서만 만들어지고, 포맷마다 다시 쓰지 않는다.**
 *
 * 런타임 의존성 0. graph-core도 값으로 import 하지 않는다 — 타입이 구조적으로
 * 호환되므로 `derive()` 결과를 그대로 얹을 수 있다.
 */

export type {
  Block,
  BranchMode,
  BranchSpec,
  CaseSpec,
  Check,
  DateParts,
  DocKind,
  DocMeta,
  DocTree,
  DurationBand,
  Escalation,
  FlowInput,
  Footnote,
  GeneratedAudit,
  GenOptions,
  GenResult,
  GlossaryEntry,
  HoldSpec,
  NoNotes,
  Person,
  Refusal,
  RefusalReason,
  RenderableFlow,
  RenderableStep,
  ReturnSpec,
  Section,
  SectionId,
  Step,
  StepKind,
  Tool,
  Verbatim,
  WaitFor,
} from './types.ts';

export { generateHandover, refusalFor, DocIntegrityError, MIN_STEPS, MIN_AVG_TITLE } from './render/handover.ts';
export { generateVacation, VACATION_MAX_DAYS } from './render/vacation.ts';
export type { VacationInput, VacationItem, VacationSpan } from './render/vacation.ts';
export { generateOnepager } from './render/onepager.ts';
export { generateBook, BOOK_MAX_FLOWS, FRONT_PAGES } from './render/book.ts';
export type { BookInput, BookEntry, BookGroup } from './render/book.ts';

export { toMarkdown, renderBlock } from './format/markdown.ts';
export type { MarkdownOptions } from './format/markdown.ts';
export { toPlainText } from './format/text.ts';

export {
  assertNoPrivateFields,
  assertCleanTree,
  assertTextAbsent,
  auditSentences,
  splitSentences,
  plainLength,
  FORBIDDEN_WORDS,
  PrivateLeakError,
} from './guard.ts';
export type { SentenceViolation } from './guard.ts';

export { collectGaps, handoffPoints } from './gaps.ts';
export type { Gap, GapKind, HandoffPoint } from './gaps.ts';

export { number } from './sentence/number.ts';
export type { Numbering, NumberedCase, NumberedStep } from './sentence/number.ts';

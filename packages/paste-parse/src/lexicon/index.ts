/**
 * packages/paste-parse/src/lexicon/index.ts  (PARSING §13.1)
 *
 * **사전은 코드가 아니라 주입되는 데이터다.**
 *
 * 지금은 기본 사전 하나뿐이지만, 이 경계선이 있어야
 *   (a) 조직별 오버라이드(더존 쓰는 회사 vs SAP 쓰는 회사)가 가능해지고
 *   (b) 미매칭 상위 20건 큐를 LLM이 자동 분류해 사전에 밀어 넣을 수 있고
 *   (c) 사전 변경이 코드 배포 없이 나간다.
 */

import { ACTION_VERBS, PLAIN_VERBS } from './verbs.ts';
import { BRANCH_MARKERS } from './branch.ts';
import { HOLD } from './hold.ts';
import { HANDOFF, TERMINAL, EXCEPTION } from './flow.ts';
import { TOOL_CATALOG, type ToolEntry } from './tools.ts';

export type Lexicon = {
  verbs: { action: readonly string[]; plain: readonly string[] };
  branch: typeof BRANCH_MARKERS;
  hold: typeof HOLD;
  handoff: typeof HANDOFF;
  terminal: typeof TERMINAL;
  exception: typeof EXCEPTION;
  tools: readonly ToolEntry[];
};

export const DEFAULT_LEXICON: Lexicon = {
  verbs: { action: ACTION_VERBS, plain: PLAIN_VERBS },
  branch: BRANCH_MARKERS,
  hold: HOLD,
  handoff: HANDOFF,
  terminal: TERMINAL,
  exception: EXCEPTION,
  tools: TOOL_CATALOG,
};

export * from './verbs.ts';
export * from './branch.ts';
export * from './hold.ts';
export * from './flow.ts';
export * from './endings.ts';
export * from './tools.ts';

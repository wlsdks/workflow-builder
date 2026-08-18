/**
 * @workflow/seed — 공개 API.
 *
 * 신규 사용자가 처음 보는 화면은 절대 빈 화면이면 안 된다.
 * **콜드 스타트는 직원이 아니라 팀이 직접 채워서 푼다.**
 *
 * 이 패키지는 데이터만 내보낸다. 런타임 의존성이 없고, 앞으로도 없어야 한다.
 * graph-core는 타입과 테스트에만 쓰인다 (`import type`이라 런타임에 사라진다).
 */

export type {
  Chip,
  ChipDeptId,
  Connectivity,
  Dept,
  DeptChips,
  DeptId,
  ExceptionPath,
  ExceptionPrompt,
  N8nMapping,
  PromptScope,
  Role,
  Seam,
  SeamChain,
  SeamRef,
  SeedClaims,
  SeedWorkflow,
  ToolCategory,
  ToolEntry,
} from './types.ts';

export { DEPTS, ROLES, ROLE_BY_ID, SEED_DIRECTORY } from './roles.ts';

export {
  TOOLS,
  TOOL_BY_ID,
  TOOL_ALIAS_INDEX,
  LOW_CONNECTIVITY_TOOL_IDS,
  FEASIBILITY_CAPPING_TOOL_IDS,
} from './tools.ts';

export { DEPT_CHIPS, ALL_CHIPS, CHIP_ESCAPE_LABEL, CHIP_PREVIEW_ACTIONS } from './chips.ts';

export {
  EXCEPTION_PROMPTS,
  COMMON_PROMPTS,
  TASK_PROMPTS,
  BRANCH_PROMPTS,
  HOLD_PROMPTS,
  TOOL_PROMPTS,
  COMPLETION_PROMPTS,
  MAX_PROMPTS_PER_STEP,
  MAX_PROMPTS_ON_COMPLETION,
} from './prompts.ts';

export {
  SEED_WORKFLOWS,
  WORKFLOW_BY_ID,
  PILOT_WORKFLOW_IDS,
  HR_01,
  HR_02,
  HR_03,
  FIN_01,
  FIN_02,
  FIN_03,
  SAL_01,
  SAL_02,
  CS_01,
  CS_02,
  GA_01,
  GA_02,
  MKT_01,
  OPS_01,
} from './workflows/index.ts';

export { SEAMS, SEAM_CHAINS, SEAM_COUNT_CLAIMED } from './seams.ts';

export { itemId, SEED_CONFIRMED_AT } from './workflows/_build.ts';

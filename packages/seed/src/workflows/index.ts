/**
 * packages/seed/src/workflows/index.ts
 *
 * 시드 업무 흐름 14개.
 *
 * 투입 순서는 SEED-CONTENT.md §E를 따른다 — FIN-01·GA-01·CS-01 3개를 먼저
 * 넣고 **내부 3명에게 읽혀본 뒤**("이거 우리 회사 맞아?") 나머지를 넣는다.
 * `PILOT_WORKFLOW_IDS`가 그 3개다.
 */

import type { SeedWorkflow } from '../types.ts';

import { HR_01 } from './hr-01.ts';
import { HR_02 } from './hr-02.ts';
import { HR_03 } from './hr-03.ts';
import { FIN_01 } from './fin-01.ts';
import { FIN_02 } from './fin-02.ts';
import { FIN_03 } from './fin-03.ts';
import { SAL_01 } from './sal-01.ts';
import { SAL_02 } from './sal-02.ts';
import { CS_01 } from './cs-01.ts';
import { CS_02 } from './cs-02.ts';
import { GA_01 } from './ga-01.ts';
import { GA_02 } from './ga-02.ts';
import { MKT_01 } from './mkt-01.ts';
import { OPS_01 } from './ops-01.ts';

export {
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
};

export const SEED_WORKFLOWS: readonly SeedWorkflow[] = [
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
];

export const WORKFLOW_BY_ID: ReadonlyMap<string, SeedWorkflow> = new Map(
  SEED_WORKFLOWS.map((w) => [w.id, w]),
);

/** 1주 후반에 먼저 넣고 내부 3명에게 읽혀볼 3개 */
export const PILOT_WORKFLOW_IDS: readonly string[] = ['FIN-01', 'GA-01', 'CS-01'];

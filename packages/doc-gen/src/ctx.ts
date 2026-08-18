/**
 * packages/doc-gen/src/ctx.ts
 *
 * 생성 컨텍스트. 문장 모듈이 공통으로 보는 것들만 담는다.
 */

import { Gen } from './audit.ts';
import { number, type Numbering } from './sentence/number.ts';
import type { FlowInput, GenOptions, Person, Step, Tool } from './types.ts';

export type ResolvedOptions = Required<GenOptions>;

export const DEFAULT_OPTIONS: ResolvedOptions = {
  firstTime: false,
  brand: '▣ Preflow로 만들었습니다',
  markReturnTargets: false,
  /** 손이 가는 시간의 하루 = 근무 시간 (반나절 4시간의 두 배) */
  touchHoursPerDay: 8,
  /** 기다리는 시간은 달력 시간이다. 사람이 손을 대는 구간이 아니다 */
  waitHoursPerDay: 24,
};

export type Ctx = {
  gen: Gen;
  flow: FlowInput;
  n: Numbering;
  opts: ResolvedOptions;
  owner: Person | undefined;
  person(id: string | undefined): Person | undefined;
  personName(id: string | undefined): string | undefined;
  tool(id: string): Tool | undefined;
  toolName(id: string): string;
  /** 흐름 평균 주간 빈도. FREQ 슬롯의 임계값 근거 */
  avgFreq: number;
  /** 최상위 단계 + 갈래 안 단계 전부 */
  allSteps: readonly Step[];
};

export function makeCtx(flow: FlowInput, options: GenOptions = {}): Ctx {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const people = new Map(flow.people.map((p) => [p.id, p]));
  const tools = new Map(flow.tools.map((t) => [t.id, t]));
  const n = number(flow.steps);

  const allSteps: Step[] = [];
  for (const s of flow.steps) {
    allSteps.push(s);
    for (const c of s.branch?.cases ?? []) for (const inner of c.steps ?? []) allSteps.push(inner);
  }

  const freqs = allSteps.map((s) => s.freqLast7d).filter((v): v is number => typeof v === 'number');
  const avgFreq = freqs.length ? freqs.reduce((a, b) => a + b, 0) / freqs.length : 0;

  const person = (id: string | undefined): Person | undefined => (id ? people.get(id) : undefined);

  return {
    gen: new Gen(),
    flow,
    n,
    opts,
    owner: people.get(flow.ownerId),
    person,
    personName: (id) => person(id)?.name,
    tool: (id) => tools.get(id),
    toolName: (id) => tools.get(id)?.name ?? id,
    avgFreq,
    allSteps,
  };
}

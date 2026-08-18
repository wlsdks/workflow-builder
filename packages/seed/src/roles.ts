/**
 * packages/seed/src/roles.ts
 *
 * 부서와 역할 계정.
 *
 * SEED-CONTENT §E 주의사항 1이 말하는 것: **담당자는 `assigneeId` FK다.**
 * 시드가 "회계담당자"라는 자유 텍스트로 들어가면 디렉터리 조인이 처음부터
 * 깨지고, 부서 간 인계 계산이 통째로 무의미해진다. 그래서 역할 계정을
 * 먼저 만들고, 흐름은 그 ID만 참조한다.
 */

import type { Dept, DeptId, Role } from './types.ts';

export const DEPTS: readonly Dept[] = [
  { id: 'hr', name: '인사' },
  { id: 'fin', name: '재무/회계' },
  { id: 'sal', name: '영업' },
  { id: 'cs', name: 'CS' },
  { id: 'ga', name: '총무' },
  { id: 'mkt', name: '마케팅' },
  { id: 'ops', name: '물류/운영' },
  { id: 'exec', name: '경영진' },
];

export const ROLES: readonly Role[] = [
  { id: 'role:hr-staff', name: '인사담당자', deptId: 'hr' },
  { id: 'role:hr-lead', name: '인사팀장', deptId: 'hr' },
  { id: 'role:acct-staff', name: '회계담당자', deptId: 'fin' },
  { id: 'role:acct-lead', name: '회계팀장', deptId: 'fin' },
  { id: 'role:payroll', name: '급여담당자', deptId: 'fin' },
  { id: 'role:sales-rep', name: '영업담당자', deptId: 'sal' },
  { id: 'role:sales-lead', name: '영업팀장', deptId: 'sal' },
  { id: 'role:cs-agent', name: 'CS담당자', deptId: 'cs' },
  { id: 'role:cs-lead', name: 'CS팀장', deptId: 'cs' },
  { id: 'role:ga-staff', name: '총무담당자', deptId: 'ga' },
  { id: 'role:ga-lead', name: '총무팀장', deptId: 'ga' },
  { id: 'role:mkt-staff', name: '마케팅담당자', deptId: 'mkt' },
  { id: 'role:mkt-lead', name: '마케팅팀장', deptId: 'mkt' },
  { id: 'role:designer', name: '디자이너', deptId: 'mkt' },
  { id: 'role:ops-staff', name: '물류담당자', deptId: 'ops' },
  { id: 'role:ops-lead', name: '물류팀장', deptId: 'ops' },
  { id: 'role:warehouse', name: '창고담당자', deptId: 'ops' },
  { id: 'role:qa', name: '품질담당자', deptId: 'ops' },
  { id: 'role:hiring-manager', name: '현업 면접관', deptId: 'exec' },
  { id: 'role:exec', name: '임원', deptId: 'exec' },
  { id: 'role:cfo', name: 'CFO', deptId: 'exec' },
];

export const ROLE_BY_ID: ReadonlyMap<string, Role> = new Map(ROLES.map((r) => [r.id, r]));

/**
 * `derive()`의 `options.directory`. 이게 없으면 부서 간 인계가 전부 0으로 나온다
 * — 0이 아니라 "알 수 없음"인데 0으로 보이는 것이 이 제품에서 제일 위험한 거짓말이다.
 */
export const SEED_DIRECTORY: Readonly<Record<string, { deptId: DeptId }>> = Object.fromEntries(
  ROLES.map((r) => [r.id, { deptId: r.deptId }]),
);

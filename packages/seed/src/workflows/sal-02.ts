/**
 * SAL-02 「계약 따고 나서 하는 일」
 *
 * SEED-CONTENT.md §A 요약표(13단계 · 인계 5회 · 대기 88% · 도구 8종).
 * J-05의 대표적 불일치가 10번에서 생긴다 —
 * **영업이 약속한 납기와 물류가 인지한 납기가 다르다.**
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'SAL-02';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '말로 합의된 조건 받아적기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['oral-request', 'slack'],
    pain: true,
  },
  {
    n: '2',
    title: '계약서 초안 만들기 — 지난 계약서 고쳐서',
    who: 'role:sales-rep',
    band: '1h',
    tools: ['hwp'],
    pain: true,
  },
  {
    n: '3',
    kind: 'hold',
    title: '법무·대표 검토 기다림',
    who: 'role:exec',
    tools: ['gmail'],
    pain: true,
    attrs: { waitFor: 'approval', avgWaitH: 72, timeoutH: 168 },
  },
  {
    n: '4',
    kind: 'branch',
    title: '누구 양식으로 쓰나',
    who: 'role:sales-rep',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('4a', '고객사 양식', [
        {
          n: '4a1',
          title: '조항 하나하나 대조해서 다른 데 표시하기',
          who: 'role:sales-rep',
          band: 'halfday',
          tools: ['hwp', 'paper'],
          pain: true,
          attrs: returnsTo(WF, '3', 0.25),
        },
      ]),
      kase('4b', '우리 양식'),
    ],
  },
  {
    n: '5',
    title: '어떻게 날인할지 정하기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['phone'],
  },
  {
    n: '6',
    kind: 'branch',
    title: '날인을 어떻게 하나',
    who: 'role:sales-rep',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kase('6a', '전자계약', [
        {
          n: '6a1',
          title: '모두싸인으로 보내기',
          who: 'role:sales-rep',
          band: '15m',
          tools: ['modusign'],
        },
      ]),
      kase('6b', '종이에 인감', [
        {
          n: '6b1',
          title: '출력해서 인감 받고 등기로 보내기',
          who: 'role:sales-rep',
          band: '1h',
          tools: ['paper', 'seal'],
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '7',
    kind: 'hold',
    title: '고객 날인본 오기를 기다림',
    tools: ['gmail', 'paper'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 120, timeoutH: 240 },
  },
  {
    n: '8',
    title: '원본 보관하고 스캔본 올리기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['google-drive', 'paper'],
  },
  {
    n: '9',
    title: '계약 조건 사내에 알리기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['slack'],
  },
  {
    n: '10',
    title: '수주 넣고 물류에 납기 알려주기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['douzone-erp', 'slack'],
    pain: true,
  },
  {
    n: '11',
    title: '재무에 세금계산서 끊어달라고 요청',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['slack'],
  },
  {
    n: '12',
    kind: 'hold',
    title: '착수금 들어오기를 기다림',
    tools: ['corp-banking'],
    pain: true,
    attrs: { waitFor: 'time', avgWaitH: 336 },
  },
  {
    n: '13',
    title: '영업대장 닫고 담당 넘기기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['sales-ledger'],
  },
];

export const SAL_02: SeedWorkflow = {
  id: WF,
  title: '계약 따고 나서 하는 일',
  deptId: 'sal',
  summary: '합의된 조건을 계약서로 만들어 날인 받고, 수주·발행·입금까지 넘기기.',
  interviewedRole: 'role:sales-rep',
  items: buildItems(WF, specs),
  edges: [link(WF, '4a1', '3', '조항이 크게 다르면 검토부터 다시')],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '날인본이 안 오는데 일은 이미 시작됨',
      then: '계약서 없이 수주를 먼저 넣어요. 나중에 세금계산서 발행일과 계약일이 안 맞아요',
      atItemId: 'sal-02-s7',
    },
    {
      frequency: '10번 중 2번',
      what: '영업이 약속한 납기를 물류가 못 맞춤',
      then: '고객에게 다시 연락드려 일정을 바꾸는데, 그 사이 착수금이 밀려요',
      atItemId: 'sal-02-s10',
    },
  ],
  observations: [
    '인계 5회',
    '계약서가 매번 지난 파일에서 만들어져요',
    '날인 방식이 종이면 리드타임이 배로 늘어요',
  ],
  claims: { numberedRows: 13, handoffs: '5회', waitRatio: 0.88, toolKinds: 8 },
};

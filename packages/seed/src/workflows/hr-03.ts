/**
 * HR-03 「사람 뽑기 (공고~면접)」
 *
 * SEED-CONTENT.md §A 요약표(14단계 · 인계 3회×라운드 · 대기 95%+ · 도구 11종).
 * 라운드가 돌 때마다 같은 인계가 반복되는 게 이 흐름의 특징이고,
 * 그래서 "인계 3회"가 아니라 "3회 × 라운드"라고 적혀 있다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, kaseEnd, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'HR-03';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '사람이 필요하다는 얘기 받기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['slack', 'oral-request'],
    pain: true,
  },
  {
    n: '2',
    title: '무슨 일을 할 사람인지 같이 적어보기',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['notion', 'hwp'],
  },
  {
    n: '3',
    kind: 'hold',
    title: '채용 품의 결재 기다림',
    who: 'role:hr-lead',
    tools: ['groupware-approval'],
    pain: true,
    attrs: { waitFor: 'approval', avgWaitH: 72, timeoutH: 168 },
  },
  {
    n: '4',
    title: '공고 올리기 — 사이트마다 따로 씀',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['saramin', 'jobkorea', 'wanted'],
    pain: true,
  },
  {
    n: '5',
    kind: 'hold',
    title: '지원자 들어오기를 기다림',
    attrs: { waitFor: 'resource', avgWaitH: 336, timeoutH: 720 },
  },
  {
    n: '6',
    title: '서류 모아서 현업에 돌리기',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['greeting', 'gmail', 'excel'],
    pain: true,
  },
  {
    n: '7',
    kind: 'hold',
    title: '현업 서류 검토 회신 기다림',
    who: 'role:hiring-manager',
    tools: ['gmail'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 96, timeoutH: 168 },
  },
  {
    n: '8',
    kind: 'branch',
    title: '서류를 보고 어떻게 하나',
    who: 'role:hr-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kaseEnd('8a', '이번엔 안 맞음', [
        {
          n: '8a1',
          title: '안 됐다고 안내 보내기',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['gmail'],
        },
      ]),
      kase('8b', '만나보자'),
    ],
  },
  {
    n: '9',
    title: '면접 일정 잡기 — 전화·메일로 여러 번 오감',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['phone', 'gmail'],
    pain: true,
  },
  {
    n: '10',
    title: '면접 보기',
    who: 'role:hiring-manager',
    band: 'halfday',
    tools: ['hwp'],
  },
  {
    n: '11',
    kind: 'branch',
    title: '면접 결과가 어떻게 됐나',
    who: 'role:hr-lead',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('11a', '한 번 더 보자', [
        {
          n: '11a1',
          title: '다음 면접 잡고 일정부터 다시',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['gmail'],
          pain: true,
          attrs: returnsTo(WF, '9', 0.45),
        },
      ]),
      kaseEnd('11b', '이번엔 안 맞음', [
        {
          n: '11b1',
          title: '결과 안내 보내기',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['gmail'],
        },
      ]),
      kase('11c', '이분으로 하자'),
    ],
  },
  {
    n: '12',
    title: '처우 이야기하고 조건 드리기',
    who: 'role:hr-lead',
    band: '1h',
    tools: ['phone', 'gmail'],
    pain: true,
  },
  {
    n: '13',
    kind: 'hold',
    title: '오시겠다는 답 기다림',
    tools: ['phone'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 72, timeoutH: 120 },
  },
  {
    n: '14',
    title: '입사일 정하고 온보딩으로 넘기기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['slack', 'notion'],
  },
];

export const HR_03: SeedWorkflow = {
  id: WF,
  title: '사람 뽑기 (공고~면접)',
  deptId: 'hr',
  summary: '요청 받아서 공고, 서류, 면접, 오퍼까지. 라운드가 돌면 9번부터 다시.',
  interviewedRole: 'role:hr-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '11a1', '9', '다음 라운드는 일정 잡기부터')],
  exceptions: [
    {
      frequency: '10번 중 4번',
      what: '면접 하루 전에 지원자가 안 오겠다고 함',
      then: '현업 일정을 다시 잡거나 그날을 비워요. 대체 후보가 없으면 4번으로 돌아가요',
      atItemId: 'hr-03-s9',
    },
    {
      frequency: '10번 중 3번',
      what: '오퍼를 드렸는데 다른 곳과 저울질하다 안 오심',
      then: '차순위에게 다시 연락하는데, 그 사이 2주가 지나 이미 다른 데를 정하신 경우가 많아요',
      atItemId: 'hr-03-s13',
    },
    {
      frequency: '10번 중 2번',
      what: '뽑기로 한 자리 자체가 없어짐',
      then: '진행 중인 지원자 전원에게 안내를 드려야 하는데 문구가 매번 새로 만들어져요',
      atItemId: 'hr-03-s5',
    },
  ],
  observations: [
    '인계 3회가 라운드마다 반복돼요',
    '공고 사이트마다 같은 내용을 다시 적어요',
    '기다리는 시간이 흐름의 대부분이에요',
  ],
  claims: { numberedRows: 14, handoffs: '3회×라운드', waitRatio: 0.95, toolKinds: 11 },
};

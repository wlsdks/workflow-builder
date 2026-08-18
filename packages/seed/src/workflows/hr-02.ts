/**
 * HR-02 「휴가 신청 처리」
 *
 * SEED-CONTENT.md §A 요약표(11단계 · 인계 2회 · 대기 90% · 도구 6종).
 * 8번의 「업무 인계 메모」가 J-15 — **제품이 직접 해결하는 지점**이다.
 * 대체자 가이드를 자동으로 만들 수 있느냐가 여기서 판가름난다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'HR-02';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '휴가 쓰겠다는 신청 받기',
    who: 'role:hr-staff',
    band: '5m',
    tools: ['groupware-approval'],
    freq: 24,
  },
  {
    n: '2',
    title: '남은 연차가 맞는지 보기',
    who: 'role:hr-staff',
    band: '5m',
    tools: ['excel'],
    freq: 24,
  },
  {
    n: '3',
    kind: 'branch',
    title: '어떤 휴가인가',
    who: 'role:hr-staff',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '연차'),
      kase('3b', '경조·병가', [
        {
          n: '3b1',
          title: '증빙 서류 달라고 하기',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['kakaotalk', 'gmail'],
          pain: true,
        },
      ]),
      kase('3c', '무급·장기', [
        {
          n: '3c1',
          title: '팀장이랑 인사팀장이 따로 이야기',
          who: 'role:hr-lead',
          band: '1h',
          tools: ['phone'],
        },
      ]),
    ],
  },
  {
    n: '4',
    kind: 'hold',
    title: '팀장 결재 기다림',
    who: 'role:hr-lead',
    tools: ['groupware-approval'],
    pain: true,
    attrs: {
      waitFor: 'approval',
      avgWaitH: 48,
      timeoutH: 120,
      ...returnsTo(WF, '1', 0.08),
    },
  },
  {
    n: '5',
    title: '결재 나면 근태에 반영하기',
    who: 'role:hr-staff',
    band: '5m',
    tools: ['flex'],
    freq: 24,
  },
  {
    n: '6',
    title: '팀 캘린더에 넣고 자리 비운다고 알리기',
    who: 'role:hr-staff',
    band: '5m',
    tools: ['slack'],
    freq: 24,
  },
  {
    n: '7',
    kind: 'branch',
    title: '그 기간에 대신할 사람이 필요한가',
    who: 'role:hr-staff',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kase('7a', '필요함', [
        {
          n: '7a1',
          title: '대신할 사람 정하고 인계 메모 받기',
          who: 'role:hr-staff',
          band: '1h',
          tools: ['slack', 'excel'],
          pain: true,
        },
      ]),
      kase('7b', '없어도 됨'),
    ],
  },
  {
    n: '8',
    title: '인계 메모 팀에 돌리기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['slack'],
  },
  {
    n: '9',
    kind: 'hold',
    title: '휴가 다녀오기를 기다림',
    attrs: { waitFor: 'time', avgWaitH: 240 },
  },
  {
    n: '10',
    title: '월 근태 마감해서 급여로 넘기기',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['flex', 'excel'],
  },
  {
    n: '11',
    title: '연차 대장 고쳐놓기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['excel'],
  },
];

export const HR_02: SeedWorkflow = {
  id: WF,
  title: '휴가 신청 처리',
  deptId: 'hr',
  summary: '신청 받아서 결재, 근태 반영, 월 근태 마감까지.',
  interviewedRole: 'role:hr-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '4', '1', '반려되면 신청부터 다시')],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '이미 다녀온 다음에 신청이 올라옴',
      then: '근태를 먼저 손으로 고치고 결재를 뒤에 맞춰요. 마감일에 걸리면 다음 달로 넘어가요',
      atItemId: 'hr-02-s1',
    },
    {
      frequency: '10번 중 2번',
      what: '휴가 중에 급한 일이 생겨서 반차만 취소',
      then: '결재는 취소가 안 돼서 새 신청을 올리고 기존 건을 지워요',
      atItemId: 'hr-02-s5',
    },
  ],
  observations: [
    '인계 2회',
    '손이 가는 시간은 짧은데 결재 기다리는 시간이 대부분이에요',
    '인계 메모가 이 흐름에서 유일하게 남는 문서예요',
  ],
  claims: { numberedRows: 11, handoffs: '2회', waitRatio: 0.9, toolKinds: 6 },
};

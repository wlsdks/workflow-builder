/**
 * GA-02 「사무실에 뭐 고장났을 때」
 *
 * SEED-CONTENT.md §A 요약표(12단계 · 인계 3회 · 대기 85% · 도구 6종).
 * J-03이 여기서 나간다 — 8b·8c에서 구매 요청으로 넘어가는데,
 * **같은 부서 안에서 넘어가는데도 요청서를 처음부터 다시 쓴다.**
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, kaseEnd, type StepSpec } from './_build.ts';

const WF = 'GA-02';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '고장났다는 얘기 듣기 — 지나가면서·슬랙·카톡',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['oral-request', 'slack', 'kakaotalk'],
    freq: 9,
    pain: true,
  },
  {
    n: '2',
    title: '뭐가 어떻게 안 되는지 가서 보기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['phone'],
    freq: 9,
  },
  {
    n: '3',
    kind: 'branch',
    title: '우리가 고칠 수 있나',
    who: 'role:ga-staff',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kaseEnd('3a', '그냥 고쳐짐', [
        {
          n: '3a1',
          title: '바로 고치고 알려주기',
          who: 'role:ga-staff',
          band: '15m',
          tools: ['slack'],
          freq: 4,
        },
      ]),
      kase('3b', '우리 손으로는 안 됨'),
    ],
  },
  {
    n: '4',
    title: '어디에 연락해야 하는지 찾기 — 관리실·A/S·설치업체',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['phone', 'excel'],
    pain: true,
  },
  {
    n: '5',
    title: '수리 요청 넣기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['phone', 'gmail'],
    freq: 5,
  },
  {
    n: '6',
    kind: 'hold',
    title: '업체 방문 일정 잡히기를 기다림',
    tools: ['phone'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 48, timeoutH: 120 },
  },
  {
    n: '7',
    kind: 'hold',
    title: '수리 기사 오기를 기다림',
    pain: true,
    attrs: { waitFor: 'resource', avgWaitH: 72, timeoutH: 168 },
  },
  {
    n: '8',
    kind: 'branch',
    title: '고쳐졌나',
    who: 'role:ga-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('8a', '고쳐짐'),
      kase('8b', '부품을 갈아야 함', [
        {
          n: '8b1',
          title: '수리 견적서 받아서 구매 요청으로 넘기기',
          who: 'role:ga-staff',
          band: '15m',
          tools: ['gmail'],
          pain: true,
        },
      ]),
      kase('8c', '고치느니 새로 사는 게 나음', [
        {
          n: '8c1',
          title: '교체 견적 받아서 구매 요청으로 넘기기',
          who: 'role:ga-staff',
          band: '15m',
          tools: ['gmail'],
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '9',
    title: '수리비 지출결의 올리기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['groupware-approval'],
  },
  {
    n: '10',
    title: '얘기해준 사람한테 됐다고 알리기',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['slack'],
    freq: 9,
  },
  {
    n: '11',
    title: '시설 이력 시트에 적어두기',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['excel'],
    pain: true,
  },
  {
    n: '12',
    title: '같은 게 자꾸 고장나면 교체 검토 올리기',
    who: 'role:ga-staff',
    band: '1h',
    tools: ['excel', 'groupware-approval'],
  },
];

export const GA_02: SeedWorkflow = {
  id: WF,
  title: '사무실에 뭐 고장났을 때',
  deptId: 'ga',
  summary: '고장 얘기를 듣고 업체 불러 고치고 지출결의까지.',
  interviewedRole: 'role:ga-staff',
  items: buildItems(WF, specs),
  edges: [],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '어느 업체에 연락해야 하는지 아무도 모름',
      then: '지난 견적 메일을 뒤지거나 전임자한테 물어봐요. 연락처가 한 곳에 안 모여 있어요',
      atItemId: 'ga-02-s4',
    },
    {
      frequency: '10번 중 2번',
      what: '기사가 왔는데 부품이 없어서 그냥 돌아감',
      then: '일정을 다시 잡아요. 두 번째 방문까지 평균 일주일이 더 걸려요',
      atItemId: 'ga-02-s7',
    },
  ],
  observations: [
    '인계 3회',
    '고치는 시간보다 기다리는 시간이 훨씬 길어요',
    '8b·8c에서 구매 요청으로 넘어갈 때 요청서를 처음부터 다시 써요',
  ],
  claims: { numberedRows: 12, handoffs: '3회', waitRatio: 0.85, toolKinds: 6 },
};

/**
 * HR-01 「신입 들어오면 하는 것들」
 *
 * SEED-CONTENT.md §A 요약표(13단계 · 인계 4회 · 대기 96% · 도구 9종)를 전문으로 편 것.
 * D-2 자동화 후보와 J-12 불일치("인사는 입사 1주 전 요청 / 총무는 조달에 2주")가
 * 여기서 그대로 드러난다 — 입사 첫날 장비가 없는 이유가 8·9번에 있다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'HR-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '입사 확정 소식 받고 입사일 잡기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['gmail', 'phone'],
  },
  {
    n: '2',
    title: '필요한 서류 목록 보내기 — 등본·통장사본·자격증',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['gmail', 'kakaotalk'],
  },
  {
    n: '3',
    kind: 'hold',
    title: '서류 오기를 기다림',
    tools: ['gmail', 'kakaotalk'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 72, timeoutH: 168 },
  },
  {
    n: '4',
    title: '근로계약서 만들어서 날인 받기',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['hwp', 'seal'],
    pain: true,
  },
  {
    n: '5',
    kind: 'branch',
    title: '어떤 형태로 들어오나',
    who: 'role:hr-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('5a', '정규직'),
      kase('5b', '수습·계약직', [
        {
          n: '5b1',
          title: '수습 조건이랑 기간 따로 넣기',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['hwp'],
        },
      ]),
    ],
  },
  {
    n: '6',
    title: '4대보험 취득 신고',
    who: 'role:hr-staff',
    band: '1h',
    tools: ['insurance4', 'cert'],
    pain: true,
  },
  {
    n: '7',
    title: '그룹웨어·메일 계정 만들기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['groupware-approval', 'gmail'],
  },
  {
    n: '8',
    title: '쓸 장비 총무에 요청하기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['slack'],
  },
  {
    n: '9',
    kind: 'hold',
    title: '자리랑 장비 준비되기를 기다림',
    who: 'role:ga-staff',
    tools: ['slack'],
    pain: true,
    attrs: { waitFor: 'resource', avgWaitH: 120, timeoutH: 240 },
  },
  {
    n: '10',
    title: '첫날 안내 — 회사 소개·규정·자리 안내',
    who: 'role:hr-staff',
    band: 'halfday',
    tools: ['hwp'],
  },
  {
    n: '11',
    kind: 'branch',
    title: '첫날에 장비가 와 있나',
    who: 'role:hr-staff',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kase('11a', '아직 안 옴', [
        {
          n: '11a1',
          title: '남는 노트북 빌려주고 총무에 다시 물어보기',
          who: 'role:hr-staff',
          band: '15m',
          tools: ['slack', 'phone'],
          pain: true,
          attrs: returnsTo(WF, '9', 0.35),
        },
      ]),
      kase('11b', '와 있음'),
    ],
  },
  {
    n: '12',
    title: '급여 대장에 새 사람 넣기',
    who: 'role:payroll',
    band: '15m',
    tools: ['newploy'],
  },
  {
    n: '13',
    title: '수습 끝나는 날 정해서 팀장한테 알리기',
    who: 'role:hr-staff',
    band: '15m',
    tools: ['gmail', 'slack'],
  },
];

export const HR_01: SeedWorkflow = {
  id: WF,
  title: '신입 들어오면 하는 것들',
  deptId: 'hr',
  summary: '입사 확정부터 첫날 안내와 급여 대장 반영까지.',
  interviewedRole: 'role:hr-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '11a1', '9', '장비 다시 기다리기')],
  exceptions: [
    {
      frequency: '10번 중 3~4번',
      what: '첫날에 노트북이 아직 안 와 있음',
      then: '남는 장비를 빌려주고 총무에 다시 물어봐요. 인사는 1주 전에 요청하고 총무는 조달에 2주가 걸려요',
      atItemId: 'hr-01-s9',
    },
    {
      frequency: '10번 중 2번',
      what: '입사일이 갑자기 당겨지거나 미뤄짐',
      then: '4대보험 신고일과 급여 일할 계산 기준이 어긋나서 급여담당자와 다시 맞춰야 해요',
      atItemId: 'hr-01-s1',
    },
    {
      frequency: '10번 중 1번',
      what: '확정됐던 사람이 안 옴',
      then: '만든 계정과 신고를 되돌려야 하는데, 되돌리는 순서는 아무 데도 안 적혀 있어요',
      atItemId: 'hr-01-s6',
    },
  ],
  observations: [
    '인계 4회',
    '준비에 걸리는 시간이 손 가는 시간보다 훨씬 길어요 — 대부분이 기다림이에요',
    '8·9번 사이의 리드타임 차이가 첫날 장비가 없는 이유예요',
  ],
  claims: { numberedRows: 13, handoffs: '4회', waitRatio: 0.96, toolKinds: 9 },
};

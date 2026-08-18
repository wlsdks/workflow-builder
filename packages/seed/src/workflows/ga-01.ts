/**
 * GA-01 「비품 사달라고 하면」 — SEED-CONTENT.md §A 전문 수록분.
 *
 * ECRS 제거 후보 X-1이 여기 있다. 3b의 팀장 확인은 지난 6개월 반려율 0%,
 * 평균 대기 3일, 월 26건 — **자동화가 아니라 없앨 대상이다.**
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, drop, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'GA-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '사달라는 얘기 받기 — 슬랙·지나가면서·카톡 섞여서 옴',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['slack', 'kakaotalk', 'oral-request'],
    freq: 18,
    pain: true,
  },
  {
    n: '2',
    title: '뭘 사야 하는지 되묻기 — 모델명·수량·언제까지·어디 쓸지',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['slack'],
    freq: 18,
    pain: true,
  },
  {
    n: '3',
    kind: 'branch',
    title: '얼마짜리인가',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['excel'],
    freq: 18,
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '10만원이 안 됨', [
        {
          n: '3a1',
          title: '그냥 사기',
          who: 'role:ga-staff',
          band: '15m',
          tools: ['coupang-wing'],
          freq: 11,
        },
      ]),
      kase('3b', '10만~300만원', [
        {
          n: '3b1',
          title: '견적 두 곳 받고 팀장 확인 받기',
          who: 'role:ga-staff',
          band: '1h',
          tools: ['gmail', 'phone'],
          freq: 6,
          pain: true,
        },
      ]),
      kase('3c', '300만원이 넘음', [
        {
          n: '3c1',
          title: '견적 세 곳 + 품의서 쓰고 임원 확인 받기',
          who: 'role:ga-staff',
          band: 'halfday',
          tools: ['hwp', 'groupware-approval'],
          freq: 1,
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '4',
    kind: 'hold',
    title: '공급업체 견적 오기를 기다림',
    tools: ['gmail', 'phone'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 48, timeoutH: 120 },
  },
  {
    n: '5',
    title: '견적 비교표 만들고 품의 올리기',
    who: 'role:ga-staff',
    band: '1h',
    tools: ['excel', 'groupware-approval'],
    freq: 7,
    pain: true,
  },
  {
    n: '6',
    kind: 'hold',
    title: '결재 기다림',
    who: 'role:ga-lead',
    tools: ['groupware-approval'],
    pain: true,
    attrs: {
      waitFor: 'approval',
      avgWaitH: 72,
      timeoutH: 168,
      ...returnsTo(WF, '3', 0.14),
    },
  },
  {
    n: '7',
    title: '발주 넣기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['gmail', 'card-web'],
    freq: 18,
  },
  {
    n: '8',
    kind: 'hold',
    title: '물건 오기를 기다림',
    tools: ['phone'],
    attrs: { waitFor: 'resource', avgWaitH: 96, timeoutH: 240 },
  },
  {
    n: '9',
    title: '물건 확인하고 요청한 사람한테 전달',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['paper', 'slack'],
    freq: 18,
  },
  {
    n: '10',
    kind: 'branch',
    title: '물건에 문제 없나',
    who: 'role:ga-staff',
    band: '5m',
    freq: 18,
    attrs: { mode: 'xor' },
    children: [
      kase('10a', '문제 있음', [
        {
          n: '10a1',
          title: '반품·교환 걸고 다시 기다리기',
          who: 'role:ga-staff',
          band: '15m',
          tools: ['phone', 'gmail'],
          freq: 2,
          pain: true,
          attrs: returnsTo(WF, '8', 0.11),
        },
      ]),
      kase('10b', '괜찮음'),
    ],
  },
  {
    n: '11',
    title: '50만원 넘는 건 라벨 붙이고 대장에 적기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['excel', 'label-printer'],
  },
  {
    n: '12',
    title: '세금계산서 왔는지 보고 안 왔으면 달라고 하기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['hometax', 'gmail'],
    freq: 18,
    pain: true,
  },
  {
    n: '13',
    title: '지출결의 올려서 재무로 넘기기',
    who: 'role:ga-staff',
    band: '15m',
    tools: ['groupware-approval', 'excel'],
    freq: 18,
  },
  {
    n: '14',
    title: '요청한 사람한테 됐다고 알리고 재고 시트 고치기',
    who: 'role:ga-staff',
    band: '5m',
    tools: ['slack', 'google-sheets'],
    freq: 18,
  },
];

export const GA_01: SeedWorkflow = {
  id: WF,
  title: '비품 사달라고 하면',
  deptId: 'ga',
  summary: '요청 받아서 사고, 나눠주고, 지출결의까지. 한 건에 7~15일.',
  interviewedRole: 'role:ga-staff',
  items: buildItems(WF, specs),
  edges: [
    // 3a · 10만원 미만은 견적을 기다리지 않고 바로 발주 (조건스킵)
    drop(WF, '3a1', '4'),
    link(WF, '3a1', '7', '10만원 밑이면 바로 발주'),
    // 6a · 반려되면 금액 구간부터 다시
    link(WF, '6', '3', '반려되면 견적부터 다시'),
    // 10a · 반품하면 다시 물건을 기다린다
    link(WF, '10a1', '8', '바꿔서 다시 받기'),
  ],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '급하다고 개인카드로 먼저 사버리고 영수증만 들고 옴',
      then: '1~7번을 통째로 건너뛴 뒤 사후 품의, 규정 소명, 개인 계좌 환급. 지출결의 반려 사유 1위예요',
      atItemId: 'ga-01-s1',
    },
    {
      frequency: '10번 중 2번',
      what: '요청한 사람이 원한 게 아닌 물건이 도착',
      then: '2번에서 덜 물어본 거예요. "의자"라고만 적힌 요청이 실제로 있었어요',
      atItemId: 'ga-01-s2',
    },
  ],
  observations: [
    '인계 4회',
    '한 건에 손이 가는 시간 2.5시간, 달력으로는 7~15일',
    '3b의 팀장 확인은 지난 6개월 반려가 0건이에요 — 손이 덜 가게 만들 대상이 아니라 없앨 대상',
  ],
  claims: { numberedRows: 14, handoffs: '4회', waitRatio: 0.9, toolKinds: 9 },
};

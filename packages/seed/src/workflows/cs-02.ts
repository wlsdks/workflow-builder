/**
 * CS-02 「환불·교환 처리」
 *
 * SEED-CONTENT.md §A 요약표(14단계 · 인계 4회 · 대기 90% · 도구 9종).
 * J-08의 **최다 갈등 지점**이 3a에 있다 —
 * CS는 "요청 즉시 보류"라고 알고 있고 물류는 "송장 붙었으면 못 뺀다"고 알고 있다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'CS-02';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '환불·교환 건 넘겨받기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['channeltalk'],
    freq: 35,
    pain: true,
  },
  {
    n: '2',
    title: '주문이 지금 어디까지 갔나 보기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['ezadmin', 'smartstore'],
    freq: 35,
  },
  {
    n: '3',
    kind: 'branch',
    title: '지금 어디까지 갔나',
    who: 'role:cs-agent',
    band: '5m',
    freq: 35,
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '아직 안 나감', [
        {
          n: '3a1',
          title: '물류에 보류 걸어달라고 하기',
          who: 'role:cs-agent',
          band: '5m',
          tools: ['slack', 'phone'],
          freq: 12,
          pain: true,
        },
        {
          n: '3a2',
          kind: 'hold',
          title: '보류가 됐는지 답 기다림',
          who: 'role:ops-staff',
          tools: ['slack'],
          pain: true,
          attrs: { waitFor: 'reply', avgWaitH: 4, timeoutH: 12 },
        },
      ]),
      kase('3b', '이미 나감', [
        {
          n: '3b1',
          title: '택배사에 반송 걸어보기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['courier', 'phone'],
          freq: 9,
          pain: true,
        },
      ]),
      kase('3c', '고객이 이미 받으심'),
    ],
  },
  {
    n: '4',
    kind: 'branch',
    title: '왜 돌려보내시나',
    who: 'role:cs-agent',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('4a', '마음이 바뀌심', [
        {
          n: '4a1',
          title: '반품비 안내드리고 동의 받기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['channeltalk'],
          pain: true,
        },
      ]),
      kase('4b', '불량이거나 잘못 갔음', [
        {
          n: '4b1',
          title: '사과드리고 회수 예약 잡기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['phone', 'courier'],
        },
      ]),
    ],
  },
  {
    n: '5',
    title: '반품 접수 넣고 회수 예약하기',
    who: 'role:cs-agent',
    band: '15m',
    tools: ['ezadmin', 'courier'],
    freq: 30,
  },
  {
    n: '6',
    kind: 'hold',
    title: '반품 물건 오기를 기다림',
    tools: ['courier'],
    pain: true,
    attrs: { waitFor: 'resource', avgWaitH: 96, timeoutH: 240 },
  },
  {
    n: '7',
    title: '들어온 물건 상태 보기',
    who: 'role:warehouse',
    band: '15m',
    tools: ['barcode', 'paper'],
    freq: 20,
  },
  {
    n: '8',
    kind: 'branch',
    title: '물건 상태가 어떤가',
    who: 'role:warehouse',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('8a', '다시 팔 수 있음'),
      kase('8b', '못 씀', [
        {
          n: '8b1',
          title: '폐기하고 손실 적기',
          who: 'role:warehouse',
          band: '15m',
          tools: ['excel'],
        },
      ]),
      kase('8c', '고객 과실로 보임', [
        {
          n: '8c1',
          title: '사진 찍어서 고객이랑 다시 이야기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['phone', 'channeltalk'],
          pain: true,
          attrs: returnsTo(WF, '4', 0.15),
        },
      ]),
    ],
  },
  {
    n: '9',
    kind: 'branch',
    title: '환불인가 교환인가',
    who: 'role:cs-agent',
    band: '5m',
    attrs: { mode: 'xor' },
    children: [
      kase('9a', '교환', [
        {
          n: '9a1',
          title: '새 상품 출고 걸기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['ezadmin'],
        },
      ]),
      kase('9b', '환불'),
    ],
  },
  {
    n: '10',
    title: '결제 취소하고 환불 넣기',
    who: 'role:cs-agent',
    band: '15m',
    tools: ['pg', 'smartstore'],
    freq: 30,
  },
  {
    n: '11',
    kind: 'hold',
    title: '카드 취소가 반영되기를 기다림',
    attrs: { waitFor: 'time', avgWaitH: 72 },
  },
  {
    n: '12',
    title: '세금계산서 고쳐야 하면 재무에 알리기',
    who: 'role:cs-agent',
    band: '15m',
    tools: ['slack'],
  },
  {
    n: '13',
    title: '고객에게 끝났다고 알려드리기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['channeltalk', 'sms'],
    freq: 30,
  },
  {
    n: '14',
    title: '사유 분류해서 반품 사유 시트에 적기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['google-sheets'],
    freq: 30,
    pain: true,
  },
];

export const CS_02: SeedWorkflow = {
  id: WF,
  title: '환불·교환 처리',
  deptId: 'cs',
  summary: '넘어온 환불·교환 건을 물류·재무와 맞춰가며 끝내기까지.',
  interviewedRole: 'role:cs-agent',
  items: buildItems(WF, specs),
  edges: [link(WF, '8c1', '4', '사유부터 다시 확인')],
  exceptions: [
    {
      frequency: '10번 중 4번',
      what: '보류를 걸어달라고 했는데 이미 송장이 붙어서 못 뺌',
      then: '나간 다음에 반송으로 돌려요. 고객에게는 이미 "막았다"고 말씀드린 뒤라 한 번 더 사과드려요',
      atItemId: 'cs-02-s3a',
    },
    {
      frequency: '10번 중 2번',
      what: '반품 물건이 왔는데 어느 주문 건인지 모름',
      then: '송장번호로 역추적하고 그래도 안 나오면 미확인 반품으로 쌓아둬요',
      atItemId: 'cs-02-s7',
    },
    {
      frequency: '10번 중 2번',
      what: '세금계산서 수정 요청을 잊음',
      then: '월 마감 4번 대조에서 재무가 발견해요. 발행일이 전월이면 부가세 신고에 영향이 가요',
      atItemId: 'cs-02-s12',
    },
  ],
  observations: [
    '인계 4회',
    '물건이 오기를 기다리는 시간이 흐름의 대부분이에요',
    'CS가 아는 "보류"와 물류가 아는 "보류"가 달라요',
  ],
  claims: { numberedRows: 14, handoffs: '4회', waitRatio: 0.9, toolKinds: 9 },
};

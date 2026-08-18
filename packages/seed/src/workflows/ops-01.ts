/**
 * OPS-01 「주문 나가는 것까지 (출고)」
 *
 * SEED-CONTENT.md §A 요약표(14단계 · 인계 4회 · 도구 10종).
 * 3b가 J-19로 나가고(품절 알림), 5~8이 J-08로 들어온다(CS 보류 지시),
 * 14가 J-06으로 나간다(출고 완료 리스트).
 * D-3 1단계 "출고 시 알림톡 선제 발송"이 붙는 자리가 11번이다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'OPS-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '주문 모으기 — 자사몰·스마트스토어·쿠팡·수주 건',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['ezadmin', 'smartstore', 'coupang-wing', 'cafe24'],
    freq: 640,
    pain: true,
  },
  {
    n: '2',
    title: '재고가 있는지 확인',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['wms', 'ezadmin'],
    freq: 640,
  },
  {
    n: '3',
    kind: 'branch',
    title: '재고가 있나',
    who: 'role:ops-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '있음'),
      kase('3b', '품절', [
        {
          n: '3b1',
          title: 'CS랑 영업에 품절이라고 알리기',
          who: 'role:ops-staff',
          band: '15m',
          tools: ['slack', 'kakaotalk'],
          pain: true,
        },
      ]),
      kase('3c', '일부만 있음', [
        {
          n: '3c1',
          title: '나눠서 보낼지 물어보기',
          who: 'role:ops-staff',
          band: '15m',
          tools: ['slack', 'phone'],
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '4',
    title: '피킹 리스트 뽑기',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['wms', 'paper'],
    freq: 5,
  },
  {
    n: '5',
    title: '창고에서 물건 집기',
    who: 'role:warehouse',
    band: 'halfday',
    tools: ['barcode', 'paper'],
    pain: true,
  },
  {
    n: '6',
    title: '확인하고 포장하기',
    who: 'role:warehouse',
    band: '1h',
    tools: ['barcode'],
    pain: true,
  },
  {
    n: '7',
    title: '송장 뽑아서 붙이기',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['courier', 'ezadmin'],
    pain: true,
  },
  {
    n: '8',
    kind: 'branch',
    title: '오늘 안에 나갈 수 있나',
    who: 'role:ops-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('8a', '나감'),
      kase('8b', '오늘은 못 나감', [
        {
          n: '8b1',
          title: '왜 밀렸는지 적고 CS에 알리기',
          who: 'role:ops-staff',
          band: '15m',
          tools: ['slack'],
          pain: true,
          attrs: returnsTo(WF, '4', 0.12),
        },
      ]),
    ],
  },
  {
    n: '9',
    title: '택배 인계하고 인수증 받기',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['courier', 'paper'],
  },
  {
    n: '10',
    title: '송장번호 채널마다 올리기',
    who: 'role:ops-staff',
    band: '15m',
    tools: ['smartstore', 'coupang-wing', 'cafe24', 'ezadmin'],
    pain: true,
  },
  {
    n: '11',
    title: '출고됐다고 알림톡 보내기',
    who: 'role:ops-staff',
    band: '5m',
    tools: ['kakao-alimtalk'],
    freq: 640,
  },
  {
    n: '12',
    kind: 'hold',
    title: '배송 끝나기를 기다림',
    attrs: { waitFor: 'time', avgWaitH: 48 },
  },
  {
    n: '13',
    kind: 'branch',
    title: '배송에 문제가 있나',
    who: 'role:ops-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('13a', '문제 없음'),
      kase('13b', '분실·파손·많이 늦음', [
        {
          n: '13b1',
          title: '택배사에 조회 걸고 CS에 넘기기',
          who: 'role:ops-staff',
          band: '1h',
          tools: ['courier', 'phone'],
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '14',
    title: '출고 내역 마감해서 재고 차감하고 재무로 넘기기',
    who: 'role:ops-staff',
    band: '1h',
    tools: ['wms', 'excel'],
  },
];

export const OPS_01: SeedWorkflow = {
  id: WF,
  title: '주문 나가는 것까지 (출고)',
  deptId: 'ops',
  summary: '주문 모아서 집고 포장하고 송장 붙여 내보내기, 배송 확인까지.',
  interviewedRole: 'role:ops-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '8b1', '4', '다음 날 피킹부터 다시')],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '송장 붙인 뒤에 CS에서 보류해 달라고 함',
      then: '이미 붙었으면 못 빼요. 나간 다음에 반송으로 처리하고 CS에 그렇게 알려요',
      atItemId: 'ops-01-s7',
    },
    {
      frequency: '10번 중 2번',
      what: '재고 숫자는 있는데 실물이 없음',
      then: '창고를 다시 뒤지고 없으면 품절로 돌려요. 재고 실사 때까지 원인을 못 찾는 경우가 많아요',
      atItemId: 'ops-01-s5',
    },
    {
      frequency: '10번 중 2번',
      what: '품절 알림을 보냈는데 CS가 못 받았다고 함',
      then: '슬랙 채널이 서로 달라요. 물류는 보냈다고 하고 CS는 못 봤다고 해요',
      atItemId: 'ops-01-s3b',
    },
  ],
  observations: [
    '인계 4회',
    '주문 모으기와 송장번호 올리기가 채널 수만큼 반복돼요',
    '11번에 알림톡을 먼저 보내면 배송 문의 자체가 줄어요',
  ],
  claims: { numberedRows: 14, handoffs: '4회', waitRatio: null, toolKinds: 10 },
};

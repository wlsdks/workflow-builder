/**
 * CS-01 「문의 받고 답하기」 — SEED-CONTENT.md §A 전문 수록분.
 *
 * 한 건은 8분인데 총량이 주 28시간이다. 3a번 한 단계가 전체 문의의 45%다.
 * 조직 최대의 매번 똑같이 하는 일.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, drop, kase, kaseEnd, link, type StepSpec } from './_build.ts';

const WF = 'CS-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '문의 들어온 거 확인 — 채널톡·전화·스마트스토어·인스타 DM·메일',
    who: 'role:cs-agent',
    band: '1m',
    tools: ['channeltalk', 'phone', 'smartstore', 'instagram-youtube', 'gmail'],
    freq: 210,
    pain: true,
  },
  {
    n: '2',
    title: '누구인지 찾기 — 주문번호나 전화번호로 주문 조회',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['ezadmin', 'smartstore'],
    freq: 210,
    pain: true,
  },
  {
    n: '3',
    kind: 'branch',
    title: '무슨 문의인가',
    who: 'role:cs-agent',
    band: '1m',
    freq: 210,
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '배송 어디쯤 왔냐', [
        {
          n: '3a1',
          title: '송장 확인해서 어디쯤인지 알려주기',
          who: 'role:cs-agent',
          band: '5m',
          tools: ['courier', 'ezadmin'],
          freq: 95,
          pain: true,
        },
      ]),
      kase('3b', '그냥 상품이 궁금', [
        {
          n: '3b1',
          title: '자주 묻는 질문에서 찾아 답하기',
          who: 'role:cs-agent',
          band: '5m',
          tools: ['channeltalk'],
          freq: 55,
        },
      ]),
      kaseEnd('3c', '취소·환불·교환', [
        {
          n: '3c1',
          title: '환불·교환 처리로 넘기기',
          who: 'role:cs-agent',
          band: '5m',
          tools: ['channeltalk'],
          freq: 35,
        },
      ]),
      kase('3d', '불량·하자·기술 문의'),
      kase('3e', '화가 많이 난 건', [
        {
          n: '3e1',
          title: '무슨 일이 있었는지 정리해서 팀장한테 올리기',
          who: 'role:cs-agent',
          band: '5m',
          tools: ['slack'],
          freq: 5,
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '4',
    title: '사진이랑 증상 받아서 유관부서에 넘기기',
    who: 'role:cs-agent',
    band: '15m',
    tools: ['slack', 'jira'],
    freq: 20,
  },
  {
    n: '5',
    kind: 'hold',
    title: '유관부서 회신 기다림',
    who: 'role:qa',
    tools: ['slack'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 48, timeoutH: 72 },
  },
  {
    n: '6',
    kind: 'branch',
    title: '얼마나 센 건인가',
    who: 'role:cs-lead',
    band: '15m',
    freq: 5,
    attrs: { mode: 'xor' },
    children: [
      kase('6a', '보통', [
        {
          n: '6a1',
          title: '사과드리고 보상안 말씀드리기',
          who: 'role:cs-agent',
          band: '15m',
          tools: ['phone', 'channeltalk'],
          freq: 4,
        },
      ]),
      kase('6b', '악성·법적 위협·공개 게시', [
        {
          n: '6b1',
          title: '팀장이 받아서 경영진에 알리기',
          who: 'role:cs-lead',
          band: '1h',
          tools: ['phone', 'slack'],
          freq: 1,
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '7',
    title: '어떻게 대응할지 정하고 공식 회신 보내기',
    who: 'role:cs-lead',
    band: 'halfday',
    tools: ['gmail', 'hwp'],
  },
  {
    n: '8',
    title: '고객에게 답 보내기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['channeltalk', 'phone', 'sms'],
    freq: 205,
  },
  {
    n: '9',
    kind: 'hold',
    title: '고객이 또 물어볼지 기다림',
    tools: ['channeltalk'],
    attrs: { waitFor: 'reply', avgWaitH: 4, timeoutH: 72 },
  },
  {
    n: '10',
    title: '상담 이력 적어두기',
    who: 'role:cs-agent',
    band: '5m',
    tools: ['channeltalk', 'google-sheets'],
    freq: 210,
    pain: true,
  },
  {
    n: '11',
    title: '반복되는 문의 모아서 자주 묻는 질문 고쳐달라고 하기',
    who: 'role:cs-lead',
    band: '1h',
    tools: ['notion', 'slack'],
  },
  {
    n: '12',
    title: '주간 문의 숫자 세기',
    who: 'role:cs-lead',
    band: '1h',
    tools: ['excel'],
    pain: true,
  },
];

export const CS_01: SeedWorkflow = {
  id: WF,
  title: '문의 받고 답하기',
  deptId: 'cs',
  summary: '다섯 개 창구로 들어온 문의를 받아서 답하고 기록하기까지.',
  interviewedRole: 'role:cs-agent',
  items: buildItems(WF, specs),
  edges: [
    // 3a·3b는 유관부서를 거치지 않고 바로 답변으로 간다
    drop(WF, '3a1', '4'),
    link(WF, '3a1', '8', '확인되면 바로 답변'),
    drop(WF, '3b1', '4'),
    link(WF, '3b1', '8', '답이 있으면 바로 답변'),
    // 3e는 팀장 판단으로 바로 간다
    drop(WF, '3e1', '4'),
    link(WF, '3e1', '6', '팀장 판단으로'),
    // 6a는 공식 회신 없이 바로 답변으로
    drop(WF, '6a1', '7'),
    link(WF, '6a1', '8', '보통 건은 바로 답변'),
  ],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '같은 고객이 여러 창구로 동시에 물어봄',
      then: '담당자 두 명이 서로 다르게 답해요. "아까는 된다면서요"로 번지는 게 여기서 시작돼요',
      atItemId: 'cs-01-s1',
    },
    {
      frequency: '10번 중 2번',
      what: '주문번호를 모르는 고객 — 비회원이거나 가족이 대신 주문',
      then: '이름·전화로 역검색하다 실패하면 카드 승인번호까지 여쭤보게 돼요',
      atItemId: 'cs-01-s2',
    },
  ],
  observations: [
    '한 건에 손이 가는 시간은 8분인데 총량이 주 28시간이에요',
    '한 건 처리에 도구를 평균 3.2번 옮겨 다녀요',
    '3a번 한 단계가 전체 문의의 45%예요',
  ],
  claims: { numberedRows: 12, handoffs: '3회', waitRatio: null, toolKinds: 9 },
};

/**
 * FIN-03 「법인카드 정산」
 *
 * SEED-CONTENT.md §A 요약표(12단계 · 인계 전 부서 · 대기 70% · 도구 9종).
 * ECRS 제거 후보 X-2가 3~5a에 있다 — 매월 같은 다섯 명이 안 내고,
 * 회수에 월 4시간이 든다. 카드 승인 즉시 알림톡으로 사용목적을 받으면
 * **월말 취합·독촉 단계 자체가 사라진다.** 자동화가 아니라 작업 이동이다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'FIN-03';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '카드사 웹에서 지난달 명세 내려받기 — 카드사마다 따로',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['card-web'],
    pain: true,
  },
  {
    n: '2',
    title: '명세를 정산 시트로 옮기기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['excel'],
    pain: true,
  },
  {
    n: '3',
    title: '쓴 사람들한테 사용목적이랑 영수증 올려달라고 공지',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['slack', 'gmail'],
    pain: true,
  },
  {
    n: '4',
    kind: 'hold',
    title: '증빙 올라오기를 기다림',
    tools: ['groupware-approval', 'kakaotalk'],
    pain: true,
    attrs: { waitFor: 'approval', avgWaitH: 120, timeoutH: 168 },
  },
  {
    n: '5',
    kind: 'branch',
    title: '다 냈나',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['excel'],
    attrs: { mode: 'xor' },
    children: [
      kase('5a', '안 낸 사람이 있음', [
        {
          n: '5a1',
          title: '매달 그 다섯 명한테 또 말하기',
          who: 'role:acct-staff',
          band: '1h',
          tools: ['slack', 'phone'],
          pain: true,
          attrs: returnsTo(WF, '4', 0.6),
        },
      ]),
      kase('5b', '다 냄'),
    ],
  },
  {
    n: '6',
    title: '영수증이랑 카드 내역 건건이 맞춰보기',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['excel', 'paper'],
    pain: true,
  },
  {
    n: '7',
    kind: 'branch',
    title: '개인이 쓴 게 섞였나',
    who: 'role:acct-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('7a', '섞임', [
        {
          n: '7a1',
          title: '본인한테 확인하고 돌려달라고 하기',
          who: 'role:acct-staff',
          band: '15m',
          tools: ['slack'],
          pain: true,
        },
      ]),
      kase('7b', '없음'),
    ],
  },
  {
    n: '8',
    title: '계정과목 붙이고 ERP 전표 넣기',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['douzone-erp'],
    pain: true,
  },
  {
    n: '9',
    title: '부가세 공제 되는 건 따로 빼놓기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['hometax', 'excel'],
  },
  {
    n: '10',
    kind: 'hold',
    title: '회계팀장 확인 기다림',
    who: 'role:acct-lead',
    tools: ['groupware-approval'],
    attrs: { waitFor: 'approval', avgWaitH: 24, timeoutH: 48 },
  },
  {
    n: '11',
    title: '끝까지 증빙이 없는 건 목록 만들어 인사로 넘기기',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['excel', 'gmail'],
  },
  {
    n: '12',
    title: '한도나 규정에 어긋난 건 정리해서 공지',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['slack'],
  },
];

export const FIN_03: SeedWorkflow = {
  id: WF,
  title: '법인카드 정산',
  deptId: 'fin',
  summary: '카드 명세 받아서 증빙 모으고 전표까지. 매달 같은 사람들을 기다려요.',
  interviewedRole: 'role:acct-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '5a1', '4', '다시 기다리기')],
  exceptions: [
    {
      frequency: '10번 중 4번',
      what: '영수증을 잃어버렸다고 함',
      then: '카드 매출전표를 다시 뽑거나 사유서를 받아요. 금액이 크면 회계팀장 확인이 한 번 더 붙어요',
      atItemId: 'fin-03-s6',
    },
    {
      frequency: '10번 중 2번',
      what: '퇴사자가 쓴 카드 건이 남아 있음',
      then: '인사도 재무도 자기 일이라고 보지 않아서 아무도 안 가져가요',
      atItemId: 'fin-03-s11',
    },
  ],
  observations: [
    '인계가 전 부서로 퍼져요 — 카드를 쓴 사람 전부가 상대예요',
    '매달 같은 다섯 명을 기다리는 데 월 4시간이 들어가요',
    '3~5a는 없앨 수 있는 단계예요 — 카드 승인 순간에 물어보면 됩니다',
  ],
  claims: { numberedRows: 12, handoffs: '전 부서', waitRatio: 0.7, toolKinds: 9 },
};

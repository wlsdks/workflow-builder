/**
 * FIN-01 「월 마감」 — SEED-CONTENT.md §A 전문 수록분.
 *
 * 전월 실적을 확정해 경영진 보고까지 가는, 매달 반복되는 5~8일짜리 전투.
 * 이 문서 하나가 "휴가 대체자 가이드"로 가장 많이 요청된다.
 * 재무 담당자가 마감 주간에 휴가를 못 가는 이유가 이 표에 다 있다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'FIN-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '마감 사흘 전 전사 공지 — 지출결의·경비 언제까지',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['slack', 'gmail'],
  },
  {
    n: '2',
    kind: 'hold',
    title: '각 부서 증빙 들어오기를 기다림',
    tools: ['groupware-approval', 'kakaotalk'],
    pain: true,
    attrs: { waitFor: 'approval', avgWaitH: 96, timeoutH: 120 },
  },
  {
    n: '3',
    title: '안 낸 사람한테 따로 말하기 (팀장 참조)',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['slack', 'phone'],
    pain: true,
  },
  {
    n: '4',
    title: '매출 맞춰보기 — 세금계산서·ERP 매출·입금 세 개 대조',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['hometax', 'douzone-erp', 'excel'],
    pain: true,
  },
  {
    n: '5',
    title: '매입 맞춰보기 — 받은 계산서·지출결의·카드 명세 대조',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['hometax', 'card-web', 'excel'],
    pain: true,
  },
  {
    n: '6',
    title: '은행 거래내역 받아서 모르는 입출금 찾기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['corp-banking', 'excel'],
  },
  {
    n: '7',
    kind: 'branch',
    title: '숫자가 안 맞는 게 있나',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['excel'],
    attrs: { mode: 'xor' },
    children: [
      kase('7a', '안 맞는 게 있음', [
        {
          n: '7a1',
          title: '어느 부서 건인지 물어보고 4번부터 다시',
          who: 'role:acct-staff',
          band: '1h',
          tools: ['slack', 'phone'],
          pain: true,
          attrs: returnsTo(WF, '4', 0.35),
        },
      ]),
      kase('7b', '다 맞음'),
    ],
  },
  {
    n: '8',
    title: '결산 전표 넣기 — 감가상각·미지급·선급·충당금',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['douzone-erp'],
  },
  {
    n: '9',
    title: '재고 수불 확정하고 물류 실사와 맞춰보기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['excel', 'douzone-erp'],
  },
  {
    n: '10',
    kind: 'hold',
    title: '세무대리인 회신 기다림',
    tools: ['gmail'],
    attrs: { waitFor: 'reply', avgWaitH: 48, timeoutH: 96 },
  },
  {
    n: '11',
    title: '재무제표 확정하고 기간 잠그기',
    who: 'role:acct-lead',
    band: '1h',
    tools: ['douzone-erp'],
  },
  {
    n: '12',
    title: '경영진 보고자료 만들기 — 전월·예산 대비 그래프',
    who: 'role:acct-staff',
    band: 'halfday',
    tools: ['excel', 'powerpoint'],
    pain: true,
  },
  {
    n: '13',
    kind: 'hold',
    title: 'CFO 검토 기다림',
    who: 'role:cfo',
    tools: ['gmail'],
    attrs: { waitFor: 'approval', avgWaitH: 24, timeoutH: 48 },
  },
  {
    n: '14',
    title: '임원회의에 돌리고 부서별 예산 실적 회신 받기',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['gmail', 'slack'],
  },
];

export const FIN_01: SeedWorkflow = {
  id: WF,
  title: '월 마감',
  deptId: 'fin',
  summary: '전월 숫자를 확정해서 경영진 보고까지. 매달 5~8일 걸려요.',
  interviewedRole: 'role:acct-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '7a1', '4', '원인 찾으면 매출 대사부터 다시')],
  exceptions: [
    {
      frequency: '10번 중 4번',
      what: '마감 잠근 뒤에 "이거 지난달 건인데요" 하고 증빙이 옴',
      then: '당월로 처리하거나 마감을 풀고 다시. 금액이 크면 11번을 되돌려야 해요',
      atItemId: 'fin-01-s11',
    },
    {
      frequency: '10번 중 2번',
      what: '4번 대조에서 공급가액 오타나 사업자번호가 틀린 걸 발견',
      then: '수정세금계산서를 끊고(FIN-02 재진입), 부가세 신고분에도 영향이 가요',
      atItemId: 'fin-01-s4',
    },
  ],
  observations: [
    '부서 간 인계 7회 이상',
    '실제로 손이 가는 시간 약 28시간, 달력으로는 8~10 영업일',
    '엑셀이 6개 단계에서 접착제 역할을 해요 — 시스템 로그로는 절대 안 보이는 구간',
  ],
  claims: { numberedRows: 14, handoffs: '7회 이상', waitRatio: 0.6, toolKinds: 8 },
};

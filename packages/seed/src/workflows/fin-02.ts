/**
 * FIN-02 「세금계산서 끊기」 — SEED-CONTENT.md §A 전문 수록분.
 *
 * 조직 자동화 1순위 후보(D-1)가 걸려 있는 흐름.
 * 홈택스↔ERP↔엑셀 3중 입력이 같은 데이터를 세 번 타이핑하게 만든다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, drop, kase, kaseEnd, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'FIN-02';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '영업·운영에서 발행해 달라는 요청 받기',
    who: 'role:acct-staff',
    band: '5m',
    tools: ['slack', 'gmail', 'kakaotalk'],
    freq: 22,
    pain: true,
  },
  {
    n: '2',
    title: '요청 내용 확인 — 계약서·발주서 금액이랑 맞나',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['google-drive', 'douzone-erp'],
    freq: 22,
  },
  {
    n: '3',
    kind: 'branch',
    title: '이미 등록된 거래처인가',
    who: 'role:acct-staff',
    band: '5m',
    tools: ['douzone-erp'],
    freq: 22,
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '처음 보는 곳', [
        {
          n: '3a1',
          title: '사업자등록증이랑 담당자 메일 달라고 하기',
          who: 'role:acct-staff',
          band: '15m',
          tools: ['gmail', 'kakaotalk'],
          freq: 3,
          pain: true,
        },
      ]),
      kase('3b', '이미 있는 곳'),
    ],
  },
  {
    n: '4',
    kind: 'hold',
    title: '사업자등록증 오기를 기다림',
    tools: ['gmail'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 24, timeoutH: 72 },
  },
  {
    n: '5',
    title: '전자세금계산서 발행',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['hometax', 'cert'],
    freq: 22,
    pain: true,
  },
  {
    n: '6',
    title: '발행한 거 ERP 매출 전표에 넣기',
    who: 'role:acct-staff',
    band: '5m',
    tools: ['douzone-erp'],
    freq: 22,
  },
  {
    n: '7',
    title: '거래처 담당자한테 발행했다고 알리기',
    who: 'role:acct-staff',
    band: '5m',
    tools: ['gmail'],
    freq: 22,
  },
  {
    n: '8',
    kind: 'hold',
    title: '결제 조건대로 입금 들어오기를 기다림',
    attrs: { waitFor: 'time', avgWaitH: 720 },
  },
  {
    n: '9',
    title: '입금 확인 — 통장 내역이랑 미수금 맞춰보기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['corp-banking', 'excel'],
  },
  {
    n: '10',
    kind: 'branch',
    title: '입금이 어떻게 들어왔나',
    who: 'role:acct-staff',
    band: '15m',
    tools: ['excel'],
    attrs: { mode: 'xor' },
    children: [
      kaseEnd('10a', '제대로 들어옴', [
        {
          n: '10a1',
          title: '미수금 지우기',
          who: 'role:acct-staff',
          band: '5m',
          tools: ['douzone-erp'],
        },
      ]),
      kase('10b', '일부만 들어옴', [
        {
          n: '10b1',
          title: '차액이 왜 생겼는지 알아보고 입금 확인부터 다시',
          who: 'role:acct-staff',
          band: '15m',
          tools: ['phone', 'gmail'],
          pain: true,
          attrs: returnsTo(WF, '9', 0.2),
        },
      ]),
      kase('10c', '아예 안 들어옴', [
        {
          n: '10c1',
          title: '영업한테 받아달라고 넘기기',
          who: 'role:acct-staff',
          band: '15m',
          tools: ['slack'],
          pain: true,
        },
      ]),
    ],
  },
  {
    n: '11',
    title: '30일 넘은 미수 뽑아서 주간 회의에 올리기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['excel'],
  },
  {
    n: '12',
    title: '월말 발행분 모아서 월 마감 매출 대조로 넘기기',
    who: 'role:acct-staff',
    band: '1h',
    tools: ['hometax', 'excel'],
  },
];

export const FIN_02: SeedWorkflow = {
  id: WF,
  title: '세금계산서 끊기',
  deptId: 'fin',
  summary: '발행 요청 받아서 입금 확인까지. 한 건에 손은 45분, 달력은 30~45일.',
  interviewedRole: 'role:acct-staff',
  items: buildItems(WF, specs),
  edges: [
    // 3b · 이미 등록된 거래처는 등록증을 기다릴 이유가 없다 (조건스킵)
    drop(WF, '3', '4'),
    link(WF, '3', '5', '이미 있는 곳이면 바로 발행'),
    // 10b · 차액 원인을 찾으면 입금 확인부터 다시
    link(WF, '10b1', '9', '차액 확인하고 다시'),
  ],
  exceptions: [
    {
      frequency: '10번 중 2번',
      what: '발행하고 나서 취소하거나 고쳐야 하는 일이 생김',
      then: '수정세금계산서를 사유코드 골라 다시 끊어요. 발행일이 전월이면 부가세 신고에 영향이 가요',
      atItemId: 'fin-02-s5',
    },
    {
      frequency: '10번 중 1번',
      what: '대기업 거래처가 자기 시스템에서 역발행하겠다고 함',
      then: '우리 순서를 통째로 건너뛰어요. 홈택스에서 조회로만 확인돼서 월 마감 4번 대조에서 늘 튑니다',
      atItemId: 'fin-02-s1',
    },
  ],
  observations: [
    '인계 3회',
    '한 건에 손이 가는 시간 45분, 달력으로는 30~45일',
    '홈택스·ERP·엑셀 세 곳에 같은 데이터를 세 번 타이핑해요',
  ],
  claims: { numberedRows: 12, handoffs: '3회', waitRatio: null, toolKinds: 7 },
};

/**
 * SAL-01 「문의 들어오면 견적까지」
 *
 * SEED-CONTENT.md §A 요약표(14단계 · 인계 2~3회 · 대기 85% · 도구 9종).
 * J-17의 "마케팅 리드 45건 vs 영업 유효 리드 12건" 불일치가 1번에서 시작된다.
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, drop, kase, kaseEnd, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'SAL-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '문의 들어온 거 확인 — 홈페이지·전화·메일·전시회 명함',
    who: 'role:sales-rep',
    band: '5m',
    tools: ['gmail', 'phone', 'remember'],
    freq: 31,
    pain: true,
  },
  {
    n: '2',
    title: '영업대장에 새 건으로 적기',
    who: 'role:sales-rep',
    band: '5m',
    tools: ['sales-ledger'],
    freq: 31,
    pain: true,
  },
  {
    n: '3',
    kind: 'branch',
    title: '지금 살 분인가',
    who: 'role:sales-rep',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kaseEnd('3a', '아직 구경만', [
        {
          n: '3a1',
          title: '자료만 보내고 나중에 다시 연락하기로',
          who: 'role:sales-rep',
          band: '15m',
          tools: ['gmail'],
        },
      ]),
      kase('3b', '진짜 사실 것 같음'),
    ],
  },
  {
    n: '4',
    title: '뭘 원하시는지 통화로 캐묻기',
    who: 'role:sales-rep',
    band: '1h',
    tools: ['phone'],
    pain: true,
  },
  {
    n: '5',
    title: '필요하면 찾아뵙거나 화상으로 만나기',
    who: 'role:sales-rep',
    band: 'halfday',
    tools: ['phone'],
  },
  {
    n: '6',
    title: '견적 만들기 — 지난 견적 파일 복사해서 고치기',
    who: 'role:sales-rep',
    band: '1h',
    tools: ['excel', 'sales-ledger'],
    pain: true,
  },
  {
    n: '7',
    kind: 'branch',
    title: '내가 정할 수 있는 금액인가',
    who: 'role:sales-rep',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('7a', '깎아드릴 폭이 큼', [
        {
          n: '7a1',
          title: '팀장한테 물어보기',
          who: 'role:sales-rep',
          band: '15m',
          tools: ['slack'],
        },
      ]),
      kase('7b', '기준 안에 있음'),
    ],
  },
  {
    n: '8',
    kind: 'hold',
    title: '팀장 확인 기다림',
    who: 'role:sales-lead',
    tools: ['slack'],
    pain: true,
    attrs: { waitFor: 'approval', avgWaitH: 24, timeoutH: 48 },
  },
  {
    n: '9',
    title: '견적서 보내기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['gmail', 'hwp'],
    freq: 12,
  },
  {
    n: '10',
    kind: 'hold',
    title: '고객 답 기다림',
    tools: ['gmail', 'phone'],
    pain: true,
    attrs: { waitFor: 'reply', avgWaitH: 168, timeoutH: 336 },
  },
  {
    n: '11',
    kind: 'branch',
    title: '고객이 뭐라고 하셨나',
    who: 'role:sales-rep',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('11a', '조건을 바꿔달라', [
        {
          n: '11a1',
          title: '조건 고쳐서 견적부터 다시',
          who: 'role:sales-rep',
          band: '1h',
          tools: ['excel'],
          pain: true,
          attrs: returnsTo(WF, '6', 0.4),
        },
      ]),
      kase('11b', '진행하겠다'),
      kaseEnd('11c', '없던 일로', [
        {
          n: '11c1',
          title: '사유 적고 대장 닫기',
          who: 'role:sales-rep',
          band: '5m',
          tools: ['sales-ledger'],
        },
      ]),
    ],
  },
  {
    n: '12',
    title: '계약 조건 문서로 정리하기',
    who: 'role:sales-rep',
    band: '1h',
    tools: ['hwp'],
  },
  {
    n: '13',
    title: '영업대장 단계 옮기고 주간 보고에 넣기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['sales-ledger', 'excel'],
  },
  {
    n: '14',
    title: '계약 준비로 넘기기',
    who: 'role:sales-rep',
    band: '15m',
    tools: ['slack'],
  },
];

export const SAL_01: SeedWorkflow = {
  id: WF,
  title: '문의 들어오면 견적까지',
  deptId: 'sal',
  summary: '문의 받아서 견적 드리고 계약 준비로 넘기기까지.',
  interviewedRole: 'role:sales-rep',
  items: buildItems(WF, specs),
  edges: [
    // 7b · 기준 안에 있으면 팀장을 기다릴 이유가 없다 (조건스킵)
    drop(WF, '7', '8'),
    link(WF, '7', '9', '기준 안이면 바로 보내기'),
    link(WF, '11a1', '6', '조건 바뀌면 견적부터 다시'),
  ],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '견적을 보내고 나서 답이 아예 없음',
      then: '2주쯤 뒤에 한 번 더 연락드리고, 그래도 없으면 대장에 그냥 열린 채로 남아요',
      atItemId: 'sal-01-s10',
    },
    {
      frequency: '10번 중 2번',
      what: '마케팅에서 넘어온 리드인데 연락처가 안 맞음',
      then: '유효한 리드가 아니라고 표시하는데, 마케팅 쪽 숫자에는 그대로 남아 있어요',
      atItemId: 'sal-01-s1',
    },
  ],
  observations: [
    '인계 2~3회',
    '견적서가 매번 지난 파일을 복사해서 만들어져요',
    '고객 답을 기다리는 시간이 흐름의 대부분이에요',
  ],
  claims: { numberedRows: 14, handoffs: '2~3회', waitRatio: 0.85, toolKinds: 9 },
};

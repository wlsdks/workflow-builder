/**
 * MKT-01 「콘텐츠 하나 내보내기」
 *
 * SEED-CONTENT.md §A 요약표(13단계 · 인계 4회 · 대기 80% · 도구 11종).
 * J-17이 10번에서 나가고 J-18이 3b로 들어온다 —
 * **CS가 올린 자주 묻는 질문 수정 요청이 여기 백로그에서 평균 3주를 기다린다.**
 */

import type { SeedWorkflow } from '../types.ts';
import { buildItems, kase, link, returnsTo, type StepSpec } from './_build.ts';

const WF = 'MKT-01';

const specs: readonly StepSpec[] = [
  {
    n: '1',
    title: '이번 달에 뭘 낼지 정하기',
    who: 'role:mkt-staff',
    band: '1h',
    tools: ['notion', 'slack'],
  },
  {
    n: '2',
    title: '소재 모으기 — 제품팀·CS 문의·경쟁사',
    who: 'role:mkt-staff',
    band: '1h',
    tools: ['notion', 'slack', 'channeltalk'],
  },
  {
    n: '3',
    kind: 'branch',
    title: '어디서 온 소재인가',
    who: 'role:mkt-staff',
    band: '15m',
    attrs: { mode: 'xor' },
    children: [
      kase('3a', '우리가 기획한 것'),
      kase('3b', 'CS에서 넘어온 자주 묻는 질문', [
        {
          n: '3b1',
          title: 'CS가 올린 목록에서 골라 정리하기',
          who: 'role:mkt-staff',
          band: '15m',
          tools: ['notion', 'slack'],
          pain: true,
        },
      ]),
      kase('3c', '영업이 요청한 것', [
        {
          n: '3c1',
          title: '영업이 뭘 원했는지 확인하기',
          who: 'role:mkt-staff',
          band: '15m',
          tools: ['slack'],
        },
      ]),
    ],
  },
  {
    n: '4',
    title: '초안 쓰기',
    who: 'role:mkt-staff',
    band: 'halfday',
    tools: ['google-drive'],
    pain: true,
  },
  {
    n: '5',
    title: '디자인 요청 넣기',
    who: 'role:mkt-staff',
    band: '15m',
    tools: ['slack', 'figma'],
  },
  {
    n: '6',
    kind: 'hold',
    title: '디자인 나오기를 기다림',
    who: 'role:designer',
    tools: ['figma'],
    pain: true,
    attrs: { waitFor: 'resource', avgWaitH: 72, timeoutH: 168 },
  },
  {
    n: '7',
    kind: 'hold',
    title: '내부 확인 기다림',
    who: 'role:mkt-lead',
    tools: ['slack'],
    pain: true,
    attrs: {
      waitFor: 'approval',
      avgWaitH: 48,
      timeoutH: 96,
      ...returnsTo(WF, '4', 0.3),
    },
  },
  {
    n: '8',
    title: '채널마다 형태 고치기 — 블로그·인스타·뉴스레터',
    who: 'role:mkt-staff',
    band: '1h',
    tools: ['wordpress-naverblog', 'instagram-youtube', 'stibee'],
    pain: true,
  },
  {
    n: '9',
    title: 'UTM 붙여서 링크 만들기',
    who: 'role:mkt-staff',
    band: '15m',
    tools: ['ga4', 'excel'],
  },
  {
    n: '10',
    title: '올리고 발송하기',
    who: 'role:mkt-staff',
    band: '15m',
    tools: ['wordpress-naverblog', 'instagram-youtube', 'stibee'],
    freq: 3,
  },
  {
    n: '11',
    kind: 'hold',
    title: '반응 쌓이기를 기다림',
    attrs: { waitFor: 'time', avgWaitH: 168 },
  },
  {
    n: '12',
    title: '유입이랑 문의 수치 모으기',
    who: 'role:mkt-staff',
    band: '1h',
    tools: ['ga4', 'meta-business', 'excel'],
    pain: true,
  },
  {
    n: '13',
    title: '결과 정리해서 돌리고 다음 소재 후보 적기',
    who: 'role:mkt-staff',
    band: '1h',
    tools: ['notion', 'slack'],
  },
];

export const MKT_01: SeedWorkflow = {
  id: WF,
  title: '콘텐츠 하나 내보내기',
  deptId: 'mkt',
  summary: '소재 정하고 쓰고 디자인 받아서 채널마다 내보내고 수치 보기까지.',
  interviewedRole: 'role:mkt-staff',
  items: buildItems(WF, specs),
  edges: [link(WF, '7', '4', '고쳐야 하면 초안부터 다시')],
  exceptions: [
    {
      frequency: '10번 중 3번',
      what: '확인 단계에서 방향이 통째로 바뀜',
      then: '초안부터 다시 써요. 디자인도 같이 다시 요청해야 해요',
      atItemId: 'mkt-01-s7',
    },
    {
      frequency: '10번 중 2번',
      what: 'CS가 올린 자주 묻는 질문 수정 요청이 순서에서 계속 밀림',
      then: '평균 3주를 기다려요. 그동안 CS는 같은 문의를 계속 손으로 답해요',
      atItemId: 'mkt-01-s3b',
    },
  ],
  observations: [
    '인계 4회',
    '디자인이 나오기를 기다리는 시간이 제일 길어요',
    '마케팅이 세는 리드와 영업이 세는 리드의 기준이 달라요',
  ],
  claims: { numberedRows: 13, handoffs: '4회', waitRatio: 0.8, toolKinds: 11 },
};

/**
 * packages/doc-gen/src/__fixtures__/fin01.ts
 *
 * §2.0의 입력 픽스처 — 「월 마감 정산」.
 * SEED-CONTENT의 FIN-01을 갈래 2개 구성으로 재구성한 것.
 *
 * ★ 비공개 노트 3개는 **이 객체 안에 없다.** 있을 자리가 타입에 없다 (D-062).
 *   테스트가 쓰는 원문은 아래 `FIN01_NOTES`에 따로 두고, 그 텍스트가 출력에
 *   0회 등장한다는 것을 하드 어서션으로 고정한다.
 */

import type { FlowInput } from '../types.ts';

export const FIN01: FlowInput = {
  id: 'fin-01',
  title: '월 마감 정산',
  deptLabel: '재무팀',
  cadence: { label: '매달 하는 일', tableLabel: '매달 1회' },
  ownerId: 'sujin',
  asOf: { year: 2026, month: 8, day: 17 },

  hardestPart:
    '4번 매출 대사에서 홈택스 자료랑 ERP 금액이 안 맞을 때가 제일 헤매실 거예요. ' +
    '안 맞는 건 대부분 거래처가 자기 시스템에서 발행한 건이에요. 세 곳 있어요.',

  startNote: '매달 1일쯤 시작해요. 마감일 3일 전에 전사 공지를 내는 게 첫 단계예요.',
  endNote: '임원회의에 보고자료가 나가면 끝이에요.',
  spanNote: '처음부터 끝까지 보통 8~10 영업일 걸려요.',

  connections: {
    before: '각 부서의 지출결의와 경비 증빙이 그룹웨어로 들어와요.',
    after: '임원회의에 보내고 나면 부서별 예산 실적 회신이 와요.',
    middle: '4번과 12번 뒤는 「세금계산서 끊기」와 이어져 있어요.',
  },

  people: [
    {
      id: 'sujin',
      name: '이수진',
      team: '재무팀',
      deptId: 'fin',
      channel: '슬랙 @sujin',
      lastDayLabel: '9월 12일',
    },
    {
      id: 'minah',
      name: '정민아',
      team: '물류팀',
      deptId: 'logi',
      channel: '슬랙 @minah',
      contactFor: '9번 재고 수불',
    },
    {
      id: 'hyunwoo',
      name: '박현우',
      team: '재무팀장',
      deptId: 'fin',
      channel: '슬랙 @hyunwoo',
      decides: true,
      contactFor: '12번 마감 잠그기',
    },
    {
      id: 'taxagent',
      name: '세무대리인',
      external: true,
      contactFor: '11번 세무대리인 회신',
      relayThread: '○○세무회계',
    },
  ],

  // 도구 사전 순서. 「시작 전에 받아두실 것」과 용어표가 이 순서를 따른다
  tools: [
    {
      id: 'erp',
      name: '더존 ERP',
      shortName: 'ERP',
      description: '회사 회계 시스템. 사번으로 로그인해요',
      access: '회계 모듈 입력 권한. 기간 잠금 권한은 팀장님만 가져요',
      accessCritical: true,
    },
    {
      id: 'hometax',
      name: '홈택스',
      description: '국세청 사이트. 세금계산서를 여기서 봐요',
      access: '법인 공동인증서',
      accessCritical: true,
    },
    { id: 'bank', name: '인터넷뱅킹', access: '조회 전용 계정' },
    {
      id: 'gw',
      name: '그룹웨어',
      description: '다우오피스. 결재랑 지출결의가 여기 있어요',
      access: '지출결의 조회 권한',
    },
    { id: 'excel', name: '엑셀', access: '공용 드라이브 `재무/월마감` 폴더' },
    { id: 'slack', name: '슬랙' },
    { id: 'mail', name: '메일' },
    { id: 'ppt', name: '파워포인트' },
  ],

  glossary: [
    { term: '대사', meaning: '두 군데 이상의 숫자를 서로 맞춰보는 일' },
    { term: '전표', meaning: '회계 기록 한 건. ERP에 입력해요' },
    { term: 'ERP', meaning: '회사 전체가 쓰는 시스템이라는 뜻이에요. 여기서는 더존을 말해요' },
  ],
  unresolvedTerms: ['수불'],

  steps: [
    {
      id: 's1',
      kind: 'task',
      title: '마감 D-3 전사 공지',
      description: '지출결의랑 경비를 며칠까지 올려야 하는지 전사에 알리는 공지예요.',
      assigneeId: 'sujin',
      toolIds: ['slack', 'mail'],
      durationBand: '15m',
    },
    {
      id: 's2',
      kind: 'hold',
      title: '각 부서 증빙 제출',
      toolIds: ['gw'],
      hold: {
        waitFor: 'reply',
        avgWaitH: 96,
        waitClause: '각 부서가 증빙을 올릴 때까지',
        timeoutLabel: '마감일',
        noReplyClause: '안 올라오면',
        escalation: { toStepId: 's3' },
      },
      footnotes: [
        {
          text:
            '마감을 잠그고 나서 "이거 지난달 건인데요" 하고 증빙이 오는 일이 10번에 4번쯤 있어요. ' +
            '금액이 크면 12번까지 되돌려야 해요.',
          summary: '마감 잠근 뒤에 지난달 증빙이 와요',
          oddsOutOfTen: 4,
        },
      ],
    },
    {
      id: 's3',
      kind: 'task',
      title: '아직 안 올린 부서에 개별로 연락',
      description: '그룹웨어에서 부서별로 뭐가 들어왔는지 보고, 안 올린 곳에 슬랙 DM을 보내요.',
      assigneeId: 'sujin',
      toolIds: ['slack', 'gw'],
      durationBand: '1h',
    },
    {
      id: 's4',
      kind: 'task',
      title: '매출 대사',
      description: '세금계산서, ERP에 잡힌 매출, 실제 입금 세 가지를 서로 맞춰봐요.',
      assigneeId: 'sujin',
      toolIds: ['hometax', 'erp', 'excel'],
      durationBand: 'halfday',
      // 2번(기다림)에 걸려 있지 않다 — 병렬 가능 문장의 유일한 근거
      dependsOn: ['s1'],
      footnotes: [
        { text: '세금계산서 공급가액이나 사업자번호가 틀린 걸 여기서 발견하는 일이 10번에 2번쯤 있어요.', summary: '세금계산서 금액이나 사업자번호가 틀려 있어요', oddsOutOfTen: 2 },
        { text: '거래처가 자기 시스템에서 발행하는 곳이 세 곳 있어요. 그건 홈택스 조회로만 확인돼서 항상 여기서 튀어요.', summary: '거래처 세 곳은 자기 시스템에서 발행해요' },
      ],
    },
    {
      id: 's5',
      kind: 'task',
      title: '매입 대사',
      description: '받은 세금계산서, 지출결의, 카드 명세를 맞춰봐요.',
      assigneeId: 'sujin',
      toolIds: ['hometax', 'excel'],
      durationBand: 'halfday',
    },
    {
      id: 's6',
      kind: 'task',
      title: '은행 거래내역 확인',
      description: '거래내역을 내려받아서 아직 확인 안 된 입출금이 있는지 봐요.',
      assigneeId: 'sujin',
      toolIds: ['bank', 'excel'],
      durationBand: '1h',
    },
    {
      id: 's7',
      kind: 'branch',
      title: '차이가 있나요',
      description: '4·5·6번에서 맞춰본 게 서로 맞는지 보고',
      assigneeId: 'sujin',
      toolIds: ['excel'],
      durationBand: '15m',
      branch: {
        mode: 'xor',
        weightKnown: true,
        cases: [
          {
            id: 'c7a',
            label: '차이 있음',
            condition: '차이가 있으면',
            steps: [
              {
                id: 's7a',
                kind: 'task',
                title: '차이 있음 → 부서에 원인 확인',
                description: '해당 부서에 원인을 물어봐요.',
                assigneeId: 'sujin',
                toolIds: ['slack'],
                durationBand: '1h',
              },
            ],
            returnTo: { toStepId: 's4', lead: '확인이 끝나면', tail: '다시 맞춰봐요' },
            perMonth: { min: 3, max: 6 },
          },
          { id: 'c7b', label: '맞음', condition: '맞으면', joinToStepId: 's8' },
        ],
      },
    },
    {
      id: 's8',
      kind: 'task',
      title: '결산 전표 입력',
      description: '감가상각, 미지급, 선급, 충당금을 넣어요.',
      assigneeId: 'sujin',
      toolIds: ['erp'],
      durationBand: 'halfday',
    },
    {
      id: 's9',
      kind: 'task',
      title: '재고 수불 확정',
      description: '물류팀 실사 결과와 맞춰서 재고를 확정해요.',
      assigneeId: 'minah',
      toolIds: ['excel', 'erp'],
      durationBand: '1h',
    },
    {
      id: 's10',
      kind: 'branch',
      title: '실사 수량이 맞나요',
      description: '9번에서 확정한 수량과 ERP 재고가 맞는지 보고',
      assigneeId: 'sujin',
      toolIds: ['excel'],
      durationBand: '15m',
      askAbout: '수량이 안 맞는',
      branch: {
        mode: 'xor',
        cases: [
          { id: 'c10a', label: '맞음', condition: '맞으면', joinToStepId: 's11' },
          {
            id: 'c10b',
            label: '안 맞음',
            condition: '안 맞으면',
            steps: [
              {
                id: 's10b',
                kind: 'task',
                title: '안 맞음 → 다시 확인 요청',
                description: '정민아 님께 다시 확인을 요청하고',
                assigneeId: 'sujin',
                toolIds: ['slack'],
              },
            ],
            returnTo: { toStepId: 's9' },
          },
        ],
      },
    },
    {
      id: 's11',
      kind: 'hold',
      title: '세무대리인 검토 회신',
      toolIds: ['mail'],
      hold: {
        waitFor: 'reply',
        avgWaitH: 48,
        waitClause: '회신이 올 때까지',
        timeoutH: 72,
        noReplyClause: '답이 없으면',
        escalation: { action: '전화로 확인해요.', actionShort: '전화' },
      },
    },
    {
      id: 's12',
      kind: 'task',
      title: '재무제표 확정하고 기간 잠그기',
      description: '여기서 기간을 잠그면 그달 전표는 더 못 고쳐요.',
      assigneeId: 'hyunwoo',
      toolIds: ['erp'],
      durationBand: '1h',
    },
    {
      id: 's13',
      kind: 'hold',
      title: 'CFO 확인',
      toolIds: ['mail'],
      hold: { waitFor: 'approval', avgWaitH: 24 },
      // 소유자가 승격한 노트. **원본이 아니라 소유자가 고쳐 적은 복사본이다**
      footnotes: [{ text: '화요일 오전에는 임원회의가 있어서, 그때 올리면 하루 밀려요.', promoted: true }],
    },
    {
      id: 's14',
      kind: 'task',
      title: '경영진 보고자료 만들어 임원회의에 보내기',
      description:
        '전월 대비, 예산 대비 그래프를 만들어서 임원회의에 보내요.\n여기까지 하면 그달 마감이 끝이에요.',
      assigneeId: 'sujin',
      toolIds: ['excel', 'ppt', 'mail'],
      askAbout: '보고자료 만드는 데',
    },
  ],
};

/**
 * 비공개 노트 3개의 원문 (§2.0).
 * 이 중 승격된 것은 없다 — 13번의 각주는 소유자가 **다시 적은** 문장이다.
 * 아래 문자열이 출력에 단 한 번도 등장하지 않아야 한다 (픽스처 4).
 */
export const FIN01_NOTES: readonly string[] = [
  '사실 홈택스 자료보다 내가 만든 매출대장 엑셀로 먼저 맞춰요. 그게 빨라요.',
  'CFO님은 화요일 오전엔 임원회의라 그때 올리면 하루 밀려요.',
  '○○팀은 매달 늦어요. 팀장님 참조 넣으면 그날 와요.',
];

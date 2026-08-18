/**
 * packages/doc-gen/src/__fixtures__/vac01.ts
 *
 * §3.3의 입력 픽스처 — 이수진 님 부재 2026-08-24(월) ~ 08-28(금),
 * 대신 맡는 사람 조은비(재무팀). 흐름 4개에서 이 기간에 실제로 닥치는 것만 걸러진 결과.
 *
 * ★ 날짜 라벨은 전부 **받은 것**이다. 엔진이 요일을 계산하지 않는다 (D-063).
 */

import type { VacationInput } from '../render/vacation.ts';

export const VAC01: VacationInput = {
  ownerId: 'sujin',
  standInId: 'eunbi',
  people: [
    { id: 'sujin', name: '이수진', team: '재무팀', deptId: 'fin' },
    { id: 'eunbi', name: '조은비', team: '재무팀', deptId: 'fin' },
    {
      id: 'hyunwoo',
      name: '박현우',
      team: '재무팀장',
      deptId: 'fin',
      channel: '슬랙 @hyunwoo',
      decides: true,
    },
  ],
  span: {
    year: 2026,
    fromLabel: '8월 24일 월요일',
    toLabel: '8월 28일 금요일',
    days: 5,
    returnLabel: '8월 31일 월요일',
    expiresLabel: '8월 31일',
  },

  mustDo: [
    {
      when: '8월 25일 화요일',
      title: '법인카드 명세 확정',
      body: '카드사 웹명세에서 8월분을 내려받아 공용 드라이브 `재무/카드정산` 에 올려주세요.',
      durationLabel: '15분',
      consequence: '이날을 놓치면 9월 마감이 하루 밀려요.',
    },
    {
      when: '8월 27일 목요일',
      title: '대금 지급',
      body: '목요일이 지급일이에요. 그룹웨어에서 결재가 끝난 지출결의를 모아 인터넷뱅킹으로 이체해요.',
      durationLabel: '2시간',
      consequence:
        '이체 권한은 박현우 팀장님이 갖고 계세요. 조은비 님은 목록을 만들어 팀장님께 드리면 돼요.',
      note: '금액이 500만 원을 넘는 건은 팀장님이 한 번 더 보세요.',
    },
    {
      when: '요청이 오면',
      title: '세금계산서 발행',
      body:
        '슬랙이나 메일로 발행 요청이 와요. 지난주에는 22건 왔어요.\n' +
        '계약서 금액이랑 맞는지만 보고 홈택스에서 발행하면 돼요. 한 건에 15분쯤 걸려요.',
      deferNote:
        '**거래처가 처음 보는 곳이면** 사업자등록증부터 받아야 해요. 그건 미루셔도 돼요. 아래를 봐주세요.',
    },
  ],

  // `hold`의 대기가 부재 기간에 걸치는 것들. 실무에서 사고가 제일 자주 나는 곳이다
  justReceive: [
    {
      title: '8월 22일에 요청한 사업자등록증',
      body:
        '○○산업에서 이번 주에 답이 올 거예요. 받아서 `재무/거래처` 에 넣어만 주세요. ' +
        '발행은 이수진 님이 돌아와서 해요.',
    },
    { title: '부서별 예산 실적 회신', body: '7월 마감 보고에 대한 회신이 몇 개 올 수 있어요. 읽지 않고 두셔도 돼요.' },
    { title: '처음 보는 거래처의 발행 요청', body: '등록증 요청 메일만 보내두시고, 발행은 안 하셔도 돼요.' },
  ],

  skip: [
    { title: '월 마감', body: '8월 마감은 9월 1일부터 시작해요. 이번 주에는 할 게 없어요.' },
    { title: '미수금 회수 연락', body: '이수진 님이 돌아와서 해요.' },
    { title: '주간 미수 리스트', body: '한 주 건너뛰어도 괜찮아요.' },
  ],

  contacts: [
    { situation: '이체', personId: 'hyunwoo' },
    { situation: '홈택스가 안 열릴 때 (인증서)', personId: 'hyunwoo' },
    { situation: '거래처가 재촉할 때', personId: 'hyunwoo' },
  ],

  reachMe: {
    lead: '이 두 가지면 연락 주세요. 카톡이 제일 빨라요.',
    cases: ['거래처가 화가 났을 때', '5백만 원 넘는 돈이 나가는데 판단이 안 설 때'],
    tail: '그 밖에는 돌아가서 볼게요. 편하게 미뤄두세요.',
  },

  moreLinks: ['세금계산서 끊기', '지출결의·대금 지급'],
};

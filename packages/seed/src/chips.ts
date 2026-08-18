/**
 * packages/seed/src/chips.ts
 *
 * 부서별 업무명 칩 — 7부서 × 6개 = 42. `docs/SEED-CONTENT.md` §C.
 *
 * 원칙: **동사형·구어체·부서 내부 호칭.** "프로세스"·"관리"·"체계" 같은
 * 문어체 명사 금지. 직원이 0.5초 안에 "아 맞다 그거"가 나와야 한다.
 *
 * `workflowId`가 붙은 칩은 누르면 시드 흐름이 읽기 전용 미리보기로 열린다.
 * 붙지 않은 칩은 아직 시드가 없다 — 그때는 빈 문서가 아니라
 * "이 이름으로 새로 쓰기"로 이어져야 한다.
 */

import type { DeptChips } from './types.ts';

export const DEPT_CHIPS: readonly DeptChips[] = [
  {
    deptId: 'hr',
    deptName: '인사',
    chips: [
      { label: '신입 들어오면 하는 것들', workflowId: 'HR-01' },
      { label: '휴가 신청 처리', workflowId: 'HR-02' },
      { label: '사람 뽑기 (공고~면접)', workflowId: 'HR-03' },
      { label: '4대보험 취득·상실 신고' },
      { label: '경조사 챙기기' },
      { label: '퇴사자 정리 (인수인계·정산)' },
    ],
  },
  {
    deptId: 'fin',
    deptName: '재무/회계',
    chips: [
      { label: '월 마감', workflowId: 'FIN-01' },
      { label: '세금계산서 끊기', workflowId: 'FIN-02' },
      { label: '법인카드 정산', workflowId: 'FIN-03' },
      { label: '급여 이체' },
      { label: '지출결의·대금 지급' },
      { label: '부가세 신고 자료 준비' },
    ],
  },
  {
    deptId: 'sal',
    deptName: '영업',
    chips: [
      { label: '문의 들어오면 견적까지', workflowId: 'SAL-01' },
      { label: '계약 체결·날인', workflowId: 'SAL-02' },
      { label: '수주 등록' },
      { label: '미수금 회수' },
      { label: '주간 영업보고' },
      { label: '고객사 정기 미팅 잡기' },
    ],
  },
  {
    deptId: 'cs',
    deptName: 'CS',
    chips: [
      { label: '문의 받고 답하기', workflowId: 'CS-01' },
      { label: '환불·교환 처리', workflowId: 'CS-02' },
      { label: '클레임 에스컬레이션' },
      { label: '상담 이력 정리' },
      { label: '자주 묻는 질문 업데이트' },
      { label: '리뷰·평점 관리' },
    ],
  },
  {
    deptId: 'ga',
    deptName: '총무',
    chips: [
      { label: '비품 사달라고 하면', workflowId: 'GA-01' },
      { label: '사무실에 뭐 고장났을 때', workflowId: 'GA-02' },
      { label: '명함·인쇄물 발주' },
      { label: '출입카드·주차 등록' },
      { label: '등기·택배 수발신' },
      { label: '사무실 계약·공과금' },
    ],
  },
  {
    deptId: 'mkt',
    deptName: '마케팅',
    chips: [
      { label: '콘텐츠 하나 내보내기', workflowId: 'MKT-01' },
      { label: '광고 집행·소재 교체' },
      { label: '뉴스레터 발송' },
      { label: '이벤트·프로모션 준비' },
      { label: '성과 리포트 만들기' },
      { label: '제휴·인플루언서 커뮤니케이션' },
    ],
  },
  {
    deptId: 'ops',
    deptName: '물류/운영',
    chips: [
      { label: '주문 나가는 것까지 (출고)', workflowId: 'OPS-01' },
      { label: '재고 실사' },
      { label: '반품·교환 입고' },
      { label: '택배 분실·파손 클레임' },
      { label: '발주·입고 검수' },
      { label: '배송 지연 대응' },
    ],
  },
];

/**
 * 칩 6개 아래에 항상 같은 크기로 붙는 마지막 선택지.
 * 크기가 작아지는 순간 "우리는 여기 없다"는 사람이 자기 일을 안 적는다.
 */
export const CHIP_ESCAPE_LABEL = '직접 입력';

/** 칩을 눌러 시드가 열렸을 때의 2택. 3택이 되면 아무도 안 고른다 */
export const CHIP_PREVIEW_ACTIONS = ['이거랑 비슷해요, 고쳐서 쓸게요', '우리는 다르게 해요, 새로 쓸게요'] as const;

export const ALL_CHIPS: readonly string[] = DEPT_CHIPS.flatMap((d) => d.chips.map((c) => c.label));

/**
 * packages/seed/src/seams.ts
 *
 * 접합 지도 — `docs/SEED-CONTENT.md` §B.
 *
 * PRD §4.9의 *"조인 키는 프로세스 이름이 아니라 핸드오프"*를 시드 데이터에
 * 미리 심어 둔 것이다. 조직 프로세스는 부서 흐름을 이름으로 이어 붙여서
 * 만들어지지 않는다 — **산출물이 같은 지점**에서만 이어진다.
 *
 *   산출물 = 매칭 신호 ① · 도구 = 신호 ② · 역할 = 신호 ③
 *
 * ★ 문서는 "20건"이라고 적었지만 실제 목록은 J-16이 빠진 19건이다.
 *   여기서는 있는 19건만 옮겼다. 없는 걸 지어내면 접합 지도의 신뢰가 깨진다.
 */

import type { Seam, SeamChain, SeamRef } from './types.ts';
import { itemId } from './workflows/_build.ts';

const at = (workflowId: string, ...ns: string[]): SeamRef => ({
  kind: 'seed',
  workflowId,
  itemIds: ns.map((n) => itemId(workflowId, n)),
});

const outside = (label: string): SeamRef => ({ kind: 'external', label });

export const SEAMS: readonly Seam[] = [
  {
    id: 'J-01',
    upstream: at('GA-01', '13'),
    downstream: [at('FIN-01', '5')],
    artifact: '지출결의서 + 세금계산서',
    mismatch: '총무는 "올리면 끝, 하루"로 알고, 재무는 "증빙 확인까지 나흘"로 알아요',
  },
  {
    id: 'J-02',
    upstream: at('GA-01', '7'),
    downstream: [at('FIN-03', '4')],
    artifact: '카드 승인번호',
    mismatch: '총무는 지출결의로 처리했다고 보고, 재무는 카드 정산에서 또 증빙을 요구해요',
    highlight: '증빙을 두 번 내는 일이 실제로 벌어지는 지점',
  },
  {
    id: 'J-03',
    upstream: at('GA-02', '8b', '8c'),
    downstream: [at('GA-01', '3')],
    artifact: '수리 견적서',
    mismatch: '같은 부서 안에서 넘어가는데도 요청서를 처음부터 다시 써요',
  },
  {
    id: 'J-04',
    upstream: at('SAL-02', '11'),
    downstream: [at('FIN-02', '1')],
    artifact: '계약서 + 수주번호',
    mismatch: '영업은 "요청하면 당일 발행"으로 알고, 재무는 "정보가 모자라서 1.5일"로 알아요',
  },
  {
    id: 'J-05',
    upstream: at('SAL-02', '10'),
    downstream: [at('OPS-01', '1')],
    artifact: '수주 등록 건',
    mismatch: '영업이 약속한 납기와 물류가 알고 있는 납기가 달라요',
    highlight: '대표적 불일치',
  },
  {
    id: 'J-06',
    upstream: at('OPS-01', '14'),
    downstream: [at('FIN-02', '1'), at('FIN-01', '4')],
    artifact: '출고 완료 리스트',
    mismatch: '출고일 기준이냐 검수일 기준이냐로 매출 인식 시점이 달라져요',
  },
  {
    id: 'J-07',
    upstream: at('CS-01', '3c'),
    downstream: [at('CS-02', '1')],
    artifact: '환불 요청 티켓',
    mismatch: '같은 팀 안에서 넘기는데 티켓이 새로 생겨서 응답시간이 두 번 세져요',
  },
  {
    id: 'J-08',
    upstream: at('CS-02', '3a'),
    downstream: [at('OPS-01', '5', '6', '7', '8')],
    artifact: '보류 지시',
    mismatch: 'CS는 "말하면 바로 보류"로 알고, 물류는 "송장 붙었으면 못 뺀다"로 알아요',
    highlight: '가장 자주 부딪히는 지점',
  },
  {
    id: 'J-09',
    upstream: at('CS-02', '12'),
    downstream: [at('FIN-02', '5')],
    artifact: '수정 사유 + 원 계산서',
    mismatch: 'CS가 요청을 잊으면 월 마감 4번 대조에서 재무가 발견해요',
  },
  {
    id: 'J-10',
    upstream: at('CS-02', '7'),
    downstream: [at('OPS-01'), at('FIN-01', '9')],
    artifact: '반품 입고 건',
    mismatch: 'CS가 세는 "반품 완료" 수량과 재고가 세는 "다시 팔 수 있는" 수량이 달라요',
  },
  {
    id: 'J-11',
    upstream: at('HR-03', '14'),
    downstream: [at('HR-01', '1')],
    artifact: '입사 확정자 정보',
    mismatch: '확정과 온보딩 착수 사이에 평균 이틀이 비어요',
  },
  {
    id: 'J-12',
    upstream: at('HR-01', '8'),
    downstream: [at('GA-01', '1')],
    artifact: '장비 요청서',
    mismatch: '인사는 "입사 1주 전에 요청"으로 알고, 총무는 "조달에 2주 필요"로 알아요',
    highlight: '입사 첫날 장비가 없는 구조적 원인',
  },
  {
    id: 'J-13',
    upstream: at('HR-01', '12'),
    downstream: [outside('재무 · 급여')],
    artifact: '급여 대장 신규 행',
    mismatch: '중도 입사자 일할 계산 기준이 서로 달라요',
  },
  {
    id: 'J-14',
    upstream: at('HR-02', '10'),
    downstream: [outside('재무 · 급여')],
    artifact: '월 근태 확정 파일',
    mismatch: '근태 마감일과 급여 마감일이 하루 차이라 매달 예외가 생겨요',
  },
  {
    id: 'J-15',
    upstream: at('HR-02', '8'),
    downstream: [outside('전 부서 · 담당자 문서')],
    artifact: '업무 인계 메모',
    mismatch: '메모의 형식이 사람마다 달라서 대신 하는 사람이 늘 헤매요',
    highlight: '제품이 직접 해결하는 지점 — 대체자 가이드를 자동으로 만든다',
  },
  {
    id: 'J-17',
    upstream: at('MKT-01', '10'),
    downstream: [at('SAL-01', '1')],
    artifact: '콘텐츠 링크 + UTM',
    mismatch: '마케팅은 45건이라 하고 영업은 쓸 만한 건 12건이라고 해요 — 세는 기준이 달라요',
  },
  {
    id: 'J-18',
    upstream: at('CS-01', '11'),
    downstream: [at('MKT-01', '3b')],
    artifact: '자주 묻는 질문 수정 요청',
    mismatch: 'CS 요청이 마케팅 순서에서 평균 3주를 기다려요',
  },
  {
    id: 'J-19',
    upstream: at('OPS-01', '3b'),
    downstream: [at('CS-01')],
    artifact: '품절 알림',
    mismatch: '물류는 알렸다고 하고 CS는 못 받았다고 해요 — 슬랙 채널이 서로 달라요',
  },
  {
    id: 'J-20',
    upstream: at('FIN-03', '11'),
    downstream: [outside('인사 · 급여 공제')],
    artifact: '미증빙 리스트',
    mismatch: '퇴사자 건은 인사도 재무도 자기 것으로 보지 않아요',
    highlight: '고아 단계 — 아무도 소유하지 않는다',
  },
];

/**
 * 킥오프 데모용 체인. **첫 화면에서 바로 보여야 하는 3개.**
 * 한 부서의 한 건이 다른 부서 여러 흐름을 발화시키는 걸 보여주는 게 목적이다.
 */
export const SEAM_CHAINS: readonly SeamChain[] = [
  {
    id: 'chain-purchase',
    name: '구매 체인',
    workflowIds: ['GA-02', 'GA-01', 'FIN-03', 'FIN-01'],
    note: '총무 한 건이 재무 세 흐름을 깨워요. 부서 간 인계 8회.',
  },
  {
    id: 'chain-order',
    name: '수주 체인',
    workflowIds: ['MKT-01', 'SAL-01', 'SAL-02', 'OPS-01', 'FIN-02', 'FIN-01'],
    note: '다섯 부서, 인계 11회, 달력으로 60~90일.',
  },
  {
    id: 'chain-hire',
    name: '입사 체인',
    workflowIds: ['HR-03', 'HR-01', 'GA-01'],
    note: '세 부서. J-12의 "2주 vs 1주" 차이가 첫 화면에서 바로 보여요.',
  },
];

/** 문서가 주장한 접합 건수. 실제 목록과 대조하기 위해 남긴다 */
export const SEAM_COUNT_CLAIMED = 20;

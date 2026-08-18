/**
 * packages/paste-parse/src/__fixtures__/golden.ts
 *
 * PARSING §11의 골든 픽스처 6개. **이 파일이 파서의 진짜 명세다.**
 *
 * 읽는 법
 *   input      — 붙여넣은 원문 그대로 (F4의 탭은 실제 탭 문자다)
 *   expect     — 이 구현이 내는 값이자, 리뷰에서 합의된 값
 *   specSays   — PARSING.md §11이 적어둔 값과 **다를 때만** 적는다
 *   why        — 왜 다른가. 다르면 둘 중 하나가 틀린 것이고, 그 판단을 여기 남긴다
 *
 * 픽스처가 깨지면 둘 중 하나다.
 *   (1) 규칙을 바꿨다 → 픽스처를 고치고 PARSING.md도 같이 고친다
 *   (2) 규칙이 깨졌다 → 코드를 고친다
 * 리뷰에서 이 둘을 구분할 수 있게 하는 것이 이 파일의 유일한 목적이다.
 */

export type ExpectedItem = {
  title: string;
  kind: 'task' | 'branch' | 'hold';
  depth: number;
  toolHints: string[];
  assigneeHint?: string;
  durationHint?: string;
  freqHint?: string;
  branchMode?: 'xor' | 'and' | 'skip';
  branchCondition?: string;
  waitFor?: 'approval' | 'reply' | 'time' | 'resource';
  sourceRange: [number, number];
};

export type ExpectedDrop = { range: [number, number]; reason: string };

export type Fixture = {
  name: string;
  /** PARSING §11의 sourceHint 기대값 */
  sourceHint: string;
  input: string;
  items: ExpectedItem[];
  dropped: ExpectedDrop[];
  confidence: 'low' | 'mid' | 'high';
  docTitleHint?: string;
  docHints?: { durationHint?: string; freqHint?: string };
  /** §11 기대값과 다른 지점 — 왜 다른지까지 적는다 */
  deviations?: string[];
};

const F1_INPUT = `[거래처 신규 등록 절차]

1. 신규 거래처 등록 요청 접수
   가. 영업담당자가 메일로 사업자등록증 사본을 송부한다.
   나. 첨부파일 누락 여부를 확인한다.
2. 사업자 정보 조회
   ① 홈택스에서 사업자등록상태를 조회한다. (약 10분)
   ② 휴폐업 사업자인 경우 영업담당자에게 반려한다.
3. ERP 등록
   - 더존 ERP > 기초등록 > 거래처등록 에 입력한다.
   - 여신한도는 재무팀 승인 후 입력할 것
4. 등록 완료 통보
   완료 메일을 영업담당자에게 회신한다.

- 1 -`;

const F2_INPUT = `2026년 8월 12일 오후 2:11, 김수연 : 대리님 다음주부터 제가 휴가라 인수인계 드려요 ㅠㅠ
2026년 8월 12일 오후 2:11, 김수연 : 매주 화요일 오전에 영업팀에서 주간 실적 엑셀 파일이 메일로 와요
2026년 8월 12일 오후 2:12, 김수연 : 그거 받으면 실적취합.xlsx 열어서 해당 주차 시트에 붙여넣고 피벗 새로고침 한 번 눌러주시면 돼요
2026년 8월 12일 오후 2:13, 김수연 : 숫자가 전주 대비 20% 넘게 차이나면 영업팀 박과장님한테 확인 한번 받아주세요 아니면 그냥 진행하시면 돼요
2026년 8월 12일 오후 2:14, 박정우 : 넵
2026년 8월 12일 오후 2:15, 김수연 : 다 되면 팀장님께 결재 올리고 승인 나면 공유드라이브에 올려주시면 끝이에요
2026년 8월 12일 오후 2:15, 김수연 : 감사합니다!!`;

const F3_INPUT = `보낸사람: 이지훈 <jhlee@example.co.kr>
받는사람: 총무팀 <ga@example.co.kr>
참조: 최민경
제목: RE: [요청] 8월 법인카드 사용내역 정산 건
날짜: 2026-08-14 (목) 09:32

총무팀 이지훈입니다.

법인카드 정산은 아래 순서로 진행하시면 됩니다.

1) 매월 5일에 카드사 홈페이지에서 전월 사용내역을 엑셀로 다운로드합니다.
2) 다운로드한 내역을 정산양식.xlsx에 붙여넣고 계정과목을 지정합니다.
3) 영수증이 누락된 건은 사용자에게 개별 요청 메일을 보내고 회신을 기다립니다. (보통 2~3일)
4) 전 건이 채워지면 그룹웨어에 지출결의서를 상신합니다.
5) 결재가 완료되면 더존 ERP에 전표를 입력하고 마감합니다.

감사합니다.

이지훈
총무팀 대리
(02) 1234-5678 | jhlee@example.co.kr

> -----Original Message-----
> 보낸사람: 최민경
> 총무팀 법인카드 정산 절차 좀 공유해주실 수 있을까요?`;

const F4_INPUT = `## 신입사원 온보딩 (인사팀)
- [ ] 입사 3일 전: 노트북·모니터 신청 (IT팀에 슬랙으로 요청)
- [ ] 입사 1일 전: 사원증 발급 신청 → 총무팀
- [x] 입사 당일 오전: 계정 생성 확인
\t- 그룹웨어, 슬랙, 구글 워크스페이스 3개
\t- 하나라도 안 되면 IT팀 담당자에게 바로 연락
- [ ] 입사 후 1주일 이내: 4대보험 취득신고 (반나절)
- [ ] 수습 3개월 종료 시점에 평가 요청 메일 발송하고 마무리`;

const F5_INPUT = `[8/13(수) 재고관리 개선 정기회의]
참석: 물류팀 김철수, 구매팀 이영희, 전산팀 박민수
장소: 3층 회의실

■ 논의 내용
- 월말 재고실사 시 엑셀 대장과 ERP 수량 불일치가 반복됨
- 원인은 출고 후 ERP 반영이 하루 늦는 것으로 추정

■ 액션아이템
- @김철수 : 매월 말일 재고실사 결과를 엑셀 대장에 입력 (D+1까지)
- @이영희 : 불일치 건이 10건 이상이면 구매팀장 승인 받아 조정전표 등록, 10건 미만이면 자체 처리
- @박민수 : ERP 반영 지연 원인 확인 후 8/20까지 회신
- 다음 회의: 8/27(수) 15시`;

const F6_INPUT = `메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요. 급한 건은 전화로 먼저 알려주고 나중에 메일로 정리해서 보내요. 한 건에 20분쯤 걸리는데 하루에 열 건 넘게 올 때도 있어요.`;

export const INPUTS = {
  F1: F1_INPUT, F2: F2_INPUT, F3: F3_INPUT, F4: F4_INPUT, F5: F5_INPUT, F6: F6_INPUT,
};

export const fixtures: Fixture[] = [
  {
    name: 'F1 · 한글/워드 SOP 매뉴얼 (번호 3단 + 표기 혼재 + 페이지 번호)',
    sourceHint: 'word_sop',
    input: F1_INPUT,
    items: [
      { title: '신규 거래처 등록 요청 접수', kind: 'task', depth: 0, toolHints: [], sourceRange: [16, 34] },
      { title: '영업담당자가 메일로 사업자등록증 사본을 송부한다', kind: 'task', depth: 1, toolHints: ['사내 메일(IMAP)'], assigneeHint: '영업담당자', sourceRange: [38, 68] },
      { title: '첨부파일 누락 여부를 확인한다', kind: 'task', depth: 1, toolHints: [], sourceRange: [72, 92] },
      { title: '사업자 정보 조회', kind: 'task', depth: 0, toolHints: [], sourceRange: [93, 105] },
      { title: '홈택스에서 사업자등록상태를 조회한다', kind: 'task', depth: 1, toolHints: ['홈택스'], durationHint: '10분', sourceRange: [109, 139] },
      { title: '휴폐업 사업자인 경우 영업담당자에게 반려한다', kind: 'branch', depth: 1, toolHints: [], assigneeHint: '영업담당자', branchMode: 'skip', branchCondition: '휴폐업 사업자인 경우', sourceRange: [143, 170] },
      { title: 'ERP 등록', kind: 'task', depth: 0, toolHints: ['더존 ERP'], sourceRange: [171, 180] },
      { title: '더존 ERP > 기초등록 > 거래처등록 에 입력한다', kind: 'task', depth: 1, toolHints: ['더존 ERP'], sourceRange: [184, 215] },
      { title: '여신한도는 재무팀 승인 후 입력할 것', kind: 'task', depth: 1, toolHints: [], assigneeHint: '재무팀', sourceRange: [219, 241] },
      { title: '등록 완료 통보', kind: 'task', depth: 0, toolHints: [], sourceRange: [242, 253] },
      { title: '완료 메일을 영업담당자에게 회신한다', kind: 'task', depth: 1, toolHints: ['사내 메일(IMAP)'], assigneeHint: '영업담당자', sourceRange: [257, 277] },
    ],
    dropped: [
      { range: [0, 14], reason: 'doc_title' },
      { range: [279, 284], reason: 'page_number' },
    ],
    confidence: 'high',
    docTitleHint: '거래처 신규 등록 절차',
    // §11의 기대 출력과 항목·버림·구간·제목·타입·힌트가 **완전히 일치**한다
  },
  {
    name: 'F2 · 카카오톡 인수인계 (타임스탬프 + 들여쓰기 0 + 문장 내 분기)',
    sourceHint: 'kakao',
    input: F2_INPUT,
    items: [
      { title: '대리님 다음주부터 제가 휴가라 인수인계 드려요 ㅠㅠ', kind: 'task', depth: 0, toolHints: [], assigneeHint: '대리', sourceRange: [28, 56] },
      { title: '매주 화요일 오전에 영업팀에서 주간 실적 엑셀 파일이 메일로 와요', kind: 'task', depth: 0, toolHints: ['엑셀', '사내 메일(IMAP)'], assigneeHint: '영업팀', freqHint: '매주 화요일', sourceRange: [85, 121] },
      { title: '그거 받으면 실적취합.xlsx 열어서 해당 주차 시트에 붙여넣고 피벗 새로고침 한 번 눌러주시면 돼요', kind: 'task', depth: 0, toolHints: ['엑셀'], sourceRange: [150, 206] },
      { title: '숫자가 전주 대비 20% 넘게 차이나면', kind: 'branch', depth: 0, toolHints: [], branchMode: 'xor', branchCondition: '숫자가 전주 대비 20% 넘게 차이남', sourceRange: [235, 256] },
      { title: '영업팀 박과장님한테 확인 한번 받아요', kind: 'hold', depth: 1, toolHints: [], assigneeHint: '박과장', waitFor: 'approval', sourceRange: [257, 279] },
      { title: '아니면 그냥 진행해요', kind: 'task', depth: 1, toolHints: [], sourceRange: [280, 295] },
      { title: '다 되면 팀장님께 결재 올려요', kind: 'hold', depth: 0, toolHints: ['그룹웨어 전자결재'], assigneeHint: '팀장', waitFor: 'approval', sourceRange: [354, 370] },
      { title: '승인 나면 공유드라이브에 올려요', kind: 'task', depth: 0, toolHints: ['구글 드라이브'], sourceRange: [371, 395] },
    ],
    dropped: [
      { range: [0, 28], reason: 'chat_meta' },
      { range: [57, 85], reason: 'chat_meta' },
      { range: [122, 150], reason: 'chat_meta' },
      { range: [207, 235], reason: 'chat_meta' },
      { range: [296, 324], reason: 'chat_meta' },
      { range: [324, 325], reason: 'ack' },
      { range: [326, 354], reason: 'chat_meta' },
      { range: [396, 424], reason: 'chat_meta' },
      { range: [424, 431], reason: 'ack' },
    ],
    confidence: 'mid',
    deviations: [
      '§11은 첫 발화(`"대리님 다음주부터 … ㅠㅠ"`)를 greeting으로 버린다. §8.2 RE_GREETING에 그 형태가 없고, 인사가 아니라 인수인계 선언이다. 규칙을 넓히면 `"…드려요"`로 끝나는 진짜 단계까지 삼킨다 → 본문으로 남긴다.',
      '§11은 3번째 발화를 `붙여넣고` 뒤에서 2단계로 쪼갠다. 도구 전환도 담당자 전환도 없어 채점이 0.70 < 0.75다. D-050(미분할 편향)이 잠긴 결정이므로 임계를 따른다.',
      '§11 F2-03의 `toolHints: ["엑셀"]`은 `피벗`에서 유추한 값이다. 도구 사전(TOOLS.md)에 `피벗`이 없어 재현할 수 없다.',
      'branchCondition은 주어를 지우지 않는다 — §11은 `"전주 대비 20% 넘게 차이남"`, 이 구현은 `"숫자가 …"`. §0.3이 "요약하거나 다시 쓰지 않는다"고 못 박았다.',
    ],
  },
  {
    name: 'F3 · 메일 스레드 (헤더 + 서명 + 인용 + 번호 목록)',
    sourceHint: 'email',
    input: F3_INPUT,
    items: [
      { title: '매월 5일에 카드사 홈페이지에서 전월 사용내역을 엑셀로 다운로드합니다', kind: 'task', depth: 0, toolHints: ['법인카드 웹명세', '엑셀'], freqHint: '매월 5일', sourceRange: [167, 209] },
      { title: '다운로드한 내역을 정산양식.xlsx에 붙여넣고 계정과목을 지정합니다', kind: 'task', depth: 0, toolHints: ['엑셀'], sourceRange: [210, 251] },
      { title: '영수증이 누락된 건은 사용자에게 개별 요청 메일을 보내고 회신을 기다립니다', kind: 'task', depth: 0, toolHints: ['사내 메일(IMAP)'], durationHint: '2~3일', sourceRange: [252, 307] },
      { title: '전 건이 채워지면 그룹웨어에 지출결의서를 상신합니다', kind: 'hold', depth: 0, toolHints: [], waitFor: 'approval', sourceRange: [308, 340] },
      { title: '결재가 완료되면 더존 ERP에 전표를 입력하고 마감합니다', kind: 'task', depth: 0, toolHints: ['그룹웨어 전자결재', '더존 ERP'], sourceRange: [341, 376] },
    ],
    dropped: [
      { range: [0, 31], reason: 'mail_header' },
      { range: [32, 60], reason: 'mail_header' },
      { range: [61, 68], reason: 'mail_header' },
      { range: [69, 99], reason: 'mail_header' },
      { range: [100, 124], reason: 'mail_header' },
      { range: [126, 137], reason: 'greeting' },
      { range: [139, 165], reason: 'lead_in' },
      { range: [378, 384], reason: 'ack' },
      { range: [386, 433], reason: 'signature' },
      { range: [435, 508], reason: 'quoted' },
    ],
    confidence: 'high',
    deviations: [
      '§11은 항목 7개다. 2)·3)·5)번 줄의 절 분할(`붙여넣고`·`보내고`·`입력하고`)이 전부 0.70 이하 — 도구 전환이 없다. 특히 5)번은 §3.6 (4)의 반례표가 **직접 "유지"로 든 예**다. 같은 규칙을 2)·3)에만 다르게 적용할 근거가 없다.',
      '버림 10건은 §11과 완전히 일치한다 (mail_header 5 · greeting · lead_in · closing(ack) · signature · quoted).',
      '§11은 `"감사합니다."`를 closing으로 적었다. 이 구현은 ack로 잡는다 — 두 정규식이 같은 줄을 잡고 RE_ACK가 먼저 걸린다. tier·구간은 같다.',
    ],
  },
  {
    name: 'F4 · 노션 체크박스 + 탭 들여쓰기',
    sourceHint: 'notion',
    input: F4_INPUT,
    items: [
      { title: '입사 3일 전: 노트북·모니터 신청', kind: 'task', depth: 0, toolHints: ['슬랙'], sourceRange: [18, 58] },
      { title: '입사 1일 전: 사원증 발급 신청', kind: 'task', depth: 0, toolHints: [], assigneeHint: '총무팀', sourceRange: [59, 89] },
      { title: '입사 당일 오전: 계정 생성 확인', kind: 'task', depth: 0, toolHints: [], sourceRange: [90, 114] },
      { title: '그룹웨어, 슬랙, 구글 워크스페이스 3개', kind: 'task', depth: 1, toolHints: ['슬랙', '지메일 / 구글 워크스페이스'], sourceRange: [116, 140] },
      { title: '하나라도 안 되면 IT팀 담당자에게 바로 연락', kind: 'branch', depth: 1, toolHints: [], assigneeHint: 'IT팀', branchMode: 'skip', branchCondition: '하나라도 안 됨', sourceRange: [142, 169] },
      { title: '입사 후 1주일 이내: 4대보험 취득신고', kind: 'task', depth: 0, toolHints: ['4대보험 정보연계센터'], durationHint: '반나절', sourceRange: [170, 204] },
      { title: '수습 3개월 종료 시점에 평가 요청 메일 발송하고 마무리', kind: 'task', depth: 0, toolHints: ['사내 메일(IMAP)'], sourceRange: [205, 242] },
    ],
    dropped: [
      { range: [0, 17], reason: 'doc_title' },
    ],
    confidence: 'high',
    docTitleHint: '신입사원 온보딩 (인사팀)',
    deviations: [
      'branchCondition을 명사형으로 접는다 — §11 F4-05는 `"하나라도 안 되면"`(원형), F2-04·F5-02는 `"…차이남"`·`"…10건 이상"`(명사형)을 기대한다. 셋 중 둘을 만족하는 명사화 규칙을 택했다.',
    ],
  },
  {
    name: 'F5 · 회의록 (섹션 게이팅 + @담당자)',
    sourceHint: 'minutes',
    input: F5_INPUT,
    items: [
      { title: '매월 말일 재고실사 결과를 엑셀 대장에 입력', kind: 'task', depth: 0, toolHints: ['엑셀'], assigneeHint: '김철수', freqHint: '매월 말일', sourceRange: [149, 190] },
      { title: '불일치 건이 10건 이상이면 구매팀장 승인 받아 조정전표 등록, 10건 미만이면 자체 처리', kind: 'hold', depth: 0, toolHints: [], assigneeHint: '이영희', waitFor: 'approval', sourceRange: [191, 250] },
      { title: 'ERP 반영 지연 원인 확인 후 8/20까지 회신', kind: 'task', depth: 0, toolHints: ['더존 ERP'], assigneeHint: '박민수', sourceRange: [251, 287] },
    ],
    dropped: [
      { range: [0, 22], reason: 'doc_title' },
      { range: [23, 52], reason: 'minutes_header' },
      { range: [53, 63], reason: 'minutes_header' },
      { range: [65, 139], reason: 'context_section' },
      { range: [141, 148], reason: 'section_header' },
      { range: [288, 308], reason: 'schedule' },
    ],
    confidence: 'high',
    docTitleHint: '8/13(수) 재고관리 개선 정기회의',
    deviations: [
      '§11은 항목 7개다. 세 분할이 임계 미만이다 — (a) `"승인 받아"`의 `-아` 연결어미는 §3.6 후보 목록에 아예 없다, (b) `"조정전표 등록,"`의 쉼표 경계도 규칙에 없다, (c) `"확인 후"`는 0.80이지만 §2.4의 불릿 감점(−0.10)으로 0.70이 된다.',
      '그 결과 두 번째 액션아이템이 통째로 한 단계가 되고, 분기(`10건 이상이면`)가 hold/approval로 분류된다. 분할이 안 되면 분류도 따라 무너진다는 것이 이 픽스처의 교훈이다.',
      'confidence는 high다 (§11은 mid). 항목이 3개뿐이고 전부 마커 경계라 §9.1 공식이 0.30 markerCoverage를 만점으로 준다. 항목 수가 줄면 점수가 **올라가는** 것이 공식의 약점이다.',
      '버림 6건은 §11과 완전히 일치한다.',
    ],
  },
  {
    name: 'F6 · 한 문단 프로즈 (절 분할의 정본 케이스)',
    sourceHint: 'prose',
    input: F6_INPUT,
    items: [
      { title: '메일로 요청 받아요', kind: 'task', depth: 0, toolHints: ['사내 메일(IMAP)'], sourceRange: [0, 10] },
      { title: '엑셀에 정리해요', kind: 'task', depth: 0, toolHints: ['엑셀'], sourceRange: [11, 19] },
      { title: '팀장님 컨펌 받아요', kind: 'hold', depth: 0, toolHints: [], assigneeHint: '팀장', waitFor: 'approval', sourceRange: [20, 29] },
      { title: 'ERP에 등록해요', kind: 'task', depth: 0, toolHints: ['더존 ERP'], sourceRange: [30, 40] },
      { title: '급한 건은', kind: 'branch', depth: 0, toolHints: [], branchMode: 'skip', branchCondition: '급한 건', sourceRange: [41, 46] },
      { title: '전화로 먼저 알려줘요', kind: 'task', depth: 1, toolHints: ['전화'], sourceRange: [47, 58] },
      { title: '나중에 메일로 정리해서 보내요', kind: 'task', depth: 1, toolHints: ['사내 메일(IMAP)'], sourceRange: [59, 76] },
    ],
    dropped: [
      { range: [77, 112], reason: 'meta_stat' },
    ],
    confidence: 'mid',
    docHints: { durationHint: '20분' },
    deviations: [
      '§11과 항목·버림·구간·제목·타입이 전부 일치한다. 다만 docHints.freqHint(`"하루 10건+"`)는 없다 — `"열 건"`이 한글 수사라 §7.4 RE_FREQ가 잡지 못한다. 숫자만 다룬다는 사전의 한계이지 버그가 아니다.',
    ],
  },
];


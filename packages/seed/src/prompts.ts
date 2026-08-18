/**
 * packages/seed/src/prompts.ts
 *
 * 예외 프롬프트 뱅크 — `docs/TOOLS.md` §B.
 *
 * 원칙 하나: **존재가 아니라 빈도로 묻는다.** "예외 있나요?"는 무조건
 * "없어요"가 나온다. "10번 중 몇 번은 이렇게 안 흘러가나요?"는 숫자가 나온다.
 *
 * 트리거: 단계 저장 직후 **1개만**, 인라인 각주 입력란으로.
 * **절대 모달로 띄우지 않는다.** 모달은 "지금 이걸 답해야 넘어간다"는 뜻이고,
 * 그 순간 사람은 대충 적고 넘긴다.
 */

import type { ExceptionPrompt } from './types.ts';

export const COMMON_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-common-frequency',
    text: '10번 중 몇 번은 이렇게 안 흘러가나요?',
    scope: { kind: 'common' },
    trigger: '모든 단계. 문서당 최대 1회',
    writesTo: 'attrs.exceptionRate',
    followUp: { when: '0', text: '정말 한 번도요? 지난달에 이상했던 건 없었어요?' },
  },
  {
    id: 'p-common-longest',
    text: '지난달에 이 일 하다가 제일 오래 걸렸던 건은 어떤 거였어요?',
    scope: { kind: 'common' },
    trigger: '흐름 완성 직후 1회',
  },
  {
    id: 'p-common-remove',
    text: '이 단계, 없애면 무슨 일이 생기나요?',
    scope: { kind: 'common' },
    trigger: '확인 성격 단계 — ECRS 제거 후보 발굴',
  },
  {
    id: 'p-common-who-else',
    text: '이거 당신 말고 할 수 있는 사람이 있나요?',
    scope: { kind: 'common' },
    trigger: "담당자가 '나'로 3단계 이상 연속될 때",
  },
];

export const TASK_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-task-rework',
    text: '이 단계에서 다시 해야 했던 적은요? 그러면 어디로 돌아가나요?',
    scope: { kind: 'task' },
    trigger: '항상',
    writesTo: 'attrs.reworkRate · attrs.returnToItemId',
  },
  {
    id: 'p-task-handoff',
    text: '다음 사람한테 넘길 때 뭘 같이 줘야 하나요?',
    scope: { kind: 'task' },
    trigger: '다음 단계 담당자가 바뀔 때 — 인계 소켓 생성',
  },
  {
    id: 'p-task-missing-input',
    text: '이 앞 단계에서 정보가 빠져 오는 일이 얼마나 자주 있나요?',
    scope: { kind: 'task' },
    trigger: '담당자가 이전 단계와 다를 때',
  },
  {
    id: 'p-task-batch',
    text: '이거 여러 건을 몰아서 하세요, 아니면 건건이 하세요?',
    scope: { kind: 'task' },
    trigger: 'freqLast7d ≥ 10',
  },
  {
    id: 'p-task-artifact',
    text: '이 결과물, 어디에 저장하세요? 나중에 누가 찾나요?',
    scope: { kind: 'task' },
    trigger: '산출물 명사 감지(보고서·대장·시트)',
  },
];

export const BRANCH_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-branch-xor-share',
    text: '어느 갈래가 제일 흔한가요? 10번 중 몇 번?',
    scope: { kind: 'branch', mode: 'xor' },
    trigger: '갈래 비중 없이는 리드타임 추정이 무의미하다',
  },
  {
    id: 'p-branch-xor-else',
    text: '아무 갈래에도 안 맞는 경우는 어떻게 하세요?',
    scope: { kind: 'branch', mode: 'xor' },
  },
  {
    id: 'p-branch-and-bottleneck',
    text: '이 중에 하나만 늦어도 다음으로 못 넘어가나요?',
    scope: { kind: 'branch', mode: 'and' },
    trigger: 'AND 병목 식별',
  },
  {
    id: 'p-branch-and-really',
    text: '이 갈래들, 정말 동시에 하세요, 아니면 순서대로 하세요?',
    scope: { kind: 'branch', mode: 'and' },
  },
  {
    id: 'p-branch-skip-judge',
    text: '건너뛰는 조건을 누가 판단하나요? 판단이 틀리면 어떻게 되나요?',
    scope: { kind: 'branch', mode: 'skip' },
  },
  {
    id: 'p-branch-tacit',
    text: '판단 기준이 문서에 있나요, 아니면 경험으로 아시나요?',
    scope: { kind: 'branch', mode: 'any' },
    trigger: '암묵지 = 자동화 난이도 핵심 지표',
  },
];

export const HOLD_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-hold-approval-return',
    text: '반려되면 어디로 돌아가나요?',
    scope: { kind: 'hold', waitFor: 'approval' },
    trigger: '필수',
    writesTo: 'attrs.returnToItemId',
  },
  {
    id: 'p-hold-approval-ever',
    text: '최근 6개월에 실제로 반려된 적 있나요?',
    scope: { kind: 'hold', waitFor: 'approval' },
    followUp: { when: '없다', text: '그럼 이 확인은 왜 있나요?' },
    trigger: 'ECRS 제거 후보 자동 등록',
  },
  {
    id: 'p-hold-approval-absent',
    text: '결재자가 자리에 없으면(휴가·출장) 어떻게 하세요?',
    scope: { kind: 'hold', waitFor: 'approval' },
  },
  {
    id: 'p-hold-approval-nudge',
    text: '기다리는 동안 재촉을 몇 번 하세요? 어떤 방법으로요?',
    scope: { kind: 'hold', waitFor: 'approval' },
  },
  {
    id: 'p-hold-reply-timeout',
    text: '답이 안 오면 며칠 기다리고, 그다음엔 뭘 하세요?',
    scope: { kind: 'hold', waitFor: 'reply' },
    writesTo: 'attrs.timeoutH',
  },
  {
    id: 'p-hold-reply-external',
    text: '상대가 회사 밖 사람인가요?',
    scope: { kind: 'hold', waitFor: 'reply' },
    trigger: '외부 대기는 리드타임 리스크 등급이 다르다',
  },
  {
    id: 'p-hold-reply-contact',
    text: '재촉할 때 연락처를 어디서 찾으세요?',
    scope: { kind: 'hold', waitFor: 'reply' },
  },
  {
    id: 'p-hold-time-miss',
    text: '그 시각을 놓치면 어떻게 되나요? 다음 기회는 언제인가요?',
    scope: { kind: 'hold', waitFor: 'time' },
  },
  {
    id: 'p-hold-time-rush',
    text: '마감 직전에 몰려서 처리하게 되나요?',
    scope: { kind: 'hold', waitFor: 'time' },
  },
  {
    id: 'p-hold-resource-notice',
    text: '그게 언제 오는지 어떻게 아세요? 알림이 오나요, 직접 확인하세요?',
    scope: { kind: 'hold', waitFor: 'resource' },
  },
  {
    id: 'p-hold-resource-block',
    text: '기다리는 동안 다른 일로 넘어갈 수 있나요, 아니면 붙잡고 있어야 하나요?',
    scope: { kind: 'hold', waitFor: 'resource' },
  },
];

export const TOOL_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-tool-excel-version',
    text: '파일 버전이 꼬이면 어떻게 하세요?',
    scope: { kind: 'tool', toolIds: ['excel', 'sales-ledger'] },
    trigger: '최종_최종_v3 문제',
  },
  {
    id: 'p-tool-excel-share',
    text: '이 파일, 다른 사람도 열어야 하나요? 동시에 열면요?',
    scope: { kind: 'tool', toolIds: ['excel', 'sales-ledger'] },
  },
  {
    id: 'p-tool-excel-formula',
    text: '수식이 깨지거나 틀린 값이 들어간 걸 나중에 발견한 적 있나요?',
    scope: { kind: 'tool', toolIds: ['excel', 'sales-ledger'] },
  },
  {
    id: 'p-tool-sheets-permission',
    text: '권한 없는 사람이 요청하면 누가 열어주나요?',
    scope: { kind: 'tool', toolIds: ['google-sheets'] },
  },
  {
    id: 'p-tool-hwp-open',
    text: '상대방이 hwp를 못 열면 어떻게 하세요?',
    scope: { kind: 'tool', toolIds: ['hwp'] },
  },
  {
    id: 'p-tool-mail-spam',
    text: '메일이 스팸으로 갔거나 못 받았다는 연락은 얼마나 자주 오나요?',
    scope: { kind: 'tool', toolIds: ['gmail', 'outlook', 'imap-mail'] },
  },
  {
    id: 'p-tool-mail-cc',
    text: '참조에 누구를 넣어야 하는지 어떻게 아세요? 빠뜨린 적 있나요?',
    scope: { kind: 'tool', toolIds: ['gmail', 'outlook', 'imap-mail'] },
  },
  {
    id: 'p-tool-slack-unseen',
    text: '그 채널을 아무도 안 봤을 때는 어떻게 하세요?',
    scope: { kind: 'tool', toolIds: ['slack', 'naver-works', 'jandi', 'ms-teams'] },
  },
  {
    id: 'p-tool-slack-rewrite',
    text: '여기서 결정된 걸 다른 데에 다시 적어야 하나요?',
    scope: { kind: 'tool', toolIds: ['slack', 'naver-works', 'jandi', 'ms-teams'] },
  },
  {
    id: 'p-tool-kakao-rewrite',
    text: '회사 시스템에도 같은 내용을 다시 적으세요?',
    scope: { kind: 'tool', toolIds: ['kakaotalk'] },
  },
  {
    id: 'p-tool-kakao-search',
    text: '이 대화, 나중에 찾아봐야 할 일이 생기나요? 어떻게 찾으세요?',
    scope: { kind: 'tool', toolIds: ['kakaotalk'] },
  },
  {
    id: 'p-tool-phone-record',
    text: '통화 내용을 어딘가에 기록하세요? 안 하면 나중에 어떻게 되나요?',
    scope: { kind: 'tool', toolIds: ['phone', 'callcenter'] },
  },
  {
    id: 'p-tool-phone-noanswer',
    text: '상대가 전화를 안 받으면 몇 번 더 걸고, 그다음엔요?',
    scope: { kind: 'tool', toolIds: ['phone', 'callcenter'] },
  },
  {
    id: 'p-tool-erp-prewrite',
    text: 'ERP에 넣기 전에 다른 데(엑셀·메일)에 먼저 적어두세요?',
    scope: { kind: 'tool', toolIds: ['douzone-erp', 'ecount', 'younglimwon', 'sap', 'gyeongrinara'] },
  },
  {
    id: 'p-tool-erp-fix',
    text: '잘못 입력한 걸 고치려면 어떻게 하세요? 혼자 되나요?',
    scope: { kind: 'tool', toolIds: ['douzone-erp', 'ecount', 'younglimwon', 'sap', 'gyeongrinara'] },
  },
  {
    id: 'p-tool-groupware-line',
    text: '결재선을 매번 직접 지정하세요? 누구를 넣을지 어떻게 아세요?',
    scope: { kind: 'tool', toolIds: ['groupware-approval', 'douzone-wehago', 'daouoffice', 'hiworks', 'flow'] },
  },
  {
    id: 'p-tool-groupware-verbal-first',
    text: '급할 때 구두로 먼저 진행하고 결재는 나중에 올리는 경우가 있나요?',
    scope: { kind: 'tool', toolIds: ['groupware-approval', 'douzone-wehago', 'daouoffice', 'hiworks', 'flow'] },
  },
  {
    id: 'p-tool-cert-blocked',
    text: '인증서 때문에 막힌 적 있나요? 그럼 누가 해주나요?',
    scope: { kind: 'tool', toolIds: ['hometax', 'insurance4', 'cert', 'wetax'] },
  },
  {
    id: 'p-tool-hometax-wrong',
    text: '발행하고 나서 잘못된 걸 발견하면 어떻게 하세요?',
    scope: { kind: 'tool', toolIds: ['hometax', 'barobill', 'smartbill'] },
  },
  {
    id: 'p-tool-paper-original',
    text: '원본은 어디에 보관하나요? 잃어버린 적 있나요?',
    scope: { kind: 'tool', toolIds: ['paper', 'seal'] },
  },
  {
    id: 'p-tool-seal-absent',
    text: '도장 찍을 사람이 자리에 없으면 어떻게 하세요?',
    scope: { kind: 'tool', toolIds: ['paper', 'seal'] },
  },
  {
    id: 'p-tool-oral-forgot',
    text: '이걸 요청받았다는 걸 어디에도 안 적어두면, 잊어버린 적 있나요?',
    scope: { kind: 'tool', toolIds: ['oral-request'] },
  },
  {
    id: 'p-tool-courier-lost',
    text: '분실·파손이 나면 그때부터 뭘 하세요?',
    scope: { kind: 'tool', toolIds: ['courier'] },
  },
  {
    id: 'p-tool-channel-rules',
    text: '채널마다 규칙이 다른 부분이 있나요?',
    scope: { kind: 'tool', toolIds: ['smartstore', 'coupang-wing', 'cafe24', 'sabangnet'] },
  },
  {
    id: 'p-tool-cs-multichannel',
    text: '같은 고객이 다른 채널로도 문의하면 어떻게 알아채세요?',
    scope: { kind: 'tool', toolIds: ['channeltalk', 'zendesk', 'happytalk', 'callcenter'] },
  },
  {
    id: 'p-tool-crm-double-entry',
    text: '이 정보를 다른 곳에도 똑같이 적어야 하나요?',
    scope: { kind: 'tool', toolIds: ['salesforce', 'hubspot', 'sales-ledger', 'remember'] },
  },
  {
    id: 'p-tool-card-multi',
    text: '카드사가 여러 곳이면 각각 하시나요?',
    scope: { kind: 'tool', toolIds: ['card-web', 'crefia'] },
  },
];

/** 흐름 완성 직후. 전체 1회, **최대 2문항.** 3문항째부터는 설문이 된다 */
export const COMPLETION_PROMPTS: readonly ExceptionPrompt[] = [
  {
    id: 'p-done-worst-moment',
    text: '이 일 전체에서 제일 짜증나는 순간이 언제예요?',
    scope: { kind: 'completion' },
    trigger: '짜증 플래그를 놓친 단계 회수',
    writesTo: 'items.painFlag',
  },
  {
    id: 'p-done-substitute',
    text: '만약 누가 대신 이 일을 해야 한다면, 어디서 제일 헤맬 것 같아요?',
    scope: { kind: 'completion' },
    trigger: '암묵지 = 문서화 공백 = 자동화 난이도',
  },
  {
    id: 'p-done-n-people',
    text: '이 흐름, 당신 말고 몇 명이나 똑같이 하고 있나요?',
    scope: { kind: 'completion' },
    writesTo: 'N_people (Value 계산의 재사용 배수)',
  },
  {
    id: 'p-done-next-owner',
    text: '이 일 끝나고 나면 누구한테 넘어가나요?',
    scope: { kind: 'completion' },
    trigger: '인계 소켓 — 조직 조립의 조인 키',
  },
];

export const MAX_PROMPTS_PER_STEP = 1;
export const MAX_PROMPTS_ON_COMPLETION = 2;

export const EXCEPTION_PROMPTS: readonly ExceptionPrompt[] = [
  ...COMMON_PROMPTS,
  ...TASK_PROMPTS,
  ...BRANCH_PROMPTS,
  ...HOLD_PROMPTS,
  ...TOOL_PROMPTS,
  ...COMPLETION_PROMPTS,
];

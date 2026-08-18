/**
 * packages/doc-gen/src/__fixtures__/cases.ts
 *
 * §11.3 골든 픽스처 12건 중 §2.1·§3.3을 뺀 나머지.
 * 사람이 손으로 읽을 수 있게 작게 유지한다 — 스냅샷 파일은 아무도 안 읽는다.
 */

import type { FlowInput, Person, Step, Tool } from '../types.ts';
import type { VacationInput } from '../render/vacation.ts';

const asOf = { year: 2026, month: 8, day: 17 };

const P = (id: string, name: string, deptId: string): Person => ({
  id,
  name,
  team: `${deptId}팀`,
  deptId,
  channel: `슬랙 @${id}`,
});

const T = (id: string, name: string): Tool => ({ id, name });

function base(steps: readonly Step[], over: Partial<FlowInput> = {}): FlowInput {
  return {
    id: 'fx',
    title: '테스트 흐름',
    ownerId: 'a',
    asOf,
    people: [P('a', '김하나', '영업'), P('b', '이두리', '재무')],
    tools: [T('excel', '엑셀'), T('mail', '메일')],
    steps,
    cadence: { label: '매달 하는 일', tableLabel: '매달 1회' },
    ...over,
  };
}

/* ── 2. 메타데이터 0% — 제목만 14개 ─────────────────────────────────────
 * 담당 0%, 시간 0%, 도구 0%여도 만든다. **순서만 있어도 인계에는 쓸모가 있다.**
 * 검증 목표는 "문장이 하나도 안 깨진다" — WHO·TOOL·TIME이 전부 없으면
 * 문장을 만들지 않고 제목만 남겨야 한다 (§4.1 결합표 마지막 줄).
 */
export const TITLES_ONLY: FlowInput = base(
  Array.from({ length: 14 }, (_, i) => ({
    id: `t${i + 1}`,
    kind: 'task' as const,
    title: `${i + 1}번째로 하는 일을 적어둔 제목`,
  })),
  { people: [P('a', '김하나', '영업')], tools: [], cadence: undefined },
);

/* ── 3. 메타데이터 100% — 결핍 섹션이 생략된다 ────────────────────────── */
export const FULLY_FILLED: FlowInput = base(
  Array.from({ length: 6 }, (_, i) => ({
    id: `f${i + 1}`,
    kind: 'task' as const,
    title: `${i + 1}단계 빠짐없이 적어둔 일`,
    description: '무엇을 하는 일인지도 적어뒀어요.',
    assigneeId: 'a',
    toolIds: ['excel'],
    durationBand: '1h' as const,
  })),
  { tools: [T('excel', '엑셀')], people: [P('a', '김하나', '영업')] },
);

/* ── 5. 3단 중첩 갈래 — 본문에서 빼서 부록으로 ────────────────────────── */
export const NESTED_BRANCH: FlowInput = base([
  { id: 'n1', kind: 'task', title: '요청을 받아서 내용을 확인해요', assigneeId: 'a', durationBand: '15m' },
  { id: 'n2', kind: 'task', title: '금액이 맞는지 계산해서 봐요', assigneeId: 'a', durationBand: '1h' },
  {
    id: 'n3',
    kind: 'branch',
    title: '금액이 큰 건인가요',
    assigneeId: 'a',
    durationBand: '15m',
    branch: {
      mode: 'xor',
      weightKnown: true,
      cases: [
        {
          id: 'n3a',
          label: '큼',
          condition: '금액이 크면',
          steps: [
            {
              id: 'n3a1',
              kind: 'branch',
              title: '팀장님이 자리에 계신가요',
              assigneeId: 'a',
              branch: {
                mode: 'xor',
                weightKnown: true,
                cases: [
                  { id: 'n3a1x', label: '계심', condition: '계시면', joinToStepId: 'n4' },
                  { id: 'n3a1y', label: '안 계심', condition: '안 계시면', joinToStepId: 'n4' },
                ],
              },
            },
          ],
        },
        { id: 'n3b', label: '작음', condition: '금액이 작으면', joinToStepId: 'n4' },
      ],
    },
  },
  { id: 'n4', kind: 'task', title: '결과를 정리해서 보내드려요', assigneeId: 'a', durationBand: '1h' },
  { id: 'n5', kind: 'task', title: '보낸 내용을 기록으로 남겨요', assigneeId: 'a', durationBand: '15m' },
]);

/* ── 6. 루프 2개 겹침 — 문장 대신 목록으로만 ──────────────────────────── */
export const OVERLAPPING_LOOPS: FlowInput = base([
  { id: 'l1', kind: 'task', title: '자료를 모아서 한 곳에 둬요', assigneeId: 'a', durationBand: '1h' },
  { id: 'l2', kind: 'task', title: '숫자를 맞춰보고 표로 만들어요', assigneeId: 'a', durationBand: '1h' },
  { id: 'l3', kind: 'task', title: '팀장님께 보여드리고 얘기해요', assigneeId: 'a', durationBand: '15m' },
  {
    id: 'l4',
    kind: 'branch',
    title: '숫자가 맞나요',
    assigneeId: 'a',
    durationBand: '15m',
    branch: {
      mode: 'xor',
      weightKnown: true,
      cases: [
        { id: 'l4a', label: '맞음', condition: '맞으면', joinToStepId: 'l5' },
        { id: 'l4b', label: '안 맞음', condition: '안 맞으면', returnTo: { toStepId: 'l2' } },
      ],
    },
  },
  {
    id: 'l5',
    kind: 'branch',
    title: '팀장님이 다시 보자고 하셨나요',
    assigneeId: 'a',
    durationBand: '15m',
    branch: {
      mode: 'xor',
      weightKnown: true,
      cases: [
        { id: 'l5a', label: '아님', condition: '아니면', joinToStepId: 'l6' },
        { id: 'l5b', label: '다시 봄', condition: '다시 보자고 하시면', returnTo: { toStepId: 'l3' } },
      ],
    },
  },
  { id: 'l6', kind: 'task', title: '확정해서 보관함에 넣어요', assigneeId: 'a', durationBand: '15m' },
]);

/* ── 7. 담당자 전원 동일 — 인계 블록 0개, 요약도 0번 ──────────────────── */
export const SINGLE_ASSIGNEE: FlowInput = base(
  Array.from({ length: 7 }, (_, i) => ({
    id: `s${i + 1}`,
    kind: 'task' as const,
    title: `${i + 1}번째 단계 제목을 적어요`,
    assigneeId: 'a',
    toolIds: ['excel'],
    durationBand: '1h' as const,
  })),
  { people: [P('a', '김하나', '영업')] },
);

/* ── 8. 담당자 8명 — 인계 블록 수 = 요약 숫자 ─────────────────────────── */
const EIGHT = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const EIGHT_ASSIGNEES: FlowInput = base(
  EIGHT.map((id, i) => ({
    id: `e${i + 1}`,
    kind: 'task' as const,
    title: `${i + 1}번째 사람이 맡아서 하는 일`,
    assigneeId: id,
    toolIds: ['excel'],
    durationBand: '1h' as const,
    handoffPayload: '앞 단계에서 만든 표',
  })),
  { people: EIGHT.map((id, i) => P(id, `사람${i + 1}`, `d${i}`)) },
);

/* ── 9. 단계 4개 — 생성 거부 + 대안 제시 ──────────────────────────────── */
export const TOO_FEW: FlowInput = base([
  { id: 'x1', kind: 'task', title: '요청을 받아서 확인해요', assigneeId: 'a' },
  { id: 'x2', kind: 'task', title: '금액을 계산해서 적어요', assigneeId: 'a' },
  { id: 'x3', kind: 'task', title: '결과를 정리해서 보내요', assigneeId: 'a' },
  { id: 'x4', kind: 'task', title: '보낸 것을 기록해둬요', assigneeId: 'a' },
]);

/* ── 9b. 제목 평균 8자 미만 ───────────────────────────────────────────── */
export const SHORT_TITLES: FlowInput = base(
  ['접수', '확인', '발송', '기록', '마감', '정리'].map((t, i) => ({
    id: `q${i + 1}`,
    kind: 'task' as const,
    title: t,
    assigneeId: 'a',
  })),
);

/* ── 9c. 갈래 라벨 전무 ───────────────────────────────────────────────── */
export const NO_CASE_LABELS: FlowInput = base([
  { id: 'b1', kind: 'task', title: '요청을 받아서 내용을 확인해요', assigneeId: 'a' },
  { id: 'b2', kind: 'task', title: '금액이 맞는지 계산해서 봐요', assigneeId: 'a' },
  {
    id: 'b3',
    kind: 'branch',
    title: '여기서 경우가 갈려요',
    assigneeId: 'a',
    branch: {
      mode: 'xor',
      cases: [
        { id: 'b3a', joinToStepId: 'b4' },
        { id: 'b3b', joinToStepId: 'b4' },
      ],
    },
  },
  { id: 'b4', kind: 'task', title: '결과를 정리해서 보내드려요', assigneeId: 'a' },
  { id: 'b5', kind: 'task', title: '보낸 내용을 기록으로 남겨요', assigneeId: 'a' },
]);

/* ── 11. 부재 3일 / 2주 / 5주 ─────────────────────────────────────────── */
export function vacationOf(days: number): VacationInput {
  return {
    ownerId: 'a',
    standInId: 'b',
    people: [P('a', '김하나', '영업'), P('b', '이두리', '재무')],
    span: { year: 2026, fromLabel: '9월 1일 화요일', toLabel: '9월 3일 목요일', days },
    mustDo: [
      { when: '9월 2일 수요일', title: '대금 지급', body: '목록을 만들어 팀장님께 드리면 돼요.', durationLabel: '1시간' },
    ],
    justReceive: [{ title: '거래처 회신', body: '받아만 두시면 돼요.' }],
    skip: [{ title: '주간 리스트', body: '한 주 건너뛰어도 괜찮아요.' }],
    contacts: [{ situation: '이체', personId: 'b' }],
  };
}

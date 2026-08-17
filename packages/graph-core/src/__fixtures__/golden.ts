/**
 * packages/graph-core/src/__fixtures__/golden.ts
 *
 * §9 골든 픽스처.
 *
 * **이 파일이 변환 규칙의 진짜 명세다.** 산문은 애매해질 수 있지만 픽스처는 못 한다.
 * §3에서 확정한 애매 케이스가 전부 여기 하나씩 대응된다.
 *
 * 읽는 법
 *   ascii        — 사용자가 왼쪽 아웃라인에 쓴 것과, 오른쪽에 그려져야 하는 것
 *   expectEdges  — `source -reason(label)-> target`. `=>`는 명시적 엣지, `↺`는 back edge
 *   expectDiag   — 어떤 복구가 어떤 코드로 일어났는가
 *   expectMetrics— 점(.)으로 중첩 접근. 숫자는 소수 4자리 반올림
 *
 * 픽스처가 깨지면 둘 중 하나다.
 *   (1) 규칙을 바꿨다 → 픽스처를 고치고 §3 표도 같이 고친다
 *   (2) 규칙이 깨졌다 → 코드를 고친다
 * 리뷰에서 이 둘을 구분할 수 있게 하는 것이 이 파일의 유일한 목적이다.
 */

import type { DeriveOptions, Edge, Item } from '../types.ts';
import { build, explicit, kase, suppress, type Spec } from './builder.ts';

export type Fixture = {
  name: string;
  /** §3의 어느 케이스를 고정하는가 */
  covers?: string;
  ascii: string;
  items: Item[];
  edges: Edge[];
  options?: DeriveOptions;
  expectNodes?: string[];
  expectEdges: string[];
  expectDiagnostics?: string[];
  /** 'leadTimeH.value' 같은 점 경로 → 기대값 */
  expectMetrics?: Record<string, unknown>;
};

const hour = (id: string, extra: Partial<Spec> = {}): Spec => ({
  id,
  durationBand: '1h',
  ...extra,
});

export const fixtures: Fixture[] = [
  /* ──────────────────────────────────────────────────────────────────────
   * 01. 빈 문서
   * ────────────────────────────────────────────────────────────────────── */
  {
    name: '01 · 빈 문서',
    covers: 'A10 (아무것도 없음)',
    ascii: `
      아웃라인: (비어 있음)

      ┌───────┐
      │ 시작  │
      └───┬───┘
          │
      ┌───┴───┐
      │  끝   │
      └───────┘
      빈 문서도 완결된 작은 문서로 보여야 한다 (DESIGN §6.8).
    `,
    items: [],
    edges: [],
    expectNodes: [
      "start:start",
      "end:end",
    ],
    expectEdges: [
      "start -start-> end",
    ],
    expectDiagnostics: [],
    expectMetrics: { stepCount: 0, 'leadTimeH.value': 0, 'leadTimeH.coverage': 1 },
  },

  /* 02. 단계 1개 */
  {
    name: '02 · 루트에 단계 1개',
    covers: 'A9 (단계 1개)',
    ascii: `
      1. 문의 접수

      시작 → [문의 접수] → 끝
    `,
    items: build([{ id: 'a', title: '문의 접수' }]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
    ],
    expectMetrics: { stepCount: 1, maxDepth: 1 },
  },

  /* 03. 순차 3단계 */
  {
    name: '03 · 형제 3단계는 순차 연결',
    covers: '규칙 (a)',
    ascii: `
      1. 접수
      2. 확인
      3. 회신

      시작 → [접수] → [확인] → [회신] → 끝
    `,
    items: build([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "c:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -sequence-> c",
      "c -end-> end",
    ],
    expectMetrics: { stepCount: 3, edgeCount: 4 },
  },

  /* 04. XOR 2갈래, 둘 다 이어짐, 뒤에 형제 있음 */
  {
    name: '04 · XOR 분기 2갈래 · 둘 다 이어짐 · 다음 형제 있음',
    covers: '규칙 (b)(c) 기본형',
    ascii: `
      1. 접수
      2. ◇ 내용 분류
           ┃ 만약 [단순 문의] 라면 → 즉시 답변
           ┃ 아니면 [복잡 문의] 라면 → 팀장 문의 → 답변
      3. CRM 기록

                  [접수]
                     │
                 ◇ 내용 분류
            단순 ┌────┴────┐ 복잡
           [즉시답변]   [팀장문의]
                 │          │
                 │      [답변]
                 └────┬─────┘
                 [CRM 기록]
      합류 노드를 만들지 않는다 — XOR 합류는 동기화가 아니라 그냥 "같은 곳으로 간다"이다.
    `,
    items: build([
      { id: 'a', title: '접수' },
      {
        id: 'br',
        kind: 'branch',
        title: '내용 분류',
        children: [
          kase('단순', [{ id: 's1', title: '즉시 답변' }]),
          kase('복잡', [{ id: 'c1', title: '팀장 문의' }, { id: 'c2', title: '답변' }]),
        ],
      },
      { id: 'z', title: 'CRM 기록' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "br:branch",
      "s1:task",
      "c1:task",
      "c2:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> br",
      "br -branch-case(단순)-> s1",
      "br -branch-case(복잡)-> c1",
      "s1 -case-join-> z",
      "c1 -sequence-> c2",
      "c2 -case-join-> z",
      "z -end-> end",
    ],
    expectMetrics: { branchCount: 1, caseCount: 2, stepCount: 5 },
  },

  /* 05. 분기가 문서의 마지막 형제 */
  {
    name: '05 · 분기가 마지막 형제 (합류할 다음 형제가 없음)',
    covers: 'A6',
    ascii: `
      1. 접수
      2. ◇ 분류
           ┃ [A] → 처리A
           ┃ [B] → 처리B
      (뒤에 아무것도 없음)

      갈래의 끝은 end로 간다. end가 곧 합류점이다.
    `,
    items: build([
      { id: 'a' },
      {
        id: 'br',
        kind: 'branch',
        children: [kase('A', [{ id: 'pa' }]), kase('B', [{ id: 'pb' }])],
      },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "br:branch",
      "pa:task",
      "pb:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> br",
      "br -branch-case(A)-> pa",
      "br -branch-case(B)-> pb",
      "pa -end-> end",
      "pb -end-> end",
    ],
  },

  /* 06. joinBehavior가 갈래마다 다름 */
  {
    name: '06 · 갈래마다 joinBehavior가 다름 (하나는 continue, 하나는 end)',
    covers: 'A7 (부분)',
    ascii: `
      1. ◇ 심사
           ┃ [통과] → 발송        ○ 이어짐
           ┃ [반려] → 사유 안내    ● 여기서 끝
      2. 정산

      통과 갈래만 [정산]으로 합류하고, 반려 갈래는 end로 빠진다.
      두 동작이 한 분기 안에 공존하는 것이 정상이다 — 실무에서 가장 흔한 모양이다.
    `,
    items: build([
      {
        id: 'br',
        kind: 'branch',
        title: '심사',
        children: [
          kase('통과', [{ id: 'ok' }]),
          kase('반려', [{ id: 'ng' }], { joinBehavior: 'end' }),
        ],
      },
      { id: 'z', title: '정산' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "br:branch",
      "ok:task",
      "ng:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> br",
      "br -branch-case(통과)-> ok",
      "br -branch-case(반려)-> ng",
      "ok -case-join-> z",
      "ng -end-> end",
      "z -end-> end",
    ],
  },

  /* 07. 모든 갈래가 end인데 뒤에 형제가 있음 */
  {
    name: '07 · 모든 갈래가 "여기서 끝"인데 뒤에 형제가 있음',
    covers: 'A7 (핵심)',
    ascii: `
      1. ◇ 판정
           ┃ [승인] → 발송   ● 여기서 끝
           ┃ [거절] → 안내   ● 여기서 끝
      2. 월말 집계        ← 이 단계로 오는 길이 없다

                    ◇ 판정
              승인 ┌──┴──┐ 거절
             [발송]      [안내]
                │           │
               끝          끝
                │
        ◇ 판정 ┄┄fallthrough┄┄→ [월말 집계] → 끝

      확정 규칙: 고립시키지 않는다. 분기 노드에서 직접 잇는다.
      근거 — 문서를 위에서 아래로 읽는 사람에게 "분기 뒤에 적은 것"은
             "그 다음에 일어나는 것"이다. 두 의도가 충돌하면 **연결된 쪽**을 택한다.
             떠 있는 노드는 사용자에게 "고장"으로 읽히고, 그 판단은 되돌릴 수 없다.
    `,
    items: build([
      {
        id: 'br',
        kind: 'branch',
        title: '판정',
        children: [
          kase('승인', [{ id: 'ok' }], { joinBehavior: 'end' }),
          kase('거절', [{ id: 'ng' }], { joinBehavior: 'end' }),
        ],
      },
      { id: 'z', title: '월말 집계' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "br:branch",
      "ok:task",
      "ng:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> br",
      "br -branch-case(승인)-> ok",
      "br -branch-case(거절)-> ng",
      "br -fallthrough-> z",
      "ok -end-> end",
      "ng -end-> end",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:all-cases-end-with-successor",
    ],
  },

  /* 08. 빈 갈래 */
  {
    name: '08 · 빈 갈래 (조건만 적고 단계를 안 적음)',
    covers: 'A2',
    ascii: `
      1. ◇ 재고 확인
           ┃ [있음]            ← 아무것도 안 적음
           ┃ [없음] → 발주
      2. 출고

                ◇ 재고 확인
         있음 ┌────┴────┐ 없음
              │      [발주]
              └────┬────┘
                [출고]

      확정 규칙: 빈 상자를 만들지 않는다. 조건 라벨이 붙은 **통과 엣지**가 된다.
      근거 — 빈 노드를 그리면 사용자는 "내가 뭘 빠뜨렸다"고 읽는다.
             실제로는 "그 경우엔 아무것도 안 한다"가 완결된 의미다.
    `,
    items: build([
      {
        id: 'br',
        kind: 'branch',
        title: '재고 확인',
        children: [kase('있음'), kase('없음', [{ id: 'po', title: '발주' }])],
      },
      { id: 'z', title: '출고' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "br:branch",
      "po:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> br",
      "br -branch-case(있음)-> z",
      "br -branch-case(없음)-> po",
      "po -case-join-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:empty-case",
    ],
  },

  /* 09. 갈래가 1개뿐인 분기 */
  {
    name: '09 · 갈래가 1개뿐인 분기',
    covers: 'A3',
    ascii: `
      1. ◇ 확인
           ┃ [문제 있음] → 수정
      2. 발송

      ◇ 확인 ─문제 있음→ [수정] → [발송]

      확정 규칙: 노드를 없애지 않는다. 위상은 "라벨 붙은 사슬"이 된다.
      근거 — (1) 사용자가 두 번째 갈래를 지금 쓰는 중일 수 있다
             (2) 노드를 없애면 그 ID가 사라져 코멘트·좌표·접기 상태가 날아간다
             (3) 조건 라벨은 정보다. 사슬로 접어도 라벨은 살아야 한다
      note 진단만 남기고 그림은 바꾸지 않는다.
    `,
    items: build([
      {
        id: 'br',
        kind: 'branch',
        title: '확인',
        children: [kase('문제 있음', [{ id: 'fx', title: '수정' }])],
      },
      { id: 'z', title: '발송' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "br:branch",
      "fx:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> br",
      "br -branch-case(문제 있음)-> fx",
      "fx -case-join-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:branch-single-case",
      "note:duration-missing",
    ],
  },

  /* 10. 분기에 자식이 없음 */
  {
    name: '10 · 분기 노드에 자식이 없음',
    covers: 'A8',
    ascii: `
      1. 접수
      2. ◇ (방금 만들고 아직 안 채움)
      3. 발송

      [접수] → ◇(빈 분기) → [발송]

      확정 규칙: 일반 단계로 강등해 이어붙인다. 노드는 남긴다.
      근거 — 분기를 만든 직후 0.5초 동안 반드시 이 상태를 지난다.
             그 순간 그림이 끊기면 "이 도구 이상하다"가 된다.
    `,
    items: build([{ id: 'a' }, { id: 'br', kind: 'branch', title: '' }, { id: 'z' }]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "br:branch",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> br",
      "br -sequence-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:branch-without-case",
    ],
  },

  /* 11. 중첩 분기 */
  {
    name: '11 · 중첩 분기 (갈래 안에 또 갈래)',
    covers: 'A1',
    ascii: `
      1. ◇ 1차 분류
           ┃ [국내] → 국내처리
           ┃ [해외] → ◇ 2차 분류
                        ┃ [소액] → 소액처리
                        ┃ [고액] → 고액처리
      2. 정산

                 ◇ 1차 분류
          국내 ┌──────┴──────┐ 해외
        [국내처리]      ◇ 2차 분류
             │       소액 ┌─┴─┐ 고액
             │      [소액]   [고액]
             └────────┴───┬───┘
                       [정산]

      확정 규칙: "갈래의 마지막 단계"는 **재귀적으로** 정의된다.
        lastOf(갈래) = 그 갈래 본문 시퀀스의 열린 끝 집합(tails)
      중첩 분기의 tails는 안쪽 갈래들의 tails 합집합이다. 안쪽이 몇 겹이든 같다.
      역할은 kind가 아니라 위치로 정해진다(교대 규칙): 분기의 자식은 갈래,
      갈래의 자식은 본문 단계, 본문 단계가 분기면 그 자식이 다시 갈래.
    `,
    items: build([
      {
        id: 'b1',
        kind: 'branch',
        title: '1차 분류',
        children: [
          kase('국내', [{ id: 'dm' }]),
          kase('해외', [
            {
              id: 'b2',
              kind: 'branch',
              title: '2차 분류',
              children: [kase('소액', [{ id: 'sm' }]), kase('고액', [{ id: 'lg' }])],
            },
          ]),
        ],
      },
      { id: 'z', title: '정산' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "b1:branch",
      "dm:task",
      "b2:branch",
      "sm:task",
      "lg:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> b1",
      "b1 -branch-case(국내)-> dm",
      "b1 -branch-case(해외)-> b2",
      "dm -case-join-> z",
      "b2 -branch-case(소액)-> sm",
      "b2 -branch-case(고액)-> lg",
      "sm -case-join-> z",
      "lg -case-join-> z",
      "z -end-> end",
    ],
  },

  /* 12. 갈래의 마지막이 hold */
  {
    name: '12 · 갈래의 마지막이 기다림(hold)',
    covers: 'A5',
    ascii: `
      1. ◇ 금액
           ┃ [소액] → 즉시 지급
           ┃ [고액] → ⏸ 팀장 승인 대기
      2. 회계 처리

      확정 규칙: hold도 그냥 단계다. 특별 취급하지 않는다.
      근거 — "승인 대기 뒤에는 승인/반려 두 갈래가 있어야 한다"는 것은 BPMN의
             사고방식이다. 사용자가 반려 경로를 안 적었다면 그 사람의 업무에는
             반려가 드물거나 별도 흐름이다. 없는 갈래를 지어내지 않는다.
             (반려를 끌어내는 것은 문법이 아니라 질문의 일이다 — PRD §4.6)
      리드타임에서는 hold의 avgWaitH가 그대로 더해진다.
    `,
    items: build([
      {
        id: 'br',
        kind: 'branch',
        title: '금액',
        children: [
          kase('소액', [hour('pay')]),
          kase('고액', [
            { id: 'wt', kind: 'hold', title: '팀장 승인 대기', attrs: { waitFor: 'approval', avgWaitH: 24 } },
          ]),
        ],
      },
      { id: 'z', title: '회계 처리' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "br:branch",
      "pay:task",
      "wt:hold",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> br",
      "br -branch-case(소액)-> pay",
      "br -branch-case(고액)-> wt",
      "pay -case-join-> z",
      "wt -case-join-> z",
      "z -end-> end",
    ],
    expectMetrics: { holdCount: 1, 'waitH.value': 12 },
  },

  /* 13. 갈래의 마지막이 또 다른 분기 */
  {
    name: '13 · 갈래의 마지막 단계가 또 다른 분기',
    covers: 'A4',
    ascii: `
      1. ◇ 유형
           ┃ [A] → 처리A
           ┃ [B] → 사전작업 → ◇ 세부
                                 ┃ [B1] → 처리B1
                                 ┃ [B2] → 처리B2
      2. 종료 보고

      확정 규칙: 안쪽 분기의 모든 열린 끝이 바깥 합류점으로 간다.
      "마지막 단계 하나"가 아니라 **열린 끝의 집합**이라는 정의가 여기서 값을 한다.
    `,
    items: build([
      {
        id: 'b1',
        kind: 'branch',
        title: '유형',
        children: [
          kase('A', [{ id: 'pa' }]),
          kase('B', [
            { id: 'pre', title: '사전작업' },
            {
              id: 'b2',
              kind: 'branch',
              title: '세부',
              children: [kase('B1', [{ id: 'p1' }]), kase('B2', [{ id: 'p2' }])],
            },
          ]),
        ],
      },
      { id: 'z', title: '종료 보고' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "b1:branch",
      "pa:task",
      "pre:task",
      "b2:branch",
      "p1:task",
      "p2:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> b1",
      "b1 -branch-case(A)-> pa",
      "b1 -branch-case(B)-> pre",
      "pa -case-join-> z",
      "pre -sequence-> b2",
      "b2 -branch-case(B1)-> p1",
      "b2 -branch-case(B2)-> p2",
      "p1 -case-join-> z",
      "p2 -case-join-> z",
      "z -end-> end",
    ],
  },

  /* 14. AND 2갈래 */
  {
    name: '14 · 동시(AND) 분기 2갈래 → 합류 노드 실체화',
    covers: '§6',
    ascii: `
      1. ◇ 동시에 진행 (mode: and)
           ┃ [계약서 검토] → 법무 검토
           ┃ [견적 검토]   → 재무 검토
      2. 계약 체결

                ◇ 동시에 진행
                ┌─────┴─────┐
          [법무 검토]   [재무 검토]
                └─────┬─────┘
              ◆ join:sync   ← 실체화된 동기화 지점
                      │
                [계약 체결]

      XOR과 달리 합류 노드를 **만든다.** 이유는 그림이 아니라 숫자다:
      "모두 끝나야 다음"이라는 동기화 지점이 없으면 max(각 갈래)를 계산할 자리가 없다.
    `,
    items: build([
      {
        id: 'sync',
        kind: 'branch',
        title: '동시에 진행',
        attrs: { mode: 'and' },
        children: [
          kase('계약서', [hour('legal', { title: '법무 검토' })]),
          kase('견적', [hour('fin', { title: '재무 검토' })]),
        ],
      },
      { id: 'z', title: '계약 체결' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "sync:branch",
      "legal:task",
      "fin:task",
      "join:sync:join",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> sync",
      "sync -and-fork(계약서)-> legal",
      "sync -and-fork(견적)-> fin",
      "legal -and-join-> join:sync",
      "fin -and-join-> join:sync",
      "join:sync -join-out-> z",
      "z -end-> end",
    ],
    expectMetrics: {
      'touchH.value': 2, // 실접촉시간 = 합
      'leadTimeH.value': 1, // 리드타임 = max
      'criticalPathH.value': 1,
    },
  },

  /* 15. AND 갈래 1개 */
  {
    name: '15 · mode:"and"인데 갈래가 1개',
    covers: 'A11',
    ascii: `
      1. ◇ 동시에 진행 (and)
           ┃ [검토] → 법무 검토
      2. 체결

      ◇ ─검토→ [법무 검토] → [체결]     (합류 노드 없음)

      확정 규칙: 합류 노드를 만들지 않는다.
      근거 — 동기화할 대상이 없다. max(단일) = sum(단일) 이라 숫자도 같다.
             노드를 만들면 사용자는 "왜 여기 마름모 같은 게 생겼지"만 얻는다.
    `,
    items: build([
      {
        id: 'sync',
        kind: 'branch',
        title: '동시에 진행',
        attrs: { mode: 'and' },
        children: [kase('검토', [{ id: 'legal' }])],
      },
      { id: 'z' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "sync:branch",
      "legal:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> sync",
      "sync -branch-case(검토)-> legal",
      "legal -case-join-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:branch-single-case",
      "note:duration-missing",
      "repaired:and-single-case",
    ],
  },

  /* 16. AND 일부 갈래만 end */
  {
    name: '16 · AND 갈래 중 하나만 "여기서 끝"',
    covers: 'A7 × §6',
    ascii: `
      1. ◇ 동시 (and)
           ┃ [본작업] → 처리     ○ 이어짐
           ┃ [알림]   → 슬랙알림 ● 여기서 끝
      2. 완료 보고

      확정 규칙: **'end'를 무시하고 합류시킨다.**
      근거 — 그대로 두면 합류 노드가 오지 않을 토큰을 영원히 기다리는 교착이 된다.
             교착은 그림으로 보이지 않는데 숫자(리드타임 ∞)로만 터진다 —
             가장 나쁜 종류의 조용한 실패다. 사용자 의도("이 갈래는 여기서 끝")와
             실행 가능성이 충돌하면 실행 가능한 쪽으로 복구하고 호버로 설명한다.
    `,
    items: build([
      {
        id: 'sync',
        kind: 'branch',
        attrs: { mode: 'and' },
        children: [
          kase('본작업', [{ id: 'main' }]),
          kase('알림', [{ id: 'noti' }], { joinBehavior: 'end' }),
        ],
      },
      { id: 'z' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "sync:branch",
      "main:task",
      "noti:task",
      "join:sync:join",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> sync",
      "sync -and-fork(본작업)-> main",
      "sync -and-fork(알림)-> noti",
      "main -and-join-> join:sync",
      "noti -and-join-> join:sync",
      "join:sync -join-out-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:and-case-end-ignored",
    ],
  },

  /* 17. AND 전부 end */
  {
    name: '17 · AND 갈래가 전부 "여기서 끝"',
    covers: 'A7 × §6',
    ascii: `
      1. ◇ 동시 (and)
           ┃ [정산] → 정산처리  ● 끝
           ┃ [보고] → 보고서    ● 끝
      (뒤에 형제 없음)

      전부 끝이면 교착이 아니다 — 합류 노드가 end로 나간다. 그대로 존중한다.
    `,
    items: build([
      {
        id: 'sync',
        kind: 'branch',
        attrs: { mode: 'and' },
        children: [
          kase('정산', [{ id: 's1' }], { joinBehavior: 'end' }),
          kase('보고', [{ id: 's2' }], { joinBehavior: 'end' }),
        ],
      },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "sync:branch",
      "s1:task",
      "s2:task",
      "join:sync:join",
      "end:end",
    ],
    expectEdges: [
      "start -start-> sync",
      "sync -and-fork(정산)-> s1",
      "sync -and-fork(보고)-> s2",
      "s1 -and-join-> join:sync",
      "s2 -and-join-> join:sync",
      "join:sync -end-> end",
    ],
  },

  /* 18. skip */
  {
    name: '18 · mode:"skip" — 조건부 건너뛰기의 정확한 의미',
    covers: 'A12',
    ascii: `
      1. 접수
      2. ◇ 부가세 대상? (skip)
           ┃ [대상] → 세금계산서 발행
      3. 발송

              [접수]
                 │
          ◇ 부가세 대상?
        대상 ┌───┴───┐ 해당 없음
      [세금계산서]    │
             └───┬───┘
              [발송]

      확정 규칙: **skip = XOR + 암묵적 "아무것도 안 함" 경로.**
        무엇을 건너뛰는가 → **그 분기에 매달린 갈래들**을 건너뛴다.
        (분기 뒤의 형제를 건너뛰는 것이 아니다. 그건 별개 개념이고,
         트리에 표현할 자리가 없으며, "건너뛰기"라는 단어를 사용자가 그렇게 쓰지 않는다)
      XOR과의 유일한 차이: 갈래 확률의 합이 1이 되도록 자동으로 else 하나가 붙는다.
      리드타임에서 skip 구간의 기대값은 max가 아니라 (1/k)·Σ 가 되고,
      갈래가 1개면 정확히 절반이 된다.
    `,
    items: build([
      { id: 'a', title: '접수' },
      {
        id: 'sk',
        kind: 'branch',
        title: '부가세 대상?',
        attrs: { mode: 'skip' },
        children: [kase('대상', [hour('tax', { title: '세금계산서 발행' })])],
      },
      { id: 'z', title: '발송' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "sk:branch",
      "tax:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> sk",
      "sk -branch-case(대상)-> tax",
      "sk -skip-else(해당 없음)-> z",
      "tax -case-join-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:branch-single-case",
    ],
    expectMetrics: { 'touchH.value': 0.5, 'criticalPathH.value': 1 },
  },

  /* 19. skip이 마지막 형제 */
  {
    name: '19 · skip 분기가 마지막 형제',
    covers: 'A12 × A6',
    ascii: `
      1. 처리
      2. ◇ 사후 확인 필요? (skip)
           ┃ [필요] → 확인

      [처리] → ◇ ─필요→ [확인] → 끝
                 └─해당 없음──────→ 끝
    `,
    items: build([
      { id: 'a' },
      {
        id: 'sk',
        kind: 'branch',
        attrs: { mode: 'skip' },
        children: [kase('필요', [{ id: 'chk' }])],
      },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "sk:branch",
      "chk:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> sk",
      "sk -branch-case(필요)-> chk",
      "sk -end(해당 없음)-> end",
      "chk -end-> end",
    ],
  },

  /* 20. self-loop */
  {
    name: '20 · 명시적 엣지가 자기 자신을 가리킴 (self-loop)',
    covers: 'A13',
    ascii: `
      1. 초안 작성
      2. 검수  ← "통과할 때까지 반복" (검수 → 검수)
      3. 발행

      [초안] → [검수]↻ → [발행]

      확정 규칙: **유지한다.** 버그가 아니라 실무 패턴이다.
      캔버스는 별도 엣지가 아니라 노드 우상단 ↻ 배지로 렌더한다
      (ELK layered의 self-loop 라우팅이 지저분하고, 260×76 카드 옆에서 소음이 된다).
      reworkRate가 있으면 기대 통과 횟수 1/(1−p)가 그 노드에만 곱해진다.
    `,
    items: build([
      { id: 'a', title: '초안 작성' },
      hour('b', { title: '검수', attrs: { reworkRate: 0.5 } }),
      { id: 'c', title: '발행' },
    ]),
    edges: [explicit('e1', 'b', 'b')],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "c:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -explicit=> b ↺",
      "b -sequence-> c",
      "c -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:cycle",
      "note:self-loop",
    ],
    expectMetrics: { cycleCount: 1, 'cycles.0.expectedExtraPasses': 1, 'touchH.value': 2 },
  },

  /* 21. dangling */
  {
    name: '21 · 명시적 엣지가 존재하지 않는 노드를 가리킴',
    covers: 'A14',
    ascii: `
      1. A
      2. B
      edges: B → ghost(삭제된 항목)

      [A] → [B] → 끝        (ghost 엣지는 그래프에 없다)

      확정 규칙: 그래프에서는 제외하되 **DB 행은 지우지 않는다.**
      근거 — tombstone 삭제라 복원이 가능하다. 행을 지우면 "삭제 취소"가
             연결까지 되살리지 못한다. 파생 엣지를 저장하지 않는 것과 같은 이유로
             오버라이드 행은 파생 결과와 무관하게 살아 있어야 한다.
    `,
    items: build([{ id: 'a' }, { id: 'b' }]),
    edges: [explicit('e1', 'b', 'ghost')],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:dangling-edge",
    ],
  },

  /* 22. suppressed가 실제 파생 엣지를 억제 */
  {
    name: '22 · suppressed 엣지가 파생 엣지를 억제',
    covers: '규칙 (d)',
    ascii: `
      1. A
      2. B
      3. C
      edges: suppress(A → B)

      시작 → [A]        [B] → [C] → 끝
              (막다른 끝)  (도달 불가)

      "이 자동 연결은 틀렸다"를 사용자가 말할 수 있는 유일한 수단이다.

      주의: 억제는 **파생이 끝난 뒤** 적용되는 오버레이라 재파생이 일어나지 않는다.
      그래서 A→B만 끊으면 A는 막다른 끝이 되고 B는 도달 불가가 된다 — 이것이
      억제의 순수 의미론이고, 진단 unreachable-node가 그 사실을 그대로 보고한다.
      실제 UI에서는 "선 끊기"가 항상 "다른 선 긋기"와 짝으로 일어나므로
      (역투영 §11의 disconnect + connect) 이 상태가 화면에 남지 않는다.
      **여기서 자동으로 A→C를 이어주지 않는 이유**: 사용자가 끊은 것을
      시스템이 다시 이으면, 사용자는 자기 조작이 무시당했다고 읽는다.
    `,
    items: build([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    edges: [suppress('s1', 'a', 'b')],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "c:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "b -sequence-> c",
      "c -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "note:unreachable-node",
    ],
  },

  /* 23. suppressed가 아무것도 억제하지 못함 */
  {
    name: '23 · suppressed 엣지가 파생되지 않은 엣지를 억제하려 함',
    covers: 'A15',
    ascii: `
      1. A
      2. B
      edges: suppress(A → C)      ← 그런 파생 엣지는 없다

      [A] → [B] → 끝              (아무 일도 일어나지 않는다)

      확정 규칙: no-op. 행은 유지한다.
      근거 — 순서를 되돌리면 그 파생 엣지가 다시 생기고, 그때 억제가 발효되어야 한다.
             억제 행을 GC하면 "되돌리기 → 다시 되돌리기"에서 사용자의 결정이 증발한다.
             (사용자가 명시적으로 정리를 누를 때만 청소 후보로 제시한다)
    `,
    items: build([{ id: 'a' }, { id: 'b' }]),
    edges: [suppress('s1', 'a', 'c')],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "note:suppress-noop",
    ],
  },

  /* 24. 사이클 */
  {
    name: '24 · 사이클 A→B→C→A (재작업 루프)',
    covers: 'A16 · §5',
    ascii: `
      1. 요청 작성
      2. 검토
      3. 승인 판정   (반려율 30%)
      edges: 승인 판정 → 요청 작성   ("반려되면 1번으로")

      [요청]→[검토]→[판정]→끝
        ↑              │
        └──── ↺ ───────┘

      확정 규칙: 사이클은 **정상이고 필수 기능**이다. 막지 않는다.
        레이아웃 : DFS로 결정적으로 back edge를 정하고 뒤집어서 ELK에 넘긴다.
                   ELK 자체 cycleBreaking에 맡기면 입력 순서에 따라 다른 엣지가
                   뒤집혀 레이아웃 점프가 난다 (D-024).
        리드타임 : 기하분포. E[통과 횟수] = 1/(1−p), E[추가 반복] = p/(1−p).
                   p는 0.95로 절단해 발산을 막는다.
        각 노드 1h · p=0.3 → 통과 1.4286회 → 실접촉 4.2857h (43% 증가)
    `,
    items: build([
      hour('a', { title: '요청 작성' }),
      hour('b', { title: '검토' }),
      hour('c', { title: '승인 판정', attrs: { reworkRate: 0.3 } }),
    ]),
    edges: [explicit('e1', 'c', 'a', '반려')],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "c:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -sequence-> c",
      "c -explicit(반려)=> a ↺",
      "c -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:cycle",
    ],
    expectMetrics: {
      cycleCount: 1,
      'cycles.0.expectedExtraPasses': 0.4286,
      'touchH.value': 4.2857,
      'leadTimeH.value': 4.2857,
    },
  },

  /* 25. 전부 tombstone */
  {
    name: '25 · 모든 단계가 삭제(tombstone)됨',
    covers: 'A10',
    ascii: `
      1. A (deletedAt)
      2. B (deletedAt)

      시작 → 끝

      빈 문서(픽스처 01)와 **완전히 같은 그래프**가 나와야 한다.
      "지웠는데 뭔가 남아 보이는" 상태를 만들지 않는다.
    `,
    items: build([
      { id: 'a', deleted: true },
      { id: 'b', deleted: true },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "end:end",
    ],
    expectEdges: [
      "start -start-> end",
    ],
    expectMetrics: { stepCount: 0, nodeCount: 2 },
  },

  /* 26. 고아 */
  {
    name: '26 · parentId가 존재하지 않는 항목을 가리킴 (고아)',
    covers: '전처리 복구',
    ascii: `
      1. A
      ?. B (parentId = 'nope')

      [A] → [B] → 끝        B를 루트 단계로 승격

      확정 규칙: 버리지 않는다. 루트로 올린다.
      근거 — 사용자가 쓴 문장이다. 부모가 나중에 동기화되면 다음 derive()에서
             원래 자리로 되돌아간다. 내용 손실은 되돌릴 수 없고 위치 오류는 되돌릴 수 있다.
    `,
    items: build([{ id: 'a' }, { id: 'b', parentIdOverride: 'nope' }]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:orphan-parent",
    ],
  },

  /* 27. 부모 사이클 */
  {
    name: '27 · 부모 참조가 순환 (a→b→a)',
    covers: '전처리 복구',
    ascii: `
      a.parentId = b, b.parentId = a

      확정 규칙: 사이클 내 **최소 ID**를 루트로 절단한다(결정적).
      그래프의 사이클(§5, 기능)과 트리의 사이클(데이터 손상)은 완전히 다른 것이다.
    `,
    items: [
      { id: 'a', parentId: 'b', sortKey: 'a0', kind: 'task', title: 'a', attrs: {} },
      { id: 'b', parentId: 'a', sortKey: 'a0', kind: 'task', title: 'b', attrs: {} },
    ],
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -subtree-> b",
      "b -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:parent-cycle",
      "repaired:task-with-children",
    ],
  },

  /* 28. 작업에 자식이 있음 */
  {
    name: '28 · task에 하위 항목이 있음 (문법상 없지만 데이터로는 온다)',
    covers: '전처리 복구',
    ascii: `
      1. 정산 준비
         1-1. 자료 수집
         1-2. 검산
      2. 마감

      [정산 준비] → [자료 수집] → [검산] → [마감]

      확정 규칙: 평탄화가 아니라 **하위 시퀀스로 이어붙인다.**
      근거 — 붙여넣기 파서·AI 초안·다른 도구에서 온 아웃라인은 실제로 이런 모양이다.
             "분기가 아닌 들여쓰기"의 가장 자연스러운 의미는 "그 안에서 이 순서로"다.
             (D-004로 Tab을 분기 문법에서 뺐기 때문에 이 해석이 안전해졌다)
    `,
    items: build([
      { id: 'a', title: '정산 준비', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'z', title: '마감' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "a1:task",
      "a2:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -subtree-> a1",
      "a1 -sequence-> a2",
      "a2 -sequence-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:task-with-children",
    ],
  },

  /* 29. 예약 ID 충돌 */
  {
    name: '29 · 항목 ID가 예약 네임스페이스와 충돌',
    covers: '§2 불변식 I3',
    ascii: `
      items: [ {id:'a'}, {id:'end'} ]

      [a] → 끝           id='end'인 항목은 그래프에서 제외

      UUID라면 구조적으로 불가능하지만, 마이그레이션·수기 시드·AI 생성에서는 온다.
      **예약 ID가 사용자 데이터에 밀려나면 start/end/join의 결정성이 통째로 무너진다.**
    `,
    items: build([{ id: 'a' }, { id: 'end' }]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "repaired:reserved-item-id",
    ],
  },

  /* 30. AND vs XOR 리드타임 대조 (a) */
  {
    name: '30 · [숫자] AND 병렬 — 리드타임 max, 실접촉 sum',
    covers: '§6 핵심 계산',
    ascii: `
      ◇ 동시 (and)
        ┃ [A] → 작업A (반나절 = 4h)
        ┃ [B] → 작업B (1h)

      리드타임      = max(4, 1) = 4h
      실접촉시간    = 4 + 1     = 5h
      최장 경로     = 4h

      **AND/XOR을 구분하지 않으면 리드타임이 5h로 계산된다 — 25% 과대.**
      갈래가 늘수록 오차가 누적되고, 이 숫자가 자동화 후보 랭킹을 만든다.
    `,
    items: build([
      {
        id: 'sync',
        kind: 'branch',
        attrs: { mode: 'and' },
        children: [
          kase('A', [{ id: 'wa', durationBand: 'halfday' }]),
          kase('B', [{ id: 'wb', durationBand: '1h' }]),
        ],
      },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "sync:branch",
      "wa:task",
      "wb:task",
      "join:sync:join",
      "end:end",
    ],
    expectEdges: [
      "start -start-> sync",
      "sync -and-fork(A)-> wa",
      "sync -and-fork(B)-> wb",
      "wa -and-join-> join:sync",
      "wb -and-join-> join:sync",
      "join:sync -end-> end",
    ],
    expectMetrics: {
      'leadTimeH.value': 4,
      'touchH.value': 5,
      'touchAllPathsH.value': 5,
      'criticalPathH.value': 4,
    },
  },

  /* 31. 같은 모양의 XOR 대조 */
  {
    name: '31 · [숫자] 같은 모양의 XOR — 리드타임 확률가중, 실접촉도 확률가중',
    covers: '§6 대조군',
    ascii: `
      ◇ 택1 (xor)
        ┃ [A] → 작업A (4h)
        ┃ [B] → 작업B (1h)

      기대 리드타임 = 0.5·4 + 0.5·1 = 2.5h
      기대 실접촉   = 0.5·4 + 0.5·1 = 2.5h
      최악(최장경로)= 4h
      모든 갈래 합  = 5h            ← 이것이 "AND/XOR 미구분"의 결과값

      같은 5시간짜리 그림이 AND면 리드타임 4h, XOR이면 2.5h다.
      요약 카드에는 기대값을, 시간 렌즈 헤더에는 최악값을 쓴다.
    `,
    items: build([
      {
        id: 'x',
        kind: 'branch',
        children: [
          kase('A', [{ id: 'wa', durationBand: 'halfday' }]),
          kase('B', [{ id: 'wb', durationBand: '1h' }]),
        ],
      },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "x:branch",
      "wa:task",
      "wb:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> x",
      "x -branch-case(A)-> wa",
      "x -branch-case(B)-> wb",
      "wa -end-> end",
      "wb -end-> end",
    ],
    expectMetrics: {
      'leadTimeH.value': 2.5,
      'touchH.value': 2.5,
      'touchAllPathsH.value': 5,
      'criticalPathH.value': 4,
    },
  },

  /* 32. 인계 추론 */
  {
    name: '32 · 담당자 forward-fill과 부서 간 인계 추론',
    covers: '§7 인계',
    ascii: `
      1. 요청서 작성   (담당: u1 / 영업)
      2. 검토          (담당 미지정 → 앞 단계와 같음 = u1)
      3. 승인          (담당: u2 / 재무)
      4. 지급          (담당: u2)

      인계 = 흘려보낸 담당자가 **바뀌는 지점** → 2→3 한 번, 부서도 다름
      도구 전환 = 앞뒤 단계의 도구 집합이 서로소인 지점 → 1→2 (excel→erp)

      핵심: assigneeId === null은 "모름"이 아니라 **"앞과 같음"**이다.
      메타 카드가 전원 "나"로 채우고 바뀌는 지점만 지정하게 하기 때문이다(PRD §4.5).
      그래서 forward-fill이 정확한 해석이고, 이게 "인계 지도"라는 해자의 근거다.
    `,
    items: build([
      { id: 'a', assigneeId: 'u1', toolIds: ['excel'] },
      { id: 'b', toolIds: ['erp'] },
      { id: 'c', assigneeId: 'u2', toolIds: ['erp'] },
      { id: 'd', assigneeId: 'u2', toolIds: ['erp'] },
    ]),
    edges: [],
    options: { directory: { u1: { deptId: 'sales' }, u2: { deptId: 'finance' } } },
    expectNodes: [
      "start:start",
      "a:task",
      "b:task",
      "c:task",
      "d:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> b",
      "b -sequence-> c",
      "c -sequence-> d",
      "d -end-> end",
    ],
    expectMetrics: {
      peopleCount: 2,
      handoffCount: 1,
      crossDepartmentHandoffCount: 1,
      toolSwitchCount: 1,
      toolCount: 2,
    },
  },

  /* 33. 명시적 엣지가 파생 엣지와 중복 + join 별칭 */
  {
    name: '33 · 명시적 엣지가 파생 엣지와 같은 (source,target) · join 별칭 해석',
    covers: 'A14 부수 · §2 별칭',
    ascii: `
      1. A
      2. ◇ 분기 (xor)
           ┃ [x] → X
           ┃ [y] → Y
      3. Z
      edges:
        explicit(A → 분기)        ← 이미 파생으로 존재
        explicit(join:분기 → Z)   ← XOR은 합류 노드를 만들지 않는다

      확정 규칙
        (1) 중복이면 **명시가 이긴다.** 호버 문구가 "자동으로 이어졌어요"가 아니라
            "직접 이으신 연결이에요"가 되어야 하기 때문이다. 위상은 그대로다.
        (2) join:{b}는 항상 **합법 주소**다. 실체화되지 않았으면 분기 노드로 해석한다.
            → 익스포터와 역투영이 "합류점"을 항상 지칭할 수 있다.
    `,
    items: build([
      { id: 'a' },
      {
        id: 'br',
        kind: 'branch',
        children: [kase('x', [{ id: 'x' }]), kase('y', [{ id: 'y' }])],
      },
      { id: 'z' },
    ]),
    edges: [explicit('e1', 'a', 'br'), explicit('e2', 'join:br', 'z')],
    expectNodes: [
      "start:start",
      "a:task",
      "br:branch",
      "x:task",
      "y:task",
      "z:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -explicit=> br",
      "br -branch-case(x)-> x",
      "br -branch-case(y)-> y",
      "br -explicit=> z",
      "x -case-join-> z",
      "y -case-join-> z",
      "z -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duration-missing",
      "note:explicit-duplicates-derived",
      "repaired:join-alias-unmaterialized",
    ],
  },

  /* 34. hold 대기시간 비중 */
  {
    name: '34 · 대기시간 총합과 리드타임 대비 비중',
    covers: '§7 대기 비중',
    ascii: `
      1. 신청서 작성        (15분)
      2. ⏸ 팀장 승인 대기   (avgWaitH 24, timeout 48)
      3. 처리               (15분)

      실접촉시간 = 0.25 + 0.25 = 0.5h
      대기시간   = 24h
      리드타임   = 24.5h
      대기 비중  = 24 / 24.5 ≈ 0.9796      ← 요약 카드의 단일 최고 임팩트 숫자

      "일은 30분인데 사흘 걸린다"를 한 줄로 만드는 지표.
      avgWaitH 미입력이면 waitFor별 기본값을 쓰고 **coverage가 함께 떨어진다.**
    `,
    items: build([
      { id: 'a', durationBand: '15m' },
      {
        id: 'w',
        kind: 'hold',
        title: '팀장 승인 대기',
        attrs: { waitFor: 'approval', avgWaitH: 24, timeoutH: 48 },
      },
      { id: 'b', durationBand: '15m' },
    ]),
    edges: [],
    expectNodes: [
      "start:start",
      "a:task",
      "w:hold",
      "b:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> a",
      "a -sequence-> w",
      "w -sequence-> b",
      "b -end-> end",
    ],
    expectMetrics: {
      'touchH.value': 0.5,
      'waitH.value': 24,
      'leadTimeH.value': 24.5,
      waitRatio: 0.98,
      'waitH.coverage': 1,
    },
  },

  /* 35. sortKey 충돌 */
  {
    name: '35 · sortKey 충돌 시 ID로 결정적 tie-break',
    covers: '동시 삽입',
    ascii: `
      두 항목이 같은 sortKey 'a0' (jittered index 충돌 확률 ≈ 1/47,000)

      [b] → [c] → 끝     ID 오름차순으로 결정적 정렬

      순서가 입력 배열 순서에 의존하면 같은 문서가 사람마다 다르게 그려진다.
      Yjs 병합 후 재계산에서 특히 위험하다.
    `,
    items: [
      { id: 'c', parentId: null, sortKey: 'a0', kind: 'task', title: 'c', attrs: {} },
      { id: 'b', parentId: null, sortKey: 'a0', kind: 'task', title: 'b', attrs: {} },
    ],
    edges: [],
    expectNodes: [
      "start:start",
      "b:task",
      "c:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> b",
      "b -sequence-> c",
      "c -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:duplicate-sort-key",
      "note:duration-missing",
    ],
  },

  /* 36. 통합 시나리오 */
  {
    name: '36 · 통합 — 중첩 + AND + hold + 루프 + 오버라이드',
    covers: '회귀 방지용 종합',
    ascii: `
      1. 견적 요청 접수
      2. ◇ 금액 (xor)
           ┃ [소액] → 즉시 승인
           ┃ [고액] → ◇ 동시 검토 (and)
                        ┃ [법무] → 법무 검토
                        ┃ [재무] → 재무 검토
                     → ⏸ 임원 승인 대기
      3. 계약 발송   (반려율 20%)
      edges: explicit(계약 발송 → 견적 요청 접수)

      한 문서에 §3의 규칙이 동시에 걸릴 때 서로를 깨지 않는지 확인한다.
    `,
    items: build([
      hour('intake', { title: '견적 요청 접수' }),
      {
        id: 'amt',
        kind: 'branch',
        title: '금액',
        children: [
          kase('소액', [hour('quick', { title: '즉시 승인' })]),
          kase('고액', [
            {
              id: 'par',
              kind: 'branch',
              title: '동시 검토',
              attrs: { mode: 'and' },
              children: [
                kase('법무', [hour('legal', { title: '법무 검토' })]),
                kase('재무', [{ id: 'fin', title: '재무 검토', durationBand: 'halfday' }]),
              ],
            },
            {
              id: 'exec',
              kind: 'hold',
              title: '임원 승인 대기',
              attrs: { waitFor: 'approval', avgWaitH: 24 },
            },
          ]),
        ],
      },
      hour('send', { title: '계약 발송', attrs: { reworkRate: 0.2 } }),
    ]),
    edges: [explicit('e1', 'send', 'intake', '반려')],
    expectNodes: [
      "start:start",
      "intake:task",
      "amt:branch",
      "quick:task",
      "par:branch",
      "legal:task",
      "fin:task",
      "join:par:join",
      "exec:hold",
      "send:task",
      "end:end",
    ],
    expectEdges: [
      "start -start-> intake",
      "intake -sequence-> amt",
      "amt -branch-case(소액)-> quick",
      "amt -branch-case(고액)-> par",
      "quick -case-join-> send",
      "par -and-fork(법무)-> legal",
      "par -and-fork(재무)-> fin",
      "legal -and-join-> join:par",
      "fin -and-join-> join:par",
      "join:par -join-out-> exec",
      "exec -case-join-> send",
      "send -explicit(반려)=> intake ↺",
      "send -end-> end",
    ],
    expectDiagnostics: [
      "note:assignee-missing",
      "note:cycle",
    ],
    expectMetrics: { cycleCount: 1, branchCount: 2, holdCount: 1 },
  },
];


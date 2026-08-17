# 기술 아키텍처

> 최종 갱신: 2026-08-17 · 상태: 초안 v0.1

---

## 0. 핵심 결정 — "아웃라인 vs 그래프"는 잘못 세운 이분법

루프·건너뛰기를 명시적 연결로 저장하기로 한 순간, 진실의 원천은 이미 **`(순서 있는 트리) + (명시적 엣지 집합)`** 둘의 합이다. 그래프는 그 둘로부터 계산되는 **순수 함수의 결과**다.

```
graph = derive(tree) ⊕ overrides
```

→ **아웃라인 우선 하이브리드**를 채택한다.

### 되돌리기 비싼 진짜 결정 2가지

**(1) 노드 아이덴티티를 위치에서 유도하지 말 것**

`node-1-2-3` 같은 경로 기반 ID는 이 제품을 죽인다. 아웃라인 항목이 생길 때 **클라이언트가 UUID를 발급**하고, 그래프 노드 ID = 아웃라인 항목 ID로 둔다. 이게 없으면 캔버스 위치 저장, 코멘트, 실행 이력, AI diff, Yjs 병합이 전부 불가능해진다.

자동 생성되는 합류/시작/종료 노드도 **결정적 ID**로 만든다 — 저장하지 않되 `join:{branchItemId}` 처럼 유도해서 리렌더 간 동일성을 보장.

**(2) `derive()`를 React·DB·브라우저에 의존하지 않는 순수 패키지로 분리할 것**

`packages/graph-core`에 두면 RSC·웹워커·미래의 n8n 익스포터·AI 검증기가 모두 같은 함수를 쓴다. 없으면 익스포터가 로직을 복제하게 된다.

### 양방향 편집은 나중에 "역투영"만 구현하면 된다

| 캔버스 조작 | 트리 연산 |
|---|---|
| 노드 드래그로 순서 변경 | 형제 `sort_key` 재발급 |
| 노드 삭제 | 항목 삭제 (자식 승격 정책 필요) |
| 두 노드 사이에 노드 추가 | 형제 삽입 |
| 임의의 엣지 긋기 | `edges` 오버라이드 삽입 |
| 파생 엣지 끊기 | `edges`에 `suppressed` 삽입 |

**"그래프를 SoT로" 가면 역방향이 훨씬 나쁘다.** 임의 그래프에는 정규적(canonical) 아웃라인이 없어서, 캔버스에서 엣지 하나 잘못 그으면 왼쪽 아웃라인이 통째로 재배열되는 참사가 난다. 비개발자 대상 제품에서 이건 치명적이다.

**v1 방침**: 캔버스는 읽기 전용 + 선택/포커스 동기화(노드 클릭 → 아웃라인 스크롤). 아키텍처는 열어두되 UI는 열지 않는다.

---

## 1. 스택

| 영역 | 선택 | 버전 |
|---|---|---|
| 프레임워크 | Next.js (App Router) | 15 |
| 언어 | TypeScript | |
| 캔버스 | `@xyflow/react` | 12.11.3 |
| 자동 레이아웃 | `elkjs` | 0.12.0 |
| 아웃라인 에디터 | `@blocknote/react` | 0.52.x (버전 핀 고정) |
| DB / ORM | Postgres + `drizzle-orm` | 0.44.x |
| 서버 액션 | `next-safe-action` | 8.x |
| 순서 인덱스 | `fractional-indexing-jittered` | |
| 스타일 | Tailwind + shadcn/ui (fork 4개) | |
| 상태 | Zustand + Immer | |
| 인증 | WorkOS AuthKit | |

Python은 넣지 않는다. 지금 넣으면 그래프 스키마를 TS/Python 이중 관리하는 비용만 생긴다. AI 단계에서 별도 서비스로 붙인다.

---

## 2. 데이터 모델

정수 `order`는 중간 삽입마다 형제 전체 UPDATE가 나가서 탈락. linked list는 SQL 정렬 불가로 탈락. → **fractional indexing**. Yjs 도입까지 고려하면 jittered 변형(동시 삽입 시 키 충돌 확률 ~1/47,000).

```ts
// db/schema.ts
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp,
         index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';

export const nodeKind = pgEnum('node_kind', ['task', 'branch', 'hold']);
export const edgeKind = pgEnum('edge_kind', ['explicit', 'suppressed']);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  title: text('title').notNull(),
  revision: integer('revision').notNull().default(0),   // 낙관적 동시성 토큰
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const items = pgTable('items', {
  id: uuid('id').primaryKey(),                          // ★ 클라이언트 발급
  docId: uuid('doc_id').notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),                          // self-FK, null = 루트
  // ★ base62 fractional index — 반드시 COLLATE "C" (아래 DDL 참조)
  sortKey: text('sort_key').notNull(),
  kind: nodeKind('kind').notNull().default('task'),
  title: text('title').notNull().default(''),

  // 조회·집계 대상은 컬럼으로, 나머지만 jsonb
  assigneeId: uuid('assignee_id'),                      // ★ 자유 텍스트 금지
  durationBand: text('duration_band'),                  // '1m'|'5m'|'15m'|'1h'|'halfday'|'1d+'
  freqLast7d: integer('freq_last_7d'),                  // "지난 7일 동안 몇 번"
  automationLevel: integer('automation_level'),         // 0..3
  painFlag: boolean('pain_flag').notNull().default(false),

  // 타입별 속성 (PRD §4.3)
  //  branch → { mode: 'xor'|'and'|'skip' }
  //  hold   → { waitFor: 'approval'|'reply'|'time'|'resource', avgWaitH, timeoutH }
  //  task   → { reworkRate, returnToItemId }
  attrs: jsonb('attrs').$type<Record<string, unknown>>().notNull().default({}),

  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),  // 신선도
  deletedAt: timestamp('deleted_at', { withTimezone: true }),               // tombstone
}, (t) => [
  uniqueIndex('items_sibling_order').on(t.docId, t.parentId, t.sortKey),
  index('items_doc_parent').on(t.docId, t.parentId),
]);

// 도구는 문자열 배열이 아니라 카탈로그 참조 — n8n 매핑이 join 한 번이 된다
export const tools = pgTable('tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  name: text('name').notNull(),
  n8nNodeType: text('n8n_node_type'),   // 'n8n-nodes-base.slack' — 지금은 비워둬도 자리는 잡는다
});

export const itemTools = pgTable('item_tools', {
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  toolId: uuid('tool_id').notNull().references(() => tools.id),
}, (t) => [uniqueIndex('item_tools_pk').on(t.itemId, t.toolId)]);

// 예외 엣지 + 파생 엣지 억제
export const edges = pgTable('edges', {
  id: uuid('id').primaryKey(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),   // items.id 또는 'join:{uuid}' / 'start' / 'end'
  targetId: text('target_id').notNull(),
  kind: edgeKind('kind').notNull().default('explicit'),
  label: text('label'),
}, (t) => [uniqueIndex('edges_unique').on(t.docId, t.sourceId, t.targetId, t.kind)]);
```

**반드시 붙일 DDL 한 줄** — Postgres 기본 collation(`en_US.UTF-8`)은 바이트 순서가 아니므로 없으면 정렬이 **조용히** 틀어진다.

```sql
ALTER TABLE items ALTER COLUMN sort_key TYPE text COLLATE "C";
```

### 파생 엣지는 저장하지 않는다

`derive()`가 O(n)이고 항목 수가 수백 단위라 계산이 저장·동기화보다 압도적으로 싸다. 저장하면 트리와 엣지가 어긋난 상태(split brain)를 영원히 관리해야 한다.

단 **레이아웃 좌표는 캐시로 저장**한다 — 최초 렌더 시 ELK를 기다리지 않기 위해서이고, 나중 캔버스 수동 배치의 착지점이다.

### 버전 관리 — 2단

행 단위 temporal 테이블은 과잉이다.

- **핫: `operations` 어펜드 로그** — `{docId, seq, actorId, op: {type, payload}, ts}`. undo/redo, 감사, 나중 Yjs 브리지, AI 초안의 "diff 검토 후 적용"이 전부 여기서 나온다
- **콜드: `snapshots`** — 명시적 저장 시점이나 N개 op마다 문서 전체 JSON. 복원은 스냅샷 + 이후 op 재생

---

## 3. 아웃라인 에디터 — BlockNote

**직접 구현 금지.** 근거 3가지:

1. **한국어 IME.** contenteditable 조합 입력은 ProseMirror가 10년 넘게 잡아온 지옥이다(Chrome 업데이트마다 회귀). ProseMirror → TipTap → BlockNote 스택은 이 처리를 상속받는다. Lexical도 IME는 좋지만 아웃라인 트리 + 커스텀 인라인 노드를 직접 다 짜야 한다
2. **블록에 이미 안정적 ID가 있다.** `block.id`를 그대로 `items.id`로 쓴다 — §0의 (1) 원칙이 공짜로 해결된다. Plate/TipTap 대비 결정적 이점
3. `createReactInlineContentSpec`으로 담당자·도구 칩, 기본 제공 슬래시 메뉴, Yjs 연동 내장

**리스크 완화**: 0.x라 API가 흔들린다 → **정확한 버전 핀 고정 + 어댑터 레이어**(`blockToItem` / `itemToBlock`). 도메인 SoT는 `items` 테이블이지 ProseMirror JSON이 아니다.

### 한국어 IME 함정 — 반드시 지킬 것

```ts
// 조합 중에는 절대 파생/리렌더를 트리거하지 않는다.
// 조합 중 React가 텍스트 노드를 교체하면 Chrome이 composition을 abort하고
// 조합 중이던 자모("한" → "ㅎ")가 통째로 사라진다.
const composingRef = useRef(false);

useEffect(() => {
  const dom = editor.prosemirrorView?.dom;
  const on  = () => { composingRef.current = true; };
  const off = () => { composingRef.current = false; scheduleDerive(); }; // ★ 여기서만
  dom?.addEventListener('compositionstart', on);
  dom?.addEventListener('compositionend', off);
  return () => {
    dom?.removeEventListener('compositionstart', on);
    dom?.removeEventListener('compositionend', off);
  };
}, [editor]);

editor.onChange(() => {
  if (composingRef.current || editor.prosemirrorView?.composing) return;
  scheduleDerive();
});
```

추가 규칙:
- **`keydown.key`로 로직을 짜지 말 것.** 한글 조합 중 `keyCode === 229`가 들어와 `/` 팔레트와 Enter 분기가 오작동한다. 슬래시 명령은 ProseMirror `inputRules` / BlockNote suggestion menu로, 들여쓰기는 ProseMirror 커맨드로
- **contenteditable에 React controlled `value`를 절대 걸지 말 것**
- **회귀 테스트 자동화** — Playwright + CDP `Input.imeSetComposition`으로 "한글 입력 → Enter → 마지막 글자 유실 없음"을 CI에. 이건 사람이 놓친다

---

## 4. 자동 레이아웃

ELK 옵션과 안정성 전략은 [DESIGN.md §6.5–6.6](./DESIGN.md)에 있다. 여기서는 구현 관점만.

**웹워커 오프로딩**

```ts
// lib/layout/elk.client.ts
import ELK from 'elkjs/lib/elk-api';

const elk = new ELK({
  workerFactory: () =>
    new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url)),
});
```

Next.js 15 Turbopack에서 이 `new URL(..., import.meta.url)` 형태가 동작한다. `'use client'` 모듈에서만 import하고 `dynamic(..., { ssr: false })`로 감싼다.

> **⚠️ 초안의 오류 정정**
> 이 자리에 원래 *"`semiInteractive: true`일 때 이전 좌표를 시드로 넣으면 앵커링의 1차 방어선이 된다"*고 적혀 있었다. **틀렸다.**
>
> `forceNodeModelOrder: true`가 층 내 노드 순서를 **모델 순서로 강제**하므로, `semiInteractive`의 좌표 힌트는 교차 최소화 단계에서 **아무것도 바꿀 수 없다.** 두 옵션은 함께 켤 때 후자가 전자를 지배한다.
> 즉 좌표 시드는 **출력에 영향을 주지 않는다** — 넣어도 안 넣어도 같은 결과가 나온다.
>
> **앵커링은 ELK 옵션이 아니라 ELK 결과를 받은 뒤의 뷰포트 역보정으로만 달성된다.** 구현은 [LAYOUT.md](./LAYOUT.md) §3.
> `elk.position`을 노드에 넣는 것을 **테스트로 금지**한다 — 효과가 없으면서 "뭔가 하고 있다"는 착각을 만들기 때문이다.

**dagre / d3-hierarchy를 쓰지 않는 이유**: dagre는 포트·계층 서브그래프·모델 순서 존중이 약하고, d3-hierarchy는 순수 트리 전용이라 자동 합류가 만드는 DAG를 못 그린다.

---

## 5. 성능

| 노드 수 | 상태 |
|---|---|
| ~200 | 문제 없음. ELK layered 50~150ms |
| ~500 | 두 군데서 동시에 무너짐 — ELK crossing minimization은 초선형(300ms~1.5s), React Flow는 노드가 DOM이라 커스텀 노드 1개당 15~30 엘리먼트 × 500 = 1만+ → 드래그·줌 프레임 드랍 |

**대응**
```tsx
<ReactFlow
  onlyRenderVisibleElements
  nodesDraggable={false}        // 읽기 중심이니 끄는 것만으로도 큰 이득
  elevateEdgesOnSelect={false}
/>
```
- `nodeTypes` / `edgeTypes`는 **반드시 모듈 스코프 상수**. 렌더 안에서 만들면 매 프레임 전체 언마운트
- 커스텀 노드는 전부 `React.memo`, zustand는 selector + `useShallow`
- LOD: `useStore(s => s.transform[2])`로 줌을 읽어 semantic zoom 분기 (DESIGN.md §6.7)
- **진짜 해법은 접기(collapse).** 500스텝은 어차피 사람이 못 읽는다. **v1부터 넣는다** — 나중에 추가하면 ID 스킴과 레이아웃 캐시를 다시 손대야 한다

---

## 6. Next.js 구조

```
app/
  (marketing)/…
  (app)/
    workflows/page.tsx                 # RSC: 목록
    workflows/[id]/page.tsx            # RSC 셸 + 클라이언트 에디터 아일랜드
    workflows/[id]/_components/
      EditorClient.tsx                 # 'use client'
  s/[id]/page.tsx                      # 공유 페이지 (RSC, prefers-color-scheme 대응)
  api/
    og/[id]/route.tsx                  # OG 카드 (next/og)
    export/pdf/[id]/route.ts
    export/n8n/[id]/route.ts           # 나중
    ai/draft/route.ts                  # 나중: 스트리밍
server/
  actions/document.ts                  # 'use server'
  auth/getCurrentUser.ts               # ★ 인증 벤더를 여기 뒤로 숨긴다
  services/…
packages/
  graph-core/                          # 순수: derive / validate / ops 리듀서 / n8n
    src/derive.ts
    src/__fixtures__/                  # ★ 골든 픽스처 50+
db/schema.ts
```

**tRPC는 넣지 않는다.** App Router + Server Actions로 충분하고, 나중 실시간 협업은 어차피 별도 WebSocket(y-websocket / PartyKit)으로 나가서 tRPC가 커버하지 못한다. 스트리밍 AI와 파일 익스포트만 Route Handler.

```ts
// server/actions/document.ts
'use server';
import { z } from 'zod';
import { actionClient } from '@/server/safe-action';
import { OpSchema } from '@workflow/graph-core';

export const applyOps = actionClient
  .schema(z.object({
    docId: z.string().uuid(),
    baseRevision: z.number().int(),
    ops: z.array(OpSchema).max(200),
  }))
  .action(async ({ parsedInput, ctx }) => {
    // 트랜잭션: revision 확인 → ops 리듀서 적용 → operations 로그 append → revision++
    return await commitOps(parsedInput, ctx.user);
  });
```

**자동 저장 / 낙관적 업데이트**
편집 세션 동안의 SoT는 zustand 스토어다. `useOptimistic`은 폼용이라 부적합.
로컬에서 op 즉시 적용 → 아웃바운드 큐 적재 → 800ms 디바운스 배치 전송 → 언마운트/`visibilitychange`에 `navigator.sendBeacon` 플러시. revision 불일치 시, op이 대부분 교환 가능(fractional index 덕분)하므로 최신 상태를 받아 미확인 op만 재적용.

---

## 7. 인증·권한

**WorkOS AuthKit.** 이유는 SSO보다 오히려 **디렉터리 싱크**다 — 이 제품의 "담당자" 메타데이터는 실제 사내 인명부를 필요로 하고(PRD §4.5), SCIM/Directory Sync가 그걸 채워준다. 무료 1M MAU라 사내 도구 규모에서 사실상 무과금이고 SAML/OIDC가 1급 기능.

- Clerk은 SSO가 Business 플랜이라 비용 절벽
- Auth.js v5는 IdP가 하나로 확정이면 충분하지만 SCIM을 직접 만들어야 함

어느 쪽을 고르든 **`server/auth/getCurrentUser()` 한 모듈 뒤로 숨기고**, `users.external_id`로 IdP subject를 저장하면 교체가 하루 작업이 된다.

### 권한 — PRD §3.3을 아키텍처로 강제

```
documents.orgId + document_members(role: owner | editor | viewer)

★ 관리자 역할에 개인 문서 열람권을 부여하는 코드 경로를 만들지 않는다.
★ 집계 쿼리는 GROUP BY 결과의 count < 5 이면 행 자체를 반환하지 않는다 (DB 레벨 뷰로 강제).
★ 집계 뷰에서 개인 식별자로 드릴다운하는 API를 제공하지 않는다.
```

이건 정책이 아니라 **코드로 못박는다.** "만들 수 있는데 안 만들었다"는 증명이 이 제품의 신뢰 기반이다.

---

## 8. 최대 리스크 3가지

| # | 리스크 | 완화 |
|---|---|---|
| 1 | **변환 규칙의 의미론적 모호성** — "갈래의 마지막 단계"가 중첩 분기·빈 갈래·조기 종료에서 애매. 의도와 그림이 어긋나면 신뢰가 즉시 무너짐 | `graph-core`에 **골든 픽스처 50+**(아웃라인 → 기대 그래프)를 v1부터. 엣지 호버로 "이 연결은 왜 생겼나" 설명(파생 vs 명시) |
| 2 | **레이아웃 점프** — 이런 제품이 실패하는 가장 흔한 이유 | DESIGN.md §6.6 스택 전체를 **1주차 프로토타입에서 200노드로 검증**. 나중에 붙이는 최적화가 아니라 초기 설계 항목 |
| 3 | **한국어 IME 회귀 + 조기에 들어올 캔버스 편집 요구** | BlockNote로 IME 외주화 + CDP 조합입력 테스트를 CI에. 캔버스 편집은 op 기반 + 안정 UUID로 미리 열어두되 v1은 읽기 전용 + 포커스 동기화 |

---

## 9. 지금 해야 할 결정 (되돌리기 비싼 순)

1. **모든 변경을 op으로.** `saveDocument(wholeJson)`으로 시작하면 Yjs 전환 시 모든 mutation을 다시 쓴다 → 처음부터 `applyOps(docId, ops[])`
2. **클라이언트 발급 UUID + tombstone 삭제.** CRDT의 전제조건
3. **fractional index + jitter.** 정수 order로 시작하면 협업 도입 시 리인덱싱 폭풍
4. **`packages/graph-core` 순수 패키지.** React·Drizzle import 금지
5. **메타데이터 어휘 통제.** 도구는 자유 문자열이 아니라 카탈로그 FK, `n8n_node_type` 자리를 지금 잡아둔다. 자유 문자열로 3개월 쌓이면 익스포터가 전부 퍼지 매칭이 된다
6. **도메인 모델과 에디터 JSON 분리.** BlockNote ProseMirror JSON을 SoT로 저장하면 Yjs 전환과 n8n 익스포트가 동시에 지저분해진다
7. **집계 5인 미만 차단을 DB 뷰로.** 애플리케이션 레벨 검사는 언젠가 우회된다

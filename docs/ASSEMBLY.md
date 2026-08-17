# 조직 프로세스 조립 · 불일치 리포트

> 최종 갱신: 2026-08-17 · 상태: v0.1
> 관련: [PRD.md](./PRD.md) §4.9 · [TRUST.md](./TRUST.md) · [MEASUREMENT.md](./MEASUREMENT.md)

> 대상: M4 · 선행 의존: M1(저장·공유) · M2(메타데이터 FK) · [ARCHITECTURE.md](./ARCHITECTURE.md) §2 데이터 모델

---

## 0. 이 설계가 서 있는 한 문장

**우리는 이벤트 로그를 잇는 게 아니라 기억을 잇는다.**

Celonis는 인스턴스 레벨로 조인한다(품의번호 `PO-2026-0417` 하나가 시스템 4곳에 남는다). 우리에겐 그 값이 없고 앞으로도 없다. 우리가 가진 건 **타입 레벨 진술**이다 — "나는 지출결의서를 재무팀에 넘긴다" / "나는 지출결의서를 총무에서 받는다".

이 차이가 설계 전체를 규정한다.

| | 인스턴스 조인 (Celonis) | 타입 조인 (우리) |
|---|---|---|
| 조인 키 | 실제 식별자 값 | 산출물 **종류** + 상대 **FK** |
| 정확도 | 결정적 | 확률적 → **사람이 확정** |
| 산출물 | 실제 케이스의 경로 | **인식의 차이** |
| 불일치의 의미 | 규정 위반(conformance) | **경계 정의 불일치** ← 더 팔린다 |

conformance checking은 "규정과 실제가 다르다"를 찾는다. 우리는 **"두 사람이 같은 구간을 다르게 세고 있다"**를 찾는다. 후자가 로그 없이 가능하고, 조직이 실제로 못 보고 있는 것이며, 고치는 데 개발이 필요 없다.

---

# 1. 접합 소켓 데이터 모델

## 1.1 판단 — 비즈니스 객체 카탈로그를 도입한다. 단 폐쇄형이 아니다

**결론: 3층 하이브리드.** 시스템 원형(30종, 고정) + 조직 카탈로그(자동 성장) + 자유 텍스트 원문(영구 보존).

근거 4가지:

1. **D-009의 논리가 그대로 적용된다.** "지출결의서"/"지출결의"/"지결"이 각각 다른 엔티티가 되면 접합 지도가 무너진다. 담당자·도구를 FK로 간 이유와 동일하다.
2. **그런데 도구와 다르다.** 도구는 48종이고 전사 공통이며 유한하다. 비즈니스 객체는 **조직마다 다르고 사실상 무한**하다("주간 영업보고 양식", "3층 회의실 예약대장"). 폐쇄 카탈로그를 미리 만드는 건 불가능하고, 만들면 사용자의 "그 파일"이 카탈로그에 없어서 입력이 막힌다.
3. **그래서 승격으로 성장시킨다.** 서로 다른 소유자 2명 이상이 같은 정규화 라벨을 쓰면 조직 카탈로그로 자동 승격. [TOOLS.md](./TOOLS.md) §정규화 사전 운영 규칙 2와 동일한 패턴이며, **이 큐가 "산출물 사전"이라는 두 번째 데이터 자산을 축적하는 유일한 경로**다.
4. **결정적으로 — 카탈로그 ID는 매칭의 전제가 아니라 부스터다.** 커버리지 0에서 시작하므로 ID가 없어도 매칭이 돌아야 한다. ID에 의존하는 설계는 도입 첫 3개월에 아무것도 못 잇는다.

`objectClass`(7종)를 둔다. 클래스가 다르면 감점하고(견적서 ↔ 수주번호는 다른 물건), §7 불일치 유형 판정에도 쓴다.

## 1.2 소켓은 첫/마지막 노드에만 붙지 않는다 — PRD §4.9 수정

PRD 초안은 "모든 개인 흐름의 첫 노드와 마지막 노드"라고 썼다. **시드 데이터가 이걸 반증한다.**

- GA-01 **13번**(지출결의 상신 → 재무)은 마지막 단계가 아니다. 14번이 있다.
- FIN-02 **1번**은 첫 단계지만 **12번**도 인계다.
- CS-01 **3c**는 갈래 안쪽이다.

접합 지도 20건 중 첫/마지막에 걸린 건 절반이 안 된다. → **소켓은 임의의 `item`에 붙는다.** 다만 *묻는 시점*은 경계와 담당자 변경 지점으로 제한한다(§2). 데이터 모델과 수집 UX를 분리한다.

## 1.3 스키마

```ts
// db/schema.ts (ARCHITECTURE §2에 이어 붙임)
import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp,
         index, uniqueIndex, pgEnum, primaryKey } from 'drizzle-orm/pg-core';

// ── 열거형 ────────────────────────────────────────────────
export const socketDirection = pgEnum('socket_direction', ['outbound', 'inbound']);
//   outbound = 내가 넘긴다 / inbound = 내가 받는다

export const partyKind = pgEnum('party_kind', [
  'user',      // 실명 지정 — 가장 강한 신호
  'role',      // 역할 지정 ('회계담당자')
  'team',      // 팀만 지정 ('재무팀')
  'external',  // 사외 (고객·거래처·세무대리인) — 조직 그래프의 종단점
  'unknown',   // 모르겠어요
]);

export const objectClass = pgEnum('object_class', [
  'request',    // 요청서·품의서·발주서
  'approval',   // 결재 문서·승인건
  'evidence',   // 증빙 — 세금계산서·영수증·계약서
  'record',     // 대장·시트·보고서
  'identifier', // 번호 — 수주번호·품의번호·송장번호  ★ 조인 강도 최상
  'physical',   // 물건 — 장비·비품·반품
  'notice',     // 알림·링크·통지
]);

export const catalogLevel = pgEnum('catalog_level', ['system', 'org', 'pending']);

// ── 비즈니스 객체 카탈로그 ─────────────────────────────────
export const businessObjects = pgTable('business_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),                              // null = 시스템 원형(전사 공통)
  level: catalogLevel('level').notNull().default('pending'),
  canonicalName: text('canonical_name').notNull(),    // '지출결의서'
  nameNorm: text('name_norm').notNull(),              // 정규화 키 (§3.3)
  aliases: text('aliases').array().notNull().default([]), // ['지결','지출결의','경비정산서']
  objectClass: objectClass('object_class').notNull(),
  identifierHint: text('identifier_hint'),            // '품의번호' — 같이 다니는 식별자
  // 승격 근거 (감사 가능하게 남긴다)
  promotedFromRaw: text('promoted_from_raw'),
  distinctOwners: integer('distinct_owners').notNull().default(0),
  idf: real('idf'),                                   // 조직 내 역문서빈도 — 매칭 가중치 (§3.4)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('bobj_org_norm').on(t.orgId, t.nameNorm),
  index('bobj_class').on(t.orgId, t.objectClass),
]);

// ── 접합 소켓 ─────────────────────────────────────────────
export const handoffSockets = pgTable('handoff_sockets', {
  id: uuid('id').primaryKey(),                        // 클라이언트 발급 (D-031)
  orgId: uuid('org_id').notNull(),
  docId: uuid('doc_id').notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  direction: socketDirection('direction').notNull(),

  // ── 신호 ③ 상대방 ────────────────────────────────────
  partyKind: partyKind('party_kind').notNull().default('unknown'),
  partyUserId: uuid('party_user_id'),                 // → users.id
  partyRoleId: uuid('party_role_id'),                 // → directory_roles.id
  partyDeptId: uuid('party_dept_id'),
  partyRaw: text('party_raw'),                        // 매칭 실패 원문 — 절대 버리지 않는다
  partyExternalLabel: text('party_external_label'),   // '거래처 담당자', '세무대리인'

  // ── 신호 ② 도구·화면 ─────────────────────────────────
  channelToolId: uuid('channel_tool_id').references(() => tools.id),
  channelScreen: text('channel_screen'),              // '전자결재 > 지출결의', 'ERP 매입전표'

  // ── 신호 ④ 시간 인접성 ───────────────────────────────
  //   'immediate'|'same_day'|'1d'|'2-3d'|'1w'|'batch_monthly'|'unknown'
  lagBand: text('lag_band').notNull().default('unknown'),
  cadenceKey: text('cadence_key'),                    // 'daily'|'weekly'|'monthly'|'ad_hoc'

  // ── 메타 ────────────────────────────────────────────
  source: text('source').notNull().default('asked'),  // 'asked'|'inferred'|'seed'|'derived_from_link'
  confidence: real('confidence').notNull().default(1),
  boundary: text('boundary').notNull(),               // 'first'|'last'|'mid'
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('sockets_doc').on(t.docId),
  index('sockets_item_dir').on(t.itemId, t.direction),
  index('sockets_party').on(t.orgId, t.partyUserId),
  // 한 아이템에 방향당 하나 — 여러 개 받으려면 산출물을 늘린다
  uniqueIndex('sockets_item_direction').on(t.itemId, t.direction),
]);

// ── 신호 ① 산출물 (소켓 하나가 여러 개를 나른다: '지출결의서 + 세금계산서') ──
export const socketArtifacts = pgTable('socket_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  socketId: uuid('socket_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  objectId: uuid('object_id').references(() => businessObjects.id), // nullable — 미승격 허용
  labelRaw: text('label_raw').notNull(),              // 사용자가 적은 그대로
  labelNorm: text('label_norm').notNull(),            // §3.3 정규화 결과
  role: text('role').notNull().default('primary'),    // 'primary'|'attachment'
  qty: integer('qty'),                                // '견적 2곳' → 2  ★ 산출물 불일치 검출용
  isRequired: boolean('is_required').notNull().default(true),
}, (t) => [
  index('sart_socket').on(t.socketId),
  index('sart_norm').on(t.labelNorm),
]);

// ── 확정된 접합 ───────────────────────────────────────────
export const handoffLinks = pgTable('handoff_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  outboundSocketId: uuid('outbound_socket_id').notNull().references(() => handoffSockets.id),
  inboundSocketId:  uuid('inbound_socket_id').notNull().references(() => handoffSockets.id),

  // 'handoff'  담당자가 바뀐다 — 정상 접합
  // 'overlap'  같은 작업을 두 문서가 각각 기록 — ★ 리드타임 이중 계산 방지 (J-02, J-07)
  // 'fanout'   하나가 여러 곳으로 (GA-01 13 → FIN-01 · FIN-03)
  // 'return'   되돌림 (반려·반품)
  linkType: text('link_type').notNull().default('handoff'),

  // 'candidate'|'auto'|'single'|'confirmed'|'rejected'|'severed'|'stale'|'orphaned'
  status: text('status').notNull().default('candidate'),
  score: real('score').notNull(),
  signals: jsonb('signals').$type<SignalBreakdown>().notNull(), // 왜 이어졌는지 — UI 노출용

  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  counterConfirmedBy: uuid('counter_confirmed_by'),
  counterConfirmedAt: timestamp('counter_confirmed_at', { withTimezone: true }),
  severedBy: uuid('severed_by'),
  severedAt: timestamp('severed_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('links_pair').on(t.outboundSocketId, t.inboundSocketId),
  index('links_org_status').on(t.orgId, t.status),
]);

// ── 거부 학습 (같은 쌍을 다시 제안하지 않기) ────────────────
export const linkSuppressions = pgTable('link_suppressions', {
  orgId: uuid('org_id').notNull(),
  socketAId: uuid('socket_a_id').notNull(),           // 항상 uuid 오름차순으로 정렬 저장
  socketBId: uuid('socket_b_id').notNull(),
  reason: text('reason').notNull(),                   // 'not_this_work'|'wrong_person'|'not_now'|'severed'
  until: timestamp('until', { withTimezone: true }),  // null = 영구
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [primaryKey({ columns: [t.socketAId, t.socketBId] })]);

// 라벨쌍 수준의 약한 음성 학습 — 3회 이상 독립 거부 시에만 활성 (§11-11)
export const labelPairPenalties = pgTable('label_pair_penalties', {
  orgId: uuid('org_id').notNull(),
  normA: text('norm_a').notNull(),
  normB: text('norm_b').notNull(),
  rejectCount: integer('reject_count').notNull().default(0),
  penalty: real('penalty').notNull().default(0),      // 0 ~ -0.15 상한
}, (t) => [primaryKey({ columns: [t.orgId, t.normA, t.normB] })]);

// ── 불일치 ───────────────────────────────────────────────
export const discrepancies = pgTable('discrepancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  linkId: uuid('link_id').references(() => handoffLinks.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                       // §7의 13종
  severity: text('severity').notNull(),               // 'high'|'mid'|'low'
  severityScore: real('severity_score').notNull(),
  facts: jsonb('facts').$type<DiscrepancyFacts>().notNull(), // 양측 값 — 개인 식별자 없음
  status: text('status').notNull().default('open'),   // 'open'|'acknowledged'|'resolved'|'wontfix'
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('disc_link_kind').on(t.linkId, t.kind),
  index('disc_org_sev').on(t.orgId, t.severity, t.status),
]);
```

**반드시 붙일 DDL**

```sql
-- 소켓이 걸린 아이템이 삭제되면 링크는 끊지 말고 orphaned로 (§11-6)
ALTER TABLE handoff_sockets DROP CONSTRAINT handoff_sockets_item_id_fkey;
ALTER TABLE handoff_sockets ADD CONSTRAINT handoff_sockets_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE handoff_sockets ALTER COLUMN item_id DROP NOT NULL;

-- 같은 문서 안에서 스스로 잇는 걸 DB가 막는다
ALTER TABLE handoff_links ADD CONSTRAINT links_not_self
  CHECK (outbound_socket_id <> inbound_socket_id);
```

---

# 2. 소켓 수집 UX

## 2.1 언제 묻는가 — 저항이 가장 낮은 5개 지점

작성 중에는 절대 묻지 않는다(PRD §4.5 원칙). 저항 순으로 나열하면:

| # | 시점 | 문구 | 왜 저항이 낮은가 |
|---|---|---|---|
| **1 ★** | 메타데이터 카드 스택에서 담당자 `다른 팀`을 고른 **직후, 같은 카드 안에서** | `어느 팀이요?` → 팀 선택 → `그 팀 누구한테 가는지 아세요?` | **인지 전환 비용 0.** 이미 "다른 팀"이라고 답한 상태라 다음 질문이 같은 생각의 연장이다 |
| **2 ★** | **인수인계 문서 내보내기** 흐름 안 | `이 일 다음은 누가 받으세요? 문서에 적어드릴게요.` | 사용자 이득과 완전히 정렬. 인수인계 문서에 "다음 담당"이 없으면 문서가 부실하다는 걸 본인이 안다 |
| 3 | 요약 카드의 `팀을 넘는 인계 2번` 행 클릭 | `이 두 군데, 누구한테 넘어가요?` | 가치를 먼저 보여준 뒤에 묻는다 |
| 4 | 메타 카드 스택 마지막 다음 1장 (`hold`+`승인`/`응답`이 있을 때만) | `팀장님 확인을 기다린다고 하셨죠. 어느 분이세요?` | 이미 적은 내용을 구체화하는 것뿐 |
| 5 | 체크리스트 모드 완료 직후 | `이번엔 어디로 넘기셨어요?` | 방금 실제로 한 일이라 회상 부담이 없다 |

**절대 하지 않는 것**: 저장 직전에 모달로 막고 묻기. 흐름 작성 중에 인라인으로 묻기. 필수 필드로 만들기.

## 2.2 문구 ([WRITING.md](./WRITING.md) 준수)

```
[ 넘기는 쪽 ]
  이거 끝나면 누구한테 넘어가요?
  ( 사람 검색 )  [ 우리 팀 아니에요 ]  [ 회사 밖이에요 ]  [ 모르겠어요 ]
  넘길 때 뭘 같이 줘요?
  placeholder: 예: 지출결의서, 세금계산서
  보조: 이 두 줄은 받는 쪽에도 보여요. 나머지 내용은 안 보여요.

[ 받는 쪽 ]
  이 일은 누구한테서 시작돼요?
  뭘 받으면서요?
  placeholder: 예: 구매 요청, 견적서

[ 건너뛰기 ]  ← 다음 버튼과 동일 크기
  헬퍼: 안 적어도 흐름은 그대로예요. 나중에 생각나면 채우면 돼요.
```

`이 두 줄은 받는 쪽에도 보여요`는 장식이 아니라 **§8 프라이버시 설계의 UI 표면**이다. 소켓은 유일하게 의도적으로 공개되는 필드이고, 그 사실이 입력 순간에 보여야 한다.

## 2.3 안 채우는 대다수를 위한 폴백 — 그림자 소켓

현실적 기대치: 소켓을 명시적으로 채우는 비율 **문서당 0.6~1.2개**. 나머지는 추론한다.

`source='inferred'`인 그림자 소켓은 **사용자에게 주장으로 표시되지 않는다.** 후보 생성에만 쓰이고, 후보가 확정되는 순간 실제 소켓으로 승격된다 — **매칭이 수집을 유발하는 역방향 루프**다.

추론 규칙 5개:

```ts
// packages/graph-core/src/matching/infer.ts
export function inferSockets(doc: DocGraph): InferredSocket[] {
  const out: InferredSocket[] = [];

  // R1. 담당자 변경 지점 — PRD §4.3 "인계는 타입이 아니라 담당자 변경으로 추론"
  for (const [prev, next] of adjacentPairs(doc.orderedItems)) {
    if (prev.assigneeId && next.assigneeId && prev.assigneeId !== next.assigneeId) {
      out.push({ itemId: prev.id, direction: 'outbound', partyKind: 'user',
                 partyUserId: next.assigneeId, confidence: 0.85, boundary: 'mid' });
      out.push({ itemId: next.id, direction: 'inbound',  partyKind: 'user',
                 partyUserId: prev.assigneeId, confidence: 0.85, boundary: 'mid' });
    }
  }

  // R2. hold + 승인/응답 = 상대가 반드시 존재한다
  for (const it of doc.items) {
    if (it.kind === 'hold' && ['approval', 'reply'].includes(it.attrs.waitFor)) {
      out.push({ itemId: it.id, direction: 'inbound',
                 partyRaw: extractWaitTarget(it.title),   // '팀장님 확인' → '팀장'
                 lagBand: bandFromHours(it.attrs.avgWaitH),
                 confidence: 0.7, boundary: 'mid' });
    }
  }

  // R3. 제목의 한국어 방향 표지 — 조사가 방향을 알려준다
  //   '재무팀에 상신'  → 조사 에/에게/한테 + 넘김동사 → outbound
  //   '영업에서 접수'  → 조사 에서/로부터   + 수신동사 → inbound
  for (const it of doc.items) {
    const d = detectDirection(it.title);
    if (d) out.push({ itemId: it.id, direction: d.direction, partyRaw: d.party,
                      artifacts: extractArtifactNouns(it.title),
                      confidence: 0.6, boundary: 'mid' });
  }

  // R4. 첫/마지막 단계는 무조건 암묵 소켓 (외부 접점 확률이 높다)
  out.push({ itemId: first(doc).id, direction: 'inbound',  confidence: 0.45, boundary: 'first' });
  out.push({ itemId: last(doc).id,  direction: 'outbound', confidence: 0.45, boundary: 'last'  });

  // R5. 산출물 명사 추출 — 접미사가 강한 신호다 (-서 -표 -장 -증 -건 -번호 -계산서)
  //     "견적 비교표 + 품의서 상신" → ['견적비교표','품의서']
  return dedupe(out.map(s => ({ ...s, artifacts: s.artifacts ?? extractArtifactNouns(titleOf(s)) })));
}

const GIVE_VERBS = ['넘기', '상신', '요청', '전달', '올리', '보내', '이관', '인계', '통보', '회신'];
const TAKE_VERBS = ['접수', '받', '수취', '수령', '인수', '확인', '조회'];
const TO_JOSA    = ['에게', '한테', '으로', '에', '께'];
const FROM_JOSA  = ['에서', '로부터', '으로부터', '한테서', '에게서'];
```

**R3의 조사 활용이 한국어에서 특히 잘 먹힌다.** 영어는 전치사가 앞에 붙어 구문 분석이 필요하지만, 한국어는 조사가 명사 뒤에 붙어 있어 **단순 접미 스캔만으로 격(case)이 잡힌다.** 형태소 분석기 없이 방향 추출이 가능한 이유다.

**추론과 매칭의 경계** — R3/R5는 `items.title` 원문을 읽는다. 그래서 **추론은 소유자 테넌트 안에서만 실행되고, 밖으로 나가는 건 정규화된 라벨과 FK뿐이다.** §8에서 코드로 강제한다.

---

# 3. 매칭 알고리즘

## 3.1 전체 파이프라인

```
소켓 저장/변경
   │
   ├─▶ [1] 정규화        labelRaw → labelNorm, 카탈로그 매칭 시도
   ├─▶ [2] 블로킹 키 생성  5종 (§3.5)
   ├─▶ [3] 후보 조회      블록 교집합, 크기 상한, 방향 상보 필터
   ├─▶ [4] 점수 계산      6신호 가중합 × 게이트 × 패널티 × 출처신뢰도
   ├─▶ [5] 결정적 자동확정 규칙  ← 점수와 별개
   └─▶ [6] 상위 3개만 후보로 노출
```

## 3.2 6개 신호와 가중치

BPM 전문가가 준 5개를 그대로 쓰되, **구조 정합**을 6번째로 분리했다(방향·경계·부서 경계는 어휘가 아니라 그래프 속성이라 같은 축에 두면 안 된다).

| 신호 | 가중치 | 근거 |
|---|---|---|
| **③ 상대방** | **0.32** | 유일하게 **FK에 근거한 신호**. 디렉터리는 SCIM으로 동기화되어 모호성이 없다. D-009가 이 제품의 해자라고 한 이유가 여기서 현금화된다 |
| **① 산출물** | **0.28** | 의미론적으로 진짜 조인 키. 다만 라벨이 자유 텍스트라 노이즈가 있어 상대방보다 낮다 |
| **② 도구·화면** | 0.14 | 변별력이 도구마다 극심하게 다르다(홈택스=강, 슬랙=거의 0) → **IDF 가중 필수** |
| **⑤ 어휘 유사도** | 0.14 | 한국어 자유 텍스트. 보조 신호로만. 단독으로는 절대 확정 근거가 되지 않는다 |
| **⑥ 구조 정합** | 0.06 | 경계 위치·부서 경계·주기 |
| **④ 시간 인접성** | **0.06** | **솔직히 약하다.** 이벤트 로그가 없어서 "시간 인접"을 관측할 수 없고, 우리가 가진 건 자기보고 대기 밴드뿐이다. → **주로 감점 용도로 쓴다**(월 1회 마감 ↔ 일 20건 접수는 직결이 아니다) |

> ④를 낮게 두는 게 이 설계에서 원 제안과 가장 크게 갈라지는 지점이다. 로그 기반 시스템에서는 시간 인접성이 최강 신호지만, **기억 기반 시스템에서는 자기보고 시간의 오차가 ±100~300%(PRD §4.7)라 신호가 아니라 잡음이다.**

## 3.3 한국어 어휘 유사도 — 형태소 분석 없이

형태소 분석기(mecab-ko, khaiii)를 쓰지 않는 이유 3가지: (a) 사전 미등재 사내 용어에 취약하고 — 정작 우리가 다룰 어휘가 그것이다, (b) 서버 사이드 네이티브 바이너리가 `graph-core` 순수 패키지 원칙(D-033)을 깬다, (c) 우리가 다루는 건 문장이 아니라 **2~8음절 명사구**라 구문 분석이 필요 없다.

**4단계 파이프라인.**

```ts
// packages/graph-core/src/matching/ko.ts  — 의존성 0, 순수 함수

// ── [1] 정규화 ───────────────────────────────────────────
export function normalizeKo(s: string): string {
  return s
    .normalize('NFKC')                       // 전각 → 반각
    .toLowerCase()
    .replace(/[()[\]{}<>「」『』"'`~!@#$%^&*_+=|\\/:;,.?-]/g, '')
    .replace(/\s+/g, '')
    .replace(/(\d)[,](\d)/g, '$1$2');
}

// ── [2] 조사·어미 절단 ────────────────────────────────────
// 길이 내림차순. '에게서'를 '에게'보다 먼저 시도해야 한다.
const JOSA = ['으로부터','에게서','로부터','한테서','에서','에게','한테','께서','으로','부터',
              '까지','로서','로써','와의','과의','에','의','을','를','이','가','은','는',
              '도','만','로','와','과'];
const EOMI = ['하겠습니다','합니다','하세요','했어요','해요','하기','하고','하는','하여','해서',
              '했음','시키기','시킴','되기','되는','됨','함','한','할','드림','주기','받기'];

// ★ 핵심 규칙: 자르고 남은 어간이 2음절 미만이면 자르지 않는다.
//   '품의' → '품' 이 되면 변별력이 사라지고 오탐이 폭증한다.
export function stripSuffix(tok: string, list: string[] = JOSA): string {
  for (const suf of list) {
    if (tok.length - suf.length >= 2 && tok.endsWith(suf)) return tok.slice(0, -suf.length);
  }
  return tok;
}

// 산출물 라벨: 가볍게 (명사구라 조사만)
export function normArtifact(raw: string): string {
  return stripSuffix(normalizeKo(raw), JOSA);
}

// 단계 제목: 무겁게 (조사 + 어미 + 무의미 기능어)
const STOP = ['그리고','다음','바로','우선','일단','각','해당','관련','내용','건에','대해'];
export function normTitle(raw: string): string {
  return raw.split(/\s+/)
    .map(t => stripSuffix(stripSuffix(normalizeKo(t), EOMI), JOSA))
    .filter(t => t.length >= 2 && !STOP.includes(t))
    .join('');
}

// ── [3] 자모 분해 ────────────────────────────────────────
const CHO  = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

export function toJamo(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
  }
  return out;
}
```

**왜 자모 분해인가.** 음절 단위 편집거리는 한국어에서 해상도가 너무 거칠다.

| 쌍 | 음절 편집거리 | 자모 편집거리 | 실제 관계 |
|---|---|---|---|
| 지출결의 / 지출결의서 | 1 | 3 | 같은 물건 |
| 품의서 / 품의써 | 1 | 1 | 오타 |
| 견적서 / 계약서 | 2 | 4 | **다른 물건** |
| 수주번호 / 주문번호 | 1 | 4 | **다른 물건** |

음절 단위로는 `지출결의/지출결의서`(같은 것)와 `견적서/계약서`(다른 것)가 1 대 2로 거의 붙어 있다. 자모 단위로는 3 대 4로 벌어지고, 길이 정규화까지 하면 0.79 대 0.55로 확실히 갈린다. **한국어는 한 음절이 2~3자모를 담고 있어서, 음절 단위 거리는 정보의 2/3를 버린다.**

```ts
// ── [4] 유사도 결합 ──────────────────────────────────────
function bigrams(s: string): string[] {
  if (s.length < 2) return [s];
  return Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
}

/**
 * ★ head-final 가중 Dice
 * 한국어는 핵심 명사가 뒤에 온다 — '월말 정산 지출결의서'의 핵심은 '지출결의서'.
 * 뒤쪽 bigram에 최대 1.5배 가중을 준다. 영어라면 반대로 해야 한다.
 */
export function headFinalDice(a: string, b: string, idf: (g: string) => number = () => 1): number {
  const wa = weightMap(a, idf), wb = weightMap(b, idf);
  let inter = 0, total = 0;
  for (const [g, w] of wa) { total += w; if (wb.has(g)) inter += Math.min(w, wb.get(g)!); }
  for (const [, w] of wb) { total += w; }
  return total === 0 ? 0 : (2 * inter) / total;
}
function weightMap(s: string, idf: (g: string) => number): Map<string, number> {
  const gs = bigrams(s), m = new Map<string, number>();
  gs.forEach((g, i) => {
    const pos = gs.length === 1 ? 1 : 1 + 0.5 * (i / (gs.length - 1));   // 뒤로 갈수록 ↑
    m.set(g, (m.get(g) ?? 0) + pos * idf(g));
  });
  return m;
}

function jaroWinkler(a: string, b: string): number { /* 표준 구현 */ }

/** 최종 한국어 유사도 */
export function simKo(rawA: string, rawB: string, idf?: (g: string) => number): number {
  const a = normArtifact(rawA), b = normArtifact(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = headFinalDice(a, b, idf);                 // 순서 무관 부분일치
  const jw   = jaroWinkler(toJamo(a), toJamo(b));        // 오타·활용 변이
  // 둘 다 높아야 높게 — 한쪽만 높은 건 대부분 오탐이다
  return 0.65 * dice + 0.35 * jw * (dice > 0.2 ? 1 : 0.5);
}
```

**축약어는 알고리즘이 아니라 사전으로.** `지결`, `세계`(세금계산서), `수발주`, `품의` 같은 사내 축약은 어떤 문자열 유사도로도 안 잡힌다(`지결` vs `지출결의서`의 dice = 0.11). TOOLS.md의 도구 동의어와 동일하게 `businessObjects.aliases`로 처리하고, 미매칭 상위 20건을 주간 큐에 올려 사람이 alias를 붙인다. **알고리즘으로 풀려고 하면 오탐만 는다.**

## 3.4 IDF — 이게 없으면 전부 매칭된다

한국 사무 어휘의 상위 빈출어: `요청`, `확인`, `접수`, `처리`, `등록`, `작성`, `전달`, `보고`, `자료`, `내용`. 이걸 그대로 두면 "요청서"가 모든 "요청서"와 매칭되어 조직 뷰가 스파게티가 된다.

```sql
-- 야간 배치. 조직 단위로만 계산한다 (조직 간 어휘 공유 금지 — 프라이버시 + 정확도)
CREATE MATERIALIZED VIEW artifact_bigram_idf AS
WITH docs_per_org AS (
  SELECT org_id, count(DISTINCT doc_id)::real AS n FROM handoff_sockets GROUP BY 1
),
grams AS (
  SELECT s.org_id, s.doc_id, g.gram
  FROM handoff_sockets s
  JOIN socket_artifacts a ON a.socket_id = s.id
  CROSS JOIN LATERAL (
    SELECT substring(a.label_norm FROM i FOR 2) AS gram
    FROM generate_series(1, greatest(length(a.label_norm) - 1, 1)) i
  ) g
)
SELECT g.org_id, g.gram,
       ln(d.n / (count(DISTINCT g.doc_id)::real + 1)) + 1 AS idf
FROM grams g JOIN docs_per_org d USING (org_id)
GROUP BY g.org_id, g.gram, d.n;

CREATE UNIQUE INDEX ON artifact_bigram_idf (org_id, gram);
```

같은 방식으로 **도구 IDF**도 계산한다. `슬랙`은 전 문서의 70%에 등장 → idf ≈ 1.3, `홈택스`는 8% → idf ≈ 3.5. 도구 신호를 IDF로 곱하면 "둘 다 슬랙을 쓴다"가 근거가 되는 사고를 막는다.

## 3.5 블로킹 — 50만 쌍을 수만 쌍으로

실제 규모를 먼저 계산한다. 문서 1,000개 × 문서당 소켓 2.4개(명시 1.0 + 그림자 1.4) ≈ **소켓 2,400개**. 방향 상보 제약을 넣어도 순진하게 하면 1,200 × 1,200 = **144만 쌍**. 소켓 수는 문서 수보다 빨리 늘어나므로(문서당 여러 개) 전수 비교는 처음부터 배제한다.

**5종 블로킹 키 + 캐노피 방식(union of blocks).**

```ts
export function blockingKeys(s: SocketFeature): Array<[string, string]> {
  const keys: Array<[string, string]> = [];

  // BK1 카탈로그 객체 — 가장 정밀
  for (const a of s.artifacts) if (a.objectId) keys.push(['obj', a.objectId]);

  // BK2 어휘 — 라벨의 IDF 상위 2개 bigram (MinHash 대용)
  for (const a of s.artifacts)
    for (const g of topIdfBigrams(a.labelNorm, 2)) keys.push(['lex', g]);

  // BK3 상대방 실명 — 양방향으로 심는다.
  //   내가 지목한 사람 / 내 문서의 소유자. 두 소켓이 서로를 지목하면 이 블록에서 만난다.
  if (s.party.userId) keys.push(['party', s.party.userId]);
  keys.push(['party', s.ownerId]);

  // BK4 역할 + 부서
  if (s.party.roleId) keys.push(['role', s.party.roleId]);
  if (s.party.deptId) keys.push(['deptpair', canonicalDeptPair(s.deptId, s.party.deptId)]);

  // BK5 도구 × 부서쌍 — 도구 단독은 블록이 폭발한다
  if (s.party.deptId)
    for (const t of s.toolIds) keys.push(['tooldept', `${t}|${canonicalDeptPair(s.deptId, s.party.deptId)}`]);

  return keys;
}
```

```sql
-- 후보 조회. 소켓 1개 삽입/수정 시 증분 실행 (전량 재계산 없음)
WITH me AS (
  SELECT key_type, key_value FROM socket_blocking_keys WHERE socket_id = $1
),
sizes AS (   -- 야간 갱신되는 블록 크기 테이블
  SELECT key_type, key_value, n FROM socket_block_sizes WHERE org_id = $2
)
SELECT k.socket_id,
       array_agg(DISTINCT k.key_type) AS matched_key_types   -- 몇 종류 블록에서 만났는지 = 사전 신호
FROM socket_blocking_keys k
JOIN me  USING (key_type, key_value)
JOIN sizes z USING (key_type, key_value)
JOIN handoff_sockets s ON s.id = k.socket_id
WHERE k.org_id = $2
  AND s.direction <> $3          -- 방향 상보
  AND s.doc_id   <> $4           -- 같은 문서 제외
  AND s.deleted_at IS NULL
  AND z.n <= 2000                -- ★ 과대 블록은 통째로 버린다 (변별력 0)
  AND NOT EXISTS (
    SELECT 1 FROM link_suppressions ls
    WHERE ls.socket_a_id = least($1, k.socket_id)
      AND ls.socket_b_id = greatest($1, k.socket_id)
      AND (ls.until IS NULL OR ls.until > now())
  )
GROUP BY k.socket_id
ORDER BY cardinality(array_agg(DISTINCT k.key_type)) DESC   -- 여러 블록에서 만난 쌍 우선
LIMIT 300;
```

**과대 블록 폐기(`z.n <= 2000`)가 이 설계에서 가장 중요한 한 줄이다.** "요청서"라는 라벨을 전 직원이 쓰면 그 블록은 변별력이 0인데 비용은 O(n²)이다. 버리는 게 맞다. 버려진 블록은 주간 로그로 남겨 **카탈로그 확장 큐**에 올린다 — 그 라벨을 세분화해야 한다는 신호다.

실측 기대: 소켓 2,400개 → 블록당 평균 8~40개 → 후보쌍 **약 3~6만 건**, 증분 처리 시 소켓 1개당 **50~300쌍**. 1건 점수 계산이 0.3ms이므로 저장 시 동기 실행이 가능하다.

## 3.6 점수 계산

```ts
export interface SignalBreakdown {
  artifact: number; tool: number; party: number;
  time: number; lexical: number; structure: number;
  gate: number; penalty: number; sourceConf: number;
  topReason: 'party_mutual' | 'artifact_catalog' | 'party_named' | 'lexical' | 'tool' | 'weak';
}

const W = { party: 0.32, artifact: 0.28, tool: 0.14, lexical: 0.14, structure: 0.06, time: 0.06 };

export function scorePair(o: SocketFeature, i: SocketFeature, ctx: MatchContext): Scored {
  // ── 게이트: 하나라도 0이면 후보에서 제외 ─────────────────
  const gate =
    (o.direction === 'outbound' && i.direction === 'inbound' ? 1 : 0) *
    (o.docId !== i.docId ? 1 : 0) *
    (o.orgId === i.orgId ? 1 : 0) *
    (o.party.kind === 'external' && i.party.kind === 'external' ? 0 : 1); // 사외↔사외는 접합이 아니다
  if (!gate) return { score: 0, signals: zero('weak') };

  // ── ③ 상대방 ─────────────────────────────────────────
  let party = 0;
  if (o.party.userId === i.ownerId && i.party.userId === o.ownerId) party = 1.0;   // 상호 지목
  else if (o.party.userId === i.ownerId || i.party.userId === o.ownerId) party = 0.9;
  else if (o.party.userId && o.party.userId === i.assigneeIdOfItem)      party = 0.85;
  else if (o.party.roleId && ctx.roleMembers(o.party.roleId).has(i.ownerId)) {
    // ★ 역할의 카디널리티로 신호 강도를 조절한다.
    //   '회계팀장'(1명)은 실명에 가깝고, '영업담당자'(23명)는 거의 정보가 없다.
    party = 0.85 / (1 + Math.log(ctx.roleSize(o.party.roleId)));
  }
  else if (o.party.deptId && o.party.deptId === i.deptId) party = 0.45;
  else if (o.party.rawNorm && i.ownerNameNorm) party = 0.35 * simKo(o.party.rawNorm, i.ownerNameNorm);
  // ★ 상대 지목이 서로 모순되면 감점하되 배제하지 않는다 — 모순 자체가 §7의 산출물이다
  const partyConflict = o.party.userId && i.party.userId &&
                        o.party.userId !== i.ownerId && i.party.userId !== o.ownerId;

  // ── ① 산출물: 두 집합의 최대 매칭 ────────────────────────
  let artifact = 0;
  for (const a of o.artifacts) for (const b of i.artifacts) {
    let s = 0;
    if (a.objectId && a.objectId === b.objectId)          s = 1.0;
    else if (a.objectId && b.objectId)                    s = 0.15;  // 둘 다 카탈로그인데 다르다 = 다른 물건
    else if (ctx.aliasEquals(a.labelNorm, b.labelNorm))   s = 0.92;
    else                                                  s = simKo(a.labelNorm, b.labelNorm, ctx.idf);
    if (a.objectClass && b.objectClass && a.objectClass !== b.objectClass) s *= 0.6;
    if (a.identifierKey && a.identifierKey === b.identifierKey) s = Math.min(1, s + 0.25); // 수주번호 동반
    artifact = Math.max(artifact, s);
  }
  // ★ IDF 하한: 흔해 빠진 라벨만으로 매칭되지 않게
  artifact *= clamp(ctx.labelIdfNorm(o.artifacts, i.artifacts), 0.35, 1);

  // ── ② 도구·화면 ──────────────────────────────────────
  const shared = intersect(o.toolIds, i.toolIds);
  let tool = shared.length === 0 ? 0
           : Math.max(...shared.map(t => ctx.toolIdfNorm(t)));       // 희소 도구가 강한 신호
  if (o.channelScreenNorm && i.channelScreenNorm)
    tool = Math.max(tool, 0.8 * simKo(o.channelScreenNorm, i.channelScreenNorm));

  // ── ⑤ 어휘 (단계 제목) ────────────────────────────────
  const lexical = simKo(o.itemTitleNorm, i.itemTitleNorm, ctx.idf);

  // ── ⑥ 구조 ──────────────────────────────────────────
  const structure =
    0.4 * (o.boundary === 'last' && i.boundary === 'first' ? 1 : 0.5) +
    0.4 * (o.deptId !== i.deptId ? 1 : 0.6) +      // 부서 경계에서 문서가 끊기는 게 자연스럽다
    0.2 * (ctx.deptAdjacency(o.deptId, i.deptId));  // 조직도상 거리

  // ── ④ 시간 (약함. 주로 감점) ──────────────────────────
  const lagOk     = lagCompatible(o.lagBand, i.lagBand);          // 0 ~ 1
  const cadenceOk = cadenceCompatible(o.cadenceKey, i.cadenceKey);
  const time = 0.5 * lagOk + 0.5 * cadenceOk;

  // ── 합산 ────────────────────────────────────────────
  let score = W.party * party + W.artifact * artifact + W.tool * tool
            + W.lexical * lexical + W.structure * structure + W.time * time;

  // ── 패널티 ──────────────────────────────────────────
  let penalty = 1;
  if (partyConflict)                    penalty *= 0.70;
  if (cadenceOk === 0)                  penalty *= 0.55;  // 월1회 ↔ 일20건
  if (artifact < 0.25 && party < 0.5)   penalty *= 0.50;  // 둘 다 약하면 나머지는 우연이다
  penalty *= (1 + ctx.labelPairPenalty(o, i));            // 거부 학습 (최대 -0.15)
  score *= penalty;

  // ── 출처 신뢰도: 그림자 소켓은 할인 ────────────────────
  const sourceConf = Math.min(o.confidence, i.confidence);
  score *= (0.7 + 0.3 * sourceConf);

  // ── 신선도 감쇠 (PRD §4.10) ──────────────────────────
  score *= freshnessDecay(o.lastConfirmedAt, i.lastConfirmedAt);   // 180일 후 0.85, 365일 0.7

  return { score, signals: { artifact, tool, party, time, lexical, structure,
                             gate, penalty, sourceConf, topReason: pickReason(/* … */) } };
}
```

## 3.7 임계값 3단계 + 자동 확정은 점수가 아니라 규칙

| 구간 | 처리 |
|---|---|
| **자동 확정** | **점수로 하지 않는다.** 아래 결정적 규칙 하나만 |
| **0.55 ≤ score < 규칙** | 후보 제시. **문서당 상위 3개만** |
| **0.35 ≤ score < 0.55** | 저장하되 노출 안 함. 커버리지 상승 시 재평가 대상 |
| **< 0.35** | 폐기 |

```ts
/**
 * 자동 확정 — 유일한 규칙.
 * 두 사람이 서로 독립적으로 상대를 실명 지목했고, 같은 카탈로그 객체를 적었다.
 * 이건 확률 추정이 아니라 두 개의 독립 증언이 일치한 것이다.
 */
export function autoConfirmRule(o: SocketFeature, i: SocketFeature): boolean {
  return o.party.userId === i.ownerId
      && i.party.userId === o.ownerId
      && o.artifacts.some(a => a.objectId && i.artifacts.some(b => b.objectId === a.objectId))
      && o.source === 'asked' && i.source === 'asked'      // 그림자 소켓으로는 자동 확정 없음
      && o.deletedAt == null && i.deletedAt == null;
}
```

자동 확정된 링크도 **양쪽에 알림이 가고 7일 이의제기 창이 열린다.** 조용히 잇지 않는다.

**왜 0.55라는 낮은 문턱인가.** 임계값보다 **후보 개수 상한(3개)이 더 강한 통제 장치**이기 때문이다. 문턱을 0.75로 올리면 커버리지 20% 구간에서 후보가 0개가 되고, 사용자는 이 기능이 없다고 결론 내린다. 낮게 잡고 상위 3개로 자르면 "그럴듯한 게 없으면 하나만 뜨고, 그것도 아니면 안 뜬다"가 자연스럽게 나온다.

## 3.8 False positive와 false negative — FP가 훨씬 나쁘다

**판단: false positive가 압도적으로 나쁘다.** 근거 4가지.

1. **오염이 전파된다.** 잘못 이어진 링크 하나가 체인 리드타임을 만들고, 그 리드타임이 불일치를 만들고, 그 불일치가 경영진 리포트에 올라가 **두 부서 사이에 존재하지 않는 갈등**을 만든다. FN은 아무것도 만들지 않는다.
2. **회복 가능성이 비대칭이다.** FN은 커버리지가 오르면 다시 후보로 뜬다. 심지어 짝 없는 소켓 자체가 §10의 산출물(고아·유령)이 된다. **놓친 연결은 다음 달에 잇지만, 잘못 이은 연결로 잃은 신뢰는 안 돌아온다** — TRUST.md가 반복해서 말하는 그 구조다.
3. **프라이버시 비용.** 잘못된 링크는 무관한 두 사람 사이에 정보 노출 경로(요약 수준이라도)를 연다. 이건 절대 원칙 1의 위반에 가깝다.
4. **비용 계산.** 1클릭 확정의 마찰은 5초. 잘못된 링크의 비용 = 발견 확률(낮다 — 아무도 조직 뷰를 정독하지 않는다) × 정정 노력 + **오염된 리포트로 인한 의사결정 오류**. 후자가 지배적이다.

**따라서 임계값은 정밀도 우선으로 설정한다.**

| 지표 | 목표 |
|---|---|
| 제시 후보 precision@3 | ≥ 0.80 |
| 자동 확정 precision | ≥ 0.98 (규칙 기반이므로 사실상 1.0) |
| 후보 수락률 | ≥ 40% (낮으면 후보 품질 문제) |
| **30일 내 절단율** `severed_within_30d / confirmed` | **< 5%** ← FP의 대리 지표 |
| recall | 목표 두지 않음. §10에서 커버리지로 회수 |

---

# 4. 조직 디렉터리를 이용한 강한 신호

`assigneeId`가 FK라는 사실이 이 기능 전체에서 가장 값비싼 자산이다. 최대한 짜낸다.

## 4.1 "A의 마지막 담당자 = B의 첫 담당자"는 접합이 아니다 — 겹침이다

이 케이스는 함정이다. **같은 사람이 A의 마지막 단계와 B의 첫 단계를 한다면 그건 인계가 아니다.** 인계는 정의상 담당자가 바뀌는 것이다.

이 패턴이 실제로 뜻하는 건 둘 중 하나다.

| 패턴 | 판정 | 시드 사례 |
|---|---|---|
| A.last.assignee **=** B.first.assignee, 산출물·도구·제목 유사 | **겹침(overlap)** — 같은 실제 작업을 두 문서가 각각 기록 | J-07 CS-01 3c → CS-02 1 (같은 팀 이관인데 티켓 재생성) |
| A.last.assignee **≠** B.first.assignee, A.outbound.party ≈ B.owner | **인계(handoff)** — 정상 접합 | J-01 GA-01 13 → FIN-01 5 |

**겹침을 인계로 오분류하면 조직 뷰의 리드타임이 이중 계산된다.** J-07의 "응답시간 통계 이중 계산"이 정확히 이 문제이고, 우리 도구가 같은 실수를 반복하면 안 된다.

```sql
-- 겹침 자동 검출: 담당자가 같고 산출물이 같은데 링크가 걸린 경우
UPDATE handoff_links l SET link_type = 'overlap'
FROM handoff_sockets o, handoff_sockets i, items io, items ii
WHERE l.outbound_socket_id = o.id AND l.inbound_socket_id = i.id
  AND io.id = o.item_id AND ii.id = i.item_id
  AND io.assignee_id = ii.assignee_id            -- 같은 사람
  AND (l.signals->>'artifact')::real > 0.8       -- 같은 물건
  AND l.link_type = 'handoff';
```

리드타임 계산 시 `link_type='overlap'` 구간은 **합산하지 않고 max를 취한다.**

## 4.2 상호 지목 — 유일한 자동 확정 근거

두 사람이 **서로를 모르는 채로 독립적으로 상대를 지목**했다는 건, 두 개의 독립 증언이 일치한 것이다. 통계적 추정이 아니라 논리적 확인이다. §3.7의 규칙이 이것 하나뿐인 이유다.

## 4.3 역할 기반 — 카디널리티로 강도를 조절한다

시드 데이터의 담당자는 전부 역할명이다(`회계담당자`, `총무담당자`, `CS팀장`). 실명 지목이 아닌 경우가 오히려 다수일 것이다.

```
partyScore(role) = 0.85 / (1 + ln(|role members|))
```

| 역할 | 인원 | 점수 | 해석 |
|---|---|---|---|
| 회계팀장 | 1 | 0.85 | 사실상 실명 |
| 회계담당자 | 3 | 0.46 | 유용한 신호 |
| 영업담당자 | 23 | 0.22 | 거의 정보 없음 |

**로그를 쓰는 이유**: 역할 인원이 2배가 되어도 정보량이 절반이 되진 않는다. 선형 감쇠는 과하게 벌한다.

## 4.4 부서 경계 — 세 가지로 쓴다

1. **사전 확률**: 부서 경계에서 문서가 끊기는 게 자연스럽다 → 부서가 다르면 `structure` 가점.
2. **조직도 거리**: SCIM으로 부서 트리를 알므로 공통 조상까지의 홉 수로 인접도를 계산. 같은 본부 내 인접 부서 > 원거리 부서.
3. **역신호**: 같은 부서 안에서 접합이 검출되면 그건 접합이 아니라 **"왜 문서가 두 개인가"**라는 질문이다(J-03: 동일 부서 내 전환인데 요청서를 처음부터 다시 씀 / J-07: 같은 팀 이관인데 티켓 재생성). → 별도 리포트 유형 `내부 이중 기록`으로 분리한다. **이게 제거 후보(ECRS의 E)로 직행하는 금맥이다.**

## 4.5 보고선 방향

그룹웨어 결재는 방향이 있다. 디렉터리의 `managerId`로 상향/하향/수평을 판정하면 링크에 라벨이 붙는다.

- 상향 = **승인 인계** → `hold`+`approval`과 정합해야 한다. 정합하지 않으면 §7의 담당자 불일치 후보.
- 하향 = **지시 인계**
- 수평 = **협업 인계** ← 접합 대기가 가장 길게 쌓이는 곳. 아무도 재촉할 권한이 없어서다.

## 4.6 디렉터리 이벤트 훅

SCIM 웹훅으로 퇴사·부서이동이 들어오면:

```ts
onDirectoryChange(async (evt) => {
  if (evt.type === 'user.deactivated' || evt.type === 'user.dept_changed') {
    await db.update(handoffLinks).set({ status: 'stale' })
      .where(linksTouchingUser(evt.userId));
    // 상대편 소유자에게만 20초 확인. 퇴사자 본인 문서는 열지 않는다 (TRUST §7)
    await queueFreshnessPrompt(counterpartOwners(evt.userId), 'seam_party_changed');
  }
});
```

PRD §4.10의 이벤트 훅을 접합에 그대로 적용한 것이다.

---

# 5. 확정·거부 UX

## 5.1 화면 — 개인 흐름 안의 "이어지는 곳" 패널

조직 뷰가 아니라 **자기 문서 안**에 둔다. 조직 뷰는 결과이지 작업 공간이 아니다.

```
요약 카드 `/workflows/[id]?view=summary` 하단

┌───────────────────────────────────────────────────────────┐
│  이어지는 곳                                                │
│  ─────────────────────────────────────────────────────    │
│  13. 지출결의 상신 → 재무 인계                              │
│  '지출결의서'를 받는다고 적은 흐름이 세 개 있어요.            │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │ 재무 · 회계담당자                        [ 맞아요 ] │     │
│  │ 「월 마감」의 '매입 대사' 단계에서 받아요             │     │
│  │ 그룹웨어 결재 · 지출결의서                          │     │
│  │ ─ 왜 떴나요? 상대 지목이 서로 맞고, 산출물도 같아요.   │     │
│  └─────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────┐     │
│  │ 재무 · 회계담당자                        [ 맞아요 ] │     │
│  │ 「법인카드 정산」의 '증빙 확인' 단계에서 받아요        │     │
│  │ 그룹웨어 결재 · 카드 승인번호                        │     │
│  └─────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────┐     │
│  │ 총무 · 총무담당자                        [ 맞아요 ] │     │
│  │ 「사무실에 뭐 고장났을 때」의 '견적 요청' 단계         │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│  [ 셋 다 아니에요 ]        [ 나중에 볼게요 ]                 │
└───────────────────────────────────────────────────────────┘
```

설계 규칙:

- **3개 고정.** 4개 이상은 고르는 게 일이 된다. 3개가 안 되면 되는 만큼만.
- **1클릭 = 확정.** 상세 페이지를 거치지 않는다. 실수는 절대 되돌릴 수 있으므로(§5.5) 확정을 무겁게 만들 이유가 없다.
- **`왜 떴나요?`가 카드마다 한 줄로 상시 노출.** 접었다 펴지 않는다. ARCHITECTURE §8의 "엣지 호버로 이 연결이 왜 생겼나 설명" 원칙을 그대로 적용 — **자동 그래프의 오해석은 수동 드로잉보다 위험하다.**
- **`셋 다 아니에요`가 `맞아요`와 동일 크기.** 부정 응답의 마찰을 낮춰야 학습 데이터가 모인다.
- 상대 문서 원문은 **한 줄도 보이지 않는다.** 보이는 건 부서·역할·문서 제목·단계 제목·도구·산출물뿐이다(§8의 L0/L1 등급).

## 5.2 양쪽 동의가 필요한가 — 비대칭 확정

**판단: 확정은 한 명으로 충분하다. 단 용도에 따라 문턱이 다르다. 거부는 언제나 한 명이면 즉시 끊긴다.**

| 링크 상태 | 조직 뷰 구조 | 조직 뷰 지표 | **불일치 리포트** | 경영진 리포트 |
|---|---|---|---|---|
| `single` (한쪽 확정) | ○ (`한쪽 확인` 표시) | ○ (신뢰도 0.6 가중) | **✗** | ✗ |
| `confirmed` (양쪽) | ○ | ○ (1.0) | ○ | ○ (접합 유형 5건 이상일 때) |
| `auto` (규칙) | ○ | ○ (0.9) | ○ (7일 이의제기 창 이후) | ○ |

근거:

1. **오류 비용이 다르면 문턱도 달라야 한다.** 조직 뷰의 구조는 틀려도 되돌리기 쉽고 아무도 다치지 않는다. 불일치 리포트는 **경영진에게 가는 주장**이라 틀리면 두 부서 사이에 실제 갈등이 생긴다. 같은 문턱을 쓸 이유가 없다.
2. **양측 동의를 구조 반영의 전제로 걸면 §10이 붕괴한다.** 커버리지 20% 구간에서는 상대가 아직 가입도 안 했다. 그럼 아무것도 안 이어지고, 이 기능은 커버리지 60%가 되기 전까지 죽어 있다. 그건 도입 실패다.
3. **거부가 확정보다 강한 건 §3.8과 일관된다.** FP가 더 나쁘다면, FP를 없애는 행위(거부)는 마찰이 0이어야 하고 FN을 만드는 행위(확정 보류)는 대가가 있어야 한다.

상대에게 가는 확인은 20초짜리 1건이다(WRITING §13 규칙).

```
이지훈 님이 '비품 구매' 흐름에서 이렇게 적었어요.
"지출결의 올리면 재무팀에서 받으시죠?"

박서연 님의 '월 마감' 흐름의 '매입 대사' 단계가 그 다음인 것 같아요.

[ 맞아요 ]  [ 아니에요 ]  [ 그 단계는 아니에요 ]
```

7일 무응답이면 `single`로 유지한다. 재촉하지 않는다.

## 5.3 거부 학습

```ts
export async function rejectCandidate(input: {
  linkId: string; actorId: string;
  reason: 'not_this_work' | 'wrong_person' | 'not_now' | 'not_this_step';
}) {
  const l = await getLink(input.linkId);
  const [a, b] = [l.outboundSocketId, l.inboundSocketId].sort();

  await db.transaction(async (tx) => {
    await tx.update(handoffLinks)
      .set({ status: 'rejected', severedBy: input.actorId, severedAt: new Date() })
      .where(eq(handoffLinks.id, input.linkId));

    await tx.insert(linkSuppressions).values({
      orgId: l.orgId, socketAId: a, socketBId: b,
      reason: input.reason, actorId: input.actorId,
      until: input.reason === 'not_now' ? addDays(new Date(), 90) : null,  // 영구 or 90일
    }).onConflictDoUpdate({
      target: [linkSuppressions.socketAId, linkSuppressions.socketBId],
      set: { reason: input.reason, until: /* 동일 */ null },
    });

    // 라벨쌍 약한 음성 학습 — 3회 이상 독립 거부 시에만 발효 (§11-11)
    if (input.reason === 'not_this_work') {
      await tx.execute(sql`
        INSERT INTO label_pair_penalties (org_id, norm_a, norm_b, reject_count, penalty)
        VALUES (${l.orgId}, ${normA}, ${normB}, 1, 0)
        ON CONFLICT (org_id, norm_a, norm_b) DO UPDATE SET
          reject_count = label_pair_penalties.reject_count + 1,
          penalty = CASE WHEN label_pair_penalties.reject_count + 1 >= 3
                         THEN greatest(-0.15, -0.05 * (label_pair_penalties.reject_count + 1 - 2))
                         ELSE 0 END`);
    }
  });

  // ★ 거부는 최고의 수집 기회다 — 정답 라벨을 받을 수 있는 유일한 순간
  if (input.reason === 'wrong_person')  return { followUp: 'ask_correct_party' };
  if (input.reason === 'not_this_step') return { followUp: 'ask_correct_step' };
  return { followUp: null };
}
```

후속 질문(선택, 건너뛰기 동일 크기):

```
그럼 누구한테 가나요?     ( 사람 검색 )   [ 모르겠어요 ]
```

**조직 간 학습은 하지 않는다.** 어휘가 조직마다 다르고, 무엇보다 A사의 거부 패턴이 B사로 흐르는 경로를 만들면 §8이 무너진다.

## 5.4 같은 쌍을 다시 제안하지 않기

`linkSuppressions`의 PK가 `(socketAId, socketBId)`이고 항상 uuid 오름차순으로 정렬 저장하므로 방향과 무관하게 한 번만 억제된다. 후보 조회 SQL에 `NOT EXISTS` 절이 이미 들어가 있다(§3.5).

주의: 소켓이 **수정되면** 억제를 유지할지 말지 판단해야 한다. 규칙 — **산출물이나 상대방이 바뀌면 억제 해제**(다른 진술이 됐으므로), 도구·밴드만 바뀌면 유지.

## 5.5 확정된 연결 끊기

**언제나, 양쪽 누구나, 단독으로.** 확정과 대칭이 아닌 게 의도다(§5.2 근거 3).

```
조직 뷰에서 링크 클릭 → 인스펙터

  이 연결                                    [ 이어짐 ]
  총무 「비품 구매」 13단계  →  재무 「월 마감」 5단계
  지출결의서 · 그룹웨어 결재
  이지훈 님이 3월 4일에, 박서연 님이 3월 5일에 확인했어요.

  [ 이거 아니에요, 끊을게요 ]
```

끊으면:
- 조직 뷰에서 즉시 제거
- **그 링크에서 파생된 불일치 항목도 함께 사라진다** (`ON DELETE CASCADE`) — 근거가 사라졌는데 결론만 남으면 안 된다
- 90일 재제안 억제
- 상대에게 알림: `이지훈 님이 이 연결을 끊었어요.` — 이유는 묻지도 전달하지도 않는다. 여기서 이유를 전달하면 정치가 시작된다

---

# 6. 조직 프로세스 뷰

## 6.1 시각 구조 — 기본은 문서 지도, 확대해야 단계가 보인다

구매 체인 하나가 4개 문서 × 평균 13단계 = **52노드**다. 이걸 한 화면에 다 그리면 아무도 못 읽는다. ARCHITECTURE §5가 "500스텝은 어차피 사람이 못 읽는다. 접기를 v1부터 넣는다"고 한 그 판단이 여기서 그대로 적용된다.

**semantic zoom 2단계, 전체 펼침 레벨은 존재하지 않는다.**

```
[ 레벨 1 — 접합 지도 (기본) ]

  총무                    재무                     경영
  ┌──────────────┐        ┌──────────────┐        ┌──────────┐
  │ 비품 구매      │──────▶│ 월 마감        │──────▶│ 임원 보고 │
  │ 14단계         │ 지출결의서 │ 14단계        │ 마감 확정  │          │
  │ 7~15일         │  ⚠      │ 8~10일        │        │          │
  └──────────────┘        └──────────────┘        └──────────┘
       │                        ▲
       │ 카드 승인번호            │
       └───▶┌──────────────┐────┘
            │ 법인카드 정산  │
            │ 12단계         │
            └──────────────┘

  전체 24~31일 · 기다리는 시간이 84% · 인계 8번 · 시스템 9번 바뀜


[ 레벨 2 — 접합 구간 ±2단계만 펼침 ]

  총무 「비품 구매」                  재무 「월 마감」
   … 12. 세금계산서 수취 확인
       13. 지출결의 상신  ──── 지출결의서 ────▶  5. 매입 대사
       14. 요청자 완료 통보                        6. 은행 거래내역 조회 …
                          ⚠ 총무 1일 · 재무 4일
```

- 레벨 1이 **홈**이다. 조직 뷰를 열면 이게 보인다.
- 레벨 2는 접합 클릭 시 그 접합 주변만 펼친다. **문서 전체를 펼치는 UI는 없다** — 가독성과 프라이버시가 같은 방향으로 정렬된 드문 경우다.
- 레인은 **사람이 아니라 부서**다. 사람 레인을 만드는 순간 개인별 화면이 된다(TRUST 절대 원칙 2 위반).
- 색은 새로 만들지 않는다. 접합 엣지는 DESIGN.md의 인계 마커 색 `#6E4666`을 굵게(3px) 쓰고, 부서 경계 접합만 양쪽에 부서 칩을 붙인다.

## 6.2 읽기 전용 고정이 UI에 반영되는 방식

"편집 버튼을 비활성화"가 아니다. **편집이라는 개념이 이 화면에 존재하지 않는다.**

| 장치 | 구현 |
|---|---|
| 도구 부재 | 노드 추가·삭제·연결 도구가 툴바에 **없다**. 비활성 상태로도 없다 |
| 커서 | 노드 `cursor: default`. 드래그 핸들·리사이즈 핸들 미렌더 |
| React Flow | `nodesDraggable={false} nodesConnectable={false}`, `elementsSelectable`만 true (D-038과 동일) |
| 상단 고정 배지 | `조직 흐름은 보기 전용이에요. 고치는 건 각자 흐름에서요.` |
| 노드 클릭 | `이 단계는 총무팀 흐름이에요.` + 자기 문서일 때만 `[ 내 흐름에서 열기 ]` 활성 |
| 유일한 쓰기 행위 | **링크 끊기 · 불일치 확인함 표시.** 그것도 자기 소켓이 관여한 링크만 |
| 서버 강제 | 조직 뷰 라우트에서 `applyOps`를 import하지 않는다. 조립 서비스는 읽기 전용 DB 롤로 실행 |

**왜 이렇게까지.** 조직 뷰에서 편집이 열리면 "내 흐름인데 남이 고쳤다"가 발생하고, 그 순간 개인 문서 소유권(절대 원칙 1)이 무너진다. 소유권은 권한 설정이 아니라 **편집 가능한 표면이 하나뿐이라는 사실**로 지켜진다.

## 6.3 부서를 넘는 지점의 강조

시각적으로 강조할 게 세 가지 있고, 셋을 다 강조하면 아무것도 강조되지 않는다. 우선순위를 둔다.

1. **불일치가 있는 접합** — `⚠` + 엣지 위 라벨 `1일 vs 4일`. 유일하게 색을 쓴다(경고색 아님. `#9E6511` 분기 액센트 재사용)
2. **부서 경계** — 엣지에 부서 칩 2개. 색 변화 없음
3. **긴 접합 대기** — 엣지 길이가 아니라 **엣지 중앙의 대기 칩** `4일 대기`. 선 굵기를 시간에 비례시키지 않는다(D-021: 집계를 그리지 않는다)

## 6.4 조직 뷰에서만 나오는 지표

```ts
export function orgMetrics(chain: AssembledChain): OrgMetrics {
  const docs  = chain.documents;
  const links = chain.links.filter(l => l.linkType !== 'overlap');   // ★ 이중 계산 방지

  const touchH = sum(docs.flatMap(d => d.items.map(i => bandToHours(i.durationBand) * branchWeight(i))));
  const holdH  = sum(docs.flatMap(d => d.items.filter(i => i.kind === 'hold')
                                              .map(i => i.attrs.avgWaitH ?? 0)));
  // ★ 접합 대기 — 개인 문서 어디에도 없는 값. 조직 뷰의 존재 이유
  const seamH  = sum(links.map(l => seamWaitHours(l)));

  const leadTimeH = touchH + holdH + seamH;

  return {
    leadTimeH,
    handoffCount: links.length + sum(docs.map(assigneeChangesWithin)),
    waitRatio: (holdH + seamH) / leadTimeH,           // 시드 기준 60~96%
    seamWaitShare: seamH / (holdH + seamH),           // ★ 접합 대기가 총 대기의 몇 %인가
    toolSwitches: countToolSwitches(chain),           // 문서 내 + 접합 넘어
    reentryPoints: findReentry(chain),                // 같은 산출물이 3개 이상 도구에 등장
    deptCount: new Set(docs.map(d => d.deptId)).size,
    confidence: Math.min(...links.map(linkConfidence)), // ★ weakest-link (§11-1)
  };
}

/**
 * 접합 대기: 양쪽 진술이 다르면 큰 쪽을 쓰고 불일치를 등록한다.
 * "둘 중 뭐가 맞나"를 우리가 판정하지 않는다 — 판정하는 순간 한쪽이 틀린 사람이 된다.
 */
function seamWaitHours(l: LinkWithSockets): number {
  const a = lagBandToHours(l.out.lagBand), b = lagBandToHours(l.in.lagBand);
  if (a == null && b == null) return DEFAULT_SEAM_WAIT_H;   // 24h. 보수적 기본값
  return Math.max(a ?? 0, b ?? 0);
}
```

**`reentryPoints`가 조직 뷰의 최고 산출물이다.** FIN-02의 "홈택스↔ERP↔엑셀 3중 입력"은 개인 문서 하나만 봐서는 "3번 입력한다"로 보이지만, 조직 뷰에서는 **같은 산출물이 4개 부서에서 6번 재입력되는 것**이 보인다. 자동화 후보 1순위가 여기서 자동으로 나온다.

**대기시간 비중 표시 문구** (WRITING 금지어 회피 — "낭비"·"비효율" 금지):

```
직원·당사자 화면:  이 흐름은 24일 걸리는데, 그중 20일은 기다리는 시간이에요.
관리자 화면:      리드타임 24일 중 대기 20일(84%). 대기의 절반이 부서 사이 접합에서 발생합니다.
```

## 6.5 개인 흐름이 수정되면 조직 뷰는 어떻게 갱신되는가

**조직 뷰는 저장하지 않는다.** ARCHITECTURE §0의 `graph = derive(tree) ⊕ overrides`와 같은 철학이다.

```
orgGraph = assemble(documents, confirmedLinks)
```

`assemble`은 `packages/graph-core/src/assemble.ts`의 순수 함수다. 저장하면 문서와 조직 뷰가 어긋난 상태(split brain)를 영원히 관리하게 된다.

다만 **집계 지표는 파생 비용이 크므로 롤업 테이블로 캐시**하고, 무효화 규칙을 둔다.

| 개인 문서 변경 | 조직 뷰 반응 |
|---|---|
| 소켓과 무관한 단계 수정 | 즉시 반영(파생). 롤업은 야간 |
| 소켓이 걸린 아이템의 **제목·산출물 변경** | 링크 `stale` → 재검증 큐 → 양쪽에 20초 확인 |
| 소켓이 걸린 아이템 **삭제** | 링크 `orphaned` (자동 절단 아님) → 소유자에게 `이 단계 지우셨는데, 재무팀과 이어둔 연결은 어떻게 할까요? [끊기] [다른 단계로 옮기기]` |
| 문서 삭제 | 링크 즉시 `severed`, 파생 불일치 삭제 |
| 문서 아카이브(12개월 무확인) | 링크 `stale`, 조직 뷰에서 `opacity .4` |
| 담당자 변경(SCIM) | §4.6 |

```ts
// 롤업 무효화 — 접합 반경만 다시 계산한다. 전량 재계산 금지
export async function invalidateOnDocChange(docId: string, changed: ItemId[]) {
  const affected = await db.select().from(handoffLinks)
    .where(linksTouchingItems(changed));
  if (affected.length === 0) return;              // 대부분의 편집이 여기서 끝난다
  await enqueueChainRollup(chainsContaining(affected.map(l => l.id)));
}
```

신선도: 링크에도 `lastVerifiedAt`이 있고 180일이 지나면 조직 뷰에서 흐려지며 **불일치 리포트의 Confidence가 감쇠**한다(§7.2).

---

# 7. 불일치 리포트 — 1급 뷰

## 7.1 공통 원칙 4개

1. **"누가 틀렸나"가 아니라 "경계가 안 맞는다"로 쓴다.** 총무의 "1일"과 재무의 "4일"은 **둘 다 사실**이다. 총무는 자기 손을 떠나는 시점까지, 재무는 증빙 확인이 끝나는 시점까지를 말한다. 우리가 찾은 건 거짓말이 아니라 **경계 정의 불일치**다. 이 프레이밍이 리포트 전체를 정치에서 구한다.
2. **표현 차이 필터.** 소요시간은 로그 스케일 버킷이고 자기보고 오차가 ±100~300%다. **인접 밴드 차이(반나절 vs 하루)는 불일치가 아니다.** 2밴드 이상부터 검출한다. 이 필터가 없으면 리포트의 80%가 잡음이다.
3. **양측 확정 링크에서만 생성한다**(§5.2).
4. **주어는 항상 부서 또는 역할.** 개인 이름은 리포트 어디에도 등장하지 않는다.

## 7.2 심각도

```
SeverityScore = Impact × Confidence × Frequency

Impact      리드타임 영향(일) 또는 재작업 발생 또는 규정·리스크 노출
Confidence  링크 상태(confirmed 1.0 / auto 0.9 / single 0 — 애초에 제외)
            × 신선도 감쇠(180일 0.85, 365일 0.7)
            × 자가추정 신뢰도(PRD §4.8: 자가추정 0.5 / 동료합의 0.75 / 실측 1.0)
Frequency   min(양쪽 월 발생 건수)   ← 한쪽만 자주 있는 건 접합 빈도가 아니다
```

등급 라벨은 숫자를 쓰지 않는다.

| 등급 | 기준 | 라벨 |
|---|---|---|
| high | Score ≥ 40 또는 규정·리스크 유형 | **크게 어긋나 있어요** |
| mid | 10 ≤ Score < 40 | **어긋나 있어요** |
| low | < 10 | **표현이 달라요** |

## 7.3 유형 13종

### ① 리드타임 불일치

**검출**

```sql
CREATE FUNCTION lag_band_idx(b text) RETURNS int IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE b WHEN 'immediate' THEN 0 WHEN 'same_day' THEN 1 WHEN '1d' THEN 2
                WHEN '2-3d' THEN 3 WHEN '1w' THEN 4 WHEN 'batch_monthly' THEN 5
                ELSE NULL END $$;

INSERT INTO discrepancies (org_id, link_id, kind, severity, severity_score, facts)
SELECT l.org_id, l.id, 'lead_time',
       sev_label(s.sev), s.sev,
       jsonb_build_object(
         'upstream',   jsonb_build_object('dept', du.dept_id, 'band', o.lag_band),
         'downstream', jsonb_build_object('dept', dd.dept_id, 'band', i.lag_band),
         'gap_bands',  abs(lag_band_idx(o.lag_band) - lag_band_idx(i.lag_band)))
FROM handoff_links l
JOIN handoff_sockets o ON o.id = l.outbound_socket_id
JOIN handoff_sockets i ON i.id = l.inbound_socket_id
JOIN documents du ON du.id = o.doc_id
JOIN documents dd ON dd.id = i.doc_id
CROSS JOIN LATERAL (SELECT severity_score(l, o, i) AS sev) s
WHERE l.status IN ('confirmed','auto')
  AND lag_band_idx(o.lag_band) IS NOT NULL
  AND lag_band_idx(i.lag_band) IS NOT NULL
  AND abs(lag_band_idx(o.lag_band) - lag_band_idx(i.lag_band)) >= 2   -- ★ 표현 차이 필터
ON CONFLICT (link_id, kind) DO UPDATE SET severity_score = EXCLUDED.severity_score;
```

**경영진 표현**

> **지출결의서 접합 — 총무는 1일, 재무는 4일로 봅니다**
> 같은 구간을 서로 다르게 세고 있습니다. 총무는 상신 완료까지를, 재무는 증빙 확인까지를 셉니다.
> 실제 리드타임은 **5일**로 보아야 하며, 월 26건이면 이 접합에서만 **월 78일**이 대기로 쌓입니다.
> 먼저 할 것: 증빙 요건을 상신 화면에 미리 표시. 개발 없음.

### ② 산출물 불일치

**검출** — 세 하위 유형으로 나눈다.

```ts
export function detectArtifactMismatch(l: LinkWithSockets): Discrepancy[] {
  const out: Discrepancy[] = [];
  const A = l.out.artifacts, B = l.in.artifacts;

  // ②-a 수량 — '견적 2곳' vs '견적 3곳'
  for (const a of A) for (const b of B)
    if (sameObject(a, b) && a.qty && b.qty && a.qty !== b.qty)
      out.push(mk('artifact_qty', { label: a.labelNorm, upstream: a.qty, downstream: b.qty }));

  // ②-b 필수 여부 — 받는 쪽은 필수인데 주는 쪽은 안 준다
  for (const b of B.filter(x => x.isRequired))
    if (!A.some(a => sameObject(a, b)))
      out.push(mk('artifact_missing', { label: b.labelNorm }, 'high'));  // ★ 재작업 직결

  // ②-c 여분 — 주는데 안 쓴다 → 제거 후보(ECRS의 E)
  for (const a of A)
    if (!B.some(b => sameObject(a, b)))
      out.push(mk('artifact_unused', { label: a.labelNorm }, 'low'));
  return out;
}
```

②-c가 **제거 후보를 자동 생성한다.** "총무가 매번 첨부하는 견적 비교표를 재무는 안 본다" 같은 게 여기서 나오고, 이건 개발 0줄 개선이다(SEED-CONTENT D-4의 X-1·X-2와 같은 종류).

**경영진 표현**

> **견적서 접합 — 총무는 2곳, 재무는 3곳을 요건으로 봅니다**
> 월 6건 중 평균 2건이 재견적으로 되돌아갑니다. 되돌아갈 때마다 **2일**이 추가됩니다.
> 먼저 할 것: 금액 구간별 견적 수 기준을 한 곳에만 적어 두기.

### ③ 존재 불일치 (한쪽만 있다고 하는 단계)

**검출** — 접합 ±2단계 창에서 한쪽에만 있는 산출물/도구/행위 명사를 찾는다. 순수 텍스트 비교가 아니라 **정규화된 산출물·도구 집합의 차집합**으로 본다(§8 프라이버시: 원문 비교를 하지 않는다).

```sql
-- 재무는 '수취 계산서 확인'을 하는데 총무 문서에는 세금계산서 언급이 없다
SELECT l.id, 'step_existence',
       jsonb_build_object('only_in', 'downstream', 'object', bo.canonical_name)
FROM handoff_links l
JOIN seam_window_objects wo_in  ON wo_in.link_id  = l.id AND wo_in.side  = 'in'
LEFT JOIN seam_window_objects wo_out ON wo_out.link_id = l.id AND wo_out.side = 'out'
                                     AND wo_out.object_id = wo_in.object_id
JOIN business_objects bo ON bo.id = wo_in.object_id
WHERE l.status IN ('confirmed','auto') AND wo_out.object_id IS NULL
  AND bo.object_class IN ('evidence','approval');   -- 증빙·결재만. 잡음 억제
```

**표현**: `재무는 세금계산서 확인 단계를 두고 있는데, 총무 흐름에는 그 단계가 없습니다. 총무는 이걸 "당연히 하는 일"로 여겨 안 적었거나, 실제로 안 하고 있습니다. 둘 중 어느 쪽인지가 중요합니다.`

### ④ 순서 불일치

**검출**: 두 문서가 **같은 산출물 두 개**를 다루는데 순서가 반대인 경우.

```
총무:  발주 → 세금계산서 수취 → 지출결의
재무:  지출결의 → 세금계산서 대사
```

산출물 쌍의 선후 관계 그래프를 만들고 **사이클을 찾는다**(위상 정렬 실패 지점 = 순서 불일치).

```ts
const g = buildPrecedenceGraph(chain);   // 노드 = objectId, 엣지 = 선행 관계
const cycles = findCycles(g);            // Tarjan SCC
```

**표현**: `지출결의와 세금계산서 수취의 선후가 두 부서에서 반대로 적혀 있습니다. 실제로는 둘 다 발생하고 있어, 월 3~5건이 순서 때문에 반려됩니다.`

### ⑤ 담당자 불일치

**검출** 3가지 경로:
- (a) 상대 지목 모순: A는 B를 지목했는데 B의 소켓은 C를 지목 (`partyConflict` 플래그가 이미 매칭 단계에서 잡혀 있다)
- (b) 역할 모순: 상류는 "재무팀장이 확인한다"고 적고 하류는 "회계담당자가 한다"고 적음
- (c) **책임 공백**: 양쪽 다 상대가 한다고 적음 → **가장 심각**

```sql
-- (c) 서로 상대가 한다고 적은 경우
SELECT l.id, 'owner_gap', 'high'
FROM handoff_links l
JOIN seam_window_items wo ON wo.link_id = l.id AND wo.side = 'out'
JOIN seam_window_items wi ON wi.link_id = l.id AND wi.side = 'in'
WHERE wo.object_id = wi.object_id
  AND wo.assignee_role_id = wi.owner_role_id      -- 상류: "저쪽이 한다"
  AND wi.assignee_role_id = wo.owner_role_id;     -- 하류: "저쪽이 한다"
```

**표현**: `수정세금계산서 요청은 CS와 재무 양쪽 모두 "상대가 한다"고 적었습니다. 월 2건이 마감 대사에서 뒤늦게 발견됩니다.` (J-09가 정확히 이 케이스)

### ⑥ 도구 불일치

**검출**: 접합의 채널 도구가 다르다. 단, **도구 클래스가 같으면 낮은 등급**(슬랙 vs 팀즈는 low, 슬랙 vs 그룹웨어 결재는 high — 기록 여부가 다르다).

```ts
const CLASS = { slack: 'im', kakao: 'im', teams: 'im',
                groupware_approval: 'formal', erp: 'formal',
                email: 'email', phone: 'ephemeral', verbal: 'ephemeral' };

function toolSeverity(a: ToolId, b: ToolId) {
  if (CLASS[a] === CLASS[b]) return 'low';
  // ★ 한쪽이 휘발성(전화·구두)이면 항상 high — 기록이 존재하지 않는다
  if (CLASS[a] === 'ephemeral' || CLASS[b] === 'ephemeral') return 'high';
  return 'mid';
}
```

**표현**: `물류는 품절을 슬랙 #물류공지에 올린다고 하고, CS는 메일로 받는다고 합니다. 실제로는 어느 쪽도 확실히 받지 못하고 있습니다.` (J-19)

### ⑦ 조건 불일치 (분기 기준)

**검출**: 양쪽 문서의 `branch` 갈래 라벨에서 **금액·기간 임계값을 파싱해 비교**한다. 한국어 금액 표기 정규화가 필요하다.

```ts
/** '500만 원', '5,000,000', '300만원 초과' → 5_000_000 / 3_000_000 */
export function parseKrw(s: string): number | null {
  const t = normalizeKo(s);
  const m = t.match(/(\d+(?:\.\d+)?)(억|천만|백만|만|천)?원?/);
  if (!m) return null;
  const unit: Record<string, number> = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3 };
  return Number(m[1]) * (unit[m[2] ?? ''] ?? 1);
}

export function detectConditionMismatch(a: BranchCase, b: BranchCase) {
  const [x, y] = [parseKrw(a.caseLabel), parseKrw(b.caseLabel)];
  if (x == null || y == null || x === y) return null;
  const ratio = Math.max(x, y) / Math.min(x, y);
  return { kind: 'condition', facts: { upstream: x, downstream: y, gapRatio: ratio },
           severity: ratio >= 2 ? 'high' : 'mid' };
}
```

**표현**: `총무는 300만 원 초과부터 임원 결재로 보고, 재무는 500만 원으로 봅니다. 그 사이 구간(월 3건)에서 매번 결재선을 되묻고 있습니다.`

### ⑧ 고아 단계 (넘긴다는데 받는 사람이 없다)

**검출**

```sql
SELECT o.id AS socket_id, o.doc_id, o.party_user_id, o.party_dept_id,
       CASE
         WHEN u.id IS NULL                    THEN 'no_such_person'
         WHEN u.last_active_at IS NULL        THEN 'not_onboarded'   -- 아직 안 씀
         WHEN NOT EXISTS (SELECT 1 FROM handoff_sockets s2
                          WHERE s2.doc_id IN (SELECT id FROM documents WHERE owner_id = u.id)
                            AND s2.direction = 'inbound')
                                              THEN 'no_inbound_socket'
         ELSE 'genuinely_unclaimed'                                  -- ★ 진짜 고아
       END AS orphan_kind
FROM handoff_sockets o
LEFT JOIN users u ON u.id = o.party_user_id
WHERE o.direction = 'outbound' AND o.source = 'asked' AND o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM handoff_links l
                  WHERE l.outbound_socket_id = o.id AND l.status IN ('confirmed','auto','single'))
  AND o.created_at < now() - interval '14 days';
```

**`orphan_kind` 구분이 §10의 핵심이다.** `not_onboarded`는 커버리지 문제(초대 타깃), `genuinely_unclaimed`만 진짜 조직 문제다. 커버리지 20% 구간에서 이 둘을 섞으면 리포트가 전부 거짓말이 된다.

**표현** (`genuinely_unclaimed`만 리포트에 올린다):
> **미증빙 리스트 — 넘기는 쪽은 있는데 받는 쪽이 없습니다**
> 재무는 퇴사자 미증빙 건을 인사로 넘긴다고 적었으나, 인사 쪽 어느 흐름에도 이걸 받는 단계가 없습니다.
> 월 1~2건이 아무에게도 속하지 않은 채 남습니다. (J-20)

### ⑨ 유령 단계 (받는다는데 보내는 사람이 없다)

⑧의 대칭. 다만 해석이 다르다. **유령은 대개 "상류가 자기 일이라고 인식하지 못하는" 경우**다.

**표현**: `영업은 마케팅에서 유효 리드를 받는다고 적었으나, 마케팅 흐름에는 영업으로 넘기는 단계가 없습니다. 마케팅은 콘텐츠 게시를 종료로 보고 있습니다.` (J-17의 구조적 원인)

### ⑩ 물량·정의 불일치

⑧⑨와 다르다. 접합은 존재하는데 **세는 단위가 다르다.**

**검출**: 양쪽 `freqLast7d`를 월 환산해 비교. 비율 ≥ 2배면 검출.

**표현**: `마케팅은 리드 45건을 넘겼다고 하고, 영업은 12건을 받았다고 합니다. 3.75배 차이는 전달 누락이 아니라 "리드"의 정의가 다르다는 뜻입니다. 유효 리드 기준을 한쪽에만 두면 이 차이는 사라집니다.` (J-17)

### ⑪ 기준 시점 불일치

**검출**: 같은 산출물에 대해 양쪽이 다른 시점 기준을 적은 경우(`출고일` vs `검수일`, `발행일` vs `입금일`). 시점 명사 사전 기반.

**표현**: `물류는 출고일 기준으로, 재무는 검수일 기준으로 매출을 인식합니다. 월말 3~4일 구간의 건이 매달 두 번 계산되거나 빠집니다.` (J-06)

### ⑫ 이중 기록 / 이중 요구

**검출**: `link_type = 'overlap'` 또는 같은 산출물을 양쪽이 각각 다른 시스템에 입력.

**표현**: `카드 승인번호가 총무의 지출결의와 재무의 카드 정산에서 각각 요구됩니다. 같은 증빙을 두 번 제출하고 있습니다. 월 18건.` (J-02)

### ⑬ 되돌림 불일치

**검출**: `hold`+`approval`의 반려 시 돌아가는 지점이 양쪽에서 다르게 적힌 경우(`attrs.returnToItemId`가 가리키는 단계의 산출물 비교).

**표현**: `반려되면 총무는 견적 단계로 돌아간다고 보고, 재무는 요청 접수부터 다시 한다고 봅니다. 월 2~3건의 반려마다 어디서 다시 시작할지를 매번 협의합니다.`

## 7.4 리포트 화면

```
관리자 대시보드 > 서로 다르게 알고 있는 것          (내부명: 불일치 리포트)

  이번 달 24건 · 크게 어긋난 것 5건

  ┌──────────────────────────────────────────────────────────┐
  │ 크게 어긋나 있어요                                          │
  │ 지출결의서 접합 · 총무 → 재무 · 월 26건                      │
  │                                                          │
  │   총무           재무                                      │
  │   1일     ──▶   4일                                       │
  │                                                          │
  │ 같은 구간을 서로 다르게 세고 있습니다. 총무는 상신 완료까지를,  │
  │ 재무는 증빙 확인까지를 셉니다. 실제 리드타임은 5일입니다.       │
  │ 이 접합에서만 월 78일이 대기로 쌓입니다.                      │
  │                                                          │
  │ 먼저 할 것 · 증빙 요건을 상신 화면에 미리 표시 (개발 없음)      │
  │                                                          │
  │ [ 확인함 ]   [ 이건 문제 아니에요 ]   [ 백로그에 넣기 ]         │
  └──────────────────────────────────────────────────────────┘

  고정 각주:
  이 표는 구간을 재는 방식의 차이를 보여줍니다. 지연의 책임을 뜻하지 않습니다.
```

`이건 문제 아니에요`가 필요한 이유: 의도적인 차이가 실재한다(재무가 4일을 쓰는 게 규정상 맞는 경우). 이걸 누를 수 없으면 리포트가 잔소리가 되고, 잔소리는 3개월 안에 무시된다.

---

# 8. 프라이버시 제약과의 충돌

## 8.1 해법의 한 줄

**매칭은 문서가 아니라 "소켓"이라는 의도적으로 얇게 만든 공개면에서만 일어난다.**

문서는 여전히 비공개다. 소켓은 처음부터 **공개될 것을 알고 적는 두 줄**이다. 이 사실을 입력 시점에 UI로 말한다(§2.2: `이 두 줄은 받는 쪽에도 보여요`).

## 8.2 상대 문서를 못 보는 상태에서 매칭이 가능한가 — 가능하다

매칭 파이프라인은 `items.title` 원문에 접근하지 않는다. **타입으로 강제한다.**

```ts
// packages/graph-core/src/matching/types.ts
// ★ 이 타입에 원문 필드가 없다는 사실이 프라이버시 보증이다.
export interface SocketFeature {
  socketId: string; docId: string; orgId: string;
  ownerId: string; deptId: string; assigneeIdOfItem?: string;
  direction: 'outbound' | 'inbound';
  artifacts: { objectId?: string; labelNorm: string; objectClass?: ObjectClass;
               identifierKey?: string; qty?: number }[];   // ← labelRaw 없음
  toolIds: string[];
  party: { kind: PartyKind; userId?: string; roleId?: string; deptId?: string; rawNorm?: string };
  itemTitleNorm: string;      // ← 정규화·조사절단을 거친 결과. 원문 복원 불가
  channelScreenNorm?: string;
  lagBand: LagBand; cadenceKey?: string;
  boundary: 'first' | 'last' | 'mid';
  source: SocketSource; confidence: number; lastConfirmedAt?: Date;
}
```

- 정규화(`normArtifact`, `normTitle`)와 그림자 소켓 추론(§2.3)은 **소유자 테넌트 안에서** 실행되고, 밖으로 나오는 건 `SocketFeature`뿐이다.
- `itemTitleNorm`은 조사·어미가 잘리고 공백이 제거된 문자열이라 원문 복원이 불가능하고, 어차피 매칭 결과 UI에는 노출되지 않는다.
- CI 테스트: `matching/*`이 `items.title`·`attrs.privateNote`·`comments`를 참조하면 빌드 실패(ESLint `no-restricted-imports` + 타입 검사).

## 8.3 조직 뷰 공개 등급 3단

| 등급 | 내용 | 열리는 조건 |
|---|---|---|
| **L0** | 문서 제목, 부서, 산출물명, 접합 대기 밴드, 단계 수 | 링크 후보 단계부터. **원문 없음** |
| **L1** | 접합 ±1단계의 **단계 제목**, 담당 역할, 도구 | **양쪽 확정 시** |
| **L2** | 문서 전문 | **소유자가 공유 링크를 발급했을 때만.** 자동으로 열리는 경로가 존재하지 않는다 |

후보 카드(§5.1)는 **L0만** 쓴다. 문서 제목은 노출한다 — 업무명은 조직 지식이고 이미 온보딩 칩(`월 마감`, `비품 사달라고 하면`)으로 전사 공개된 어휘다. 단계 제목은 확정 전에는 노출하지 않고 `'지출결의서'를 받는 단계가 있어요`라는 **생성된 문장**으로 대체한다.

## 8.4 불일치 리포트에 "누가 뭐라고 적었는지"가 드러나는가

**부서·역할 단위로는 드러난다. 개인 단위로는 드러나지 않는다. 그리고 5인 미만 규칙이 여기서 그대로 적용된다.**

여기에 진짜 난제가 있다. **접합은 본질적으로 2인 사이에서 일어난다.** "총무 1일 vs 재무 4일"의 기여자는 2명이다. 5인 미만 차단을 문자 그대로 적용하면 불일치 리포트는 **영원히 한 건도 못 만든다.**

**해법: 집계 단위를 접합 인스턴스가 아니라 접합 유형으로 올린다.**

```sql
CREATE VIEW agg_seam_discrepancy WITH (security_barrier) AS
WITH typed AS (
  SELECT
    d.org_id, d.kind,
    canonical_dept_pair(du.dept_id, dd.dept_id) AS dept_pair,
    bo.id AS object_id, bo.canonical_name,
    count(*)                                    AS link_n,
    count(DISTINCT du.owner_id) + count(DISTINCT dd.owner_id) AS contributor_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY d.severity_score) AS sev_med,
    mode() WITHIN GROUP (ORDER BY d.facts->>'upstream')   AS upstream_modal,
    mode() WITHIN GROUP (ORDER BY d.facts->>'downstream') AS downstream_modal
  FROM discrepancies d
  JOIN handoff_links l ON l.id = d.link_id AND l.status IN ('confirmed','auto')
  JOIN handoff_sockets o ON o.id = l.outbound_socket_id
  JOIN handoff_sockets i ON i.id = l.inbound_socket_id
  JOIN documents du ON du.id = o.doc_id
  JOIN documents dd ON dd.id = i.doc_id
  LEFT JOIN socket_artifacts sa ON sa.socket_id = o.id AND sa.role = 'primary'
  LEFT JOIN business_objects bo ON bo.id = sa.object_id
  GROUP BY 1,2,3,4,5
)
SELECT org_id, kind, dept_pair, canonical_name,
       round(link_n / 5.0) * 5 AS link_n_rounded,
       sev_med, upstream_modal, downstream_modal
FROM typed
WHERE link_n >= 5              -- ★ 같은 (부서쌍 × 산출물) 접합이 5건 이상
  AND contributor_n >= 5;      -- ★ 그리고 기여자 5인 이상

GRANT SELECT ON agg_seam_discrepancy TO admin_reader;
```

**단건 접합의 불일치는 당사자 두 명에게만 보인다.** 관리자에게는 올라가지 않는다. 그리고 그게 옳다 — 단건 불일치는 두 사람이 5분 대화로 푸는 문제이고, 5건 이상 반복되는 불일치가 조직 구조 문제다.

MEASUREMENT §3의 추가 방어 4가지(임의 기간 파라미터 제거, 필터 2개 상한, 드릴다운 부재, 퍼즈 테스트)를 이 뷰에 그대로 적용한다.

## 8.5 A가 "B가 늦는다"고 적은 걸 B가 볼 수 있어야 하는가

**판단: 자유 텍스트는 절대 안 된다. 구조화된 값은 반드시 양방향 대칭으로 보인다.**

| 데이터 | 상대에게 | 근거 |
|---|---|---|
| 예외 메모 (`김 과장님은 오전에 연락하면 잘 안 받으세요`) | **절대 비공개** | TRUST 공포 3의 "실제로는 이렇게 합니다" 비공개 노트와 같은 층. 이게 새면 아무도 실제대로 안 적는다 |
| 짜증 플래그 | **절대 비공개** (익명 신호) | TRUST 원칙 |
| 접합 대기 밴드 (`4일`) | **양쪽에 동시에, 같은 화면으로** | |
| 산출물·도구·상대 지목 | **양쪽에 동시에** | |

근거 3가지:

**1. 조직 정치의 지뢰는 "정보의 존재"가 아니라 "정보의 비대칭"이다.** A만 볼 수 있으면 그건 고발 장치다. 양쪽이 같은 화면을 동시에 보면 그건 조율이다. 실제 BPM 워크숍이 하는 일이 정확히 이것 — 두 부서를 한 방에 앉히고 같은 보드를 보게 하는 것 — 이고, 우리는 그걸 비동기로 재현하는 것뿐이다.

**2. 그래서 질문 설계로 정치를 미리 제거한다.** 우리는 **"상대가 얼마나 늦나요?"를 절대 묻지 않는다.** 묻는 건 언제나 자기 구간이다:

```
○  이 일 하는 데 얼마나 걸려요?
○  받고 나서 얼마나 있다가 다음으로 넘어가요?
✗  넘겨받는 데 얼마나 기다리세요?
✗  저쪽에서 얼마나 늦게 주나요?
```

애초에 상대 평가를 수집하지 않으므로, 노출해도 상대 평가가 노출되지 않는다. **비대칭 노출 금지는 수집 설계와 짝일 때만 작동한다.**

**3. 알림 문구가 중립이어야 한다.**

```
같은 구간을 서로 다르게 적으셨어요.
어느 쪽이 맞는 게 아니라, 재는 구간이 서로 달라서예요.

  이지훈 님   1일
  박서연 님   4일

[ 알겠어요 ]  [ 제 쪽을 고칠게요 ]
```

`제 쪽을 고칠게요`만 있고 `상대에게 알리기`는 없다. 상대에게 압력을 넣는 버튼을 만들지 않는다.

## 8.6 누가 무엇을 보는가 — 정본 매트릭스

| | 당사자 2인 | 같은 부서 | 다른 부서 | 관리자(집계) |
|---|---|---|---|---|
| 문서 전문 | 소유자만 | ✗ | ✗ | ✗ |
| 예외 메모·비공개 노트·짜증 | 본인만 | ✗ | ✗ | 5인 이상 익명 집계만 |
| 접합 소켓 (상대·산출물) | ○ | ✗ | 링크 확정 시 ○ | ✗ |
| 접합 ±1단계 제목 | 링크 확정 시 ○ | ✗ | 링크 확정 시 ○ | ✗ |
| 조직 뷰 구조 (문서 지도) | ○ | ○ | ○ | ○ |
| 불일치 (단건) | ○ | ✗ | ✗ | **✗** |
| 불일치 (접합 유형 5건+ / 기여자 5인+) | ○ | ○ | ○ | ○ |
| 체크리스트 실행 기록 | 본인만 | ✗ | ✗ | ✗ |

---

# 9. 바이럴 루프

## 9.1 발송 조건 — 전부 AND

| # | 조건 | 왜 |
|---|---|---|
| 1 | 상대가 디렉터리에서 **1명으로 특정**됨 | 역할이 다수면 발송 금지. 스팸의 최대 원인 |
| 2 | 상대에게 짝이 될 inbound 소켓이 없음 | 이미 이어져 있으면 초대가 아니라 확인이다 |
| 3 | 발신자가 **5단계 이상 저장 완료** | 미완성 문서로 남을 부르지 않는다 |
| 4 | 수신자 쿨다운 **14일 1건** | WRITING §13-5 규칙 그대로 |
| 5 | 발신자 상한 **주 3건**, 미응답 대기 **5건 이하** | 미응답이 쌓이면 자동으로 막힌다 |
| 6 | 롤아웃 단계 게이트 | 파일럿 중엔 파일럿 부서 밖 발송 금지 |
| 7 | 평일 09~18시. 금요일 오후·주말 금지 | 사내 알림 예의 |
| 8 | 같은 흐름에 대해 이미 거절한 사람에겐 **영구 금지** | |

```ts
export async function canInvite(s: SocketFeature, actor: User): Promise<Gate> {
  if (s.party.kind !== 'user' || !s.party.userId) return no('party_not_resolved');
  if (await hasInboundSocketFor(s.party.userId, s.artifacts)) return no('already_linked');
  if (!(await docIsSaved(s.docId, 5))) return no('doc_incomplete');
  if (await sentWithin(s.party.userId, days(14))) return no('recipient_cooldown');
  if (await sentByThisWeek(actor.id) >= 3) return no('sender_weekly_cap');
  if (await pendingByThisSender(actor.id) >= 5) return no('sender_pending_cap');
  if (!rolloutAllows(actor.deptId, s.party.deptId)) return no('rollout_stage');
  if (!inBusinessHours()) return defer(nextBusinessSlot());
  if (await declinedBefore(s.party.userId, s.docId)) return no('declined_forever');
  return yes();
}
```

**조직 단위 서킷 브레이커**: 최근 30일 `invite_declined_rate > 40%`면 그 조직의 초대 발송을 전면 중단하고 제품팀 알림. 소켓 품질 문제인데 초대를 계속 쏘면 조직 전체가 이 기능을 거부한다.

## 9.2 문구 (WRITING §10·§13 계승, 느낌표·이모지 0)

```
박서연 님, 이지훈 님이 '비품 사달라고 하면' 흐름을 적었어요.
"지출결의 올리고 나면 재무팀에서 받으시죠?"

그 다음 두세 단계만 이어 적어주시면 돼요. 5분쯤 걸려요.

[ 이어서 적기 ]  [ 저 아니에요 ]  [ 나중에 ]
```

- 발송 전 발신자에게 미리보기 + 문구 편집 (WRITING §10에 이미 있음)
- 이메일 제목: `'비품 사달라고 하면' 다음 단계 — 5분`
- **발신자 이름을 반드시 넣는다.** 시스템 발신으로 보이면 응답률이 1/4로 떨어진다

## 9.3 거절 처리 — 거절이 최고의 데이터다

```
[ 저 아니에요 ] 클릭
   ↓
그럼 누구한테 가는지 아세요?
( 사람 검색 )                    [ 모르겠어요 ]   ← 동일 크기
```

- 발신자에게: `박서연 님이 '제 일이 아니에요'라고 하셨어요. 다른 분을 찾아볼까요?`
- 상대가 정답을 알려주면 **원 소켓의 `partyUserId`를 갱신하고 재매칭.** 거절 1건이 정답 라벨 1건이 된다
- `[ 나중에 ]`는 30일 스누즈. 재발송은 1회만

## 9.4 계측 — MEASUREMENT 택소노미 확장

값은 담지 않는다는 지배 원칙 유지. 수신자 식별자 금지, `recipient_relation`만.

| 이벤트 | 속성 |
|---|---|
| `handoff_socket_filled` | `direction`, `entry_point: meta_card\|export\|summary\|checklist`, `party_kind`, `artifact_count`, `ms_on_field` |
| `seam_candidate_shown` | `candidate_count`, `top_score_band`, `top_signal: party\|artifact\|lexical\|tool`, `has_inferred_socket` |
| `seam_candidate_confirmed` | `rank(1-3)`, `ms_to_decide`, `score_band` |
| `seam_candidate_rejected` | `rank`, `reason_key`, `followup_answered` |
| `seam_link_counter_confirmed` | `hours_to_counter` |
| `seam_link_severed` | `days_since_confirm`, `severed_by_side: owner\|counterpart` |
| `seam_invite_shown` / `_sent` | `relation: same_dept\|other_dept`, `gate_blocked_reason?` |
| `seam_invite_declined` / `_accepted` | `hours_to_respond` |
| `discrepancy_shown` / `_acknowledged` / `_dismissed` | `kind`, `severity`, `surface: party\|admin` |

**F4 퍼널 「접합 전파」** — 기존 F2(전파)와 별개로 둔다. 초대의 성공은 가입이 아니라 **조직 그래프가 실제로 늘어난 것**이다.

| 단계 | 목표 | 떨어지면 |
|---|---|---|
| `seam_invite_sent` → `_opened` | 60% | 제목·발신자 문제 |
| → `onboarding_started` | 40% | 초대 문구가 자기 일로 안 읽힘 |
| → `doc_saved` | 60% | F1 문제로 회귀 |
| → **`seam_candidate_confirmed` (원 링크)** | **50%** | **초대는 성공했는데 접합이 안 됐다. 매칭 품질 문제** |

누적: 초대 100건 → 최종 접합 **7건**. 이 숫자가 조직 그래프의 실제 성장 속도다.

품질 지표 3개: 후보 수락률 ≥40%, 30일 내 절단율 <5%, 초대 거절률 <40%.

---

# 10. 점진적 도입

## 10.1 핵심 통찰 — 접합 커버리지는 인원 커버리지보다 빨리 오른다

접합은 인원에 균등 분포하지 않는다. **허브 부서(재무·총무·인사)에 몰려 있다.** 시드 접합 지도 20건 중 재무가 한쪽 끝인 게 9건, 총무 5건, 인사 4건이다.

→ **재무팀 5명만 쓰면 전사 접합의 40%가 한쪽 끝을 확보한다.**

이게 PRD 롤아웃 1단계("인사팀 또는 경영지원")를 두 번째 근거로 정당화한다. 원래 이유는 "감시자로 의심받는 부서가 먼저 벗으면 프레임이 깨진다"였는데, **접합 차수(degree) 관점에서도 같은 답이 나온다.** 롤아웃 순서는 인원수가 아니라 접합 차수 순이어야 한다.

## 10.2 짝 없는 소켓의 5가지 용도

1. **접합 대기 지도** — outbound 고아 소켓만 모아도 `우리 조직에서 문서가 끊기는 지점 TOP 20`이 나온다. 커버리지 0%에서 나오는 첫 산출물이고, **다음에 누구를 인터뷰할지** 알려준다. 0단계 시드 팀이 즉시 쓴다.
2. **초대 타깃 우선순위** — 고아 소켓의 `partyUserId`를 빈도순 정렬 = "지금 초대하면 가장 많은 접합이 이어지는 사람" 순위. max-degree 노드부터 채우는 그리디 전략이고, 이게 §9 바이럴 루프의 엔진이다.
3. **자기 문서 간 연결** — 한 사람이 여러 흐름을 쓰면 자기 것끼리 이어진다(GA-02 → GA-01). **커버리지 0%여도 1인 다문서면 가치가 나온다.** `내 흐름 잇기`로 별도 진입점을 둔다.
4. **시드 문서와의 매칭** — 조직에 실 문서가 없어도 시드 14개가 있다. 고아 소켓을 시드와 매칭해 `보통 이 다음은 이렇게 흘러가요`를 보여준다. **반드시 `예시예요` 배지를 달고 조직 지표에 넣지 않는다.**
5. **`orphan_kind` 분류**(§7-⑧) — `not_onboarded`(커버리지 문제)와 `genuinely_unclaimed`(조직 문제)를 반드시 구분. 섞으면 리포트가 통째로 거짓말이 된다.

## 10.3 커버리지별로 무엇을 보여주는가

| 커버리지 | 조직 뷰 | 불일치 | 경영진 산출물 |
|---|---|---|---|
| **10%** | **없음.** 접합 대기 지도만 | 없음 | `문서가 끊기는 지점 20곳` + `다음에 물어볼 사람 10명` — 첫 달 산출물 |
| **30%** | 부서쌍 상위 3~5개가 이어짐. e2e 체인 1~2개 | 5~10건 (대부분 리드타임·산출물) | 첫 체인 1개 + **제거 후보 1~2건**(X-1류, 개발 0줄) |
| **60%** | 킥오프 데모 3체인(구매·수주·입사)이 실데이터로 완성 | 20~40건, 유형 다양 | 월간 정기 발행. 접합 대기가 총 리드타임의 몇 %인지 산출 |

**커버리지 20%에서 이미 가치가 나온다.** J-12("인사 1주 전 요청 vs 총무 2주 필요")는 두 사람만 쓰면 검출된다. 그리고 이 한 건이 SEED-CONTENT D-2가 말한 **"자동화보다 먼저 나오는 무비용 개선"** — 조달 리드타임 규정 개정 — 을 만든다.

## 10.4 새 지표 — 체인 완성도

직원 커버리지로는 이 기능의 상태를 못 본다. 별도 지표를 둔다.

```
완성 체인 = 시작 소켓의 상대가 external이고, 끝 소켓의 상대도 external인 확정 링크 경로
```

고객 문의로 시작해 입금으로 끝나는 것 같은, **양 끝이 회사 밖에 닿는 경로**만 완성으로 센다. 부분 체인은 완성이 아니다.

| 지표 | 90일 | 12개월 |
|---|---|---|
| 완성 체인 수 | 1~2개 | 5~8개 |
| 확정 링크 수 | 20~40 | 150+ |
| 짝 찾은 소켓 비율 | 25% | 55% |
| 문서당 명시 소켓 수 | **0.5 이상** ← 미달이면 이 기능 전체 보류 (§11-3) |

---

# 11. 실패 모드

| # | 시나리오 | 방어 |
|---|---|---|
| **1** | **잘못된 매칭이 조직 뷰를 오염** | (a) 자동 확정은 규칙 1개뿐 (b) `왜 떴나요?` 상시 노출 (c) 누구나 단독 절단 (d) **weakest-link 게이팅** — 체인 내 최저 링크 신뢰도 <0.6이면 체인 지표를 계산하지 않는다 (e) 30일 절단율 <5% 상시 감시 |
| **2** | **어휘 붕괴** — 모두 "요청서"라 적어 전부 매칭 | IDF 하한 0.35, 블록 크기 상한 2,000, 과대 블록 폐기 + 카탈로그 확장 큐로 회수 |
| **3** | **소켓 미수집** — 아무도 안 채움 | 그림자 소켓 + 확정이 곧 수집 + 내보내기와 묶기. **판정선: 문서당 명시 소켓 <0.5면 M4에서 이 기능을 빼고 M5로 미룬다** |
| **4** | **정치적 무기화** — 리포트 캡처가 회의에 등장 | 개인 없음, 접합 유형 5건+, 중립 문구, PDF 고정 각주(`구간을 재는 방식의 차이를 보여줍니다. 지연의 책임을 뜻하지 않습니다`), TRUST §8 압력 기록에 사례 등재 |
| **5** | **초대 스팸으로 조직 반감** | 8중 게이트 + 조직 서킷 브레이커(거절률 40%) |
| **6** | **좀비 링크** — 한쪽 문서 삭제·아카이브·퇴사 | `stale`/`orphaned` 전이 → 흐리게 → 90일 후 자동 해제. 자동 절단은 하지 않음 |
| **7** | **리드타임 이중 계산** | `link_type='overlap'` 자동 검출(§4.1), 합산 대신 max |
| **8** | **한쪽 확정이 사실상 주장이 됨** | `single`은 불일치 리포트·경영진 리포트에서 제외(§5.2) |
| **9** | **매칭 성능 붕괴** | 증분 처리, 블록 상한, 후보 300개 컷. 야간 전량 재계산은 org당 5분 예산 |
| **10** | **접합을 통한 재식별** — 부서쌍 접합이 1건이면 당사자가 특정된다 | 접합 유형 5건+ AND 기여자 5인+ (§8.4). 5인 미만 부서는 상위 부서로 롤업. MEASUREMENT의 2차 억제 동일 적용 |
| **11** | **거절 학습 과적합** — 한 번 거부된 라벨쌍이 전역 금지 | 억제 기본 단위는 소켓쌍. 라벨쌍 감점은 3회 이상 독립 거부부터, 상한 -0.15, org 범위 |
| **12** | **불일치가 너무 많이 나와 무시됨** | 표현 차이 필터(2밴드), 심각도 상위 5건만 기본 노출, `이건 문제 아니에요` 버튼으로 영구 제외 |
| **13** | **조직 뷰가 편집 요구를 부른다** ("여기서 고치게 해주세요") | 편집 개념 자체를 화면에서 제거(§6.2). 요구가 오면 `고치는 건 각자 흐름에서요` — 이건 UX 편의가 아니라 소유권 방어선 |

**가장 위험한 조합은 #1 × #4다.** 잘못된 링크가 만든 허구의 불일치가 경영진 리포트에 올라가 실제 부서 갈등을 만드는 것. 이게 이 기능이 조직에서 폐기되는 단일 시나리오이고, §3.8에서 FP를 FN보다 나쁘다고 판정한 이유 전체가 여기 있다.

---

# 부록. 새 ADR 제안 ([DECISIONS.md](./DECISIONS.md)에 이어 붙일 것)

| # | 결정 | 상태 |
|---|---|---|
| **D-040** | 산출물은 3층 하이브리드 카탈로그(시스템 원형 + 조직 자동 성장 + 원문 보존). **카탈로그 ID는 매칭의 전제가 아니라 부스터** | 🔒 |
| **D-041** | 접합 소켓은 첫/마지막 노드가 아니라 **임의 아이템**에 붙는다. 묻는 시점만 경계로 제한 (PRD §4.9 수정) | 🔒 |
| **D-042** | 자동 확정은 점수가 아니라 **결정적 규칙 1개**(상호 실명 지목 + 동일 카탈로그 객체)로만 | 🔒 |
| **D-043** | **비대칭 확정** — 확정 1인, 거부 1인 즉시. 조직 뷰 구조는 `single`로 반영, 불일치 리포트는 `confirmed`만 | ✅ (30일 절단율로 검증) |
| **D-044** | 불일치 리포트의 관리자 집계 단위는 접합 인스턴스가 아니라 **접합 유형**(부서쌍 × 산출물, 5건+ AND 5인+) | 🔒 |
| **D-045** | 접합 정보는 **양방향 대칭 노출**. 자유 텍스트(예외 메모·짜증)는 어떤 경우에도 상대에게 가지 않는다. 상대 평가를 **수집하지 않는다** | 🔒 |
| **D-046** | 매칭 파이프라인은 `SocketFeature`만 받는다. 원문 필드가 타입에 없다 — CI로 강제 | 🔒 |
| **D-047** | 롤아웃 순서는 인원수가 아니라 **접합 차수** 순 | ✅ |
| **D-048** | 형태소 분석기를 쓰지 않는다. 정규화 → 조사·어미 절단 → 자모 분해 → head-final 가중 bigram | ✅ (파일럿 라벨셋으로 검증) |
| ❌ | **조직 뷰에서 편집** — 소유권 방어선. 영원히 | |
| ❌ | **인스턴스 레벨 조인** (품의번호 실값 수집) — 입력 비용이 제품을 죽인다 | |
| ❌ | **조직 간 매칭 학습 공유** — 프라이버시 + 어휘 차이로 정확도 손해 | |

---

## 마무리 — 이 설계에서 가장 되돌리기 비싼 5가지

1. **`SocketFeature` 타입에 원문을 넣지 않는 것** — 한 번 넣으면 프라이버시 보증이 코드가 아니라 정책이 된다
2. **자동 확정을 규칙으로 제한하는 것** — 점수 기반 자동 확정을 켜면 오염을 되돌릴 방법이 없다
3. **`link_type='overlap'` 구분** — 나중에 넣으면 그때까지의 모든 리드타임 지표가 틀린 값이었다는 뜻이 된다
4. **불일치 집계를 접합 유형 단위로 두는 것** — 인스턴스 단위로 시작하면 5인 규칙과 영구 충돌한다
5. **상대 평가를 수집하지 않는 질문 설계** — "저쪽이 얼마나 늦나요"를 한 번이라도 물으면, 이후 어떤 노출 정책으로도 정치를 막을 수 없다

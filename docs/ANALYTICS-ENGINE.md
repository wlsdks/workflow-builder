# 분석 엔진 · n8n 내보내기 구현 명세

> **구현 상태 (2026-08-18)** — 계산 계층은 `packages/scoring`(§2 볼륨·§3 Feasibility 6요소·§4 Value·§5 ECRS 12종·§7 Confidence·D-116 가드)과 `packages/analytics-schema`(MEASUREMENT §2 이벤트 zod `.strict()`)로 **동작한다**. 골든 픽스처는 `packages/scoring/test/golden.test.ts`이고, 그 파일의 `DIVERGENCES` 표가 **SEED §D 손계산과 규칙 계산이 갈리는 10건**(§3.7의 0.79 산술 오류 · §4.1 `customer-wait` 단위 오류 · Confidence 0.6/0.9 도달 불가 · RiskValue 3건 미산정 포함)을 판정과 함께 고정한다. L1~L5 잡 러너와 n8n 익스포터는 미착수.

> 최종 갱신: 2026-08-17 · 대상 패키지: `packages/analytics-core`, `packages/analytics-jobs`, `packages/exporters`
>
> **전제 문서 (여기서 다시 설명하지 않는다)**
> [PRD.md §4.8](./PRD.md) 스코어링 공식 · ECRS 우선 · 짜증 3축 분리 ·
> [GRAPH-CORE.md](./GRAPH-CORE.md) `derive()` / `metrics` / `toN8n()` 스케치 ·
> [TOOLS.md](./TOOLS.md) 도구 48종 연결성 등급 + 예외 프롬프트 뱅크 ·
> [ASSEMBLY.md](./ASSEMBLY.md) 접합 소켓 · 조직 조립 ·
> [MEASUREMENT.md](./MEASUREMENT.md) k-익명성 · [POLICY.md](./POLICY.md) 권한 경계 ·
> [SEED-CONTENT.md §D](./SEED-CONTENT.md) 후보 5건(이 문서의 골든 픽스처 정답지)

---

## 0. 이 문서가 소유하는 것과 소유하지 않는 것

| | 소유자 |
|---|---|
| 그래프 구조·시간 DP·사이클·병렬 의미론 | **graph-core** (재구현 금지) |
| 개인 문서 → 조직 프로세스 접합(체인) | **ASSEMBLY.md** |
| 같은 일을 여러 사람이 하는 것의 **묶음(그룹)** | **이 문서 §6** ← 접합과 다른 관계다 |
| 단계 특징 추출 · 스코어링 · ECRS · 후보 · 리포트 | **이 문서** |
| n8n JSON 골격 생성 | graph-core `toN8n()` (구조) + **이 문서 §9** (조직 지식 주입·초안 포장) |
| 실행 명세 문서 | **이 문서 §10** |

### 이 엔진 전체를 지배하는 다섯 문장

1. **없는 데이터를 0으로 쓰지 않는다.** `Measure = { value, coverage }` 계약을 스코어까지 끝까지 끌고 간다. 0은 "가치 없음"으로 읽히고, 그 오독이 좋은 후보를 죽인다.
2. **F와 N_people 중 하나만 조직 규모를 담는다.** 이 규칙을 타입으로 강제하지 않으면 반드시 중복 계산이 난다. ([SEED-CONTENT §D](./SEED-CONTENT.md)의 `N_people = 1`이 그 흔적이다)
3. **ECRS가 먼저 돈다.** 랭킹 파이프라인은 제거 후보를 뺀 나머지에만 적용된다. 제거 가능한 단계를 자동화 후보 1위로 올리는 것은 **틀린 답이 아니라 해로운 답**이다.
4. **점 추정을 단독으로 출력하지 않는다.** 모든 금액은 구간과 함께 나간다. 자기보고 데이터로 만든 "연 1,782만 원"은 정밀함을 가장한 거짓말이다.
5. **개인 단위 수치는 어떤 경로로도 관리자에게 도달하지 않는다.** 후보 카드 한 장이 "누가 무엇을 얼마나 하는지"를 복원 가능하게 만들면 그 카드는 만들지 않는다.

### 새 결정 D-084 … D-095 (DECISIONS.md 병합 대상)

> 번호 근거: DECISIONS.md는 D-083까지 사용했고 *"번호는 재사용하지 않는다"*가 규칙이다.
> D-040~D-048은 ASSEMBLY.md에 살아 있으므로 **사용 중**으로 취급한다.

| # | 결정 | 근거 | 상태 |
|---|---|---|---|
| **D-084** | 빈도·인원은 판별 유니온 `Volume`으로만 표현한다 | 중복 계산을 타입 시스템이 막는다 | 🔒 |
| **D-085** | `automationLevel`은 사용자에게 묻지 않고 추론한다. 추론값은 1클릭 수정 가능 | 답할 수 없는 질문을 묻지 않는다 | ✅ |
| **D-086** | 회상창(7일)보다 주기가 긴 업무는 `freqLast7d`를 **무시**한다 | 월마감의 "지난 7일 0건"은 데이터가 아니라 달력이다 | 🔒 |
| **D-087** | 안정성은 데이터에서 얻지 못한다. prior + 프록시 + 상위 후보 1문항 3층 폴백 | 없는 데이터를 지어내지 않기 위한 유일한 방법 | ✅ |
| **D-088** | `RiskValue` 기본값은 0이 아니라 **미산정**이다 | 0 표기는 "가치 없음"으로 읽힌다 | 🔒 |
| **D-089** | 보정 계수는 **조직·밴드 단위로만** 학습한다. 개인별 보정 영구 금지 | 개인 보정 = 감시. D-002와 같은 급 | 🔒 |
| **D-090** | 후보 랭킹은 하한(P10)으로 정렬한다. 중앙값은 표시만 | 상한 정렬은 가장 불확실한 후보를 1위로 올린다 | ✅ |
| **D-091** | **"인력 N명 감축 가능"은 산출 금지 출력이다** | 이 출력 하나가 제품을 죽인다. D-001의 연장 | 🔒 |
| **D-092** | 접합(체인)과 프로세스 그룹(같은 일)은 **다른 관계, 다른 테이블** | 섞으면 `N_people`이 리드타임과 뒤엉킨다. `link_type='overlap'`(D-044 계열)과도 구분된다 | 🔒 |
| **D-093** | `process_key`는 **결정적 규칙으로만 자동 배정**하고, 회색대는 사람이 확정한다 | ASSEMBLY D-042(자동 확정은 규칙으로만)의 클러스터링 판 | 🔒 |
| **D-094** | "했음" 카운터는 **P0(제품 DB)에만** 저장한다. P1 이벤트에는 값 없는 행위 이벤트만 나간다 | MEASUREMENT §1 — 빈도 값은 분석 이벤트로 복제하지 않는다 | 🔒 |
| **D-095** | n8n 익스포트는 `active:false` + `[초안]` 접두 + 잠금 스티키 3종 없이는 생성되지 않는다 | 실행 가능해 보이는 순간이 사고 지점 | 🔒 |

**기존 결정 중 이 문서를 구속하는 것** — D-001(직원 화면에 '자동화' 없음) · D-002(5인 차단, 뒤집는 조건 없음) · D-007(ECRS 우선) · D-008(신뢰도 3단) · D-011(n8n 실행 명세는 M5+, ⏳) · D-021(집계를 그리지 않는다) · D-025·D-062(짜증 플래그) · D-044/D-060(불일치 집계 단위) · D-058(점수 기반 자동 확정 금지) · D-082(요금 경계 = 프라이버시 경계).

---

## 1. 분석 파이프라인 전체

### 1.1 층 구조와 실행 시점

```
L0  편집 세션          derive()          인메모리, 키 입력마다      ← graph-core
L1  문서 스냅샷        snapshot()        저장 커밋 후 ≤30초 (큐)
L2  단계 특징          extractFeatures() L1 후속, 문서 단위
L3  프로세스 그룹      groupProcesses()  야간 배치 03:10 KST
L4  조직 집계          aggregate()       야간 배치 03:30 KST
L5  후보 도출          ECRS → 랭킹        야간 배치 03:50 KST
L6  리포트 렌더        report()          직원=L2 직후 / 경영진=월 07:00
```

| 층 | 입력 | 출력 | 실행 시점 | 왜 그 시점인가 |
|---|---|---|---|---|
| **L0** | `items[]`, `edges[]` | `DerivedGraph` | 실시간 (편집 중) | 캔버스가 이걸 그린다. 분석은 아직 안 한다 |
| **L1** | `DerivedGraph` + revision | `doc_snapshots` 행 1개 | **저장 커밋 후 큐 → ≤30초** | 편집 중 매 키스트로크마다 스냅샷을 뜨면 스토리지가 터지고, 반쯤 쓴 흐름이 집계에 섞인다 |
| **L2** | 스냅샷 + 도구 카탈로그 + 디렉터리 | `step_features` (단계당 1행) | L1 완료 즉시 (같은 워커) | 직원 리포트가 "3분만 더 쓰면"의 보상이므로 **분 단위로 갱신되어야 한다** |
| **L3** | 조직 전체 `step_features` + 문서 메타 | `process_groups`, `process_group_members` | **야간 배치** | O(n²) 유사도. 실시간으로 돌 수 없고 돌 이유도 없다 |
| **L4** | 그룹 + 멤버 | `process_rollup` (그룹×단계) — [MEASUREMENT §3](./MEASUREMENT.md)의 `agg_process` 뷰가 읽는 그 테이블이다 | 야간 배치 | k-익명성 판정이 여기서 걸린다 |
| **L5** | 집계 + 특징 | `candidates` (`kind = eliminate / precondition / automate`) | 야간 배치 | 경영진 화면의 정본. **ECRS가 먼저, 랭킹이 나중** |
| **L6a 직원** | `step_features` (본인 문서만) | 화면 캐시 | **L2 직후 무효화** | 개인 리포트는 조직 집계를 기다리지 않는다 (§8.1) |
| **L6b 경영진** | L5 | `exec_report_snapshots` | **주 1회 월 07:00 + 온디맨드** | 매일 순위가 흔들리면 아무도 안 믿는다. 스냅샷을 박제해야 "지난주 대비"가 가능하다 |

**핵심**: 직원 리포트와 경영진 리포트는 **다른 파이프라인**이다. 직원 리포트가 조직 집계를 기다리면 "3분 더 쓰면 알려드릴게요"라는 약속이 다음 날 아침에 지켜진다. 그러면 아무도 두 번째 문서를 쓰지 않는다.

### 1.2 재계산 트리거 표

| 이벤트 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| 단계 제목·구조 편집 | ● | ● | 다음 야간 | 다음 야간 | 다음 야간 |
| 메타데이터(시간·빈도·도구·담당자) 변경 | ● | ● | 다음 야간 | 다음 야간 | 다음 야간 |
| 예외 프롬프트 응답 | ● | ● | — | 다음 야간 | 다음 야간 |
| "했음" 카운터 탭 | — | — | — | — | **즉시 부분 갱신** (Confidence만) |
| 문서 공유 범위 변경 | — | — | 다음 야간 | 다음 야간 | 다음 야간 |
| 도구 카탈로그 갱신 (연결성 등급 변경) | — | **전량 재계산** | — | ● | ● |
| 디렉터리 동기화 (부서 개편) | — | 전량 재계산 | ● | ● | ● |
| Rate(시간당 단가) 변경 | — | — | — | — | ● (L2는 시간까지만, 금액은 L5에서 붙는다) |

> **`Rate`를 L2에 넣지 않는 이유** — 단가는 조직 설정이고 자주 바뀐다. 단가가 특징 테이블에 박히면 단가 변경 때마다 전 직원 문서를 다시 돈다. **L2는 시간·건수까지, 금액은 L5에서.**

### 1.3 저장 스키마 (신규 테이블)

```ts
// db/schema-analytics.ts
import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp,
         index, uniqueIndex, pgEnum, date } from 'drizzle-orm/pg-core';
import { documents, items } from './schema';

/* ── L1 스냅샷 ──────────────────────────────────────────────────────────── */
export const docSnapshots = pgTable('doc_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  topologyHash: text('topology_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  /** derive() 결과 중 분석에 필요한 부분만. 그래프 전체를 저장하지 않는다 */
  metrics: jsonb('metrics').$type<SnapshotMetrics>().notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('doc_snapshots_rev').on(t.docId, t.revision)]);

/* ── L2 단계 특징 ───────────────────────────────────────────────────────── */
export const stepFeatures = pgTable('step_features', {
  itemId: uuid('item_id').primaryKey().references(() => items.id, { onDelete: 'cascade' }),
  docId: uuid('doc_id').notNull(),
  orgId: uuid('org_id').notNull(),
  snapshotId: uuid('snapshot_id').notNull(),

  // 시간 (금액 아님)
  touchH: real('touch_h'),                    // 밴드 점추정
  touchLoH: real('touch_lo_h'),
  touchHiH: real('touch_hi_h'),
  expectedPasses: real('expected_passes').notNull().default(1),
  reachProbability: real('reach_probability').notNull().default(1),
  waitH: real('wait_h'),

  // 빈도·인원
  freqPerMonth: real('freq_per_month'),
  freqSource: text('freq_source').$type<FreqSource>(),
  nPeople: integer('n_people'),
  volumeKind: text('volume_kind').$type<'per-person' | 'org-total'>().notNull().default('per-person'),

  // 추론값
  saveRate: real('save_rate'),
  saveRateLevel: text('save_rate_level').$type<AutomationLevel>(),
  saveRateInferred: boolean('save_rate_inferred').notNull().default(true),

  // Feasibility 6요소 (0..1, null = 미측정)
  fDeterminism: real('f_determinism'),
  fInputStructure: real('f_input_structure'),
  fSystemAccess: real('f_system_access'),
  fExceptionInv: real('f_exception_inv'),
  fStandardization: real('f_standardization'),
  fStability: real('f_stability'),
  feasibilityCap: real('feasibility_cap'),    // 하 등급 도구 → 0.5

  // 커버리지 (전 항목 종합)
  coverage: real('coverage').notNull(),
  flags: jsonb('flags').$type<FeatureFlags>().notNull().default({}),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('step_features_org_doc').on(t.orgId, t.docId)]);

/* ── 예외 프롬프트 응답 (기존 스키마에 없다. 여기서 신설) ──────────────── */
export const promptKind = pgEnum('prompt_kind', [
  'exception-per-10',      // "10번 중 몇 번은 이렇게 안 흘러가나요"
  'rejection-6m',          // "최근 6개월에 실제로 반려된 적"
  'criteria-source',       // "문서에 있나요, 경험으로 아시나요"
  'batch-or-each',         // "몰아서 하세요, 건건이"
  'output-reader',         // "이 결과물, 나중에 누가 찾나요"
  'peer-count',            // "당신 말고 몇 명이나 똑같이"
  'delegable',             // "당신 말고 할 수 있는 사람"
  'push-or-poll',          // "알림이 오나요, 직접 확인하세요"
  'deadline-crunch',       // "마감 직전에 몰려서 처리"
  'change-expected',       // "1년 안에 방식이 바뀔 예정인가요" (§3.6)
  'removal-impact',        // "이 단계, 없애면 무슨 일이 생기나요"
]);

export const promptResponses = pgTable('prompt_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }), // null = 문서 전체
  docId: uuid('doc_id').notNull(),
  kind: promptKind('kind').notNull(),
  /** 정규화된 값. 자유 텍스트는 textValue로 */
  numValue: real('num_value'),
  choiceValue: text('choice_value'),
  textValue: text('text_value'),
  answeredBy: uuid('answered_by').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  /** 재질문("정말 한 번도요?") 후의 응답인가 */
  reasked: boolean('reasked').notNull().default(false),
}, (t) => [index('prompt_responses_item').on(t.itemId, t.kind)]);

/* ── L3 그룹 ────────────────────────────────────────────────────────────── */
export const processGroups = pgTable('process_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  label: text('label').notNull(),               // 대표 문서 제목 (사람이 수정 가능)
  medoidDocId: uuid('medoid_doc_id'),
  contributorCount: integer('contributor_count').notNull(),
  /** k-익명성 통과 여부. false면 관리자 화면에 수치가 나가지 않는다 */
  kAnonOk: boolean('k_anon_ok').notNull(),
  cohesion: real('cohesion').notNull(),          // 0..1 그룹 응집도
  builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
});

export const processGroupMembers = pgTable('process_group_members', {
  groupId: uuid('group_id').notNull().references(() => processGroups.id, { onDelete: 'cascade' }),
  docId: uuid('doc_id').notNull(),
  contributorId: uuid('contributor_id').notNull(),
  similarity: real('similarity').notNull(),
  /** 자동 편입인가 사람이 확인했는가 */
  confirmed: boolean('confirmed').notNull().default(false),
  /** fork 관계 — 독립 기여자 판정에서 제외된다 (§7.2) */
  forkOf: uuid('fork_of'),
}, (t) => [uniqueIndex('pgm_pk').on(t.groupId, t.docId)]);

/* ── L5 후보 ────────────────────────────────────────────────────────────── */
export const candidateKind = pgEnum('candidate_kind', ['eliminate', 'automate', 'precondition']);

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  kind: candidateKind('kind').notNull(),
  patternId: text('pattern_id'),               // 'E1'..'E12' (제거 후보)
  groupId: uuid('group_id'),
  scope: jsonb('scope').$type<{ docId: string; itemIds: string[] }[]>().notNull(),

  valueP10: real('value_p10'), valueP50: real('value_p50'), valueP90: real('value_p90'),
  feasibility: real('feasibility'),
  confidence: real('confidence'),
  priorityP10: real('priority_p10'),           // ★ 정렬 키 (D-090)
  acceptance: real('acceptance'),              // 3축: 짜증·챔피언
  coverage: real('coverage').notNull(),
  unpriced: jsonb('unpriced').$type<string[]>().notNull().default([]), // 미산정 항목 (D-088)

  execCopy: jsonb('exec_copy').$type<ExecCopy>().notNull(),
  builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('candidates_org_rank').on(t.orgId, t.kind, t.priorityP10)]);
```

### 1.4 잡 러너

배치 큐는 이미 있는 Postgres로 충분하다. Redis/BullMQ를 도입하지 않는다 — 이 파이프라인의 잡 수는 하루 수천 건이고, `SELECT ... FOR UPDATE SKIP LOCKED`가 정확히 이 규모를 위한 도구다.

```ts
// packages/analytics-jobs/src/runner.ts
export type JobKind = 'snapshot' | 'features' | 'group' | 'aggregate' | 'candidates' | 'exec-report';

export type Job = {
  id: string;
  kind: JobKind;
  orgId: string;
  payload: Record<string, unknown>;
  runAfter: Date;
  attempts: number;
};

/**
 * 야간 배치는 조직 단위로 직렬, 조직 간 병렬.
 * 조직 안에서 병렬로 돌리면 그룹핑이 자기 자신을 반쯤 본 상태로 돈다.
 */
export async function runNightly(orgId: string, now: Date, db: Db): Promise<NightlyReport> {
  const t0 = now;
  const grouped   = await groupProcesses(orgId, db);          // L3
  const aggregated= await aggregate(orgId, grouped, db);      // L4
  const elim      = await detectElimination(orgId, aggregated, db);  // L5-a ★ 먼저
  const auto      = await rankAutomation(orgId, aggregated, elim, db); // L5-b
  await persistCandidates(orgId, [...elim, ...auto], db);
  return { orgId, startedAt: t0, groups: grouped.length, elim: elim.length, auto: auto.length };
}
```

**멱등성**: 모든 L3~L5 잡은 `(orgId, businessDate)` 단위로 멱등하다. 재실행하면 같은 결과가 나오고 이전 행을 덮어쓴다. 배치가 반쯤 죽었을 때 "어디까지 돌았지"를 추적하지 않기 위해서다. 그 추적은 반드시 틀린다.

---

## 2. 단계 수준 특징 추출

`packages/analytics-core/src/features/`. **순수 함수**다 — DB도 시각도 모른다. 입력은 graph-core의 `DerivedGraph`와 주입된 카탈로그·응답뿐이다.

### 2.0 입력 계약

```ts
// packages/analytics-core/src/types.ts
import type { DerivedGraph, DerivedNode, DurationBand, NodeId } from '@workflow/graph-core';

export type ToolGrade = 'high' | 'mid' | 'low';   // 상 / 중 / 하

export type ToolEntry = {
  id: string;
  name: string;
  grade: ToolGrade;
  n8nNodeType: string | null;
  /** 이 도구가 붙으면 Feasibility 상한이 0.5로 캡된다 (공동인증서·전화·종이·HWP·카톡·구두) */
  capsFeasibility: boolean;
  /** 입력이 구조화 데이터인가 — 시트/ERP/쇼핑몰 = true, 메신저/메일본문/종이 = false */
  structuredIO: boolean;
  /** "이 도구를 X로 바꾸면 상이 된다" — 선행 개선 제안용 (TOOLS.md 운영규칙 3) */
  upgradePath?: { toToolId: string; note: string };
};

export type ToolCatalog = Readonly<Record<string, ToolEntry>>;

export type PromptAnswers = {
  /** kind → itemId → 값. 문서 전체 응답은 itemId = '@doc' */
  byKind: Readonly<Record<string, Readonly<Record<string, PromptValue>>>>;
};

export type PromptValue = { num?: number; choice?: string; text?: string; reasked?: boolean };

export type DocMeta = {
  docId: string;
  orgId: string;
  title: string;
  ownerId: string;
  /** 프로세스 주기. 온보딩 칩/시드 템플릿에서 오거나 사용자가 고른다 */
  cadence: Cadence | null;
  /** 이 문서가 파생된 시드 템플릿. fork 출처 (SEED-CONTENT §E-3) */
  seedTemplateId: string | null;
  /** 다른 문서를 복제한 것이면 원본 */
  forkOfDocId: string | null;
  lastConfirmedAt: Date | null;
};

export type Cadence =
  | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  | 'per-event';   // 사건 구동 (문의가 오면, 주문이 들어오면)

export type FeatureInput = {
  graph: DerivedGraph;
  doc: DocMeta;
  catalog: ToolCatalog;
  answers: PromptAnswers;
  /** 조직 사전값 — 조직마다 다르고, 없으면 전역 기본값 */
  priors: Priors;
};
```

### 2.1 `T_touch` — 밴드 → 시간, 그리고 병렬 구간

**환산표.** 점추정은 graph-core의 `BAND_HOURS`를 **그대로 쓴다.** 캔버스에 보이는 숫자와 리포트의 숫자가 다르면 그 순간 신뢰가 끝난다. 구간은 이 문서가 새로 정의한다 (§11에서 쓴다).

| 밴드 | 점추정 `BAND_HOURS` | 구간 `BAND_RANGE_H` | 구간 근거 |
|---|---|---|---|
| `1m` | 0.0167h (1분) | 0.5분 ~ 3분 | 밴드 아래위 인접 경계 |
| `5m` | 0.0833h (5분) | 3분 ~ 10분 | |
| `15m` | 0.25h | 10분 ~ 30분 | |
| `1h` | 1h | 0.5h ~ 2h | |
| `halfday` | 4h | 2h ~ 6h | |
| `1d+` | 8h | 6h ~ **16h** | **상한 없음을 2일로 자른다.** 무한대는 계산 불가이고, 실제로 1건에 3일 붙는 업무는 밴드가 아니라 별도 문서로 쪼개져야 한다 |

```ts
// packages/analytics-core/src/features/touch.ts
import { BAND_HOURS, type DerivedGraph, type DurationBand, type NodeId }
  from '@workflow/graph-core';

/** 점추정은 graph-core 정본을 재수출한다. 두 벌 관리하지 않는다 */
export { BAND_HOURS };

/** 불확실성 구간. 반드시 BAND_HOURS[b] ∈ [lo, hi] 를 만족한다 (테스트로 강제) */
export const BAND_RANGE_H: Record<DurationBand, readonly [number, number]> = {
  '1m':      [0.5 / 60, 3 / 60],
  '5m':      [3 / 60, 10 / 60],
  '15m':     [10 / 60, 30 / 60],
  '1h':      [0.5, 2],
  halfday:   [2, 6],
  '1d+':     [6, 16],
};

/**
 * 병렬 구간 처리 — **직접 계산하지 않는다.**
 *
 * graph-core가 이미 답을 갖고 있다:
 *   perNode.reachProbability : XOR 갈래 확률 (AND 갈래는 1.0)
 *   perNode.expectedPasses   : 재작업 루프의 기대 통과 횟수
 *   perNode.touchH           : 그 노드의 밴드 시간 (가중 전)
 *
 * 기대 실접촉시간 = Σ p·k·touch 이고, 이것이 정확히 metrics.touchH의 정의다.
 * AND 갈래는 p=1이므로 자동으로 **합산**되고(사람이 둘 다 붙어 있으니 맞다),
 * XOR 갈래는 확률로 나뉜다. 우리가 여기서 할 일은 **범위를 후보 스코프로 좁히는 것**뿐이다.
 */
export function scopeTouchH(graph: DerivedGraph, scope: ReadonlySet<NodeId>): number {
  let sum = 0;
  for (const id of scope) {
    const m = graph.metrics.perNode.get(id);
    if (!m) continue;
    sum += m.reachProbability * m.expectedPasses * m.touchH;
  }
  return sum;
}

/** 같은 스코프의 [하한, 상한]. 밴드 구간을 그대로 밀어 넣는다 */
export function scopeTouchRangeH(
  graph: DerivedGraph,
  scope: ReadonlySet<NodeId>,
): readonly [number, number] {
  let lo = 0, hi = 0;
  for (const id of scope) {
    const node = graph.byId.get(id);
    const m = graph.metrics.perNode.get(id);
    if (!node || !m || !node.durationBand) continue;
    const w = m.reachProbability * m.expectedPasses;
    const [a, b] = BAND_RANGE_H[node.durationBand];
    lo += w * a;
    hi += w * b;
  }
  return [lo, hi];
}

/** 커버리지 = 스코프 안의 단계 중 소요시간이 실제로 채워진 비율 */
export function scopeTouchCoverage(graph: DerivedGraph, scope: ReadonlySet<NodeId>): number {
  let total = 0, filled = 0;
  for (const id of scope) {
    const n = graph.byId.get(id);
    if (!n || n.synthetic || (n.kind !== 'task' && n.kind !== 'hold')) continue;
    total++;
    if (n.durationBand != null) filled++;
  }
  return total === 0 ? 0 : filled / total;
}
```

> **한 줄 요약** — 병렬 구간은 이 패키지에서 처리하지 않는다. graph-core가 `touchH`를 AND=합·XOR=확률가중으로 이미 계산했고, 후보 스코프는 그 항들의 부분합이다. 여기서 다시 AND를 해석하려 들면 두 벌의 정의가 생기고, 반드시 어긋난다.

### 2.2 `F` — `freqLast7d`와 프로세스 주기

문제는 셋이다.

1. **회상창이 주기보다 짧을 수 있다.** 월마감은 지난 7일 동안 0건인 것이 정상이다. `freqLast7d = 0`을 그대로 쓰면 조직 1순위 후보가 Value 0으로 소멸한다.
2. **주기만 쓰면 건수를 못 잡는다.** "문의가 오면"(`per-event`)은 주기가 없고 건수만 있다.
3. **둘 다 있고 서로 다르다.** 이게 흔하다.

```ts
// packages/analytics-core/src/features/frequency.ts
export type FreqSource =
  | 'measured-7d'      // freqLast7d 사용
  | 'cadence'          // 문서 주기에서 유도
  | 'both-agree'       // 둘 다 있고 일치
  | 'both-conflict'    // 둘 다 있고 불일치 → 낮은 쪽 채택 + 플래그
  | 'counter'          // "했음" 카운터 실측 (§7.3)
  | 'none';

export type FreqResult = {
  perMonth: number;
  source: FreqSource;
  /** 0..1. 'none'이면 0 */
  coverage: number;
  /** 불일치 배수 (both-conflict일 때만) */
  conflictRatio?: number;
};

/** 주기 → 월 환산 발생 횟수 */
const CADENCE_PER_MONTH: Record<Exclude<Cadence, 'per-event'>, number> = {
  daily:     21.7,   // 근무일 기준. 달력일 30.4가 아니다 — 업무는 주말에 안 난다
  weekly:    4.35,
  biweekly:  2.17,
  monthly:   1,
  quarterly: 1 / 3,
  yearly:    1 / 12,
};

/** 주기 1회의 길이(일). 회상창(7일)과 비교하는 데 쓴다 */
const CADENCE_PERIOD_DAYS: Record<Exclude<Cadence, 'per-event'>, number> = {
  daily: 1, weekly: 7, biweekly: 14, monthly: 30.4, quarterly: 91, yearly: 365,
};

const RECALL_WINDOW_DAYS = 7;
const WEEKS_PER_MONTH = 30.44 / 7;   // 4.348

export function resolveFrequency(
  freqLast7d: number | null | undefined,
  cadence: Cadence | null,
  occurrencesPerCycle: number | null,   // 주기 1회당 몇 건 (월마감 = 1, 급여이체 = 1)
  measured: MeasuredFreq | null,        // §7.3 "했음" 카운터
): FreqResult {

  // 0. 실측이 있으면 무조건 실측. 다른 신호를 보지 않는다
  if (measured && measured.promoted) {
    return { perMonth: measured.perMonth, source: 'counter', coverage: 1 };
  }

  const hasFreq = typeof freqLast7d === 'number' && Number.isFinite(freqLast7d) && freqLast7d >= 0;
  const cadenceKnown = cadence != null && cadence !== 'per-event';

  // 1. ★ D-086 — 회상창보다 주기가 길면 freqLast7d를 무시한다.
  //    "지난 7일 동안 0번"은 월마감에서 데이터가 아니라 달력의 결과다.
  if (cadenceKnown && CADENCE_PERIOD_DAYS[cadence] > RECALL_WINDOW_DAYS) {
    const per = CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1);
    return { perMonth: per, source: 'cadence', coverage: 0.8 };
  }

  // 2. 사건 구동(per-event)은 주기가 없다. 7일 회상이 유일한 신호다
  if (cadence === 'per-event') {
    if (!hasFreq) return { perMonth: 0, source: 'none', coverage: 0 };
    return { perMonth: freqLast7d! * WEEKS_PER_MONTH, source: 'measured-7d', coverage: 0.7 };
  }

  // 3. 둘 다 있다 — 여기가 실제로 자주 일어나는 경우
  if (hasFreq && cadenceKnown) {
    const fromFreq = freqLast7d! * WEEKS_PER_MONTH;
    const fromCad  = CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1);
    const hi = Math.max(fromFreq, fromCad);
    const lo = Math.min(fromFreq, fromCad);
    const ratio = lo === 0 ? Infinity : hi / lo;

    if (ratio <= 1.5) {
      // 일치로 본다. 신호가 둘이므로 커버리지가 올라간다
      return { perMonth: (fromFreq + fromCad) / 2, source: 'both-agree', coverage: 0.95 };
    }
    // ★ 불일치 → 낮은 쪽을 쓴다.
    //   Value는 곱셈이라 과대 추정이 순위를 통째로 뒤집는다.
    //   과소 추정으로 놓치는 후보는 실측 승격(§7.3)에서 회수된다.
    return {
      perMonth: lo, source: 'both-conflict',
      coverage: 0.4, conflictRatio: Number.isFinite(ratio) ? ratio : 99,
    };
  }

  if (hasFreq) return { perMonth: freqLast7d! * WEEKS_PER_MONTH, source: 'measured-7d', coverage: 0.7 };
  if (cadenceKnown) {
    return {
      perMonth: CADENCE_PER_MONTH[cadence] * (occurrencesPerCycle ?? 1),
      source: 'cadence', coverage: 0.6,
    };
  }
  return { perMonth: 0, source: 'none', coverage: 0 };
}
```

**불일치가 3배를 넘으면** 그 단계는 실측 승격 큐(§7.3)의 우선순위 상단으로 올라간다. 그리고 리포트에는 숫자 대신 **"빈도가 확실하지 않아요 — 2주만 세어볼까요?"**가 나간다. 곱셈 스코어에서 3배 오차는 순위를 통째로 뒤집는다.

### 2.3 `N_people` — 같은 일을 하는 사람 수를 어떻게 아는가

**이걸 아는 방법은 네 가지이고, 넷 다 틀린다.** 그래서 넷을 결합하되 각각의 실패 방향을 알고 결합한다.

| 신호 | 어디서 오는가 | 편향 방향 | 강도 |
|---|---|---|---|
| ① **프로세스 그룹 실측** | §6의 그룹에 실제로 문서를 쓴 사람 수 | **과소** (작성률 40%가 상한) | 하한으로 사용 |
| ② **자기보고** | "이 흐름, 당신 말고 몇 명이나 똑같이 하고 있나요?" ([TOOLS.md](./TOOLS.md) B 마지막 표) | **과대** (부서 전원을 센다) | 중앙값만 사용 |
| ③ **시드 템플릿 파생 수** | 같은 `seedTemplateId`에서 fork된 문서 수 | 과소 (시드를 안 쓴 사람 누락) | ①의 보완 |
| ④ **디렉터리 역할 코호트** | 같은 부서 × 같은 직무의 인원수 | **과대**, 그러나 **물리적 상한** | 하드 캡 |

```ts
// packages/analytics-core/src/features/people.ts

export type PeopleSignals = {
  /** ① 그룹에 실제 기여한 서로 다른 사람 수 (fork 형제는 1명으로 접는다) */
  observedContributors: number;
  /** ② 기여자들의 자기보고 "나 말고 N명" 응답들 */
  selfReportedPeers: readonly number[];
  /** ③ 같은 시드 템플릿에서 파생된 문서의 서로 다른 소유자 수 */
  seedSiblingOwners: number;
  /** ④ 같은 부서·직무 인원수. 디렉터리에서 온다. 모르면 null */
  roleCohortSize: number | null;
};

export type PeopleResult = { nPeople: number; coverage: number; basis: string };

export function resolveNPeople(s: PeopleSignals): PeopleResult {
  const observed = Math.max(1, s.observedContributors, s.seedSiblingOwners);

  // 자기보고는 중앙값. 평균은 "부서 전원 30명" 한 명이 전체를 끌어올린다
  const claimed = s.selfReportedPeers.length > 0
    ? median(s.selfReportedPeers) + 1   // "나 말고 N명" → 나 포함
    : null;

  const cap = s.roleCohortSize ?? Number.POSITIVE_INFINITY;

  // 실측이 하한, 역할 코호트가 상한, 자기보고는 그 사이에서만 발언권이 있다
  let n = observed;
  if (claimed !== null) n = Math.max(observed, Math.min(claimed, cap));
  n = Math.max(observed, Math.min(n, cap));

  // 커버리지: 실측만 = 0.5, 실측+자기보고 = 0.75, 셋 이상 신호 = 0.9
  const signals =
    (s.observedContributors > 1 ? 1 : 0) +
    (s.selfReportedPeers.length > 0 ? 1 : 0) +
    (s.seedSiblingOwners > 1 ? 1 : 0) +
    (s.roleCohortSize != null ? 1 : 0);
  const coverage = signals === 0 ? 0.2 : Math.min(0.9, 0.3 + 0.2 * signals);

  const basis =
    claimed === null ? `기여자 ${observed}명 실측`
    : claimed > observed ? `기여자 ${observed}명 + 자기보고 ${claimed}명`
    : `기여자 ${observed}명 (자기보고보다 많음)`;

  return { nPeople: Math.round(n), coverage, basis };
}
```

#### 2.3.1 중복 계산 금지 — 타입으로 막는다 (D-084)

`N_people`을 곱하는 순간 반드시 나는 버그가 하나 있다. **`F`가 이미 조직 전체 건수인데 거기에 인원을 또 곱하는 것.** [SEED-CONTENT §D](./SEED-CONTENT.md)가 `N_people = 1 (중복 계산 방지)`라고 주석을 단 것이 그 흔적이다. 주석으로는 못 막는다.

```ts
// packages/analytics-core/src/features/volume.ts

/**
 * 규모는 둘 중 하나로만 표현된다. 두 필드를 동시에 노출하지 않는다.
 *
 *  per-person : "한 사람이 월 20건" × "그런 사람이 8명"
 *  org-total  : "조직 전체 월 88건"      ← 이 경우 인원은 이미 건수에 녹아 있다
 */
export type Volume =
  | { kind: 'per-person'; fPerPersonMonth: number; nPeople: number }
  | { kind: 'org-total'; fOrgMonth: number };

/** Value 공식이 쓰는 유일한 접근자. F × N_people을 직접 쓰는 코드는 없어야 한다 */
export function monthlyEvents(v: Volume): number {
  return v.kind === 'per-person' ? v.fPerPersonMonth * v.nPeople : v.fOrgMonth;
}

export function annualEvents(v: Volume): number {
  return monthlyEvents(v) * 12;
}

/**
 * 어느 쪽인지 판정한다.
 *  - freqLast7d는 **개인이 자기 손으로 한 횟수**다 → 언제나 per-person
 *  - 조직 집계(§6)에서 그룹 합계를 낼 때만 org-total로 승격된다
 * 즉 org-total은 L4에서만 만들어진다. L2는 절대 org-total을 만들지 않는다.
 */
export function volumeFromStep(freq: FreqResult, people: PeopleResult): Volume {
  return { kind: 'per-person', fPerPersonMonth: freq.perMonth, nPeople: people.nPeople };
}
```

린트 규칙으로 한 겹 더 막는다: `analytics-core` 안에서 `nPeople`을 `*` 연산자의 피연산자로 쓰는 것을 `no-restricted-syntax`로 금지하고, `monthlyEvents()` 경유만 허용한다.

### 2.4 `SaveRate` — 사용자가 판단할 수 없는 것을 추론한다 (D-085)

`automationLevel: 0..3`을 사용자에게 묻는 설계는 실패한다. "이 단계가 반자동인가요?"는 **답할 수 있는 질문이 아니다.** 사람들은 "엑셀 쓰니까 자동 아닌가?"라고 생각한다. 실제로는 엑셀에 손으로 치는 것이 가장 수동이다.

**추론의 근거가 되는 한 문장**: *도구를 쓴다는 것은 자동이라는 뜻이 아니다. 자동의 유일한 증거는 사람 손이 이미 안 간다는 것이다.*

```ts
// packages/analytics-core/src/features/save-rate.ts

export type AutomationLevel = 'manual' | 'semi' | 'auto';

/** PRD §4.8 확정값. 곱이 아니라 계수 */
export const SAVE_RATE: Record<AutomationLevel, number> = {
  manual: 0.7,
  semi:   0.4,
  auto:   0.1,
};

/** 수동을 확정짓는 어휘 — 사람의 손이 데이터를 옮긴다 */
const MANUAL_VERBS = [
  '입력', '기입', '적어', '옮겨', '옮기', '전기', '타이핑', '치고', '쳐서',
  '복사', '붙여넣', '수기', '작성', '취합', '정리', '대조', '맞춰', '매칭',
  '출력', '인쇄', '스캔', '날인', '서명', '전화', '통화', '문의',
];
/** 반자동 신호 — 도구가 일부를 해준다 */
const SEMI_VERBS = [
  '업로드', '다운로드', '내려받', '일괄', '한꺼번에', '몰아서', '양식', '템플릿',
  '매크로', '수식', '함수', '피벗', '가져오기', '내보내기', '변환',
];
/** 자동 신호 — 사람은 확인만 한다 */
const AUTO_VERBS = [
  '자동으로', '자동', '알림이', '알림 오면', '연동', '동기화', '싱크',
  '수신되면', '들어오면 자동', '스케줄', '예약',
];
/** 확인·판단 동사. 자동화 후에도 남는 일 */
const REVIEW_VERBS = ['확인', '검토', '점검', '체크', '승인', '결재', '판단'];

export type SaveRateInput = {
  title: string;
  kind: 'task' | 'hold';
  durationBand: DurationBand | null;
  toolIds: readonly string[];
  catalog: ToolCatalog;
  /** 앞 단계의 도구 집합 — 도구 전환 = 손으로 옮긴다는 뜻 */
  prevToolIds: readonly string[];
  /** "몰아서 하세요, 건건이 하세요?" 응답 */
  batchAnswer?: 'batch' | 'each';
  /** 사용자가 직접 고친 값이 있으면 그것이 최우선 */
  userOverride?: AutomationLevel;
};

export type SaveRateResult = {
  level: AutomationLevel;
  rate: number;
  inferred: boolean;
  /** 화면에 그대로 보여줄 근거 한 줄. "왜 수동이라고 봤나"에 답한다 */
  because: string;
  confidence: number;   // 0..1 — 추론 자체의 확신도
};

export function inferSaveRate(x: SaveRateInput): SaveRateResult {
  if (x.userOverride) {
    return {
      level: x.userOverride, rate: SAVE_RATE[x.userOverride],
      inferred: false, because: '직접 지정하셨어요', confidence: 1,
    };
  }

  const t = x.title;
  const tools = x.toolIds.map((id) => x.catalog[id]).filter(Boolean) as ToolEntry[];
  const grades = tools.map((v) => v.grade);
  const hasOffline = tools.some((v) => v.capsFeasibility);
  const allHigh = tools.length > 0 && grades.every((g) => g === 'high');
  const has = (dict: readonly string[]) => dict.some((w) => t.includes(w));

  // R1. 기다림은 사람 손이 안 가는 시간이다. SaveRate의 대상이 아니다
  //     (대기 단축은 LeadTimeValue가 담당한다 — §4)
  if (x.kind === 'hold') {
    return { level: 'manual', rate: SAVE_RATE.manual, inferred: true,
             because: '기다리는 시간이에요', confidence: 0.5 };
  }

  // R2. 오프라인·비연결 도구(종이·전화·인감·구두·카톡·HWP)가 하나라도 있으면 완전수동
  if (hasOffline || tools.length === 0) {
    return { level: 'manual', rate: SAVE_RATE.manual, inferred: true,
             because: tools.length === 0
               ? '쓰는 도구가 적혀 있지 않아요'
               : `${tools.find((v) => v.capsFeasibility)!.name}은 사람이 해야 해요`,
             confidence: 0.9 };
  }

  // R3. 도구 전환 = 앞 단계의 결과를 손으로 옮긴다는 뜻. 도구가 좋아도 수동이다
  const switched = x.prevToolIds.length > 0 && !x.toolIds.some((id) => x.prevToolIds.includes(id));
  if (switched && has(MANUAL_VERBS)) {
    return { level: 'manual', rate: SAVE_RATE.manual, inferred: true,
             because: '앞 단계와 다른 곳에 다시 적고 있어요', confidence: 0.85 };
  }

  // R4. 자동 어휘 + 짧은 시간 + 연결성 상 = 이미 자동. 남은 건 확인뿐
  const short = x.durationBand === '1m' || x.durationBand === '5m';
  if (has(AUTO_VERBS) && allHigh && short) {
    return { level: 'auto', rate: SAVE_RATE.auto, inferred: true,
             because: '이미 대부분 자동으로 흘러가는 것 같아요', confidence: 0.7 };
  }

  // R5. 확인·승인만 하는 짧은 단계 = 자동화해도 사람이 남는다 → 반자동으로 본다
  if (has(REVIEW_VERBS) && !has(MANUAL_VERBS) && short) {
    return { level: 'semi', rate: SAVE_RATE.semi, inferred: true,
             because: '보고 확인하는 일이라 사람이 일부 남아요', confidence: 0.65 };
  }

  // R6. 반자동 어휘 또는 일괄처리 답변
  if (has(SEMI_VERBS) || x.batchAnswer === 'batch') {
    return { level: 'semi', rate: SAVE_RATE.semi, inferred: true,
             because: x.batchAnswer === 'batch' ? '몰아서 처리한다고 하셨어요' : '도구가 일부를 대신하고 있어요',
             confidence: 0.6 };
  }

  // R7. 수동 어휘가 명시적으로 있다
  if (has(MANUAL_VERBS)) {
    return { level: 'manual', rate: SAVE_RATE.manual, inferred: true,
             because: '직접 입력하고 옮기는 일이에요', confidence: 0.8 };
  }

  // R8. 판단 근거 없음 → 수동으로 기울인다. 그리고 확신도를 낮게 준다.
  //     이유: 수동으로 잘못 보면 후보가 위로 올라와 사람 눈에 띄고 수정된다.
  //           자동으로 잘못 보면 후보가 조용히 사라지고 아무도 모른다.
  return { level: 'manual', rate: SAVE_RATE.manual, inferred: true,
           because: '어떻게 하는지가 아직 안 적혀 있어요', confidence: 0.35 };
}
```

**추론값의 UI 계약** — 추론 결과는 판정이 아니라 **기본값**이다. 메타데이터 카드 마지막에 한 줄로 나가고, 틀리면 1탭으로 고친다.

> *이 단계는 **직접 입력하고 옮기는 일**로 봤어요.* `[맞아요]` `[일부는 자동이에요]` `[거의 자동이에요]`

사용자가 고치면 `saveRateInferred = false`가 되고, 그 단계의 Confidence가 올라간다(§7.1). 그리고 **고친 사례는 규칙 개선 큐로 들어간다** — 규칙 R1~R8은 이 큐에서 자란다.

---

## 3. Feasibility 6요소 산출 규칙

```
Feasibility = 0.25·규칙결정성 + 0.20·입력구조화 + 0.20·시스템접근성
            + 0.15·(1 − 예외율) + 0.10·표준화 + 0.10·안정성
```

여섯 요소는 **성질이 다르다.** 셋(규칙결정성·입력구조화·시스템접근성)은 데이터에서 나오고, 하나(예외율)는 질문에서 나오고, 하나(표준화)는 **여러 사람이 있어야만** 나오고, 하나(안정성)는 **데이터로 못 나온다.** 여섯을 같은 방식으로 계산하는 척하면 안 된다.

```ts
// packages/analytics-core/src/scoring/feasibility.ts

export const F_WEIGHTS = {
  determinism:    0.25,
  inputStructure: 0.20,
  systemAccess:   0.20,
  exceptionInv:   0.15,
  standardization:0.10,
  stability:      0.10,
} as const;

export type FeasibilityFactor = {
  value: number;      // 0..1
  coverage: number;   // 0..1 — 이 값이 얼마나 데이터에 근거하는가
  because: string;    // 화면에 그대로 나가는 근거 한 줄
};

export type FeasibilityResult = {
  score: number;
  factors: Record<keyof typeof F_WEIGHTS, FeasibilityFactor>;
  /** 캡이 걸렸으면 그 이유 */
  cappedBy: string | null;
  coverage: number;
};

/** 미측정 요소의 중립값. 0이 아니다 — 0은 "불가능"이라는 강한 주장이다 */
const NEUTRAL = 0.5;

export function feasibility(f: Record<keyof typeof F_WEIGHTS, FeasibilityFactor>,
                            cap: { limit: number; reason: string } | null): FeasibilityResult {
  let score = 0;
  let covWeighted = 0;
  for (const k of Object.keys(F_WEIGHTS) as (keyof typeof F_WEIGHTS)[]) {
    score += F_WEIGHTS[k] * f[k].value;
    covWeighted += F_WEIGHTS[k] * f[k].coverage;
  }
  if (cap && score > cap.limit) {
    return { score: cap.limit, factors: f, cappedBy: cap.reason, coverage: covWeighted };
  }
  return { score, factors: f, cappedBy: null, coverage: covWeighted };
}
```

### 3.1 규칙결정성 (0.25) — 판단이 개입하는가

측정 대상은 **분기의 `caseLabel`**이다. "금액이 300만 원 이상이면"은 기계가 판정할 수 있고, "복잡한 문의면"은 못 한다. 이 둘을 가르는 것이 이 요소의 전부다.

```ts
// packages/analytics-core/src/scoring/determinism.ts

export type LabelClass = 'quantitative' | 'enumerable' | 'temporal' | 'subjective' | 'unknown';

/** 정량 — 숫자·단위·비교어가 함께 나온다 */
const QUANT_RE = /(\d[\d,]*\s*(원|만원|억|천|개|건|장|명|%|퍼센트|kg|박스))|(\d+\s*(이상|이하|초과|미만|넘|넘으면))/;
/** 시간·기간 — 역시 기계가 판정 가능 */
const TEMPORAL_RE = /(\d+\s*(일|영업일|시간|주|개월|분)\s*(이내|이상|이하|넘|지나|경과))|(마감|당일|익일|월말|월초|분기말|연말)/;
/** 열거 가능한 상태값 — 시스템 필드로 존재할 가능성이 높다 */
const ENUM_WORDS = [
  '승인', '반려', '반송', '취소', '완료', '미완료', '신규', '기존', '재구매',
  '국내', '해외', '개인', '법인', '사업자', '유료', '무료', '재고 있', '품절',
  '카드', '현금', '계좌이체', '선결제', '후결제', '정상', '불량', '파손',
];
/** 주관 — 사람 머릿속에만 있는 기준 */
const SUBJECTIVE_WORDS = [
  '복잡', '단순', '간단', '애매', '어려운', '쉬운', '중요', '급한', '긴급',
  '큰 건', '작은 건', '심한', '괜찮', '문제 있', '이상한', '보통', '웬만',
  '상황에 따라', '케이스', '경우에 따라', '판단', '재량', '알아서', '적당',
];

export function classifyCaseLabel(label: string): LabelClass {
  const s = label.trim();
  if (s.length === 0) return 'unknown';
  if (SUBJECTIVE_WORDS.some((w) => s.includes(w))) return 'subjective';   // 주관이 이긴다
  if (QUANT_RE.test(s)) return 'quantitative';
  if (TEMPORAL_RE.test(s)) return 'temporal';
  if (ENUM_WORDS.some((w) => s.includes(w))) return 'enumerable';
  return 'unknown';
}

const CLASS_SCORE: Record<LabelClass, number> = {
  quantitative: 1.0,
  temporal:     0.95,
  enumerable:   0.8,
  unknown:      0.4,    // 못 읽었다 ≠ 주관이다. 그러나 낙관도 하지 않는다
  subjective:   0.1,
};

export type DeterminismInput = {
  /** 스코프 안의 분기 노드들과 그 갈래 라벨 */
  branches: readonly { nodeId: string; labels: readonly string[] }[];
  /** "판단 기준이 문서에 있나요, 경험으로 아시나요?" 응답 (TOOLS.md 분기 공통) */
  criteriaSource: 'document' | 'experience' | null;
  /** 스코프의 예외율 — 분기가 없을 때 "숨은 판단"을 가려내는 데 쓴다 */
  exceptionRate: number | null;
  /** 조건스킵 분기: "건너뛰는 조건을 누가 판단하나요" 응답 유무 */
  hasSkipBranch: boolean;
};

export function determinism(x: DeterminismInput): FeasibilityFactor {
  const labels = x.branches.flatMap((b) => b.labels);

  // ── 분기가 하나도 없다 ────────────────────────────────────────────────
  // 두 가지 뜻이 있고, 예외율이 그 둘을 가른다.
  //   (a) 정말 일직선 업무   → 자동화하기 좋다
  //   (b) 판단을 안 적었을 뿐 → 숨은 분기가 있다
  if (labels.length === 0) {
    const ex = x.exceptionRate;
    if (ex === null) {
      return { value: 0.6, coverage: 0.2,
               because: '갈라지는 곳이 없는 일이에요 (예외를 아직 안 물어봤어요)' };
    }
    if (ex <= 0.1) {
      return { value: 0.9, coverage: 0.8, because: '갈라지는 곳 없이 늘 같은 순서로 흘러가요' };
    }
    // 분기는 없는데 예외는 많다 = 판단이 글로 안 나온 상태. 가장 위험한 조합
    return { value: 0.45, coverage: 0.6,
             because: '갈래는 없는데 예외가 잦아요 — 적히지 않은 판단이 있는 것 같아요' };
  }

  // ── 라벨 분류 → 최악 가중 평균 ────────────────────────────────────────
  // 평균이 아니라 "가장 주관적인 갈래"에 무게를 싣는다.
  // 갈래 하나가 사람 판단이면 그 분기 전체가 무인 실행이 안 된다.
  const scores = labels.map((l) => CLASS_SCORE[classifyCaseLabel(l)]);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  let value = 0.5 * min + 0.5 * mean;

  // 암묵지 보정 — TOOLS.md가 "자동화 난이도 핵심 지표"라고 못 박은 문항
  if (x.criteriaSource === 'experience') value *= 0.6;
  if (x.criteriaSource === 'document') value = Math.min(1, value * 1.15);

  // 조건스킵은 "건너뛸지 말지"를 사람이 판단하는 구조라 기본 감점
  if (x.hasSkipBranch) value *= 0.85;

  const unknownRatio = labels.filter((l) => classifyCaseLabel(l) === 'unknown').length / labels.length;
  const coverage = (x.criteriaSource !== null ? 0.5 : 0.3) + 0.5 * (1 - unknownRatio);

  const worst = labels[scores.indexOf(min)];
  const because =
    min <= 0.2 ? `"${worst}" 같은 판단은 사람이 해야 해요`
    : min >= 0.8 ? '갈라지는 기준이 숫자와 상태값으로 적혀 있어요'
    : '기준이 일부만 명확해요';

  return { value: clamp01(value), coverage: Math.min(1, coverage), because };
}
```

> **왜 최소값에 절반의 무게를 주는가** — 분기 3개 중 2개가 "300만원 이상/미만"이고 1개가 "애매한 건"이면 평균은 0.7이 나온다. 그러나 실제로는 그 1개 때문에 사람이 계속 봐야 한다. 무인 실행 가능성은 **가장 약한 갈래**가 결정한다.

### 3.2 입력구조화 (0.20) — 들어오는 데이터가 구조화되어 있는가

**이 단계의 입력은 앞 단계의 출력이다.** 그래서 이 요소는 자기 도구가 아니라 **선행 노드의 도구**를 본다. 이것이 시스템접근성(§3.3)과 겹치지 않는 이유다.

```ts
// packages/analytics-core/src/scoring/input-structure.ts

/** 도구가 내놓는 데이터의 구조화 정도 */
const STRUCTURE_SCORE: Record<ToolGrade, number> = { high: 1.0, mid: 0.55, low: 0.15 };

export type InputStructureInput = {
  /** 선행 단계들의 도구 (없으면 = 흐름의 시작 = 외부 입력) */
  upstreamToolIds: readonly string[];
  /** 이 단계 자신의 도구 — 선행이 없을 때의 폴백 */
  ownToolIds: readonly string[];
  catalog: ToolCatalog;
  /** 접합 소켓의 산출물 클래스 (ASSEMBLY: 'identifier'는 조인 강도 최상) */
  inboundObjectClass?: 'request'|'approval'|'evidence'|'record'|'identifier'|'physical'|'notice';
  /** 흐름의 첫 단계인가 = 입력이 조직 밖에서 온다 */
  isEntry: boolean;
};

export function inputStructure(x: InputStructureInput): FeasibilityFactor {
  const ids = x.upstreamToolIds.length > 0 ? x.upstreamToolIds : x.ownToolIds;
  const tools = ids.map((id) => x.catalog[id]).filter(Boolean) as ToolEntry[];

  if (tools.length === 0) {
    return { value: 0.3, coverage: 0,
             because: '무엇으로 받는지가 아직 안 적혀 있어요' };
  }

  // 여러 곳에서 들어오면 가장 나쁜 입력이 병목이다 — 최소값
  const base = Math.min(...tools.map((t) => STRUCTURE_SCORE[t.grade]));
  // structuredIO가 명시적으로 false면(메신저·메일 본문·종이) 등급과 무관하게 깎는다.
  // 슬랙은 연결성 '상'이지만 슬랙 대화에서 오는 입력은 구조화 데이터가 아니다.
  const anyUnstructured = tools.some((t) => !t.structuredIO);
  let value = anyUnstructured ? Math.min(base, 0.4) : base;

  // 산출물이 식별자(주문번호·품의번호)면 구조화의 최강 신호
  if (x.inboundObjectClass === 'identifier') value = Math.min(1, value + 0.25);
  if (x.inboundObjectClass === 'physical') value = Math.min(value, 0.15);

  // 흐름의 시작 = 외부(고객·거래처)에서 들어옴. 통제 밖이라 감점
  if (x.isEntry) value *= 0.85;

  const worst = tools.reduce((a, b) =>
    STRUCTURE_SCORE[a.grade] <= STRUCTURE_SCORE[b.grade] ? a : b);
  return {
    value: clamp01(value),
    coverage: 0.8,
    because: anyUnstructured
      ? `${worst.name}에서 오는 정보는 정해진 형식이 없어요`
      : `${worst.name}에서 정해진 형식으로 들어와요`,
  };
}
```

### 3.3 시스템접근성 (0.20) + **캡** — 하 등급이 하나라도 있으면

```ts
// packages/analytics-core/src/scoring/system-access.ts

const GRADE_SCORE: Record<ToolGrade, number> = { high: 1.0, mid: 0.55, low: 0.15 };

/** TOOLS.md에서 capsFeasibility = true인 것들. 카탈로그가 정본이고 여기는 설명용 */
export const CAP_TOOL_NOTE: Record<string, string> = {
  'cert-joint':    '공동인증서가 필요해서 무인 실행이 사실상 안 돼요',
  'hometax':       '홈택스는 공식 API가 없어요 (바로빌 같은 ASP로 바꾸면 달라져요)',
  'kakaotalk':     '카카오톡 개인 대화는 읽어올 방법이 없어요',
  'hwp':           '한글 파일은 다루는 표준 방법이 없어요',
  'phone':         '전화는 기록 자체가 남지 않아요',
  'paper':         '종이 서류는 시스템에서 못 봐요',
  'seal':          '도장은 사람이 찍어야 해요',
  'verbal':        '말로 하는 요청은 어디에도 안 남아요',
};

export const FEASIBILITY_CAP = 0.5;

export function systemAccess(
  toolIds: readonly string[],
  catalog: ToolCatalog,
): { factor: FeasibilityFactor; cap: { limit: number; reason: string } | null } {

  const tools = toolIds.map((id) => catalog[id]).filter(Boolean) as ToolEntry[];

  if (tools.length === 0) {
    return {
      factor: { value: 0.3, coverage: 0, because: '쓰는 도구가 아직 안 적혀 있어요' },
      cap: null,
    };
  }

  const scores = tools.map((t) => GRADE_SCORE[t.grade]);
  const min = Math.min(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // ★ 체인은 가장 약한 고리에서 끊긴다. 그래서 최소값에 더 큰 무게.
  //   슬랙(상) + 홈택스(중) + 종이(하)의 평균 0.57은 현실을 완전히 왜곡한다.
  const value = 0.6 * min + 0.4 * mean;

  // ── 캡 판정 ─────────────────────────────────────────────────────────────
  // TOOLS.md: "이 단계가 있으면 Feasibility 상한이 0.5로 캡됨"
  // 캡은 요소가 아니라 **최종 점수에 걸리는 천장**이다. 가중합에 섞으면
  // 나머지 다섯 요소가 만점일 때 0.5를 넘어버린다.
  const capper = tools.find((t) => t.capsFeasibility);
  const cap = capper
    ? { limit: FEASIBILITY_CAP,
        reason: CAP_TOOL_NOTE[capper.id] ?? `${capper.name}은(는) 사람 손이 반드시 필요해요` }
    : null;

  const worst = tools[scores.indexOf(min)];
  return {
    factor: {
      value: clamp01(value),
      coverage: 0.9,
      because: min >= 1 ? '쓰는 도구가 전부 연결 가능한 것들이에요'
             : `${worst.name}이(가) 연결의 병목이에요`,
    },
    cap,
  };
}
```

**캡이 걸린 후보는 버리지 않는다.** [TOOLS.md 운영규칙 3](./TOOLS.md)이 못 박은 대로, **"도구를 바꾸면 상이 됨"** 형태의 **선행 개선 후보**(`candidateKind = 'precondition'`)로 분리 출력한다.

```ts
/** 캡 후보 → 선행 개선 제안. 이게 경영진에게 가장 잘 팔리는 형태 중 하나다 */
export function precondition(tools: readonly ToolEntry[]): PreconditionSuggestion | null {
  const capper = tools.find((t) => t.capsFeasibility && t.upgradePath);
  if (!capper?.upgradePath) return null;
  return {
    fromToolId: capper.id,
    toToolId: capper.upgradePath.toToolId,
    note: capper.upgradePath.note,
    // 캡이 풀렸을 때의 Feasibility를 다시 계산해서 "얼마나 좋아지는지"를 보여준다
    liftsCapTo: null,   // L5에서 재계산해 채운다
  };
}
```

세 개의 대표 경로가 시드에 이미 들어 있다 — **홈택스 → 바로빌**(SEED D-1의 선행 조건 1), **엑셀 → 구글시트**, **종이 → 전자계약**.

### 3.4 (1 − 예외율) (0.15)

원천은 [TOOLS.md](./TOOLS.md)의 공통 프롬프트 **"10번 중 몇 번은 이렇게 안 흘러가나요?"** 하나다. 여기에 두 가지 보정이 붙는다.

```ts
// packages/analytics-core/src/scoring/exception.ts

export type ExceptionInput = {
  /** 프롬프트 응답 0..10. 미응답이면 null */
  per10: number | null;
  /** 0이라 답한 뒤 재질문("정말 한 번도요?")을 거쳤는가 */
  reasked: boolean;
  /** 스코프 안 사이클들의 반려율 — 예외의 다른 얼굴이다 */
  reworkRates: readonly number[];
  /** 조직 사전값. 없으면 전역 0.2 */
  priorRate: number;
};

/** 사람은 예외를 구조적으로 과소보고한다. 0은 존재하지 않는 값으로 본다 */
const EXCEPTION_FLOOR = 0.05;

export function exceptionInverse(x: ExceptionInput): FeasibilityFactor {
  let promptRate: number;
  let coverage: number;

  if (x.per10 === null) {
    // ★ 미응답을 0으로 읽지 않는다. 미응답은 "예외가 없다"가 아니라 "안 물어봤다"이다
    promptRate = x.priorRate;
    coverage = 0;
  } else if (x.per10 === 0) {
    // 0 응답: 재질문을 거쳤으면 바닥값, 안 거쳤으면 신뢰하지 않는다
    promptRate = x.reasked ? EXCEPTION_FLOOR : Math.max(EXCEPTION_FLOOR, x.priorRate * 0.5);
    coverage = x.reasked ? 0.7 : 0.3;
  } else {
    promptRate = Math.min(1, x.per10 / 10);
    coverage = 1;
  }

  // 재작업 루프는 "이렇게 안 흘러간 경우"의 이미 관측된 형태다.
  // 두 확률을 독립으로 보고 결합한다 — 더하면 1을 넘고, max를 쓰면 정보를 버린다.
  const rework = x.reworkRates.length > 0 ? Math.max(...x.reworkRates) : 0;
  const combined = 1 - (1 - promptRate) * (1 - rework);

  return {
    value: clamp01(1 - combined),
    coverage: x.reworkRates.length > 0 ? Math.min(1, coverage + 0.2) : coverage,
    because:
      combined >= 0.4 ? `10번 중 ${Math.round(combined * 10)}번은 다르게 흘러가요`
      : combined <= 0.1 ? '거의 늘 같은 방식으로 흘러가요'
      : `가끔(10번 중 ${Math.round(combined * 10)}번) 다르게 흘러가요`,
  };
}
```

### 3.5 표준화 (0.10) — 같은 프로세스를 여러 사람이 다르게 적었는가

**혼자 쓴 문서에서는 계산할 수 없다.** 이때 1.0을 주면 안 된다("혼자 하니까 표준"은 거짓이고, 1인 문서가 전부 Feasibility 상위로 올라간다). 중립 0.5 + coverage 0을 준다.

계산은 §6의 프로세스 그룹 위에서 돈다. 네 개의 축을 본다.

```ts
// packages/analytics-core/src/scoring/standardization.ts

export type GroupVariance = {
  /** 그룹 기여자 수 */
  n: number;
  /** ① 단계 수 변동계수 (표준편차 / 평균) */
  stepCountCv: number;
  /** ② 도구 집합 평균 Jaccard 유사도 (1 = 전원 같은 도구) */
  toolJaccard: number;
  /** ③ 시간 밴드 불일치 — 2밴드 이상 벌어진 단계쌍 비율 (ASSEMBLY §7.1의 표현차 필터와 같은 기준) */
  bandDisagreeRatio: number;
  /** ④ 단계 순서 일치도 — 정규화 Kendall tau (1 = 완전 같은 순서) */
  orderTau: number;
};

export function standardization(v: GroupVariance | null): FeasibilityFactor {
  if (v === null || v.n < 2) {
    return { value: 0.5, coverage: 0,
             because: '이 일을 적은 사람이 아직 한 명이라 비교할 수 없어요' };
  }

  const stepAgree = clamp01(1 - v.stepCountCv);          // CV 0 → 1, CV 1 → 0
  const value =
    0.25 * stepAgree +
    0.30 * v.toolJaccard +
    0.25 * (1 - v.bandDisagreeRatio) +
    0.20 * v.orderTau;

  // 사람이 많을수록 이 측정을 더 믿는다
  const coverage = Math.min(0.95, 0.3 + 0.15 * v.n);

  const weakest = argmin({
    '단계 수': stepAgree, '쓰는 도구': v.toolJaccard,
    '걸리는 시간': 1 - v.bandDisagreeRatio, '순서': v.orderTau,
  });

  return {
    value: clamp01(value),
    coverage,
    because: value >= 0.75
      ? `${v.n}명이 거의 같은 방식으로 적었어요`
      : `${v.n}명이 적은 내용 중 ${weakest}이(가) 서로 달라요`,
  };
}
```

**이 값은 두 곳에서 동시에 쓰인다** — Feasibility의 한 항이면서, §6.3의 **프로세스 변동성 신호**의 역수다. 표준화가 낮은 것은 자동화 난이도이기도 하지만 **그 자체가 경영진에게 파는 산출물**이다("같은 일을 다섯 명이 다섯 가지로 하고 있습니다").

### 3.6 안정성 (0.10) — 데이터로 못 얻는다 (D-087)

*"앞으로 이 프로세스가 얼마나 안 바뀔 것인가"*는 미래에 대한 질문이고, 우리 데이터에는 과거만 있다. 지어내는 대신 **세 층으로 폴백**하고, 어느 층에서 나온 값인지를 리포트에 표시한다.

```ts
// packages/analytics-core/src/scoring/stability.ts

export type StabilityInput = {
  /** ── 3층: 사람이 직접 답한 것. 있으면 무조건 이것이 이긴다 ── */
  changeExpected: 'will-change' | 'unknown' | 'stable' | null;

  /** ── 2층: 도메인 사전값 ── */
  domain: StabilityDomain | null;

  /** ── 1층: 프록시 (관측 가능한 과거) ── */
  proxy: {
    /** 최근 90일 구조 변경(op) 횟수 — operations 로그에서 */
    structuralEditsLast90d: number;
    /** 마지막 확인으로부터 경과일 */
    daysSinceConfirmed: number | null;
    /** 이 단계의 도구 중 최근 12개월 내 교체된 것이 있는가 */
    toolChanged: boolean;
    /** 문서 나이(일) — 너무 어리면 프록시가 무의미하다 */
    docAgeDays: number;
  };
};

export type StabilityDomain =
  | 'statutory'      // 법정 절차 (4대보험·세금계산서·급여·부가세) — 법이 안 바뀌면 안 바뀐다
  | 'accounting'     // 회계 마감·정산
  | 'contract'       // 계약·정책 종속
  | 'operations'     // 물류·CS 운영
  | 'sales'          // 영업 프로세스
  | 'marketing';     // 캠페인·프로모션 — 분기마다 바뀐다

const DOMAIN_PRIOR: Record<StabilityDomain, number> = {
  statutory:  0.90,
  accounting: 0.80,
  contract:   0.65,
  operations: 0.60,
  sales:      0.50,
  marketing:  0.35,
};

const ANSWER_SCORE = { 'will-change': 0.25, unknown: 0.55, stable: 0.90 } as const;

/** 데이터가 아무것도 없을 때. 낙관도 비관도 아닌 값 */
const STABILITY_DEFAULT = 0.6;

export function stability(x: StabilityInput): FeasibilityFactor {
  // ── 3층 ── 상위 후보에 진입한 시점에만 관리자에게 딱 한 문항 묻는다
  if (x.changeExpected) {
    return {
      value: ANSWER_SCORE[x.changeExpected],
      coverage: 1,
      because: x.changeExpected === 'will-change'
        ? '곧 방식이 바뀔 예정이라고 하셨어요'
        : x.changeExpected === 'stable' ? '당분간 안 바뀐다고 하셨어요' : '바뀔지 모르겠다고 하셨어요',
    };
  }

  // ── 1층 프록시 ── 문서가 60일 미만이면 편집 이력이 "불안정"이 아니라 "작성 중"이다
  const proxyUsable = x.proxy.docAgeDays >= 60;
  let proxyScore: number | null = null;
  if (proxyUsable) {
    const edits = x.proxy.structuralEditsLast90d;
    //  0회 → 0.9 / 1~2회 → 0.7 / 3~5회 → 0.5 / 6회+ → 0.3
    proxyScore = edits === 0 ? 0.9 : edits <= 2 ? 0.7 : edits <= 5 ? 0.5 : 0.3;
    if (x.proxy.toolChanged) proxyScore -= 0.15;
    // 오래 확인 안 된 문서는 "안 바뀐 것"이 아니라 "모르는 것"이다 → 중립으로 끌어당긴다
    const stale = (x.proxy.daysSinceConfirmed ?? 0) > 180;
    if (stale) proxyScore = proxyScore * 0.5 + STABILITY_DEFAULT * 0.5;
  }

  // ── 2층 도메인 prior ──
  const prior = x.domain ? DOMAIN_PRIOR[x.domain] : null;

  if (proxyScore !== null && prior !== null) {
    return { value: clamp01(0.5 * proxyScore + 0.5 * prior), coverage: 0.5,
             because: '지금까지 바뀐 이력과 업무 종류로 추정한 값이에요' };
  }
  if (prior !== null) {
    return { value: prior, coverage: 0.3, because: '업무 종류로 추정한 값이에요' };
  }
  if (proxyScore !== null) {
    return { value: clamp01(proxyScore), coverage: 0.3,
             because: '지금까지 이 문서가 바뀐 이력으로 추정한 값이에요' };
  }
  return { value: STABILITY_DEFAULT, coverage: 0,
           because: '이 항목은 아직 추정값이에요' };
}
```

**3층 질문을 언제 묻는가** — 후보가 `priorityP10` 상위 10에 처음 진입한 날, 그 문서 소유자에게 **딱 한 번**, 슬랙 DM 1문항으로.

> *「세금계산서 끊기」 흐름, 앞으로 1년 안에 하는 방식이 바뀔 예정인가요?*
> `[바뀔 예정이에요]` `[모르겠어요]` `[안 바뀔 거예요]`

[POLICY §3.1](./POLICY.md)의 알림 상한(주 3건) 안에서 나가고, 무응답이면 재촉하지 않는다. `unknown`도 정보다 — coverage 1로 기록된다.

### 3.7 조립

```ts
export function scoreFeasibility(x: ScopeInput): FeasibilityResult {
  const sa = systemAccess(x.allToolIds, x.catalog);
  return feasibility(
    {
      determinism:     determinism(x.determinismInput),
      inputStructure:  inputStructure(x.inputStructureInput),
      systemAccess:    sa.factor,
      exceptionInv:    exceptionInverse(x.exceptionInput),
      standardization: standardization(x.groupVariance),
      stability:       stability(x.stabilityInput),
    },
    sa.cap,
  );
}
```

**SEED D-1(세금계산서)로 검증** — 이 문서의 골든 픽스처가 재현해야 하는 값:

| 요소 | 목표 | 이 규칙의 산출 |
|---|---|---|
| 규칙결정성 | .90 | 갈래 "신규 거래처 / 기존 거래처" = `enumerable`(0.8) 2개, 기준=문서 → 0.8×1.15 = **0.92** |
| 입력구조화 | .80 | 상류 = 영업의 수주 등록(ERP, 중=0.55) + 산출물 `identifier`(수주번호) +0.25 → **0.80** |
| 시스템접근성 | .70 | 바로빌(상 1.0)·ERP(중 0.55) → 0.6×0.55+0.4×0.775 = **0.64** (홈택스 유지 시 캡 0.5) |
| 1−예외율 | .75 | per10 = 2, 반려율 0.05 → 1−(1−0.2)(1−0.05) = 0.24 → **0.76** |
| 표준화 | .80 | 그룹 3명, 도구 Jaccard 0.85, 밴드 불일치 0.1 → **0.79** |
| 안정성 | .90 | 도메인 `statutory` → **0.90** |
| **합계** | **.81** | 0.25(.92)+0.20(.80)+0.20(.64)+0.15(.76)+0.10(.79)+0.10(.90) = **0.79** |

0.81 대 0.79. 이 정도 차이가 이 스코어가 낼 수 있는 정밀도의 한계이고, §11이 말하는 그대로다.

---

## 4. LeadTimeValue와 RiskValue

인시 절감만 보면 [SEED D-2(신규 입사자)](./SEED-CONTENT.md)가 연 79만 원짜리 후보로 탈락한다. 실제 가치는 428만 원이고 그중 270만 원이 리드타임이다. **이 두 항이 없으면 스코어링 설계가 틀린 것이다.**

동시에 이 두 항은 **가장 부풀리기 쉬운 항**이다. 규칙을 강하게 건다.

### 4.1 LeadTimeValue

```
LeadTimeValue = Δ리드타임(일) × 연 발생건수 × 단위지연비용(원/일/건)
```

Δ리드타임은 **우리가 이미 계산한다** — `metrics.leadTimeH`(현재)와 자동화 후 예상치의 차이. 후자를 어떻게 아는가가 유일한 문제다.

```ts
// packages/analytics-core/src/scoring/lead-time.ts

/**
 * 자동화 후 리드타임 추정 — 단계 유형별 결정적 규칙.
 * "AI가 예측"하지 않는다. 규칙 4개가 전부이고, 각 규칙은 근거 한 줄과 함께 나간다.
 */
export function estimatedLeadTimeAfterH(g: DerivedGraph, scope: ReadonlySet<NodeId>,
                                        save: Map<NodeId, AutomationLevel>): number {
  let after = 0;
  for (const id of scope) {
    const n = g.byId.get(id); const m = g.metrics.perNode.get(id);
    if (!n || !m || n.synthetic) continue;
    const w = m.reachProbability * m.expectedPasses;

    if (n.kind === 'hold') {
      // R1. 자원·시각 대기는 자동화해도 안 줄어든다. 세상이 기다리는 시간이다
      if (n.waitFor === 'time' || n.waitFor === 'resource') { after += w * m.waitH; continue; }
      // R2. 응답 대기는 자동 재촉/알림으로 절반까지 준다 (보수적)
      if (n.waitFor === 'reply')    { after += w * m.waitH * 0.5; continue; }
      // R3. 승인 대기는 알림 자동화만으로는 안 줄어든다. 줄이려면 ECRS(제거·기준 상향)다
      //     → 여기서는 그대로 두고, 제거 후보 쪽에서 값을 잡는다 (이중 계산 금지)
      after += w * m.waitH; continue;
    }
    // R4. 작업 단계는 자동화 수준에 따라 접촉시간이 줄고, 줄어든 만큼 리드타임도 준다
    const rate = SAVE_RATE[save.get(id) ?? 'manual'];
    after += w * m.touchH * (1 - rate);
  }
  return after;
}
```

**단위지연비용**은 카테고리별로 계산식이 다르다. 조직이 값을 넣지 않은 카테고리는 **미산정**으로 남는다(D-088).

| 카테고리 | 계산식 | 필요한 입력 | 없으면 |
|---|---|---|---|
| **현금흐름형** (청구·수금·세금계산서·정산) | `건당 금액 × 연이율 / 365` | 건당 평균 금액, 조직 연이율(기본 5%) | 미산정. 단 "건당 금액만 넣으면 계산됩니다" 배너 |
| **고객대기형** (CS 첫 응답·견적 회신) | `재문의 감소건수 × 재문의 처리단가` + (이탈 방지는 **기본 제외**) | 재문의율, 문의 처리 시간 | 재문의율은 CS 도구 로그에서 오면 실측, 없으면 미산정 |
| **내부생산성형** (입사자 장비·계정) | `대기 인원수 × 대기일 × 일 생산성단가` | 일 생산성단가(기본 = Rate × 8) | 계산 가능 (Rate만 있으면 됨) |
| **마감형** (월마감·급여 마감) | `마감 참여 인원 × 단축일 × Rate × 8` | 마감 참여 인원 | 문서의 `peopleCount`로 하한 추정 가능 |
| **규정기한형** (신고·납부 기한) | 0 — 기한을 지키는 한 리드타임 단축의 금전 가치는 없다 | — | **의도적으로 0.** 여기 값을 넣으면 부풀린다 |

```ts
export type DelayCostModel =
  | { kind: 'cash-flow'; avgAmountKrw: number; annualRatePct: number }
  | { kind: 'customer-wait'; reinquiryRate: number; handlingH: number; rateKrwPerH: number }
  | { kind: 'internal-productivity'; waitingHeadcount: number; dailyValueKrw: number }
  | { kind: 'deadline'; participants: number; rateKrwPerH: number }
  | { kind: 'statutory'; }                     // 항상 0
  | { kind: 'unpriced'; note: string };        // ★ 0이 아니라 미산정

export function delayCostPerDayPerEvent(m: DelayCostModel): number | null {
  switch (m.kind) {
    case 'cash-flow':
      return m.avgAmountKrw * (m.annualRatePct / 100) / 365;
    case 'customer-wait':
      return m.reinquiryRate * m.handlingH * m.rateKrwPerH;
    case 'internal-productivity':
      return m.waitingHeadcount * m.dailyValueKrw;
    case 'deadline':
      return m.participants * m.rateKrwPerH * 8;
    case 'statutory':
      return 0;
    case 'unpriced':
      return null;      // ★ null이 파이프라인 끝까지 간다. 0으로 접지 않는다
  }
}

export function leadTimeValue(
  beforeH: number, afterH: number, annualEventCount: number, model: DelayCostModel,
): { krw: number | null; deltaDays: number; note: string } {
  const deltaDays = Math.max(0, (beforeH - afterH) / 24);
  const per = delayCostPerDayPerEvent(model);
  if (per === null) {
    return { krw: null, deltaDays,
             note: `리드타임이 ${fmtDays(deltaDays)} 줄지만, 그 가치를 계산할 정보가 없어요` };
  }
  return { krw: deltaDays * annualEventCount * per, deltaDays,
           note: `${fmtDays(deltaDays)} 단축 × 연 ${annualEventCount}건` };
}
```

> **하루 = 24시간인가 8시간인가** — 리드타임은 달력 시간이다. `avgWaitH = 24`는 하루를 뜻한다. 그래서 `/24`가 맞다. 반면 `dailyValueKrw`는 근무시간 기준이라 `Rate × 8`이다. 이 둘을 섞으면 3배 틀린다.

### 4.2 RiskValue — 기본은 **미산정**이다 (D-088)

리스크는 무한히 부풀릴 수 있다. *"이 실수가 나면 고객을 잃을 수도 있으니 연 1억"* 같은 문장이 한 번 리포트에 실리면 그 리포트 전체가 죽는다.

**자동 산출은 금액이 법으로 정해진 경우에만 한다.**

```ts
// packages/analytics-core/src/scoring/risk.ts

/** 법정 가산세·과태료 — 금액이 법령에 있으므로 우리가 지어내지 않는다 */
export type StatutoryPenalty = {
  code: string;
  label: string;
  /** 과세표준 대비 요율 또는 정액 */
  basis: { kind: 'rate'; pct: number } | { kind: 'fixed'; krw: number };
  /** 이 벌칙이 걸리는 프로세스 도메인 */
  applies: StabilityDomain[];
};

export const STATUTORY_PENALTIES: readonly StatutoryPenalty[] = [
  { code: 'tax-invoice-late', label: '세금계산서 지연발급 가산세',
    basis: { kind: 'rate', pct: 1 }, applies: ['statutory', 'accounting'] },
  { code: 'tax-invoice-none', label: '세금계산서 미발급 가산세',
    basis: { kind: 'rate', pct: 2 }, applies: ['statutory', 'accounting'] },
  { code: 'insurance-late', label: '4대보험 신고 지연 과태료',
    basis: { kind: 'fixed', krw: 30_000 }, applies: ['statutory'] },
  // 요율은 조직 설정에서 덮어쓸 수 있다. 법이 바뀌면 코드가 아니라 설정을 고친다
];

export type RiskInput = {
  domain: StabilityDomain | null;
  /** 이 프로세스에서 실제로 실수가 난 빈도. "놓치면 어떻게 되나요" 응답 + 재작업 루프 */
  incidentRatePerEvent: number | null;
  avgAmountKrw: number | null;
  annualEventCount: number;
  /** 조직이 직접 입력한 리스크 금액 (사람이 채운 값) */
  manualKrwPerYear: number | null;
};

export type RiskResult = { krw: number | null; basis: string; unpriced: string[] };

export function riskValue(x: RiskInput): RiskResult {
  // 1. 사람이 넣은 값이 있으면 그것이 이긴다. 우리가 추정하지 않는다
  if (x.manualKrwPerYear != null) {
    return { krw: x.manualKrwPerYear, basis: '직접 입력한 값', unpriced: [] };
  }

  // 2. 법정 벌칙 — 도메인 + 사고율 + 금액이 셋 다 있을 때만
  const p = x.domain
    ? STATUTORY_PENALTIES.find((q) => q.applies.includes(x.domain!))
    : undefined;

  if (p && x.incidentRatePerEvent != null) {
    const perEvent = p.basis.kind === 'fixed'
      ? p.basis.krw
      : x.avgAmountKrw != null ? x.avgAmountKrw * (p.basis.pct / 100) : null;
    if (perEvent != null) {
      return {
        krw: x.incidentRatePerEvent * x.annualEventCount * perEvent,
        basis: `${p.label} 회피 (10번 중 ${Math.round(x.incidentRatePerEvent * 10)}번 발생 기준)`,
        unpriced: [],
      };
    }
    return { krw: null, basis: '', unpriced: [`${p.label} — 건당 금액을 넣으면 계산돼요`] };
  }

  // 3. ★ 그 외 전부 미산정. 0이 아니다
  return {
    krw: null, basis: '',
    unpriced: ['실수가 났을 때의 비용 — 아직 계산하지 않았어요'],
  };
}
```

**절대 하지 않는 것 3가지**

1. **재작업 비용을 RiskValue에 넣지 않는다.** 재작업은 이미 `expectedPasses`를 통해 `T_touch`에 들어가 있다. 다시 넣으면 이중 계산이다. (같은 이유로 승인 대기 단축은 §4.1 R3에서 제외했다)
2. **평판·이탈 손실을 자동 계산하지 않는다.** 사람이 넣으면 그대로 쓰고, 안 넣으면 미산정이다.
3. **"사고가 안 난 것"을 절감으로 세지 않는다.** 지난 1년 사고 0건인 프로세스의 RiskValue는 0이 아니라 **미산정**이다 — 사고율을 모르는 것이지 0인 것이 아니다.

### 4.3 미산정을 화면에서 어떻게 다루는가

```ts
export type ValueBreakdown = {
  laborKrw: number;                  // (T×F×N×12×Rate)×SaveRate
  leadTimeKrw: number | null;
  riskKrw: number | null;
  /** 계산하지 못한 항목의 사람 말 목록. 카드에 그대로 나간다 */
  unpriced: readonly string[];
  totalKrw: number;                  // null 항은 빼고 더한다
};
```

경영진 카드의 표기 (WRITING.md 문체 준수):

```
연 1,390만 원      인시 절감
+ 156만 원         발행이 1.5일 → 0.2일로 빨라짐
+ 계산 안 함        발행 실수가 났을 때의 비용
────────────────
합계 1,546만 원 이상    ← "이상". 미산정 항이 있으면 반드시 이 말이 붙는다
```

**"계산 안 함"과 "0원"은 다르게 보여야 한다.** 0원은 "가치 없음"이고 미산정은 "우리가 모름"이다. 이 구분이 사라지면 리드타임 가치가 큰 후보(D-2 유형)가 조용히 순위에서 사라진다.

---

## 5. ECRS 필터 — 제거 후보 자동 검출

**랭킹보다 먼저 돈다.** 제거 후보로 판정된 단계는 자동화 후보 스코프에서 빠지고, 대신 `precondition` 또는 `eliminate` 후보가 된다.

관리자 화면 노출 단위는 [POLICY §8.1 위젯 5](./POLICY.md)가 정한 대로 **"단계 유형"**이다 — 개별 단계가 아니라 패턴이다. 검출은 단계 단위로 하고, 노출은 유형 단위로 롤업한다.

### 5.0 공통 인터페이스

```ts
// packages/analytics-core/src/ecrs/types.ts

/** ECRS 4분류 */
export type EcrsAction = 'eliminate' | 'combine' | 'rearrange' | 'simplify';

export type EliminationPattern = {
  id: `E${number}`;
  action: EcrsAction;
  label: string;
  detect: (ctx: EcrsContext) => EliminationHit[];
};

export type EliminationHit = {
  patternId: string;
  docId: string;
  nodeIds: readonly NodeId[];
  /** 검출 근거 — 숫자 그대로. 사람이 검증할 수 있어야 한다 */
  evidence: Record<string, string | number>;
  /** 경영진용 문구 (§5.13에서 렌더) */
  execCopy: ExecCopy;
  /** 예상 절감 */
  saving: EliminationSaving;
  /** 0..1 — 이 검출이 오탐일 가능성의 역수 */
  precision: number;
};

export type EliminationSaving = {
  /** 회수되는 사람 시간 (연간, 시간) */
  laborHPerYear: number | null;
  /** 단축되는 리드타임 (일) */
  leadDaysSaved: number | null;
  krw: number | null;
  /** 개발이 필요한가 — 이게 제거 후보가 잘 팔리는 이유다 */
  devEffort: 'none' | 'config' | 'small' | 'project';
};

export type ExecCopy = {
  headline: string;      // 한 줄. 부서를 주어로 쓰지 않는다 (POLICY §5.2)
  evidence: string;      // 근거 한 줄
  proposal: string;      // 제안 한 줄
  effect: string;        // 효과 한 줄
};
```

### 5.1 검출기 전량 (12종)

| # | 패턴 | ECRS | 신호 | 개발 필요 |
|---|---|---|---|---|
| **E1** | 반려율 0% 승인 단계 | E | `hold`+`approval`, 6개월 반려 0건, 대기 ≥ 8h | 없음 (규정 한 줄) |
| **E2** | 같은 정보 2회 이상 옮겨 적기 | C | 도구 전환 + 산출물 라벨 일치 + 수동 동사 | 없음~소 |
| **E3** | 아무도 안 읽는 산출물 | E | 하류·타 문서에서 미참조 + `output-reader` 응답 없음 | 없음 |
| **E4** | 대기가 실접촉의 N배 | R | `waitH ≥ 8 × touchH` (구간 단위) | 없음~소 |
| **E5** | 중복 확인 단계 | E | 인접 2단계 이상이 모두 확인 동사, 담당자만 다름 | 없음 |
| **E6** | 단일 담당 병목 · 전결 미위임 | R | 같은 담당 3단계 연속 + `delegable` = 없음 | 없음 |
| **E7** | 묶을 수 있는 건별 처리 | C | `freqLast7d ≥ 10` + `≤5m` + 같은 도구 + `each` | 없음 |
| **E8** | 알림 대신 직접 확인(폴링) | S | `hold`+`resource` + `push-or-poll` = 직접 확인 | 소 |
| **E9** | 죽은 갈래 | E | 갈래가 있으나 발생률 ≈ 0 | 없음 |
| **E10** | 마감 직전 몰림 | R | `hold`+`time` + `deadline-crunch` = 예 | 없음 |
| **E11** | 재촉 단계 | E | 독촉 동사 + 반복 + 상류에 대기 존재 | 없음~소 |
| **E12** | 이중 증빙 요구 (조직) | E | `link_type='overlap'` 또는 같은 산출물 2개 문서 요구 | 없음 |

#### E1 — 반려율 0%인 승인 단계

```ts
// packages/analytics-core/src/ecrs/e1-empty-approval.ts

export const E1: EliminationPattern = {
  id: 'E1', action: 'eliminate', label: '반려된 적 없는 승인',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'hold' || n.waitFor !== 'approval') continue;

        // 신호 ① — "최근 6개월에 실제로 반려된 적 있나요?" 에 '없다'
        const rejAnswer = ctx.answer(doc.docId, n.itemId, 'rejection-6m');
        const neverRejected = rejAnswer?.choice === 'none';

        // 신호 ② — 반려 시 돌아갈 경로(back edge)가 아예 없다
        const hasReturnPath = (doc.graph.outgoing.get(n.id) ?? []).some((e) => e.isBackEdge)
          || typeof n.attrs.returnToItemId === 'string';

        // 신호 ③ — 사이클이 있어도 reworkRate가 0으로 응답됐다
        const cycleRate = doc.graph.metrics.cycles
          .filter((c) => c.nodes.includes(n.id))
          .reduce((m, c) => Math.max(m, c.reworkRate ?? 0), 0);

        const rate = neverRejected ? 0 : cycleRate;
        if (!(neverRejected || (!hasReturnPath && cycleRate === 0))) continue;
        if (rate > 0) continue;

        const m = doc.graph.metrics.perNode.get(n.id)!;
        const waitH = m.waitH * m.reachProbability;
        // ④ 대기가 짧으면 없앨 가치가 없다. 8시간(하루의 근무) 미만은 무시
        if (waitH < 8) continue;

        const f = ctx.features.get(n.itemId!);
        const eventsPerYear = f ? annualEvents(f.volume) : 0;

        hits.push({
          patternId: 'E1', docId: doc.docId, nodeIds: [n.id],
          evidence: {
            '평균 대기': `${fmtHours(waitH)}`,
            '6개월 반려 건수': 0,
            '월 발생': Math.round(eventsPerYear / 12),
            '돌아갈 경로': hasReturnPath ? '있음' : '없음',
          },
          execCopy: {
            headline: `반려된 적 없는 승인 단계가 흐름을 ${fmtDays(waitH / 24)} 붙잡고 있어요`,
            evidence: `최근 6개월 반려 0건 · 평균 대기 ${fmtHours(waitH)} · 월 ${Math.round(eventsPerYear / 12)}건`,
            proposal: '결재 기준선을 올리고, 사후 월간 리포트로 대체',
            effect: `건당 ${fmtDays(waitH / 24)} 단축 · 연 ${Math.round(eventsPerYear * waitH / 24 * 0.1)}일 회수`,
          },
          saving: {
            // 승인 단계 자체의 사람 시간(결재자 클릭)은 작다. 가치는 리드타임에 있다
            laborHPerYear: (f?.approverTouchH ?? 0.05) * eventsPerYear,
            leadDaysSaved: waitH / 24,
            krw: null,   // L5에서 DelayCostModel로 채운다
            devEffort: 'none',
          },
          precision: neverRejected ? 0.9 : 0.6,
        });
      }
    }
    return hits;
  },
};
```

> **오탐 방어** — "반려된 적 없다"에는 두 가지 뜻이 있다. (a) 불필요한 승인 (b) **승인이 있어서 사람들이 조심하는 것**. 우리는 이 둘을 구분할 수 없다. 그래서 제안 문구가 *"없애세요"*가 아니라 **"기준선을 올리고 사후 리포트로 대체"**다. [SEED X-1](./SEED-CONTENT.md)이 정확히 그 형태다 — 10만 원 → 50만 원 상향이지 승인 폐지가 아니다.

#### E2 — 같은 정보를 2회 이상 옮겨 적는 단계 쌍

```ts
// packages/analytics-core/src/ecrs/e2-retyping.ts

const TRANSFER_VERBS = ['입력', '기입', '적어', '옮겨', '옮기', '전기', '등록', '올리', '정리', '복사'];

export const E2: EliminationPattern = {
  id: 'E2', action: 'combine', label: '같은 내용을 두 번 적기',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const steps = doc.graph.nodes.filter((n) => n.kind === 'task' && !n.synthetic);

      for (let i = 0; i < steps.length; i++) {
        for (let j = i + 1; j < steps.length; j++) {
          const a = steps[i], b = steps[j];

          // ① 둘 다 옮겨 적는 동사
          if (!TRANSFER_VERBS.some((v) => a.title.includes(v))) continue;
          if (!TRANSFER_VERBS.some((v) => b.title.includes(v))) continue;

          // ② 도구가 다르다 (같은 도구면 두 번 적는 게 아니라 두 가지 일이다)
          const shared = a.toolIds.filter((t) => b.toolIds.includes(t));
          if (shared.length > 0) continue;
          if (a.toolIds.length === 0 || b.toolIds.length === 0) continue;

          // ③ 대상 명사가 같다 — 이게 "같은 정보"의 유일한 증거다.
          //    ASSEMBLY의 산출물 정규화를 그대로 재사용한다 (새 사전을 만들지 않는다)
          const na = ctx.artifactNouns(a.itemId!);
          const nb = ctx.artifactNouns(b.itemId!);
          const sim = maxPairwise(na, nb, (x, y) => ctx.simKo(x, y));
          if (sim < 0.7) continue;

          // ④ 같은 사람이 한다 (다른 사람이면 인계지 재입력이 아니다)
          if (a.effectiveAssigneeId && b.effectiveAssigneeId
              && a.effectiveAssigneeId !== b.effectiveAssigneeId) continue;

          const ma = doc.graph.metrics.perNode.get(a.id)!;
          const mb = doc.graph.metrics.perNode.get(b.id)!;
          // 절감은 **뒤쪽 단계 전부**다. 앞 단계는 원본 입력이라 남는다
          const savedH = mb.reachProbability * mb.expectedPasses * mb.touchH;
          const f = ctx.features.get(b.itemId!);
          const perYear = f ? annualEvents(f.volume) : 0;

          const toolA = ctx.catalog[a.toolIds[0]]?.name ?? '한 곳';
          const toolB = ctx.catalog[b.toolIds[0]]?.name ?? '다른 곳';

          hits.push({
            patternId: 'E2', docId: doc.docId, nodeIds: [a.id, b.id],
            evidence: { '앞 단계': a.title, '뒤 단계': b.title,
                        '도구': `${toolA} → ${toolB}`, '내용 유사도': sim.toFixed(2) },
            execCopy: {
              headline: `같은 내용을 ${toolA}와 ${toolB}에 각각 적고 있어요`,
              evidence: `"${a.title}" 뒤에 "${b.title}" — 연 ${Math.round(perYear)}회`,
              proposal: `${toolA} 저장 시 ${toolB}로 자동 전달 (또는 한쪽을 없애기)`,
              effect: `연 ${fmtHours(savedH * perYear)} 회수`,
            },
            saving: { laborHPerYear: savedH * perYear, leadDaysSaved: null, krw: null,
                      devEffort: ctx.bothConnectable(a, b) ? 'small' : 'project' },
            precision: sim >= 0.85 ? 0.85 : 0.65,
          });
        }
      }
    }
    return dedupeByNodes(hits);
  },
};
```

**조직 단위 확장**: 두 단계가 **다른 문서**에 있고 담당자도 다르면 이것은 재입력이 아니라 [ASSEMBLY의 `link_type='overlap'`](./ASSEMBLY.md) 또는 §7-⑫ 이중 기록이다. E2는 **문서 안**만 본다. 문서를 넘는 것은 E12가 담당한다. 두 검출기가 같은 쌍을 잡으면 E12가 이긴다(조직 단위가 더 큰 이야기다).

#### E3 — 아무도 읽지 않는 산출물

```ts
// packages/analytics-core/src/ecrs/e3-unread-output.ts

/** 산출물을 만드는 단계인가 */
const PRODUCE_VERBS = ['작성', '만들', '정리', '취합', '집계', '보고서', '대장', '리포트', '내역서', '현황'];

export const E3: EliminationPattern = {
  id: 'E3', action: 'eliminate', label: '아무도 안 보는 산출물',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'task' || n.synthetic) continue;
        if (!PRODUCE_VERBS.some((v) => n.title.includes(v))) continue;

        const nouns = ctx.artifactNouns(n.itemId!);
        if (nouns.length === 0) continue;

        // ① 같은 문서의 하류 단계가 이 산출물을 언급하는가
        const downstream = ctx.descendants(doc.graph, n.id);
        const usedDownstream = [...downstream].some((d) => {
          const t = doc.graph.byId.get(d);
          return t && nouns.some((w) => ctx.simKo(w, ctx.normTitle(t.title)) >= 0.75);
        });
        if (usedDownstream) continue;

        // ② 접합 소켓으로 밖에 나가는가 (ASSEMBLY)
        const goesOut = ctx.hasOutboundSocket(n.itemId!, nouns);
        if (goesOut) continue;

        // ③ 조직 코퍼스 어디에서도 이 산출물이 inbound로 등장하지 않는가
        //    ★ 이 조회는 정규화 라벨만 본다. 원문은 테넌트 밖으로 나가지 않는다 (D-046)
        const usedElsewhere = ctx.orgInboundLabels(doc.orgId).some(
          (l) => nouns.some((w) => ctx.simKo(w, l) >= 0.8));
        if (usedElsewhere) continue;

        // ④ "이 결과물, 나중에 누가 찾나요" 응답 — 있으면 그게 답이다
        const reader = ctx.answer(doc.docId, n.itemId, 'output-reader');
        if (reader?.text && reader.text.trim().length > 0 && reader.choice !== 'nobody') continue;

        const m = doc.graph.metrics.perNode.get(n.id)!;
        const savedH = m.reachProbability * m.expectedPasses * m.touchH;
        const f = ctx.features.get(n.itemId!);
        const perYear = f ? annualEvents(f.volume) : 0;

        hits.push({
          patternId: 'E3', docId: doc.docId, nodeIds: [n.id],
          evidence: { '산출물': nouns.join(', '),
                      '하류 참조': '없음', '조직 내 사용처': '없음',
                      '누가 찾나요 응답': reader?.text ?? '(답 없음)' },
          execCopy: {
            headline: `만들고 나서 아무 데서도 쓰이지 않는 자료가 있어요`,
            evidence: `"${nouns[0]}" — 이 흐름 뒤쪽에서도, 다른 부서 흐름에서도 나오지 않아요`,
            proposal: '정말 보는 사람이 없다면 만들기를 멈추거나, 분기 1회로 줄이기',
            effect: `연 ${fmtHours(savedH * perYear)} 회수`,
          },
          saving: { laborHPerYear: savedH * perYear, leadDaysSaved: null, krw: null,
                    devEffort: 'none' },
          // ★ 가장 오탐이 많은 검출기다. 커버리지가 낮으면 "안 읽는다"가 아니라 "아직 안 적혔다"
          precision: ctx.orgCoverage < 0.3 ? 0.35 : reader?.choice === 'nobody' ? 0.85 : 0.55,
        });
      }
    }
    return hits;
  },
};
```

> **이 검출기는 조직 커버리지 30% 미만이면 리포트에 내보내지 않는다.** 문서가 적을 때 "아무도 안 읽는다"는 거의 항상 "아직 아무도 안 적었다"이다. 대신 소유자 본인에게만 질문으로 되돌린다 — *"이거 만들고 나면 누가 보나요?"*

#### E4 — 대기가 실접촉의 N배를 넘는 구간

```ts
// packages/analytics-core/src/ecrs/e4-wait-dominant.ts

/** 임계 — 대기가 접촉의 8배. 시드 14건의 waitRatio 중앙값(60~96%)에서 역산 */
const WAIT_MULTIPLE = 8;
const MIN_WAIT_H = 8;

export const E4: EliminationPattern = {
  id: 'E4', action: 'rearrange', label: '기다리는 시간이 일하는 시간보다 훨씬 긴 구간',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      // 구간 = 연속한 hold 하나와 그 앞뒤 task. "구간"이지 단일 노드가 아니다
      for (const seg of ctx.waitSegments(doc.graph)) {
        if (seg.waitH < MIN_WAIT_H) continue;
        if (seg.touchH > 0 && seg.waitH < seg.touchH * WAIT_MULTIPLE) continue;

        const hold = doc.graph.byId.get(seg.holdId)!;
        const perYear = annualEvents(ctx.features.get(hold.itemId!)!.volume);

        // 대기 유형별로 제안이 완전히 다르다. 하나의 문구로 뭉치면 쓸모없어진다
        const proposal =
          hold.waitFor === 'approval' ? '결재 기준선 상향 또는 자동 승인 규칙'
        : hold.waitFor === 'reply'    ? '재촉을 사람이 아니라 알림이 하게 하기 + 기한 후 자동 처리'
        : hold.waitFor === 'resource' ? '오기를 기다리지 말고 도착 알림을 받기'
        : '마감에 맞춰 몰지 말고 발생 시점에 처리';

        hits.push({
          patternId: 'E4', docId: doc.docId, nodeIds: [seg.holdId],
          evidence: { '실제로 손대는 시간': fmtHours(seg.touchH),
                      '기다리는 시간': fmtHours(seg.waitH),
                      '배수': seg.touchH > 0 ? `${Math.round(seg.waitH / seg.touchH)}배` : '접촉시간 0' },
          execCopy: {
            headline: `${fmtHours(seg.touchH)}짜리 일이 ${fmtDays(seg.waitH / 24)}를 붙잡고 있어요`,
            evidence: `${hold.title} — 기다림이 실제 작업의 ${Math.round(seg.waitH / Math.max(seg.touchH, 0.01))}배`,
            proposal,
            effect: `건당 최대 ${fmtDays(seg.waitH / 24)} 단축 가능 · 연 ${Math.round(perYear)}건`,
          },
          saving: { laborHPerYear: null, leadDaysSaved: seg.waitH / 24, krw: null,
                    devEffort: hold.waitFor === 'approval' ? 'none' : 'small' },
          precision: 0.8,
        });
      }
    }
    return hits;
  },
};
```

**중요** — E4의 절감은 **사람 시간이 아니라 리드타임**이다. `laborHPerYear = null`이 그 선언이다. 이걸 인시로 세면 조직 전체 절감 시간이 3~5배 부풀고, 그 숫자로 인력 계획을 세우면 사고가 난다(§11.4).

#### E5 — 중복 확인 단계

```ts
// packages/analytics-core/src/ecrs/e5-double-check.ts

const CHECK_VERBS = ['확인', '검토', '점검', '체크', '대조', '검수', '크로스체크', '재확인', '이중'];

export const E5: EliminationPattern = {
  id: 'E5', action: 'eliminate', label: '두 번 확인하는 단계',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      // 인접(1~2홉) 확인 단계 쌍을 찾는다
      for (const [a, b] of ctx.nearbyPairs(doc.graph, 2)) {
        if (!CHECK_VERBS.some((v) => a.title.includes(v))) continue;
        if (!CHECK_VERBS.some((v) => b.title.includes(v))) continue;

        // 확인 대상이 같아야 한다
        const sim = ctx.simKo(ctx.normTitle(a.title), ctx.normTitle(b.title));
        const objSim = maxPairwise(ctx.artifactNouns(a.itemId!), ctx.artifactNouns(b.itemId!),
                                   (x, y) => ctx.simKo(x, y));
        if (Math.max(sim, objSim) < 0.6) continue;

        // 담당자가 다르면 "이중 확인"(의도된 통제)일 수 있다 → 정밀도만 낮춘다. 버리지는 않는다
        const differentPeople = a.effectiveAssigneeId !== b.effectiveAssigneeId;

        const mb = doc.graph.metrics.perNode.get(b.id)!;
        const savedH = mb.reachProbability * mb.expectedPasses * mb.touchH;
        const perYear = annualEvents(ctx.features.get(b.itemId!)!.volume);

        // "이 단계, 없애면 무슨 일이 생기나요?" 응답이 있으면 그게 판정의 근거다
        const impact = ctx.answer(doc.docId, b.itemId, 'removal-impact');

        hits.push({
          patternId: 'E5', docId: doc.docId, nodeIds: [a.id, b.id],
          evidence: { '앞': a.title, '뒤': b.title,
                      '담당': differentPeople ? '서로 다름' : '같은 사람',
                      '없애면?': impact?.text ?? '(답 없음)' },
          execCopy: {
            headline: differentPeople
              ? '같은 것을 두 사람이 각각 확인하고 있어요'
              : '같은 것을 한 사람이 두 번 확인하고 있어요',
            evidence: `"${a.title}" 다음에 "${b.title}"`,
            proposal: differentPeople
              ? '확인 책임을 한쪽으로 모으고, 다른 쪽은 표본 점검으로'
              : '뒤쪽 확인을 없애고 앞 단계의 체크 항목을 늘리기',
            effect: `연 ${fmtHours(savedH * perYear)} 회수`,
          },
          saving: { laborHPerYear: savedH * perYear, leadDaysSaved: null, krw: null,
                    devEffort: 'none' },
          precision: differentPeople ? 0.5 : 0.75,
        });
      }
    }
    return hits;
  },
};
```

#### E6 ~ E12 — 나머지 검출기

```ts
// packages/analytics-core/src/ecrs/rest.ts

/** E6 단일 담당 병목 — 위임(Rearrange) */
export const E6: EliminationPattern = {
  id: 'E6', action: 'rearrange', label: '한 사람에게 몰린 구간',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const run of ctx.assigneeRuns(doc.graph, 3)) {     // 같은 담당 3단계 이상 연속
        const del = ctx.answer(doc.docId, run.itemIds[0], 'delegable');
        if (del?.choice !== 'nobody') continue;               // 대체자가 있으면 병목이 아니다
        const leadH = run.leadH;
        hits.push({
          patternId: 'E6', docId: doc.docId, nodeIds: run.nodeIds,
          evidence: { '연속 단계 수': run.nodeIds.length, '구간 리드타임': fmtHours(leadH),
                      '대체 가능': '없다고 답함' },
          execCopy: {
            headline: `${run.nodeIds.length}단계가 한 사람만 할 수 있는 상태예요`,
            evidence: `이 구간이 멈추면 흐름 전체가 ${fmtDays(leadH / 24)} 멈춰요`,
            proposal: '전결 위임 또는 대체자 1명 지정 + 인수인계 문서 생성',
            effect: '휴가·퇴사 시 정지 위험 제거 (금액 미산정)',
          },
          saving: { laborHPerYear: null, leadDaysSaved: null, krw: null, devEffort: 'none' },
          precision: 0.7,
        });
      }
    }
    return hits;
  },
};

/** E7 묶을 수 있는 건별 처리 — Combine */
export const E7: EliminationPattern = {
  id: 'E7', action: 'combine', label: '건건이 하는 짧은 반복',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'task' || n.synthetic) continue;
        const f = ctx.features.get(n.itemId!); if (!f) continue;
        if ((f.freqLast7d ?? 0) < 10) continue;
        if (n.durationBand !== '1m' && n.durationBand !== '5m') continue;
        if (ctx.answer(doc.docId, n.itemId, 'batch-or-each')?.choice !== 'each') continue;

        const per = annualEvents(f.volume);
        const m = doc.graph.metrics.perNode.get(n.id)!;
        // 묶으면 건당 고정비(도구 열기·로그인·문맥 전환)가 사라진다. 보수적으로 40%
        const savedH = m.touchH * 0.4 * per;
        hits.push({
          patternId: 'E7', docId: doc.docId, nodeIds: [n.id],
          evidence: { '주당 횟수': f.freqLast7d!, '1회 소요': n.durationBand!, '처리 방식': '건건이' },
          execCopy: {
            headline: `짧은 일을 하루에 ${Math.round(f.freqLast7d! / 5)}번씩 끊어서 하고 있어요`,
            evidence: `1회 ${n.durationBand} · 주 ${f.freqLast7d}회 · 건건이 처리`,
            proposal: '하루 1~2회로 묶어서 처리 (또는 도착 알림만 받고 정해진 시각에)',
            effect: `연 ${fmtHours(savedH)} 회수 — 문맥 전환 비용 제거분`,
          },
          saving: { laborHPerYear: savedH, leadDaysSaved: null, krw: null, devEffort: 'none' },
          precision: 0.6,
        });
      }
    }
    return hits;
  },
};

/** E8 알림 대신 직접 확인 — Simplify */
export const E8: EliminationPattern = {
  id: 'E8', action: 'simplify', label: '직접 들여다보는 대기',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'hold') continue;
        if (n.waitFor !== 'resource' && n.waitFor !== 'reply') continue;
        if (ctx.answer(doc.docId, n.itemId, 'push-or-poll')?.choice !== 'poll') continue;

        const m = doc.graph.metrics.perNode.get(n.id)!;
        const per = annualEvents(ctx.features.get(n.itemId!)!.volume);
        // 확인 행위 자체의 시간 — 대기 중 평균 3회 확인, 1회 2분으로 고정 가정
        const pollH = 3 * (2 / 60);
        const tools = n.toolIds.map((t) => ctx.catalog[t]).filter(Boolean) as ToolEntry[];
        const connectable = tools.length > 0 && tools.every((t) => t.grade === 'high');

        hits.push({
          patternId: 'E8', docId: doc.docId, nodeIds: [n.id],
          evidence: { '대기 유형': n.waitFor!, '확인 방식': '직접 들어가서 봄',
                      '평균 대기': fmtHours(m.waitH) },
          execCopy: {
            headline: '오는지 안 오는지를 사람이 계속 들여다보고 있어요',
            evidence: `${n.title} — 평균 ${fmtHours(m.waitH)} 대기하며 수시 확인`,
            proposal: connectable ? '도착하면 알림이 오게 연결하기' : '확인 시각을 하루 2회로 고정하기',
            effect: `연 ${fmtHours(pollH * per)} 회수 + 놓침 방지`,
          },
          saving: { laborHPerYear: pollH * per, leadDaysSaved: null, krw: null,
                    devEffort: connectable ? 'small' : 'none' },
          precision: 0.75,
        });
      }
    }
    return hits;
  },
};

/** E9 죽은 갈래 */
export const E9: EliminationPattern = {
  id: 'E9', action: 'eliminate', label: '거의 안 일어나는 갈래',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const b of doc.graph.nodes.filter((n) => n.kind === 'branch' && n.branchMode !== 'and')) {
        const outs = (doc.graph.outgoing.get(b.id) ?? []).filter((e) => e.reason === 'branch-case');
        if (outs.length < 2) continue;
        for (const e of outs) {
          // "어느 갈래가 제일 흔한가요? 10번 중 몇 번?" 응답에서 0~1로 답한 갈래
          const share = ctx.caseShare(doc.docId, e.caseItemId!);
          if (share === null || share > 0.05) continue;
          const sub = ctx.subtreeNodes(doc.graph, e.target);
          const savedH = [...sub].reduce((s, id) => {
            const m = doc.graph.metrics.perNode.get(id)!; return s + m.touchH; }, 0);
          hits.push({
            patternId: 'E9', docId: doc.docId, nodeIds: [...sub],
            evidence: { '갈래': e.label ?? '', '발생률': `10번 중 ${Math.round(share * 10)}번 미만`,
                        '이 갈래의 단계 수': sub.size },
            execCopy: {
              headline: `거의 일어나지 않는 경우를 위해 ${sub.size}단계를 유지하고 있어요`,
              evidence: `"${e.label}" — 발생률 5% 미만`,
              proposal: '이 갈래를 정규 흐름에서 빼고 예외 처리로 옮기기',
              effect: '흐름 이해 비용 감소 · 자동화 난이도 하락 (금액 미산정)',
            },
            saving: { laborHPerYear: null, leadDaysSaved: null, krw: null, devEffort: 'none' },
            precision: 0.55,
          });
        }
      }
    }
    return hits;
  },
};

/** E10 마감 직전 몰림 — Rearrange. 총량은 그대로인데 한 주에 몰려서 잔업이 된다 */
export const E10: EliminationPattern = {
  id: 'E10', action: 'rearrange', label: '마감 직전에 몰리는 일',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'hold' || n.waitFor !== 'time') continue;
        if (ctx.answer(doc.docId, n.itemId, 'deadline-crunch')?.choice !== 'yes') continue;

        // 마감 뒤에 붙은 작업 단계들의 접촉시간 합 = 그 며칠에 몰리는 양
        const after = ctx.descendantsUntilNextHold(doc.graph, n.id);
        const crunchH = [...after].reduce((s, id) => {
          const m = doc.graph.metrics.perNode.get(id)!;
          return s + m.reachProbability * m.expectedPasses * m.touchH;
        }, 0);
        if (crunchH < 2) continue;                 // 2시간 미만이면 몰려도 문제가 아니다

        const per = annualEvents(ctx.features.get(n.itemId!)!.volume);
        // 평준화의 절감은 시간이 아니라 **잔업과 실수**다. 시간 절감으로 세지 않는다
        hits.push({
          patternId: 'E10', docId: doc.docId, nodeIds: [n.id, ...after],
          evidence: { '마감': n.title, '마감 뒤 작업량': fmtHours(crunchH),
                      '연 발생': Math.round(per), '몰림 여부': '그렇다고 답함' },
          execCopy: {
            headline: `${fmtHours(crunchH)}짜리 일이 마감 직전 며칠에 몰려 있어요`,
            evidence: `"${n.title}" 이후 ${after.size}단계가 같은 기간에 처리돼요`,
            proposal: '발생 시점에 바로 처리하도록 옮기고, 마감일에는 확인만 남기기',
            effect: '잔업과 마감일 실수 감소 (시간 절감으로는 세지 않음)',
          },
          saving: { laborHPerYear: null, leadDaysSaved: null, krw: null, devEffort: 'none' },
          precision: 0.7,
        });
      }
    }
    return hits;
  },
};

/** E11 재촉 단계 — 대기의 증상이지 원인이 아니다 */
export const E11: EliminationPattern = {
  id: 'E11', action: 'eliminate', label: '재촉하는 단계',
  detect(ctx) {
    const URGE = ['독촉', '재촉', '리마인드', '다시 요청', '재요청', '확인 요청', '언제 되', '푸시'];
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.graph.nodes) {
        if (n.kind !== 'task' || !URGE.some((w) => n.title.includes(w))) continue;
        // 상류에 응답/승인 대기가 있어야 "재촉"이다. 없으면 다른 일이다
        const upstreamHold = [...ctx.ancestors(doc.graph, n.id)]
          .map((id) => doc.graph.byId.get(id)!)
          .find((v) => v.kind === 'hold' && (v.waitFor === 'reply' || v.waitFor === 'approval'));
        if (!upstreamHold) continue;

        const m = doc.graph.metrics.perNode.get(n.id)!;
        const per = annualEvents(ctx.features.get(n.itemId!)!.volume);
        hits.push({
          patternId: 'E11', docId: doc.docId, nodeIds: [n.id],
          evidence: { '재촉 단계': n.title, '원인 대기': upstreamHold.title,
                      '대기 시간': fmtHours(doc.graph.metrics.perNode.get(upstreamHold.id)!.waitH) },
          execCopy: {
            headline: '기다리다 못해 다시 연락하는 단계가 흐름 안에 들어와 있어요',
            evidence: `"${upstreamHold.title}" 때문에 "${n.title}"가 생겼어요`,
            proposal: '재촉을 사람이 아니라 자동 알림이 하게 하고, 기한 경과 시 기본값으로 진행',
            effect: `연 ${fmtHours(m.touchH * per)} 회수 + 감정 소모 제거`,
          },
          saving: { laborHPerYear: m.touchH * per, leadDaysSaved: null, krw: null, devEffort: 'small' },
          precision: 0.8,
        });
      }
    }
    return hits;
  },
};

/** E12 이중 증빙 요구 — 조직 단위. ASSEMBLY의 확정 링크 위에서만 돈다 */
export const E12: EliminationPattern = {
  id: 'E12', action: 'eliminate', label: '같은 증빙을 두 곳에서 각각 요구',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    // 전제: status IN ('confirmed','auto') 인 링크만. single은 리포트에 안 올라간다 (D-043)
    for (const link of ctx.confirmedLinks) {
      const dup = link.linkType === 'overlap'
        || ctx.sameArtifactRequestedTwice(link);
      if (!dup) continue;
      const [deptA, deptB] = ctx.deptPair(link);
      hits.push({
        patternId: 'E12', docId: link.outboundDocId, nodeIds: link.nodeIds,
        evidence: { '산출물': link.objectName, '요구하는 곳': `${deptA} / ${deptB}` },
        execCopy: {
          // ★ POLICY §5.2 — 주어를 부서로 두지 않는다. "요구한다"가 아니라 "각각 적혀 있다"
          headline: `같은 증빙이 두 흐름에서 각각 요구되는 것으로 적혀 있어요`,
          evidence: `${deptA} ↔ ${deptB} 접합 · 산출물 "${link.objectName}"`,
          proposal: '어느 한쪽에서 받은 것을 참조하도록 기준을 맞추기',
          effect: '제출 1회 감소 · 왕복 1회 제거 (금액 미산정)',
        },
        saving: { laborHPerYear: null, leadDaysSaved: null, krw: null, devEffort: 'none' },
        precision: link.linkType === 'overlap' ? 0.8 : 0.6,
      });
    }
    return hits;
  },
};
```

### 5.2 오탐 관리 — 정밀도가 낮은 검출기를 어떻게 다루는가

| precision | 처리 |
|---|---|
| ≥ 0.8 | 경영진 리포트에 바로 올린다 |
| 0.5 ~ 0.8 | 올리되 **`확인이 필요해요` 배지**를 달고, 소유자에게 먼저 1문항 확인을 보낸다 |
| < 0.5 | 경영진에게 안 간다. **소유자 화면의 질문**으로만 되돌아간다 |

**소유자 확인이 곧 정밀도 상승 경로다.** *"이 승인, 반려된 적 정말 없나요?"*에 답하면 precision이 0.6 → 0.9가 되고 그때 리포트에 올라간다. 이 순서를 뒤집으면(먼저 올리고 나중에 확인) 첫 리포트에 오탐이 실려서 두 번째 리포트를 아무도 안 본다.

### 5.3 관리자 노출 — 단계 유형 단위로 롤업

```ts
/**
 * POLICY §8.1 위젯 5는 단위가 "단계 유형"이다. 개별 단계를 그대로 올리면
 * 문서 1개 = 사람 1명인 조직에서 개인 식별이 된다.
 */
export type EliminationRollup = {
  patternId: string;
  label: string;
  /** 이 패턴에 해당하는 단계 수 (5단위 반올림) */
  stepCountRounded: number;
  /** 기여자 수 — 5 미만이면 이 행 자체가 나가지 않는다 */
  contributorCount: number;
  deptPairs: readonly string[];   // 부서 단위까지만
  medianSavingH: number | null;
  execCopy: ExecCopy;             // 대표 사례 1건의 문구 (문서 제목·개인 없음)
};

export function rollupForAdmin(hits: readonly EliminationHit[], ctx: EcrsContext): EliminationRollup[] {
  const byPattern = groupBy(hits, (h) => h.patternId);
  return [...byPattern.entries()].flatMap(([pid, hs]) => {
    const contributors = new Set(hs.map((h) => ctx.ownerOf(h.docId)));
    if (contributors.size < 5) return [];              // ★ D-002. 예외 없음
    return [{
      patternId: pid,
      label: PATTERNS[pid].label,
      stepCountRounded: Math.round(hs.length / 5) * 5,
      contributorCount: contributors.size,
      deptPairs: [...new Set(hs.map((h) => ctx.deptOf(h.docId)))],
      medianSavingH: median(hs.map((h) => h.saving.laborHPerYear).filter((v): v is number => v != null)),
      execCopy: hs.sort((a, b) => b.precision - a.precision)[0].execCopy,
    }];
  });
}
```

**5인 미만이면 어떻게 되는가** — 그 후보는 **소유자 본인과 그 부서장에게도 가지 않는다.** 대신 **소유자 본인의 개인 화면에만** 나타난다("당신이 안 해도 되는 일"). 개인에게 자기 데이터를 보여주는 것은 k-익명성의 대상이 아니다. 이 경로가 있기 때문에 5인 차단이 제품 가치를 죽이지 않는다.

---

## 6. 조직 집계 — 같은 일을 여러 사람이 할 때

### 6.0 먼저 구분해야 하는 두 관계 (D-092)

[ASSEMBLY.md](./ASSEMBLY.md)가 만드는 것은 **체인**이다 — 서로 **다른** 일을 이어 붙인다(총무가 상신 → 재무가 지급). 여기서 만드는 것은 **그룹**이다 — **같은** 일을 여러 사람이 각자 적은 것을 겹쳐 놓는다.

| | 접합 (ASSEMBLY) | 그룹 (이 문서) |
|---|---|---|
| 관계 | 직렬 (A 다음 B) | 병렬 (A와 B가 같은 일) |
| 테이블 | `handoff_links` | `process_groups` |
| 조인 키 | 산출물 + 상대 FK | 제목 + 단계 시퀀스 + 시드 출처 |
| 쓰이는 곳 | 리드타임, 불일치 리포트 | `N_people`, 표준화, 변동성 |
| 이미 있는 경계 사례 | `link_type = 'overlap'` (같은 작업을 두 문서가 기록) | — |

**`link_type='overlap'`은 둘의 교집합이다.** 접합 파이프라인이 overlap으로 판정한 쌍은 그룹핑의 **강한 양성 신호**로 들어온다. 반대로 그룹으로 묶인 두 문서 사이에 `handoff` 링크가 잡히면 그것은 오탐이다(같은 일이 자기 자신에게 인계될 수 없다) — 그룹핑이 그 링크를 억제 후보로 되돌린다.

### 6.1 `process_key` 배정 — 지금까지 어디에도 정의되지 않은 것

`process_key`는 [MEASUREMENT §3](./MEASUREMENT.md)의 `agg_process` 뷰와 [TRUST.md](./TRUST.md)의 `process_aggregate` 뷰가 **소비하고 있지만 아무 문서도 정의하지 않은** 키다. 여기서 정의한다.

```ts
// packages/analytics-core/src/group/key.ts

/**
 * process_key = 조직 안에서 "같은 일"을 가리키는 안정적 식별자.
 *
 * 세 가지 원천이 있고, 우선순위가 있다. 위쪽이 이기면 아래는 보지 않는다.
 *   S1 시드 템플릿 출처   documents.seedTemplateId       ← 결정적. 가장 강하다
 *   S2 온보딩 칩          documents.chipKey              ← 결정적. 조직 공용 어휘
 *   S3 유사도 클러스터    normTitle + 단계 시퀀스        ← 확률적. 사람이 확정해야 한다
 */
export type ProcessKeySource = 'seed' | 'chip' | 'cluster' | 'manual';

export type ProcessKey = string;   // `seed:FIN-02` | `chip:tax-invoice` | `clu:{uuid}`

export function deterministicKey(doc: DocMeta): { key: ProcessKey; source: ProcessKeySource } | null {
  // S1 — 시드 템플릿에서 fork된 문서. SEED-CONTENT §E-3의 "fork 후 자기 문서로 편집"
  if (doc.seedTemplateId) return { key: `seed:${doc.seedTemplateId}`, source: 'seed' };
  // S2 — 온보딩 칩 42개는 이미 조직 공용 어휘다 (ASSEMBLY §8.3)
  if (doc.chipKey) return { key: `chip:${doc.chipKey}`, source: 'chip' };
  return null;
}
```

**S1/S2가 결정적인 이유** — 시드에서 fork한 문서 3개는 "제목이 비슷해서 같은 일 같다"가 아니라 **같은 원본에서 나왔다**는 사실이다. [ASSEMBLY D-042](./ASSEMBLY.md)가 링크 자동 확정을 규칙 하나로만 허용한 것과 같은 논리다(D-093).

**S3 클러스터링** — 나머지 문서는 유사도로 묶되, **자동 확정 임계를 매우 높게** 걸고 회색대는 사람에게 넘긴다.

```ts
// packages/analytics-core/src/group/cluster.ts
import { simKo, normTitle } from '@workflow/graph-core/matching';   // ASSEMBLY §3.3 재사용

export type DocSignature = {
  docId: string;
  ownerId: string;
  deptId: string | null;
  titleNorm: string;
  /** 단계 시퀀스 지문 — (동사 클래스, 도구 등급) 쌍의 순서 있는 배열 */
  seq: readonly string[];
  toolIds: ReadonlySet<string>;
  /** 첫/마지막 접합 소켓의 정규화 산출물 라벨 */
  boundaryObjects: ReadonlySet<string>;
  forkOfDocId: string | null;
};

/**
 * 문서 쌍 유사도. 접합 매칭(ASSEMBLY §3.6)과 **가중치가 다르다** —
 * 거기서는 상대방(party)이 최강 신호지만, 여기서는 상대방이 같으면 오히려 접합이지 그룹이 아니다.
 */
const GW = { title: 0.35, seq: 0.30, tool: 0.20, object: 0.15 } as const;

export function docSimilarity(a: DocSignature, b: DocSignature, idf: IdfFn): number {
  if (a.docId === b.docId) return 0;
  if (a.ownerId === b.ownerId) return 0;          // 같은 사람의 두 문서는 그룹이 아니다 (§6.1.1)

  const title  = simKo(a.titleNorm, b.titleNorm, idf);
  const seq    = normalizedLcs(a.seq, b.seq);      // 순서를 보존하는 유사도
  const tool   = jaccard(a.toolIds, b.toolIds);
  const object = jaccard(a.boundaryObjects, b.boundaryObjects);

  let s = GW.title * title + GW.seq * seq + GW.tool * tool + GW.object * object;

  // 게이트 — 제목이 완전히 다르면 나머지가 아무리 비슷해도 같은 일이 아니다.
  // "월 마감"과 "급여 이체"는 도구와 단계 수가 매우 비슷하다
  if (title < 0.35) s *= 0.4;

  // 부서가 다르면 같은 일일 확률이 떨어진다 (단, 총무/재무처럼 겹치는 업무는 있다)
  if (a.deptId && b.deptId && a.deptId !== b.deptId) s *= 0.85;

  return s;
}

export const AUTO_GROUP_THRESHOLD = 0.78;   // 이 위는 자동 편입
export const REVIEW_THRESHOLD     = 0.55;   // 이 사이는 사람 확인 대기
```

**클러스터링 알고리즘** — 계층적이지 않다. 단순 연결 성분은 체이닝(A~B, B~C, A≠C)으로 무관한 문서를 한 덩이로 만든다. **medoid 기반 리더 클러스터링**을 쓴다.

```ts
export function groupProcesses(sigs: readonly DocSignature[], idf: IdfFn): ProcessGroupDraft[] {
  const groups: ProcessGroupDraft[] = [];

  // 1. 결정적 키부터. 이건 유사도를 아예 보지 않는다
  for (const [key, members] of groupBy(sigs.filter(hasDetKey), detKeyOf)) {
    groups.push({ key, source: detKeyOf(members[0]).source, members, medoid: pickMedoid(members) });
  }

  // 2. 나머지를 리더 클러스터링. 순서 의존성을 없애기 위해 docId 사전순으로 순회한다
  //    (결정성 — 같은 입력이면 같은 그룹이 나와야 골든 픽스처가 성립한다)
  const rest = sigs.filter((s) => !hasDetKey(s)).slice()
    .sort((a, b) => (a.docId < b.docId ? -1 : 1));

  const leaders: ProcessGroupDraft[] = [];
  for (const s of rest) {
    let best: { g: ProcessGroupDraft; sim: number } | null = null;
    for (const g of leaders) {
      const sim = docSimilarity(s, g.medoid, idf);
      if (!best || sim > best.sim) best = { g, sim };
    }
    if (best && best.sim >= AUTO_GROUP_THRESHOLD) {
      best.g.members.push(s);
      best.g.medoid = pickMedoid(best.g.members);       // medoid 갱신
    } else if (best && best.sim >= REVIEW_THRESHOLD) {
      best.g.pending.push({ sig: s, sim: best.sim });   // ★ 사람 확인 대기
      leaders.push(newGroup(s));                        // 동시에 자기 그룹도 만든다
    } else {
      leaders.push(newGroup(s));
    }
  }
  return [...groups, ...leaders];
}
```

**회색대 확인 UX** — 관리자에게 묻지 않는다. **문서 소유자에게** 묻는다.

> *김○○ 님도 「세금계산서 끊기」를 적으셨어요. 두 분이 같은 일을 하시는 게 맞나요?*
> `[네, 같은 일이에요]` `[비슷하지만 달라요]` `[전혀 다른 일이에요]`

`[비슷하지만 달라요]`는 **버리는 답이 아니다** — 그룹은 분리하되 두 문서를 "변형(variant)" 관계로 기록하고, 변동성 리포트(§6.3)의 입력이 된다. 조직에서 가장 흥미로운 사실이 여기 있다.

#### 6.1.1 같은 사람의 두 문서는 그룹이 아니다

`a.ownerId === b.ownerId`에서 0을 반환하는 한 줄이 `N_people`의 정확성을 지킨다. 한 사람이 「세금계산서 끊기」와 「수정 세금계산서」를 따로 적었을 때 이것을 묶으면 기여자 1명이 2명으로 세어진다. 이 관계는 [ASSEMBLY §10.2-3 「내 흐름 잇기」](./ASSEMBLY.md)의 소관이지 그룹의 소관이 아니다.

### 6.2 묶은 뒤 — 중앙값인가 합계인가

**둘 다 쓴다. 지표마다 다르다.** 하나로 통일하려는 시도가 이 부분에서 가장 흔한 실패다.

| 지표 | 집계 | 왜 |
|---|---|---|
| `T_touch` (1회 실접촉시간) | **중앙값** | 자기보고는 롱테일이다. 한 명의 "1일+"이 평균을 두 배로 만든다 |
| `waitH`, `leadTimeH` | **중앙값** | 같은 이유. ASSEMBLY도 `percentile_cont(0.5)`를 쓴다 |
| `F` (건수) | **합계** | 조직 전체 건수는 실제로 더해진다 |
| `N_people` | **distinct count** | 합계도 중앙값도 아니다 |
| 도구 | **합집합 + 등장 빈도** | 한 명만 쓰는 도구도 자동화 설계에 필요하다 |
| 단계 시퀀스 | **medoid 문서** | "평균 흐름"은 존재하지 않는 흐름이다. 실재하는 문서 하나를 대표로 쓴다 |
| Feasibility 6요소 | **가중 중앙값** (기여자의 coverage로 가중) | 데이터가 부실한 문서가 순위를 흔들지 않게 |
| 짜증 플래그 | **비율만** (`n명 중 m명이 이 단계에 표시`) | 개인 귀속 금지 (POLICY §4.3) |

```ts
// packages/analytics-core/src/group/aggregate.ts

export type StepAggregate = {
  groupId: string;
  /** medoid 문서의 노드를 기준점으로 삼고, 다른 문서의 대응 단계를 정렬해 붙인다 */
  anchorNodeId: NodeId;
  label: string;

  touchH: { median: number; p25: number; p75: number; n: number };
  waitH:  { median: number; p25: number; p75: number; n: number };
  /** ★ 합계. 그룹 전체의 월 발생 건수 */
  eventsPerMonth: number;
  contributorCount: number;

  toolUsage: readonly { toolId: string; userCount: number }[];
  /** 이 단계를 적은 사람 / 그룹 전체 기여자 */
  presenceRatio: number;
  painRatio: number;

  variability: VariabilityIndex;
};

/**
 * 그룹의 Volume은 org-total로 승격된다. ★ 여기가 유일한 승격 지점이다 (D-084)
 */
export function groupVolume(members: readonly StepFeature[]): Volume {
  return {
    kind: 'org-total',
    fOrgMonth: members.reduce((s, m) => s + monthlyEvents(m.volume), 0),
  };
}
```

**단계 정렬(alignment)** — 서로 다른 사람이 쓴 문서의 단계를 어떻게 대응시키는가. 필요한 것은 완벽한 정렬이 아니라 **비교 가능한 정렬**이다.

```ts
/**
 * medoid의 단계 시퀀스를 기준으로 나머지 문서를 Needleman-Wunsch 정렬한다.
 * 치환 비용 = 1 - simKo(제목) 을 쓰고, 갭 비용은 0.6 고정.
 * 갭(한쪽에만 있는 단계)이 §6.3 변동성의 첫 번째 축이다.
 */
export function alignSteps(medoid: DocSignature, other: DocSignature): Alignment
```

### 6.3 변동성 지표 — 이게 산출물이다

**분산이 큰 단계는 나쁜 데이터가 아니라 발견이다.** 다만 두 가지 원인이 있고, 이 둘을 구분하지 못하면 리포트가 쓸모없어진다.

- **진짜 변동** — 같은 일을 사람마다 다르게 한다 (표준화 기회)
- **문서 부실** — 같은 일인데 어떤 사람은 대충 적었다 (데이터 문제)

```ts
// packages/analytics-core/src/group/variability.ts

export type VariabilityIndex = {
  /** 0..1. 클수록 사람마다 다르다 */
  score: number;
  /** 네 축의 기여분 — 무엇이 다른지를 그대로 보여준다 */
  axes: {
    presence: number;   // 이 단계가 어떤 문서엔 있고 어떤 문서엔 없다
    tool: number;       // 같은 단계를 다른 도구로 한다
    duration: number;   // 같은 단계에 걸리는 시간이 2밴드 이상 벌어진다
    position: number;   // 흐름 안의 위치가 다르다
  };
  /** ★ 이 변동을 어떻게 읽어야 하는가 */
  interpretation: 'real-variance' | 'thin-documentation' | 'ambiguous';
  copy: string;
};

export function variability(a: StepObservations, groupCoverage: number): VariabilityIndex {
  const n = a.contributorCount;

  // ① 존재 불일치 — 이 단계를 적은 사람 비율의 반대
  const presence = 1 - a.presenceRatio;

  // ② 도구 불일치 — 도구 집합의 평균 쌍별 Jaccard 거리
  const tool = 1 - meanPairwiseJaccard(a.toolSetsByContributor);

  // ③ 시간 불일치 — 2밴드 이상 벌어진 쌍의 비율.
  //    ★ 1밴드 차이는 불일치가 아니다. ASSEMBLY §7.1의 표현차 필터와 같은 기준.
  //    이 필터가 없으면 리포트의 대부분이 잡음이 된다
  const duration = ratioOfPairs(a.bandsByContributor, (x, y) => bandDistance(x, y) >= 2);

  // ④ 위치 불일치 — 정렬 후 상대 순서의 표준편차(0..1 정규화)
  const position = normalizedPositionSd(a.alignedIndices);

  const score = clamp01(0.30 * presence + 0.30 * tool + 0.25 * duration + 0.15 * position);

  // ── 해석 ──────────────────────────────────────────────────────────────
  // 존재 불일치가 크면서 나머지도 크다 = 어떤 사람이 대충 적은 것에 가깝다.
  // 존재는 일치하는데(다들 적었는데) 도구·시간이 다르다 = 진짜로 다르게 하는 것이다.
  const interpretation: VariabilityIndex['interpretation'] =
    presence >= 0.4 && groupCoverage < 0.5 ? 'thin-documentation'
    : presence <= 0.2 && (tool >= 0.4 || duration >= 0.4) ? 'real-variance'
    : 'ambiguous';

  const copy =
    interpretation === 'real-variance'
      ? `${n}명이 이 단계를 서로 다른 방식으로 하고 있어요` +
        (tool >= duration ? ' (쓰는 도구가 달라요)' : ' (걸리는 시간이 크게 달라요)')
    : interpretation === 'thin-documentation'
      ? `${n}명 중 일부만 이 단계를 적었어요 — 아직 비교하기 이른 것 같아요`
      : `${n}명이 적은 내용에 차이가 있어요`;

  return { score, axes: { presence, tool, duration, position }, interpretation, copy };
}
```

**두 곳에서 쓰인다.**

1. **Feasibility의 표준화 항** — `standardization ≈ 1 − score` (단, `thin-documentation`이면 coverage를 0.3으로 눌러 스코어에 미치는 영향을 줄인다)
2. **경영진 리포트의 독립 항목** — `real-variance` 판정만 올린다. `thin-documentation`은 경영진에게 가지 않고 **작성 독려 대상**이 되는데, [D-078(관리자 작성 독촉 금지)](./DECISIONS.md) 때문에 알림으로도 나가지 않는다. 커버리지 위젯에 숫자로만 반영된다.

### 6.4 k-익명성 — 5인 미만 처리 (D-002, 뒤집는 조건 없음)

집계는 **뷰에서 차단된다.** 애플리케이션 코드가 아니다.

```sql
-- db/views/agg_process.sql — MEASUREMENT §3의 agg_process에 이 문서의 컬럼을 얹는다.
-- ★ 새 뷰를 만들지 않는다. 같은 뷰에 컬럼을 추가한다.
--   방어를 두 곳에 나눠 두면 한 곳이 언젠가 뒤처진다.

CREATE OR REPLACE VIEW agg_process WITH (security_barrier) AS
WITH base AS (
  SELECT
    p.org_id, p.process_key, d.dept_id, r.key AS period_key,
    count(DISTINCT d.owner_id)                                          AS contributor_n,
    count(*)                                                            AS process_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY p.lead_time_h)          AS lead_time_med,
    -- ▼ 이 문서가 추가하는 것
    percentile_cont(0.5) WITHIN GROUP (ORDER BY p.touch_h)              AS touch_med,
    sum(p.events_per_month)                                             AS events_month_sum,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY p.feasibility)          AS feasibility_med,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY p.variability)          AS variability_med,
    avg(p.pain_step_ratio)                                              AS pain_step_ratio
    -- ★ pain_flag × assignee_id 조인은 여기에 존재하지 않는다 (POLICY §4.3 하드 룰)
  FROM process_rollup p
  JOIN documents d ON d.id = p.doc_id
  JOIN period_presets r ON r.key IN ('last30','last90','last365')
  WHERE d.archived_at IS NULL          -- 아카이브 문서는 집계에서 완전히 빠진다
  GROUP BY 1,2,3,4
),
sup AS (
  SELECT *,
    count(*) FILTER (WHERE contributor_n < 5)
      OVER (PARTITION BY dept_id, period_key) AS suppressed_cnt,
    row_number()
      OVER (PARTITION BY dept_id, period_key ORDER BY contributor_n) AS rn
  FROM base
)
SELECT org_id, process_key, dept_id, period_key,
       round(contributor_n / 5.0) * 5 AS contributor_n_rounded,
       round(process_n / 5.0) * 5     AS process_n_rounded,
       lead_time_med, touch_med, events_month_sum,
       feasibility_med, variability_med, pain_step_ratio
FROM sup
WHERE contributor_n >= 5
  AND NOT (suppressed_cnt = 1 AND rn = 2);   -- 2차 억제: 차집합 복원 차단
```

**후보(`candidates`)도 같은 규칙을 통과해야 한다.** 후보는 `agg_process`보다 좁은 단위(스코프 = 단계 몇 개)라 더 위험하다.

```ts
// packages/analytics-jobs/src/gates/k-anon.ts

/**
 * 후보가 관리자 화면에 나갈 수 있는가.
 * 이 함수를 거치지 않고 candidates를 읽는 코드 경로가 존재하면 CI가 실패한다.
 */
export function adminVisible(c: Candidate, ctx: KAnonContext): boolean {
  const contributors = ctx.contributorsOf(c);          // scope의 문서 소유자 집합
  if (contributors.size < 5) return false;             // ① 5인 차단
  const depts = ctx.deptsOf(contributors);
  if (depts.size === 1 && ctx.deptSize(depts.values().next().value) < 5) return false; // ② 소규모 부서
  if (c.scope.length === 1 && contributors.size < 5) return false;                     // ③ 단일 문서
  return true;
}
```

**5인 미만 후보가 사라지지 않는 세 경로** — 5인 차단이 제품 가치를 죽이지 않는 이유다.

| 경로 | 누가 보는가 | 근거 |
|---|---|---|
| 개인 리포트 "당신이 안 해도 되는 일" | 소유자 **본인만** | 본인 데이터 |
| 단계 유형 롤업 (§5.3) | 관리자 — 단, **패턴 수준** (`반려된 적 없는 승인 12건`) | 개별 프로세스 미식별 |
| 그룹 성장 후 자동 승격 | 5번째 기여자가 문서를 저장한 다음 날 배치 | 자동 |

세 번째가 성장 루프와 맞물린다 — *"이 후보는 4명이 적었어요. 한 명만 더 적으면 조직 리포트에 올라갑니다"*는 관리자에게 보여주면 작성 독촉(D-078 위반)이 되므로, **아무에게도 보여주지 않는다.** 조용히 기다린다.

---

## 7. 신뢰도 승격 경로 — 제품의 진짜 해자 (D-008)

### 7.1 세 등급을 가법 분해한다

`0.5 / 0.75 / 1.0`은 세 개의 라벨이지만, 실제로 승격은 **부분적으로** 일어난다. 빈도만 실측되고 시간은 자가추정인 상태가 가장 흔하다. 이때 0.5도 1.0도 정직하지 않다.

```ts
// packages/analytics-core/src/confidence.ts

export type ConfidenceEvidence = {
  /** 동료 합의 — §7.2 */
  peerAgreement: boolean;
  /** 빈도 실측 — §7.3 "했음" 카운터 */
  freqMeasured: boolean;
  /** 시간 실측 — §7.4 */
  durationMeasured: boolean;
  /** SaveRate를 사람이 확인했는가 (§2.4) */
  saveRateConfirmed: boolean;
};

export const CONFIDENCE_BASE = 0.5;

/**
 * 0.5 → 0.75 → 1.0 세 등급이 그대로 나온다.
 *   자가추정만            = 0.50
 *   동료합의               = 0.75
 *   동료합의 + 빈도 실측    = 1.00
 *   빈도 + 시간 실측        = 1.00
 * D-008의 세 라벨은 이 가법 구조의 대표점이다.
 */
export function confidence(e: ConfidenceEvidence): { value: number; label: ConfidenceLabel } {
  let c = CONFIDENCE_BASE;
  if (e.peerAgreement)     c += 0.25;
  if (e.freqMeasured)      c += 0.25;
  if (e.durationMeasured)  c += 0.25;
  if (e.saveRateConfirmed) c += 0.05;   // 작은 가산. 라벨을 바꾸진 않는다
  const value = Math.min(1, c);
  return {
    value,
    label: value >= 0.95 ? '실측' : value >= 0.7 ? '동료 확인' : '본인 추정',
  };
}
```

**감쇠** — [PRD §4.10](./PRD.md)의 신선도 규칙이 여기에도 걸린다. `lastConfirmedAt`이 180일 지나면 ×0.85, 365일 지나면 ×0.7. ASSEMBLY의 링크 신선도 감쇠와 **같은 계수를 쓴다** — 두 벌을 만들지 않는다.

### 7.2 동료 합의 판정

**"세 명이 비슷하게 적었다"를 정의해야 한다.** 아무 정의나 쓰면 fork로 복제한 문서 3개가 합의로 잡힌다.

```ts
// packages/analytics-core/src/confidence/peer.ts

export type PeerAgreementInput = {
  members: readonly {
    docId: string; ownerId: string;
    forkOfDocId: string | null;
    /** 이 사람이 다른 멤버 문서를 열람한 적이 있는가 (열람 로그) */
    viewedOthers: boolean;
    touchH: number | null;
    band: DurationBand | null;
    freqPerMonth: number | null;
    stepSet: ReadonlySet<string>;      // 정규화 단계 라벨
  }[];
};

/** ★ 독립 기여자의 정의 — 이 함수가 이 절의 핵심이다 */
function independentMembers(x: PeerAgreementInput) {
  const seenForkRoots = new Set<string>();
  return x.members.filter((m) => {
    // ① fork 형제는 1명으로 접는다. 복제본 3개는 합의가 아니라 복사다
    const root = m.forkOfDocId ?? m.docId;
    if (seenForkRoots.has(root)) return false;
    seenForkRoots.add(root);
    // ② 남의 문서를 보고 쓴 사람은 독립 관측이 아니다
    if (m.viewedOthers) return false;
    return true;
  });
}

export function peerAgreement(x: PeerAgreementInput): { agreed: boolean; because: string } {
  const ind = independentMembers(x);
  if (ind.length < 3) {
    return { agreed: false, because: `서로 따로 적은 사람이 ${ind.length}명이에요 (3명 필요)` };
  }

  // ── 세 가지 양이 모두 일치대역 안에 들어와야 한다 ──────────────────────
  // ① 시간 밴드: 최빈 밴드로부터 ±1밴드 안에 2/3 이상
  const bands = ind.map((m) => m.band).filter(Boolean) as DurationBand[];
  const modeBand = mode(bands);
  const bandOk = bands.length >= 3 &&
    bands.filter((b) => bandDistance(b, modeBand) <= 1).length / bands.length >= 2 / 3;

  // ② 빈도: 중앙값의 ±50% 안에 2/3 이상
  const freqs = ind.map((m) => m.freqPerMonth).filter((v): v is number => v != null);
  const medF = median(freqs);
  const freqOk = freqs.length >= 3 &&
    freqs.filter((f) => f >= medF * 0.5 && f <= medF * 1.5).length / freqs.length >= 2 / 3;

  // ③ 단계 구성: 평균 쌍별 Jaccard ≥ 0.6
  const stepOk = meanPairwiseJaccard(ind.map((m) => m.stepSet)) >= 0.6;

  const agreed = bandOk && freqOk && stepOk;
  const failing = [!bandOk && '걸리는 시간', !freqOk && '횟수', !stepOk && '단계 구성']
    .filter(Boolean).join('·');

  return {
    agreed,
    because: agreed
      ? `${ind.length}명이 따로 적었는데 내용이 비슷해요`
      : `${ind.length}명이 적었지만 ${failing}이(가) 서로 달라요`,
  };
}
```

> **합의가 안 되는 것도 산출물이다.** `bandOk = false`는 Confidence를 올리지 않지만 §6.3의 변동성 리포트에 그대로 들어간다. "세 명이 같은 일에 15분/1시간/반나절이라고 적었습니다"는 경영진이 가장 잘 반응하는 문장 중 하나다.

### 7.3 실측 승격 — "했음" 탭 카운터

**대상은 상위 5개뿐이다.** 전 단계에 카운터를 붙이면 아무도 안 누른다. 5개는 [PRD §4.7](./PRD.md)이 정한 수다.

#### 저장 위치 (D-094)

[MEASUREMENT §1](./MEASUREMENT.md)이 못 박은 대로, **빈도 값은 분석 이벤트(P1)로 복제하지 않는다.** 카운트는 제품 DB에만 있고, P1에는 값 없는 행위 이벤트만 나간다.

```ts
// db/schema-analytics.ts (이어서)

export const doneCounterSessions = pgTable('done_counter_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  candidateId: uuid('candidate_id').notNull(),
  startedOn: date('started_on').notNull(),
  endsOn: date('ends_on').notNull(),        // startedOn + 14일
  /** 예상 발생 건수 — 승격 판정의 분모 중 하나 */
  expectedEvents: real('expected_events').notNull(),
  state: text('state').$type<'active'|'promoted'|'insufficient'|'abandoned'>().notNull(),
}, (t) => [uniqueIndex('dcs_active').on(t.itemId, t.userId, t.startedOn)]);

export const doneCounterEvents = pgTable('done_counter_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull()
    .references(() => doneCounterSessions.id, { onDelete: 'cascade' }),
  /** 사용자가 말한 날짜 (오늘이 아닐 수 있다 — 소급 입력 허용) */
  occurredOn: date('occurred_on').notNull(),
  count: integer('count').notNull(),
  source: text('source').$type<'tap'|'dm'|'backfill'|'zero'>().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('dce_day').on(t.sessionId, t.occurredOn)]);  // 하루 1행. upsert
```

P1으로 나가는 이벤트는 값이 없다:

```ts
// packages/analytics-schema/src/events.ts 에 추가되는 zod .strict() 스키마 (D-119)
export const DoneCounterEvents = {
  done_counter_started:   z.object({ candidate_rank: z.number().int().min(1).max(5) }).strict(),
  done_counter_tapped:    z.object({ day_index: z.number().int(), source: z.enum(['tap','dm','backfill','zero']) }).strict(),
  done_counter_promoted:  z.object({ day_index: z.number().int(), ratio_band: z.enum(['under','match','over']) }).strict(),
  done_counter_abandoned: z.object({ day_index: z.number().int(), answered_days: z.number().int() }).strict(),
};
// ★ count 값은 여기 없다. ratio_band조차 밴드다 (under = 자가추정보다 적음)
```

#### 언제 묻는가

두 개의 표면이 동시에 산다. **하나만 두면 실패한다.**

| 표면 | 시점 | 근거 |
|---|---|---|
| **문서 상단 상시 버튼** | 사용자가 문서를 열 때 언제나 | 체크리스트 모드로 문서를 여는 사람은 어차피 그 일을 하는 중이다 |
| **하루 1회 슬랙 DM** | 근무일 **17:00** (POLICY §3.5 발송 창 09:30–17:30 안) | 상시 버튼만으로는 문서를 안 여는 날이 잡히지 않는다 |

```
오늘 「수주 정보를 세금계산서에 옮겨 적기」 몇 번 하셨어요?
[0]  [1]  [2]  [3+]        ← 4개 버튼. 자유 입력 없음
                              (「오늘은 안 물어보기」가 같은 크기로 함께)
```

**주 3건 알림 상한(D-079)을 넘지 않는가** — 넘는다. 그래서 **"했음" DM은 알림 상한의 예외로 두되, 사용자가 명시적으로 시작 버튼을 누른 세션에서만** 발송한다. 옵트인이 상한 면제의 근거다. 시작할 때 문구로 명시한다: *"2주 동안 하루 한 번 물어볼게요. 언제든 그만둘 수 있어요."*

#### 어떻게 세는가

```ts
// packages/analytics-core/src/confidence/counter.ts

export type CounterState = {
  workdaysElapsed: number;
  answeredDays: number;         // 0도 답이다. 응답한 날
  totalEvents: number;
  expectedEvents: number;       // 자가추정으로 예측한 2주치 건수
};

export const PROMOTION_RULES = {
  /** 근무일 10일 중 6일 이상 응답 */
  minAnsweredDays: 6,
  /** 고빈도 업무: 총 10건 이상 관측 */
  minEventsHighFreq: 10,
  /** 저빈도 업무: 예상 건수의 60% 이상이 확인됨 */
  minCoverageLowFreq: 0.6,
  /** 저빈도 판정 기준 — 2주 예상 건수 */
  lowFreqThreshold: 10,
} as const;

export function evaluatePromotion(s: CounterState): PromotionVerdict {
  const R = PROMOTION_RULES;
  if (s.answeredDays < R.minAnsweredDays) {
    return { promoted: false, reason: 'not-enough-days',
             copy: `${s.answeredDays}일 답해주셨어요. ${R.minAnsweredDays}일이면 정확한 값으로 바꿀 수 있어요` };
  }
  const lowFreq = s.expectedEvents < R.lowFreqThreshold;
  const ok = lowFreq
    ? s.totalEvents >= s.expectedEvents * R.minCoverageLowFreq
    : s.totalEvents >= R.minEventsHighFreq;

  if (!ok) {
    // ★ 관측이 예상보다 훨씬 적다 = "안 하는 일"이라는 정보다. 실패가 아니다
    return { promoted: false, reason: 'fewer-than-expected',
             copy: '생각보다 자주 하는 일이 아니었네요. 순위를 다시 계산할게요',
             downgradeFreq: true };
  }

  // 근무일 → 월 환산. 관측일 기준이지 달력 기준이 아니다
  const perMonth = (s.totalEvents / s.answeredDays) * 21.7;
  return { promoted: true, measuredPerMonth: perMonth, reason: 'ok',
           copy: `2주 동안 ${s.totalEvents}번 하셨어요` };
}
```

**중복 방지** — `(sessionId, occurredOn)` 유니크로 하루 1행. 같은 날 여러 번 탭하면 **덮어쓰기가 아니라 누적**이다(탭 = +1). DM 응답은 그날의 값을 **치환**한다(사람이 하루를 통틀어 답한 것이므로). 이 둘의 우선순위는 `dm > tap`.

**세션이 끝나면 무슨 일이 일어나는가**

```ts
export async function closeSession(s: Session, db: Db) {
  const v = evaluatePromotion(stateOf(s));
  if (v.promoted) {
    await db.update(stepFeatures).set({ freqPerMonth: v.measuredPerMonth, freqSource: 'counter' });
    await recordCalibrationPair(s, v);              // §7.5
  } else if (v.downgradeFreq) {
    await db.update(stepFeatures).set({ freqPerMonth: observedPerMonth(s), freqSource: 'counter' });
  }
  // ★ 어느 쪽이든 사용자에게는 결과를 돌려준다. 이게 다음 세션 참여율을 만든다
  await notifyResult(s.userId, v);
}
```

### 7.4 시간 실측 — 어디까지 할 것인가

빈도는 세기 쉽지만 **시간은 세기 어렵다.** 타이머를 붙이는 순간 이 제품은 감시 도구가 된다(D-002가 막는 것과 정확히 같은 종류의 실패).

**결론: 스톱워치를 만들지 않는다.** 대신 두 가지 약한 신호만 받는다.

1. **체크리스트 모드의 시작/완료 타임스탬프** — 이미 `checklist_started` / `checklist_completed` 이벤트가 있다. 두 시각의 차이는 리드타임이지 접촉시간이 아니다. **문서 전체가 한 자리에서 끝나는 짧은 흐름(단계 5개 이하, 예상 리드타임 1시간 이하)에서만** 접촉시간의 근사로 쓴다.
2. **"했음" 탭에 붙는 선택 1문항** — 승격 세션 마지막 날에만, 딱 한 번.
   > *마지막으로 하나만요. 이 일 한 번 할 때 보통 얼마나 걸리세요?* `[5분]` `[15분]` `[1시간]` `[반나절]`
   자가추정과 밴드가 다르면 **후자를 쓴다** — 2주 동안 실제로 하면서 답한 값이 2주 전 기억보다 정확하다.

`durationMeasured = true`는 위 두 경로 중 하나가 성립할 때만이다. 그 외에는 영원히 자가추정이고, 리포트에 그렇게 적힌다.

### 7.5 실측이 자가추정과 크게 다를 때 — 보정 계수를 학습하는가 (D-089)

**학습한다. 단, 조직·밴드 단위로만.** 개인별 보정은 영구 금지다 — "김○○의 추정은 1.8배 부풀려져 있다"는 값은 만들어지는 순간 감시 데이터다.

```ts
// packages/analytics-core/src/calibration.ts

export type CalibrationPair = {
  orgId: string;
  /** 무엇에 대한 보정인가 */
  target: 'freq' | 'duration';
  /** 밴드 단위로만 학습한다. 세밀하게 나눌수록 표본이 마르고 개인이 드러난다 */
  bucket: DurationBand | FreqBucket;
  selfEstimate: number;
  measured: number;
  observedOn: Date;
};

export const CALIBRATION_RULES = {
  minPairs: 20,             // 표본 20쌍 미만이면 보정하지 않는다
  minContributors: 5,       // ★ k-익명성. 5명 미만의 데이터로 만든 계수는 개인 데이터다
  clamp: [0.5, 2.0] as const,
  halfLifeDays: 180,        // 오래된 쌍은 가중치가 준다
};

export function learnFactor(pairs: readonly CalibrationPair[], now: Date): CalibrationFactor | null {
  if (pairs.length < CALIBRATION_RULES.minPairs) return null;
  if (new Set(pairs.map((p) => p.contributorId)).size < CALIBRATION_RULES.minContributors) return null;

  // 비율의 **중앙값**. 평균은 한 건의 10배 오차가 계수를 망친다
  const weighted = pairs.map((p) => ({
    r: p.measured / Math.max(p.selfEstimate, 1e-6),
    w: Math.pow(0.5, daysBetween(p.observedOn, now) / CALIBRATION_RULES.halfLifeDays),
  }));
  const r = weightedMedian(weighted);
  const [lo, hi] = CALIBRATION_RULES.clamp;

  return {
    factor: clamp(r, lo, hi),
    n: pairs.length,
    clamped: r < lo || r > hi,
    /** 리포트에 그대로 표시된다 */
    disclosure: `이 조직에서 지금까지 실제로 세어본 결과, 처음 적은 값보다 평균 ${fmtRatio(r)} 나왔어요`,
  };
}
```

**적용 규칙 5개**

1. **미실측 후보에만 적용한다.** 실측된 후보는 실측값 그대로.
2. **밴드 안에서만.** `15m` 밴드에서 학습한 계수를 `halfday`에 쓰지 않는다.
3. **리포트에 반드시 표시한다.** `보정 적용됨 ×0.7 (실측 24건 기준)`. 조용히 곱하면 그 숫자는 아무도 검증할 수 없게 된다.
4. **클램프를 벗어나면 보정하지 않고 경고한다.** `r = 3.2`는 보정이 필요한 게 아니라 **밴드 설계나 질문 문구가 틀렸다는 신호**다.
5. **개인별·부서별 계수를 만들지 않는다.** 조직 전체 × 밴드가 유일한 축이다. 부서를 축에 넣는 순간 "영업팀은 1.6배 부풀린다"가 되고, 그것은 [POLICY §5.2](./POLICY.md)가 금지하는 형태의 출력이다.

> **실측이 자가추정의 3배로 나왔을 때 무엇을 의심하는가** — 순서대로: (a) 밴드 경계가 틀렸다 (b) 질문이 "1회"가 아니라 "하루치"로 읽혔다 (c) 그 사람이 하는 일이 실제로 여러 개다(문서가 쪼개져야 한다). 계수를 3.0으로 만드는 것은 셋 다 아닐 때뿐인데, 그런 경우는 드물다.

---

## 8. 리포트 생성

### 8.1 직원용 — "당신이 안 해도 되는 일 3가지"

[D-001](./DECISIONS.md)에 따라 **이 화면에 '자동화'라는 단어가 나오지 않는다.** 그리고 [D-021](./DECISIONS.md)에 따라 **게이지·도넛·진행률 바가 없다.** 숫자와 문장뿐이다.

#### 무엇을 어떤 순서로

정렬 키는 `priorityP10`이 **아니다.** 경영진의 우선순위와 개인의 우선순위는 다르다.

```ts
// packages/analytics-core/src/report/employee.ts

/**
 * 개인 화면의 정렬 = "이 사람이 되찾는 시간" × "이 사람이 싫어하는 정도"
 * 조직 전체 가치(N_people 배수)는 여기서 곱하지 않는다 —
 * 내가 주당 20분 아끼는 일이 조직 전체로는 1위여도, 내 화면의 1위는 아니다.
 */
export function rankForEmployee(cands: readonly Candidate[], userId: string): Candidate[] {
  return cands
    .map((c) => ({
      c,
      myHoursPerWeek: myShareOfSavedHours(c, userId) / 52,
      pain: myPainRatio(c, userId),            // 내가 이 스코프에 😤를 몇 개 달았나
      recency: freshnessOf(c),
    }))
    .filter((x) => x.myHoursPerWeek >= 10 / 60)   // 주 10분 미만은 안 보여준다. 시시하다
    .sort((a, b) =>
      (b.myHoursPerWeek * (1 + 0.5 * b.pain) * b.recency) -
      (a.myHoursPerWeek * (1 + 0.5 * a.pain) * a.recency))
    .slice(0, 3)
    .map((x) => x.c);
}
```

**세 개가 안 나오면 세 개를 만들지 않는다.** 1개면 1개다. 억지로 채운 3번째가 "이 도구는 아무거나 갖다 붙이는구나"를 만든다.

#### 문구 구조 — 4줄 고정

[SEED-CONTENT §D](./SEED-CONTENT.md)의 직원 화면이 정본이다. 엔진은 이 4줄을 생성한다.

```ts
export type EmployeeCard = {
  rank: 1 | 2 | 3;
  /** ① 제목 — 사용자가 쓴 단계 제목을 동사구로. 엔진이 새 표현을 지어내지 않는다 */
  title: string;
  /** ② 시간 — 주 단위. 연 단위로 쓰면 남 일처럼 읽힌다 */
  timeCopy: string;         // "매주 5시간 20분"
  /** ③ 무엇이 대신 되는가 — 2문장 이내 */
  whatHappens: string;
  /** ④ ★ 당신에게 남는 일 — 이 줄이 실직 공포를 막는 유일한 장치다 */
  whatRemains: string;
  /** ⑤ 사용자가 직접 채우는 빈 칸 */
  prompt: '그 시간에 하고 싶은 일';
};

export function renderEmployeeCard(c: Candidate, userId: string): EmployeeCard {
  const hours = myShareOfSavedHours(c, userId) / 52;
  return {
    rank: c.rank,
    // 원문 그대로. HANDOVER §7의 "사용자 원문은 다시 쓰지 않는다"와 같은 규칙
    title: quoteUserTitle(c.scope),
    timeCopy: `매주 ${fmtHoursKo(hours)}`,
    whatHappens: describeReplacement(c),      // 도구 카탈로그와 단계 구조에서 생성
    whatRemains: describeRemaining(c),        // ★ 아래 규칙
    prompt: '그 시간에 하고 싶은 일',
  };
}

/**
 * "당신이 계속 하는 일" 문장 생성 규칙 — 순서대로 첫 번째로 해당하는 것 하나만.
 *   1. 스코프 안에 판단(주관 caseLabel)이 있으면 → 그 판단
 *   2. 확인·검토 동사 단계가 있으면 → 그 확인
 *   3. 예외율이 20% 이상이면 → "예외인 경우"
 *   4. 아무것도 없으면 → 이 문장을 쓰지 않는다 (지어내지 않는다)
 */
function describeRemaining(c: Candidate): string
```

**갱신 시점** — L2 직후(즉, 저장 후 30초 이내). 다만 **화면에 "방금 바뀌었어요" 같은 표시는 하지 않는다.** 순위가 실시간으로 흔들리는 것을 사용자가 보면 숫자를 안 믿게 된다. 조용히 갱신되고, 사용자가 다음에 열 때 최신이다.

**잠금 해제 조건** — 메타데이터가 3개 단계 이상 채워져야 카드가 나온다. 그 전에는 [PRD §4.5](./PRD.md)의 문구가 그대로 나간다: *"3개만 더 채우면 순위를 계산할 수 있어요."*

### 8.2 경영진용

[POLICY §8.1](./POLICY.md)의 **위젯 화이트리스트 11개** 안에서만 만든다. 새 위젯은 기능 요청이 아니라 정책 변경이다.

#### 8.2.1 Value × Feasibility 매트릭스 — 그래프가 아니라 표다

[D-021](./DECISIONS.md)이 집계 시각화를 금지한다. 4분면은 **정렬된 표 + 분면 라벨**로 렌더한다.

```ts
export type Quadrant = 'do-now' | 'plan' | 'quick-win' | 'park';

export function quadrantOf(c: Candidate, med: { value: number; feas: number }): Quadrant {
  const hiV = c.valueP50 >= med.value;
  const hiF = c.feasibility >= med.feas;
  return hiV && hiF ? 'do-now' : hiV ? 'plan' : hiF ? 'quick-win' : 'park';
}

export const QUADRANT_COPY: Record<Quadrant, { label: string; note: string }> = {
  'do-now':    { label: '지금 하세요',   note: '가치가 크고 실행도 어렵지 않아요' },
  'plan':      { label: '준비가 필요해요', note: '가치는 크지만 선행 조건이 있어요' },
  'quick-win': { label: '금방 됩니다',   note: '작지만 이번 주에 끝낼 수 있어요' },
  'park':      { label: '나중에',        note: '지금은 우선순위가 아니에요' },
};
```

**기준선은 조직 중앙값**이지 절대값이 아니다. 조직마다 Value 분포가 다르고, 절대 기준을 쓰면 작은 조직의 모든 후보가 `park`에 들어간다.

각 행에 반드시 함께 나가는 것:

| 열 | 내용 |
|---|---|
| 후보 | 단계 유형 표현 (문서 제목 아님, 개인 없음) |
| 가치 | **구간** `1,100만 ~ 2,600만 원/년` + 미산정 항 표시 |
| 실행 난이도 | Feasibility + **캡 사유**(있으면) |
| 신뢰도 | `본인 추정` / `동료 확인` / `실측` + 기여자 수(5단위 반올림) |
| 커버리지 | `이 후보의 데이터가 얼마나 채워져 있는가` |

#### 8.2.2 제거 후보 — 매트릭스보다 **위에** 온다

화면 순서가 곧 주장이다. [D-007](./DECISIONS.md)의 "ECRS 우선"은 계산 순서만이 아니라 **레이아웃 순서**다.

```
① 없앨 수 있는 것            ← 개발 0줄. 이번 주에 가능
② 먼저 바꿔야 하는 것        ← precondition (홈택스 → 바로빌 등)
③ 자동화 후보                ← 예산과 개발이 필요
④ 서로 다르게 알고 있는 것   ← ASSEMBLY의 불일치 리포트
⑤ 우리가 보지 않는 것        ← 숨길 수 없는 패널 (POLICY §8.1 위젯 8)
```

[SEED §D-4](./SEED-CONTENT.md)가 말한 그대로다 — *"자동화 3건은 예산과 개발 리소스를 요구하지만 X-1·X-2는 규정 한 줄 수정이다."*

#### 8.2.3 불일치 리포트

**이 문서가 만들지 않는다.** [ASSEMBLY §7](./ASSEMBLY.md)의 13종 검출기와 `agg_seam_discrepancy` 뷰가 정본이고, 경영진 리포트는 그 뷰를 읽어 상위 5건을 싣는다. 여기서 추가하는 것은 하나뿐이다 — **불일치와 후보의 교차 참조**.

```ts
/** 후보의 스코프에 걸친 불일치가 있으면 후보 카드에 붙인다 */
export function linkDiscrepancies(c: Candidate, ds: readonly SeamDiscrepancy[]): SeamDiscrepancy[] {
  return ds.filter((d) => d.deptPair.some((dept) => c.deptScope.includes(dept))
                       && overlapsScope(d, c));
}
```

[SEED D-2](./SEED-CONTENT.md)의 J-12가 정확히 이 형태다 — 입사자 준비 자동화 후보에 *"인사는 1주 전 요청 / 총무는 2주 필요"* 불일치가 붙어 나오고, **그 불일치를 먼저 해소하는 것이 자동화보다 싸다**는 결론이 자동으로 도출된다.

#### 8.2.4 갱신 시점

| 산출물 | 갱신 | 근거 |
|---|---|---|
| 경영진 대시보드 | **주 1회 월요일 07:00** 스냅샷 | 순위가 매일 흔들리면 아무도 안 믿는다. 스냅샷이 있어야 "지난주 대비"가 성립한다 |
| 온디맨드 재계산 | 분석 좌석 보유자가 버튼으로, **일 1회 상한** | 차분 공격(differencing) 비용을 올린다 |
| 월간 리포트(PDF) | 매월 1영업일 | 이사회·경영회의 주기 |
| 불일치 리포트 | 야간 배치 (ASSEMBLY 소관) | |

**스냅샷은 지운 뒤 다시 만들지 않는다.** `exec_report_snapshots`는 append-only다. 지난주 리포트의 숫자가 이번 주에 소급해서 바뀌면 그 리포트로 내린 결정을 검증할 수 없다.

---

## 9. n8n 내보내기 — 완전 명세

> 상태: [D-011](./DECISIONS.md) ⏳ 보류(M5+). **인터페이스는 지금 확정한다** — `tools.n8n_node_type` 컬럼이 이미 자리를 잡았고, 3개월 뒤에 붙이면 익스포터 전체가 퍼지 문자열 매칭이 된다.
> 요금: [POLICY §10.1](./POLICY.md) — **분석 좌석 전용 기능**.

[GRAPH-CORE §10](./GRAPH-CORE.md)의 한 줄이 이 절 전체를 지배한다.

> **우리 그래프는 제어 흐름이고 n8n 워크플로는 데이터 파이프라인이다.**

### 9.1 두 층으로 나눈다

```
graph-core/src/export/n8n.ts        구조 변환. 순수. 골든 픽스처 대상
  └ toN8n(graph, options) → { workflow, unmapped, coverage, notes }

exporters/src/n8n-draft.ts          조직 지식 주입 + 초안 포장
  └ toN8nDraft(graph, ctx) → { workflow, spec, manifest }
```

`toN8n()`은 **조직을 모른다.** 도구 카탈로그도 주입받는다. 후보 스코어·실행 명세·경고 문구는 전부 `exporters` 층이다. 이 분리가 없으면 graph-core에 조직 지식이 새어 들어가고 [D-033](./DECISIONS.md)이 무너진다.

### 9.2 n8n 워크플로 JSON 스키마

```ts
// packages/exporters/src/n8n/schema.ts

export type N8nNode = {
  /** 우리 NodeId를 그대로 쓴다 — 재수출 시 diff가 가능해진다 */
  id: string;
  /** ★ connections의 키가 name이다. 고유해야 하고, 바뀌면 연결이 깨진다 */
  name: string;
  type: string;                      // 'n8n-nodes-base.slack'
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  /** 노드 위에 뜨는 메모. 우리 정보를 흘려보내는 주 통로 */
  notes?: string;
  notesInFlow?: boolean;
  /** 실행되면 안 되는 노드는 전부 true */
  disabled?: boolean;
  credentials?: Record<string, { id: string | null; name: string }>;
  alwaysOutputData?: boolean;
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  executeOnce?: boolean;
  webhookId?: string;
};

export type N8nConnection = { node: string; type: 'main'; index: number };

export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  /** { [노드 name]: { main: [출력0 연결들, 출력1 연결들, ...] } } */
  connections: Record<string, { main: N8nConnection[][] }>;
  /** ★ 언제나 false. 타입 수준에서 리터럴로 고정한다 (D-095) */
  active: false;
  settings: N8nSettings;
  staticData: null;
  pinData: Record<string, never>;
  tags: { name: string }[];
  meta: {
    generatedBy: 'preflow';
    sourceTopologyHash: string;
    sourceDocId: string;
    exportedAt: string;      // ISO
    specUrl: string;         // ★ §10 실행 명세로 가는 링크
    coverage: number;
  };
  versionId?: string;
};

export type N8nSettings = {
  /** v1 = n8n 1.x의 결정적 실행 순서. 지정 안 하면 버전마다 달라진다 */
  executionOrder: 'v1';
  saveManualExecutions: true;
  saveExecutionProgress: true;
  saveDataErrorExecution: 'all';
  saveDataSuccessExecution: 'all';
  /** 초안이 실수로 돌아도 무한 실행되지 않도록 */
  executionTimeout: 300;
  errorWorkflow?: string;
  timezone: 'Asia/Seoul';
};
```

### 9.3 매핑표 — 우리 노드 → n8n 노드

| 우리 개념 | n8n | typeVersion | 손실 |
|---|---|---|---|
| `start` (트리거 manual) | `n8n-nodes-base.manualTrigger` | 1 | 트리거 조건 |
| `start` (트리거 schedule) | `n8n-nodes-base.scheduleTrigger` | 1.2 | — |
| `start` (트리거 webhook) | `n8n-nodes-base.webhook` | 2 | 인증·페이로드 |
| `end` | `n8n-nodes-base.noOp` | 1 | — |
| 순차 연결 | `connections.main[0]` | — | 없음 |
| `task` + 도구 매핑 있음 | 카탈로그의 `n8nNodeType` | 1 | **파라미터 전부** |
| `task` + 도구 `n8n: HTTP` | `n8n-nodes-base.httpRequest` | 4.2 | URL·인증·바디 |
| `task` + 도구 매핑 없음 | `n8n-nodes-base.noOp` + `disabled: true` | 1 | 전부 |
| `task` + 도구 연결성 `하` | **`n8n-nodes-base.stickyNote`** (노드 아님) + `noOp disabled` | 1 | 전부 — §9.4 |
| `branch` xor (갈래 2) | `n8n-nodes-base.if` | 2.2 | 조건식 |
| `branch` xor (갈래 3+) | `n8n-nodes-base.switch` | 3.2 | 조건식 |
| `branch` skip | `if` (true = 갈래 / false = 통과) | 2.2 | 조건식 |
| `branch` and | `noOp` 하나 → 여러 연결 (fan-out) | 1 | **동시성** |
| AND 합류 (`join`) | `n8n-nodes-base.merge` | 3 | 없음 |
| `hold` `waitFor:'time'` | `n8n-nodes-base.wait` (`timeInterval`) | 1.1 | — |
| `hold` `waitFor:'approval'` | `wait` (`resume: 'webhook'`) + 스티키 | 1.1 | 승인 UI·결재선 |
| `hold` `waitFor:'reply'` | `wait` (`resume: 'webhook'`) + 스티키 | 1.1 | 재촉·타임아웃 |
| `hold` `waitFor:'resource'` | `wait` (`timeInterval`) + 스티키 "폴링 필요" | 1.1 | 도착 감지 |
| 사이클 (재작업 루프) | 역방향 `connections` + `if` 가드 | 2.2 | **종료 조건** |
| `hold.timeoutH` | — | — | **표현 불가** |
| 짜증 플래그 · 비공개 노트 | **내보내지 않는다** ([D-062](./DECISIONS.md)) | — | — |

### 9.4 매핑 불가능한 것을 어떻게 다루는가

**세 가지를 절대 하지 않는다.**

1. **자연어 조건을 n8n 표현식으로 번역하지 않는다.** "단순 문의라면" → `{{$json.type === 'simple'}}`는 **그럴듯하게 틀린 조건**이고, 빈 조건보다 위험하다. 빈 조건은 사람이 채우지만 틀린 조건은 그대로 돈다.
2. **사람이 하는 일을 자동 노드로 위장하지 않는다.** 전화·종이·인감은 `noOp disabled` + 스티키다.
3. **없는 데이터 매핑을 추측하지 않는다.** 모든 `parameters`는 비어 있다.

**표현 수단 3종**

```ts
// packages/exporters/src/n8n/unmapped.ts

export type UnmappedRepresentation =
  /** ① 실행되면 안 되는 자리표시자 — 흐름의 위치는 지키되 실행은 막는다 */
  | { kind: 'disabled-noop'; note: string }
  /** ② 캔버스에 붙는 설명 카드 — 사람이 읽을 것 */
  | { kind: 'sticky'; content: string; color: StickyColor }
  /** ③ 워크플로 밖의 목록 — 실행 명세(§10)로 넘어간다 */
  | { kind: 'spec-item'; section: SpecSection; text: string };

export const STICKY_COLOR = {
  danger: 3,    // 빨강 — 실행 금지 경고
  human: 4,     // 노랑 — 사람이 해야 하는 일
  info: 5,      // 파랑 — 설명
  todo: 7,      // 회색 — 채워야 할 것
} as const;

/** 연결성 '하' 도구가 붙은 단계 — 가장 중요한 처리 */
export function renderOfflineStep(v: DerivedNode, tools: ToolEntry[]): UnmappedRepresentation[] {
  const t = tools.find((x) => x.capsFeasibility)!;
  return [
    { kind: 'disabled-noop',
      note: `사람이 하는 일 — ${t.name}. 이 노드는 실행되지 않습니다.` },
    { kind: 'sticky', color: STICKY_COLOR.human,
      content: `## 🙋 사람이 하는 단계\n\n**${v.title}**\n\n${t.name}은(는) 자동화할 수 없습니다.\n` +
               (t.upgradePath
                 ? `\n💡 **${t.upgradePath.note}** — 이걸 먼저 바꾸면 이 단계도 자동화할 수 있습니다.`
                 : '\n이 단계 앞뒤를 자동화하고, 여기서만 사람에게 넘기는 형태를 검토하세요.') },
    { kind: 'spec-item', section: 'human-steps',
      text: `${v.title} — ${t.name} 사용. 담당: (실행 명세에서 지정)` },
  ];
}
```

**`hold` + 승인의 처리** — Wait + webhook 껍데기만으로는 "누가 승인하는가"가 사라진다. 그래서 세 개가 함께 나간다.

```
[Wait: 팀장 승인]  resume=webhook       ← 노드
   └ 스티키(노랑): "그룹웨어 결재가 이 자리에 옵니다.
                   결재선: 팀장 → 본부장. 반려되면 3번으로 돌아갑니다.
                   n8n Wait에는 반려 분기가 없습니다 — 직접 만들어야 합니다."
   └ 실행 명세 §6 예외 처리에 한 줄
```

### 9.5 분기 → IF / Switch / Merge

```ts
// packages/exporters/src/n8n/branch.ts

export function mapBranch(v: DerivedNode, g: DerivedGraph): N8nNode {
  const outs = (g.outgoing.get(v.id) ?? []).filter((e) => e.reason === 'branch-case' || e.reason === 'skip-else');
  const labels = outs.map((e) => e.label ?? '조건');

  if (v.branchMode === 'and') {
    // AND는 노드가 아니라 **연결의 모양**이다. fan-out은 하나의 출력에서 여러 연결로 표현된다
    return noOp(v, '여기서 여러 갈래가 동시에 시작됩니다 (n8n은 순서대로 실행합니다)');
  }

  if (v.branchMode === 'skip') {
    // 조건스킵: true = 갈래로, false = 통과
    return {
      ...base(v),
      type: 'n8n-nodes-base.if', typeVersion: 2.2,
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [],          // ★ 비어 있다. 사람이 채운다
          combinator: 'and',
        },
        looseTypeValidation: false,
      },
      notes: `조건: ${labels[0]}\n(참이면 위쪽 출력, 거짓이면 아래쪽 = 이 단계를 건너뜁니다)`,
      notesInFlow: true,
    };
  }

  // XOR
  if (outs.length <= 2) {
    return {
      ...base(v),
      type: 'n8n-nodes-base.if', typeVersion: 2.2,
      parameters: { conditions: { options: { version: 2 }, conditions: [], combinator: 'and' } },
      notes: `${labels.join(' / ')}\n조건식은 비어 있습니다.`,
      notesInFlow: true,
    };
  }
  return {
    ...base(v),
    type: 'n8n-nodes-base.switch', typeVersion: 3.2,
    parameters: {
      mode: 'rules',
      rules: {
        values: labels.map((l) => ({
          conditions: { options: { version: 2 }, conditions: [], combinator: 'and' },
          renameOutput: true,
          outputKey: l,
        })),
      },
      options: { fallbackOutput: 'none' },   // "아무 갈래에도 안 맞는 경우"는 사람이 정한다
    },
    notes: `${labels.length}갈래: ${labels.join(' / ')}`,
    notesInFlow: true,
  };
}

/** AND 합류 — 우리 join 노드가 그대로 Merge가 된다 */
export function mapJoin(v: DerivedNode, g: DerivedGraph): N8nNode {
  const inputs = (g.incoming.get(v.id) ?? []).length;
  return {
    ...base(v),
    type: 'n8n-nodes-base.merge', typeVersion: 3,
    parameters: { mode: 'combine', combineBy: 'combineAll', numberInputs: Math.max(2, inputs) },
    notes: '모든 갈래가 끝나야 다음으로 넘어갑니다.',
    notesInFlow: true,
  };
}
```

**출력 인덱스 규칙** — 갈래 순서 = 출력 인덱스. 사용자가 쓴 순서가 정상 경로 우선이라는 [DESIGN §6.5](./DESIGN.md)의 규칙과 같다. `skip-else` 경로는 항상 **마지막 인덱스**로 간다.

**AND의 정직한 경고** — n8n은 브랜치를 **순차 실행**한다. 우리 리드타임 계산은 `max(각 갈래)`를 가정한다. 이 둘은 실행 시점에 어긋난다. 경고가 아니라 **명세에 반드시 적는 사실**이다.

```
⚠️ 이 흐름에는 동시에 진행되는 갈래가 3개 있습니다.
   문서의 리드타임 계산은 "동시에 진행 = 가장 긴 것만큼 걸림"을 가정했습니다.
   n8n은 갈래를 순서대로 실행하므로, 실제 실행 시간은 세 갈래의 합에 가깝습니다.
   → 동시성이 필요하면 갈래를 별도 워크플로로 분리하고 Execute Workflow로 호출하세요.
```

### 9.6 기다림 → Wait / Webhook / 폴링

```ts
export function mapHold(v: DerivedNode): { node: N8nNode; extras: UnmappedRepresentation[] } {
  const w = v.waitFor;

  if (w === 'time') {
    return {
      node: { ...base(v), type: 'n8n-nodes-base.wait', typeVersion: 1.1,
              parameters: { resume: 'timeInterval', amount: v.attrs.avgWaitH ?? 1, unit: 'hours' },
              notes: v.title },
      extras: v.attrs.timeoutH != null
        ? [{ kind: 'spec-item', section: 'exceptions',
             text: `${v.attrs.timeoutH}시간 후 에스컬레이션 — n8n Wait으로 표현 불가. 별도 워크플로 필요` }]
        : [],
    };
  }

  if (w === 'resource') {
    // 자원 대기는 "언제 오는지 모른다" — 폴링 루프가 정직한 표현이다
    return {
      node: { ...base(v), type: 'n8n-nodes-base.wait', typeVersion: 1.1,
              parameters: { resume: 'timeInterval', amount: 1, unit: 'hours' },
              notes: `${v.title}\n도착했는지 주기적으로 확인해야 합니다.` },
      extras: [{ kind: 'sticky', color: STICKY_COLOR.todo,
                 content: `## ⏳ 도착을 기다리는 자리\n\n**${v.title}**\n\n` +
                          `1시간마다 확인하는 형태로 넣어 두었습니다.\n` +
                          `상대 시스템이 웹훅을 지원하면 폴링 대신 Webhook 트리거로 바꾸세요 — ` +
                          `그게 이 단계에서 가장 큰 개선입니다.` }],
    };
  }

  // approval / reply — 사람이 돌려줘야 흐름이 재개된다
  return {
    node: { ...base(v), type: 'n8n-nodes-base.wait', typeVersion: 1.1,
            parameters: { resume: 'webhook', httpMethod: 'POST', responseMode: 'onReceived' },
            notes: `${v.title} — 사람이 처리해야 재개됩니다.`, webhookId: deterministicWebhookId(v.id) },
    extras: [
      { kind: 'sticky', color: STICKY_COLOR.human,
        content: `## ✋ 사람을 기다리는 자리\n\n**${v.title}**\n\n` +
                 `Wait 노드가 재개 URL을 만듭니다. 그 URL을 누가·어떻게 호출할지는 정해져 있지 않습니다.\n` +
                 (w === 'approval' ? '반려 경로가 n8n Wait에는 없습니다. IF를 붙여 직접 만드세요.\n' : '') +
                 (v.attrs.timeoutH != null ? `${v.attrs.timeoutH}시간 뒤 처리도 별도로 만들어야 합니다.` : '') },
      { kind: 'spec-item', section: 'human-steps', text: `${v.title} (${w === 'approval' ? '승인' : '회신'} 대기)` },
    ],
  };
}
```

### 9.7 사이클(재작업 루프)을 n8n에서

n8n은 역방향 연결을 **허용한다.** 문제는 멈추지 않는다는 것이다. 확률적 반복(반려율 30%)은 n8n에 존재하지 않는다.

**해법: 되돌아가는 연결 앞에 `IF` 가드를 하나 넣는다.**

```ts
// packages/exporters/src/n8n/cycle.ts

/**
 * back edge 하나당 가드 노드 하나. 결정적 ID를 쓴다 (재수출 시 diff 가능)
 *
 *   [원래 노드] ──▶ [IF: 다시 해야 하나요?]
 *                      ├─(true, 그리고 반복 3회 미만)──▶ 되돌아갈 노드
 *                      └─(false)──────────────────────▶ 원래의 다음 노드
 */
export function loopGuard(edge: DerivedEdge, g: DerivedGraph, cycle: CycleInfo): N8nNode {
  const target = g.byId.get(edge.target)!;
  return {
    id: `guard:${edge.id}`,
    name: uniqueName(`다시 해야 하나요? (${target.title})`),
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    parameters: {
      conditions: {
        options: { version: 2, typeValidation: 'strict' },
        // ★ 반복 상한만 미리 넣는다. "다시 해야 하는가"의 판정은 비워 둔다.
        //   상한이 없으면 초안이 실수로 실행됐을 때 무한 루프가 된다
        conditions: [{
          id: 'loop-guard',
          leftValue: '={{ $runIndex }}',
          rightValue: 3,
          operator: { type: 'number', operation: 'lt' },
        }],
        combinator: 'and',
      },
    },
    notes:
      `되돌아가는 흐름입니다.\n` +
      (cycle.reworkRate != null
        ? `문서에는 10번 중 ${Math.round(cycle.reworkRate * 10)}번 되돌아간다고 적혀 있습니다.\n`
        : '') +
      `※ 지금은 "3번까지만 반복"이라는 안전장치만 들어 있습니다.\n` +
      `   무엇을 보고 되돌아갈지는 비어 있습니다 — 직접 채우세요.`,
    notesInFlow: true,
  };
}
```

**세 가지를 함께 내보낸다** — 가드 노드 + 스티키(빨강) + 실행 명세의 예외 섹션 한 줄. 그리고 `unmapped`에 `reason: 'loop-condition'`으로 기록되어 **coverage를 깎는다.**

### 9.8 초안임을 어떻게 표시하는가 (D-095)

**여섯 겹.** 하나만 두면 반드시 뚫린다.

| # | 장치 | 뚫리는 경우를 막는 것 |
|---|---|---|
| 1 | `active: false` (타입 리터럴) | 임포트 직후 자동 실행 |
| 2 | 워크플로 이름 `[초안] …` 접두 | 목록에서 구별 |
| 3 | 태그 `preflow-draft`, `not-executable` | 필터·검색 |
| 4 | **첫 스티키(빨강)가 캔버스 좌상단(0,0) 고정** | 열자마자 보인다 |
| 5 | **매핑 안 된 모든 노드 `disabled: true`** | 실행해도 아무 일이 안 난다 |
| 6 | `settings.executionTimeout = 300` | 실수 실행 시 5분 후 강제 종료 |

```ts
export const DRAFT_STICKY = (coverage: number, unmappedCount: number) => ({
  parameters: {
    content:
      `# ⛔ 이 워크플로는 실행할 수 없습니다\n\n` +
      `업무 흐름의 **순서와 구조만** 옮긴 초안입니다.\n\n` +
      `| | |\n|---|---|\n` +
      `| 연결된 단계 | ${Math.round(coverage * 100)}% |\n` +
      `| 사람이 채워야 하는 것 | ${unmappedCount}건 |\n` +
      `| 조건식 | 전부 비어 있음 |\n` +
      `| 자격증명 | 전부 비어 있음 |\n` +
      `| 단계 사이에 흐르는 데이터 | **정의되어 있지 않음** |\n\n` +
      `무엇을 채워야 하는지는 실행 명세 문서에 있습니다 → \`{{specUrl}}\`\n\n` +
      `**이 노트를 지우기 전에 실행하지 마세요.**`,
    height: 460, width: 520, color: STICKY_COLOR.danger,
  },
  id: 'sticky:draft-warning', name: '⛔ 실행 금지',
  type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 0] as [number, number],
});
```

그리고 UI 문구 — [GRAPH-CORE §10](./GRAPH-CORE.md)이 정한 대로 버튼 이름이 **"n8n으로 내보내기"가 아니다.**

> `자동화팀에 넘길 초안 만들기`

### 9.9 실제 출력 예시 — FIN-02 「세금계산서 끊기」 전문

[SEED D-1](./SEED-CONTENT.md)의 후보를 그대로 내보낸 결과다. 선행 조건 1(홈택스 → 바로빌)이 **적용된 뒤**의 형태다 — 적용 전이라면 발행 노드가 `disabled noop` + 빨간 스티키가 된다.

```json
{
  "name": "[초안] 세금계산서 끊기 — 자동화팀 전달용",
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true,
    "saveExecutionProgress": true,
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "all",
    "executionTimeout": 300,
    "timezone": "Asia/Seoul"
  },
  "staticData": null,
  "pinData": {},
  "tags": [{ "name": "preflow-draft" }, { "name": "not-executable" }],
  "meta": {
    "generatedBy": "preflow",
    "sourceTopologyHash": "t3f9a10c",
    "sourceDocId": "6b1c0f2e-8a44-4f1d-9d3b-2a7e5c0b1a90",
    "exportedAt": "2026-08-17T09:00:00.000Z",
    "specUrl": "https://app.preflow.kr/orgs/acme/specs/fin-02-tax-invoice",
    "coverage": 0.63
  },
  "nodes": [
    {
      "id": "sticky:draft-warning",
      "name": "⛔ 실행 금지",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [-120, -320],
      "parameters": {
        "content": "# ⛔ 이 워크플로는 실행할 수 없습니다\n\n업무 흐름의 **순서와 구조만** 옮긴 초안입니다.\n\n| | |\n|---|---|\n| 연결된 단계 | 63% |\n| 사람이 채워야 하는 것 | 7건 |\n| 조건식 | 전부 비어 있음 |\n| 자격증명 | 전부 비어 있음 |\n| 단계 사이에 흐르는 데이터 | **정의되어 있지 않음** |\n\n무엇을 채워야 하는지는 실행 명세 문서에 있습니다 →\n`https://app.preflow.kr/orgs/acme/specs/fin-02-tax-invoice`\n\n**이 노트를 지우기 전에 실행하지 마세요.**",
        "height": 480,
        "width": 540,
        "color": 3
      }
    },
    {
      "id": "start",
      "name": "수주 확정 (트리거는 직접 정하세요)",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [460, 0],
      "webhookId": "preflow-fin02-entry",
      "parameters": {
        "path": "preflow/fin-02/tax-invoice",
        "httpMethod": "POST",
        "responseMode": "onReceived",
        "options": {}
      },
      "notes": "문서에는 '영업이 수주를 등록하면 시작'이라고 적혀 있습니다.\nERP가 웹훅을 못 보내면 Schedule Trigger + ERP 조회로 바꾸세요.",
      "notesInFlow": true
    },
    {
      "id": "a1e4c2b0-1111-4000-8000-000000000001",
      "name": "수주 정보 확인 (거래처·품목·금액)",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [700, 0],
      "disabled": true,
      "parameters": {},
      "notes": "더존 ERP — n8n 기성 노드가 없습니다.\nDB 직접 조회 또는 파일 내려받기가 현실적입니다. 실행 명세 §7 참조."
    },
    {
      "id": "sticky:erp",
      "name": "메모: ERP 연결",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [660, -230],
      "parameters": {
        "content": "## 🔌 여기가 첫 번째 관문\n\n**더존 ERP**는 Open API가 제한적입니다.\n현실적인 경로 3가지:\n\n1. 읽기 전용 DB 계정 + Postgres/MSSQL 노드\n2. 정기 파일 내보내기 + 폴더 감시\n3. 위하고 Open API 계약\n\n어느 쪽이든 **계정 발급이 선행**입니다.",
        "height": 300,
        "width": 320,
        "color": 5
      }
    },
    {
      "id": "b2f5d3c1-2222-4000-8000-000000000002",
      "name": "신규 거래처인가요?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [940, 0],
      "parameters": {
        "conditions": {
          "options": { "version": 2, "caseSensitive": true, "typeValidation": "strict" },
          "conditions": [],
          "combinator": "and"
        },
        "looseTypeValidation": false
      },
      "notes": "신규 거래처 / 기존 거래처\n조건식은 비어 있습니다. 'ERP에 사업자번호가 있는가'로 채우면 됩니다.",
      "notesInFlow": true
    },
    {
      "id": "c3a6e4d2-3333-4000-8000-000000000003",
      "name": "사업자등록증 요청 메일",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [1180, -160],
      "parameters": {
        "operation": "send",
        "sendTo": "",
        "subject": "",
        "message": "",
        "options": {}
      },
      "credentials": { "gmailOAuth2": { "id": null, "name": "(자격증명 미설정)" } },
      "notes": "받는 사람·제목·본문이 비어 있습니다.\n문서에는 '거래처 담당자에게 메일'로만 적혀 있습니다.",
      "notesInFlow": true
    },
    {
      "id": "d4b7f5e3-4444-4000-8000-000000000004",
      "name": "등록증 회신 기다림",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [1400, -160],
      "webhookId": "preflow-fin02-wait-cert",
      "parameters": {
        "resume": "webhook",
        "httpMethod": "POST",
        "responseMode": "onReceived",
        "options": {}
      },
      "notes": "사람이 처리해야 재개됩니다. 평균 대기 1.5일로 적혀 있습니다.",
      "notesInFlow": true
    },
    {
      "id": "sticky:wait",
      "name": "메모: 회신 대기",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [1360, -400],
      "parameters": {
        "content": "## ✋ 사람을 기다리는 자리\n\n**등록증 회신 기다림**\n\nWait 노드가 재개 URL을 만듭니다.\n그 URL을 **누가 어떻게 호출하는지**는 정해져 있지 않습니다.\n\n문서에 적힌 것:\n- 평균 대기 **1.5일**\n- 3일 지나면 전화로 재촉\n\n**타임아웃 후 처리는 n8n Wait으로 표현할 수 없습니다.**\n별도 Schedule 워크플로가 필요합니다.",
        "height": 340,
        "width": 340,
        "color": 4
      }
    },
    {
      "id": "e5c8a6f4-5555-4000-8000-000000000005",
      "name": "세금계산서 발행 (바로빌)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1640, 0],
      "parameters": {
        "method": "POST",
        "url": "",
        "authentication": "genericCredentialType",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "",
        "options": { "timeout": 30000 }
      },
      "notes": "바로빌 전자세금계산서 발행 API.\nURL·인증키·바디가 비어 있습니다.\n※ 홈택스 직접 발행에서 바로빌로 바꾸는 것이 이 자동화의 선행 조건입니다.",
      "notesInFlow": true,
      "retryOnFail": true,
      "maxTries": 3
    },
    {
      "id": "f6d9b7a5-6666-4000-8000-000000000006",
      "name": "ERP에 매출 전표 입력",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [1880, 0],
      "disabled": true,
      "parameters": {},
      "notes": "더존 ERP — 기성 노드 없음. 위 '수주 정보 확인'과 같은 연결 경로가 필요합니다."
    },
    {
      "id": "a7e0c8b6-7777-4000-8000-000000000007",
      "name": "영업 담당자에게 발행 완료 알림",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [2120, 0],
      "parameters": {
        "resource": "message",
        "operation": "post",
        "select": "channel",
        "channelId": { "__rl": true, "value": "", "mode": "name" },
        "text": "",
        "otherOptions": {}
      },
      "credentials": { "slackApi": { "id": null, "name": "(자격증명 미설정)" } },
      "notes": "채널과 문구가 비어 있습니다.",
      "notesInFlow": true
    },
    {
      "id": "end",
      "name": "끝",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [2360, 0],
      "parameters": {}
    },
    {
      "id": "sticky:human",
      "name": "메모: 사람이 남는 곳",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [1600, 220],
      "parameters": {
        "content": "## 🙋 사람이 계속 하는 일\n\n**발행 전 금액 확인**\n\n문서 작성자가 직접 적은 말:\n> 금액이 맞는지 보는 것. 그건 사람이 해야 합니다.\n\n이 확인 단계를 없애지 마세요.\n승인 UI를 붙이려면 Wait(webhook) + 간단한 확인 페이지가 필요합니다.",
        "height": 280,
        "width": 340,
        "color": 4
      }
    }
  ],
  "connections": {
    "수주 확정 (트리거는 직접 정하세요)": {
      "main": [[{ "node": "수주 정보 확인 (거래처·품목·금액)", "type": "main", "index": 0 }]]
    },
    "수주 정보 확인 (거래처·품목·금액)": {
      "main": [[{ "node": "신규 거래처인가요?", "type": "main", "index": 0 }]]
    },
    "신규 거래처인가요?": {
      "main": [
        [{ "node": "사업자등록증 요청 메일", "type": "main", "index": 0 }],
        [{ "node": "세금계산서 발행 (바로빌)", "type": "main", "index": 0 }]
      ]
    },
    "사업자등록증 요청 메일": {
      "main": [[{ "node": "등록증 회신 기다림", "type": "main", "index": 0 }]]
    },
    "등록증 회신 기다림": {
      "main": [[{ "node": "세금계산서 발행 (바로빌)", "type": "main", "index": 0 }]]
    },
    "세금계산서 발행 (바로빌)": {
      "main": [[{ "node": "ERP에 매출 전표 입력", "type": "main", "index": 0 }]]
    },
    "ERP에 매출 전표 입력": {
      "main": [[{ "node": "영업 담당자에게 발행 완료 알림", "type": "main", "index": 0 }]]
    },
    "영업 담당자에게 발행 완료 알림": {
      "main": [[{ "node": "끝", "type": "main", "index": 0 }]]
    }
  }
}
```

**이 JSON에서 확인할 것 5가지**

1. `active: false` · 이름 `[초안]` · 태그 2개 · 빨간 스티키가 (−120, −320)에 있다
2. 매핑 안 된 두 노드(더존 ERP)가 `disabled: true`다 — 임포트 후 실행해도 아무 일이 없다
3. 모든 `parameters`의 값이 빈 문자열이다. **그럴듯한 기본값을 넣지 않았다**
4. `credentials`의 `id`가 `null`이고 이름이 `(자격증명 미설정)`이다
5. `coverage: 0.63` — 단계 8개 중 3개(ERP 2 + 사람 확인 1)가 매핑 실패

**여기에 없는 것** — 짜증 플래그, 비공개 노트, 담당자 실명, 소요시간, 반려율. [D-062](./DECISIONS.md)가 막는다. 익스포터에 `privateNote`나 `painFlag`가 닿으면 **빌드가 실패**한다.

```ts
// packages/exporters/src/n8n/guard.ts — CI가 이 타입을 검사한다
type ExportSafeNode = Omit<DerivedNode, 'painFlag' | 'assigneeId' | 'effectiveAssigneeId'> & {
  painFlag?: never; assigneeId?: never; effectiveAssigneeId?: never;
};
export function toExportSafe(v: DerivedNode): ExportSafeNode
```

---

## 10. 실행 명세 — n8n JSON보다 앞에 오는 것

[D-011](./DECISIONS.md)이 인용한 BPM 전문가의 지적이 이 절의 존재 이유다.

> *"자동화 후보는 대체로 이미 알고 있습니다. 병목은 발견이 아니라 실행입니다. **'n8n 앞'이 아니라 'n8n 옆'**에 서서, 후보를 실행 가능한 명세로 떨어뜨려 자동화팀에 위임까지 해야 합니다."*

**순서가 중요하다.** 실행 명세가 먼저 나오고 n8n JSON은 그 부록이다. JSON을 먼저 주면 받는 사람이 "일단 임포트해서 돌려보자"를 하고, 그러면 §9의 여섯 겹이 전부 헛수고가 된다.

### 10.1 문서 구조 — 11개 섹션

```ts
// packages/analytics-core/src/spec/types.ts

export type SpecSection =
  | 'summary' | 'trigger' | 'inputs' | 'steps' | 'outputs'
  | 'exceptions' | 'accounts' | 'security' | 'success' | 'rollback' | 'open-questions';

export type AutomationSpec = {
  id: string;
  candidateId: string;
  version: number;
  status: 'draft' | 'handed-over' | 'in-progress' | 'live' | 'dropped';

  summary: Summary;
  trigger: Trigger;
  inputs: InputField[];
  steps: SpecStep[];
  outputs: Output[];
  exceptions: ExceptionRule[];
  accounts: AccountRequirement[];
  security: SecurityNote;
  success: SuccessCriteria;
  rollback: RollbackPlan;
  /** ★ 이 문서의 진짜 산출물. 사람이 답해야 넘어갈 수 있는 것들 */
  openQuestions: OpenQuestion[];

  /** 자동 생성분과 사람 작성분의 비율 — 문서 상단에 표시된다 */
  fillState: { auto: number; human: number; missing: number };
};

export type OpenQuestion = {
  id: string;
  section: SpecSection;
  question: string;
  /** 누가 답할 수 있는가 — 역할로만 적는다 */
  askRole: 'process-owner' | 'it-admin' | 'finance' | 'vendor' | 'legal';
  /** 이게 안 풀리면 착수 자체가 불가능한가 */
  blocking: boolean;
  answer?: string;
  answeredAt?: Date;
};
```

### 10.2 자동으로 채울 수 있는 것 / 사람이 채워야 하는 것

| 섹션 | 자동 | 사람 | 근거 |
|---|---|---|---|
| ① 요약 | ✅ 전부 | — | 후보 스코어·스코프에서 생성 |
| ② 트리거 | ◐ 이벤트 **후보 제시** | 실제 트리거 확정 | 우리는 "영업이 등록하면"까지 안다. ERP가 웹훅을 쏘는지는 모른다 |
| ③ 입력 | ◐ 필드 **이름** (산출물 카탈로그) | 타입·필수여부·샘플·출처 시스템 | 페이로드 스키마가 우리 모델에 없다 |
| ④ 처리 단계 | ✅ 순서·담당·도구·사람/기계 구분 | 각 단계의 실제 동작 | 구조는 우리가 정본 |
| ⑤ 출력 | ◐ 산출물 이름·수신자 역할 | 저장 위치·포맷·보존 | |
| ⑥ 예외 | ✅ 예외율·반려율·분기·타임아웃 | 각 예외의 처리 방법 | 예외의 **존재**는 우리가 안다. **대응**은 모른다 |
| ⑦ 필요 계정·권한 | ✅ 시스템 목록 + 연결 방식 등급 | 계정 종류·발급자·비용·리드타임 | 도구 카탈로그가 절반을 채운다 |
| ⑧ 데이터·보안 등급 | ◐ 개인정보 포함 가능성 힌트 | 등급 확정·법적 검토 | [SECURITY.md](./SECURITY.md) 소관 |
| ⑨ 성공 기준 | ✅ 전부 | 승인만 | §11.3의 사후 검증 훅이 여기서 정의된다 |
| ⑩ 롤백 | ◐ 템플릿 | 실제 절차 | |
| ⑪ 미결 질문 | ✅ 전부 | 답변 | **자동 생성이 핵심.** 무엇을 모르는지를 우리가 안다 |

**미결 질문 자동 생성기** — 이 문서에서 가장 값이 나가는 함수다.

```ts
// packages/analytics-core/src/spec/questions.ts

export function generateOpenQuestions(c: Candidate, ctx: SpecContext): OpenQuestion[] {
  const qs: OpenQuestion[] = [];

  // ① 조건식이 비어 있는 분기마다
  for (const b of ctx.branchesIn(c.scope)) {
    qs.push({
      id: `q:cond:${b.nodeId}`, section: 'trigger', blocking: true, askRole: 'process-owner',
      question: `"${b.labels.join(' / ')}"를 시스템이 어떻게 구분하나요? ` +
                `어느 화면의 어느 값을 보면 알 수 있나요?`,
    });
  }

  // ② 연결 방식이 정해지지 않은 도구마다
  for (const t of ctx.toolsIn(c.scope)) {
    if (t.grade === 'high' && t.n8nNodeType) continue;
    qs.push({
      id: `q:tool:${t.id}`, section: 'accounts', blocking: t.grade === 'low',
      askRole: t.grade === 'low' ? 'process-owner' : 'it-admin',
      question: t.grade === 'low'
        ? `${t.name}은(는) 시스템으로 연결할 방법이 없습니다. ` +
          (t.upgradePath ? `${t.upgradePath.note} 검토가 가능한가요?` : `이 단계를 사람이 계속 할까요?`)
        : `${t.name}에 프로그램으로 접근하려면 어떤 계정·권한이 필요한가요? 누가 발급하나요?`,
    });
  }

  // ③ 사람이 기다리는 자리마다 — 재개를 누가 시키는가
  for (const h of ctx.holdsIn(c.scope)) {
    if (h.waitFor === 'time') continue;
    qs.push({
      id: `q:hold:${h.nodeId}`, section: 'exceptions', blocking: false, askRole: 'process-owner',
      question: `"${h.title}" — 처리가 끝났다는 걸 시스템이 어떻게 아나요?` +
                (h.timeoutH ? ` 그리고 ${h.timeoutH}시간이 지나면 무엇을 하나요?` : ''),
    });
  }

  // ④ 재작업 루프마다 — 무엇을 보고 되돌아가는가
  for (const cy of ctx.cyclesIn(c.scope)) {
    qs.push({
      id: `q:loop:${cy.id}`, section: 'exceptions', blocking: true, askRole: 'process-owner',
      question: `되돌아가는 경우가 있습니다. 무엇이 잘못됐을 때 되돌아가나요? 몇 번까지 다시 하나요?`,
    });
  }

  // ⑤ 단계 사이에 흐르는 데이터 — 언제나 하나는 나온다
  qs.push({
    id: 'q:payload', section: 'inputs', blocking: true, askRole: 'process-owner',
    question: `단계마다 무엇이 넘어가는지가 문서에는 없습니다. ` +
              `첫 단계에서 마지막 단계까지 따라가는 정보 3~5개만 알려주세요.`,
  });

  // ⑥ 개인정보 힌트
  if (ctx.mayContainPii(c.scope)) {
    qs.push({
      id: 'q:pii', section: 'security', blocking: true, askRole: 'legal',
      question: `이 흐름에 개인정보(주민번호·계좌·연락처)가 지나가나요? ` +
                `지나간다면 처리 위탁 계약이 필요할 수 있습니다.`,
    });
  }

  return qs;
}
```

**차단 질문(`blocking: true`)이 하나라도 남아 있으면 명세의 상태가 `handed-over`로 넘어가지 않는다.** 이것이 "위임까지 한다"의 실제 구현이다 — 자동화팀에 넘기는 버튼은 미결 질문이 다 풀려야 눌린다.

### 10.3 실제 예시 — 「세금계산서 발행」 실행 명세

```markdown
# 실행 명세 · 세금계산서 발행 자동화

문서 상태: **초안** · 자동 생성 62% / 사람 작성 24% / 비어 있음 14%
차단 질문 **3건** 남음 — 이게 풀려야 자동화팀에 넘길 수 있습니다.

---

## ① 요약                                                    〔자동 생성〕

수주가 확정되면 거래처·품목·금액이 세금계산서 발행 대기함에 자동으로 들어가고,
담당자는 금액을 확인한 뒤 발행 버튼만 누른다.

| | |
|---|---|
| 현재 | 1건당 45분 · 월 88건 · 발행까지 1.5일 |
| 목표 | 1건당 12분 · 발행까지 0.2일 |
| 연 절감 | **1,390만 원(인시) + 156만 원(리드타임)** · 실수 비용은 미산정 |
| 실행 난이도 | 0.79 — 선행 조건 1건 있음 |
| 신뢰도 | **동료 확인** (3명이 따로 적었고 내용이 비슷함) |
| 되찾는 시간 | 재무 담당 1명 기준 주 5시간 20분 |

> **선행 조건 (이게 진짜 의사결정 사항)**
> 홈택스 직접 발행 → **전자세금계산서 ASP(바로빌) 전환**. 월 3~5만 원.
> 이것 없이는 실행 난이도가 0.79 → **0.55**로 떨어집니다. 공동인증서 때문입니다.

---

## ② 트리거                                                  〔후보 자동 · 확정 사람〕

**후보 A (권장)** — ERP 수주 확정 이벤트 → 웹훅
**후보 B** — 30분마다 ERP 수주 테이블 조회 (신규 행)
**후보 C** — 영업 담당자가 슬랙 워크플로로 직접 발화

| 항목 | 값 |
|---|---|
| 예상 발생 | 월 88건 (근무일 기준 하루 4.2건) |
| 동시 실행 | 있음 — 같은 거래처 2건이 동시에 들어올 수 있음 |
| 중복 방지 키 | ⬜ **수주번호** — 확인 필요 |
| 재실행 안전성 | ⬜ **비어 있음** — 같은 수주번호로 두 번 발행되면 안 됨 |

⛔ **차단 질문 1** — ERP가 수주 확정 시 외부로 알림을 보낼 수 있나요? (→ IT 담당)

---

## ③ 입력                                                    〔이름 자동 · 나머지 사람〕

| 필드 | 출처 | 타입 | 필수 | 샘플 |
|---|---|---|---|---|
| 수주번호 | 더존 ERP | ⬜ | ✅ | ⬜ |
| 거래처명 | 더존 ERP | 문자열 | ✅ | ⬜ |
| 사업자등록번호 | 더존 ERP | ⬜ | ✅ | ⬜ |
| 공급가액 | 더존 ERP | 숫자 | ✅ | ⬜ |
| 세액 | 계산 | 숫자 | ✅ | 공급가액 × 10% |
| 품목 목록 | 더존 ERP | ⬜ | ✅ | ⬜ |
| 담당자 이메일 | ⬜ | 문자열 | ⬜ | ⬜ |

⛔ **차단 질문 2** — 위 필드를 ERP의 어느 테이블·화면에서 가져오나요? (→ IT 담당)

---

## ④ 처리 단계                                               〔자동 생성〕

| # | 단계 | 사람/기계 | 도구 | 현재 소요 |
|---|---|---|---|---|
| 1 | 수주 정보 확인 (거래처·품목·금액) | 🤖 기계 | 더존 ERP | 10분 |
| 2 | 신규 거래처인가 판단 | 🤖 기계 | 더존 ERP | 2분 |
| 3 | (신규만) 사업자등록증 요청 메일 | 🤖 기계 | Gmail | 5분 |
| 4 | (신규만) 등록증 회신 대기 | ⏳ 대기 | 메일 | 평균 1.5일 |
| 5 | **발행 전 금액 확인** | 🙋 **사람** | — | 5분 |
| 6 | 세금계산서 발행 | 🤖 기계 | 바로빌 | 15분 → 자동 |
| 7 | ERP에 매출 전표 입력 | 🤖 기계 | 더존 ERP | 8분 |
| 8 | 영업 담당자에게 완료 알림 | 🤖 기계 | 슬랙 | 2분 |

> **5번은 자동화하지 않습니다.** 문서 작성자가 직접 적은 말:
> *"금액이 맞는지 보는 것. 그건 사람이 해야 합니다."*

---

## ⑤ 출력                                                    〔이름 자동 · 위치 사람〕

| 산출물 | 받는 곳 | 저장 위치 | 보존 |
|---|---|---|---|
| 전자세금계산서 | 거래처 · 국세청 | 바로빌 (+ ⬜ 사내 사본?) | 법정 5년 |
| ERP 매출 전표 | 재무 | 더존 ERP | ERP 정책 |
| 발행 완료 알림 | 영업 담당자 | 슬랙 ⬜ 채널 미정 | — |

---

## ⑥ 예외 처리                                               〔존재 자동 · 대응 사람〕

| 예외 | 빈도 (문서 기준) | 대응 |
|---|---|---|
| 사업자등록증 회신이 안 옴 | 신규 거래처의 약 30% | ⬜ 3일 뒤 전화 (현재 사람이 함) |
| 금액이 수주와 다름 | 10번 중 2번 | ⬜ **비어 있음** |
| 발행 후 오류 발견 | 월 1~2건 | ⬜ 수정 발행 — 별도 흐름 |
| 바로빌 API 실패 | 미지 | ⬜ 3회 재시도 후 ⬜ ? |
| 국세청 시스템 점검 시간 | 매일 새벽 | ⬜ 큐에 넣고 재시도 |

⛔ **차단 질문 3** — 금액이 수주와 다를 때 지금은 어떻게 하시나요? (→ 프로세스 소유자)

---

## ⑦ 필요한 계정과 권한                                      〔목록 자동 · 상세 사람〕

| 시스템 | 연결 방식 | 필요한 것 | 발급자 | 비용 | 리드타임 |
|---|---|---|---|---|---|
| 바로빌 | **API (공개)** | API 키 + 인증서 등록 | 재무 팀장 | 월 3~5만 원 | ⬜ |
| 더존 ERP | **DB 직접 / 파일** | 읽기 계정 or 위하고 Open API 계약 | IT | ⬜ | ⬜ **2~4주 예상** |
| Gmail | **OAuth** | 발송 전용 계정 | IT | 없음 | 1일 |
| 슬랙 | **Bot Token** | `chat:write` | IT | 없음 | 1일 |
| n8n | 자체 호스팅 | 서버 + 도메인 | IT | ⬜ | ⬜ |

> 🔺 **가장 긴 리드타임이 더존 ERP 접근입니다.** 여기서 막히면 나머지가 다 준비돼도 못 돕니다.
> 이 항목부터 시작하세요.

---

## ⑧ 데이터·보안                                             〔힌트 자동 · 확정 사람〕

- 거래처 사업자등록번호·담당자 연락처가 지나갑니다 → **개인정보 해당 가능**
- ⬜ 처리 위탁 계약 필요 여부 확인 (→ 법무)
- ⬜ n8n 실행 로그에 금액·사업자번호가 남습니다. 보존 기간 설정 필요
- 세금계산서 원본은 바로빌에 있으므로 n8n에 사본을 남기지 않습니다

---

## ⑨ 성공 기준과 측정 방법                                    〔자동 생성〕

| 기준 | 현재(기준선) | 목표 | 측정 방법 | 시점 |
|---|---|---|---|---|
| 1건당 사람 시간 | 45분 (자가추정) | 12분 | **"했음" 카운터 2주 재측정** | 착수 4주 후 |
| 발행 리드타임 | 1.5일 | 0.2일 | 바로빌 발행 시각 − 수주 확정 시각 | 착수 4주 후 |
| 자동 처리 비율 | 0% | 70% | n8n 실행 성공 / 전체 발생 | 착수 12주 후 |
| 실수(수정 발행) | 월 1~2건 | 월 0~1건 | ERP 수정 전표 건수 | 착수 12주 후 |

> **기준선은 착수 전 2주간 실측으로 고정합니다.** 착수 후에 기준선을 잡으면
> 절감을 증명할 수 없습니다. (§11.3)

---

## ⑩ 롤백                                                    〔템플릿 자동〕

1. n8n 워크플로 비활성화 (`active: false`)
2. 대기 중인 실행 큐 확인 — 발행 중간에 멈춘 건이 있는지
3. 수동 절차로 복귀 — 기존 홈택스 발행 순서 (문서 원본 그대로 남아 있음)
4. ⬜ 복귀 판단 기준: 연속 ⬜건 실패 시

---

## ⑪ 미결 질문

| # | 질문 | 누구에게 | 차단 | 답변 |
|---|---|---|---|---|
| 1 | ERP가 수주 확정 시 외부 알림을 보낼 수 있나요? | IT | ⛔ | |
| 2 | 위 입력 필드를 ERP 어디서 가져오나요? | IT | ⛔ | |
| 3 | 금액이 수주와 다를 때 지금은 어떻게 하시나요? | 프로세스 소유자 | ⛔ | |
| 4 | 발행 완료 알림은 어느 슬랙 채널로 갈까요? | 프로세스 소유자 | | |
| 5 | 바로빌 전환 결재는 누가 올리나요? | 재무 팀장 | | |
| 6 | n8n 서버는 어디에 두나요? | IT | | |
| 7 | 개인정보 처리 위탁 검토가 필요한가요? | 법무 | | |

---

### 첨부

- n8n 초안 JSON (`[초안] 세금계산서 끊기 — 자동화팀 전달용`) — **실행 불가 상태**
- 원본 업무 흐름 문서 (읽기 전용 링크, 30일 만료)
- 근거가 된 계산 (Value·Feasibility·Confidence 분해)
```

### 10.4 명세 문서의 수명주기

```
draft ──(차단 질문 0건)──▶ handed-over ──▶ in-progress ──▶ live
  │                                                          │
  └──────────────── dropped ◀────────────────────────────────┘
                                                             ▼
                                             §11.3 사후 검증이 여기서 시작된다
```

`live`로 넘어간 순간 **§11.3의 실현율 측정이 자동으로 예약된다** — 4주 후와 12주 후. 이것이 "발견 툴"과 "실행 툴"을 가르는 지점이다.

---

## 11. 계산 정확도와 반증

### 11.1 이 숫자를 얼마나 믿을 수 있다고 말할 것인가

**정직한 대답: 순위는 대체로 맞고, 금액은 2배 안팎으로 틀린다.**

오차 원천을 분해하면 이렇다.

| 항 | 오차 크기 | 방향 | 근거 |
|---|---|---|---|
| `T_touch` (밴드) | **±1밴드 = 2~4배** | 짧은 건 과대, 긴 건 과소 | [PRD §4.7](./PRD.md) 압축 왜곡 ±100~300% |
| `F` (7일 회상) | ±40% | 주 단위 변동 + 회상 편향 | |
| `F` (주기 유도) | ±20% | 비교적 안정 | |
| `N_people` | −50% ~ +100% | 실측은 과소, 자기보고는 과대 | 작성률 40% 상한 |
| `SaveRate` | ±0.15 (절대) | 추론 규칙의 한계 | §2.4 |
| `Feasibility` | ±0.15 | 6항 중 2항이 추정 | §3.6 |
| `Rate` (단가) | 조직 설정 | — | 오차 아님 |
| **`Value` 합성** | **P10 ≈ 0.4×P50, P90 ≈ 2.5×P50** | — | 곱셈 4항의 로그정규 합성 |

**그래서 이렇게 말한다.**

> ✅ *"이 셋이 상위권이라는 것은 꽤 확실합니다. 1위와 2위 중 어느 것이 먼저인지는 확실하지 않습니다.
>    금액은 2배 안팎으로 틀릴 수 있고, 아래쪽 숫자를 기준으로 판단하시길 권합니다."*

> ❌ *"연 1,782만 원을 절감할 수 있습니다."*

**순위가 금액보다 정확한 이유** — 오차가 후보들 사이에 **공통으로** 걸리기 때문이다. 조직 전체가 시간을 1.5배 부풀려 적으면 모든 후보의 Value가 1.5배가 되고 순위는 그대로다. 순위를 뒤집는 것은 **후보마다 다른 방향으로 걸리는 오차**뿐이고, 그 대표가 §2.2의 빈도 불일치다. 그래서 빈도 불일치를 실측 승격 큐 최상단에 두는 것이다.

### 11.2 불확실성을 어떻게 계산하고 표기하는가

```ts
// packages/analytics-core/src/uncertainty.ts

/**
 * 결정적 몬테카를로. Math.random을 쓰지 않는다 —
 * 같은 입력에 같은 구간이 나와야 골든 픽스처가 성립하고,
 * 리포트를 두 번 열었을 때 숫자가 흔들리지 않는다.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Uncertain =
  /** 밴드 → 로그균등. 밴드 안에서는 어디든 똑같이 그럴듯하다 */
  | { kind: 'log-uniform'; lo: number; hi: number }
  /** 계수 추정 → 삼각분포 */
  | { kind: 'triangular'; lo: number; mode: number; hi: number }
  /** 실측 → 상수 */
  | { kind: 'fixed'; value: number };

function sample(u: Uncertain, r: () => number): number {
  switch (u.kind) {
    case 'fixed': return u.value;
    case 'log-uniform': {
      const a = Math.log(u.lo), b = Math.log(u.hi);
      return Math.exp(a + (b - a) * r());
    }
    case 'triangular': {
      const { lo, mode, hi } = u;
      const c = (mode - lo) / (hi - lo), x = r();
      return x < c
        ? lo + Math.sqrt(x * (hi - lo) * (mode - lo))
        : hi - Math.sqrt((1 - x) * (hi - lo) * (hi - mode));
    }
  }
}

export type ValueModel = {
  touchH: Uncertain;
  eventsPerYear: Uncertain;
  saveRate: Uncertain;
  rateKrwPerH: Uncertain;       // 보통 fixed
  leadTimeKrw: Uncertain | null;
  riskKrw: Uncertain | null;
};

export const MC_ITERATIONS = 4000;

export function simulateValue(m: ValueModel, seedKey: string): Interval {
  const r = mulberry32(hash32(seedKey));      // 후보 ID로 시드 → 재현 가능
  const out = new Float64Array(MC_ITERATIONS);
  for (let i = 0; i < MC_ITERATIONS; i++) {
    const labor = sample(m.touchH, r) * sample(m.eventsPerYear, r)
                * sample(m.saveRate, r) * sample(m.rateKrwPerH, r);
    const lead = m.leadTimeKrw ? sample(m.leadTimeKrw, r) : 0;
    const risk = m.riskKrw ? sample(m.riskKrw, r) : 0;
    out[i] = labor + lead + risk;
  }
  out.sort();
  return {
    p10: out[Math.floor(MC_ITERATIONS * 0.10)],
    p50: out[Math.floor(MC_ITERATIONS * 0.50)],
    p90: out[Math.floor(MC_ITERATIONS * 0.90)],
  };
}
```

**밴드를 로그균등으로 두는 이유** — `halfday`는 "2~6시간 중 어디든"이지 "4시간을 중심으로 정규분포"가 아니다. 로그 스케일 밴드에는 로그 스케일 분포가 맞다.

#### 표기 규칙 5개

```ts
// packages/analytics-core/src/format/money.ts

/** ① 유효숫자 2자리. "17,820,000원"은 정밀함을 가장한 거짓말이다 */
export function fmtKrw(v: number): string {
  if (v >= 100_000_000) return `${round2(v / 100_000_000)}억 원`;
  if (v >= 10_000)      return `${Math.round(v / 10_000 / 10) * 10}만 원`;
  return `${Math.round(v / 1000) * 1000}원`;
}

/** ② 구간이 기본형. 점 추정 단독 출력 함수를 만들지 않는다 */
export function fmtInterval(iv: Interval): string {
  return `${fmtKrw(iv.p10)} ~ ${fmtKrw(iv.p90)}`;
}

/** ③ 미산정 항이 있으면 "이상"을 붙인다 */
export function fmtTotal(iv: Interval, unpriced: readonly string[]): string {
  return unpriced.length > 0 ? `${fmtInterval(iv)} 이상` : fmtInterval(iv);
}
```

④ **커버리지 배지**를 항상 함께 낸다.

| coverage | 배지 | 문구 |
|---|---|---|
| ≥ 0.8 | (없음) | — |
| 0.5 ~ 0.8 | `일부 추정` | `시간과 횟수 중 일부는 추정값이에요` |
| < 0.5 | `대부분 추정` | `아직 채워지지 않은 항목이 많아요` |

⑤ **후보들의 상한을 더해서 총합을 만들지 않는다.** 이것이 이 절에서 가장 자주 깨질 규칙이다.

```ts
/**
 * ❌ 금지 — 후보별 p90을 더하면 "조직 전체 연 3억 절감"이 만들어진다.
 *    독립 가정이 틀리고(같은 사람의 시간이 여러 후보에 중복), 상한의 합은 상한이 아니다.
 * ✅ 총합은 시뮬레이션 층위에서 한 번에 낸다. 그리고 중복 시간을 뺀다.
 */
export function portfolioValue(cands: readonly Candidate[], seedKey: string): Interval {
  const r = mulberry32(hash32(seedKey));
  const out = new Float64Array(MC_ITERATIONS);
  for (let i = 0; i < MC_ITERATIONS; i++) {
    // 같은 itemId가 두 후보의 스코프에 들어 있으면 한 번만 센다
    const claimed = new Set<string>();
    let sum = 0;
    for (const c of cands) {
      const fresh = c.scopeItemIds.filter((id) => !claimed.has(id));
      if (fresh.length === 0) continue;
      fresh.forEach((id) => claimed.add(id));
      sum += sampleOnce(c.model, r) * (fresh.length / c.scopeItemIds.length);
    }
    out[i] = sum;
  }
  out.sort();
  return { p10: out[400], p50: out[2000], p90: out[3600] };
}
```

### 11.3 사후 검증 — 자동화 후 실제 절감을 어떻게 재는가

**기준선을 착수 전에 고정하지 않으면 아무것도 증명할 수 없다.** 이것이 사후 검증의 90%다.

```ts
// packages/analytics-core/src/verify/realization.ts

export type VerificationPlan = {
  candidateId: string;
  /** ① 착수 전 2주 — "했음" 카운터 강제. 이게 없으면 착수 승인이 안 난다 */
  baseline: { startOn: Date; endOn: Date; measured?: MeasuredBaseline };
  /** ② 착수 후 4주 — 조기 신호 */
  early: { dueOn: Date; result?: Measurement };
  /** ③ 착수 후 12주 — 정본 */
  final: { dueOn: Date; result?: Measurement };
};

export type Measurement = {
  /** 사람 시간 — 같은 "했음" 카운터를 같은 사람에게 다시 돌린다 */
  touchHPerEvent: number | null;
  /** 리드타임 — 시스템 타임스탬프가 있으면 실측, 없으면 카운터 */
  leadTimeH: number | null;
  eventsPerMonth: number;
  /** 자동으로 처리된 비율 (n8n 실행 성공 / 총 발생) */
  automatedRatio: number | null;
  source: 'counter' | 'system-log' | 'mixed';
};

export type Realization = {
  predictedKrw: number;
  actualKrw: number;
  /** 실현율 = 실제 / 예측 */
  ratio: number;
  /** 어디서 어긋났는가 — 이게 다음 예측을 고친다 */
  attribution: {
    touchDelta: number;      // 시간 추정이 틀린 정도
    freqDelta: number;       // 빈도 추정이 틀린 정도
    adoptionDelta: number;   // ★ 만들었는데 안 쓴 정도
  };
};
```

**`adoptionDelta`가 가장 크게 나온다.** 자동화가 기술적으로 동작해도 사람들이 예전 방식을 병행하면 절감은 0이다. 이것을 "예측이 틀렸다"로 처리하면 영원히 계수만 깎게 된다. **분리해서 기록한다.**

**조직 실현율 곡선** — 검증이 3건 이상 쌓이면 조직의 실현율 중앙값이 나온다. 이 값을 **다음 예측의 할인율**로 붙인다.

```ts
export const INITIAL_REALIZATION_DISCOUNT = 0.6;   // 산업 통념. 첫 3건까지의 기본값

export function realizationDiscount(history: readonly Realization[]): { factor: number; note: string } {
  if (history.length < 3) {
    return { factor: INITIAL_REALIZATION_DISCOUNT,
             note: '아직 검증된 사례가 없어 일반적인 실현율(60%)을 적용했어요' };
  }
  const r = median(history.map((h) => h.ratio));
  return { factor: clamp(r, 0.3, 1.2),
           note: `이 조직에서 실제로 실현된 비율(${Math.round(r * 100)}%)을 적용했어요 · 검증 ${history.length}건` };
}
```

**이 할인율은 리포트에 별도 줄로 나간다.** 조용히 곱하면 안 된다.

```
예상 절감      1,100만 ~ 2,600만 원/년
실현율 반영     660만 ~ 1,560만 원/년   ← 이 조직 실현율 60% 적용 (검증 4건)
```

### 11.4 틀렸을 때의 비용 — 경영진에게 잘못된 숫자를 준 결과

시나리오 네 개다. 심각도 순서다.

#### ① 과대 추정 → 인력 계획 → 되돌릴 수 없다

*"연 4,000시간 절감"* → 경영진이 인원 2명분으로 환산 → 채용 동결 또는 감축 → 자동화는 예상의 40%만 실현 → **남은 사람들이 무너진다.**

이 시나리오의 비용은 회사에 대해서도 크지만, **제품에 대해서는 치명적이다.** 한 번 "이 도구 때문에 사람이 잘렸다"가 되면 아무도 다시 기록하지 않는다. [D-002](./DECISIONS.md)가 막으려는 것과 정확히 같은 종류의 죽음이다.

**방어 4겹**

```ts
// packages/analytics-core/src/format/forbidden.ts

/** ★ D-091. 이 함수들은 존재하지 않는다. 만들자는 요청이 반드시 온다 */
// export function headcountEquivalent(hours: number): number   ← 만들지 않는다
// export function fteReduction(...)                            ← 만들지 않는다

/** 대신 이것만 있다 */
export function timeReclaimedCopy(hours: number): string {
  return `연 ${Math.round(hours)}시간 — 사람들이 다른 일에 쓸 수 있는 시간이에요`;
}

/** 리포트 렌더 직전 검사. 금지 표현이 들어가면 렌더가 실패한다 */
const FORBIDDEN_PATTERNS = [
  /\d+\s*명\s*(분|감축|절감|축소|대체)/,
  /인력\s*(감축|절감|축소|재배치)/,
  /FTE/i, /헤드카운트/, /인건비\s*절감/,
];
export function assertNoHeadcountClaim(text: string): void {
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(text)) throw new Error(`금지 표현: ${p} — D-091`);
  }
}
```

1. 금지 표현 검사 (위)
2. 시간 → 인원 환산 함수 부재
3. 리포트 고정 각주: `이 시간은 없애는 시간이 아니라 옮기는 시간입니다.`
4. **하한(P10)으로 정렬하고 하한을 의사결정 기준으로 제시** (D-090)

#### ② 과소 추정 → 좋은 후보가 사라진다

리드타임 가치를 미산정으로 두면 [SEED D-2](./SEED-CONTENT.md) 유형(인시 79만 원 / 실제 428만 원)이 조용히 순위에서 빠진다. **조용히 빠지는 것이 문제다** — 아무도 그 후보가 있었다는 걸 모른다.

**방어**: 미산정 항이 있는 후보는 별도 목록으로 **항상 함께 나간다**.

```
계산이 덜 된 후보 3건
  이 후보들은 인시 절감으로는 작지만, 리드타임 가치를 아직 계산하지 않았어요.
  건당 금액이나 대기 인원을 넣으면 순위가 바뀔 수 있어요.
```

#### ③ 순위 오류 → 예산이 두 번째로 좋은 후보에 간다

가장 흔하고 가장 덜 심각하다. 1위와 2위가 바뀌어도 둘 다 좋은 후보다.

**방어**: 상위 5개는 **순위를 매기지 않고 묶어서** 보여준다. 6위부터 순위가 있다. 1~5위 사이의 순서 차이는 우리 정밀도 밖이라는 것을 화면 구조로 말한다.

#### ④ 특정 부서 과대 → 정치적 공격

*"영업팀은 낭비가 많다"*로 읽히는 리포트는 그 부서가 문서를 안 쓰게 만들고, 다음 분기엔 그 부서 데이터가 없어서 리포트가 반쪽이 된다.

**방어**: [POLICY §5.2](./POLICY.md)의 규칙을 후보 카드에도 그대로 적용한다 — **주어를 부서로 두지 않는다.** 후보의 `execCopy.headline`은 "○○팀이 …"로 시작할 수 없고, 이것은 §5.0의 타입 주석이 아니라 렌더 시점의 검사다.

```ts
const DEPT_SUBJECT = /^[가-힣A-Za-z]+(팀|부서|본부|파트)(이|가|은|는)\s/;
export function assertNoDeptSubject(headline: string): void {
  if (DEPT_SUBJECT.test(headline)) throw new Error(`부서를 주어로 쓸 수 없다 — POLICY §5.2`);
}
```

### 11.5 이 엔진이 스스로를 반증하는 방법

**분기마다 한 번, "지난 분기 예측이 얼마나 맞았는가"를 리포트 첫 장에 싣는다.** 숨기지 않는다.

```
지난 분기에 우리가 한 말이 얼마나 맞았나요

  착수한 자동화 3건
    세금계산서 발행     예상 1,390만 → 실제 980만   (71%)
    배송 조회 응답      예상 1,150만 → 실제 1,320만 (115%)
    입사자 계정 준비    예상 79만  → 실제 미측정    (측정 실패 — 월 3건이라 표본 부족)

  이번 분기 예측에는 실현율 71%가 반영되어 있습니다.
```

**측정 실패도 그대로 적는다.** 이 표가 예뻐지는 순간 아무도 안 믿는다.

---

## 12. 구현 구조

### 12.1 패키지 분할

```
packages/
  graph-core/              [기존] 런타임 의존성 0 · 순수
    src/
      export/n8n.ts        toN8n() — 구조 변환만. 조직을 모른다
      matching/            [ASSEMBLY 소관] ko.ts · infer.ts · types.ts
      analytics/schema.ts  이벤트 zod .strict() 스키마

  analytics-core/          ★ 신설. 런타임 의존성 0 · 순수 · DOM/Node 없음
    src/
      index.ts             공개 API 배럴
      types.ts             ToolCatalog · DocMeta · Volume · Measure 확장
      features/
        touch.ts           BAND_RANGE_H · scopeTouchH
        frequency.ts       resolveFrequency
        people.ts          resolveNPeople
        volume.ts          Volume 판별 유니온 (D-084)
        save-rate.ts       inferSaveRate (D-085)
      scoring/
        feasibility.ts     6요소 조립 + 캡
        determinism.ts · input-structure.ts · system-access.ts
        exception.ts · standardization.ts · stability.ts
        lead-time.ts · risk.ts
        value.ts           Value 조립 + ValueBreakdown
      ecrs/
        types.ts · e1..e12 · registry.ts · rollup.ts
      group/
        key.ts · cluster.ts · aggregate.ts · variability.ts
      confidence/
        index.ts · peer.ts · counter.ts
      calibration.ts
      uncertainty.ts       mulberry32 · simulateValue · portfolioValue
      spec/
        types.ts · questions.ts · render.ts
      report/
        employee.ts · exec.ts
      format/
        money.ts · forbidden.ts     ← 금지 표현 검사
      __fixtures__/
        golden.ts          ★ 골든 픽스처

  exporters/               ★ 신설. graph-core + analytics-core에 의존
    src/
      n8n/
        schema.ts · draft.ts · branch.ts · hold.ts · cycle.ts
        unmapped.ts · guard.ts · layout.ts
      spec/markdown.ts     실행 명세 → Markdown/PDF
      index.ts

  analytics-jobs/          ★ 신설. 유일하게 DB를 아는 층
    src/
      runner.ts            SELECT ... FOR UPDATE SKIP LOCKED
      l1-snapshot.ts · l2-features.ts · l3-group.ts
      l4-aggregate.ts · l5-candidates.ts · l6-report.ts
      gates/k-anon.ts      ★ 모든 관리자 출력이 통과하는 단일 관문
      db/queries.ts
```

### 12.2 의존 방향 — 한 방향으로만

```
analytics-jobs ──▶ exporters ──▶ analytics-core ──▶ graph-core
      │                              ▲
      └──────────────────────────────┘
```

| 규칙 | 강제 수단 |
|---|---|
| `analytics-core`는 DB·React·DOM·Node를 모른다 | `tsconfig`의 `lib: ["ES2022"]` + `types: []` · `dependencies: {}` |
| `analytics-core`는 `Date.now()` / `Math.random()` 금지 | ESLint `no-restricted-globals` — 시각은 인자로, 난수는 시드로 |
| `graph-core`가 `analytics-core`를 import 하면 빌드 실패 | ESLint `no-restricted-imports` |
| `exporters`에 `painFlag` / `privateNote` / `assigneeId`가 닿으면 빌드 실패 | `ExportSafeNode` 타입 + CI 타입 검사 (D-062) |
| 관리자 출력이 `gates/k-anon.ts`를 우회하면 빌드 실패 | ESLint 커스텀 룰: `candidates` 테이블 직접 SELECT 금지 (뷰 경유만) |

**`graph-core`와의 경계 세 줄**

1. **그래프에 대한 질문은 graph-core가 답한다.** 시간 DP, 확률, 사이클, 인계, 병렬. `analytics-core`는 `perNode`를 읽을 뿐 다시 계산하지 않는다.
2. **조직에 대한 질문은 analytics-core가 답한다.** 도구 카탈로그, 프로세스 그룹, 스코어, 후보.
3. **둘 다 순수하다.** 차이는 "무엇을 아는가"이지 "어떻게 실행되는가"가 아니다.

### 12.3 실시간 vs 배치 — 어디에 무엇을 두는가

| | 실시간 (요청 안에서) | 배치 (야간) |
|---|---|---|
| 계산 | `derive()` · L2 특징 추출 · 개인 리포트 | 그룹핑 · 집계 · 후보 · 경영진 리포트 |
| 예산 | **문서 1개 100ms** | **조직 1개 5분** (ASSEMBLY §11-9와 같은 예산) |
| 실패 시 | 화면에 이전 값 유지 (에러 표시 없음) | 재시도 3회 → 알림 → 이전 스냅샷 유지 |
| 결정성 | 필수 | 필수 |

**L2를 실시간에 두는 것이 이 설계의 핵심 선택이다.** 특징 추출은 문서 하나 안에서 닫혀 있어서 O(단계 수)이고, 100ms 예산 안에 든다. 여기를 배치로 미루면 "3분만 더 쓰면 알려드릴게요"가 거짓말이 된다.

**5분 예산을 지키는 법** — 그룹핑이 유일한 O(n²) 구간이다. ASSEMBLY의 블로킹과 같은 방식을 쓴다: 제목 정규화 bigram으로 블록을 만들고, 블록 크기 상한 2,000, 문서당 후보 상한 300. 조직 1,000문서에서 실측 예상 40~90초.

### 12.4 테스트 전략

```
packages/analytics-core/test/
  golden.test.ts        ★ 골든 픽스처 — 아래 §12.5
  invariants.test.ts    불변식 18건
  fuzz-kanon.test.ts    k-익명성 퍼즈 (MEASUREMENT §3의 CI 게이트를 후보까지 확장)
  formatting.test.ts    금지 표현 · 부서 주어 · 유효숫자
packages/exporters/test/
  n8n-schema.test.ts    출력 JSON이 n8n 스키마를 만족하는가 (실제 n8n 임포트 스모크 포함)
  n8n-golden.test.ts    픽스처 → JSON 전문 비교
  leak.test.ts          짜증·비공개·실명이 출력에 없는가
```

**불변식 18건** — 픽스처보다 오래 사는 테스트다.

| # | 불변식 |
|---|---|
| 1 | `BAND_HOURS[b] ∈ BAND_RANGE_H[b]` — 모든 밴드 |
| 2 | `monthlyEvents(volume)`를 거치지 않고 `nPeople`이 곱해지는 경로가 없다 (AST 검사) |
| 3 | `Feasibility ≤ 0.5` — 캡 도구가 하나라도 있으면 |
| 4 | `Feasibility ∈ [0, 1]`, 6요소 각각 `∈ [0, 1]` |
| 5 | 단조성: `T_touch`를 늘리면 `Value`가 줄지 않는다 |
| 6 | 단조성: `SaveRate`를 낮추면 `Value`가 늘지 않는다 |
| 7 | 어떤 항도 coverage 0인데 value ≠ 중립값이 아니다 |
| 8 | ECRS가 랭킹보다 먼저 돈다 (제거 판정된 노드는 자동화 후보 스코프에 없다) |
| 9 | 같은 `itemId`가 두 후보 스코프에 있으면 `portfolioValue`가 한 번만 센다 |
| 10 | `contributorCount < 5`인 후보는 `adminVisible()` false |
| 11 | 5인 미만 후보도 소유자 개인 리포트에는 나온다 |
| 12 | `simulateValue`가 같은 시드에 같은 결과 (2회 호출 비교) |
| 13 | `p10 ≤ p50 ≤ p90` |
| 14 | 리포트 문자열에 금지 표현(D-091)이 없다 |
| 15 | `execCopy.headline`이 부서를 주어로 쓰지 않는다 |
| 16 | n8n 출력의 `active`가 언제나 `false` |
| 17 | n8n 출력에 `painFlag`·`assigneeId`·`privateNote` 파생 문자열이 없다 |
| 18 | 매핑 실패 노드가 전부 `disabled: true` |

**k-익명성 퍼즈** — [MEASUREMENT §3](./MEASUREMENT.md)의 10만 조합 테스트를 후보 테이블까지 확장한다. 생성된 조직(부서 3~12개, 인원 4~200명, 문서 0~500개)에 대해 **관리자 경로로 나가는 모든 출력**을 수집하고, `contributor_n < 5`인 셀이 하나라도 있으면 실패. **파일럿 킥오프 게이트다** — 미통과 시 파일럿을 중단한다.

### 12.5 골든 픽스처 — 정답지가 이미 문서에 있다

**[SEED-CONTENT §D](./SEED-CONTENT.md)의 후보 5건이 골든 픽스처다.** 이 문서를 사람이 손으로 계산해서 적었고, 엔진이 같은 숫자를 내야 한다. 이보다 좋은 회귀 테스트는 없다.

```ts
// packages/analytics-core/src/__fixtures__/golden.ts

export type GoldenCase = {
  id: string;
  label: string;
  input: { items: Item[]; edges: Edge[]; doc: DocMeta; answers: PromptAnswers; group?: GroupFixture };
  expect: {
    value?: { laborKrw: number; leadTimeKrw: number | null; riskKrw: number | null; tolerance: number };
    feasibility?: { score: number; factors: Partial<Record<keyof typeof F_WEIGHTS, number>>; tolerance: number };
    confidence?: number;
    ecrs?: { patternId: string; nodeCount: number }[];
    capped?: boolean;
  };
};

export const GOLDEN: readonly GoldenCase[] = [
  // ── A. SEED §D의 5건 (정답지가 문서에 있다) ──────────────────────────
  { id: 'D-1', label: '세금계산서 발행',
    expect: { value: { laborKrw: 13_860_000, leadTimeKrw: 1_560_000, riskKrw: 2_400_000, tolerance: 0.1 },
              feasibility: { score: 0.81, factors: { determinism: 0.90, systemAccess: 0.70 }, tolerance: 0.05 },
              confidence: 0.75 } },
  { id: 'D-2', label: '신규 입사자 계정·장비 — 리드타임이 인시의 3.4배',
    expect: { value: { laborKrw: 787_500, leadTimeKrw: 2_700_000, riskKrw: 800_000, tolerance: 0.1 },
              feasibility: { score: 0.78, factors: {}, tolerance: 0.05 }, confidence: 0.6 } },
  { id: 'D-3', label: '배송 조회 자동 응답 — 유일하게 실측 가능',
    expect: { value: { laborKrw: 11_451_300, leadTimeKrw: 3_435_000, riskKrw: 1_920_000, tolerance: 0.1 },
              feasibility: { score: 0.83, factors: { determinism: 0.95 }, tolerance: 0.05 },
              confidence: 0.9 } },
  { id: 'X-1', label: 'ECRS 제거 — 반려율 0% 팀장 결재',
    expect: { ecrs: [{ patternId: 'E1', nodeCount: 1 }] } },
  { id: 'X-2', label: 'ECRS 재배치 — 카드 증빙 회신·취합·독촉',
    expect: { ecrs: [{ patternId: 'E11', nodeCount: 1 }, { patternId: 'E7', nodeCount: 1 }] } },

  // ── B. 검출기별 최소 픽스처 (E1~E12 각 1건) ─────────────────────────
  // ── C. 경계 케이스 ──────────────────────────────────────────────────
  { id: 'B-01', label: '공동인증서가 붙은 단계 → Feasibility 캡 0.5', expect: { capped: true } },
  { id: 'B-02', label: '월마감 + freqLast7d=0 → cadence 채택 (D-086)' },
  { id: 'B-03', label: 'freqLast7d와 cadence가 4배 불일치 → 낮은 쪽 + 실측 큐' },
  { id: 'B-04', label: '조직 합계 F에 N_people을 곱하지 않는다 (D-084)' },
  { id: 'B-05', label: '기여자 1명 → 표준화 0.5 / coverage 0' },
  { id: 'B-06', label: 'fork 형제 3개 → 동료 합의 성립하지 않음' },
  { id: 'B-07', label: '남의 문서를 본 사람은 독립 기여자가 아니다' },
  { id: 'B-08', label: '예외 프롬프트 미응답 → prior 사용, 0 아님' },
  { id: 'B-09', label: '반려율 0 응답 + 재질문 없음 → 신뢰하지 않음' },
  { id: 'B-10', label: 'RiskValue 미산정 → null이 끝까지 전파, 합계에 "이상"' },
  { id: 'B-11', label: 'AND 분기가 있는 후보 → n8n notes에 순차 실행 경고' },
  { id: 'B-12', label: '사이클이 있는 후보 → 가드 IF + coverage 하락' },
  { id: 'B-13', label: '기여자 4명 → 관리자 비노출, 소유자 개인 리포트에는 노출' },
  { id: 'B-14', label: '기여자 4→5명 증가 → 다음 배치에서 자동 승격' },
];
```

**픽스처 운영 규칙 3가지**

1. **SEED §D의 숫자가 바뀌면 코드가 아니라 문서를 먼저 고친다.** 그 숫자는 사람이 검증한 값이고, 엔진이 다르면 엔진이 틀렸다고 가정한다.
2. **허용 오차는 10%다.** 그보다 좁히면 무의미한 실패가 나고(§11.1의 정밀도 한계), 넓히면 회귀를 못 잡는다.
3. **n8n 골든은 JSON 전문 비교다.** 노드 순서·이름·좌표까지 고정한다. 좌표가 흔들리면 diff가 무의미해지고 diff가 무의미해지면 아무도 안 본다.

### 12.6 무엇을 언제 만드는가

| 단계 | 범위 | 선행 |
|---|---|---|
| **1** | `analytics-core/features` + `scoring` + 골든 A·C | graph-core (완료) |
| **2** | `ecrs` E1·E4·E5 (개발 0줄 후보 3종) + 개인 리포트 | 1 |
| **3** | `analytics-jobs` L1·L2 + 개인 리포트 실시간 경로 | 2 · M1 저장 |
| **4** | `group` + `confidence/peer` + k-anon 게이트 + 경영진 리포트 | 3 · M2 메타데이터 FK |
| **5** | `confidence/counter` 실측 승격 + `calibration` | 4 · 슬랙 연동 |
| **6** | `spec` 실행 명세 | 5 |
| **7** | `exporters/n8n` | 6 · D-011 해제 |

**2단계에서 이미 팔 것이 나온다** — E1·E4·E5는 그룹핑도 실측도 필요 없다. [SEED §D-4](./SEED-CONTENT.md)가 말한 *"도입 킥오프에서 이 두 개를 먼저 보여줄 것"*이 2단계의 산출물이다.

---

## 13. 미해결 · 다음에 결정할 것

| # | 항목 | 언제 |
|---|---|---|
| 1 | **갈래별 확률 필드** — 지금 XOR은 균등 1/k다. §3.1의 규칙결정성과 §5의 E9(죽은 갈래)가 둘 다 이 값을 원한다. [GRAPH-CORE §13-1](./GRAPH-CORE.md)과 같은 미해결 항목 | 파일럿 데이터 |
| 2 | **`Rate`(시간당 단가)를 직무별로 나눌 것인가** — 지금은 조직 1개 값. 나누면 정확해지지만 "이 사람 시간은 싸다"가 리포트에 보인다 | 지금은 나누지 않는다. 재검토 시점 = 실현율 검증 3건 이후 |
| 3 | **`process_key`의 사람 확정 UX** — §6.1의 회색대 질문을 어느 화면에 둘 것인가 | M4 조립 UI와 함께 |
| 4 | **실측 승격의 저빈도 업무 처리** — 월 3건인 업무는 2주로 표본이 안 찬다(SEED D-2가 Confidence 0.6인 이유). 4개월 세션을 허용할 것인가, 신뢰도가 낮다는 사실을 그대로 둘 것인가 | 파일럿 4주차 |
| 5 | **보정 계수의 첫 적용 시점** — 20쌍이 모이기 전에는 보정이 없다. 그 기간의 예측을 어떻게 표기할 것인가 | 5단계 착수 시 |
| 6 | **`RiskValue` 입력 UI** — 사람이 넣어야 하는데 어디서 넣는가. 관리자? 프로세스 소유자? 후자면 [POLICY §1.2](./POLICY.md)의 경계와 만난다 | 4단계 |
| 7 | **n8n 재수출 시 diff** — 자동화팀이 n8n에서 고친 것을 우리가 다시 읽을 것인가. 읽으면 역투영 문제가 n8n으로 확장된다 | D-011 해제 이후. **지금은 단방향** |


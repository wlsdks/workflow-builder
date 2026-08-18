# 데이터베이스 스키마 · 접근 통제

> 최종 갱신: 2026-08-17 · 상태: v0.1
> 이 문서는 [TRUST.md](./TRUST.md)의 절대 원칙 4개와 [POLICY.md](./POLICY.md) §1의 권한 모델을 **Postgres DDL로 번역한 것**이다.
> 충돌 시 TRUST.md가 이긴다. 스키마가 정책과 어긋나면 **스키마가 틀린 것**이다.

---

## 이 문서를 지배하는 한 문장

> **애플리케이션 레벨 검사는 언젠가 우회된다. DB 롤과 뷰로 못 박는다.**

이 문장의 실질적 의미는 다음 넷이다. 이 문서 전체가 이 넷의 구현이다.

| # | 원칙 | DB에서의 착지점 |
|---|---|---|
| 1 | 개인 문서는 소유자 + 소유자 발급 링크만 | RLS. `app.can_read_document()`가 `org_members`를 **읽지 않는다** — 그리고 그 사실을 `pg_policies`/`pg_proc`에 대한 테스트로 검증한다 |
| 2 | 집계 단위는 사람이 아니라 프로세스 | `admin_reader` 롤은 base 테이블에 `SELECT` 권한이 **없다**. 뷰만 있다 |
| 3 | 5인 미만 차단 + 2차 억제 + 5단위 라운딩 | **억제 로직이 뷰 하나(`agg_public`)에만 존재한다.** 축을 추가해도 억제를 다시 쓸 수 없다 |
| 5 | 소유자가 열람자를 본다 | `view_logs`는 append-only. 소유자도 못 지운다. 보이는 창 90일 / 원본 1년 |

원칙 4(인사평가 금지)는 DB로 강제할 수 없다. **강제할 수 있는 것은 "인사평가에 쓸 수 있는 형태의 데이터가 존재하지 않게 하는 것"**이고, 그것이 §12다.

---

## 목차

1. [전체 스키마 — Drizzle](#1-전체-스키마--drizzle)
2. [인덱스 전략](#2-인덱스-전략)
3. [RLS 정책 전문](#3-rlsrow-level-security-정책-전문)
4. [k-익명성 집계 뷰](#4-k-익명성-집계-뷰)
5. [감사 로그 설계](#5-감사-로그-설계)
6. [봉투 암호화 — 비공개 노트](#6-봉투-암호화--비공개-노트l4)
7. [마이그레이션 전략](#7-마이그레이션-전략)
8. [파티셔닝·보존](#8-파티셔닝보존)
9. [조직 격리](#9-조직-격리)
10. [성능](#10-성능)
11. [테스트](#11-테스트)
12. [스키마에 일부러 만들지 않는 것](#12-스키마에-일부러-만들지-않는-것)

---

## 0. 전제

| 항목 | 값 | 근거 |
|---|---|---|
| Postgres | **16 이상** | `security_invoker` 뷰(15+), `MERGE`, 파티션 성능. 17이면 더 좋다(파티션 pruning·`COPY` 개선) |
| ORM | `drizzle-orm` 0.44.x | ARCHITECTURE §1 |
| 마이그레이션 | `drizzle-kit generate` + **손으로 쓴 SQL 마이그레이션 병행** | RLS·뷰·GRANT·파티션은 Drizzle이 표현하지 못한다 (§7) |
| 드라이버 | `postgres.js` (`prepare: false`) | PgBouncer transaction 모드 (§3.6) |
| 스키마 네임스페이스 | `public`(데이터) · `app`(헬퍼 함수) · `agg`(집계 뷰) · `audit`(감사) | 권한을 스키마 단위로 끊기 위해서. `GRANT`를 테이블마다 쓰면 새 테이블에서 반드시 빠뜨린다 |

**네임스페이스 분리가 이 설계에서 하는 일** — `REVOKE ALL ON SCHEMA public FROM admin_reader` 한 줄이 "관리자는 원본을 못 본다"의 전부다. 나중에 테이블이 40개 늘어도 이 한 줄은 유효하다. 테이블 단위 `REVOKE`는 41번째 테이블에서 뚫린다.

---

## 1. 전체 스키마 — Drizzle

> 파일 배치: `db/schema/` 아래로 쪼갠다. 한 파일 2,000줄짜리 `schema.ts`는 6개월 뒤 아무도 안 읽는다.
>
> ```
> db/schema/
>   _enums.ts        모든 pgEnum
>   _types.ts        customType (sortKey 등)
>   org.ts           orgs · users · departments · org_members · directory_roles
>   doc.ts           documents · items · edges · tools · item_tools · document_members
>   seam.ts          business_objects · handoff_sockets · socket_artifacts · handoff_links · …
>   share.ts         share_links · view_logs · exports · team_shelf
>   ops.ts           operations · snapshots · checklist_runs
>   secret.ts        private_notes · org_deks · org_salts
>   audit.ts         audit_logs · admin_query_logs
>   index.ts         re-export
> ```

### 1.0 커스텀 타입 — `sortKey`를 도메인으로 못 박는다

```ts
// db/schema/_types.ts
import { customType } from 'drizzle-orm/pg-core';

/**
 * fractional index 정렬 키.
 * ★ Postgres 기본 collation(en_US.UTF-8)은 바이트 순서가 아니다.
 *   COLLATE "C"가 아니면 base62 키의 정렬이 조용히 틀어진다 (ARCHITECTURE §2).
 * ★ 컬럼에 COLLATE를 직접 붙이지 않고 DOMAIN으로 감싸는 이유는 §7.3에 있다 —
 *   drizzle-kit의 diff가 collation을 보지 못해서, 컬럼에 붙이면 다음 마이그레이션이 조용히 벗겨낸다.
 */
export const sortKey = customType<{ data: string; driverData: string }>({
  dataType: () => 'sort_key_t',
});

/** 되돌릴 수 없는 것에는 항상 유예가 붙는다 (SECURITY §9). tombstone 시각. */
export const tsz = 'timestamp with time zone';
```

대응 DDL (초기 마이그레이션 `0000_init.sql`):

```sql
CREATE DOMAIN sort_key_t AS text COLLATE "C";
```

**왜 이 설계인가** — 정렬 규칙을 타입에 넣으면 컬럼을 새로 만들 때 잊을 수 없다. 컬럼에 `COLLATE`를 쓰면 잊을 수 있고, 잊으면 **에러가 아니라 잘못된 순서**가 나온다.

---

### 1.1 열거형 — 전량

```ts
// db/schema/_enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

// ── 문서·그래프 (ARCHITECTURE §2) ──────────────────────────
export const nodeKind = pgEnum('node_kind', ['task', 'branch', 'hold']);
export const edgeKind = pgEnum('edge_kind', ['explicit', 'suppressed']);

/** POLICY §1.6 — 개인 문서와 사내 SOP는 정책이 다르므로 한 테이블에 두되 kind로 가른다 */
export const documentKind = pgEnum('document_kind', ['personal', 'org_doc']);

/**
 * ★ text가 아니라 enum이다.
 * TRUST 공포 2: "소요시간은 절대값이 아니라 버킷". enum이면 절대값을 넣을 자리가 없다.
 * text였다면 6개월 뒤 누군가 '3.5h'를 넣고, 그 순간 개인 시간 총합이 계산 가능해진다.
 */
export const durationBand = pgEnum('duration_band',
  ['1m', '5m', '15m', '1h', 'halfday', '1d+']);

// ── 접합 (ASSEMBLY §1.3) ──────────────────────────────────
export const socketDirection = pgEnum('socket_direction', ['outbound', 'inbound']);
export const partyKind = pgEnum('party_kind',
  ['user', 'role', 'team', 'external', 'unknown']);
export const objectClass = pgEnum('object_class',
  ['request', 'approval', 'evidence', 'record', 'identifier', 'physical', 'notice']);
export const catalogLevel = pgEnum('catalog_level', ['system', 'org', 'pending']);
export const linkType = pgEnum('link_type', ['handoff', 'overlap', 'fanout', 'return']);
export const linkStatus = pgEnum('link_status',
  ['candidate', 'auto', 'single', 'confirmed', 'rejected', 'severed', 'stale', 'orphaned']);
export const discrepancyStatus = pgEnum('discrepancy_status',
  ['open', 'acknowledged', 'resolved', 'wontfix']);
export const severity = pgEnum('severity', ['high', 'mid', 'low']);

// ── 조직·권한 (POLICY §1.1) ───────────────────────────────
/**
 * ★ 축 A. 이 enum의 어떤 값도 문서 접근권을 만들지 않는다.
 *   §3의 어떤 RLS 정책도 이 컬럼을 참조하지 않고, §11.1의 테스트가 그걸 검증한다.
 */
export const orgRole = pgEnum('org_role',
  ['member', 'dept_champion', 'org_admin', 'system_admin', 'guest']);

/**
 * ★ 축 B. 문서 접근권의 원천 두 개 중 하나. 다른 하나는 share_links다.
 * POLICY §1.4의 3등급 그대로. ★ 'owner'가 없다 —
 * 소유자는 `documents.created_by`이지 멤버 행이 아니다. 소유권을 행으로 표현하면
 * 소유자가 2명인 상태를 표현할 수 있게 되고, 그 순간 "관리자를 공동 소유자로" 요구가 열린다.
 */
export const docMemberRole = pgEnum('doc_member_role',
  ['viewer', 'commenter', 'editor']);

/** POLICY §2.1 — A: 조직 안 사람만 / B: 링크 아는 사람 누구나 / C: 지정한 사람만 */
export const shareLinkKind = pgEnum('share_link_kind', ['org', 'public', 'named']);

/**
 * 링크 용도. 기본 만료·상한이 용도마다 다르다 (SECURITY §8.2).
 * ★ 'support'는 새 권한 경로가 아니라 소유자가 발급하는 링크의 특수형이다 (SECURITY §5.4a).
 *   이 값이 shareLinkKind가 아니라 purpose에 있는 것이 감사 시 결정적이다.
 */
export const shareLinkPurpose = pgEnum('share_link_purpose',
  ['general', 'handover', 'support']);

/** POLICY §2.5 / SECURITY §5.4(a) — 진단 세션은 새 권한 경로가 아니라 share_link의 특수형이다 */
export const viewVia = pgEnum('view_via',
  ['owner', 'direct', 'share_link', 'team_shelf', 'support_session']);

export const userStatus = pgEnum('user_status',
  ['active', 'suspended', 'deprovisioned', 'former']);

// ── 집계 (§4) ─────────────────────────────────────────────
/** ★ 집계 축은 enum이다. 새 축은 마이그레이션으로만 추가되고, 리뷰에 남는다. */
export const aggAxis = pgEnum('agg_axis',
  ['process', 'dept_pair', 'tool', 'seam_kind']);

/**
 * ★ MEASUREMENT §3 추가방어 1 — 임의 기간 파라미터가 존재하지 않는다.
 *   'YYYY-MM'은 값이 열려 있으므로 enum이 아니라 period_presets 테이블 + CHECK로 간다.
 */
export const periodFamily = pgEnum('period_family',
  ['last30', 'last90', 'last365', 'month']);

// ── 감사 (§5) ─────────────────────────────────────────────
export const auditActorKind = pgEnum('audit_actor_kind',
  ['user', 'share_token', 'system', 'migrator', 'break_glass']);
```

**왜 이 설계인가 (enum 전반)** — 자유 텍스트 컬럼은 6개월 뒤 반드시 원값이 들어간다. `duration_band`가 `text`인 채로 3개월 지나면 누군가 `'3.5h'`를 넣고, 그 순간 §12에서 "만들지 않는다"고 못 박은 개인별 시간 총합이 **계산 가능한 상태**가 된다. **금지하고 싶은 것은 스키마에 자리를 만들지 않는 것이 유일하게 작동하는 금지다.**

---

### 1.2 조직 · 사용자 · 부서 (SCIM 동기화)

```ts
// db/schema/org.ts
import {
  pgTable, uuid, text, integer, boolean, jsonb, timestamp,
  index, uniqueIndex, primaryKey, check, foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgRole, userStatus } from './_enums';

/** 테넌트 루트. 모든 org_id의 참조 종단점. */
export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** 도메인 검증 결과 (POLICY §1.1 B) — 시스템 관리자만 변경 */
  verifiedDomains: text('verified_domains').array().notNull().default(sql`'{}'`),

  // ── 조직 설정 (POLICY §1.1 B에서 조직 관리자가 바꿀 수 있는 것만) ──
  /** POLICY §2.4 — 외부 공유 허용. 끄면 B·C 링크 생성이 DB CHECK로 막힌다 */
  externalSharingEnabled: boolean('external_sharing_enabled').notNull().default(true),
  /** POLICY §11 — 7~90일 사이만. '만료 없음'을 조직 기본값으로 둘 수 없다 */
  defaultLinkExpiryDays: integer('default_link_expiry_days').notNull().default(30),
  /** POLICY §3 — 근무시간 창. 금요일 15시 이후 시스템 발신 금지의 기준 */
  workHours: jsonb('work_hours').$type<{ tz: string; start: string; end: string }>()
    .notNull().default(sql`'{"tz":"Asia/Seoul","start":"09:00","end":"18:00"}'::jsonb`),

  // ── 조직 자산 (HANDOVER §11.1) ──
  /** 조직 업무 용어 사전. "두 번째 데이터 자산" — 별도 테이블로 뺀다 (§1.7) */

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  check('orgs_expiry_range',
    sql`${t.defaultLinkExpiryDays} BETWEEN 7 AND 90`),
]);
```
*왜* — 조직 설정을 `orgs` 컬럼으로 둔 것은 **관리자가 바꿀 수 있는 것의 전체 목록이 한 화면에 보이게** 하기 위해서다. jsonb `settings` 한 덩어리면 6개월 뒤 그 안에 `admin_can_read_documents: true`가 들어가도 리뷰에서 안 보인다.

```ts
/** SCIM 유래 부서 트리. L1(내부) 등급 — SECURITY §1 */
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  /** IdP의 부서 식별자. 재동기화 시 이름이 바뀌어도 동일 부서로 이어진다 */
  externalId: text('external_id'),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),

  /**
   * ★ MEASUREMENT §2 — 5인 미만 부서는 수집 시점에 `small_dept`로 치환된다.
   *   그 판정을 애플리케이션이 매번 세지 않도록 여기에 유지한다.
   *   nightly 재계산 (§8.3). 값이 아니라 k-임계 통과 여부만 저장한다.
   */
  headcountBucket: integer('headcount_bucket'),          // 5단위로 라운딩된 값. 원값 아님
  kEligible: boolean('k_eligible').notNull().default(false),

  syncedAt: timestamp('synced_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
  uniqueIndex('departments_org_external').on(t.orgId, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),
  index('departments_org_parent').on(t.orgId, t.parentId),
  // ★ 크로스 테넌트 복합 FK의 참조 대상 (§9.2)
  uniqueIndex('departments_id_org').on(t.id, t.orgId),
]);
```
*왜* — `headcount`를 원값으로 두지 않고 `headcountBucket`(5단위) + `kEligible`(불리언)로 나눈 것이 핵심이다. **원값이 있으면 "4명짜리 팀"이라는 사실 자체가 재식별 정보**이고, 집계 뷰가 그걸 참조하는 순간 차분 공격의 입구가 된다.

```ts
/** SCIM 유래 사용자. L2(개인정보) 등급 — SECURITY §1 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  /** ★ IdP subject. 인증 벤더 교체를 하루 작업으로 만드는 유일한 컬럼 (ARCHITECTURE §7) */
  externalId: text('external_id'),

  email: text('email').notNull(),
  name: text('name').notNull(),
  /** SCIM 유래. 원천은 고객사 인사시스템이므로 우리는 정정하지 않는다 (SECURITY §2) */
  employeeNo: text('employee_no'),
  deptId: uuid('dept_id').references(() => departments.id, { onDelete: 'set null' }),
  jobTitle: text('job_title'),

  /**
   * POLICY §4.4 — 이름 옵트아웃.
   * 켜면 다른 사람 화면에서 실명 대신 role_label이 보인다.
   */
  nameOptout: boolean('name_optout').notNull().default(false),
  roleLabel: text('role_label'),                          // '재무팀 담당자'

  status: userStatus('status').notNull().default('active'),
  /** SECURITY §9 — SCIM 오류로 잘못 비활성화된 경우의 7일 유예 시작점 */
  deprovisionedAt: timestamp('deprovisioned_at', { withTimezone: true }),
  /** POLICY §9.3 — deprovision 30일 유예 만료 시각. 여기 지나야 봉인 이전 */
  sealEligibleAt: timestamp('seal_eligible_at', { withTimezone: true }),

  /**
   * ★ tenure_band만 저장한다. 입사일 원값을 저장하지 않는다 (MEASUREMENT §2).
   *   입사일이 있으면 부서 × 입사일로 거의 항상 개인이 특정된다.
   */
  tenureBand: text('tenure_band'),                        // '<6m'|'6-24m'|'2-5y'|'5y+'

  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_org_email').on(t.orgId, sql`lower(${t.email})`),
  uniqueIndex('users_org_external').on(t.orgId, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),
  index('users_org_dept').on(t.orgId, t.deptId).where(sql`${t.status} = 'active'`),
  uniqueIndex('users_id_org').on(t.id, t.orgId),          // §9.2 복합 FK 대상
  check('users_tenure_band', sql`${t.tenureBand} IS NULL OR ${t.tenureBand}
        IN ('<6m','6-24m','2-5y','5y+')`),
]);
```
*왜* — `hireDate`가 아니라 `tenureBand`인 이유가 이 테이블의 전부다. 원값을 안 받으면 나중에 "연차별 분석"을 요구받아도 **줄 수가 없다.** 줄 수 없는 것은 거절할 필요가 없다.

```ts
/**
 * ★★ 축 A. POLICY §1.0.
 * 이 테이블은 조직을 운영하는 권한만 담는다.
 * §3의 어떤 RLS 정책도 이 테이블을 참조하지 않는다. §11.1이 그것을 검증한다.
 */
export const orgMembers = pgTable('org_members', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: orgRole('role').notNull().default('member'),

  /** POLICY §1.0 부가권한 ① 분석 좌석 — 역할에 자동으로 딸려오지 않는다 */
  analystSeat: boolean('analyst_seat').notNull().default(false),
  /** POLICY §1.0 부가권한 ② 지정 창구 — 신고·개인정보 요청 접수 */
  isDesk: boolean('is_desk').notNull().default(false),

  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId] }),
  index('org_members_analyst').on(t.orgId).where(sql`${t.analystSeat}`),
]);
```
*왜* — **이 테이블은 문서 접근과 물리적으로 무관하다는 것이 이 테이블의 존재 이유다.** `analystSeat`을 `role`에서 분리한 것도 같은 논리 — "관리자"라는 단어 하나에 권한이 뭉치면, 그 단어를 확장하자는 요구를 거절할 수 없다.

```ts
/** ASSEMBLY §1.3의 partyRoleId 대상. SCIM 유래 역할 사전 */
export const directoryRoles = pgTable('directory_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                           // '회계담당자'
  nameNorm: text('name_norm').notNull(),
  deptId: uuid('dept_id').references(() => departments.id, { onDelete: 'set null' }),
}, (t) => [uniqueIndex('directory_roles_org_norm').on(t.orgId, t.nameNorm)]);
```
*왜* — 접합 소켓의 `party_kind='role'`이 자유 텍스트로 가면 접합 지도가 무너진다. 도구를 FK로 간 것과 같은 논리(D-009).

---

### 1.3 문서 · 항목 · 엣지 (ARCHITECTURE §2 통합 + 확장)

```ts
// db/schema/doc.ts
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  kind: documentKind('kind').notNull().default('personal'),
  title: text('title').notNull(),

  /** 낙관적 동시성 토큰 (ARCHITECTURE §6) */
  revision: integer('revision').notNull().default(0),

  /**
   * ★ 소유자. 원칙 1의 유일한 1차 원천.
   *   onDelete를 'restrict'로 둔다 — 사용자를 지우면 문서가 조용히 사라지는 대신
   *   퇴사 절차(POLICY §6)를 강제로 태우게 된다. 조용한 실패보다 시끄러운 실패.
   */
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),

  /**
   * ★★ 집계 귀속은 "작성 시점 부서"로 고정된다. 소급 재계산을 하지 않는다 (SECURITY §9.5).
   * users.dept_id를 조인해서 집계하면 사람이 부서를 옮길 때마다 과거 셀이 바뀌고,
   * 그 **변화량이 곧 차분 공격의 재료**가 된다. 스냅샷이 아니라 조인으로 가면
   * "재계산 금지" 정책을 지킬 방법이 없다 — 정책을 스키마가 배신한다.
   */
  deptIdAtWrite: uuid('dept_id_at_write').references(() => departments.id, { onDelete: 'set null' }),

  /** POLICY §5.4 — 소유자가 조직 프로세스 지도에서 제외 선택 */
  excludedFromMap: boolean('excluded_from_map').notNull().default(false),
  /** POLICY §6.4 — 문서 전체를 개인용으로 표시. 접합 소켓조차 노출되지 않는다 */
  isPrivateOnly: boolean('is_private_only').notNull().default(false),

  /**
   * HANDOVER §11.1 — hardestPart('제일 조심할 곳'), cadence(흐름 주기)
   * ★ 개인 식별자·자유 서술 중 L4 등급인 것은 여기 넣지 않는다. private_notes로 간다.
   */
  attrs: jsonb('attrs').$type<DocumentAttrs>().notNull().default(sql`'{}'::jsonb`),

  /** POLICY §6.2 — 퇴사자 문서 봉인. NULL이면 봉인 아님 */
  sealedUntil: timestamp('sealed_until', { withTimezone: true }),

  /** TRUST §7 — 12개월 미확인 시 자동 아카이브. 검색에서 제외, 소유자만 복원 */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** TRUST §7 — 삭제 요청 시 즉시 tombstone, 30일 후 물리 삭제 (§8.4) */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  // ★ 소유자 문서함. 가장 뜨거운 쿼리이자 tombstone·아카이브 제외가 붙는 곳 (§2.2)
  index('documents_owner_active').on(t.createdBy, t.updatedAt.desc())
    .where(sql`${t.deletedAt} IS NULL AND ${t.archivedAt} IS NULL`),
  index('documents_org_kind').on(t.orgId, t.kind).where(sql`${t.deletedAt} IS NULL`),
  // §9.2 복합 FK 대상 — 자식 테이블이 org를 건너뛸 수 없게 한다
  uniqueIndex('documents_id_org').on(t.id, t.orgId),
  check('documents_org_doc_not_private',
    sql`NOT (${t.kind} = 'org_doc' AND ${t.isPrivateOnly})`),
]);
```
*왜* — `deletedAt`/`archivedAt`/`sealedUntil`이 **세 개의 다른 컬럼인 것**이 요점이다. 하나의 `status` enum으로 합치면 "봉인 중이면서 아카이브된 문서"를 표현할 수 없고, 그 조합은 실제로 발생한다(퇴사자의 오래된 문서).

```ts
export const items = pgTable('items', {
  /** ★ 클라이언트 발급 UUID. CRDT의 전제조건 (ARCHITECTURE §9-2) */
  id: uuid('id').primaryKey(),
  docId: uuid('doc_id').notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  /** §9.2 — 복합 FK로 조직을 못 넘게 한다. 비정규화지만 격리가 값어치보다 크다 */
  orgId: uuid('org_id').notNull(),

  parentId: uuid('parent_id'),
  /** ★ sort_key_t = text COLLATE "C" (§1.0) */
  sortKey: sortKey('sort_key').notNull(),

  kind: nodeKind('kind').notNull().default('task'),
  title: text('title').notNull().default(''),

  // ── 조회·집계 대상은 컬럼으로 ──
  /** ★ 자유 텍스트 금지. 디렉터리 FK (PRD §4.5 / D-009) */
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  /** ★ enum. 절대값을 넣을 자리가 없다 (§1.1) */
  durationBand: durationBand('duration_band'),
  freqLast7d: integer('freq_last_7d'),
  automationLevel: integer('automation_level'),
  /** ★ 익명 신호. 누가 눌렀는지는 어디에도 저장되지 않는다 (TRUST 공포 3) */
  painFlag: boolean('pain_flag').notNull().default(false),

  /**
   * 타입별 속성 (PRD §4.3)
   *  branch → { mode: 'xor'|'and'|'skip' }
   *  hold   → { waitFor: 'approval'|'reply'|'time'|'resource', avgWaitH, timeoutH }
   *  task   → { reworkRate, returnToItemId }
   *  공통   → { handoffPayload, description }  (HANDOVER §11.1)
   * ★ private_note는 여기 없다. §1.8의 별도 테이블이다.
   */
  attrs: jsonb('attrs').$type<ItemAttrs>().notNull().default(sql`'{}'::jsonb`),

  /** PRD §4.10 — 신선도는 문서가 아니라 단계 단위 */
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // ★ 형제 순서 유일성. tombstone은 제외 — 지운 항목의 키를 재사용할 수 있어야 한다
  uniqueIndex('items_sibling_order').on(t.docId, t.parentId, t.sortKey)
    .where(sql`${t.deletedAt} IS NULL`),
  // ★ 트리 순회 커버링 인덱스 (§2.1)
  index('items_tree').on(t.docId, t.parentId, t.sortKey)
    .where(sql`${t.deletedAt} IS NULL`),
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
  // §9.2 크로스 테넌트 복합 FK
  foreignKey({ columns: [t.docId, t.orgId], foreignColumns: [documents.id, documents.orgId] })
    .onDelete('cascade'),
  check('items_automation_level',
    sql`${t.automationLevel} IS NULL OR ${t.automationLevel} BETWEEN 0 AND 3`),
  check('items_freq_sane',
    sql`${t.freqLast7d} IS NULL OR ${t.freqLast7d} BETWEEN 0 AND 500`),
]);
```
*왜* — `items_sibling_order`에 `WHERE deleted_at IS NULL`을 붙인 것이 tombstone 설계의 핵심이다. 붙이지 않으면 항목을 지웠다가 같은 자리에 새로 넣을 때 유일성 위반이 나고, 클라이언트는 그 실패를 복구할 방법이 없다(CRDT는 삭제를 되돌리지 않는다).

```ts
/** 도구 카탈로그. 자유 문자열이 아니라 FK — n8n 매핑이 join 한 번이 된다 */
export const tools = pgTable('tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** null = 시스템 카탈로그 48종 (TOOLS.md). 조직 전용 도구는 orgId 스코프 */
  orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(),
  /** HANDOVER §11.1 — 용어 풀이 ① */
  description: text('description'),
  n8nNodeType: text('n8n_node_type'),
  /** TOOLS.md 자동화 연결성 등급. ★ 조직 관리자도 못 바꾼다 (POLICY §1.1 B) */
  connectivity: integer('connectivity'),
}, (t) => [
  uniqueIndex('tools_scope_norm').on(sql`coalesce(${t.orgId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.nameNorm),
  index('tools_org').on(t.orgId),
]);

export const itemTools = pgTable('item_tools', {
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  toolId: uuid('tool_id').notNull().references(() => tools.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.toolId] }),
  index('item_tools_tool').on(t.toolId),      // 도구→항목 역방향 (집계 소스, §2.4)
]);

/** HANDOVER §11.1 — 조직별 도구 별칭·로그인 방법. 용어 풀이 ② */
export const toolAliases = pgTable('tool_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  toolId: uuid('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),                 // '그룹웨어', '전자결재'
  aliasNorm: text('alias_norm').notNull(),
  /** '사내망에서만 열려요 / SSO로 들어가요' — 인수인계 문서 용어 풀이에 쓰인다 */
  accessNote: text('access_note'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('tool_aliases_org_norm').on(t.orgId, t.aliasNorm),
  index('tool_aliases_tool').on(t.toolId),
]);

/** HANDOVER §11.1 — 조직 업무 용어 사전. "두 번째 데이터 자산" */
export const glossary = pgTable('glossary', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  term: text('term').notNull(),                   // '지결'
  termNorm: text('term_norm').notNull(),
  definition: text('definition').notNull(),       // '지출결의서'
  /** ASSEMBLY §1.1의 승격 패턴 — 서로 다른 소유자 2명 이상이 쓰면 org 레벨로 */
  level: catalogLevel('level').notNull().default('pending'),
  distinctOwners: integer('distinct_owners').notNull().default(0),
  promotedFromRaw: text('promoted_from_raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('glossary_org_term').on(t.orgId, t.termNorm),
  index('glossary_org_level').on(t.orgId, t.level),
]);
```
*왜 (glossary/tool_aliases)* — 조직 자산이므로 **개인 문서와 생명주기가 다르다.** 소유자가 문서를 지워도 용어 사전은 남아야 한다. 그래서 `documents` 자식이 아니라 `orgs` 자식이고, `promotedFromRaw`로 승격 근거만 남긴다(원문 문서를 참조하지 않는다 — 참조하면 지워진 문서를 역추적하는 경로가 생긴다).

```ts
/** 예외 엣지 + 파생 엣지 억제. 파생 엣지는 저장하지 않는다 (ARCHITECTURE §2) */
export const edges = pgTable('edges', {
  id: uuid('id').primaryKey(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  /** items.id 또는 'join:{uuid}' / 'start' / 'end' — 그래서 uuid가 아니라 text */
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  kind: edgeKind('kind').notNull().default('explicit'),
  label: text('label'),
}, (t) => [
  uniqueIndex('edges_unique').on(t.docId, t.sourceId, t.targetId, t.kind),
  index('edges_doc').on(t.docId),
  foreignKey({ columns: [t.docId, t.orgId], foreignColumns: [documents.id, documents.orgId] })
    .onDelete('cascade'),
  check('edges_no_self', sql`${t.sourceId} <> ${t.targetId}`),
]);
```
*왜* — `sourceId`가 `text`인 것은 합류/시작/종료 노드가 **저장되지 않는 결정적 ID**이기 때문이다(`join:{branchItemId}`). uuid FK로 만들면 이 노드들을 실제 행으로 저장해야 하고, 그 순간 트리와 엣지의 split brain이 시작된다.

```ts
/** ★★ 축 B. 문서 접근권의 원천 두 개 중 하나 (POLICY §1.0) */
export const documentMembers = pgTable('document_members', {
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: docMemberRole('role').notNull(),
  /** ★ 누가 줬는가. 소유자 아닌 사람이 준 흔적이 있으면 그게 사고다 */
  grantedBy: uuid('granted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  /** POLICY §1.7 위임 — 최대 30일. DB CHECK로 상한을 박는다 */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.docId, t.userId] }),
  // ★ RLS 정책이 매 행마다 타는 인덱스. 순서가 (userId, docId)여야 한다 (§2.3)
  index('document_members_user').on(t.userId, t.docId),
  check('document_members_delegation_cap',
    sql`${t.expiresAt} IS NULL OR ${t.expiresAt} <= ${t.grantedAt} + interval '30 days'`),
]);
```
*왜 인덱스 순서가 (userId, docId)인가* — RLS 정책은 "내가 멤버인 문서"를 묻는다. 선두 컬럼이 `userId`여야 인덱스가 탄다. PK가 `(docId, userId)`인 것과 반대 순서의 보조 인덱스가 **반드시 필요하다.** 이걸 빠뜨리면 문서 목록 조회가 `document_members` 전체 스캔이 된다.

*왜 30일 상한이 CHECK인가* — POLICY §1.7의 "최대 30일"을 애플리케이션에서만 검사하면 배치 스크립트 하나가 우회한다. **상한이 정책이면 CHECK로, 기본값이면 컬럼 default로.** 둘을 섞으면 안 된다.

---

### 1.4 접합 — 소켓 · 링크 · 불일치 (ASSEMBLY §1.3 통합)

> **명명 정정**: 다른 문서에서 "접합 링크(`seam_links`)"로 불린 것의 정식 이름은 **`handoff_links`**다(ASSEMBLY §1.3).
> `seam`은 지표·이벤트·집계 뷰 이름(`agg_seam_discrepancy`)에만 남긴다. 테이블은 하나뿐이다.

```ts
// db/schema/seam.ts
export const businessObjects = pgTable('business_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }), // null = 시스템 원형
  level: catalogLevel('level').notNull().default('pending'),
  canonicalName: text('canonical_name').notNull(),
  nameNorm: text('name_norm').notNull(),
  aliases: text('aliases').array().notNull().default(sql`'{}'`),
  objectClass: objectClass('object_class').notNull(),
  identifierHint: text('identifier_hint'),
  promotedFromRaw: text('promoted_from_raw'),
  distinctOwners: integer('distinct_owners').notNull().default(0),
  idf: real('idf'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('bobj_org_norm')
    .on(sql`coalesce(${t.orgId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.nameNorm),
  index('bobj_class').on(t.orgId, t.objectClass),
]);
```
*왜* — `orgId`가 nullable이라 `uniqueIndex(orgId, nameNorm)`이 **작동하지 않는다**(NULL은 서로 같지 않다). 시스템 원형이 중복 생성되는 걸 막으려면 `coalesce`로 감싼 표현식 인덱스여야 한다. ASSEMBLY 초안의 버그를 여기서 고친다.

```ts
export const handoffSockets = pgTable('handoff_sockets', {
  id: uuid('id').primaryKey(),                        // 클라이언트 발급 (D-031)
  orgId: uuid('org_id').notNull(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  /** ★ NOT NULL이 아니다 + ON DELETE SET NULL — 항목이 지워져도 링크는 orphaned로 남는다 */
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  direction: socketDirection('direction').notNull(),

  // 신호 ③ 상대방
  partyKind: partyKind('party_kind').notNull().default('unknown'),
  partyUserId: uuid('party_user_id').references(() => users.id, { onDelete: 'set null' }),
  partyRoleId: uuid('party_role_id').references(() => directoryRoles.id, { onDelete: 'set null' }),
  partyDeptId: uuid('party_dept_id').references(() => departments.id, { onDelete: 'set null' }),
  /** ★ 매칭 실패 원문 — 절대 버리지 않는다. 나중 정규화 사전의 유일한 재료 */
  partyRaw: text('party_raw'),
  partyExternalLabel: text('party_external_label'),

  // 신호 ② 도구·화면
  channelToolId: uuid('channel_tool_id').references(() => tools.id, { onDelete: 'set null' }),
  channelScreen: text('channel_screen'),

  // 신호 ④ 시간 인접성
  lagBand: text('lag_band').notNull().default('unknown'),
  cadenceKey: text('cadence_key'),

  source: text('source').notNull().default('asked'),
  confidence: real('confidence').notNull().default(1),
  boundary: text('boundary').notNull(),
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('sockets_doc').on(t.docId),
  index('sockets_item_dir').on(t.itemId, t.direction),
  index('sockets_party').on(t.orgId, t.partyUserId),
  uniqueIndex('sockets_item_direction').on(t.itemId, t.direction)
    .where(sql`${t.itemId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  foreignKey({ columns: [t.docId, t.orgId], foreignColumns: [documents.id, documents.orgId] })
    .onDelete('cascade'),
  check('sockets_lag_band', sql`${t.lagBand} IN
    ('immediate','same_day','1d','2-3d','1w','batch_monthly','unknown')`),
  check('sockets_boundary', sql`${t.boundary} IN ('first','last','mid')`),
  check('sockets_source', sql`${t.source} IN ('asked','inferred','seed','derived_from_link')`),
]);
```
*왜* — ASSEMBLY의 초안은 `itemId`를 `NOT NULL + CASCADE`로 선언한 뒤 DDL로 되돌린다. **여기서는 처음부터 옳게 쓴다.** 그리고 `sockets_item_direction` 유니크를 부분 인덱스로 바꿔야 한다 — 원안대로면 `itemId`가 NULL이 된 orphan 소켓들이 서로 충돌한다(실제로는 NULL 때문에 충돌하지 않지만, tombstone 소켓과는 충돌한다).

```ts
export const socketArtifacts = pgTable('socket_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  socketId: uuid('socket_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  objectId: uuid('object_id').references(() => businessObjects.id, { onDelete: 'set null' }),
  labelRaw: text('label_raw').notNull(),
  labelNorm: text('label_norm').notNull(),
  role: text('role').notNull().default('primary'),
  /** '견적 2곳' → 2. ★ 산출물 불일치(§7 ②) 검출의 유일한 입력 */
  qty: integer('qty'),
  isRequired: boolean('is_required').notNull().default(true),
}, (t) => [
  index('sart_socket').on(t.socketId),
  index('sart_norm').on(t.labelNorm),
  check('sart_role', sql`${t.role} IN ('primary','attachment')`),
]);

export const handoffLinks = pgTable('handoff_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  outboundSocketId: uuid('outbound_socket_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  inboundSocketId: uuid('inbound_socket_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  linkType: linkType('link_type').notNull().default('handoff'),
  status: linkStatus('status').notNull().default('candidate'),
  score: real('score').notNull(),
  signals: jsonb('signals').$type<SignalBreakdown>().notNull(),

  confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  counterConfirmedBy: uuid('counter_confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  counterConfirmedAt: timestamp('counter_confirmed_at', { withTimezone: true }),
  severedBy: uuid('severed_by').references(() => users.id, { onDelete: 'set null' }),
  severedAt: timestamp('severed_at', { withTimezone: true }),
  /** ASSEMBLY §6 — 180일 지나면 조직 뷰에서 흐려지고 Confidence가 감쇠 */
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('links_pair').on(t.outboundSocketId, t.inboundSocketId),
  index('links_org_status').on(t.orgId, t.status),
  // 조직 뷰 소스 — confirmed/auto만 읽는 부분 인덱스 (§2.4)
  index('links_org_live').on(t.orgId, t.lastVerifiedAt)
    .where(sql`${t.status} IN ('confirmed','auto')`),
  check('links_not_self', sql`${t.outboundSocketId} <> ${t.inboundSocketId}`),
]);
```
*왜 `linkType`/`status`가 enum이 됐나* — ASSEMBLY 초안은 `text`였다. 상태 기계의 값이 text면 오타 하나가 조용히 "새로운 상태"를 만들고, `status IN ('confirmed','auto')` 필터가 조용히 그 행을 뺀다. **상태 기계는 enum이다.**

```ts
export const linkSuppressions = pgTable('link_suppressions', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  /** ★ 항상 uuid 오름차순으로 정렬 저장 — 방향과 무관하게 한 번만 억제 */
  socketAId: uuid('socket_a_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  socketBId: uuid('socket_b_id').notNull()
    .references(() => handoffSockets.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  until: timestamp('until', { withTimezone: true }),      // null = 영구
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.socketAId, t.socketBId] }),
  // ★ 정렬 저장 규칙을 DB가 강제한다. 애플리케이션 규칙으로 두면 반드시 어긴다
  check('link_suppressions_ordered', sql`${t.socketAId} < ${t.socketBId}`),
  check('link_suppressions_reason',
    sql`${t.reason} IN ('not_this_work','wrong_person','not_now','severed')`),
]);

export const labelPairPenalties = pgTable('label_pair_penalties', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  normA: text('norm_a').notNull(),
  normB: text('norm_b').notNull(),
  rejectCount: integer('reject_count').notNull().default(0),
  penalty: real('penalty').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.normA, t.normB] }),
  check('lpp_ordered', sql`${t.normA} < ${t.normB}`),
  check('lpp_penalty_cap', sql`${t.penalty} BETWEEN -0.15 AND 0`),
]);
```
*왜 CHECK로 정렬을 강제하나* — "항상 오름차순으로 저장한다"는 주석은 6개월 뒤 지켜지지 않는다. 지켜지지 않으면 같은 쌍이 두 행으로 들어가고, 억제가 **한 방향에서만** 작동한다. 그 버그는 "가끔 거부한 링크가 다시 뜬다"로 나타나고 재현이 안 된다.

```ts
export const discrepancies = pgTable('discrepancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  linkId: uuid('link_id').references(() => handoffLinks.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                          // ASSEMBLY §7의 13종
  severity: severity('severity').notNull(),
  severityScore: real('severity_score').notNull(),
  /** ★ 양측 값. 개인 식별자 없음 — CHECK로 강제한다 (아래) */
  facts: jsonb('facts').$type<DiscrepancyFacts>().notNull(),
  status: discrepancyStatus('status').notNull().default('open'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('disc_link_kind').on(t.linkId, t.kind),
  index('disc_org_sev').on(t.orgId, t.severity, t.status)
    .where(sql`${t.status} = 'open'`),
  // ★ facts에 개인 식별자 키가 들어오면 INSERT가 실패한다
  check('disc_facts_no_pii', sql`NOT (${t.facts} ?| array[
    'owner_id','user_id','assignee_id','actor_id','email','name','employee_no'])`),
]);
```
*왜 `disc_facts_no_pii` CHECK인가* — 불일치 리포트의 `facts`는 **관리자에게 올라간다.** jsonb는 스키마가 없으므로, 6개월 뒤 누군가 디버깅하려고 `owner_id`를 넣으면 그게 그대로 관리자 화면에 도달한다. **jsonb 컬럼이 신뢰 경계를 넘는다면 그 컬럼에는 반드시 키 화이트/블랙리스트 CHECK가 붙어야 한다.**

---

### 1.5 공유 링크 · 열람 로그 · 내보내기 · 팀 서재

```ts
// db/schema/share.ts
export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),

  /**
   * ★ 평문 토큰을 저장하지 않는다 (SECURITY §8.1).
   *   192비트 엔트로피(randomBytes(24)) → base64url 32자 → URL은 /s/{token}.
   *   ★ URL에 문서 ID를 넣지 않는다 — 열거 공격 표면이 사라진다.
   *   DB에는 SHA-256 해시만. 조회는 해시 인덱스, 비교는 상수 시간.
   */
  tokenHash: text('token_hash').notNull(),

  kind: shareLinkKind('kind').notNull().default('org'),
  purpose: shareLinkPurpose('purpose').notNull().default('general'),
  /** POLICY §2.1 — 이름표. '재무팀 김선영에게'. 개별 회수를 가능하게 하는 유일한 필드 */
  label: text('label'),
  /** POLICY §1.4 — 이 링크로 열었을 때의 권한. 소유권은 절대 부여되지 않는다 */
  grantRole: docMemberRole('grant_role').notNull().default('viewer'),

  /** kind='named'일 때만. 이메일당 개별 추적 (SECURITY §8.3 org_guest) */
  invitedEmails: text('invited_emails').array().notNull().default(sql`'{}'`),

  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** SECURITY §8.2 — 인계용 기본 50회 등. null = 무제한 */
  maxViews: integer('max_views'),
  viewCount: integer('view_count').notNull().default(0),

  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  /** ★ 소유자만 만든다. 재공유 불가(POLICY §2.6)를 FK가 아니라 §3의 RLS로 강제 */
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** SECURITY §8.2 — 미열람 링크 7일 자동 만료. NULL이면 아직 아무도 안 열었다 */
  firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
}, (t) => [
  // ★ 토큰 조회. 이 인덱스 하나가 모든 공유 페이지 요청의 진입점이다
  uniqueIndex('share_links_token').on(t.tokenHash),
  index('share_links_doc').on(t.docId, t.createdAt.desc()),
  // 만료 스위퍼가 도는 부분 인덱스 (§2.5)
  index('share_links_expiring').on(t.expiresAt)
    .where(sql`${t.revokedAt} IS NULL AND ${t.expiresAt} IS NOT NULL`),
  foreignKey({ columns: [t.docId, t.orgId], foreignColumns: [documents.id, documents.orgId] })
    .onDelete('cascade'),

  // ★★ 정책을 CHECK로 (POLICY §2.3, SECURITY §8.2)
  //   '만료 없음'은 A(조직 안 사람만)에서만 허용된다
  check('share_links_public_must_expire',
    sql`${t.kind} = 'org' OR ${t.expiresAt} IS NOT NULL`),
  //   지원 진단 세션은 15분 고정, 연장 불가 (SECURITY §5.4a)
  check('share_links_support_15m',
    sql`${t.purpose} <> 'support' OR (
      ${t.expiresAt} IS NOT NULL
      AND ${t.expiresAt} <= ${t.createdAt} + interval '15 minutes'
      AND ${t.kind} = 'named' AND array_length(${t.invitedEmails}, 1) = 1)`),
  //   공유 링크가 편집권보다 강한 것을 줄 수 없다
  check('share_links_named_has_emails',
    sql`${t.kind} <> 'named' OR array_length(${t.invitedEmails}, 1) >= 1`),
]);
```
*왜* — 이 테이블의 CHECK 3개가 **"막을 수 없는 것은 비싸게 만든다"(POLICY §0-2)의 DB 착지점**이다. 특히 `share_links_support_15m`: 지원 세션을 별도 테이블이나 별도 권한 경로로 만들면 그건 새 열람권이고, 6개월 뒤 "지원 세션 60분으로 늘려주세요"가 온다. **`share_links`의 행 하나 + CHECK 하나로 두면, 늘리는 것이 마이그레이션이 되고 리뷰에 남는다.**

> **문서 간 만료 규정 충돌 정리**
> POLICY §2.3(사용자가 고르는 값: 7/30/90일, A만 무기한)과 SECURITY §8.2(용도별 기본·상한: 조직 30/180 · 인계 14/60 · 외부 7/30 · 지원 15분)가 서로 다르다.
> **해소**: POLICY는 *사용자에게 보이는 선택지*, SECURITY는 *조직 정책이 강제하는 상한*으로 읽는다. DB에는 상한만 CHECK로 넣고(위), 기본값은 `orgs.default_link_expiry_days`(7~90 CHECK)에 둔다. 상한과 기본값을 같은 층에 두면 둘 중 하나가 반드시 조용히 무시된다.

```ts
/**
 * ★★ 원칙 5의 테이블. 감사 로그의 방향이 반대인 곳.
 * append-only. 소유자도 못 지운다 (POLICY §2.5) — §3.5에서 DELETE/UPDATE를 REVOKE한다.
 * 보이는 창 90일 / 원본 보관 1년 → §5.2에서 뷰로 가른다.
 */
export const viewLogs = pgTable('view_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull(),
  orgId: uuid('org_id').notNull(),
  /** ★ 소유자를 비정규화한다. 90일 창 뷰가 documents를 조인하지 않게 하려고 (§2.5) */
  docOwnerId: uuid('doc_owner_id').notNull(),

  /** 로그인 열람자. 비로그인이면 NULL */
  viewerId: uuid('viewer_id').references(() => users.id, { onDelete: 'set null' }),
  /** 비로그인 열람자의 신원 대체물. share_links.id (SECURITY §5.5 "토큰 ID") */
  shareLinkId: uuid('share_link_id').references(() => shareLinks.id, { onDelete: 'set null' }),
  /** kind='named' OTP 열람자. 로컬파트 마스킹 후 저장 — 'k***@partner.co.kr' */
  viewerEmailMasked: text('viewer_email_masked'),

  via: viewVia('via').notNull(),
  /** POLICY §1.3 장치 5 — 계정 가장 탐지용. IP 원본이 아니라 파생값 */
  sessionFingerprint: text('session_fingerprint'),
  /** ★ IP 원본 미저장. 해시 30일 후 NULL로 (SECURITY §8.4) */
  ipHash: text('ip_hash'),
  countryCode: text('country_code'),
  asn: integer('asn'),
  uaSummary: text('ua_summary'),                    // 'Chrome/macOS' 수준. full UA 금지

  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // ★ 소유자의 "누가 열어봤어요" 탭. 이 인덱스 하나가 원칙 5의 성능 전부다
  index('view_logs_owner_recent').on(t.docOwnerId, t.at.desc()),
  index('view_logs_doc').on(t.docId, t.at.desc()),
  // ★ 만들지 않는 인덱스: (viewerId, at) — §2.6 참조
]);
```
*왜 `docOwnerId` 비정규화인가* — 소유자 화면은 "내 **모든** 문서의 열람 기록"을 시간순으로 본다. `documents`를 조인하면 파티션된 테이블(§8.2)에 대한 조인이 되고, 파티션 pruning이 죽는다. **비정규화 한 컬럼이 파티션 프루닝을 살린다.**
*왜 `viewerId` 인덱스를 안 만드나* — 그게 "이 사람이 무엇을 열람했나"를 빠르게 만드는 인덱스이고, 그 질문은 이 제품이 답하지 않기로 한 질문이다(§12).

```ts
/** HANDOVER §11.1 — 종류·옵션·생성 시각·열람 수·피드백 */
export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').references(() => documents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  /** 'handover_doc'|'vacation_guide'|'pdf'|'png'|'summary_card'|'md'|'csv'|'book'|'agg_csv' */
  format: text('format').notNull(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** ★ 파일 본문을 DB에 넣지 않는다. S3 키만. 서명 URL 5분·1회성 (SECURITY §8.5) */
  objectKey: text('object_key'),
  viewCount: integer('view_count').notNull().default(0),
  feedback: text('feedback'),                        // 'useful'|'not_useful'|null
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** 보존 만료. 배치가 S3 오브젝트와 함께 지운다 */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('exports_user_month').on(t.createdBy, t.createdAt.desc()),
  // ★ 조직 집계 export 월 20회 상한 카운트 (POLICY §8.2 차분 공격 방어)
  index('exports_org_agg').on(t.orgId, t.createdAt.desc())
    .where(sql`${t.format} = 'agg_csv'`),
  index('exports_expiring').on(t.expiresAt),
]);
```
*왜 `expiresAt`이 NOT NULL인가* — 내보내기 파일은 L3(기밀)이고 조직 밖으로 나갈 수 있는 유일한 실물이다. 만료가 nullable이면 만료 없는 파일이 반드시 생긴다. **"영원히 남는 옵션"을 스키마에서 없애는 것이 정책보다 싸다.**

```ts
/** POLICY §1.5 — 부서 자동 공유의 대체물. 소유자가 스스로 올리는 것만 */
export const teamShelf = pgTable('team_shelf', {
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  deptId: uuid('dept_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  /** ★ 반드시 소유자 본인. §3.4의 WITH CHECK가 강제한다 */
  postedBy: uuid('posted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.docId, t.deptId] }),
  index('team_shelf_dept').on(t.deptId, t.at.desc()),
]);
```
*왜* — POLICY §1.1 A는 "팀 서재에서 남의 문서 내리기 ✗"를 전 역할에 대해 못 박는다. 그래서 이 테이블에는 `removedBy`가 없다. **내릴 수 있는 사람이 소유자뿐이면, 내린 사람을 기록할 컬럼이 필요 없다.**

---

### 1.6 운영 로그 — operations · snapshots · 레이아웃

```ts
// db/schema/ops.ts
/**
 * 핫 경로. append-only op 로그 (ARCHITECTURE §2).
 * ★ 파티션 대상 (§8.2). PK에 파티션 키가 들어가야 하므로 (docId, seq)가 아니라
 *   (docId, seq, ts)로 간다 — Postgres는 파티션 테이블의 UNIQUE에 파티션 키 포함을 요구한다.
 */
export const operations = pgTable('operations', {
  docId: uuid('doc_id').notNull(),
  /** 문서별 단조 증가. revision과 다르다 — revision은 배치 단위, seq는 op 단위 */
  seq: integer('seq').notNull(),
  orgId: uuid('org_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  /**
   * { type, payload }. type은 GRAPH-CORE §8.2의 21종.
   * ★ 자유 텍스트가 아니라 CHECK로 닫는다 — 모르는 op이 로그에 들어가면 재생이 실패한다
   */
  op: jsonb('op').$type<{ type: string; payload: unknown }>().notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.docId, t.seq, t.ts] }),
  index('operations_doc_seq').on(t.docId, t.seq),
  check('operations_op_type', sql`${t.op}->>'type' IN (
    'insert_item','delete_item','restore_item','move_item','reorder_item',
    'set_title','set_kind','set_attr','set_assignee','set_duration','set_tools',
    'toggle_pain','confirm_item',
    'add_edge','remove_edge','suppress_edge','unsuppress_edge')`),
]);
```
> DDL: `CREATE TABLE operations (...) PARTITION BY RANGE (ts);` — Drizzle이 표현하지 못하므로 §7.2의 손수 쓴 마이그레이션으로 만든다.

*왜 op type을 CHECK로 닫나* — `operations`는 **복원의 유일한 원천**이다(스냅샷 + 이후 op 재생). 리듀서가 모르는 `type`이 한 건이라도 들어가면 그 시점 이후의 재생이 전부 실패하고, 그건 데이터 손실이다. 클라이언트가 보내는 값이므로 애플리케이션 검증만으로는 부족하다.

```ts
/** 콜드. 명시적 저장 시점 또는 N개 op마다 문서 전체 JSON */
export const snapshots = pgTable('snapshots', {
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  orgId: uuid('org_id').notNull(),
  doc: jsonb('doc').$type<DocumentSnapshot>().notNull(),
  /** ★ 이 스냅샷이 커버하는 마지막 op의 seq. §8.2의 파티션 드롭 가드가 읽는다 */
  throughSeq: integer('through_seq').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.docId, t.revision] }),
  index('snapshots_doc_latest').on(t.docId, t.revision.desc()),
]);
```
**스냅샷 주기 — 문서에 없던 값을 여기서 정한다: `N = 50` op 또는 24시간 중 먼저 오는 쪽.**
*근거* — 배치 상한이 200 op(ARCHITECTURE §6)이므로 50이면 최악 4배치마다 한 번이다. 재생 비용은 op 50개 × `derive()` 1.5ms(504항목 기준) ≈ 무시 가능. 반대로 500으로 잡으면 파티션 드롭(§8.2)이 500 op만큼 막힌다. **스냅샷 주기는 성능 파라미터가 아니라 보존 정책 파라미터다.**

```ts
/**
 * GRAPH-CORE §11 — 레이아웃.
 * ★ 자동 캐시와 수동 좌표를 같은 테이블에 두지 않는다.
 *   "자동 배치로 되돌리기"가 한 번의 DELETE가 되어야 하기 때문이다.
 */
export const layoutCache = pgTable('layout_cache', {
  docId: uuid('doc_id').primaryKey().references(() => documents.id, { onDelete: 'cascade' }),
  /** ELK 결과. 최초 렌더에서 ELK를 기다리지 않기 위한 캐시일 뿐 — SoT 아님 */
  positions: jsonb('positions').$type<Record<string, { x: number; y: number }>>().notNull(),
  /** 이 캐시가 어느 트리 모양에 대한 것인가. 불일치하면 그냥 버린다 */
  topologyHash: text('topology_hash').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const layoutOverrides = pgTable('layout_overrides', {
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),                 // items.id 또는 'join:{uuid}'
  x: real('x').notNull(),
  y: real('y').notNull(),
  setBy: uuid('set_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.docId, t.nodeId] })]);
```
*왜 두 테이블인가* — 하나로 두면 "자동 배치로 되돌리기"가 `UPDATE ... WHERE is_manual`이 되고, 그건 캐시 무효화와 사용자 의도를 같은 트랜잭션에서 다루게 만든다. 두 테이블이면 `DELETE FROM layout_overrides WHERE doc_id = $1` 한 줄이다.

---

### 1.7 체크리스트 · 신선도 · 알림 · 신고 · 봉인

```ts
/**
 * ★★ POLICY §6.4 — 체크리스트 실행 기록은 **개인 데이터**다.
 * 집계에 들어가지 않고, 소유권 이전 시 따라오지 않으며(삭제), 퇴사 시 자동 삭제되고,
 * 편집자에게도 관리자에게도 봉인 열람으로도 보이지 않는다.
 * → RLS 정책이 소유자 단일 조건 하나뿐인 유일한 테이블 (§3.4).
 */
export const checklistRuns = pgTable('checklist_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  /** ★ 실행자 = 열람 권한자 누구나. 하지만 자기 실행 기록만 본다 */
  runnerId: uuid('runner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
  checkedItemIds: uuid('checked_item_ids').array().notNull().default(sql`'{}'`),
  correctionCount: integer('correction_count').notNull().default(0),
  /** 'ok'|'not_me' — POLICY: '이번엔 제가 아니에요' */
  outcome: text('outcome'),
}, (t) => [
  index('checklist_runs_runner').on(t.runnerId, t.startedAt.desc()),
  // ★ 자동 아카이브 판정(12개월 무활동)이 읽는 유일한 경로. 실행자 정보 없이 시각만
  index('checklist_runs_doc_time').on(t.docId, t.startedAt.desc()),
]);
```
*왜 `runnerId`인가(소유자가 아니라)* — 체크리스트는 인계받은 사람도 돌린다. 그리고 **그 사람의 실행 기록은 그 사람 것**이다. `docOwnerId`로 묶으면 소유자가 남의 실행 기록을 보게 되고, 그건 원칙 1의 반대 방향 위반이다.

```ts
/**
 * PRD §4.10 / POLICY §7.1 — 신선도.
 * ★ 계산은 단계 단위(items.last_confirmed_at), 질문은 문서 단위.
 *   주기 판정(30/90/180일)에 필요한 파생값만 여기 캐시한다.
 */
export const freshnessState = pgTable('freshness_state', {
  docId: uuid('doc_id').primaryKey().references(() => documents.id, { onDelete: 'cascade' }),
  /** 30 | 90 | 180 */
  cycleDays: integer('cycle_days').notNull().default(90),
  /** 연속 '맞음' 횟수. 2회 연속이면 180일로 완화 (POLICY §7.1) */
  consecutiveOk: integer('consecutive_ok').notNull().default(0),
  /** 최근 90일 내 단계 수정 횟수 — 30일 주기 판정 입력 */
  edits90d: integer('edits_90d').notNull().default(0),
  lastPromptedAt: timestamp('last_prompted_at', { withTimezone: true }),
  nextDueAt: timestamp('next_due_at', { withTimezone: true }),
}, (t) => [
  // ★ 프롬프트 발송 배치가 도는 유일한 인덱스
  index('freshness_due').on(t.nextDueAt),
  check('freshness_cycle', sql`${t.cycleDays} IN (30, 90, 180)`),
]);

/** POLICY §3.1 — 외부 채널 합산 주 3건 상한 */
export const notificationBudget = pgTable('notification_budget', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** ISO week. date_trunc('week', ...) 결과를 date로 */
  week: text('week').notNull(),                      // '2026-W34'
  sentCount: integer('sent_count').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.week] }),
  // ★ 상한을 DB가 안다. 애플리케이션 카운터는 재시도에서 반드시 새어나간다
  check('notification_budget_cap', sql`${t.sentCount} <= 3`),
]);
```
*왜 상한이 CHECK인가* — 알림 상한은 신뢰 장치다(POLICY §3). 애플리케이션에서만 세면 워커 재시도·중복 실행에서 4번째가 나간다. **CHECK면 4번째 UPDATE가 실패하고, 실패는 알림이 안 가는 쪽으로 떨어진다 — 안전한 방향이다.**

```ts
export const notificationPrefs = pgTable('notification_prefs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** POLICY §3.2의 14종 */
  kind: text('kind').notNull(),
  channel: text('channel').notNull(),                // 'inapp'|'slack'|'email'
  enabled: boolean('enabled').notNull().default(true),
}, (t) => [
  primaryKey({ columns: [t.userId, t.kind, t.channel] }),
  check('notification_prefs_channel', sql`${t.channel} IN ('inapp','slack','email')`),
  // ★ 계정·보안과 SCIM 실패는 끌 수 없다 (POLICY §3.1 상한 예외)
  check('notification_prefs_mandatory',
    sql`${t.enabled} OR ${t.kind} NOT IN ('account_security','scim_failure')`),
]);

/** POLICY §4.5 — 신고. 지정 창구가 받는다 */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  /** ★ 발췌 범위를 행으로 고정한다. '문서 전문'을 넘길 방법이 스키마에 없다 */
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  state: text('state').notNull().default('open'),    // 'open'|'notified'|'resolved'|'escalated'
  ownerNotifiedAt: timestamp('owner_notified_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // POLICY §4.5 — 같은 사람 × 같은 문서 1회
  uniqueIndex('reports_once').on(t.docId, t.reporterId),
  index('reports_org_open').on(t.orgId, t.createdAt).where(sql`${t.state} = 'open'`),
]);
```
*왜 `itemId`가 있나* — POLICY §1.1 A-5는 "문서 전문이 아니라 **신고된 구절 + 앞뒤 1단계**"라고 못 박는다. `itemId`가 없으면 발췌 범위를 계산할 근거가 없고, 근거가 없으면 구현은 결국 문서 전체를 넘긴다.

```ts
/** POLICY §6.2 — 퇴사자 문서 봉인 열람. 2인 승인 */
export const sealApprovals = pgTable('seal_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  /** ★ 요청자는 승인자가 될 수 없다 (SECURITY §5.4d) */
  approvedBy1: uuid('approved_by_1').references(() => users.id, { onDelete: 'restrict' }),
  approvedBy2: uuid('approved_by_2').references(() => users.id, { onDelete: 'restrict' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** 퇴사 후 90일 내에만 요청 가능. 승인 후 유효창 */
  grantExpiresAt: timestamp('grant_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('seal_approvals_org').on(t.orgId, t.createdAt.desc()),
  check('seal_approvals_two_person', sql`
    (${t.approvedAt} IS NULL) OR (
      ${t.approvedBy1} IS NOT NULL AND ${t.approvedBy2} IS NOT NULL
      AND ${t.approvedBy1} <> ${t.approvedBy2}
      AND ${t.approvedBy1} <> ${t.requestedBy}
      AND ${t.approvedBy2} <> ${t.requestedBy})`),
]);
```
*왜 2인 승인이 CHECK인가* — 이 조건은 이 제품에서 **관리자가 남의 문서를 여는 유일한 경로**다. 애플리케이션 코드 한 줄이 이 경로의 전부라면, 그 한 줄이 6개월 뒤 리팩터링에서 사라진다. **가장 위험한 경로일수록 조건은 DB에 있어야 한다.**

---

### 1.8 비공개 노트(L4) · 봉투 암호화 키

```ts
// db/schema/secret.ts
/**
 * ★★ SECURITY §4.3 — L4. 유일한 애플리케이션 레벨 암호화 대상.
 * items.attrs.private_note가 아니라 **별도 테이블**인 이유가 이 설계의 핵심이다:
 *   1. jsonb 안에 있으면 컬럼 레벨 REVOKE를 걸 수 없다. 별도 테이블이면 걸 수 있다
 *   2. items를 SELECT하는 코드 경로가 노트를 함께 끌고 오지 않는다 (실수로도)
 *   3. 소유권 이전 시 자동 파기가 DELETE 한 줄이 된다 (jsonb면 UPDATE ... - 'private_note')
 *   4. 백업·덤프에서 이 테이블만 제외하는 선택지가 생긴다
 */
export const privateNotes = pgTable('private_notes', {
  itemId: uuid('item_id').primaryKey().references(() => items.id, { onDelete: 'cascade' }),
  docId: uuid('doc_id').notNull(),
  orgId: uuid('org_id').notNull(),
  /** ★ 소유자. RLS의 유일한 조건 (§3.4) */
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  /** AES-256-GCM ciphertext + tag. ★ DB에는 복호화 수단이 없다 (§6.3) */
  ciphertext: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('ciphertext').notNull(),
  /** nonce = doc_id || item_id || rev (SECURITY §4.3). 저장은 실제 사용된 12바이트 */
  nonce: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('nonce').notNull(),
  /** aad = org_id || item_id. 값이 아니라 어떤 aad를 썼는지의 버전만 남긴다 */
  aadVersion: integer('aad_version').notNull().default(1),
  /** 어느 DEK로 잠겼는가. 재암호화(연 1회 회전)의 진행 커서 */
  dekId: uuid('dek_id').notNull(),
  alg: text('alg').notNull().default('AES-256-GCM'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('private_notes_owner').on(t.ownerId),
  // ★ 키 회전 배치의 커서
  index('private_notes_dek').on(t.dekId),
  check('private_notes_alg', sql`${t.alg} = 'AES-256-GCM'`),
  check('private_notes_nonce_len', sql`octet_length(${t.nonce}) = 12`),
  // ★ 인덱스를 만들 수 없다 — ciphertext는 정의상 검색 불가능하다. 그게 목적이다
]);

/** 조직 DEK. wrapped 상태로만 저장된다 (SECURITY §4.4) */
export const orgDeks = pgTable('org_deks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  /** ★ KMS CMK로 봉투 암호화된 DEK. 평문 DEK는 DB에 존재하지 않는다 */
  wrappedDek: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('wrapped_dek').notNull(),
  kmsKeyArn: text('kms_key_arn').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** 재암호화 완료 후 이 시각에 wrapped_dek를 NULL로 덮고 파기 기록을 남긴다 */
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('org_deks_org_version').on(t.orgId, t.version),
  uniqueIndex('org_deks_org_active').on(t.orgId)
    .where(sql`${t.retiredAt} IS NULL`),
  check('org_deks_destroyed_is_null',
    sql`${t.destroyedAt} IS NULL OR ${t.wrappedDek} = '\\x'::bytea`),
]);
```
*왜 `org_deks_org_active` 부분 유니크인가* — 활성 DEK가 2개인 순간이 있으면 어떤 노트가 어느 키로 잠겼는지 애플리케이션이 추측하게 된다. **활성 키는 항상 정확히 하나**임을 DB가 보장하고, 회전 중에는 `dekId`로 개별 추적한다.

```ts
/**
 * org_salt는 DB에 없다 — Secrets Manager에 있다 (SECURITY §4.4).
 * DB에는 회전 이력만 남긴다. 값이 없어야 DB 유출이 재식별로 이어지지 않는다.
 */
export const orgSaltRotations = pgTable('org_salt_rotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  secretRef: text('secret_ref').notNull(),           // Secrets Manager ARN. 값 아님
  rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
  /** ★ 구 salt 파기 시각. 이게 "1년 이상 개인 추적 불가"의 증빙이다 */
  previousDestroyedAt: timestamp('previous_destroyed_at', { withTimezone: true }),
}, (t) => [uniqueIndex('org_salt_rotations_org_version').on(t.orgId, t.version)]);
```
*왜 값이 없는 테이블을 만드나* — **파기했다는 사실을 증명할 수 있어야** 12개월 회전 약속이 감사에서 성립한다. 값은 없고 파기 시각만 있는 테이블이 정확히 그 증빙이다.

---

### 1.9 집계 소스 — 프로세스 롤업 · 기간 프리셋

```ts
// db/schema/agg.ts
/**
 * ★ 기간은 테이블이다. 함수도 파라미터도 아니다 (MEASUREMENT §3 방어 1).
 *   nightly 배치가 last30/90/365의 경계를 재계산하고, YYYY-MM은 확정되면 불변이다.
 */
export const periodPresets = pgTable('period_presets', {
  key: text('key').primaryKey(),                     // 'last30'|'last90'|'last365'|'2026-07'
  family: periodFamily('family').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  /** YYYY-MM은 월이 끝나면 확정되어 다시 계산되지 않는다 */
  frozen: boolean('frozen').notNull().default(false),
}, (t) => [
  check('period_presets_key_shape', sql`
    ${t.key} IN ('last30','last90','last365')
    OR ${t.key} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('period_presets_ordered', sql`${t.startsAt} < ${t.endsAt}`),
]);
```
*왜 CHECK 정규식인가* — `period_key`가 자유 문자열이면 `'2026-07-14..2026-07-15'` 같은 값이 들어올 수 있고, 그 순간 **하루씩 밀어가며 차분하는 공격**이 열린다. MEASUREMENT §3이 "대부분의 구현이 여기서 뚫린다"고 지목한 지점이다. 정규식 CHECK가 그 문을 닫는다.

```ts
/**
 * 프로세스 롤업. nightly 재계산.
 * ★ owner_id / doc_id를 여기서 끊지 않는다 — 끊으면 k 판정을 할 수 없다.
 *   대신 이 테이블 자체가 admin_reader에게 보이지 않는다 (§3.2).
 */
export const processRollup = pgTable('process_rollup', {
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull().references(() => periodPresets.key, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  /** 프로세스 키. 문서 제목이 아니라 정규화된 업무 유형 (SECURITY §1.1 L1) */
  processKey: text('process_key').notNull(),
  /** ★ 작성 시점 부서 스냅샷. documents.dept_id_at_write에서 온다 */
  deptId: uuid('dept_id'),
  ownerId: uuid('owner_id').notNull(),

  leadTimeH: real('lead_time_h'),
  stepCount: integer('step_count').notNull(),
  handoffCount: integer('handoff_count').notNull().default(0),
  painCount: integer('pain_count').notNull().default(0),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.docId, t.periodKey] }),
  // ★ 집계 뷰의 소스 쿼리가 타는 인덱스 (§2.4)
  index('process_rollup_agg').on(t.orgId, t.periodKey, t.processKey, t.deptId),
]);
```
*왜 `ownerId`가 롤업에 남아 있나* — `count(DISTINCT owner_id) >= 5`가 k 판정의 정의이기 때문이다. **k를 계산하려면 개인 식별자가 필요하다.** 해결은 "식별자를 지우기"가 아니라 "식별자를 가진 테이블을 관리자에게 절대 노출하지 않기"다(§3.2). 이 구분이 §12에서 다시 나온다.

> **기여자 정의 충돌 정리** — TRUST §2.1은 `count(DISTINCT assignee_id)`, MEASUREMENT §3과 ASSEMBLY §8.4는 `count(DISTINCT owner_id)`를 쓴다.
> **해소: `owner_id`로 통일한다.** 근거 — 담당자는 그 문서를 쓰지 않았을 수 있다(남이 나를 담당자로 지목). 담당자로 k를 세면 **동의하지 않은 사람으로 익명성을 채우게** 되고, 5명 중 4명이 "지목당한 사람"인 셀이 나온다. 그건 k=1이다. 기여자는 **쓴 사람**이다.

---

### 1.10 감사 — `audit` 스키마

```ts
// db/schema/audit.ts — 전부 audit 스키마에 산다
import { pgSchema } from 'drizzle-orm/pg-core';
export const auditSchema = pgSchema('audit');

/**
 * ★★ append-only. 파티션(월). 아무도 UPDATE·DELETE 할 수 없다 (§5.3).
 * 카테고리마다 보존이 다르므로 retention_years를 행에 박는다 —
 * 파티션 드롭이 "가장 긴 보존"에 맞춰지면 1년 데이터가 3년 남는다.
 */
export const auditLogs = auditSchema.table('audit_logs', {
  id: uuid('id').notNull().defaultRandom(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  orgId: uuid('org_id'),

  /** SECURITY §5.5의 카테고리 */
  category: text('category').notNull(),
  action: text('action').notNull(),

  actorKind: auditActorKind('actor_kind').notNull(),
  actorId: uuid('actor_id'),
  /** 비로그인 열람자의 토큰 ID */
  actorTokenId: uuid('actor_token_id'),

  targetType: text('target_type'),                   // 'document'|'item'|'user'|'view'|'role'
  targetId: text('target_id'),
  /** ★ 본문을 넣지 않는다. CHECK로 막는다 (아래) */
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

  /** SECURITY §5.5 — 카테고리별 1년 또는 3년 */
  retentionYears: integer('retention_years').notNull(),

  /** §5.3 해시 체인 */
  prevHash: text('prev_hash'),
  rowHash: text('row_hash').notNull(),
}, (t) => [
  primaryKey({ columns: [t.id, t.ts] }),
  index('audit_logs_org_ts').on(t.orgId, t.ts.desc()),
  index('audit_logs_actor').on(t.actorId, t.ts.desc()),
  index('audit_logs_target').on(t.targetType, t.targetId, t.ts.desc()),
  index('audit_logs_retention').on(t.retentionYears, t.ts),
  check('audit_logs_retention_values', sql`${t.retentionYears} IN (1, 3)`),
  // ★ 본문·개인 식별 텍스트가 detail에 들어오면 INSERT가 실패한다
  check('audit_logs_detail_no_content', sql`NOT (${t.detail} ?| array[
    'title','item_title','text','content','body','paste','note','private_note',
    'email','name','employee_no'])`),
  check('audit_logs_category', sql`${t.category} IN (
    'doc_view','share_link','role_change','break_glass','admin_query',
    'delete_restore','auth','key_use','private_note_decrypt','scim_sync',
    'seal_access','export','policy_change')`),
]);
```
> DDL: `PARTITION BY RANGE (ts)` — §8.2.

*왜 `detail`에 CHECK가 붙나* — 감사 로그는 **가장 오래 남고 가장 널리 읽히는 테이블**이다(보안 담당 2인 + 조직 관리자). 여기에 본문이 한 번 새면 그 본문은 3년 동안 L3 통제 밖에 있게 된다. SECURITY §5.2가 로거에 레드액션을 걸라고 한 것의 DB판이다.

```ts
/**
 * MEASUREMENT §3 마지막 문단 — 관리자 집계 쿼리는 전량 로그.
 * ★ 이 테이블의 존재 목적은 감시가 아니라 **증명**이다:
 *   "관리자 뷰가 개인을 조회할 수 없었음"을 인사팀에 월간 공개한다.
 */
export const adminQueryLogs = auditSchema.table('admin_query_logs', {
  id: uuid('id').notNull().defaultRandom(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  orgId: uuid('org_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  /** 어느 뷰를 읽었는가. base 테이블 이름이 여기 나타나면 그 자체가 P0 경보다 */
  viewName: text('view_name').notNull(),
  axis: aggAxis('axis').notNull(),
  periodKey: text('period_key').notNull(),
  /** ★ 최대 2개 (MEASUREMENT §3 방어 2) — CHECK로 강제 */
  filters: jsonb('filters').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  returnedCells: integer('returned_cells').notNull(),
  /** ★ 억제된 셀 수. export 하단에 인쇄되는 "계산하지 않은 항목 N개"의 원천 */
  suppressedCells: integer('suppressed_cells').notNull(),
}, (t) => [
  primaryKey({ columns: [t.id, t.ts] }),
  index('admin_query_logs_org_ts').on(t.orgId, t.ts.desc()),
  check('admin_query_logs_max_two_filters',
    sql`(SELECT count(*) FROM jsonb_object_keys(${t.filters})) <= 2`),
  check('admin_query_logs_view_is_agg', sql`${t.viewName} LIKE 'agg.%'`),
]);
```
*왜 `view_name LIKE 'agg.%'` CHECK인가* — 관리자 경로가 base 테이블을 읽는 일은 **일어날 수 없다**(§3.2의 GRANT 구조상). 그런데도 CHECK를 두는 이유는, 만약 일어났다면 **로그를 쓰는 순간 트랜잭션이 실패해서 그 쿼리 자체가 롤백되기** 때문이다. 탐지가 아니라 차단이다.

```ts
/** SECURITY §2.6 — 파기 대장. 3년 보관, WORM */
export const destructionLedger = auditSchema.table('destruction_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  /** 'L2'|'L3'|'L4'|'P1'|'attachment'|'export'|'share_link' */
  category: text('category').notNull(),
  scopeRef: text('scope_ref').notNull(),             // 테넌트 ID 또는 pid 범위
  rowCount: integer('row_count').notNull(),
  method: text('method').notNull(),                  // 'physical'|'object'|'key_destroy'
  basis: text('basis').notNull(),                    // 'owner_request'|'retention'|'contract_end'
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  executedBy: text('executed_by').notNull(),         // 배치 잡 ID 또는 담당자
  approvedBy: uuid('approved_by'),
  /** 대상 조회 시 0건임을 보이는 쿼리와 결과 */
  verificationQuery: text('verification_query').notNull(),
  verificationResultHash: text('verification_result_hash').notNull(),
  backupPurgeDueAt: timestamp('backup_purge_due_at', { withTimezone: true }),
}, (t) => [index('destruction_ledger_org').on(t.orgId, t.executedAt.desc())]);

/**
 * SECURITY §2.5 / MEASUREMENT §3 — 문서 삭제 시 P1(PostHog)에서 24시간 내 물리 삭제.
 * ★ P1은 Postgres에 없다. 여기 있는 것은 "지워야 할 것의 목록"뿐이다.
 *   그리고 그 목록에 pid만 있고 원본 ID가 없는 것이 요점이다.
 */
export const p1DeletionQueue = auditSchema.table('p1_deletion_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** HMAC(doc_id, org_salt) / HMAC(user_id, org_salt) */
  pid: text('pid').notNull(),
  pidKind: text('pid_kind').notNull(),               // 'doc'|'actor'
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
  /** 24시간 SLA. 넘으면 P0 */
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('p1_deletion_pending').on(t.dueAt).where(sql`${t.completedAt} IS NULL`),
  check('p1_deletion_kind', sql`${t.pidKind} IN ('doc','actor')`),
]);
```
*왜 큐에 pid만 넣나* — 큐에 `doc_id`를 넣으면 이 테이블이 **삭제된 문서 ID의 목록**이 되고, 그건 지운 사람이 뭘 지웠는지의 기록이다. pid만 넣으면 salt 회전 후 그 목록조차 의미를 잃는다.

---

### 1.11 요율 제한 · 조직 지도 캐시 (보조)

```ts
/** POLICY §10.3 — 상한을 DB가 세고, DB가 거절한다 */
export const rateCounters = pgTable('rate_counters', {
  scope: text('scope').notNull(),        // 'user:export_day'|'org:agg_export_month'|'user:invite_month'
  subjectId: uuid('subject_id').notNull(),
  bucket: text('bucket').notNull(),      // '2026-08-17' | '2026-08'
  count: integer('count').notNull().default(0),
  limitValue: integer('limit_value').notNull(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.subjectId, t.bucket] }),
  // ★ 한도 초과가 UPDATE 실패로 떨어진다
  check('rate_counters_within_limit', sql`${t.count} <= ${t.limitValue}`),
]);
```
*왜* — 요율 제한은 대개 Redis에 둔다. 하지만 **조직 집계 export 월 20회는 성능 장치가 아니라 차분 공격 방어**다(POLICY §8.2). 방어 장치가 캐시에 있으면 캐시가 비는 날 방어도 빈다.

```ts
/** ASSEMBLY §6 — 조직 뷰 지표 롤업 캐시. 조직 그래프 자체는 저장하지 않는다 */
export const orgMapRollup = pgTable('org_map_rollup', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull().references(() => periodPresets.key, { onDelete: 'cascade' }),
  deptPair: text('dept_pair').notNull(),             // canonical_dept_pair() 결과
  objectId: uuid('object_id'),
  linkN: integer('link_n').notNull(),
  contributorN: integer('contributor_n').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.periodKey, t.deptPair, t.objectId] }),
]);
```

**`canonical_dept_pair()`** — ASSEMBLY가 참조하지만 정의하지 않은 함수. 여기서 정의한다.

```sql
CREATE FUNCTION agg.canonical_dept_pair(a uuid, b uuid)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL THEN NULL
    WHEN a <= b THEN a::text || '|' || b::text
    ELSE b::text || '|' || a::text
  END
$$;
```
*왜 IMMUTABLE인가* — 표현식 인덱스와 `GROUP BY`에서 쓰이므로 IMMUTABLE이 아니면 플래너가 매번 재평가한다. 그리고 정렬 정규화가 함수 안에 있어야 **"A→B"와 "B→A"가 같은 셀로 합쳐진다** — 합쳐지지 않으면 각 방향이 k 미만이 되어 불일치 리포트가 영원히 안 나온다.

---

## 2. 인덱스 전략

### 2.0 먼저 쿼리 패턴을 전부 적는다

인덱스를 먼저 설계하면 반드시 안 쓰는 인덱스가 생긴다. **쿼리를 먼저 열거하고, 각 쿼리에 인덱스를 하나씩 붙인다.**

| # | 쿼리 | 빈도 | 지연 목표 | 인덱스 |
|---|---|---|---|---|
| Q1 | 내 문서함 (최신순, tombstone·아카이브 제외) | 매 세션 | p95 20ms | `documents_owner_active` |
| Q2 | 문서 하나의 트리 전체 (순회 순서) | 매 문서 열람 | p95 15ms | `items_tree` |
| Q3 | 문서 하나의 명시 엣지 | Q2와 항상 함께 | p95 5ms | `edges_doc` |
| Q4 | 공유 토큰 → 문서 | 매 공유 페이지 | p95 5ms | `share_links_token` |
| Q5 | 내가 멤버인 문서 (RLS 내부) | 매 쿼리 | — | `document_members_user` |
| Q6 | 내 문서들의 열람 로그 90일 | 낮음 | p95 50ms | `view_logs_owner_recent` |
| Q7 | op 재생 (스냅샷 이후) | 복원·undo | p95 30ms | `operations_doc_seq` |
| Q8 | 집계 뷰 소스 (nightly) | 1일 1회 | 배치 5분 | `process_rollup_agg` |
| Q9 | 접합 후보 블로킹 | nightly | 배치 10분 | `sart_norm`, `sockets_party` |
| Q10 | 신선도 프롬프트 대상 | 1일 1회 | 배치 1분 | `freshness_due` |
| Q11 | 만료 예정 링크 스위퍼 | 1시간 1회 | 배치 10초 | `share_links_expiring` |
| Q12 | 조직 내 도구·용어 검색 (자기 조직 안) | 낮음 | p95 30ms | `tools_scope_norm`, `glossary_org_term` |
| Q13 | 조직 지도 (confirmed 링크) | 낮음 | p95 200ms | `links_org_live` |

**여기 없는 쿼리는 인덱스를 만들지 않는다.** 특히 "조직 전체 문서 검색"은 이 표에 없다 — §2.6.

### 2.1 트리 순회 — `(docId, parentId, sortKey)`

```sql
CREATE INDEX items_tree ON items (doc_id, parent_id, sort_key)
  WHERE deleted_at IS NULL;
```

**컬럼 순서의 근거**
1. `doc_id` — 등가 조건. 항상 하나의 문서만 읽는다. 선두여야 한다
2. `parent_id` — 등가 조건. 형제 그룹을 고른다
3. `sort_key` — **범위·정렬** 조건. 반드시 마지막

등가 → 등가 → 정렬 순서를 어기면 `ORDER BY sort_key`에 별도 정렬 노드가 붙는다. 40,000행 규모에서는 몇 ms지만, **`sort_key`가 `COLLATE "C"`가 아니면 정렬 결과 자체가 틀린다**(§1.0) — 성능이 아니라 정확성 문제다.

**커버링으로 만들지 않는 이유** — `INCLUDE (title, kind, assignee_id, duration_band, attrs)`를 붙이면 index-only scan이 되지만, `attrs`가 jsonb라 인덱스가 힙만큼 커진다. 항목 40,000개면 힙 자체가 수 MB고 전부 shared_buffers에 있다. **작은 테이블에 커버링 인덱스는 순손실이다.**

*재귀 순회가 필요한가* — 아니다. `derive()`는 한 문서의 모든 항목을 메모리로 올려서 트리를 만든다(504항목 1.54ms). `WITH RECURSIVE`를 쓸 이유가 없고, 쓰면 정렬이 CTE 안으로 들어가서 `COLLATE` 실수가 숨는다.

### 2.2 tombstone 제외 — 부분 인덱스만 쓴다

```sql
CREATE INDEX documents_owner_active ON documents (created_by, updated_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX items_sibling_order ON items (doc_id, parent_id, sort_key)
  WHERE deleted_at IS NULL;
```

**부분 인덱스인 이유**
- tombstone 행은 전체의 5~15% 정도이지만 **영원히 남는다**(30일 후 물리 삭제되는 것은 문서 단위이고, 항목 tombstone은 CRDT 전제라 남는다). 인덱스에서 빼면 인덱스가 계속 작다
- 더 중요한 것: `WHERE deleted_at IS NULL`이 인덱스 정의에 있으면 **그 조건을 빠뜨린 쿼리는 이 인덱스를 못 쓴다.** 느려진다 → EXPLAIN에서 보인다 → 리뷰에서 잡힌다. **인덱스가 코드 리뷰어 역할을 한다**

`items_sibling_order`가 부분 유니크인 것은 §1.3에서 설명한 대로 삭제 후 재삽입을 가능하게 하기 위해서다.

**`deleted_at IS NOT NULL` 인덱스를 만들지 않는다** — "휴지통 보기"는 소유자당 몇 건이고 `documents_owner_active`를 못 쓰는 대신 그냥 `created_by` 스캔이면 된다. 30일짜리 화면을 위해 영구 인덱스를 만들지 않는다.

### 2.3 RLS가 타는 인덱스 — 가장 뜨겁고 가장 자주 잊힌다

RLS 정책은 **모든 쿼리의 모든 행에 대해 평가된다.** 정책 안의 서브쿼리가 seq scan이면 제품 전체가 느려지고, 원인이 EXPLAIN 최상단에 안 나타나서 찾기 어렵다.

```sql
-- documents 정책이 타는 것
CREATE INDEX document_members_user ON document_members (user_id, doc_id);
--  PK는 (doc_id, user_id)다. 반대 순서 인덱스가 없으면
--  "내가 멤버인 문서" 판정이 매번 전체 스캔이 된다

-- items 정책이 타는 것 — documents의 PK로 충분하다
--  EXISTS (SELECT 1 FROM documents d WHERE d.id = items.doc_id AND <documents 정책>)
--  → documents_pkey nested loop. 별도 인덱스 불필요
```

**측정 방법** — `EXPLAIN (ANALYZE, BUFFERS)`에서 정책 서브플랜이 `Index Scan`이 아니면 즉시 고친다. CI에 다음을 넣는다:

```sql
-- 정책 서브플랜에 Seq Scan이 없어야 한다
EXPLAIN (FORMAT JSON) SELECT * FROM documents LIMIT 50;
```

### 2.4 집계 뷰의 소스 쿼리

```sql
CREATE INDEX process_rollup_agg
  ON process_rollup (org_id, period_key, process_key, dept_id);
```

**순서의 근거** — 집계 쿼리는 `WHERE org_id = ? AND period_key = ?` (등가 2개) → `GROUP BY process_key, dept_id`다. 등가 조건이 앞, 그룹 키가 뒤. 이 순서면 Postgres가 인덱스 순서를 그대로 써서 **정렬 없는 GroupAggregate**를 만든다.

집계는 nightly 배치라 지연이 문제가 아니지만, **정렬 없는 집계는 work_mem 초과 시 디스크 스필이 없다**는 것이 값어치다. 스필이 시작되면 배치 시간이 예측 불가능해지고, 예측 불가능한 배치는 결국 낮에 돌게 된다.

```sql
-- 접합 집계 (agg_seam_discrepancy)
CREATE INDEX links_org_live ON handoff_links (org_id, last_verified_at)
  WHERE status IN ('confirmed','auto');
CREATE INDEX disc_org_sev ON discrepancies (org_id, severity, status)
  WHERE status = 'open';
```
부분 인덱스인 이유는 §2.2와 같다 — `candidate` 링크가 confirmed보다 10~50배 많고, 집계는 confirmed만 본다.

### 2.5 스위퍼·배치 인덱스는 전부 부분 인덱스

```sql
CREATE INDEX share_links_expiring ON share_links (expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
CREATE INDEX freshness_due ON freshness_state (next_due_at);
CREATE INDEX p1_deletion_pending ON audit.p1_deletion_queue (due_at)
  WHERE completed_at IS NULL;
CREATE INDEX exports_expiring ON exports (expires_at);
```

**원리** — 배치는 "아직 처리 안 된 것"만 본다. 처리된 행이 99%가 되어도 인덱스는 1%만 유지한다. `p1_deletion_pending`이 특히 중요한데, 이 큐는 24시간 SLA가 걸려 있고 **비어 있는 것이 정상**이다. 부분 인덱스면 정상 상태에서 인덱스가 거의 0 페이지다.

### 2.6 만들지 않기로 한 인덱스 — 그리고 그 이유

| 만들지 않는 인덱스 | 그 인덱스가 빠르게 만들 질문 | 왜 안 만드나 |
|---|---|---|
| `items (assignee_id)` | **"이 사람이 담당인 모든 단계"** | 조직 전체에서 개인을 훑는 질문. TRUST 원칙 2가 거부한 질문이다. RLS가 이미 막지만, **인덱스가 없으면 우회 코드가 생겨도 느려서 티가 난다** |
| `items (assignee_id, duration_band)` | "이 사람의 소요시간 분포" | 위와 동일. §12의 "개인별 집계 테이블 없음"의 인덱스판 |
| `items (pain_flag)` | "짜증 플래그가 붙은 모든 단계" | 짜증은 익명 신호다. 전역 조회 경로를 빠르게 만들 이유가 없다 |
| `view_logs (viewer_id, at)` | **"이 사람이 열람한 모든 문서"** | 원칙 5는 *소유자가 열람자를 본다*이지 그 반대가 아니다. 이 인덱스가 있으면 감시 방향이 뒤집힌다 |
| `documents (org_id)` 단독 | "조직의 모든 문서" | 그 목록을 만들 수 있는 주체가 없다(§3). 인덱스만 만들면 배치 코드가 그걸 쓴다 |
| `items` 전문검색(GIN/pg_trgm) 조직 범위 | "조직 전체 문서 검색" | **D-074.** 검색창은 관리자 열람권의 우회로다. 검색 인덱스는 소유자 범위에서만 만든다(§2.7) |
| `privateNotes` 어떤 인덱스든(PK 제외) | — | ciphertext는 검색 불가능하다. 그게 설계다 |
| `audit_logs (detail)` GIN | 감사 로그 자유 검색 | 카테고리·대상·시각으로 충분하다. jsonb 전역 검색은 로그를 데이터 웨어하우스로 만들고, 그러면 지우기 어려워진다 |
| 커버링 `INCLUDE` 인덱스 전반 | — | 이 규모(문서 3,000 / 항목 40,000)에서 힙이 이미 캐시에 다 있다. §2.1 참조 |

> **이 표가 이 문서에서 가장 중요한 표 중 하나다.**
> "만들지 않았다"를 증명하는 방법은 **만들지 않은 것의 목록을 유지하는 것**뿐이다. 누군가 `items (assignee_id)`를 추가하는 PR을 열면, 이 표가 리뷰어에게 "이건 성능 개선이 아니라 정책 변경입니다"라고 말해준다.

### 2.7 검색 — 소유자 범위에서만

```sql
-- ★ 조직 범위 인덱스가 아니다. created_by가 선두다.
CREATE INDEX items_owner_search ON items
  USING gin (to_tsvector('simple', title))
  WHERE deleted_at IS NULL;
```
그리고 검색 쿼리는 **반드시** RLS를 통과한다. GIN 인덱스는 RLS 이전에 행을 뽑지만, RLS 정책이 그 뒤에 필터링하므로 결과는 안전하다. 다만 **타이밍 채널**이 남는다(조직에 그 단어가 몇 번 나오는지가 응답 시간에 반영될 수 있다). 완화:
- 검색은 `doc_id IN (내 문서들)`을 **먼저** 좁히는 형태로 작성한다 — GIN을 조직 전체에 먼저 태우지 않는다
- `security_barrier` 뷰 `my_items`를 만들고 검색은 그 뷰만 조회한다(§3.7)

한국어 형태소 분석기는 도입하지 않는다(DECISIONS 기각 목록). `simple` + `pg_trgm` 조합으로 충분하고, 형태소 사전은 조직마다 다시 튜닝해야 하는 영구 부채다.

---

## 3. RLS(Row Level Security) 정책 전문

### 3.1 롤 구조

> **주의** — `app_user` / `migrator` / `analytics_reader`는 기존 문서에 없던 이름이다. `admin_reader`만 MEASUREMENT §3에 확정되어 있다. 여기서 나머지를 정의하고, 그 근거를 남긴다.

```sql
-- ══════════════════════════════════════════════════════════
--  롤 구조. 사람에게는 어떤 롤도 부여하지 않는다 (SECURITY §5.1)
-- ══════════════════════════════════════════════════════════

-- ① 스키마 소유자. DDL만. 배포 시에만 짧게 살아 있는 자격증명
CREATE ROLE migrator NOLOGIN;

-- ② 애플리케이션 런타임. 유일하게 base 테이블에 닿는 롤
CREATE ROLE app_user NOLOGIN;

-- ③ 고객사 관리자 집계. 집계 뷰만. base 테이블 권한 없음 (MEASUREMENT §3)
CREATE ROLE admin_reader NOLOGIN;

-- ④ 제품팀 운영 지표. 내용 없는 구조 통계만
CREATE ROLE analytics_reader NOLOGIN;

-- ⑤ 보존 집행. 파티션 DETACH/DROP만. 행 단위 DELETE 권한 없음 (§5.3)
CREATE ROLE retention_janitor NOLOGIN;

-- 로그인 롤은 위 NOLOGIN 롤을 상속받는 껍데기다.
-- 자격증명이 새어도 그 자격증명이 가진 것은 상속받은 롤뿐이다.
CREATE ROLE app_conn       LOGIN PASSWORD :'app_pw'       IN ROLE app_user;
CREATE ROLE admin_conn     LOGIN PASSWORD :'admin_pw'     IN ROLE admin_reader;
CREATE ROLE analytics_conn LOGIN PASSWORD :'analytics_pw' IN ROLE analytics_reader;
CREATE ROLE janitor_conn   LOGIN PASSWORD :'janitor_pw'   IN ROLE retention_janitor;
CREATE ROLE migrate_conn   LOGIN PASSWORD :'migrate_pw'   IN ROLE migrator;

-- ★★ 어떤 롤에도 SUPERUSER · BYPASSRLS · REPLICATION 을 주지 않는다
--    특히 BYPASSRLS: 한 번 주면 그 롤의 모든 쿼리에서 RLS가 존재하지 않게 된다
ALTER ROLE app_user       NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION;
ALTER ROLE admin_reader   NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION;
ALTER ROLE analytics_reader NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION;
ALTER ROLE retention_janitor NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION;
ALTER ROLE migrator       NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION;
```

**권한 배분 — 스키마 단위로 끊는다**

```sql
-- 기본을 닫는다. PUBLIC은 아무것도 못 한다
REVOKE ALL ON SCHEMA public, app, agg, audit FROM PUBLIC;
REVOKE ALL ON DATABASE workflow FROM PUBLIC;
-- ★ Postgres 15+ 는 public 스키마 CREATE 권한이 이미 PUBLIC에서 빠져 있다. 확인만 한다

-- ① migrator: 전부 소유
ALTER SCHEMA public OWNER TO migrator;
ALTER SCHEMA app    OWNER TO migrator;
ALTER SCHEMA agg    OWNER TO migrator;
ALTER SCHEMA audit  OWNER TO migrator;

-- ② app_user: public 스키마의 DML만. DDL 없음
GRANT USAGE ON SCHEMA public, app, audit TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- ★ 감사는 INSERT만. app_user는 자기가 쓴 것도 못 지운다 (§5.3)
GRANT INSERT ON audit.audit_logs, audit.admin_query_logs,
                audit.destruction_ledger, audit.p1_deletion_queue TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA audit FROM app_user;

-- ③ admin_reader: ★ public 스키마에 USAGE조차 없다
--    MEASUREMENT §3의 "REVOKE ALL ON items, documents, item_tools"보다 강하다 —
--    테이블을 나열하지 않으므로 41번째 테이블에서도 유효하다
REVOKE ALL ON SCHEMA public, audit FROM admin_reader;
GRANT USAGE ON SCHEMA agg TO admin_reader;
GRANT SELECT ON agg.agg_process, agg.agg_dept_pair,
                agg.agg_tool, agg.agg_seam_discrepancy TO admin_reader;
--    ★ agg 스키마의 나머지(agg_cells_mv 등 원재료)는 GRANT하지 않는다
--      DEFAULT PRIVILEGES도 걸지 않는다 — 새 뷰는 명시적으로만 열린다

-- ④ analytics_reader: 내용 없는 구조 통계 뷰만
REVOKE ALL ON SCHEMA public, audit, agg FROM analytics_reader;
GRANT USAGE ON SCHEMA agg TO analytics_reader;
GRANT SELECT ON agg.ops_health_daily, agg.ops_error_daily TO analytics_reader;

-- ⑤ retention_janitor: 파티션 관리 함수 실행권만. 테이블 DML 없음
REVOKE ALL ON SCHEMA public FROM retention_janitor;
GRANT USAGE ON SCHEMA app, audit TO retention_janitor;
GRANT EXECUTE ON FUNCTION app.drop_expired_partitions() TO retention_janitor;
```

**왜 이렇게 나눴는가 — 한 줄씩**

| 롤 | 존재 이유 | 이 롤이 없으면 |
|---|---|---|
| `migrator` | DDL과 DML을 분리. 애플리케이션 자격증명으로 `DROP POLICY`가 불가능해진다 | 앱 자격증명 유출 = 정책 삭제 가능 |
| `app_user` | RLS가 적용되는 유일한 롤 | — |
| `admin_reader` | **base 테이블에 물리적으로 닿을 수 없는 롤이 존재한다는 것 자체가 증명** | "관리자 화면 코드가 실수로 items를 읽는" 사고가 가능해진다 |
| `analytics_reader` | 제품팀도 실명을 못 본다(MEASUREMENT §5) | 제품 개선 명목의 조회 경로가 생긴다 |
| `retention_janitor` | 삭제 권한을 "파티션 통째로"에만 준다 | 행 단위 DELETE 권한이 어딘가에 존재하게 되고, 감사 로그가 지워질 수 있다 |

### 3.2 세션 컨텍스트 — `SET LOCAL` 패턴과 대안 비교

```sql
CREATE SCHEMA app;

/**
 * ★ 설정이 없으면 NULL을 반환한다. 예외를 던지지 않는다.
 *   NULL이면 정책의 `=` 비교가 NULL → false → **거부**로 떨어진다. fail-closed.
 *   예외를 던지면 정책 평가 중 예외가 되어 에러 메시지로 상태가 새어나간다.
 */
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::uuid
$$;

/**
 * 공유 링크 세션. 토큰 자체가 아니라 검증된 share_links.id를 세션에 넣는다.
 * ★ 토큰 해시를 세션 변수에 넣지 않는다 — pg_stat_activity에 남는다.
 */
CREATE FUNCTION app.current_share_link_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(current_setting('app.share_link_id', true), '')::uuid
$$;
```

**호출 규약 (애플리케이션 측)**

```ts
// db/withUser.ts — ★ 애플리케이션이 DB에 닿는 유일한 문
import { sql } from 'drizzle-orm';
import { db } from './client';

export async function withUser<T>(
  ctx: { userId: string; orgId: string; shareLinkId?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // ★★ set_config(..., true) = SET LOCAL. 트랜잭션 종료 시 자동 리셋된다
    await tx.execute(sql`
      SELECT set_config('app.current_user_id', ${ctx.userId}, true),
             set_config('app.current_org_id',  ${ctx.orgId},  true),
             set_config('app.share_link_id',   ${ctx.shareLinkId ?? ''}, true)
    `);
    return fn(tx);
  });
}
```

**`SET LOCAL` vs 다른 방법 — 전량 비교**

| 방법 | 동작 | 판정 |
|---|---|---|
| **`SET LOCAL` / `set_config(_, _, true)`** | 트랜잭션 종료 시 자동 소멸. PgBouncer transaction 모드와 정확히 같은 생명주기 | **★ 채택** |
| `SET` (세션) | 커넥션 반납 후에도 남는다. **다음 요청이 이전 사용자로 실행된다** | **금지.** 이 스택에서 크로스테넌트 유출의 1위 원인(SECURITY §7.3B) |
| `DISCARD ALL` 후 `SET` | 안전하지만 prepared statement 캐시까지 날린다. 그리고 "리셋을 잊는 경로"가 계속 생긴다 | 기각 |
| 롤 전환 (`SET ROLE tenant_<uuid>`) | 사용자마다 DB 롤이 필요. 300명 × N조직 = 롤 폭발. SCIM 동기화가 DDL이 된다 | 기각 |
| 커넥션당 사용자 (풀 없음) | 서버리스에서 커넥션이 폭발한다 | 기각 |
| JWT를 GUC에 넣고 정책에서 파싱 (PostgREST 방식) | 정책이 문자열 파싱을 하게 된다. 느리고 잘못 짜기 쉽다 | 기각 |
| **애플리케이션 WHERE 절만** | 한 곳만 빠뜨리면 끝. SECURITY §7.3B가 "둘 중 하나만 있으면 언젠가 뚫린다"고 한 지점 | **RLS와 병행**한다(대체 아님) |

**세션 변수가 안 설정된 채로 쿼리가 나가면?** → `app.current_user_id()`가 NULL → 모든 정책이 false → **0행.** 에러가 아니라 빈 결과다. 이것이 옳은 방향이다: 실패 시 데이터를 더 주는 게 아니라 덜 준다.

다만 "조용한 0행"은 디버깅이 어렵다. 그래서 **개발·스테이징에서만** 켜는 감시 트리거를 둔다:

```sql
-- 스테이징 전용. 컨텍스트 없이 온 쿼리를 시끄럽게 만든다
CREATE FUNCTION app.assert_context() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id not set — withUser()를 통과하지 않은 쿼리입니다'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
```
프로덕션에서는 이 함수를 호출하지 않는다. 프로덕션은 조용히 0행이어야 한다 — 예외 메시지가 공격자에게 "컨텍스트가 필요하다"는 정보를 준다.

### 3.3 `app.can_read_document()` — `org_members`를 보지 않는 함수

이것이 `resolveDocumentAccess()`의 DB 대응물이다. **원칙 1 전체가 이 함수 하나에 들어 있다.**

```sql
/**
 * ★★★ 이 함수가 읽는 테이블은 셋뿐이다: documents · document_members · share_links.
 *      org_members는 인자로도 받지 않고 본문에서도 참조하지 않는다 (POLICY §1.0).
 *      §11.1의 테스트가 pg_proc.prosrc를 검사해 이 사실을 매 배포마다 검증한다.
 *
 * ★ SECURITY DEFINER가 아니다. INVOKER다.
 *   DEFINER로 만들면 이 함수가 RLS 우회 경로가 되고, 그러면 이 함수 자체가
 *   §3.6에서 열거하는 "막아야 할 우회 경로"가 된다.
 */
CREATE FUNCTION app.can_read_document(p_doc_id uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    -- ① 소유자
    SELECT 1 FROM documents d
     WHERE d.id = p_doc_id
       AND d.created_by = app.current_user_id()
       AND d.deleted_at IS NULL
  ) OR EXISTS (
    -- ② 소유자가 발급한 문서 권한
    SELECT 1 FROM document_members m
     WHERE m.doc_id = p_doc_id
       AND m.user_id = app.current_user_id()
       AND (m.expires_at IS NULL OR m.expires_at > now())
  ) OR EXISTS (
    -- ③ 소유자가 발급한 유효한 공유 링크로 들어온 세션
    SELECT 1 FROM share_links s
     WHERE s.id = app.current_share_link_id()
       AND s.doc_id = p_doc_id
       AND s.revoked_at IS NULL
       AND (s.expires_at IS NULL OR s.expires_at > now())
       AND (s.max_views IS NULL OR s.view_count < s.max_views)
  );
$$;
```

**이 함수에 없는 것 — 그리고 없다는 사실이 핵심이다**

```
✗ org_members 참조 없음        — 관리자·부서장·경영진 경로 없음
✗ users.role 참조 없음         — 직급에서 유도되는 권한 없음
✗ departments 참조 없음        — 부서 자동 공유 없음 (D-077)
✗ '관리자면 true' 분기 없음    — 넣으려면 이 함수를 고쳐야 하고, 고치면 리뷰에 남는다
✗ 인자가 doc_id 하나           — user를 인자로 받지 않으므로 "다른 사용자로 평가"가 불가능
```

봉인 열람(POLICY §6.2)은 어떻게 되나? — **이 함수를 통과하지 않는다.** 봉인 열람은 승인이 완료되면 `document_members`에 만료 있는 행을 넣는 것으로 구현한다. 즉 **새 경로가 아니라 기존 경로(②)로 착지한다.** 지원 진단 세션이 `share_links` 행인 것과 같은 논리다.

```sql
-- 봉인 열람 승인 → 기존 경로로 착지시키는 함수
CREATE FUNCTION app.grant_sealed_access(p_seal_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE s audit.seal_approvals%ROWTYPE;
BEGIN
  SELECT * INTO s FROM seal_approvals WHERE id = p_seal_id;
  IF s.approved_at IS NULL THEN
    RAISE EXCEPTION 'not approved';           -- CHECK가 이미 2인 승인을 보장한다
  END IF;
  INSERT INTO document_members (doc_id, user_id, role, granted_by, expires_at)
  VALUES (s.doc_id, s.requested_by, 'viewer', s.approved_by_1, s.grant_expires_at)
  ON CONFLICT (doc_id, user_id) DO NOTHING;
  -- 감사는 선택이 아니다
  PERFORM app.audit('seal_access', 'granted', 'document', s.doc_id::text, 3);
END $$;
REVOKE EXECUTE ON FUNCTION app.grant_sealed_access(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.grant_sealed_access(uuid) TO app_user;
```

### 3.4 정책 전문

```sql
-- ══════════════════════════════════════════════════════════
--  ★★ FORCE: 테이블 소유자(migrator)에게도 RLS를 적용한다.
--     이걸 빠뜨리면 소유자 커넥션에서 정책이 통째로 무시된다 (§3.6 우회 경로 ②)
-- ══════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE  ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE   ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

#### documents

```sql
-- 읽기 — 세 경로. permissive 정책은 OR로 합쳐진다
CREATE POLICY documents_read ON documents FOR SELECT TO app_user
USING (deleted_at IS NULL AND app.can_read_document(id));

-- 쓰기 — 소유자 + 편집 권한자
CREATE POLICY documents_insert ON documents FOR INSERT TO app_user
WITH CHECK (
  created_by = app.current_user_id()
  AND org_id  = app.current_org_id()          -- ★ §9의 테넌트 앵커
);

CREATE POLICY documents_update ON documents FOR UPDATE TO app_user
USING (
  deleted_at IS NULL AND (
    created_by = app.current_user_id()
    OR EXISTS (SELECT 1 FROM document_members m
                WHERE m.doc_id = documents.id
                  AND m.user_id = app.current_user_id()
                  AND m.role = 'editor'
                  AND (m.expires_at IS NULL OR m.expires_at > now()))
  )
)
WITH CHECK (
  -- ★ 소유권은 UPDATE로 바뀌지 않는다. 이전은 app.transfer_ownership()으로만
  created_by = (SELECT d2.created_by FROM documents d2 WHERE d2.id = documents.id)
  AND org_id = app.current_org_id()
);

-- 삭제 — ★ 물리 DELETE 권한을 주지 않는다. tombstone은 UPDATE다
CREATE POLICY documents_no_delete ON documents FOR DELETE TO app_user
USING (false);
```
**막는 시나리오**
- *관리자가 남의 문서를 연다* → `documents_read`의 `can_read_document()`에 관리자 분기가 없다. 0행
- *편집자가 소유권을 자기에게 옮긴다* → `documents_update`의 `WITH CHECK`가 `created_by` 변경을 거부
- *편집자가 문서를 다른 조직으로 옮긴다* → 같은 `WITH CHECK`의 `org_id = app.current_org_id()`
- *앱 버그로 `DELETE FROM documents`가 나간다* → `documents_no_delete`가 0행 영향. **30일 복구 기간이 코드 실수로 사라지지 않는다**

#### items · edges · item_tools — 문서에 위임

```sql
CREATE POLICY items_read ON items FOR SELECT TO app_user
USING (deleted_at IS NULL AND app.can_read_document(doc_id));

CREATE POLICY items_write ON items FOR ALL TO app_user
USING (app.can_edit_document(doc_id))
WITH CHECK (app.can_edit_document(doc_id) AND org_id = app.current_org_id());

CREATE POLICY edges_read ON edges FOR SELECT TO app_user
USING (app.can_read_document(doc_id));
CREATE POLICY edges_write ON edges FOR ALL TO app_user
USING (app.can_edit_document(doc_id))
WITH CHECK (app.can_edit_document(doc_id) AND org_id = app.current_org_id());

CREATE POLICY item_tools_read ON item_tools FOR SELECT TO app_user
USING (EXISTS (SELECT 1 FROM items i WHERE i.id = item_tools.item_id));
--  ★ items에 이미 정책이 있으므로 이 EXISTS가 자동으로 필터된다.
--    can_read_document를 다시 호출하지 않는다 — 중복 평가 비용 절감
```

`app.can_edit_document()`는 `can_read_document()`와 같은 형태로, `document_members.role='editor'` 또는 소유자만 참으로 만든다. **여기에도 `org_members`가 없다.**

#### private_notes — 조건이 하나뿐인 테이블

```sql
CREATE POLICY private_notes_owner_only ON private_notes FOR ALL TO app_user
USING      (owner_id = app.current_user_id())
WITH CHECK (owner_id = app.current_user_id() AND org_id = app.current_org_id());
```
**막는 시나리오**
- *편집 권한자가 노트를 본다* → 조건에 `document_members`가 없다. 0행
- *공유 링크로 들어온 사람이 본다* → `share_links` 조건이 없다. 0행
- *봉인 열람 승인자가 본다* → `document_members` 행이 생겨도 이 정책은 그걸 보지 않는다. 0행. **SECURITY §5.4d의 "L4는 break-glass로도 열 수 없다"가 정책 한 줄로 성립한다**
- *지원 진단 세션* → 같음. 0행

> **정책이 짧은 것이 이 테이블의 보안 속성이다.** 조건이 하나면 조건을 늘리는 PR이 눈에 띈다.

#### checklist_runs — 실행자 본인만

```sql
CREATE POLICY checklist_runs_self ON checklist_runs FOR ALL TO app_user
USING      (runner_id = app.current_user_id())
WITH CHECK (runner_id = app.current_user_id() AND org_id = app.current_org_id());
```
POLICY §6.4대로 소유자에게도 안 보인다.

#### share_links — 발급은 소유자만

```sql
CREATE POLICY share_links_read ON share_links FOR SELECT TO app_user
USING (
  EXISTS (SELECT 1 FROM documents d
           WHERE d.id = share_links.doc_id AND d.created_by = app.current_user_id())
);

CREATE POLICY share_links_create ON share_links FOR INSERT TO app_user
WITH CHECK (
  created_by = app.current_user_id()
  AND org_id = app.current_org_id()
  AND (
    -- 소유자는 A·B·C 전부
    EXISTS (SELECT 1 FROM documents d
             WHERE d.id = doc_id AND d.created_by = app.current_user_id())
    OR (
      -- 편집 권한자는 조직 내(A) 링크만 (POLICY §2.6)
      kind = 'org'
      AND EXISTS (SELECT 1 FROM document_members m
                   WHERE m.doc_id = share_links.doc_id
                     AND m.user_id = app.current_user_id()
                     AND m.role = 'editor')
    )
  )
  AND (
    -- 조직이 외부 공유를 껐으면 B·C를 만들 수 없다 (POLICY §2.4)
    kind = 'org'
    OR EXISTS (SELECT 1 FROM orgs o
                WHERE o.id = share_links.org_id AND o.external_sharing_enabled)
  )
);

CREATE POLICY share_links_revoke ON share_links FOR UPDATE TO app_user
USING (EXISTS (SELECT 1 FROM documents d
                WHERE d.id = share_links.doc_id AND d.created_by = app.current_user_id()))
WITH CHECK (token_hash = (SELECT s2.token_hash FROM share_links s2 WHERE s2.id = share_links.id));
--  ★ 토큰을 바꾸는 UPDATE를 금지한다. 재발급은 새 행이어야 한다 (POLICY §2.5)

CREATE POLICY share_links_no_delete ON share_links FOR DELETE TO app_user USING (false);
```
**막는 시나리오**
- *읽기 권한자가 링크를 만들어 재공유* → `share_links_create`의 두 분기 어디에도 해당 없음. 거부. **원칙 5(열람 목록의 완전성)가 지켜진다**
- *편집자가 외부 링크를 만든다* → `kind='org'` 조건에서 거부
- *조직이 외부 공유를 껐는데 외부 링크 생성* → 마지막 `EXISTS`에서 거부
- *회수 대신 토큰만 갈아끼워 이전 링크를 부활* → `share_links_revoke`의 `WITH CHECK`가 거부

#### view_logs — 소유자가 읽고, 아무도 못 지운다

```sql
CREATE POLICY view_logs_owner_read ON view_logs FOR SELECT TO app_user
USING (doc_owner_id = app.current_user_id());

CREATE POLICY view_logs_insert ON view_logs FOR INSERT TO app_user
WITH CHECK (true);          -- 열람 사실은 항상 기록된다. 열람자가 막을 수 없다

CREATE POLICY view_logs_no_update ON view_logs FOR UPDATE TO app_user USING (false);
CREATE POLICY view_logs_no_delete ON view_logs FOR DELETE TO app_user USING (false);
```
그리고 정책 위에 권한으로 한 번 더 못을 박는다:
```sql
REVOKE UPDATE, DELETE, TRUNCATE ON view_logs FROM app_user;
```
**막는 시나리오**
- *열람자가 자기 흔적을 지운다* → INSERT만 가능. 0행
- *소유자가 자기 문서의 열람 로그를 지운다* → 같음. POLICY §2.5가 명시적으로 요구한 것
- *계정을 가장한 사람이 로그부터 지운다* → 같음. POLICY §1.3 장치 7의 실제 구현
- *관리자가 조직 전체 열람 통계를 만든다* → `doc_owner_id = 나` 조건 때문에 남의 행이 안 보인다. `admin_reader`는 스키마 USAGE조차 없다

#### org_members — 읽기는 넓게, 쓰기는 좁게

```sql
CREATE POLICY org_members_read ON org_members FOR SELECT TO app_user
USING (org_id = app.current_org_id());

CREATE POLICY org_members_write ON org_members FOR ALL TO app_user
USING (
  org_id = app.current_org_id()
  AND EXISTS (SELECT 1 FROM org_members me
               WHERE me.org_id = org_members.org_id
                 AND me.user_id = app.current_user_id()
                 AND me.role = 'org_admin')
)
WITH CHECK (
  org_id = app.current_org_id()
  AND EXISTS (SELECT 1 FROM org_members me
               WHERE me.org_id = org_members.org_id
                 AND me.user_id = app.current_user_id()
                 AND me.role = 'org_admin')
  -- ★ POLICY §1.1 B-7: 시스템 관리자는 역할을 바꿀 수 없다.
  --   자기 자신을 org_admin으로 승격하는 경로를 막는다
  AND NOT (user_id = app.current_user_id() AND role = 'org_admin'
           AND NOT EXISTS (SELECT 1 FROM org_members o0
                            WHERE o0.org_id = org_members.org_id
                              AND o0.user_id = app.current_user_id()
                              AND o0.role = 'org_admin'))
);
```
> **이 테이블에 정책이 있다는 사실이 원칙 1을 깨지 않는다는 것이 요점이다.** `org_members`를 읽을 수 있는 것과, 그 값이 문서 접근을 만드는 것은 다른 일이다. §11.1의 테스트가 후자를 검증한다.

#### 나머지 테이블 요약

| 테이블 | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| `operations` | `can_read_document(doc_id)` | `can_edit_document(doc_id)` | **false** (append-only) |
| `snapshots` | `can_read_document(doc_id)` | `can_edit_document(doc_id)` | **false** |
| `exports` | `created_by = 나` | `created_by = 나` + 요율 | **false** (만료 배치만) |
| `team_shelf` | `dept_id = 내 부서` | `posted_by = 나` AND 문서 소유자 = 나 | `posted_by = 나` |
| `handoff_sockets` | `can_read_document(doc_id)` **또는** 상대 소켓 소유자(L0/L1만, §3.7) | `can_edit_document(doc_id)` | false (tombstone) |
| `handoff_links` | 양쪽 소켓 중 하나가 내 문서 | 같음 | false |
| `discrepancies` | 관련 링크가 내 것 | 시스템만 | false |
| `reports` | `reporter_id = 나` 또는 `is_desk` | `reporter_id = 나` | false |
| `checklist_runs` | `runner_id = 나` | 같음 | `runner_id = 나` |
| `freshness_state` | `can_read_document(doc_id)` | 시스템 | false |
| `notification_prefs`/`budget` | `user_id = 나` | `user_id = 나` | false |
| `tools`/`glossary`/`tool_aliases`/`business_objects` | `org_id = 내 조직 OR org_id IS NULL` | org_admin | org_admin |
| `users`/`departments` | `org_id = 내 조직` | 시스템(SCIM) | 시스템 |
| `private_notes` | `owner_id = 나` | `owner_id = 나` | `owner_id = 나` |
| `org_deks`/`org_salt_rotations` | **app_user에게 SELECT 없음** — 키 조작은 별도 서비스 | — | — |

`org_deks`는 `app_user`가 아니라 **키 서비스 전용 롤(`kms_broker`)** 이 읽는다. 애플리케이션이 wrapped DEK를 조회할 수 있으면, 애플리케이션 SQL 인젝션 한 건이 곧 전 조직 노트의 봉투 유출이 된다.

### 3.5 접합 소켓 — 의도적으로 반쯤 공개되는 유일한 테이블

ASSEMBLY §8.3은 접합에 3단계 노출을 정의한다: L0(문서 제목·산출물명·대기 밴드) / L1(접합 ±1단계 제목, 양쪽 확정 시) / L2(문서 전문, 공유 링크 발급 시만). **테이블 전체를 열 수는 없으므로 뷰로 가른다.**

```sql
-- ★ security_invoker = true (PG15+): 뷰가 호출자 권한으로 실행된다.
--   false(기본)면 뷰 소유자 권한이 되어 RLS를 통째로 우회한다 — §3.6 우회 경로 ④
CREATE VIEW public.seam_peer_l0 WITH (security_invoker = true, security_barrier = true) AS
SELECT s.id, s.org_id, s.doc_id, s.direction, s.lag_band, s.cadence_key,
       d.title AS doc_title,
       s.party_dept_id,
       (SELECT array_agg(a.label_norm ORDER BY a.label_norm)
          FROM socket_artifacts a WHERE a.socket_id = s.id) AS artifact_labels
FROM handoff_sockets s
JOIN documents d ON d.id = s.doc_id
WHERE s.deleted_at IS NULL
  AND d.deleted_at IS NULL
  AND NOT d.is_private_only          -- POLICY §6.4: 개인용 문서는 소켓조차 안 나간다
  AND NOT d.excluded_from_map;       -- POLICY §5.4
```

그리고 `handoff_sockets`의 SELECT 정책에 상대편 경로를 **뷰 경유로만** 연다:

```sql
CREATE POLICY sockets_read_own ON handoff_sockets FOR SELECT TO app_user
USING (app.can_read_document(doc_id));

-- 상대편은 base 테이블을 못 읽는다. seam_peer_l0 뷰는 security_invoker라
-- 이 정책의 지배를 받으므로, 뷰만으로는 부족하다. → 별도 permissive 정책을 둔다
CREATE POLICY sockets_read_peer_l0 ON handoff_sockets FOR SELECT TO app_user
USING (
  -- 내가 소유한 소켓과 링크(후보 이상)로 연결된 상대 소켓
  EXISTS (
    SELECT 1 FROM handoff_links l
    JOIN handoff_sockets mine
      ON mine.id = CASE WHEN l.outbound_socket_id = handoff_sockets.id
                        THEN l.inbound_socket_id ELSE l.outbound_socket_id END
    WHERE (l.outbound_socket_id = handoff_sockets.id
        OR l.inbound_socket_id  = handoff_sockets.id)
      AND app.can_read_document(mine.doc_id)
  )
);
```

**문제** — 이 정책은 상대 소켓의 **모든 컬럼**을 연다(`party_raw`, `channel_screen` 등 L3 성격 필드 포함). 정책은 행 단위이지 열 단위가 아니다. 해결:

```sql
-- ★ 열 단위 통제는 정책이 아니라 GRANT로 한다
REVOKE SELECT ON handoff_sockets FROM app_user;
GRANT SELECT (id, org_id, doc_id, item_id, direction, party_kind, party_dept_id,
              lag_band, cadence_key, source, confidence, boundary,
              last_confirmed_at, deleted_at)
  ON handoff_sockets TO app_user;
-- party_raw · party_external_label · channel_screen · party_user_id 는 GRANT하지 않는다
-- → 이 컬럼들은 SECURITY DEFINER 함수 app.my_socket_detail(socket_id)로만 나간다
```

> **RLS는 행을, GRANT는 열을 막는다. 둘 다 필요하다.** 열 단위 통제를 RLS로 하려는 시도는 반드시 실패한다 — 정책 표현식은 열을 숨길 수 없다.

### 3.6 RLS를 우회할 수 있는 경로 — 전량 열거와 차단

| # | 우회 경로 | 왜 뚫리나 | 차단 |
|---|---|---|---|
| 1 | **`SUPERUSER`** | RLS가 전혀 적용되지 않는다 | 애플리케이션 롤 전부 `NOSUPERUSER`. RDS는 어차피 슈퍼유저를 안 준다. `rds_superuser`도 앱에 부여하지 않는다 |
| 2 | **테이블 소유자** | 기본적으로 소유자에게는 RLS가 적용되지 않는다 | **`ALTER TABLE … FORCE ROW LEVEL SECURITY`** 전 테이블. §3.4의 DO 블록. 그리고 §11.1이 `pg_class.relforcerowsecurity`를 전수 검증 |
| 3 | **`BYPASSRLS` 속성** | 정의상 우회 | 모든 롤에 `NOBYPASSRLS`. §11.1이 `pg_roles`를 검사 |
| 4 | **뷰 (PG15 미만 기본 동작)** | 뷰는 소유자 권한으로 base를 읽는다 → 뷰가 있으면 RLS가 무의미 | 모든 뷰에 **`WITH (security_invoker = true)`**. 예외는 §4의 집계 뷰뿐이고, 그건 의도적으로 DEFINER 성격이며 **admin_reader에게만** 열린다 |
| 5 | **`SECURITY DEFINER` 함수** | 정의자 권한으로 실행 → RLS 우회 | ① 꼭 필요한 것만 만든다(현재 3개: `current_share_doc`, `grant_sealed_access`, `audit`) ② 전부 `SET search_path = pg_catalog, public, pg_temp` ③ `REVOKE EXECUTE … FROM PUBLIC` 후 필요한 롤에만 GRANT ④ §11.1이 DEFINER 함수 목록을 화이트리스트와 비교해 새 함수가 생기면 테스트 실패 |
| 6 | **`search_path` 하이재킹** | DEFINER 함수가 `search_path`를 안 고정하면 호출자가 만든 `pg_temp.documents`를 읽게 만들 수 있다 | 모든 함수에 `SET search_path` 명시. `pg_temp`를 **맨 뒤**에 둔다 |
| 7 | **커넥션 풀러 세션 오염** | `SET`(LOCAL 아님)이 반납된 커넥션에 남는다 | `SET LOCAL`만 사용(§3.2). PgBouncer는 **transaction 모드**. `server_reset_query_always = 1`. §11.1에 "커넥션 반납 후 `current_setting`이 비어 있음" 테스트 |
| 8 | **Drizzle의 `db.execute` 직접 호출** | `withUser()`를 안 거치면 컨텍스트가 없다 → 조용히 0행, 또는 (더 나쁘게) 이전 요청의 컨텍스트 | ESLint `no-restricted-imports`로 `db` 직접 import를 `db/withUser.ts` 밖에서 금지. §11.1이 `grep`으로 검증 |
| 9 | **논리 복제 / CDC** | `REPLICATION` 권한은 RLS와 무관하게 WAL 전체를 읽는다 | 앱 롤에 `NOREPLICATION`. 복제 슬롯은 `migrator`조차 못 만든다. CDC가 필요해지면 그건 정책 변경이다 |
| 10 | **`pg_dump` / `COPY TO`** | 소유자 권한 백업은 RLS를 통과하지 않는다 | 백업은 별도 AWS 계정 + KMS(§6.5). 사람이 실행하는 `pg_dump`는 자격증명이 없어서 불가(SECURITY §5.1 "사람용 DB 계정 미발급") |
| 11 | **누출성(leaky) 연산자** | RLS 이전에 사용자 함수가 평가되어 행 내용이 에러 메시지로 샐 수 있다 | 뷰에 `security_barrier`. 그리고 애초에 사용자 정의 함수를 WHERE에 넣는 API가 없다 |
| 12 | **FK 위반 에러의 존재 오라클** | 남의 행을 참조하는 INSERT가 "중복 키" 에러를 내면 그 행의 존재가 드러난다 | `items.id`가 클라이언트 발급 UUID라 실재하는 위험이다. 완화: 유니크 제약을 `(doc_id, …)` 스코프로 두고, 애플리케이션이 제약 위반을 **모두 같은 일반 오류**로 변환한다(§11.4에 테스트) |
| 13 | **`EXPLAIN` / `pg_stat_statements`** | 행 수 추정치가 존재를 드러낸다 | `pg_stat_statements`를 app_user에게 GRANT하지 않는다. `EXPLAIN`을 노출하는 API가 없다 |
| 14 | **트리거 함수** | 트리거는 기본적으로 테이블 소유자 권한으로 돈다 | 트리거 함수도 §5의 감사 트리거 하나뿐이며, INSERT만 한다. 읽는 트리거를 만들지 않는다 |
| 15 | **`ON CONFLICT DO UPDATE`의 RETURNING** | 보이지 않는 행과 충돌하면 그 행 내용이 RETURNING으로 나온다 | RLS는 `ON CONFLICT` 대상 행에도 `USING`을 적용하므로 안전하지만, **`WITH CHECK`가 없으면 쓰기가 통과한다.** 모든 정책에 `WITH CHECK` 명시(§3.4) |
| 16 | **애플리케이션 캐시 오염** | Next.js `unstable_cache`/fetch 캐시가 사용자별 데이터를 공유 | SECURITY §7.3B: 캐시 키에 `org_id + user_id` 강제, 사용자별 데이터에 `unstable_cache` 금지를 ESLint로 |

**DEFINER 함수 화이트리스트 (이 셋 외에는 존재해서는 안 된다)**

```sql
-- 1. 공유 링크 검증 — share_links RLS를 우회해야만 토큰을 확인할 수 있다
CREATE FUNCTION app.resolve_share_token(p_hash text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.id FROM share_links s
   WHERE s.token_hash = p_hash
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
     AND (s.max_views IS NULL OR s.view_count < s.max_views)
$$;
-- ★ 반환값이 id 하나다. doc_id도, 소유자도, 제목도 반환하지 않는다.
--   호출자는 이 id를 세션에 넣고, 그 다음부터는 평범한 RLS 경로를 탄다.

-- 2. 봉인 열람 승인 → document_members 착지 (§3.3)
-- 3. 감사 로그 기록 (§5.1)

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_share_token(text) TO app_user;
```

### 3.7 Drizzle + PgBouncer 조합에서의 함정

| # | 함정 | 증상 | 대응 |
|---|---|---|---|
| 1 | **PgBouncer session 모드** | 커넥션이 요청마다 안 돌아온다. 서버리스에서 풀 고갈 | `pool_mode = transaction` |
| 2 | **transaction 모드 + prepared statements** | `prepared statement "s1" already exists` | `postgres.js`에 `prepare: false`. Drizzle은 그대로 동작한다 |
| 3 | **transaction 모드 + `SET`(LOCAL 아님)** | **다른 사용자 데이터가 보인다.** 최악의 버그 | `set_config(_, _, true)`만 사용. §11.1의 풀 오염 테스트 |
| 4 | **Drizzle `db.execute()`가 트랜잭션 밖에서 실행** | `SET LOCAL`이 즉시 소멸 → 0행 | `withUser()` 안에서만 쿼리. `db`를 export하지 않는다 |
| 5 | **Drizzle relational query (`db.query.x.findMany`)에서 컨텍스트 누락** | 같음 | `tx.query.…`만 사용. 타입 레벨로 강제(아래) |
| 6 | **PgBouncer `server_reset_query`** | transaction 모드에서는 기본으로 안 돈다 | `server_reset_query_always = 1`을 켜두고, `SET LOCAL`에 의존하되 이중 안전장치로 둔다 |
| 7 | **RDS Proxy 핀닝** | `SET`, 임시테이블, advisory lock 사용 시 커넥션이 세션에 고정되어 멀티플렉싱이 죽는다 | `SET LOCAL`은 핀닝을 유발하지 **않는다**. advisory lock을 쓰지 않는다(§8.3의 배치는 `pg_try_advisory_lock` 대신 테이블 기반 리스를 쓴다) |
| 8 | **Drizzle 마이그레이션이 풀러를 통과** | DDL이 transaction 모드에서 깨진다 | 마이그레이션은 **풀러를 우회해 DB에 직결**(§7.1) |
| 9 | **`search_path`가 풀러에서 리셋 안 됨** | `app` 스키마 함수를 못 찾음 | 함수는 항상 스키마 수식(`app.can_read_document`). `search_path`에 의존하지 않는다 |
| 10 | **Drizzle이 정책을 모른다** | `drizzle-kit push`가 정책을 날린다 | **`push` 금지**(§7.5) |

**타입 레벨 강제 — 컨텍스트 없는 쿼리를 컴파일 에러로**

```ts
// db/client.ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const client = postgres(process.env.DATABASE_URL!, {
  prepare: false,          // ★ PgBouncer transaction 모드 필수
  max: 5,                  // 서버리스 인스턴스당. 풀러가 앞에 있으므로 작게
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: 'verify-full',      // SECURITY §4.1
});

/** ★ export하지 않는다. withUser()만 이걸 본다 */
const _db = drizzle(client, { schema });

/** 컨텍스트가 붙은 트랜잭션 핸들. 브랜드 타입으로 구분한다 */
export type ScopedTx = typeof _db extends { transaction: (f: (tx: infer T) => any) => any }
  ? T & { readonly __scoped: unique symbol }
  : never;

// SECURITY §7.3B: "테넌트 스코프 미지정 쿼리는 타입 에러로 컴파일 실패"
```
그리고 `eslint.config.js`:
```js
{
  files: ['**/*.ts'],
  ignores: ['db/withUser.ts', 'db/client.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{ name: '@/db/client', message: 'withUser()를 사용하세요. RLS 컨텍스트가 필요합니다.' }],
    }],
  },
}
```

---

## 4. k-익명성 집계 뷰

### 4.0 설계 판단 — 축마다 억제를 다시 쓰지 않는다

MEASUREMENT §3과 ASSEMBLY §8.4는 각각 `agg_process`와 `agg_seam_discrepancy`를 정의하는데, **두 뷰가 억제 로직을 각자 다시 구현하고 있다.** 이건 이 제품에서 가장 위험한 종류의 중복이다.

> 축이 4개면 억제 구현이 4개다. 5번째 축을 추가하는 사람은 앞의 4개를 읽지 않는다.
> 그리고 억제를 빠뜨린 뷰는 **에러가 아니라 더 많은 행**을 반환한다.

**따라서 구조를 뒤집는다.**

```
  ┌──────────────────────────────────────────────────────┐
  │  agg.agg_cells_mv   (MATERIALIZED, nightly)          │
  │  전 축을 하나의 long 포맷으로 통합                    │
  │  (axis, dim_a, dim_b, period_key, contributor_n, …)  │
  └───────────────────────┬──────────────────────────────┘
                          │
  ┌───────────────────────▼──────────────────────────────┐
  │  agg.agg_public   ★★ 억제 로직이 존재하는 유일한 곳   │
  │  k≥5 · 2차 억제 · 5단위 라운딩                        │
  └───────────────────────┬──────────────────────────────┘
                          │
     ┌──────────┬─────────┴────────┬───────────────┐
     ▼          ▼                  ▼               ▼
 agg_process  agg_dept_pair    agg_tool   agg_seam_discrepancy
    (WHERE axis='process')  … 전부 얇은 필터 뷰. 억제 코드 0줄
```

`admin_reader`는 `agg_cells_mv`에 `SELECT` 권한이 **없다.** 억제되지 않은 원재료에 닿을 수 있는 롤이 존재하지 않는다.

**대가** — 축마다 측정값이 다른데 long 포맷은 컬럼이 고정된다. 해결: 수치 슬롯을 `m1..m4` + `measure_labels text[]`로 두고, 얇은 뷰에서 의미 있는 이름으로 다시 붙인다. 못생겼지만 **억제가 한 곳인 값어치가 압도적으로 크다.**

### 4.1 원재료 — `agg.agg_cells_mv`

```sql
CREATE MATERIALIZED VIEW agg.agg_cells_mv AS

-- ── 축 1. 프로세스 (MEASUREMENT §3) ──────────────────────
SELECT
  'process'::agg_axis                       AS axis,
  r.org_id,
  r.process_key                             AS dim_a,
  r.dept_id::text                           AS dim_b,
  r.period_key,
  count(DISTINCT r.owner_id)                AS contributor_n,
  count(*)                                  AS unit_n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.lead_time_h)     AS m1, -- lead_time_med
  avg(r.step_count)::real                                        AS m2, -- step_avg
  sum(r.pain_count)::real                                        AS m3, -- pain_total
  avg(r.handoff_count)::real                                     AS m4, -- handoff_avg
  ARRAY['lead_time_med','step_avg','pain_total','handoff_avg']   AS measure_labels
FROM process_rollup r
JOIN documents d ON d.id = r.doc_id
WHERE d.deleted_at IS NULL
  AND d.archived_at IS NULL              -- POLICY §7: 아카이브는 집계에서 빠진다
  AND NOT d.excluded_from_map            -- POLICY §5.4
  AND NOT d.is_private_only              -- POLICY §6.4
  AND d.kind = 'personal'
GROUP BY 1,2,3,4,5

UNION ALL

-- ── 축 2. 부서쌍 (부서 간 인계) ──────────────────────────
SELECT
  'dept_pair'::agg_axis,
  m.org_id,
  m.dept_pair                               AS dim_a,
  NULL                                      AS dim_b,
  m.period_key,
  m.contributor_n,
  m.link_n                                  AS unit_n,
  NULL::real, NULL::real, NULL::real, NULL::real,
  ARRAY[]::text[]
FROM org_map_rollup m
GROUP BY 1,2,3,4,5,6,7

UNION ALL

-- ── 축 3. 도구 ───────────────────────────────────────────
SELECT
  'tool'::agg_axis,
  d.org_id,
  t.id::text                                AS dim_a,
  d.dept_id_at_write::text                  AS dim_b,
  p.key                                     AS period_key,
  count(DISTINCT d.created_by)              AS contributor_n,
  count(DISTINCT i.id)                      AS unit_n,
  avg(CASE i.duration_band
        WHEN '1m' THEN 1 WHEN '5m' THEN 5 WHEN '15m' THEN 15
        WHEN '1h' THEN 60 WHEN 'halfday' THEN 240 WHEN '1d+' THEN 480 END)::real AS m1,
  avg(i.freq_last_7d)::real                                       AS m2,
  avg(i.automation_level)::real                                   AS m3,
  NULL::real                                                      AS m4,
  ARRAY['minutes_band_avg','freq_avg','automation_avg']            AS measure_labels
FROM item_tools it
JOIN items     i ON i.id  = it.item_id AND i.deleted_at IS NULL
JOIN tools     t ON t.id  = it.tool_id
JOIN documents d ON d.id  = i.doc_id
CROSS JOIN period_presets p
WHERE d.deleted_at IS NULL AND d.archived_at IS NULL
  AND NOT d.excluded_from_map AND NOT d.is_private_only
  AND d.updated_at >= p.starts_at AND d.updated_at < p.ends_at
GROUP BY 1,2,3,4,5

UNION ALL

-- ── 축 4. 접합 유형 (ASSEMBLY §8.4) ──────────────────────
SELECT
  'seam_kind'::agg_axis,
  di.org_id,
  di.kind                                   AS dim_a,
  agg.canonical_dept_pair(du.dept_id_at_write, dd.dept_id_at_write) AS dim_b,
  p.key                                     AS period_key,
  count(DISTINCT du.created_by) + count(DISTINCT dd.created_by)  AS contributor_n,
  count(*)                                  AS unit_n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY di.severity_score) AS m1,
  NULL::real, NULL::real, NULL::real,
  ARRAY['severity_med']                     AS measure_labels
FROM discrepancies  di
JOIN handoff_links   l ON l.id = di.link_id AND l.status IN ('confirmed','auto')
JOIN handoff_sockets o ON o.id = l.outbound_socket_id
JOIN handoff_sockets ii ON ii.id = l.inbound_socket_id
JOIN documents      du ON du.id = o.doc_id
JOIN documents      dd ON dd.id = ii.doc_id
CROSS JOIN period_presets p
WHERE du.deleted_at IS NULL AND dd.deleted_at IS NULL
  AND NOT du.is_private_only AND NOT dd.is_private_only
  AND NOT du.excluded_from_map AND NOT dd.excluded_from_map
  AND di.detected_at >= p.starts_at AND di.detected_at < p.ends_at
GROUP BY 1,2,3,4,5;

CREATE UNIQUE INDEX agg_cells_mv_pk
  ON agg.agg_cells_mv (axis, org_id, dim_a, coalesce(dim_b,''), period_key);
--  ★ UNIQUE 인덱스가 있어야 REFRESH MATERIALIZED VIEW CONCURRENTLY가 된다

-- ★★ 어떤 롤에도 GRANT하지 않는다. 억제되지 않은 원재료다
REVOKE ALL ON agg.agg_cells_mv FROM PUBLIC, admin_reader, analytics_reader, app_user;
```

**왜 MATERIALIZED인가 — 이것 자체가 차분 공격 방어다**

실시간 뷰면 관리자는 **오전 9시와 오전 9시 5분의 결과를 차분**할 수 있다. 그 사이에 한 사람이 문서를 저장했다면 그 사람의 기여분이 드러난다. 야간 1회 갱신이면 하루 동안 값이 **완전히 고정**되고, 하루 단위 차분은 라운딩(±5) 안에 묻힌다.

> **k-익명성은 스냅샷의 성질이지 스트림의 성질이 아니다.** 실시간 집계 위에 k를 얹는 설계는 원리적으로 뚫린다.

### 4.2 억제 — `agg.agg_public` (억제 로직이 존재하는 유일한 곳)

```sql
CREATE VIEW agg.agg_public WITH (security_barrier) AS
WITH
-- ─────────────────────────────────────────────────────────
-- ① 셀별 억제 판정
-- ─────────────────────────────────────────────────────────
flagged AS (
  SELECT
    c.*,
    -- 1차 억제: 기여자 5인 미만
    (c.contributor_n < 5) AS suppress_primary,
    -- 접합 축은 이중 문턱: 건수도 5건 이상이어야 한다 (ASSEMBLY §8.4)
    (c.axis = 'seam_kind' AND c.unit_n < 5) AS suppress_volume
  FROM agg.agg_cells_mv c
),
marked AS (
  SELECT *,
    (suppress_primary OR suppress_volume) AS suppressed
  FROM flagged
),
-- ─────────────────────────────────────────────────────────
-- ② 2차 억제
--    파티션 안에서 억제된 셀이 정확히 1개면, 그 셀의 값은
--    (파티션 총계 − 나머지 셀 합)으로 복원된다.
--    → 두 번째로 작은 셀을 함께 억제해 차집합을 무의미하게 만든다.
--    파티션 = (axis, org_id, dim_b, period_key)  ← 부서 등 "묶음" 차원
-- ─────────────────────────────────────────────────────────
secondary AS (
  SELECT *,
    count(*) FILTER (WHERE suppressed)
      OVER w AS suppressed_cnt,
    row_number()
      OVER (PARTITION BY axis, org_id, coalesce(dim_b,''), period_key
            ORDER BY suppressed DESC, contributor_n ASC, dim_a ASC) AS rn
  FROM marked
  WINDOW w AS (PARTITION BY axis, org_id, coalesce(dim_b,''), period_key)
),
-- ─────────────────────────────────────────────────────────
-- ③ 시계열 일관 억제
--    같은 (axis, dim_a, dim_b)가 어떤 기간에서든 한 번 억제되면
--    ★ 모든 기간에서 억제한다.
--    이유: last30에는 없고 last90에는 있는 셀이 있으면,
--    그 차이가 곧 "최근 30일에 4명 이하가 기여했다"는 정보다.
--    중첩 기간(last30 ⊂ last90 ⊂ last365)에서 이 방어가 없으면
--    프리셋만 써도 차분이 성립한다 — MEASUREMENT §3이 놓친 지점.
-- ─────────────────────────────────────────────────────────
sticky AS (
  SELECT *,
    bool_or(suppressed OR (suppressed_cnt = 1 AND rn = 2))
      OVER (PARTITION BY axis, org_id, dim_a, coalesce(dim_b,''))
      AS suppressed_any_period
  FROM secondary
)
SELECT
  axis, org_id, dim_a, dim_b, period_key,
  -- ─────────────────────────────────────────────────────
  -- ④ 5단위 라운딩 — 잔차 추론 차단
  --    ★ round(x/5.0)*5는 반올림이므로 5 미만은 0 또는 5가 된다.
  --      k≥5만 남으므로 0이 나오지 않는다. 하한을 다시 확인할 필요는 없지만
  --      GREATEST(…,5)로 명시해 의도를 코드에 남긴다.
  -- ─────────────────────────────────────────────────────
  GREATEST((round(contributor_n / 5.0) * 5)::int, 5) AS contributor_n_rounded,
  GREATEST((round(unit_n        / 5.0) * 5)::int, 5) AS unit_n_rounded,
  -- 중앙값은 라운딩하지 않는다 — 개인 귀속이 아니라 분포 통계이고,
  -- 라운딩하면 리드타임 리포트가 쓸모없어진다. 대신 소수 1자리로 절삭한다
  round(m1::numeric, 1) AS m1,
  round(m2::numeric, 1) AS m2,
  round(m3::numeric, 1) AS m3,
  round(m4::numeric, 1) AS m4,
  measure_labels
FROM sticky
WHERE NOT suppressed
  AND NOT (suppressed_cnt = 1 AND rn = 2)     -- ② 2차 억제
  AND NOT suppressed_any_period;              -- ③ 시계열 일관 억제
```

**억제 규칙 4개를 한 표로**

| # | 규칙 | 막는 공격 |
|---|---|---|
| 1 | `contributor_n >= 5` (+ 접합은 `unit_n >= 5`) | 3명짜리 팀의 "평균"에서 나머지 한 명 역산 |
| 2 | 파티션 내 억제 셀이 1개면 두 번째로 작은 셀도 억제 | 총계 − 나머지 = 억제된 셀 |
| 3 | **어느 기간에서든 억제되면 전 기간 억제** | `last90 − last30`으로 최근 30일 소집단 복원 |
| 4 | 5단위 반올림 | 인접 셀 비교로 1명 단위 변화 추적 |

**규칙 3이 새로 추가된 것이고, 이게 없으면 프리셋만으로도 뚫린다.** MEASUREMENT §3은 "임의 기간을 없애면 차분이 막힌다"고 썼지만, **중첩된 프리셋 자체가 차분 가능하다.** `last365`와 `last90`이 둘 다 보이면 그 차이는 "275일 전~90일 전 구간"이고, 그 구간의 기여자가 소수면 그대로 노출된다. 규칙 3이 그 문을 닫는다.

**억제된 셀 수를 함께 반환한다** (POLICY §8.2가 export 하단에 인쇄하라고 요구한 값):

```sql
CREATE VIEW agg.agg_suppression_summary WITH (security_barrier) AS
SELECT axis, org_id, period_key,
       count(*)                                        AS total_cells,
       count(*) FILTER (WHERE contributor_n < 5)       AS suppressed_cells
FROM agg.agg_cells_mv
GROUP BY 1,2,3;
GRANT SELECT ON agg.agg_suppression_summary TO admin_reader;
```
*왜 이건 억제 없이 노출해도 되나* — 반환하는 것이 **셀의 개수**이지 셀의 내용이 아니다. "이 부서에서 14개 항목을 계산하지 않았습니다"는 어떤 개인도 지목하지 않는다. 그리고 이 숫자를 안 주면 관리자는 화면이 비어 있는 이유를 모르고, **모르면 억제를 풀어달라고 한다.**

### 4.3 축별 얇은 뷰 — 억제 코드 0줄

```sql
CREATE VIEW agg.agg_process WITH (security_barrier) AS
SELECT org_id,
       dim_a AS process_key,
       dim_b::uuid AS dept_id,
       period_key,
       contributor_n_rounded,
       unit_n_rounded AS process_n_rounded,
       m1 AS lead_time_med,
       m2 AS step_avg,
       m3 AS pain_total,
       m4 AS handoff_avg
FROM agg.agg_public WHERE axis = 'process';

CREATE VIEW agg.agg_dept_pair WITH (security_barrier) AS
SELECT org_id,
       dim_a AS dept_pair,
       period_key,
       contributor_n_rounded,
       unit_n_rounded AS handoff_n_rounded
FROM agg.agg_public WHERE axis = 'dept_pair';

CREATE VIEW agg.agg_tool WITH (security_barrier) AS
SELECT org_id,
       dim_a::uuid AS tool_id,
       dim_b::uuid AS dept_id,
       period_key,
       contributor_n_rounded,
       unit_n_rounded AS step_n_rounded,
       m1 AS minutes_band_avg,
       m2 AS freq_avg,
       m3 AS automation_avg
FROM agg.agg_public WHERE axis = 'tool';

CREATE VIEW agg.agg_seam_discrepancy WITH (security_barrier) AS
SELECT org_id,
       dim_a AS discrepancy_kind,
       dim_b AS dept_pair,
       period_key,
       contributor_n_rounded,
       unit_n_rounded AS link_n_rounded,
       m1 AS severity_med
FROM agg.agg_public WHERE axis = 'seam_kind';

GRANT SELECT ON agg.agg_process, agg.agg_dept_pair,
                agg.agg_tool, agg.agg_seam_discrepancy TO admin_reader;
```

> **새 축을 추가하는 방법**: `agg_cells_mv`에 `UNION ALL` 블록 하나 + 얇은 뷰 하나.
> **억제는 건드릴 수 없다.** 새 축의 개발자가 억제를 잊는 것이 구조적으로 불가능하다.

### 4.4 차분 공격 방어 — 스키마 레벨 구조

애플리케이션이 아니라 **스키마가** 다음을 불가능하게 만든다.

| 방어 | 구현 | 애플리케이션이 우회할 수 있나 |
|---|---|---|
| **임의 기간 불가** | `period_key`가 `period_presets`에 대한 **FK**. 그리고 키 모양에 정규식 CHECK | 없는 키로 조인하면 0행. 우회 불가 |
| **임의 필터 불가** | 뷰에 **차원 슬롯이 2개뿐**(`dim_a`, `dim_b`). 3번째 필터를 걸 컬럼이 물리적으로 없다 | **구조적으로 불가.** "최대 2개"를 코드로 세지 않는다 — 셀 수가 없다 |
| **드릴다운 불가** | `agg_public`에 `doc_id`·`owner_id`·`user_id`가 **존재하지 않는다** | 조인할 대상이 없다. `admin_reader`는 base 테이블에 USAGE도 없다 |
| **시계열 차분 불가** | 억제 규칙 3(시계열 일관 억제) | 뷰 안에 있다 |
| **재계산 차분 불가** | 삭제·부서이동·SCIM 오류에도 **과거 셀을 재계산하지 않는다**. `documents.dept_id_at_write`가 부서를 고정 | 재계산 경로 자체가 없다 |
| **시간 차분 불가** | MV 야간 1회 갱신. 하루 동안 값 고정 | REFRESH 권한은 `retention_janitor`에만 |
| **반복 조회 차분 불가** | `rate_counters`의 `org:agg_export_month ≤ 20` CHECK | 카운터가 DB에 있고 CHECK가 강제 |
| **부서 축소 시 소급 억제** | 부서가 5인 미만이 되면 `departments.k_eligible = false` → 과거 셀도 억제(§4.5) | 뷰가 판정한다 |

**"최대 필터 2개"를 컬럼 슬롯으로 구현한 것이 이 절의 핵심이다.** 카운터로 세면 어딘가에서 안 세는 경로가 생긴다. **슬롯이 2개면 3번째는 존재할 수 없다.**

### 4.5 부서 축소 시 소급 억제

SECURITY §9.5: "폐지 부서가 5인 미만으로 축소 → **과거 셀도 억제 대상으로 전환**(시계열 차분 방어)".

```sql
-- agg_public에 조건 하나를 더 건다 (§4.2의 WHERE에 AND로 붙는다)
--   AND NOT EXISTS (
--     SELECT 1 FROM departments dp
--      WHERE dp.id::text = sticky.dim_b AND NOT dp.k_eligible
--   )
```
`departments.k_eligible`은 nightly 배치가 갱신한다(§1.2). 부서가 4명이 되는 순간, **다음 갱신에서 그 부서의 모든 과거 셀이 사라진다.** 이건 데이터 손실이 아니라 정책의 정상 동작이다 — 관리자 화면의 "계산하지 않은 항목" 수가 늘어난다.

### 4.6 이 뷰들이 하지 않는 것

```
✗ 개인 식별자를 반환하지 않는다        — dim_a/dim_b에 uuid가 오더라도 그건 dept/tool뿐
✗ 문서 목록·링크를 반환하지 않는다
✗ 총계(파티션 합계) 행을 반환하지 않는다 — 총계가 있으면 억제 셀이 뺄셈으로 복원된다
✗ pain_flag × assignee_id 조인이 없다   — POLICY §4.3의 금지 조인
✗ P1(행동 이벤트)을 읽지 않는다         — MEASUREMENT §1의 단방향 규칙 (P1→P2 파이프라인 부재)
✗ 미작성자를 셀 수 없다                 — 문서가 없는 사람은 어떤 축에도 행이 없다
```

마지막 항목이 미묘하지만 중요하다. **"문서를 안 쓴 사람"은 이 데이터 모델에서 표현 불가능하다.** `users`에는 있지만 `agg_cells_mv`의 어떤 축에도 나타나지 않고, `users`는 `admin_reader`에게 보이지 않는다. 미작성자 명단은 "만들지 않은 기능"이 아니라 **계산할 재료가 없는 것**이다.

---

## 5. 감사 로그 설계

### 5.1 무엇을 남기는가

SECURITY §5.5의 표를 그대로 스키마 값으로 옮긴다. **보존이 카테고리마다 다르므로 `retention_years`를 행에 박는다**(§1.10).

| `category` | 기록 내용 | `retention_years` |
|---|---|---|
| `doc_view` | 문서 ID, 열람자(user_id 또는 token_id), 시각, 경로, UA 요약 | 1 |
| `share_link` | 생성·열람·만료·회수, 스코프, 만료일 | 1 |
| `role_change` | 롤 부여·회수, 승인자, 사유, 티켓 | **3** |
| `break_glass` | 세션 전 쿼리, 반환 행수, 승인자, 고객 동의 증빙 | **3** |
| `admin_query` | 뷰 이름, 필터, 기간 프리셋, 반환 셀 수 | 1 |
| `delete_restore` | 대상, 방법, 실행 주체, 검증 결과 | **3** |
| `auth` | 로그인 성공·실패, MFA, 세션 발급·만료, IP | 1 |
| `key_use` | KMS 복호화 호출 (CloudTrail 미러) | 1 |
| `private_note_decrypt` | 호출자 세션, 대상 item, 시각 | **3** |
| `scim_sync` | 생성·수정·비활성 건수, 실패 사유 | 1 |
| `seal_access` | 봉인 열람 요청·승인·부여 | **3** |
| `export` | 종류, 범위, 요청자 | 1 |
| `policy_change` | 조직 설정 변경 전/후 | **3** |

> **문서 간 충돌 정리** — POLICY §8.4는 감사 로그를 일괄 "3년"이라 했고, SECURITY §5.5는 카테고리별 1~3년, 이 작업의 요구사항은 "감사 원본 1년"이다.
> **해소**: 열람 로그(원칙 5 관련)의 **원본은 1년**, 조직 관리 행위·되돌릴 수 없는 조치는 **3년**. POLICY의 "3년"은 §8.4 문맥상 *관리 행위* 로그를 가리킨다. 위 표가 정본이고, 두 문서에 이 표를 역참조로 넣는다.

**기록 함수 — 애플리케이션이 감사를 건너뛸 수 없게**

```sql
CREATE FUNCTION app.audit(
  p_category text, p_action text,
  p_target_type text DEFAULT NULL, p_target_id text DEFAULT NULL,
  p_retention_years int DEFAULT 1,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, audit, pg_temp
AS $$
DECLARE v_prev text; v_row text;
BEGIN
  -- 해시 체인: 같은 org의 직전 행 해시를 끌어온다
  SELECT row_hash INTO v_prev
    FROM audit.audit_logs
   WHERE org_id IS NOT DISTINCT FROM app.current_org_id()
   ORDER BY ts DESC LIMIT 1;

  v_row := encode(digest(
    coalesce(v_prev,'') || p_category || p_action ||
    coalesce(p_target_id,'') || app.current_user_id()::text ||
    clock_timestamp()::text, 'sha256'), 'hex');

  INSERT INTO audit.audit_logs (
    org_id, category, action, actor_kind, actor_id, actor_token_id,
    target_type, target_id, detail, retention_years, prev_hash, row_hash)
  VALUES (
    app.current_org_id(), p_category, p_action,
    CASE WHEN app.current_user_id() IS NOT NULL THEN 'user'
         WHEN app.current_share_link_id() IS NOT NULL THEN 'share_token'
         ELSE 'system' END,
    app.current_user_id(), app.current_share_link_id(),
    p_target_type, p_target_id, p_detail, p_retention_years, v_prev, v_row);
END $$;

REVOKE EXECUTE ON FUNCTION app.audit(text,text,text,text,int,jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.audit(text,text,text,text,int,jsonb) TO app_user;
```

**append-only를 보장하는 3중 장치**

```sql
-- ① 권한: UPDATE·DELETE·TRUNCATE 자체가 없다
REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA audit FROM app_user, admin_reader,
                                                                 analytics_reader, PUBLIC;
GRANT INSERT ON audit.audit_logs TO app_user;
GRANT SELECT ON audit.audit_logs TO app_user;   -- RLS가 범위를 좁힌다 (§5.2)

-- ② RLS: 권한이 실수로 복구돼도 정책이 막는다
ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs FORCE  ROW LEVEL SECURITY;
CREATE POLICY audit_no_update ON audit.audit_logs FOR UPDATE TO app_user USING (false);
CREATE POLICY audit_no_delete ON audit.audit_logs FOR DELETE TO app_user USING (false);

-- ③ 규칙: DDL 권한을 가진 migrator가 실수로 지우는 것까지 막는다
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit.audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit.audit_logs DO INSTEAD NOTHING;
```

> **③의 `RULE`이 왜 필요한가** — `migrator`는 테이블 소유자이므로 정책을 DROP할 수 있다. 하지만 `RULE`은 `DELETE` 자체를 no-op으로 바꾸므로, 정책을 지운 세션에서도 삭제가 안 된다. 규칙까지 지우려면 두 개의 DDL이 필요하고, **두 개의 DDL은 마이그레이션 파일에 남는다.**
>
> 물론 슈퍼유저는 전부 뚫는다. 그래서 진짜 WORM은 §5.4의 외부 앵커링이다. DB 안의 장치는 "**실수와 애플리케이션 침해**"를 막는 것이지 슈퍼유저를 막는 것이 아니다 — 그 사실을 정직하게 적어둔다.

### 5.2 소유자에게 보이는 뷰 vs 감사 원본 (90일 / 1년)

```sql
-- ★ 소유자 화면. 90일 창. security_invoker라 view_logs 정책이 그대로 적용된다
CREATE VIEW public.my_document_views
  WITH (security_invoker = true, security_barrier = true) AS
SELECT
  v.doc_id,
  d.title                                  AS doc_title,
  v.at,
  v.via,
  -- SECURITY §8.4 — 열람자 유형별 표시
  CASE
    WHEN v.viewer_id IS NOT NULL THEN u.name
    WHEN v.viewer_email_masked IS NOT NULL THEN v.viewer_email_masked
    ELSE '외부에서 열람'
  END                                      AS viewer_label,
  CASE WHEN v.viewer_id IS NULL AND v.viewer_email_masked IS NULL
       THEN v.country_code END             AS viewer_country,
  s.label                                  AS via_link_label
FROM view_logs v
JOIN documents d ON d.id = v.doc_id
LEFT JOIN users u       ON u.id = v.viewer_id
LEFT JOIN share_links s ON s.id = v.share_link_id
WHERE v.doc_owner_id = app.current_user_id()
  AND v.at > now() - interval '90 days'      -- ★ 표시 창
  AND v.via <> 'owner';                      -- 자기 열람은 로그에 안 보인다

GRANT SELECT ON public.my_document_views TO app_user;
```

| | 표시 창 | 보관 | 누가 |
|---|---|---|---|
| `my_document_views` (뷰) | **90일** | — | 소유자 본인 |
| `view_logs` (테이블) | — | **1년** | 아무도 직접 안 읽는다. 사고 조사 시 break-glass |
| `audit.audit_logs` `category='doc_view'` | — | **1년** | 보안 담당 2인 |

**왜 `view_logs`와 `audit_logs`가 둘 다 있나** — 목적이 다르다.
- `view_logs`는 **제품 기능**이다(원칙 5). 소유자 화면이 조회한다. 그래서 `public` 스키마에 있고 `doc_owner_id` 인덱스가 있다
- `audit_logs`는 **보안 증적**이다. 파티션·해시체인·불변 규칙이 붙는다

하나로 합치면 제품 쿼리가 감사 테이블을 뜨겁게 만들고, 감사 테이블의 불변 제약이 제품 기능을 제약한다. **수명주기가 다른 데이터는 테이블도 다르다** — §6의 "회전 주기가 다른 키는 분리한다"와 같은 원리다.

봇 열람 제외(SECURITY §8.4)는 삽입 시점에 거른다:
```sql
-- ua_summary가 봇이면 아예 INSERT하지 않는다.
-- ★ 필터가 아니라 미기록이다 — "봇 열람을 사람 열람으로 세면 로그가 거짓이 된다"
```

### 5.3 아무도 못 지우게 하는 방법

**층위 1 — 권한**: §5.1의 `REVOKE`. 행 단위 `DELETE` 권한이 **DB 전체에서 존재하지 않는다.**

**층위 2 — 삭제의 유일한 형태를 파티션 드롭으로 만든다**

```sql
CREATE FUNCTION app.drop_expired_partitions() RETURNS TABLE(dropped text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, audit, pg_temp
AS $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class parent ON parent.oid = i.inhparent
     WHERE parent.relname = 'audit_logs'
  LOOP
    -- ★ 파티션 안에 보존기간이 안 지난 행이 하나라도 있으면 드롭하지 않는다
    IF NOT EXISTS (
      SELECT 1 FROM audit.audit_logs a
       WHERE a.tableoid = (quote_ident('audit') || '.' || quote_ident(p.relname))::regclass
         AND a.ts + (a.retention_years || ' years')::interval > now()
    ) THEN
      EXECUTE format('DROP TABLE audit.%I', p.relname);
      dropped := p.relname; RETURN NEXT;
      -- 파기 대장에 기록 (SECURITY §2.6)
      INSERT INTO audit.destruction_ledger(category, scope_ref, row_count, method, basis,
                                           executed_by, verification_query, verification_result_hash)
      VALUES ('audit', p.relname, 0, 'physical', 'retention', 'job:retention',
              format('SELECT count(*) FROM audit.%I', p.relname), 'n/a');
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.drop_expired_partitions() TO retention_janitor;
```

**왜 파티션 드롭만 허용하나**
1. **부분 삭제가 불가능하다.** "이 한 행만 지우자"는 요구를 물리적으로 수용할 수 없다
2. **드롭은 시끄럽다.** DDL이라 `pg_stat_activity`·CloudTrail·감사 로그 전부에 남는다
3. **보존기간 가드가 함수 안에 있다.** 사람이 판단하지 않는다

**층위 3 — 해시 체인**: `prev_hash` → `row_hash`. 중간 행이 사라지면 체인이 끊긴다. 검증:
```sql
CREATE VIEW audit.chain_breaks WITH (security_barrier) AS
SELECT a.id, a.ts, a.org_id
FROM audit.audit_logs a
LEFT JOIN LATERAL (
  SELECT row_hash FROM audit.audit_logs b
   WHERE b.org_id IS NOT DISTINCT FROM a.org_id AND b.ts < a.ts
   ORDER BY b.ts DESC LIMIT 1) prev ON true
WHERE a.prev_hash IS DISTINCT FROM prev.row_hash;
```
`chain_breaks`가 비어 있지 않으면 **P0**. 일 1회 검사한다.

**층위 4 — 외부 WORM 앵커링 (진짜 방어)**

DB 안의 어떤 장치도 슈퍼유저를 막지 못한다. 그래서 **일 1회, 전일 로그의 머클 루트를 DB 밖으로 보낸다.**

```
일 1회 배치:
  root = merkle_root(전일 audit_logs.row_hash 전량)
  → S3 Object Lock (거버넌스 모드, 별도 AWS 계정) 에 쓴다
  → 분기 투명성 보고서에 root 값을 공개한다
```
이러면 DB에서 행을 지우고 체인을 다시 계산해도 **공개된 루트와 안 맞는다.** 이것이 "아무도 못 지운다"의 유일하게 정직한 구현이다.

> **정직하게 적어둘 것**: DB 내부 장치는 "실수·애플리케이션 침해·내부자의 일상적 권한"을 막는다. 인프라 루트 권한을 가진 사람은 DB를 통째로 바꿀 수 있다. 그걸 막는 것은 외부 앵커링과 조직적 통제(2인 승인, MDM, 분기 권한 재인증)이지 SQL이 아니다.

### 5.4 관리자 쿼리 감사

```sql
-- 관리자 집계 조회는 트랜잭션 안에서 로그와 함께만 일어난다
CREATE FUNCTION agg.query_process(
  p_period text, p_dept uuid DEFAULT NULL, p_process text DEFAULT NULL)
RETURNS SETOF agg.agg_process
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, agg, audit, public, pg_temp
AS $$
DECLARE v_rows int; v_sup int;
BEGIN
  SELECT suppressed_cells INTO v_sup
    FROM agg.agg_suppression_summary
   WHERE axis='process' AND org_id=app.current_org_id() AND period_key=p_period;

  RETURN QUERY
    SELECT * FROM agg.agg_process
     WHERE org_id = app.current_org_id()
       AND period_key = p_period
       AND (p_dept    IS NULL OR dept_id     = p_dept)
       AND (p_process IS NULL OR process_key = p_process);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO audit.admin_query_logs(
    org_id, actor_id, view_name, axis, period_key, filters,
    returned_cells, suppressed_cells)
  VALUES (app.current_org_id(), app.current_user_id(), 'agg.agg_process',
          'process', p_period,
          jsonb_strip_nulls(jsonb_build_object('dept', p_dept, 'process', p_process)),
          v_rows, coalesce(v_sup, 0));
END $$;
```
*왜 함수로 감싸나* — **필터가 정확히 2개인 것이 시그니처에 박힌다.** 3번째 필터를 추가하려면 함수 시그니처를 바꿔야 하고, 그건 마이그레이션이다. 그리고 로그 INSERT가 같은 트랜잭션에 있으므로 **로그가 실패하면 조회도 롤백된다** — 감사 없는 조회가 존재할 수 없다.

`admin_query_logs`의 `view_name LIKE 'agg.%'` CHECK(§1.10)와 결합하면: 누군가 이 함수를 base 테이블을 읽도록 고치면 로그 INSERT가 CHECK 위반으로 실패하고 **조회 자체가 실패한다.**

**월간 요약 — 인사팀에게 공개하는 것**

```sql
CREATE VIEW audit.admin_query_monthly WITH (security_barrier) AS
SELECT org_id,
       date_trunc('month', ts)             AS month,
       count(*)                            AS query_count,
       count(DISTINCT actor_id)            AS distinct_admins,
       sum(returned_cells)                 AS cells_returned,
       sum(suppressed_cells)               AS cells_suppressed,
       -- ★ 이 값이 0이라는 사실이 공개의 핵심이다
       count(*) FILTER (WHERE view_name NOT LIKE 'agg.%') AS non_agg_queries
FROM audit.admin_query_logs
GROUP BY 1,2;
```
> **`non_agg_queries = 0`을 매달 공개하는 것이 이 테이블의 존재 이유다.**
> "관리자가 무엇을 봤는지"가 아니라 "**관리자 뷰가 개인을 조회할 수 없었음**"의 증명이다(MEASUREMENT §3).

---

## 6. 봉투 암호화 — 비공개 노트(L4)

### 6.1 키 계층

```
AWS KMS CMK                                    ← 평문이 절대 KMS 밖으로 안 나온다
  │  (기본: 서비스 공용 / 격리·BYOK: 조직 전용)
  └─ org DEK                                   ← org_deks.wrapped_dek (DB에 wrapped만)
       └─ AES-256-GCM(
            plaintext = 노트 본문,
            nonce     = HKDF(doc_id || item_id || rev)[0..12],
            aad       = org_id || item_id )    ← private_notes.ciphertext
```

**세 층인 이유**
- CMK를 직접 쓰면 노트 1건마다 KMS 왕복이 필요하다(비용·지연·쿼터)
- DEK만 쓰면 회전할 때 KMS의 이력이 안 남는다
- **BYOK에서 고객이 CMK를 회수하면 org DEK를 풀 수 없고 → 전 조직 노트가 암호학적으로 파기된다.** 이게 온프레 요구의 실질적 대체재다(SECURITY §6.5)

**nonce에 `rev`가 들어가는 이유** — GCM은 같은 키로 같은 nonce를 두 번 쓰면 **평문이 복원된다.** 노트를 수정할 때마다 `rev`가 오르므로 nonce가 재사용되지 않는다. `doc_id||item_id`만으로는 수정 시 nonce가 같아진다 — SECURITY §4.3의 표기를 그대로 구현하되 `rev`를 반드시 포함해야 한다는 점을 여기 명시한다.

```ts
// private_notes.rev — §1.8에 추가
rev: integer('rev').notNull().default(0),
// UPDATE마다 rev = rev + 1. CHECK로는 강제 못 하므로 트리거로 강제한다
```
```sql
CREATE FUNCTION app.bump_note_rev() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.rev <= OLD.rev THEN
    RAISE EXCEPTION 'private_notes.rev must increase (nonce reuse guard)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER private_notes_rev BEFORE UPDATE ON private_notes
  FOR EACH ROW EXECUTE FUNCTION app.bump_note_rev();
```
*왜 트리거인가* — nonce 재사용은 **조용한 암호학적 파국**이다. 애플리케이션이 `rev` 증가를 잊으면 아무 에러 없이 두 노트가 같은 nonce로 잠기고, 그 둘을 XOR하면 평문이 나온다. 이건 리뷰로 잡히지 않는다.

### 6.2 컬럼 설계 — §1.8 요약

| 컬럼 | 왜 |
|---|---|
| `ciphertext bytea` | GCM 출력(암호문 ‖ 16바이트 태그) |
| `nonce bytea` (12B CHECK) | 실제 사용된 nonce. 유도식이 바뀌어도 복호화 가능 |
| `aad_version int` | AAD 구성이 바뀌면 버전을 올린다. AAD를 저장하지 않는 이유는 AAD가 org_id·item_id로 재구성되기 때문 |
| `dek_id uuid` | 어느 DEK로 잠겼는가. 회전 배치의 커서 |
| `rev int` | nonce 재사용 방지 |
| `alg text` (CHECK) | 알고리즘 협상 다운그레이드 방지 |
| `owner_id uuid` | **RLS의 유일한 조건** |

**저장하지 않는 것**: 평문, DEK 평문, AAD 원문, 노트 길이 이외의 어떤 메타데이터도. 특히 **노트가 존재한다는 사실 자체는 숨기지 않는다**(`items`에서 `EXISTS`가 보인다) — 숨기려면 더미 행이 필요하고, 그건 복잡도 대비 이득이 없다. 대신 "노트가 있다"는 소유자에게만 표시된다(RLS).

### 6.3 복호화 경로를 좁히는 방법

**층위 1 — DB에 복호화 수단이 없다**

```sql
-- ★ pgcrypto를 설치하지 않는다.
--   설치하면 SQL에서 decrypt()가 가능해지고, 그러면 break-glass 세션에서 L4가 열린다.
--   SECURITY §5.4d의 "L4는 break-glass로도 열 수 없다"는 이 한 줄로 성립한다.
-- CREATE EXTENSION pgcrypto;   ← 절대 실행하지 않는다
```
> 해시 체인(§5.1)에 `digest()`가 필요한데 pgcrypto 없이 어떻게? → `sha256()` 내장 함수(PG11+)를 쓴다. **pgcrypto를 부르는 이유를 하나도 남기지 않는 것이 목적이다.**

```sql
-- §5.1의 digest() 대신
v_row := encode(sha256(convert_to(..., 'UTF8')), 'hex');
```

**층위 2 — 타입 레벨 brand**

```ts
// server/secret/privateNote.ts
declare const OwnerSessionBrand: unique symbol;
export type OwnerSession = {
  readonly [OwnerSessionBrand]: true;
  readonly userId: string;
  readonly orgId: string;
};

/** 소유자 세션은 이 함수로만 만들어진다. 그리고 이 함수는 DB로 소유권을 확인한다 */
export async function assertOwnerSession(
  tx: ScopedTx, itemId: string,
): Promise<OwnerSession> { /* … */ }

/** ★ OwnerSession 없이는 컴파일되지 않는다 */
export async function decryptPrivateNote(
  session: OwnerSession, itemId: string,
): Promise<string> { /* KMS Decrypt → AES-GCM open → audit */ }
```

**층위 3 — 임포트 차단 (ESLint + CI)**

```js
// eslint.config.js
{
  files: [
    'server/jobs/**',        // 배치
    'server/admin/**',       // 관리자
    'server/support/**',     // 지원
    'server/ai/**',          // AI
    'server/analytics/**',   // 집계
    'app/(admin)/**',
  ],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/secret/privateNote', '**/secret/kms'],
        message: 'L4 복호화는 소유자 세션 경로에서만 가능합니다 (SECURITY §4.3).',
      }],
    }],
  },
}
```
그리고 CI에서 **번들 검증**:
```bash
# 관리자·배치 번들에 decryptPrivateNote 심볼이 들어 있으면 빌드 실패
node scripts/assert-no-l4-in-bundle.mjs \
  .next/server/app/\(admin\) .next/server/jobs
```
*왜 번들까지 보나* — ESLint는 정적 임포트만 본다. `await import()`나 배럴 파일 재수출은 통과한다. **번들에 심볼이 없다는 것이 유일하게 검증 가능한 사실이다.**

**층위 4 — 복호화 전량 감사**

```ts
// decryptPrivateNote() 내부, 반환 직전
await tx.execute(sql`SELECT app.audit(
  'private_note_decrypt', 'decrypt', 'item', ${itemId}, 3)`);
```
SECURITY §4.3: "소유자 세션 외의 호출은 **존재할 수 없으므로**, 한 건이라도 나오면 P0." 그 판정을 가능하게 하는 쿼리:
```sql
SELECT count(*) FROM audit.audit_logs a
 WHERE a.category = 'private_note_decrypt'
   AND a.actor_id IS DISTINCT FROM (
     SELECT p.owner_id FROM private_notes p WHERE p.item_id = a.target_id::uuid);
-- 결과가 0이 아니면 P0
```

**층위 5 — DB 권한**

```sql
-- private_notes는 app_user만 접근. 그리고 RLS가 owner_id로 좁힌다
REVOKE ALL ON private_notes FROM admin_reader, analytics_reader, retention_janitor, PUBLIC;
-- org_deks는 app_user조차 못 읽는다 — 키 브로커 서비스 전용 롤
CREATE ROLE kms_broker NOLOGIN NOBYPASSRLS;
REVOKE ALL ON org_deks FROM app_user;
GRANT SELECT ON org_deks TO kms_broker;
```
*왜 앱이 wrapped DEK를 못 읽나* — 앱에 SQL 인젝션이 하나 나면 `SELECT wrapped_dek FROM org_deks`가 가능해진다. wrapped DEK만으로는 못 풀지만, **앱은 KMS Decrypt 권한도 갖고 있으므로** 둘을 합치면 전 조직 노트가 열린다. 키 브로커를 분리하면 인젝션 하나로는 부족해진다.

### 6.4 `org_salt` 12개월 회전과의 관계 — 분리한다

| | `org_salt` | org DEK |
|---|---|---|
| 목적 | 재식별 방지 (HMAC) | 기밀성 (AES) |
| 저장 | Secrets Manager (**DB에 없음**) | `org_deks.wrapped_dek` (DB에 wrapped) |
| 회전 | **12개월**, 구 salt 즉시 파기 | 연 1회 + 사고 시 즉시, **재암호화 후** 구 DEK 파기 |
| 회전 비용 | 0 — 과거 pid는 그냥 못 풀게 된다(그게 목적) | 전량 재암호화 |
| DB 흔적 | `org_salt_rotations` (값 없음, 파기 시각만) | `org_deks` (버전·wrapped·retired) |

**같은 키로 묶으면 안 되는 이유** (SECURITY §4.4를 스키마 관점에서 다시 씀):
salt를 회전하려면 DEK도 회전해야 하고, DEK 회전은 전량 재암호화다. 재암호화가 비싸면 **회전을 미루게 되고, 12개월 약속이 깨진다.** 약속이 깨지면 "1년 이상 개인 추적 불가"라는 P1 설계의 근거가 사라진다.

**두 회전이 만나는 유일한 지점** — `p1_deletion_queue.pid`(§1.10). salt가 회전하면 큐에 남은 pid는 무의미해진다. 따라서:
```sql
-- salt 회전 전에 큐를 비운다. 비어 있지 않으면 회전을 막는다
CREATE FUNCTION app.assert_p1_queue_drained(p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit.p1_deletion_queue WHERE completed_at IS NULL) THEN
    RAISE EXCEPTION 'p1_deletion_queue가 비지 않았습니다. salt를 회전하면 삭제 요청이 영구 미이행됩니다';
  END IF;
END $$;
```
*왜* — salt를 먼저 돌리면 "지워달라"고 한 사람의 이벤트를 **영원히 찾을 수 없게 된다.** 삭제 요청 미이행이 되고, 그건 법 위반이다. 순서가 중요한 곳에는 가드를 둔다.

### 6.5 백업·복구 시 키

| 상황 | 키 처리 |
|---|---|
| 정기 스냅샷 | RDS 스냅샷은 KMS CMK로 암호화(볼륨 레벨). **wrapped DEK가 스냅샷에 포함된다** — 그래서 스냅샷 자체로는 노트를 못 푼다(CMK가 별도 계정) |
| 별도 백업 계정 | 교차계정 KMS 키. 백업 계정은 프로덕션 CMK에 접근권이 없다 → **백업 계정 침해만으로는 L4가 안 열린다** |
| 복구 | ① 격리 VPC 복원 → ② **tombstone 재적용** → ③ 무결성 검증 → ④ 기동 → ⑤ 복원본 4시간 내 파기 |
| 복구 시 DEK | 복원 시점의 `org_deks` 행이 그대로 온다. 회전이 그 사이에 있었다면 **구 DEK가 이미 파기되어 일부 노트를 못 푼다** |
| BYOK 고객이 키 회수 | 복구해도 노트를 못 푼다. **의도된 동작** |

**마지막 행이 중요한 운영 함정이다.** DEK 회전 배치는 재암호화 완료 후 구 DEK를 파기하는데, **파기 시점이 최신 스냅샷보다 빠르면** 그 스냅샷에서 복원한 노트를 못 푼다. 규칙:

```
구 DEK 파기는 "재암호화 완료 + 스냅샷 보존기간(35일) 경과" 이후에만.
  → org_deks.retired_at + 35일 < now() 일 때만 destroyed_at을 쓴다
```
```sql
ALTER TABLE org_deks ADD CONSTRAINT org_deks_destroy_after_backup_window
  CHECK (destroyed_at IS NULL OR destroyed_at >= retired_at + interval '35 days');
```
*왜 CHECK인가* — 이 규칙을 어기면 **복구 불가능한 데이터 손실**이 발생하고, 발견은 사고가 난 뒤다. 되돌릴 수 없는 조치에는 항상 DB 가드를 둔다(SECURITY §9.7의 "되돌릴 수 없는 조치에는 항상 유예를").

**퇴사 시 L4 즉시 파기**(SECURITY §9.2 D-day)와의 충돌 — 이건 DEK가 아니라 **행 삭제 + 키 슬롯 파기**다:
```sql
CREATE FUNCTION app.destroy_l4_for_user(p_user uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, audit, pg_temp AS $$
DECLARE n int;
BEGIN
  -- ★ 휴지통 없음. 즉시 물리 삭제 (SECURITY §2.5)
  DELETE FROM private_notes WHERE owner_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO audit.destruction_ledger(category, scope_ref, row_count, method, basis,
                                       executed_by, verification_query, verification_result_hash)
  VALUES ('L4', p_user::text, n, 'physical', 'offboarding', 'job:offboarding',
          'SELECT count(*) FROM private_notes WHERE owner_id = $1', 'pending');
  RETURN n;
END $$;
```
백업에서는 지우지 않는다(SECURITY §2.6) — 스냅샷 보존주기(35일) 경과로 자연 소멸하고, 복구 시 tombstone 재적용이 다시 지운다.

---

## 7. 마이그레이션 전략

### 7.1 구조 — Drizzle이 만드는 것과 사람이 쓰는 것을 섞지 않는다

```
db/
  schema/…                    Drizzle 스키마 (테이블·컬럼·인덱스·CHECK·FK)
  migrations/
    0000_init_types.sql       ★ 손수: DOMAIN, 확장, 스키마 생성
    0001_<drizzle>.sql        Drizzle Kit 생성
    0002_roles_grants.sql     ★ 손수: 롤·GRANT·DEFAULT PRIVILEGES
    0003_rls.sql              ★ 손수: ENABLE/FORCE RLS, 정책, app.* 함수
    0004_partitions.sql       ★ 손수: PARTITION BY, 초기 파티션
    0005_agg_views.sql        ★ 손수: agg 스키마 뷰·MV
    0006_<drizzle>.sql        Drizzle Kit 생성 (다음 스키마 변경)
    …
    meta/_journal.json        Drizzle Kit 관리
```

**규칙 3개**
1. **Drizzle Kit이 만든 파일을 손으로 고치지 않는다.** 고치면 다음 `generate`가 그 변경을 다시 만든다
2. **사람이 쓴 파일은 짝수 번호, Drizzle은 홀수 번호** 같은 규칙을 쓰지 않는다 — 순서가 꼬인다. 그냥 순번을 이어 쓰고, 파일명 접미사로 구분한다
3. **마이그레이션은 풀러를 우회한다.** `DIRECT_DATABASE_URL`(포트 5432, PgBouncer 아님)로 실행

```ts
// db/migrate.ts
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const sql = postgres(process.env.DIRECT_DATABASE_URL!, {
  max: 1,
  ssl: 'verify-full',
  // ★ 마이그레이션 계정은 migrate_conn (migrator 롤 상속)
});
await migrate(drizzle(sql), { migrationsFolder: 'db/migrations' });
```

### 7.2 초기 마이그레이션 순서

순서가 틀리면 배포가 실패한다. **의존성이 있는 순서다.**

```
0000  CREATE SCHEMA app, agg, audit
      CREATE DOMAIN sort_key_t AS text COLLATE "C"
      (확장은 설치하지 않는다 — pgcrypto 특히. §6.3)
        ↓
0001  Drizzle: enum → 테이블 → 인덱스 → FK → CHECK
      ★ operations / audit_logs / view_logs 는 여기서 만들지 않는다 (파티션이므로)
        ↓
0002  롤 생성 + GRANT + ALTER DEFAULT PRIVILEGES
      ★ 반드시 테이블 생성 이후. 없는 테이블에 GRANT는 실패한다
      ★ ALTER DEFAULT PRIVILEGES는 이후 테이블에만 적용되므로 여기와 0001 순서가 중요
        ↓
0003  app.* 헬퍼 함수 → ENABLE/FORCE RLS → 정책
      ★ 함수가 정책보다 먼저. 정책이 함수를 참조한다
        ↓
0004  파티션 테이블 생성 + 초기 파티션 12개월치 + pg_partman 또는 자체 함수
        ↓
0005  period_presets 시드 → process_rollup → agg_cells_mv → agg_public → 축별 뷰
      ★ MV가 참조하는 테이블이 전부 있어야 한다
        ↓
0006  agg 뷰 GRANT to admin_reader
      ★ 뷰 생성 이후
        ↓
0007  시드: tools 48종, business_objects 시스템 원형 30종
```

**`0000`에 `sort_key_t` 도메인이 있는 이유** — Drizzle이 `0001`에서 `sort_key sort_key_t NOT NULL` 컬럼을 만들려면 타입이 이미 있어야 한다.

### 7.3 `COLLATE "C"` 같은 필수 DDL을 어떻게 넣는가

**나쁜 방법 (ARCHITECTURE 초안)**
```sql
ALTER TABLE items ALTER COLUMN sort_key TYPE text COLLATE "C";
```
문제 셋:
1. **Drizzle Kit이 collation을 diff하지 않는다.** 다음 `generate`가 이 컬럼을 `text`로 인식하고, 어떤 변경(예: NOT NULL 추가)이 생기면 `ALTER COLUMN TYPE text`를 만들어 **collation을 조용히 벗긴다**
2. `ALTER COLUMN TYPE`은 테이블을 재작성하고 인덱스를 재구축한다. 40,000행이면 순간이지만, 이 DDL이 나중에 또 나가면 그때는 아플 수 있다
3. **정렬이 조용히 틀어진다.** 에러가 없다

**채택하는 방법 — 도메인**
```sql
-- 0000_init_types.sql
CREATE DOMAIN sort_key_t AS text COLLATE "C";
```
```ts
export const sortKey = customType<{ data: string; driverData: string }>({
  dataType: () => 'sort_key_t',
});
```
효과:
- Drizzle Kit은 `sort_key_t`를 불투명한 타입 이름으로 본다. 컬럼 타입이 바뀌지 않는 한 diff가 안 생긴다
- 새 테이블에서 정렬 키를 쓸 때 **타입 이름만 쓰면 collation이 따라온다.** 잊을 수 없다
- 도메인에 CHECK를 추가하면 전 컬럼에 적용된다:
```sql
ALTER DOMAIN sort_key_t ADD CONSTRAINT sort_key_base62
  CHECK (VALUE ~ '^[0-9A-Za-z]+$');
```

**같은 패턴을 쓸 다른 자리**
| 도메인 | 정의 | 왜 |
|---|---|---|
| `sort_key_t` | `text COLLATE "C"` | 바이트 정렬 |
| `email_t` | `citext` 대신 `text CHECK (VALUE = lower(VALUE))` | 대소문자 정규화를 저장 시점에 강제 |
| `pid_t` | `text CHECK (length(VALUE) = 22)` | pid 형식 고정 |

**검증을 CI에 건다** — 도메인을 써도 누군가 `text`로 컬럼을 만들 수 있다.
```sql
-- 정렬에 쓰이는 컬럼이 전부 sort_key_t인지
SELECT c.table_name, c.column_name, c.domain_name
FROM information_schema.columns c
WHERE c.column_name LIKE '%sort_key%'
  AND (c.domain_name IS DISTINCT FROM 'sort_key_t');
-- 결과가 비어 있어야 통과
```

### 7.4 무중단 마이그레이션 규칙

**대전제** — 배포 중 **구 버전 코드와 신 버전 코드가 동시에 돈다.** 마이그레이션은 두 버전 모두에서 동작해야 한다.

#### 컬럼 추가

```
안전:  ADD COLUMN x type NULL
       ADD COLUMN x type NOT NULL DEFAULT <상수>     ← PG11+ 는 재작성 안 함
위험:  ADD COLUMN x type NOT NULL DEFAULT <volatile 함수>   ← 전체 재작성
       ADD COLUMN x uuid NOT NULL DEFAULT gen_random_uuid() ← 재작성 + 긴 락
```
**규칙**: 새 NOT NULL 컬럼은 **3단계**로.
```
배포 1: ADD COLUMN x NULL                        (구 코드 영향 없음)
배포 2: 신 코드가 x를 쓰기 시작 + 백필 배치
배포 3: ALTER COLUMN x SET NOT NULL              (NOT VALID CHECK → VALIDATE 경로 권장)
```
```sql
-- 락을 짧게 하는 정석
ALTER TABLE items ADD CONSTRAINT items_x_not_null CHECK (x IS NOT NULL) NOT VALID;
ALTER TABLE items VALIDATE CONSTRAINT items_x_not_null;   -- SHARE UPDATE EXCLUSIVE만
ALTER TABLE items ALTER COLUMN x SET NOT NULL;            -- PG12+ 는 위 CHECK를 보고 스캔 생략
ALTER TABLE items DROP CONSTRAINT items_x_not_null;
```

#### 컬럼 삭제

```
배포 1: 코드에서 컬럼 참조 제거. ★ Drizzle 스키마에서도 뺀다
배포 2: (최소 1회 릴리스 간격 후) DROP COLUMN
```
**Drizzle 함정** — 스키마에서 컬럼을 빼면 `generate`가 즉시 `DROP COLUMN`을 만든다. 그래서 배포 1에서는 컬럼을 남기되 **`@deprecated` 주석 + 코드 참조 0**으로 두고, 배포 2에서 스키마에서 뺀다.

#### 컬럼 이름 변경 — **하지 않는다**

```
✗ ALTER TABLE ... RENAME COLUMN old TO new
```
`RENAME`은 원자적이라 구 코드가 **즉시** 깨진다. 무중단이 불가능하다.
```
채택: ADD new → 백필 + 이중 쓰기 → 읽기 전환 → DROP old
```
Drizzle Kit은 컬럼 이름이 바뀌면 대화형으로 "renamed or dropped+created?"를 묻는다. **CI에서는 대화형이 없으므로 `drizzle-kit generate`를 로컬에서만 돌리고 결과 SQL을 커밋한다.** 그리고 생성된 SQL에 `RENAME`이 있으면 리뷰에서 되돌린다.

#### 인덱스

```sql
-- ★ 항상 CONCURRENTLY. 그리고 트랜잭션 밖에서
CREATE INDEX CONCURRENTLY items_new_idx ON items (...);
DROP INDEX CONCURRENTLY items_old_idx;
```
Drizzle Kit은 `CONCURRENTLY`를 만들지 않는다. **인덱스는 손수 쓴 마이그레이션으로 옮긴다.** 규모가 작아 지금은 락이 짧지만, 습관을 지금 만든다.

`CREATE INDEX CONCURRENTLY`는 트랜잭션 안에서 못 돈다. Drizzle 마이그레이터는 각 파일을 트랜잭션으로 감싸므로, 인덱스 파일에는 마커를 넣는다:
```sql
-- migration:no-transaction
CREATE INDEX CONCURRENTLY ...;
```
(마이그레이터 래퍼가 이 주석을 보고 트랜잭션을 생략하게 한다. Drizzle 기본 마이그레이터에는 이 기능이 없으므로 얇은 래퍼를 만든다 — §7.5)

#### RLS 정책 변경

```sql
-- ★ DROP 후 CREATE 하지 않는다. 그 사이가 무방비다
--   같은 트랜잭션 안에서 하면 안전하지만, 이름을 바꿔 추가 후 삭제가 더 안전하다
BEGIN;
  CREATE POLICY documents_read_v2 ON documents FOR SELECT TO app_user USING (...);
  DROP POLICY documents_read ON documents;
  ALTER POLICY documents_read_v2 ON documents RENAME TO documents_read;
COMMIT;
```
정책은 permissive가 기본이라 **둘 다 있으면 OR**가 된다 — 잠깐 넓어진다. 위 순서는 한 트랜잭션이라 외부에서 그 중간 상태가 보이지 않는다.

#### 타입(enum) 값 추가

```sql
ALTER TYPE node_kind ADD VALUE 'note';   -- PG12+ 트랜잭션 안에서 가능, 단 같은 tx에서 사용 불가
```
값 **제거**는 불가능하다. 그래서 enum은 **정말 닫힌 집합에만** 쓴다(§1.1). 열릴 가능성이 있으면 `text + CHECK`가 낫다 — CHECK는 고칠 수 있다.

### 7.5 롤백 가능성

**원칙: 모든 마이그레이션은 "앞으로만" 간다. down 마이그레이션을 쓰지 않는다.**

*왜* — down 마이그레이션은 (a) 거의 테스트되지 않고 (b) 데이터 손실을 되돌리지 못하며 (c) 있으면 사람이 프로덕션에서 쓴다. Drizzle Kit도 down을 만들지 않는다.

**대신 "롤백 가능한 마이그레이션만 쓴다"**

| 변경 | 롤백 가능? | 방법 |
|---|---|---|
| 컬럼 추가(NULL) | ✔ | 구 코드가 무시한다. 그냥 배포를 되돌린다 |
| 인덱스 추가 | ✔ | 성능만 영향 |
| 정책 추가/완화 | ✔ | 코드 롤백으로 충분 |
| **정책 강화** | ✔ | 신 코드가 못 읽게 되면 배포를 되돌린다 |
| CHECK 추가 | ◐ | 위반 데이터가 이미 있으면 추가 자체가 실패. `NOT VALID`로 먼저 |
| 컬럼 삭제 | **✗** | 그래서 2단계 배포로 미룬다 |
| 타입 변경 | **✗** | 새 컬럼 + 백필로 우회 |
| 파티션 드롭 | **✗** | 보존 배치만. 사람이 실행 안 함 |

**되돌릴 수 없는 마이그레이션은 별도 승인** — 파일명에 `_irreversible`을 붙이고, CI가 그 파일이 포함된 PR에 리뷰어 2인을 요구한다.

### 7.6 Drizzle Kit 사용 시 주의점

| # | 주의 | 왜 |
|---|---|---|
| 1 | **`drizzle-kit push`를 금지한다** | `push`는 diff를 즉시 적용하는데, **RLS 정책·GRANT·뷰·파티션을 모른다.** 스키마를 "정리"하면서 정책을 날린다. `package.json`에서 스크립트를 제거하고, CI가 `push` 문자열을 grep으로 막는다 |
| 2 | `generate`는 로컬에서만 | 컬럼 rename 판정이 대화형이다 |
| 3 | **생성된 SQL을 반드시 읽는다** | `DROP COLUMN` / `RENAME` / `ALTER COLUMN TYPE`이 있으면 §7.4로 되돌린다. CI가 이 3개 패턴을 grep해서 라벨을 요구 |
| 4 | 뷰·정책·함수는 Drizzle 밖 | Drizzle 스키마에 없으므로 diff에 안 나타난다. 그래서 **손수 쓴 마이그레이션이 뒤에 오도록** 번호를 관리 |
| 5 | 파티션 테이블 | Drizzle이 `PARTITION BY`를 생성하지 못한다. 해당 테이블은 스키마에 정의하되 **초기 생성은 손수 SQL**로 하고, Drizzle 마이그레이션에서는 `IF NOT EXISTS` 취급이 되도록 순서를 잡는다 |
| 6 | `CONCURRENTLY` | 생성 안 됨. 인덱스는 손수 파일로 |
| 7 | 표현식 인덱스 | `sql`` `` `로 쓴 인덱스는 diff가 불안정할 수 있다. 안정될 때까지 손수 파일로 빼는 것을 고려 |
| 8 | `ALTER DEFAULT PRIVILEGES` | Drizzle이 모른다. 새 테이블이 생길 때마다 GRANT를 잊지 않으려면 **0002에서 DEFAULT PRIVILEGES를 걸어두는 것이 필수** |
| 9 | 마이그레이션 래퍼 | `-- migration:no-transaction` 지원을 위해 얇은 래퍼를 만든다 |
| 10 | 스키마 드리프트 검사 | CI에서 `drizzle-kit generate --check`(또는 임시 DB에 마이그레이션 적용 후 diff)로 **스키마 파일과 마이그레이션이 일치**함을 검증 |

```json
// package.json — push가 없다
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate":  "tsx db/migrate.ts",
    "db:check":    "drizzle-kit check"
  }
}
```
```bash
# CI 가드
grep -rn "drizzle-kit push" --include=*.json --include=*.ts --include=*.yml . \
  && { echo "drizzle-kit push는 금지입니다 (SCHEMA.md §7.6)"; exit 1; }
```

---

## 8. 파티셔닝 · 보존

### 8.1 무엇을 파티션하나

| 테이블 | 연간 증가 | 파티션 | 근거 |
|---|---|---|---|
| `operations` | **~500,000행** | RANGE(ts) 월 | 보존이 시간 기준. 드롭이 유일한 삭제 수단 |
| `audit.audit_logs` | ~2,000,000행 | RANGE(ts) 월 | 위와 같음 + 카테고리별 보존 |
| `view_logs` | ~200,000행 | RANGE(at) 월 | 1년 보존. 90일 창 쿼리가 파티션 프루닝을 탄다 |
| `snapshots` | ~10,000행 | **안 함** | 문서당 최신 몇 개만 유지. 크기가 안 큰다 |
| `items` | 40,000행 (누적) | **안 함** | 파티션할 이유가 없다. 오히려 트리 쿼리가 느려진다 |
| `documents` | 3,000행 | **안 함** | 같음 |

**500,000 op/년은 파티션이 필요한 규모가 아니다.** 그런데도 파티션하는 이유는 **성능이 아니라 삭제 때문**이다.

> 행 단위 `DELETE` 권한을 아무에게도 안 주기로 했으므로(§3.1, §5.3), **삭제할 수 있는 유일한 방법이 파티션 드롭이어야 한다.** 파티션이 없으면 언젠가 누군가에게 `DELETE` 권한을 줘야 하고, 그 권한은 회수되지 않는다.

### 8.2 파티션 DDL

```sql
-- 0004_partitions.sql
CREATE TABLE operations (
  doc_id  uuid    NOT NULL,
  seq     integer NOT NULL,
  org_id  uuid    NOT NULL,
  actor_id uuid   NOT NULL,
  op      jsonb   NOT NULL,
  ts      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, seq, ts),
  CONSTRAINT operations_op_type CHECK (op->>'type' IN (...))
) PARTITION BY RANGE (ts);

CREATE TABLE audit.audit_logs (...) PARTITION BY RANGE (ts);
CREATE TABLE view_logs (...)        PARTITION BY RANGE (at);

-- 파티션 생성·정리를 한 함수로
CREATE FUNCTION app.ensure_partitions(p_months_ahead int DEFAULT 3) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, audit, pg_temp
AS $$
DECLARE
  spec record; m date;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public','operations','ts'),
      ('audit','audit_logs','ts'),
      ('public','view_logs','at')
    ) AS t(sch, tbl, col)
  LOOP
    FOR i IN 0..p_months_ahead LOOP
      m := date_trunc('month', now())::date + (i || ' months')::interval;
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %I.%I
           FOR VALUES FROM (%L) TO (%L)',
        spec.sch, spec.tbl || '_' || to_char(m, 'YYYYMM'),
        spec.sch, spec.tbl, m, (m + interval '1 month'));
      -- ★ 새 파티션에도 RLS를 강제한다. 파티션은 정책을 상속하지만 FORCE는 상속 안 한다
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                     spec.sch, spec.tbl || '_' || to_char(m, 'YYYYMM'));
    END LOOP;
  END LOOP;
END $$;
```

> **`FORCE ROW LEVEL SECURITY`가 파티션에 상속되지 않는 것이 이 절의 함정이다.**
> 정책(`POLICY`)은 부모에 걸면 파티션에도 적용되지만, `relforcerowsecurity` 플래그는 파티션마다 별도다. 새 파티션을 만들 때마다 `FORCE`를 걸지 않으면 **`migrator` 커넥션에서 그 달 데이터만 RLS가 안 걸린다.** §11.1의 테스트가 전 파티션을 전수 검사한다.

**파티션 드롭 가드 — `operations`는 스냅샷 없이 드롭하지 않는다**

```sql
CREATE FUNCTION app.drop_operations_partition(p_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE unsnapshotted int;
BEGIN
  -- 이 파티션의 op 중 스냅샷이 커버하지 못한 것이 있으면 드롭 금지
  EXECUTE format($q$
    SELECT count(*) FROM public.%I o
     WHERE NOT EXISTS (
       SELECT 1 FROM snapshots s
        WHERE s.doc_id = o.doc_id AND s.through_seq >= o.seq)
  $q$, p_name) INTO unsnapshotted;

  IF unsnapshotted > 0 THEN
    RAISE WARNING '% : 스냅샷 미커버 op % 건. 드롭하지 않음', p_name, unsnapshotted;
    RETURN false;
  END IF;
  EXECUTE format('DROP TABLE public.%I', p_name);
  RETURN true;
END $$;
```
*왜* — `operations` 보존은 180일인데, 어떤 문서가 180일 동안 편집되지 않았고 스냅샷도 안 찍혔다면 op을 지우는 순간 **그 문서를 복원할 수 없다.** 스냅샷 주기를 `50 op 또는 24시간`으로 잡은 이유가 이것이다(§1.6) — 24시간 조건이 있으면 이 가드가 걸릴 일이 없다.

### 8.3 보존 기간 자동 집행

| 데이터 | 보존 | 집행 방법 | 주기 |
|---|---|---|---|
| `operations` | **180일** | 파티션 드롭 (+스냅샷 가드) | 일 1회 |
| `audit.audit_logs` | 카테고리별 **1년 / 3년** | 파티션 드롭 (행별 보존 가드, §5.3) | 일 1회 |
| `view_logs` | **1년** (표시 창 90일) | 파티션 드롭 | 일 1회 |
| `view_logs.ip_hash` | **30일** | `UPDATE … SET ip_hash = NULL` — 유일하게 허용된 감사성 UPDATE | 일 1회 |
| `exports` + S3 오브젝트 | `expires_at` | 행 삭제 + S3 삭제 | 시간 1회 |
| **P1 원시 이벤트** | **180일** | ★ Postgres 밖(PostHog/ClickHouse) TTL. Postgres는 관여하지 않는다 | ClickHouse TTL |
| P1 롤업 | 25개월 | 같음 | |
| P2 집계 (`agg_cells_mv`) | 25개월 | `period_presets`에서 25개월 넘은 `YYYY-MM` 삭제 → CASCADE | 월 1회 |
| 문서 tombstone | **30일** → 물리 삭제 | §8.4 | 일 1회 |
| `p1_deletion_queue` | **24시간 SLA** | 워커가 PostHog에 삭제 요청 | 15분 1회 |
| `org_salt` | 12개월 회전 | Secrets Manager 회전 + `org_salt_rotations` 기록 | 연 1회 |
| `share_links` 만료 | `expires_at` | 스위퍼가 `revoked_at` 설정(행은 남긴다 — 감사) | 시간 1회 |
| `departments.k_eligible` | — | 인원 재계산 | 일 1회 |
| `agg_cells_mv` | — | `REFRESH … CONCURRENTLY` | 일 1회 (야간) |

> **"P1 180일"을 Postgres에서 집행하지 않는다는 것이 중요한 사실이다.** P1은 PostHog(ClickHouse)에 있고, Postgres에는 **삭제해야 할 pid 목록**만 있다(`p1_deletion_queue`). MEASUREMENT §1의 단방향 규칙(P1→P2 파이프라인 부재)이 스키마에 반영된 결과다 — Postgres가 P1을 읽는 경로가 없으므로, P1의 보존을 Postgres가 집행할 수도 없다.

**배치의 동시 실행 방지 — advisory lock을 쓰지 않는다**

```sql
CREATE TABLE job_leases (
  job_name  text PRIMARY KEY,
  holder    text NOT NULL,
  leased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- 리스 획득
INSERT INTO job_leases (job_name, holder, expires_at)
VALUES ($1, $2, now() + interval '10 minutes')
ON CONFLICT (job_name) DO UPDATE
  SET holder = EXCLUDED.holder, leased_at = now(), expires_at = EXCLUDED.expires_at
  WHERE job_leases.expires_at < now()
RETURNING holder;
```
*왜 advisory lock이 아닌가* — `pg_advisory_lock`은 **세션 상태**라 RDS Proxy/PgBouncer에서 커넥션 핀닝을 유발한다(§3.7-7). 테이블 리스는 트랜잭션으로 끝나고 상태를 남기지 않는다.

### 8.4 문서 삭제 시 연쇄 처리

```
T+0     소유자가 삭제
        ├─ documents.deleted_at = now()                 ← tombstone. RLS가 즉시 숨긴다
        ├─ share_links: revoked_at = now() (전량)        ← 링크 즉시 무효
        ├─ private_notes: ★ 즉시 물리 삭제 (휴지통 없음)  ← SECURITY §2.5
        ├─ handoff_links: status = 'severed'            ← ASSEMBLY §6
        ├─ discrepancies: 링크 CASCADE로 삭제            ← "근거가 사라졌는데 결론만 남으면 안 된다"
        ├─ p1_deletion_queue += (doc_pid, due = +24h)
        └─ audit: 'delete_restore' / retention 3년

T+24h   P1(PostHog)에서 doc_pid 관련 이벤트 물리 삭제
        ★ 미이행 시 P0

T+30d   물리 삭제 배치
        ├─ DELETE FROM documents WHERE deleted_at < now() - 30d
        │    → items · edges · handoff_sockets · operations(파티션 밖) CASCADE
        ├─ S3 첨부·내보내기 오브젝트 삭제
        ├─ view_logs: ★ 지우지 않는다 (1년 보존, 법정 접속기록)
        └─ destruction_ledger 기록 + 검증 쿼리 0건 확인

T+65d   RDS 스냅샷 보존주기(35일) 경과로 백업에서 자연 소멸
```

```sql
CREATE FUNCTION app.soft_delete_document(p_doc uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, audit, pg_temp
AS $$
BEGIN
  -- 소유자 확인은 RLS가 아니라 명시적으로 (DEFINER이므로)
  IF NOT EXISTS (SELECT 1 FROM documents d
                  WHERE d.id = p_doc AND d.created_by = app.current_user_id()) THEN
    RAISE EXCEPTION 'not owner';
  END IF;

  UPDATE documents SET deleted_at = now() WHERE id = p_doc;
  UPDATE share_links SET revoked_at = now(), revoked_by = app.current_user_id()
   WHERE doc_id = p_doc AND revoked_at IS NULL;
  DELETE FROM private_notes WHERE doc_id = p_doc;              -- ★ 즉시. 휴지통 없음
  UPDATE handoff_links SET status = 'severed', severed_at = now()
   WHERE outbound_socket_id IN (SELECT id FROM handoff_sockets WHERE doc_id = p_doc)
      OR inbound_socket_id  IN (SELECT id FROM handoff_sockets WHERE doc_id = p_doc);
  INSERT INTO audit.p1_deletion_queue(pid, pid_kind, due_at)
  VALUES (app.doc_pid(p_doc), 'doc', now() + interval '24 hours');

  PERFORM app.audit('delete_restore', 'soft_delete', 'document', p_doc::text, 3);
END $$;
```

**집계는 되돌리지 않는다** (SECURITY §2.5):
```
✗ 삭제된 문서를 agg_cells_mv에서 빼고 재계산  ← 하지 않는다
```
*왜* — "한 사람이 빠졌다고 집계를 재계산하면 **전후 차분으로 그 사람의 기여분이 역산된다.** 삭제가 오히려 개인을 드러낸다." `agg_cells_mv`의 소스인 `process_rollup`은 삭제된 문서를 제외하지만(§4.1의 `d.deleted_at IS NULL`), **과거 기간(`YYYY-MM`, `frozen=true`)의 롤업 행은 재계산되지 않는다.** 이게 `period_presets.frozen` 컬럼의 존재 이유다.

**복원**
```sql
-- 30일 안에는 tombstone 해제로 끝난다. private_notes는 돌아오지 않는다 (경고 문구 필요)
UPDATE documents SET deleted_at = NULL WHERE id = $1 AND deleted_at > now() - interval '30 days';
```
UI에 반드시 표시: **"비공개 노트는 복구되지 않습니다."** 삭제 시점에도 같은 문구를 보여준다.

---

## 9. 조직 격리

### 9.1 `orgId`를 어디까지 강제하는가 — 3계층

```
① 물리 계층 — 복합 FK
   자식 행의 org_id가 부모와 다르면 INSERT 자체가 실패한다
        ↓
② 정책 계층 — RLS
   현재 세션의 org를 벗어난 행은 보이지 않는다
        ↓
③ 애플리케이션 계층 — 타입
   테넌트 스코프 없는 쿼리가 컴파일되지 않는다
```
SECURITY §7.3B: "둘 중 하나만 있으면 언젠가 뚫린다." 우리는 셋을 둔다.

**`orgId`를 두는 테이블 / 두지 않는 테이블**

| 두는 곳 | 왜 |
|---|---|
| `documents`, `items`, `edges`, `handoff_sockets`, `handoff_links`, `share_links`, `view_logs`, `operations`, `snapshots`, `exports`, `private_notes`, `checklist_runs`, `discrepancies`, `process_rollup` | 복합 FK의 앵커. 그리고 파티션·집계에서 조인 없이 테넌트를 좁힌다 |
| `users`, `departments`, `directory_roles`, `glossary`, `tool_aliases`, `org_members` | 조직 직속 자식 |
| `tools`, `business_objects` | **nullable** — NULL = 시스템 카탈로그(전사 공통) |

| 두지 않는 곳 | 왜 |
|---|---|
| `item_tools` | `items`를 통해서만 도달 가능. 자체 쿼리 경로가 없다 |
| `socket_artifacts` | `handoff_sockets` 자식 |
| `document_members` | `documents` 자식. 그리고 org를 넘는 멤버십이 원리적으로 없다 |
| `layout_cache` / `layout_overrides` | `documents` 자식 |
| `period_presets` | 전역 |
| `job_leases` | 인프라 |

**판단 기준**: *그 테이블만 단독으로 조회하는 코드 경로가 있는가?* 있으면 `orgId`를 둔다. 없으면 부모를 통해 격리된다.

### 9.2 복합 FK — 크로스 테넌트를 물리적으로 불가능하게

```sql
-- 부모에 (id, org_id) 유니크가 있어야 자식이 복합 FK를 걸 수 있다
CREATE UNIQUE INDEX documents_id_org   ON documents   (id, org_id);
CREATE UNIQUE INDEX users_id_org       ON users       (id, org_id);
CREATE UNIQUE INDEX departments_id_org ON departments (id, org_id);

-- 자식
ALTER TABLE items ADD CONSTRAINT items_doc_org_fk
  FOREIGN KEY (doc_id, org_id) REFERENCES documents (id, org_id) ON DELETE CASCADE;
ALTER TABLE edges ADD CONSTRAINT edges_doc_org_fk
  FOREIGN KEY (doc_id, org_id) REFERENCES documents (id, org_id) ON DELETE CASCADE;
ALTER TABLE handoff_sockets ADD CONSTRAINT sockets_doc_org_fk
  FOREIGN KEY (doc_id, org_id) REFERENCES documents (id, org_id) ON DELETE CASCADE;
ALTER TABLE share_links ADD CONSTRAINT share_links_doc_org_fk
  FOREIGN KEY (doc_id, org_id) REFERENCES documents (id, org_id) ON DELETE CASCADE;
ALTER TABLE private_notes ADD CONSTRAINT private_notes_owner_org_fk
  FOREIGN KEY (owner_id, org_id) REFERENCES users (id, org_id) ON DELETE CASCADE;
ALTER TABLE documents ADD CONSTRAINT documents_owner_org_fk
  FOREIGN KEY (created_by, org_id) REFERENCES users (id, org_id);
```

**이게 막는 것**
```sql
-- 조직 A의 사용자가 조직 B의 문서 아래에 항목을 만들려는 시도
INSERT INTO items (id, doc_id, org_id, …)
VALUES (…, '<조직B의 doc>', '<조직A>', …);
--  ERROR: insert or update on table "items" violates foreign key constraint
--  ★ RLS가 뚫려도, 애플리케이션 버그가 있어도, 배치가 실수해도 실패한다
```

**대가와 그 판단**
- `items.org_id`는 비정규화다. `documents`를 조인하면 알 수 있는 값을 중복 저장한다
- 문서를 다른 조직으로 옮기려면 자식 전부를 함께 UPDATE해야 한다 → **그런데 우리는 테넌트 병합·이동을 하지 않기로 했다**(SECURITY §9.6: M&A 시 새 테넌트로 마이그레이션)
- **결론: 이동이 없으므로 비정규화 비용이 0이다.** 이 판단은 "테넌트 자동 병합 금지" 결정에 의존한다 — 그 결정이 뒤집히면 이 설계도 다시 봐야 한다

**`assigneeId`는 왜 복합 FK가 아닌가** — `items.assignee_id → users.id`에 `(assignee_id, org_id) → users(id, org_id)`를 걸면 완벽하지만, `assignee_id`가 nullable이라 `MATCH SIMPLE`(기본)에서는 org_id만 있고 assignee가 NULL인 경우가 통과한다. 실질적으로는 안전하지만 명시적으로 하려면:
```sql
ALTER TABLE items ADD CONSTRAINT items_assignee_org_fk
  FOREIGN KEY (assignee_id, org_id) REFERENCES users (id, org_id) MATCH SIMPLE;
```
을 걸고, `assignee_id IS NOT NULL`인 경우만 검사되도록 둔다. **NULL 처리 때문에 조용히 무력한 제약이 되는 경우가 많으므로, 복합 FK를 걸 때는 항상 nullable 여부를 확인한다.**

### 9.3 RLS의 테넌트 조건

모든 쓰기 정책의 `WITH CHECK`에 `org_id = app.current_org_id()`가 들어간다(§3.4). 읽기는 `can_read_document()`가 이미 문서 단위로 좁히므로 org 조건이 중복이지만, **명시적으로 넣는다**:

```sql
-- items_read를 다음처럼 강화한다
CREATE POLICY items_read ON items FOR SELECT TO app_user
USING (
  org_id = app.current_org_id()          -- ★ 먼저. 인덱스가 아니라 방어의 순서
  AND deleted_at IS NULL
  AND app.can_read_document(doc_id)
);
```
*왜 중복을 넣나* — `can_read_document()`가 언젠가 리팩터링되어 org 조건을 잃을 수 있다. **테넌트 격리는 다른 모든 정책이 깨져도 남아 있어야 하는 최후 방어선**이므로 각 정책에 직접 쓴다. 성능상으로도 `org_id` 등가 조건이 먼저 평가되어 대부분의 행이 함수 호출 전에 떨어진다.

### 9.4 부서·조직 변경 시의 규칙 (SECURITY §9.5)

| 사건 | 처리 | 스키마 근거 |
|---|---|---|
| 부서 폐지 | **ID를 삭제하지 않는다.** `departments.deleted_at` 설정, 참조는 유지 | `ON DELETE SET NULL`이 아니라 tombstone |
| 부서 분할·병합 | **새 부서 ID 발급.** 과거 집계는 구 ID로 남는다 | `documents.dept_id_at_write` |
| 사람의 부서 이동 | 과거 문서의 귀속 부서는 **안 바뀐다** | 같음 |
| 부서가 5인 미만이 됨 | `k_eligible = false` → **과거 셀까지 억제** | §4.5 |
| SCIM 오설정 대량 deprovision | **30일 유예.** 자동 처리 없음 | `users.seal_eligible_at` |
| SCIM 오류로 잘못 비활성 | **7일 유예.** 링크 만료·L4 파기 보류 | `users.deprovisioned_at` |
| 테넌트 병합(M&A) | **하지 않는다.** 새 테넌트로 마이그레이션 | 복합 FK가 병합을 물리적으로 어렵게 만든다 — 의도한 마찰 |

**부서 ID 재사용 금지를 DB가 강제한다**
```sql
-- external_id 유니크가 tombstone된 행까지 포함하도록 부분 인덱스를 쓰지 않는다
CREATE UNIQUE INDEX departments_org_external ON departments (org_id, external_id)
  WHERE external_id IS NOT NULL;
--  ★ deleted_at 조건이 없다. 폐지된 부서의 external_id도 점유된 채로 남는다.
--    "ID 재사용은 데이터 오염"(SECURITY §9.5)을 유니크 인덱스로 못 박는다
```

### 9.5 크로스 테넌트 테스트 (§11.4에 구현)

SECURITY §7.3B가 요구한 것: "조직 A 세션으로 조직 B의 모든 리소스 ID에 접근 시도 → **전부 404여야 통과.** 실패 시 배포 차단."

**"전부"의 의미를 스키마가 정의한다** — 테스트는 `information_schema.tables`를 읽어 **public 스키마의 모든 테이블**에 대해 자동으로 돈다. 새 테이블을 만들면 테스트가 자동으로 그 테이블도 검사한다. 테이블 목록을 손으로 유지하면 41번째 테이블에서 뚫린다.

---

## 10. 성능

### 10.1 예상 규모

| 대상 | 규모 | 비고 |
|---|---|---|
| 조직 인원 | **300명** | 기준 조직(PRD §5) |
| 문서 | **3,000개** | 1인당 10개 |
| 항목 | **40,000개** | 문서당 13개 |
| op | **500,000건/년** | 문서당 167건/년 |
| 엣지(명시) | ~4,000 | 파생 엣지는 저장 안 함 |
| 접합 소켓 | ~6,000 | 문서당 2개 |
| 접합 링크 후보 | 50만 쌍 → 블로킹 후 수만 쌍 | ASSEMBLY §3.5 |
| 열람 로그 | ~200,000/년 | |
| 감사 로그 | ~2,000,000/년 | |
| 비공개 노트 | ~2,000 | |

**전체 데이터 크기: 힙 기준 수 GB.** `db.t4g.medium`(4GB RAM)에서 **활성 데이터가 전부 shared_buffers에 들어간다.**

> **이 규모에서 성능 문제는 데이터 크기 때문에 안 생긴다.** 아래 열거하는 것들은 전부 "크기가 아닌 이유"다.

### 10.2 느려질 지점 예측 — 크기순이 아니라 확률순

| # | 지점 | 왜 | 증상 | 대응 |
|---|---|---|---|---|
| **1** | **RLS 정책의 함수 호출** | `can_read_document()`가 **행마다** 평가된다. 문서 3,000행이면 3,000회 | 문서함 조회가 갑자기 200ms | `STABLE` 유지(문장 내 캐싱), `org_id` 등가 조건을 정책 앞에 배치(§9.3), `document_members_user` 인덱스(§2.3). 그래도 느리면 `can_read_document`를 **정책에서 인라인 EXISTS로 펼친다** — 함수 호출 오버헤드가 사라지고 플래너가 semi-join으로 변환한다 |
| **2** | **서버리스 커넥션 폭발** | Next.js 인스턴스마다 풀. 스케일아웃 = 커넥션 × N | `too many connections`. 그리고 **RLS 세션 변수 초기화 실패로 크로스테넌트** | §10.3 |
| **3** | `agg_cells_mv` REFRESH | 4축 UNION + `CROSS JOIN period_presets`. 프리셋이 늘면 곱해진다 | 야간 배치가 아침까지 | `REFRESH … CONCURRENTLY`, `YYYY-MM`은 `frozen`이면 재계산 제외(증분 갱신) |
| **4** | 접합 후보 매칭 | 50만 쌍 | nightly 배치 초과 | 블로킹 키 + `socket_block_sizes`(ASSEMBLY §3.5). 큰 블록은 상한을 두고 자른다 |
| **5** | `items.attrs` jsonb TOAST | attrs가 커지면 항목 조회가 TOAST 왕복 | 문서 열람 p95 상승 | attrs에 큰 텍스트를 넣지 않는다. `description`이 길어지면 별도 컬럼으로 승격 |
| **6** | `derive()` 재계산 | 500단계 문서 | 서버 렌더 지연 | 서버에서 `derive()`를 돌리지 않는다. 클라이언트 + `layout_cache` |
| **7** | 감사 로그 해시 체인 | `app.audit()`가 매번 직전 행을 조회 | 쓰기 경합. **핫스팟** | org별 파티셔닝된 조회이므로 인덱스는 탄다. 그래도 병목이면 **체인을 org별이 아니라 일별 배치로** 바꾼다(일 1회 앵커링, SECURITY §5.5의 원문에 더 가깝다) |
| **8** | `view_logs` 쓰기 | 열람마다 INSERT | 공유 페이지 지연 | INSERT를 응답 경로에서 빼고 `after()`(Next 15)로 비동기. **단 유실되면 안 되므로 실패 시 재시도 큐** |
| 9 | 전문검색 | GIN 갱신 | 쓰기 지연 | 검색은 v1 범위 밖. 인덱스를 나중에 추가 |

**1번이 가장 확률이 높고 가장 늦게 발견된다.** RLS 오버헤드는 `EXPLAIN`의 최상단에 안 나타나고, "왜 이 간단한 쿼리가 느리지"로 나타난다. **초기부터 `EXPLAIN (ANALYZE, BUFFERS)`를 CI에 넣는다**(§11.5).

**7번의 실제 판단** — 해시 체인을 행마다 만들면 같은 org의 감사 쓰기가 직렬화된다. 감사 쓰기는 문서 열람마다 발생하므로 조직당 초당 수 건이 될 수 있다. **초기에는 행별 체인으로 가되, `audit_logs` 쓰기 p95가 20ms를 넘으면 일별 앵커링으로 전환한다.** 전환은 `prev_hash`를 NULL로 두고 별도 `audit.daily_anchor` 테이블을 쓰는 것이라 마이그레이션이 가볍다.

### 10.3 커넥션 풀링 — 서버리스 + Postgres

```
Next.js (Vercel/Lambda)  ──┐
   인스턴스 N개            │
   각 max: 5              ├──► PgBouncer / RDS Proxy ──► RDS Postgres
                          │      transaction 모드          max_connections 100
Workers (배치)           ──┘      pool_size 20
```

| 설정 | 값 | 왜 |
|---|---|---|
| `pool_mode` | **`transaction`** | session 모드는 서버리스에서 커넥션이 안 돌아온다 |
| `default_pool_size` | 20 | 300명 사내 도구. 20이면 충분하고, 남으면 RDS 메모리가 산다 |
| `server_reset_query_always` | **1** | `SET LOCAL`에 의존하되 이중 안전장치 |
| `max_client_conn` | 500 | 서버리스 인스턴스 수 × 앱 풀 |
| 앱 `max` | **5** | 인스턴스당. 크게 잡으면 풀러 앞에서 큐가 생긴다 |
| `prepare` | **`false`** | transaction 모드 필수 |
| `idle_timeout` | 20s | 서버리스 인스턴스가 얼면 커넥션을 잡고 있지 않게 |
| `statement_timeout` | **5s** (앱) / 30분(배치) | 폭주 쿼리 차단 |
| `idle_in_transaction_session_timeout` | **10s** | ★ `SET LOCAL` 컨텍스트를 가진 트랜잭션이 열린 채 방치되면 커넥션이 오염된 상태로 묶인다 |

**RDS Proxy vs PgBouncer**

| | RDS Proxy | PgBouncer (자체) |
|---|---|---|
| 운영 | 관리형 | EC2/ECS 운영 필요 |
| 핀닝 | `SET`·임시테이블·advisory lock에서 세션 고정 | 같음 |
| **`SET LOCAL`** | **핀닝 유발 안 함** ✔ | 같음 ✔ |
| IAM 인증 | ✔ | ✗ |
| 비용 | vCPU 시간당 | EC2 비용 |
| **판단** | **★ 채택.** 이 규모에서 PgBouncer를 직접 운영할 이유가 없다 | 세밀한 튜닝이 필요해지면 그때 |

**핀닝을 피하기 위해 하지 않는 것**
```
✗ pg_advisory_lock          → job_leases 테이블 (§8.3)
✗ 임시 테이블                → CTE
✗ SET (LOCAL 아님)           → set_config(_, _, true)
✗ LISTEN/NOTIFY              → 폴링 또는 외부 큐
✗ 커서(WITH HOLD)            → 페이지네이션
```

**서버리스에서 특히 위험한 시나리오 — 그리고 그 대응**
> 콜드 스타트 폭주 시 인스턴스가 50개 뜨고, 각각 커넥션 5개를 열려 한다. 풀러 앞에서 대기가 생기고, 타임아웃이 나고, **재시도가 다시 커넥션을 요구한다.**

대응: 앱 `max: 5` + `connect_timeout: 10` + **재시도 시 지수 백오프**. 그리고 `withUser()`가 커넥션 획득 실패를 **사용자에게 보이는 에러**로 변환한다 — 조용히 빈 결과를 반환하면 "내 문서가 사라졌다"가 된다.

### 10.4 읽기 복제본이 필요한 시점

**지금은 필요 없다.** 트리거는 다음 중 하나:

| # | 트리거 | 왜 그때인가 |
|---|---|---|
| 1 | `agg_cells_mv` REFRESH가 **주간 트래픽 시간대를 침범** | 야간 배치가 4시간을 넘으면 아침 9시에 걸린다. 그때 복제본으로 옮긴다 |
| 2 | 조직 30개 초과 또는 총 항목 100만 초과 | 데이터가 shared_buffers를 넘어서면 읽기 I/O가 쓰기와 경합한다 |
| 3 | 접합 매칭 배치가 30분 초과 | CPU를 쓰는 배치. 프라이머리에서 빼는 것이 이득 |
| 4 | p95 읽기 지연이 목표의 2배 지속 | 진짜 신호 |

**복제본을 쓸 때의 함정 — RLS는 복제본에서도 동작한다.** 다만:
- 복제본 커넥션도 `SET LOCAL`을 해야 한다. `withUserReadOnly()`를 별도로 만들고, **읽기 전용 트랜잭션(`SET TRANSACTION READ ONLY`)** 을 강제한다
- **복제 지연이 원칙 5를 깬다**: 열람 직후 소유자가 로그를 봤는데 아직 복제 안 됐으면 "안 보인다". 열람 로그 조회는 **반드시 프라이머리**로

> **먼저 할 일은 복제본이 아니다.** 순서: ① `agg_cells_mv` 증분 갱신 ② 배치를 야간으로 정렬 ③ 인스턴스 크기 한 단계 ④ 그래도 안 되면 복제본. 복제본은 **일관성 문제를 사서** 성능을 얻는 거래이고, 이 제품은 일관성(열람 로그)이 신뢰 장치다.

### 10.5 그 밖의 설정

```sql
-- 통계 목표: 파티션·부분 인덱스가 많아 플래너가 잘못 고를 여지가 있다
ALTER TABLE items      ALTER COLUMN doc_id  SET STATISTICS 500;
ALTER TABLE documents  ALTER COLUMN created_by SET STATISTICS 500;

-- 자동 VACUUM: 파티션 테이블은 기본값이 느슨하다
ALTER TABLE view_logs SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE operations SET (autovacuum_vacuum_scale_factor = 0.02);

-- ★ 문서·항목은 UPDATE가 잦다(revision, updated_at). HOT 업데이트 여지를 남긴다
ALTER TABLE documents SET (fillfactor = 85);
ALTER TABLE items     SET (fillfactor = 85);
```
*`fillfactor` 판단* — `items.last_confirmed_at`·`title` UPDATE가 잦은데, 인덱스가 안 걸린 컬럼만 바뀌면 HOT 업데이트가 되어 인덱스를 안 건드린다. `fillfactor 85`면 같은 페이지에 새 버전이 들어갈 여유가 생긴다. 대가는 힙 15% 증가인데, 수 GB 규모에서 무시할 수 있다.

---

## 11. 테스트

### 11.0 무엇을 테스트하는가

이 스키마의 테스트는 세 종류이고, **셋 중 첫째가 가장 중요하다.**

| 종류 | 검증 대상 | 실패 시 |
|---|---|---|
| **A. 구조 불변식** | 정책·롤·GRANT·FORCE 플래그가 존재하는가 | **배포 차단** |
| **B. 행동** | 각 롤로 실제 쿼리를 던져 결과가 맞는가 | 배포 차단 |
| **C. 퍼즈** | 임의 조합에서 불변식이 깨지지 않는가 | 배포 차단 |

A가 중요한 이유: **행동 테스트는 "지금 이 쿼리가 막힌다"를 증명하지만, 구조 테스트는 "막는 장치가 존재한다"를 증명한다.** 새 테이블·새 정책이 생겼을 때 A는 자동으로 그것도 검사하고, B는 누가 테스트를 추가해야만 검사한다.

### 11.1 구조 불변식 — 카탈로그를 읽는 테스트

```ts
// test/schema/invariants.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminSql } from './helpers';    // migrator 권한. 테스트 DB 전용

test('모든 public 테이블에 RLS가 ENABLE + FORCE 되어 있다', async () => {
  const rows = await adminSql`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','p')          -- 일반 + 파티션 부모
       AND c.relname NOT IN ('period_presets','job_leases')  -- 전역 테이블 화이트리스트
  `;
  const bad = rows.filter(r => !r.relrowsecurity || !r.relforcerowsecurity);
  assert.deepEqual(bad, [], `RLS 미설정: ${bad.map(b => b.relname).join(', ')}`);
});

test('모든 파티션에도 FORCE RLS가 걸려 있다', async () => {
  // ★ FORCE는 상속되지 않는다 (§8.2)
  const rows = await adminSql`
    SELECT c.relname FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
     WHERE NOT c.relforcerowsecurity
  `;
  assert.equal(rows.length, 0, `FORCE 누락 파티션: ${rows.map(r => r.relname)}`);
});

test('어떤 롤도 BYPASSRLS / SUPERUSER / REPLICATION 을 갖지 않는다', async () => {
  const rows = await adminSql`
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('app_user','admin_reader','analytics_reader',
                       'retention_janitor','migrator','kms_broker')
       AND (rolbypassrls OR rolsuper OR rolreplication)
  `;
  assert.equal(rows.length, 0, `과잉 권한 롤: ${rows.map(r => r.rolname)}`);
});

// ★★★ 이 문서 전체에서 가장 중요한 테스트
test('문서 접근 경로가 org_members를 참조하지 않는다', async () => {
  const fns = await adminSql`
    SELECT proname, prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND proname IN ('can_read_document','can_edit_document','resolve_share_token')
  `;
  assert.equal(fns.length, 3, 'can_read_document 등이 존재해야 한다');
  for (const f of fns) {
    for (const forbidden of ['org_members', 'org_role', 'analyst_seat', 'is_desk']) {
      assert.ok(!f.prosrc.includes(forbidden),
        `${f.proname}이 ${forbidden}을 참조합니다 — POLICY §1.0 위반`);
    }
  }

  // 정책 표현식도 검사한다
  const pols = await adminSql`
    SELECT tablename, policyname, qual, with_check FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('documents','items','edges','private_notes',
                         'share_links','view_logs','checklist_runs','operations','snapshots')
  `;
  for (const p of pols) {
    const expr = `${p.qual ?? ''} ${p.with_check ?? ''}`;
    assert.ok(!expr.includes('org_members'),
      `정책 ${p.tablename}.${p.policyname}이 org_members를 참조합니다`);
  }
});

test('SECURITY DEFINER 함수는 화이트리스트뿐이고 전부 search_path가 고정돼 있다', async () => {
  const WHITELIST = new Set([
    'app.resolve_share_token', 'app.grant_sealed_access', 'app.audit',
    'app.ensure_partitions', 'app.drop_expired_partitions', 'app.drop_operations_partition',
    'app.soft_delete_document', 'app.destroy_l4_for_user', 'agg.query_process',
  ]);
  const rows = await adminSql`
    SELECT n.nspname || '.' || p.proname AS fq, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef AND n.nspname IN ('app','agg','public','audit')
  `;
  for (const r of rows) {
    assert.ok(WHITELIST.has(r.fq), `승인되지 않은 SECURITY DEFINER 함수: ${r.fq}`);
    assert.ok((r.proconfig ?? []).some((c: string) => c.startsWith('search_path=')),
      `${r.fq}에 SET search_path가 없습니다`);
  }
});

test('admin_reader는 public·audit 스키마에 USAGE가 없다', async () => {
  const [r] = await adminSql`
    SELECT has_schema_privilege('admin_reader','public','USAGE') AS pub,
           has_schema_privilege('admin_reader','audit','USAGE')  AS aud,
           has_schema_privilege('admin_reader','agg','USAGE')    AS agg
  `;
  assert.equal(r.pub, false);
  assert.equal(r.aud, false);
  assert.equal(r.agg, true);
});

test('admin_reader가 SELECT할 수 있는 것은 승인된 agg 뷰뿐이다', async () => {
  const ALLOWED = new Set([
    'agg.agg_process','agg.agg_dept_pair','agg.agg_tool',
    'agg.agg_seam_discrepancy','agg.agg_suppression_summary',
  ]);
  const rows = await adminSql`
    SELECT table_schema || '.' || table_name AS fq
      FROM information_schema.table_privileges
     WHERE grantee = 'admin_reader' AND privilege_type = 'SELECT'
  `;
  for (const r of rows) assert.ok(ALLOWED.has(r.fq), `admin_reader가 ${r.fq}를 읽을 수 있습니다`);
  // agg_cells_mv(원재료)가 절대 열려 있으면 안 된다
  assert.ok(!rows.some(r => r.fq === 'agg.agg_cells_mv'));
});

test('audit 스키마에 UPDATE·DELETE 권한을 가진 롤이 없다', async () => {
  const rows = await adminSql`
    SELECT grantee, table_name, privilege_type
      FROM information_schema.table_privileges
     WHERE table_schema = 'audit' AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
  `;
  assert.deepEqual(rows, []);
});

test('모든 뷰가 security_invoker이거나 승인된 집계 뷰다', async () => {
  const AGG_OK = /^agg\./;
  const rows = await adminSql`
    SELECT n.nspname || '.' || c.relname AS fq, c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'v' AND n.nspname IN ('public','audit','agg')
  `;
  for (const r of rows) {
    const opts = (r.reloptions ?? []) as string[];
    if (AGG_OK.test(r.fq)) {
      assert.ok(opts.includes('security_barrier=true'), `${r.fq}에 security_barrier 없음`);
    } else {
      assert.ok(opts.includes('security_invoker=true'), `${r.fq}에 security_invoker 없음`);
    }
  }
});

test('pgcrypto가 설치되어 있지 않다 (L4는 DB에서 복호화 불가)', async () => {
  const rows = await adminSql`SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'`;
  assert.equal(rows.length, 0, 'pgcrypto가 설치되면 break-glass에서 L4가 열립니다 (SECURITY §5.4d)');
});

test('만들지 않기로 한 인덱스가 없다 (§2.6)', async () => {
  const FORBIDDEN: Array<[string, string]> = [
    ['items', 'assignee_id'],
    ['view_logs', 'viewer_id'],
  ];
  for (const [table, col] of FORBIDDEN) {
    const rows = await adminSql`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = ${table} AND indexdef LIKE ${'%(' + col + '%'}
    `;
    assert.equal(rows.length, 0,
      `${table}(${col}) 인덱스는 감시 쿼리를 빠르게 만듭니다 — SCHEMA.md §2.6`);
  }
});
```

### 11.2 RLS 행동 테스트 — 각 롤로 접근 시도

```ts
// test/schema/rls.test.ts
type Actor = 'owner' | 'editor' | 'viewer' | 'colleague'
           | 'org_admin' | 'system_admin' | 'other_org' | 'anon_share';

/** 각 액터의 세션으로 트랜잭션을 열고 쿼리한다 */
async function as(actor: Actor, fn: (tx: Tx) => Promise<any>) { /* … */ }

const CASES: Array<{ actor: Actor; query: string; expect: number | 'error' }> = [
  // ── documents ────────────────────────────────────────────
  { actor: 'owner',        query: 'SELECT * FROM documents WHERE id = $doc',        expect: 1 },
  { actor: 'editor',       query: 'SELECT * FROM documents WHERE id = $doc',        expect: 1 },
  { actor: 'viewer',       query: 'SELECT * FROM documents WHERE id = $doc',        expect: 1 },
  { actor: 'colleague',    query: 'SELECT * FROM documents WHERE id = $doc',        expect: 0 },
  // ★★ 원칙 1의 핵심 테스트
  { actor: 'org_admin',    query: 'SELECT * FROM documents WHERE id = $doc',        expect: 0 },
  { actor: 'system_admin', query: 'SELECT * FROM documents WHERE id = $doc',        expect: 0 },
  { actor: 'other_org',    query: 'SELECT * FROM documents WHERE id = $doc',        expect: 0 },
  // 존재 여부조차 드러나지 않는다
  { actor: 'org_admin',    query: 'SELECT count(*) FROM documents',                 expect: 0 },
  { actor: 'org_admin',    query: 'SELECT title FROM documents WHERE org_id = $org', expect: 0 },

  // ── items / edges ────────────────────────────────────────
  { actor: 'org_admin',    query: 'SELECT * FROM items WHERE doc_id = $doc',        expect: 0 },
  { actor: 'colleague',    query: 'SELECT * FROM items WHERE assignee_id = $owner', expect: 0 },

  // ── private_notes: 아무도 못 본다 ─────────────────────────
  { actor: 'owner',        query: 'SELECT * FROM private_notes WHERE item_id = $item', expect: 1 },
  { actor: 'editor',       query: 'SELECT * FROM private_notes WHERE item_id = $item', expect: 0 },
  { actor: 'viewer',       query: 'SELECT * FROM private_notes WHERE item_id = $item', expect: 0 },
  { actor: 'org_admin',    query: 'SELECT * FROM private_notes WHERE item_id = $item', expect: 0 },
  { actor: 'anon_share',   query: 'SELECT * FROM private_notes WHERE item_id = $item', expect: 0 },
  // 봉인 열람이 승인돼도
  { actor: 'org_admin',    query: 'SELECT * FROM private_notes WHERE item_id = $sealed_item', expect: 0 },

  // ── view_logs: 소유자만, 그리고 아무도 못 지운다 ──────────
  { actor: 'owner',        query: 'SELECT * FROM view_logs WHERE doc_id = $doc',    expect: 3 },
  { actor: 'viewer',       query: 'SELECT * FROM view_logs WHERE doc_id = $doc',    expect: 0 },
  { actor: 'org_admin',    query: 'SELECT * FROM view_logs WHERE doc_id = $doc',    expect: 0 },
  { actor: 'owner',        query: 'DELETE FROM view_logs WHERE doc_id = $doc',      expect: 0 },
  { actor: 'viewer',       query: 'DELETE FROM view_logs WHERE doc_id = $doc',      expect: 0 },

  // ── share_links: 재공유 불가 ──────────────────────────────
  { actor: 'viewer',  query: `INSERT INTO share_links(...) VALUES(...)`, expect: 'error' },
  { actor: 'editor',  query: `INSERT INTO share_links(kind:'org', ...)`, expect: 1 },
  { actor: 'editor',  query: `INSERT INTO share_links(kind:'public',...)`, expect: 'error' },

  // ── checklist_runs: 소유자에게도 안 보인다 ────────────────
  { actor: 'owner',   query: 'SELECT * FROM checklist_runs WHERE doc_id = $doc AND runner_id = $viewer', expect: 0 },
  { actor: 'viewer',  query: 'SELECT * FROM checklist_runs WHERE runner_id = $viewer', expect: 1 },

  // ── 감사 로그 ─────────────────────────────────────────────
  { actor: 'org_admin', query: 'DELETE FROM audit.audit_logs', expect: 'error' },
  { actor: 'owner',     query: 'UPDATE audit.audit_logs SET action = $x', expect: 'error' },
];

for (const c of CASES) {
  test(`RLS: ${c.actor} × ${c.query.slice(0, 50)}`, async () => {
    if (c.expect === 'error') {
      await assert.rejects(() => as(c.actor, tx => tx.execute(c.query)));
    } else {
      const rows = await as(c.actor, tx => tx.execute(c.query));
      assert.equal(rows.length, c.expect);
    }
  });
}
```

**롤 단위 테스트**

```ts
test('admin_reader로 base 테이블을 읽으면 실패한다', async () => {
  for (const t of ['documents','items','users','view_logs','private_notes','process_rollup']) {
    await assert.rejects(
      () => asRole('admin_reader', `SELECT * FROM public.${t} LIMIT 1`),
      /permission denied/,
      `admin_reader가 ${t}를 읽을 수 있습니다`);
  }
});

test('analytics_reader는 어떤 내용 컬럼에도 닿을 수 없다', async () => {
  await assert.rejects(() => asRole('analytics_reader', 'SELECT title FROM documents'));
  await assert.rejects(() => asRole('analytics_reader', 'SELECT * FROM agg.agg_process'));
});

test('retention_janitor는 행을 지울 수 없다', async () => {
  await assert.rejects(
    () => asRole('retention_janitor', 'DELETE FROM audit.audit_logs WHERE true'),
    /permission denied/);
});

test('migrator도 RLS를 우회하지 못한다 (FORCE)', async () => {
  // 컨텍스트 없이 migrator로 조회 → 0행이어야 한다
  const rows = await asRole('migrator', 'SELECT * FROM documents');
  assert.equal(rows.length, 0, 'FORCE ROW LEVEL SECURITY가 안 걸려 있습니다');
});
```

**커넥션 풀 오염 테스트 (§3.6-7)**

```ts
test('트랜잭션이 끝나면 세션 컨텍스트가 사라진다', async () => {
  await withUser({ userId: USER_A, orgId: ORG_A }, async () => { /* noop */ });
  // 같은 커넥션이 재사용될 때까지 반복해서 확인한다
  for (let i = 0; i < 50; i++) {
    const [r] = await rawSql`SELECT current_setting('app.current_user_id', true) AS v`;
    assert.ok(r.v === null || r.v === '', `커넥션에 컨텍스트가 남아 있습니다: ${r.v}`);
  }
});

test('컨텍스트 없이 조회하면 0행이다 (fail-closed)', async () => {
  const rows = await rawSql`SELECT * FROM documents`;
  assert.equal(rows.length, 0);
});
```

### 11.3 k-익명성 퍼즈 테스트 — 10만 조합에서 5인 미만 셀 0건

MEASUREMENT §3 방어 4가 요구한 것. **CI에서 실패하면 배포 차단이고, W0에서 실패하면 파일럿 자체가 중단된다.**

```ts
// test/schema/k-anon.fuzz.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminSql, asRole, seedSyntheticOrg } from './helpers';

const AXES = ['process', 'dept_pair', 'tool', 'seam_kind'] as const;
const VIEW: Record<string, string> = {
  process:   'agg.agg_process',
  dept_pair: 'agg.agg_dept_pair',
  tool:      'agg.agg_tool',
  seam_kind: 'agg.agg_seam_discrepancy',
};
const ITERATIONS = Number(process.env.K_ANON_ITERATIONS ?? 100_000);

/** 결정적 PRNG — 실패를 재현할 수 있어야 한다 */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('k-익명성 퍼즈: 10만 조합에서 contributor_n < 5 셀이 0건', { timeout: 30 * 60_000 },
async (t) => {
  const seed = Number(process.env.K_ANON_SEED ?? Date.now() % 1e9);
  t.diagnostic(`seed=${seed}`);
  const rnd = mulberry32(seed);

  // ── 1. 적대적 합성 조직을 만든다 ─────────────────────────
  //    ★ 무작위 데이터로는 5인 미만 셀이 잘 안 생긴다.
  //      경계를 노리고 만든다: 기여자 1·2·3·4·5·6명 셀을 의도적으로 배치
  const org = await seedSyntheticOrg({
    departments: [
      { name: '2인팀',  headcount: 2 },   // k 미달
      { name: '4인팀',  headcount: 4 },   // ★ 경계 바로 아래
      { name: '5인팀',  headcount: 5 },   // ★ 경계
      { name: '6인팀',  headcount: 6 },
      { name: '40인팀', headcount: 40 },
    ],
    processes: 30,
    // 한 부서 안에서 억제 셀이 정확히 1개가 되는 배치를 반드시 포함한다 (2차 억제 검증)
    forceSingleSuppressedCellIn: '40인팀',
    seed,
  });
  await adminSql`REFRESH MATERIALIZED VIEW agg.agg_cells_mv`;

  // ── 2. 가능한 필터 값을 실제 데이터에서 뽑는다 ───────────
  const periods = (await adminSql`SELECT key FROM period_presets`).map(r => r.key);
  const depts   = (await adminSql`SELECT id FROM departments WHERE org_id = ${org.id}`).map(r => r.id);
  const procs   = (await adminSql`
    SELECT DISTINCT process_key FROM process_rollup WHERE org_id = ${org.id}`).map(r => r.process_key);
  const tools   = (await adminSql`SELECT id FROM tools`).map(r => r.id);
  const kinds   = (await adminSql`SELECT DISTINCT kind FROM discrepancies`).map(r => r.kind);

  const pick = <T,>(xs: T[]): T | null => {
    if (xs.length === 0) return null;
    const i = Math.floor(rnd() * (xs.length + 1));   // +1 → 필터 없음도 뽑힌다
    return i === xs.length ? null : xs[i];
  };

  // ── 3. 진실값: 억제 없는 원재료에서 각 셀의 실제 기여자 수 ──
  const truth = new Map<string, number>();
  for (const r of await adminSql`
    SELECT axis, dim_a, coalesce(dim_b,'') AS dim_b, period_key, contributor_n, unit_n
      FROM agg.agg_cells_mv WHERE org_id = ${org.id}`) {
    truth.set(`${r.axis}|${r.dim_a}|${r.dim_b}|${r.period_key}`, r.contributor_n);
  }

  const violations: any[] = [];
  const seenCells = new Set<string>();

  // ── 4. 10만 조합 ─────────────────────────────────────────
  for (let i = 0; i < ITERATIONS; i++) {
    const axis   = AXES[Math.floor(rnd() * AXES.length)];
    const period = periods[Math.floor(rnd() * periods.length)];

    // ★ 필터는 최대 2개다. 3개를 넣을 슬롯이 뷰에 없다(§4.4)
    const fa = axis === 'process' ? pick(procs)
             : axis === 'tool'    ? pick(tools)
             : axis === 'seam_kind' ? pick(kinds) : null;
    const fb = (axis === 'process' || axis === 'tool') ? pick(depts) : null;

    const rows = await asRole('admin_reader', `
      SELECT * FROM ${VIEW[axis]}
       WHERE org_id = $1 AND period_key = $2
         AND ($3::text IS NULL OR ${axis === 'process' ? 'process_key'
                                 : axis === 'tool' ? 'tool_id::text'
                                 : 'discrepancy_kind'} = $3)
         AND ($4::uuid IS NULL OR ${axis === 'seam_kind' ? 'NULL::uuid' : 'dept_id'} = $4)
    `, [org.id, period, fa, fb]);

    for (const row of rows) {
      // ★ 불변식 1 — 반환된 기여자 수는 항상 5 이상
      if (row.contributor_n_rounded < 5) {
        violations.push({ kind: 'k_violation', i, axis, period, fa, fb, row });
      }
      // ★ 불변식 2 — 5단위 라운딩
      if (row.contributor_n_rounded % 5 !== 0) {
        violations.push({ kind: 'rounding', i, axis, row });
      }
      // ★ 불변식 3 — 진실값이 5 미만인 셀이 절대 반환되지 않는다
      //   (라운딩이 4를 5로 올려서 통과하는 것을 잡는다 — 가장 흔한 버그)
      const key = `${axis}|${row.dim_a ?? row.process_key ?? row.tool_id ?? row.discrepancy_kind}` +
                  `|${row.dept_id ?? row.dept_pair ?? ''}|${period}`;
      const real = truth.get(key);
      if (real !== undefined && real < 5) {
        violations.push({ kind: 'real_k_violation', i, key, real, row });
      }
      // ★ 불변식 4 — 개인 식별 컬럼이 없다
      for (const forbidden of ['owner_id','user_id','doc_id','assignee_id','actor_pid','email']) {
        if (forbidden in row) violations.push({ kind: 'pii_column', i, forbidden, row });
      }
      seenCells.add(key);
    }
    if (violations.length > 0) break;    // 첫 위반에서 즉시 멈춘다
  }

  // ── 5. 2차 억제 검증 — 파티션당 억제 셀이 정확히 1개인 경우가 없어야 한다 ──
  const singleSuppressed = await adminSql`
    WITH pub AS (SELECT axis, org_id, dim_a, coalesce(dim_b,'') dim_b, period_key
                   FROM agg.agg_public WHERE org_id = ${org.id}),
         raw AS (SELECT axis, org_id, dim_a, coalesce(dim_b,'') dim_b, period_key
                   FROM agg.agg_cells_mv WHERE org_id = ${org.id})
    SELECT r.axis, r.dim_b, r.period_key, count(*) AS suppressed
      FROM raw r
      LEFT JOIN pub p USING (axis, org_id, dim_a, dim_b, period_key)
     WHERE p.dim_a IS NULL
     GROUP BY 1,2,3
    HAVING count(*) = 1`;
  assert.equal(singleSuppressed.length, 0,
    `2차 억제 실패: 억제 셀이 1개뿐인 파티션 ${JSON.stringify(singleSuppressed)}`);

  // ── 6. 시계열 일관 억제 검증 (규칙 3) ────────────────────
  const inconsistent = await adminSql`
    SELECT axis, dim_a, coalesce(dim_b,'') dim_b,
           count(DISTINCT period_key) AS visible_periods
      FROM agg.agg_public WHERE org_id = ${org.id}
     GROUP BY 1,2,3
    HAVING count(DISTINCT period_key) <> (SELECT count(*) FROM period_presets)`;
  assert.equal(inconsistent.length, 0,
    `시계열 일관 억제 실패 — 일부 기간에만 보이는 셀: ${JSON.stringify(inconsistent)}`);

  // ── 7. 차분 공격 시뮬레이션 ──────────────────────────────
  //    last365 − last90 − last30 조합으로 4명 이하 집단이 복원되는지
  const diffAttack = await adminSql`
    WITH a AS (SELECT dim_a, dim_b, contributor_n_rounded n365 FROM agg.agg_public
                WHERE period_key='last365' AND axis='process' AND org_id=${org.id}),
         b AS (SELECT dim_a, dim_b, contributor_n_rounded n90  FROM agg.agg_public
                WHERE period_key='last90'  AND axis='process' AND org_id=${org.id})
    SELECT a.dim_a, a.dim_b, a.n365 - b.n90 AS delta
      FROM a JOIN b USING (dim_a, dim_b)
     WHERE a.n365 - b.n90 BETWEEN 1 AND 4`;
  assert.equal(diffAttack.length, 0,
    `차분으로 1~4명 집단이 드러납니다: ${JSON.stringify(diffAttack)}`);

  t.diagnostic(`검사한 고유 셀 ${seenCells.size}개 / ${ITERATIONS} 조합`);
  assert.deepEqual(violations.slice(0, 5), [],
    `k-익명성 위반 ${violations.length}건 (seed=${seed})`);
});
```

**이 테스트가 잡는 실제 버그 5가지**

| 버그 | 어떤 불변식이 잡나 |
|---|---|
| `HAVING`을 빠뜨린 새 축 | 불변식 1·3 |
| 라운딩이 4를 5로 올려서 4명 셀이 통과 | **불변식 3** (진실값 비교) |
| 필터 적용 후 `HAVING`을 재평가 안 함 | 불변식 3 (필터가 셀을 쪼갰는데 억제 안 됨) |
| 2차 억제 조건의 `rn` 계산 오류 | 5단계 |
| 중첩 프리셋 차분 | 6·7단계 |

**세 번째 항목이 이 테스트의 존재 이유다.** `round(4/5.0)*5 = 5`이므로 **라운딩만 보는 테스트는 4명 셀을 통과시킨다.** 원재료의 진실값과 대조해야만 잡힌다.

**실행 정책**
```yaml
# .github/workflows/ci.yml
- name: k-anonymity fuzz (PR)
  run: K_ANON_ITERATIONS=10000 npm run test:k-anon
- name: k-anonymity fuzz (nightly / release)
  if: github.event_name == 'schedule' || github.ref == 'refs/heads/main'
  run: K_ANON_ITERATIONS=100000 npm run test:k-anon
```
PR에서는 1만 건(수 분), 야간·릴리스에서는 10만 건. **실패 시 시드가 로그에 남으므로 정확히 재현된다.**

프로덕션에서는 같은 불변식을 **매일 검사**한다(MEASUREMENT §9의 P0 경보):
```sql
-- 매일 06:00. 1건이라도 나오면 관리자 대시보드 자동 차단
SELECT count(*) FROM agg.agg_public WHERE contributor_n_rounded < 5;
```

### 11.4 크로스 테넌트 격리 테스트

```ts
test('조직 A 세션으로 조직 B의 모든 리소스에 접근하면 전부 0행', async () => {
  const { orgA, orgB } = await seedTwoOrgs();

  // ★ 테이블 목록을 손으로 유지하지 않는다 — 카탈로그에서 읽는다
  const tables = await adminSql`
    SELECT c.relname,
           EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_name = c.relname AND col.column_name = 'id') AS has_id
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`;

  for (const t of tables) {
    if (!t.has_id) continue;
    const ids = await adminSql(`SELECT id FROM ${t.relname} LIMIT 200`);  // B 조직 것 포함
    for (const { id } of ids) {
      const rows = await withUser({ userId: orgA.user, orgId: orgA.id },
        tx => tx.execute(`SELECT 1 FROM ${t.relname} WHERE id = $1`, [id]));
      const belongsToB = await adminSql(
        `SELECT 1 FROM ${t.relname} WHERE id = $1 AND org_id = $2`, [id, orgB.id]);
      if (belongsToB.length > 0) {
        assert.equal(rows.length, 0, `${t.relname}#${id}가 조직 A에 노출됩니다`);
      }
    }
  }
});

test('복합 FK가 조직을 넘는 INSERT를 거부한다', async () => {
  const { orgA, orgB } = await seedTwoOrgs();
  await assert.rejects(
    () => adminSql`
      INSERT INTO items (id, doc_id, org_id, sort_key, kind)
      VALUES (gen_random_uuid(), ${orgB.docId}, ${orgA.id}, 'a0', 'task')`,
    /violates foreign key constraint/);
});

test('제약 위반 에러가 존재 오라클이 되지 않는다 (§3.6-12)', async () => {
  // 남의 item id로 INSERT를 시도했을 때, 애플리케이션이 반환하는 에러가
  // "이미 존재함"과 "권한 없음"을 구분하지 않아야 한다
  const e1 = await tryInsertItem({ id: OTHER_ORG_ITEM_ID });
  const e2 = await tryInsertItem({ id: NONEXISTENT_ID, docId: OTHER_ORG_DOC });
  assert.equal(e1.code, e2.code, '에러 코드가 다르면 행 존재가 드러납니다');
  assert.equal(e1.message, e2.message);
});
```

### 11.5 마이그레이션 테스트

```ts
test('빈 DB에 전 마이그레이션을 적용하면 성공한다', async () => {
  const db = await createEmptyDatabase();
  await runMigrations(db);
  // 그리고 구조 불변식(§11.1)을 그대로 다시 돌린다
  await runInvariantSuite(db);
});

test('스키마 파일과 마이그레이션이 일치한다 (드리프트 없음)', async () => {
  const fresh = await createEmptyDatabase();
  await runMigrations(fresh);
  const diff = await drizzleKitDiff(fresh, schema);
  assert.equal(diff.statements.length, 0,
    `스키마 드리프트: ${JSON.stringify(diff.statements)}`);
});

test('생성된 마이그레이션에 위험한 DDL이 없다', async () => {
  const files = await readMigrationFiles();
  const DANGEROUS = [/DROP\s+COLUMN/i, /RENAME\s+COLUMN/i, /ALTER\s+COLUMN\s+\w+\s+TYPE/i];
  for (const f of files) {
    if (f.name.includes('_irreversible')) continue;      // 승인된 파일
    for (const re of DANGEROUS) {
      assert.ok(!re.test(f.sql),
        `${f.name}에 위험한 DDL: ${re}. §7.4의 다단계 배포를 쓰세요`);
    }
  }
});

test('sort_key 컬럼이 전부 sort_key_t 도메인이다', async () => {
  const rows = await adminSql`
    SELECT table_name, column_name, domain_name
      FROM information_schema.columns
     WHERE column_name LIKE '%sort_key%'
       AND domain_name IS DISTINCT FROM 'sort_key_t'`;
  assert.deepEqual(rows, [], 'COLLATE "C"가 빠진 정렬 키가 있습니다');
});

test('sort_key 정렬이 바이트 순서다', async () => {
  await adminSql`INSERT INTO items (id, doc_id, org_id, sort_key, kind) VALUES
    (gen_random_uuid(), ${DOC}, ${ORG}, 'A',  'task'),
    (gen_random_uuid(), ${DOC}, ${ORG}, 'Z',  'task'),
    (gen_random_uuid(), ${DOC}, ${ORG}, 'a',  'task')`;
  const rows = await adminSql`
    SELECT sort_key FROM items WHERE doc_id = ${DOC} ORDER BY sort_key`;
  // COLLATE "C" 이면 'A' < 'Z' < 'a' (ASCII). en_US.UTF-8 이면 'a' < 'A' < 'Z'
  assert.deepEqual(rows.map(r => r.sort_key), ['A', 'Z', 'a']);
});
```

**마지막 테스트가 이 문서 전체에서 가장 값싸고 가장 값진 테스트다.** collation이 잘못되면 에러가 없고, 사용자에게는 "가끔 단계 순서가 이상해요"로 나타나며, 재현이 안 된다.

### 11.6 CI 게이트 요약

```
PR              구조 불변식 + RLS 행동 + 크로스테넌트 + 마이그레이션 + k-anon 1만
main 머지        위 전부 + k-anon 10만
야간             k-anon 10만 (새 시드) + 체인 무결성 + 드리프트 검사
배포 전          EXPLAIN 회귀(정책 서브플랜에 Seq Scan 없음)
프로덕션 매일     agg_public에 contributor_n < 5 셀 0건 / chain_breaks 0건 /
                 private_note_decrypt 중 소유자 아닌 호출 0건 / p1_deletion_queue SLA 초과 0건
```
넷 중 하나라도 실패하면 **P0**이고, 첫 번째가 실패하면 **관리자 대시보드를 자동 차단**한다(MEASUREMENT §9).

---

## 12. 스키마에 일부러 만들지 않는 것

> 이 절의 목적은 **없다는 사실을 문서화하는 것**이다.
> "만들 수 있는데 안 만들었다"는 증명이 이 제품의 신뢰 기반이고(TRUST §3), 스키마에서 그 증명은 **빈 자리의 목록**이다.
> 아래 항목을 추가하자는 요구가 오면, 그건 기능 추가가 아니라 **정책 변경**이다(POLICY §11).

### 12.1 존재하지 않는 테이블

| 만들지 않은 테이블 | 그게 있으면 가능해지는 것 | 근거 |
|---|---|---|
| **`user_stats` / `member_activity`** (개인별 집계) | "김OO: 12개 문서 · 340시간" | TRUST 원칙 2. D-081: "개인별 집계가 없다는 사실 자체가 방어 — 대량 감시의 단가를 1:1로 유지한다" |
| **`admin_document_access`** (관리자 열람권) | 관리자가 문서를 여는 경로 | TRUST 원칙 1. D-002 "영원히" |
| **`org_vector_index` / `document_embeddings`(조직 범위)** | 조직 전체 문서 시맨틱 검색 | **D-074.** "검색창이 관리자 열람권의 우회로가 된다. 이 설계에서 가장 되돌리기 비싼 결정." 벡터 인덱스가 필요해지면 **소유자 단위로만** |
| **`department_shares`** (부서 자동 공유) | 부서장이 부서원 문서를 봄 | D-077. 대체물은 `team_shelf`(소유자가 스스로 올림) |
| **`non_writers` / `coverage_gaps`** (미작성자) | 독촉·평가 | POLICY §1.1 B. 그리고 §4.6대로 **계산할 재료가 없다** |
| **`impersonation_sessions`** | 지원팀이 사용자로 로그인 | D-071 / SECURITY §5.4. 대체물은 소유자가 발급하는 15분 `share_links` 행 |
| **`pain_flag_authors`** (짜증 플래그 작성자) | "이 단계를 짜증난다고 표시한 사람" | TRUST 공포 3. `items.pain_flag`는 boolean이고, **누가 눌렀는지는 어디에도 기록되지 않는다** |
| **`document_index`(조직 전체 문서 목록)** | 타인 문서 존재 여부 확인 | POLICY §1.1 A |
| **`view_stats`(조직 열람 통계)** | "가장 많이 읽힌 문서", "가장 많이 읽는 사람" | SECURITY §8.4 |
| **`hr_integration` / `performance_links`** | 인사평가 연동 | TRUST 원칙 4. POLICY §11.3 |
| **`credentials` / `password_hash`** | — | SECURITY §4.2: 인증을 WorkOS에 위임하므로 **자격증명 해시가 우리 DB에 없다.** 실사 답변으로 "저장하지 않음"이 가장 강하다 |
| **`p1_events`**(행동 이벤트) | P1→P2 파이프라인 | MEASUREMENT §1 단방향 규칙. P1은 PostHog에 있고 **Postgres가 읽는 경로가 없다** |
| **`pii_scan_results`** | 서버가 본문을 스캔한 결과 | D-070 / SECURITY §3.2. 탐지는 브라우저 안에서만, 결과는 **어디에도 저장하지 않는다** |
| **`temporal_*`**(행 단위 이력 테이블) | 모든 변경의 완전 이력 | ARCHITECTURE §2: 과잉. `operations` + `snapshots` 2단으로 충분 |
| **`derived_edges`** | 파생 엣지 저장 | D-030. split brain을 영원히 관리하게 된다 |

### 12.2 존재하지 않는 컬럼

| 만들지 않은 컬럼 | 그게 있으면 | 근거 |
|---|---|---|
| `documents.admin_readable` / `.visibility_org` | 관리자 열람 플래그 | 원칙 1 |
| `org_members.can_read_documents` | 같음 | POLICY §1.0 두 축 분리 |
| `users.hire_date` | 부서 × 입사일로 개인 특정 | MEASUREMENT §2. `tenure_band`만 둔다 |
| `departments.headcount`(원값) | "4명짜리 팀"이라는 재식별 정보 | §1.2. `headcount_bucket` + `k_eligible`만 |
| `items.duration_minutes`(절대값) | 개인별 시간 총합 | TRUST 공포 2. `duration_band` **enum**이라 절대값을 넣을 자리가 없다 |
| `items.assignee_name`(자유 텍스트) | 엔티티 해소 붕괴 | D-009 |
| `view_logs.viewer_ip`(원본) | 위치 추적 | SECURITY §8.4. 해시 30일 + 국가/ASN만 |
| `share_links.token`(평문) | 토큰 유출 | SECURITY §8.1. SHA-256 해시만 |
| `org_deks.dek`(평문) | 키 유출 | §6. wrapped만 |
| `org_salts.salt`(값) | 재식별 | §1.8. **회전 이력만 저장하고 값은 Secrets Manager에** |
| `audit_logs.request_body` / `.item_title` | 감사 로그로 본문 유출 | §1.10의 CHECK가 INSERT를 실패시킨다 |
| `discrepancies.facts.owner_id` | 불일치 리포트로 개인 노출 | §1.4의 CHECK |
| `agg_*.doc_id` / `.owner_id` | 드릴다운 | §4.6 |
| `checklist_runs`의 소유자 가시성 | 소유자가 남의 실행 기록을 봄 | POLICY §6.4 |

### 12.3 존재하지 않는 인덱스

§2.6의 표. 요약하면 **"조직 전체에서 한 사람을 훑는 쿼리"를 빠르게 만드는 인덱스를 하나도 만들지 않는다.**

RLS가 이미 막지만, 인덱스를 안 만드는 것은 **두 번째 방어선이자 리뷰 장치**다. 누군가 그 인덱스를 추가하는 PR을 열면 §11.1의 테스트가 실패하고, 실패 메시지가 "이건 성능 개선이 아니라 정책 변경입니다"라고 말한다.

### 12.4 존재하지 않는 권한·경로

```
✗ 어떤 롤에도 BYPASSRLS / SUPERUSER / REPLICATION 없음
✗ admin_reader에게 public·audit 스키마 USAGE 없음
✗ 누구에게도 audit 스키마 UPDATE / DELETE / TRUNCATE 없음
✗ app_user에게 documents / share_links / view_logs / operations DELETE 없음
✗ app_user에게 org_deks SELECT 없음 (키 브로커 전용)
✗ 사람에게 부여된 DB 계정 없음 (SECURITY §5.1)
✗ pgcrypto 확장 없음 → DB 안에 L4 복호화 수단이 없음
✗ 논리 복제 슬롯 없음 → CDC로 RLS를 우회하는 경로 없음
✗ agg_cells_mv(억제 전 원재료)에 대한 SELECT 권한을 가진 롤 없음
✗ 집계 API 없음 (v1) — 화면과 export가 같은 뷰를 쓴다
```

### 12.5 이 목록을 유지하는 방법

1. **§11.1의 구조 테스트가 이 목록의 절반을 자동 검증한다** — 금지 인덱스, DEFINER 화이트리스트, GRANT 목록, 확장 목록
2. **나머지 절반(없는 테이블·컬럼)은 리뷰 체크리스트로.** PR 템플릿에 한 줄:
   > 이 PR이 SCHEMA.md §12의 항목을 추가합니까? 그렇다면 POLICY §11의 등급 판정을 먼저 하세요.
3. **요구가 왔을 때 기각한 기록을 남긴다** — TRUST §8의 "헌장을 어길 뻔한 순간 기록"에. 기각 기록이 다음 기각의 근거가 된다

---

## 부록 A. 문서 간 충돌과 그 해소

이 스키마를 쓰면서 발견한, 기존 문서들 사이의 불일치와 해소 결정.

| # | 충돌 | 해소 | 위치 |
|---|---|---|---|
| 1 | 기여자 정의: TRUST `assignee_id` vs MEASUREMENT/ASSEMBLY `owner_id` | **`owner_id`** — 담당자는 동의하지 않은 사람일 수 있어 k를 가짜로 채운다 | §1.9 |
| 2 | 감사 로그 보존: POLICY 3년 vs SECURITY 카테고리별 1~3년 vs 요구사항 "원본 1년" | **카테고리별 1년/3년**. 열람 로그 원본 1년, 관리 행위 3년 | §5.1 |
| 3 | 링크 만료: POLICY 7/30/90/무기한(A) vs SECURITY 용도별 30/14/7 + 상한 | POLICY = 사용자 선택지, SECURITY = 상한. **DB에는 상한만 CHECK로** | §1.5 |
| 4 | 이벤트 보존: POLICY 13개월 vs MEASUREMENT 원시 180일 + 롤업 25개월 | **MEASUREMENT** (더 구체적이고 더 짧다) | §8.3 |
| 5 | 테이블 이름: 요구사항 `seam_links` vs ASSEMBLY `handoff_links` | **`handoff_links`** | §1.4 |
| 6 | `handoff_sockets.item_id`: 선언은 NOT NULL CASCADE, DDL이 되돌림 | **처음부터 nullable + SET NULL로 선언** | §1.4 |
| 7 | `business_objects` 유니크: `(org_id, name_norm)`인데 org_id가 nullable | **`coalesce` 표현식 유니크** | §1.4 |
| 8 | 중첩 프리셋 차분: MEASUREMENT는 "임의 기간 제거"만 다룸 | **시계열 일관 억제(규칙 3) 추가** — 프리셋만으로도 차분이 성립한다 | §4.2 |
| 9 | GCM nonce: SECURITY는 `doc_id\|\|item_id\|\|rev`인데 `rev` 관리 주체가 없음 | **`private_notes.rev` + 증가 강제 트리거** | §6.1 |
| 10 | `admin_reader` REVOKE 대상이 테이블 3개로 열거됨 | **스키마 단위 REVOKE**로 강화 — 41번째 테이블에서도 유효 | §3.1 |
| 11 | 스냅샷 주기 `N`이 어디에도 정의되지 않음 | **`50 op 또는 24시간`** — 보존 정책 파라미터로 다룬다 | §1.6 |
| 12 | `app_user`/`migrator`/`analytics_reader`가 기존 문서에 없음 | 여기서 정의. `admin_reader`만 MEASUREMENT §3 확정 | §3.1 |

## 부록 B. 이 스키마가 증명하는 것

TRUST.md의 약속을 SQL 한 줄로 되짚는다. 실사·직원 공지·경영진 설명에 그대로 쓸 수 있는 대응표다.

| 직원에게 한 약속 | DB에서의 증명 |
|---|---|
| "공유 링크를 만들기 전에는 팀장님도, 인사팀도, 대표님도 볼 수 없습니다" | `app.can_read_document()`에 `org_members`가 없다. §11.1이 매 배포마다 검증 |
| "관리자 화면에는 사람이 나오지 않습니다" | `admin_reader`가 `public` 스키마에 `USAGE` 권한이 없다 |
| "5명 미만이 관여한 업무는 집계에서 아예 빠집니다" | `agg.agg_public` 한 곳에 억제가 있고, 축을 늘려도 다시 쓸 수 없다 |
| "여기 적힌 내용은 인사평가에 쓰이지 않습니다" | 개인별 집계 테이블이 없고, 개인별 시간 총합을 계산할 절대값 컬럼이 없다 |
| "내 문서를 누가 열어봤는지 나는 볼 수 있습니다" | `my_document_views` 뷰(90일). 그리고 `view_logs`에 대한 `DELETE` 권한이 **DB 전체에 존재하지 않는다** |
| "비공개 노트는 소유자만 봅니다" | `private_notes` 정책의 조건이 `owner_id = 나` 하나뿐. pgcrypto 미설치로 DB 안에 복호화 수단이 없다 |


# 측정 계획 · 파일럿 실행안

> 최종 갱신: 2026-08-17 · 상태: v0.1

## 지배 원칙

> **이벤트 스트림에는 "행동"만 담고 "값"은 담지 않는다.**

소요시간·빈도·짜증 플래그·담당자·도구명 같은 **내용**은 제품 DB(`items`)에만 존재하고 분석 이벤트로 **복제하지 않는다.** 관리자 집계는 제품 DB의 k-익명 뷰에서만 파생되며 **행동 이벤트에서는 절대 파생되지 않는다.**

이 한 줄이 "분석 시스템이 감시 경로가 되는" 사고를 구조적으로 차단한다. ([TRUST.md](./TRUST.md) 참조)

---

# 1. 데이터 평면

| 평면 | 내용 | 식별성 | 접근 주체 |
|---|---|---|---|
| **P0 제품 DB** (Postgres) | 문서·단계·메타값 원본 | 실명 | 소유자 + 소유자 발급 링크. RLS 강제 |
| **P1 행동 이벤트** (PostHog self-hosted) | 아래 택소노미. **값 없음** | 가명(`actor_pid`) | **제품팀만** |
| **P2 집계 마트** (Postgres 뷰) | 프로세스 단위 집계 | 무기명 | 고객사 관리자 |

**단방향 규칙 (코드로 강제)** — `P0 → P2`만 존재. **`P1 → P2` 파이프라인을 만들지 않는다.**
행동 데이터가 관리자 화면으로 흐를 수 있는 경로 자체가 없다. 반대로 값(시간·빈도·짜증)은 `P0 → P2`만 타고 P1으로 복제되지 않는다.

> **행동을 아는 쪽은 개인의 고통을 모르고, 고통을 집계하는 쪽은 개인을 모른다.**

**가명화** — `org_salt`는 조직별 KMS에 보관, **12개월마다 회전.** 회전 시 이전 `actor_pid`와 신규 pid는 연결 불가 → **구조적으로 1년 이상 개인 추적이 불가능하다.** 정책이 아니라 키 수명의 결과다.

---

# 2. 이벤트 택소노미

## 공통 컨텍스트

| 속성 | 타입 | 설명 |
|---|---|---|
| `actor_pid` | string | `HMAC-SHA256(user_id, org_salt)` 앞 16B base64url. **실명 매핑은 P0에만** |
| `org_pid` | string | 조직 가명 ID |
| `dept_bucket` | string | 부서 ID. **5인 미만 부서는 수집 시점에 `small_dept`로 강제 치환** |
| `tenure_band` | enum | `<6m` / `6-24m` / `2-5y` / `5y+` (연차 원값 금지) |
| `doc_pid` | string? | `HMAC(doc_id, org_salt)` |
| `session_id` / `seq` | string / int | 30분 비활동 롤오버 / 유실 감지 |
| `entry_context` | enum | `invite` / `direct` / `share_link` / `slack_freshness` / `checklist` / `handoff_invite` |
| `surface` | enum | `web` / `share_page` / `slack` |
| `app_version`, `client_ts`, `server_ts` | | |
| `flags` | object | `{실험키: 변형}` |

## 절대 넣으면 안 되는 속성 (수집기 하드 차단)

```
doc_title · item_title · step_text · 붙여넣기 원문/샘플
assignee_name · email · employee_no
tool_name_raw(자유입력) · department_name(원문)
duration_band 값 · freq_last_7d 값 · pain_flag 값
코멘트 본문 · 파일명 · 전체 URL/쿼리스트링
원본 IP · full user-agent · 수신자 이메일 배열
```

**강제 방법** — 이벤트 스키마를 `packages/graph-core/src/analytics/schema.ts`에 zod `.strict()`로 정의 → 수집 프록시에서 unknown key 발견 시 **이벤트 drop + 알림.** 문자열은 원칙적으로 `enum` 또는 `*_band`만 허용. **자유 텍스트 속성은 스키마에 존재하지 않는다.**

## 온보딩 퍼널

| 이벤트 | 속성 |
|---|---|
| `onboarding_started` | `source` |
| `onboarding_dept_selected` | `dept_bucket`, `method: directory_default\|manual`, `ms_since_start` |
| `onboarding_chip_selected` | `chip_id`, `chip_index`, `chips_shown`, `is_custom` |
| `question_chain_prompted` | `question_index`, `question_key` |
| `question_chain_answered` | `question_index`, `answer_len_band`, `ms_to_answer`, `input_method: type\|paste` |
| `question_chain_skipped` | 동일 |
| **`question_chain_exited`** | `last_question_index`, `exit_reason: nav_away\|close\|switch_to_outline\|idle_timeout` |
| `outline_transition_shown` | `steps_derived`, `source: paste\|question_chain`, `ms_since_start` |
| **`first_diagram_rendered`** | `node_count`, `edge_count`, `layout_ms`, **`ms_since_onboarding_start`** |
| **`doc_saved`** | `node_count`, `max_depth`, `branch_count`, `hold_count`, `is_first_save`, `save_trigger` |

`first_diagram_rendered.ms_since_onboarding_start`가 **TTFD(≤8분) 원천**이고, `question_chain_exited.last_question_index`가 **"몇 번째 질문에서 포기하는가"** — 질문 연쇄를 5~6개로 잡은 설계의 검증 지점.

## 붙여넣기 파싱

| 이벤트 | 속성 |
|---|---|
| `paste_attempted` | `char_len_band`, `line_count_band`, `source_hint: kakao\|email\|word\|unknown`, `has_numbering` |
| `paste_parsed` | `parsed_step_count`, `parse_ms`, `rule_hits:{newline,numbering,verb}`, `confidence_bucket` |
| `paste_parse_failed` | `reason: too_short\|no_delimiter\|single_block\|over_limit` |
| `paste_result_accepted` / `_discarded` | `step_count`, `ms_before_action` |
| **`paste_result_edited`** | `edit_distance_band: none\|<10%\|10-30%\|30-60%\|>60%`, `edited/added/deleted_step_count`, `measured_at:'first_save'` |

`edit_distance_band`가 **파서 품질의 유일한 정량 지표**다. "AI 없이 80% 커버"라는 주장의 참·거짓이 여기서 판정된다.
**`>60%` 비율이 30%를 넘으면 붙여넣기 경로는 순이익이 아니라 순비용이다.**

## 에디터

| 이벤트 | 속성 |
|---|---|
| `step_added` | `method: button\|enter\|slash\|paste\|branch_case`, `position`, `depth` |
| `step_deleted` | `had_children`, `depth`, `age_ms` |
| `step_kind_changed` | `from_kind`, `to_kind`, `trigger: inline_suggestion\|menu\|shortcut` |
| `branch_created` | `method: button\|shortcut\|nl_suggestion_accepted`, `case_count`, `mode` |
| **`branch_join_toggled`** | `to: continue\|end` ← D-006 기본값 검증 |
| `nl_branch_suggestion_shown` / `_accepted` / `_dismissed` | `trigger_phrase_key` |
| `hold_configured` | `wait_for`, `has_timeout` |
| **`undo_performed`** | `op_type`, `undo_stack_depth`, `ms_since_op` |
| `editor_error_shown` | `error_key` |
| **`ime_composition_lost`** | `browser_key`, `os_key` — **한글 조합 유실 자동 감지** |

`nl_branch_suggestion_dismissed / shown` 비율이 **"만약 감지"의 오탐률**이다. `undo_performed` 중앙값 급등은 조작 오작동의 가장 빠른 신호. `ime_composition_lost`는 **크롬 업데이트 회귀를 CI보다 먼저 잡는다.**

## 메타데이터 카드

| 이벤트 | 속성 |
|---|---|
| `meta_stack_entered` | `trigger`, `node_count`, `cards_total` |
| `meta_card_shown` | `field_key`, `card_index`, `target_item_index` |
| **`meta_card_answered`** | `field_key`, `card_index`, `ms_on_card`, `input_method: chip\|search\|confirm_badge\|default_accept` — **응답 값 없음** |
| **`meta_card_skipped`** | `field_key`, `card_index`, `skip_method: dont_know\|skip_button\|nav_away` |
| `meta_stack_exited` | `last_card_index`, `answered_count`, `skipped_count` |
| `pain_flag_toggled` | `context` — **`actor_pid` 미부착 스트림으로 전송** |

`field_key × card_index` 이탈 히트맵이 **"어느 질문이 사람을 쫓아내는가"**를 준다.
`skip_method='dont_know'`는 **질문 자체의 답변 가능성 문제**, `nav_away`는 **지루함 문제** — 처방이 다르다.
`pain_flag_toggled`는 짜증이 실명에 도달할 수 없어야 하므로 **행위자 없는 이벤트**로 설계한다.

## 캔버스

| 이벤트 | 속성 |
|---|---|
| `canvas_lens_changed` | `from_lens`, `to_lens`, `ms_on_previous_lens` |
| `canvas_zoom_changed` | `zoom_bucket`, `method`, `node_count` |
| **`canvas_node_drag_attempted`** | `node_count`, `zoom_bucket`, `lens`, `drag_distance_band`, `was_blocked: true` |
| **`canvas_layout_computed`** | `node_count`, `elk_ms`, **`jump_score`** = 직전 레이아웃 대비 노드 평균 이동거리 ÷ 캔버스 대각선 |
| `canvas_edge_reason_hovered` | `edge_kind: derived\|explicit` |
| `canvas_collapse_toggled` | `to`, `subtree_size` |

v1은 `nodesDraggable={false}`이므로 **드래그는 성공하지 않는다** → "시도"가 순수한 불만 신호가 된다(목표 <1회/세션).
`jump_score`는 레이아웃 점프 리스크를 **사후 추정이 아니라 상시 계측**으로 만든다.
`canvas_edge_reason_hovered` 급증은 **자동 그래프가 오해를 사고 있다**는 뜻.

## 공유 · 열람 · 리텐션

| 이벤트 | 속성 |
|---|---|
| **`share_link_created`** | `scope`, `expires_days`, `node_count`, `days_since_first_save` |
| `share_invite_sent` | `channel`, `recipient_count_band` (**수신자 식별자 금지**) |
| `handoff_invite_shown` / `_sent` | `relation: next\|prev` |
| **`doc_viewed`** | `viewer_relation: owner\|same_dept\|other_dept\|external`, `via`, `is_first_view_by_viewer` |
| `doc_view_depth` | `scroll_depth_bucket`, `dwell_ms_bucket`, `lens_used` |
| `export_performed` | `format: handover_doc\|vacation_guide\|pdf\|png\|summary_card` |
| `checklist_started` | `node_count`, `occurrence_index` |
| **`checklist_step_corrected`** | `correction_type: title\|order\|added\|deleted\|kind` |
| `checklist_completed` / `_abandoned` | `checked_ratio`, `correction_count` |
| `freshness_prompt_sent` / `_opened` | `channel`, `item_count`, `staleness_days_bucket` |
| **`freshness_answered`** | `answer: ok\|changed\|no_longer`, `item_index`, `ms_to_answer` |
| `doc_auto_archived` | `age_days`, `last_confirmed_days_ago` |
| **`doc_edited_after_save`** | `days_since_first_save`, `changed_item_count`, `change_kinds[]` |
| `doc_revisited_without_edit` | `days_since_last_edit`, `dwell_ms_bucket` |

NSM의 "타인 1회 이상 열람"은 `doc_viewed where viewer_relation != 'owner'`로만 정의된다.
`checklist_step_corrected`가 **"재사용이 곧 갱신" 가설의 직접 증거**다.
`doc_edited_after_save`와 `doc_revisited_without_edit`를 **분리해야 D14 재편집률과 단순 열람을 혼동하지 않는다.**

---

# 3. k-익명성의 쿼리 레이어 강제

애플리케이션 검사는 언젠가 우회된다. **DB 롤과 뷰로 못 박는다.**

```sql
-- 1) 관리자 롤은 base 테이블 SELECT 권한 자체가 없다
CREATE ROLE admin_reader NOLOGIN;
REVOKE ALL ON items, documents, item_tools FROM admin_reader;

-- 2) 집계는 오직 뷰로만. 기간은 사전 계산된 프리셋만 존재한다.
CREATE VIEW agg_process WITH (security_barrier) AS
WITH base AS (
  SELECT p.process_key, d.dept_id, r.period_key,
         count(DISTINCT d.owner_id) AS contributor_n,
         count(*)                    AS process_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY p.lead_time_h) AS lead_time_med
  FROM process_rollup p
  JOIN documents d      ON d.id = p.doc_id
  JOIN period_presets r ON r.key IN ('last30','last90','last365')
  GROUP BY 1,2,3
),
-- 3) 2차 억제: 억제된 셀이 부서 내 정확히 1개면 차집합으로 복원 가능하므로
--    두 번째로 작은 셀도 함께 억제한다
sup AS (
  SELECT *,
    count(*) FILTER (WHERE contributor_n < 5)
      OVER (PARTITION BY dept_id, period_key) AS suppressed_cnt,
    row_number()
      OVER (PARTITION BY dept_id, period_key ORDER BY contributor_n) AS rn
  FROM base
)
SELECT process_key, dept_id, period_key,
       -- 4) 라운딩: 5단위 반올림으로 잔차 추론 차단
       round(contributor_n / 5.0) * 5 AS contributor_n_rounded,
       round(process_n / 5.0) * 5     AS process_n_rounded,
       lead_time_med
FROM sup
WHERE contributor_n >= 5
  AND NOT (suppressed_cnt = 1 AND rn = 2);

GRANT SELECT ON agg_process TO admin_reader;
```

## 추가 방어 4가지

1. **임의 기간 파라미터를 API에서 제거.** `period_key`는 `last30 / last90 / last365 / YYYY-MM`만 존재한다.
   자유 date range가 있으면 **하루씩 밀어가며 소집단을 차분(differencing)으로 복원**할 수 있다.
   **이게 5인 차단을 무력화하는 가장 흔한 공격이고, 대부분의 구현이 여기서 뚫린다.**
2. **동시 필터 최대 2개.** 카운터로 세지 말고 **뷰의 차원 슬롯을 `dim_a`/`dim_b` 둘로 고정**한다 — 3번째 필터가 물리적으로 불가능해진다
3. **드릴다운 API 부재.** `agg_process`에서 `doc_id`/`owner_id`로 내려가는 엔드포인트를 만들지 않는다
4. **CI 속성 기반 퍼즈 테스트** — 임의 필터·기간 조합 10만 건. 단 §아래 검증 대상 주의
5. **시계열 일관 억제** (§아래)
6. **억제를 먼저, 라운딩을 나중에** (§아래)

### ⚠️ 초안의 구멍 2건 — 둘 다 "방어하는 척하는" 유형

#### (a) 중첩 프리셋 차분 공격 — 내가 경고한 공격에 내가 뚫렸다

위 1번은 **자유 date range만** 막았다. 그런데 프리셋끼리 빼면 임의 구간이 복원된다.

```
last365 − last90 = 275일 구간
last90  − last30 =  60일 구간
2026-08 − 2026-07 = 월 단위 임의 조합
```

한 기간에서 억제된 셀이 다른 기간에서 노출되면, **뺄셈 한 번으로 억제가 풀린다.**

**수정 — 시계열 일관 억제**: 어느 하나의 기간에서든 억제 대상이면 **전 기간에서 억제**한다.

```sql
-- 억제 판정을 기간별로 하지 않고, 셀 단위로 한 번만 한다
WITH ever_suppressed AS (
  SELECT process_key, dept_id
  FROM agg_cells_raw
  GROUP BY process_key, dept_id
  HAVING min(contributor_n) < 5          -- ★ 한 기간이라도 5 미만이면
)
SELECT c.* FROM agg_cells_raw c
LEFT JOIN ever_suppressed s USING (process_key, dept_id)
WHERE s.process_key IS NULL;
```

이러면 표시 가능한 셀이 줄지만, **줄어드는 것이 정답이다.**

#### (b) 라운딩이 억제를 되돌린다

`round(contributor_n / 5.0) * 5`를 실행해 보면:

| 실제 기여자 | 표시값 |
|---|---|
| 3명 | **5** |
| 4명 | **5** |
| 5명 | 5 |
| 6명 | 5 |

**3명·4명 셀이 "5"로 표시된다.** 그리고 퍼즈 테스트가 **라운딩된 값**을 검사하면 `5 >= 5`이므로 **통과**시킨다 — 규칙이 스스로를 눈감게 만드는 구조다.

**수정 2가지**
1. **순서 고정**: `WHERE contributor_n >= 5`로 **억제를 먼저**, 라운딩은 통과한 셀에만. 라운딩은 잔차 추론 방어이지 억제 수단이 아니다
2. **퍼즈 테스트는 억제 전 원재료(`agg_cells_raw.contributor_n`)와 대조한다.** 응답의 라운딩된 값이 아니라

```ts
// ✗ 틀린 검증 — 라운딩된 값을 보면 4명 셀을 통과시킨다
expect(cell.contributor_n_rounded).toBeGreaterThanOrEqual(5)

// ○ 옳은 검증 — 응답에 나온 셀이 원재료에서 실제로 5명 이상이었는지
const truth = await rawTruthFor(cell.process_key, cell.dept_id, cell.period_key)
expect(truth.contributor_n).toBeGreaterThanOrEqual(5)
```

> **이건 `n-400` 린트 게이트와 같은 실패 유형이다.** 규칙이 존재하고, 초록이고, 아무것도 안 막는다.
> **게이트를 만들 때는 "이 게이트가 실제로 뭔가를 잡는가"를 검증하는 테스트를 함께 넣는다.**

#### (c) k 판정의 "기여자"를 `owner_id`로 통일

TRUST.md는 `assignee_id`, MEASUREMENT/ASSEMBLY 초안은 `owner_id`를 썼다. → **`owner_id`로 통일한다.**

**근거**: 담당자는 **지목당했을 뿐 동의하지 않은 사람**일 수 있다. 그 사람을 k에 세면 **k를 가짜로 채우게 된다** — 5명이 관여하는 것처럼 보이지만 실제로 문서를 쓴 사람은 2명일 수 있다.

관리자 쿼리는 전량 감사 로그에 남기고, **감사 로그 요약을 인사팀에 월간 공개**한다(누가 무엇을 봤는지가 아니라, **관리자 뷰가 개인을 조회할 수 없었음을 증명**).

## 보존 기간

| 데이터 | 보존 |
|---|---|
| P1 원시 이벤트 | **180일** → 이후 일/주 롤업만 25개월 |
| P2 집계 | 25개월(전년 동월 비교) |
| 세션 리플레이 (§7 조건부) | **30일 자동 삭제** |
| 감사 로그 | 3년 |
| 인터뷰 녹취 | 파일럿 종료 후 **30일 내 삭제**, 익명 전사본만 보관 |
| `org_salt` | 12개월 회전, 구 salt 즉시 파기 |
| 문서 삭제 시 | `doc_pid` tombstone 큐 → **24시간 내 P1에서 물리 삭제** |

## 도구 선택 — PostHog 자체 호스팅

| 후보 | 판정 |
|---|---|
| **PostHog (self-hosted)** ★ | 이벤트가 조직 경계를 벗어나지 않음. 리플레이 마스킹을 코드 레벨로 제어. 피처 플래그·실험·퍼널 내장(자체 구축 대비 3~4개월 절감). ClickHouse 1노드로 충분 |
| Amplitude / Mixpanel | **탈락.** 사내 업무 행동 로그의 3자 전송은 국내 보안 실사에서 그대로 걸린다. **"감시 아님"을 증명해야 하는 제품이 외부 SaaS에 행동 로그를 보내는 구조 자체가 서사와 충돌** |
| 완전 자체 구축 | **부분 채택.** 수집기는 자체(스키마 strict 검증·금지 속성 drop이 필요하므로 프록시는 무조건 자체). 퍼널/코호트 UI 재구현은 낭비 |

**결론**: 자체 수집 프록시(zod strict + 화이트리스트 + pid 발급) → PostHog self-hosted(P1).
**관리자 대시보드는 PostHog를 아예 조회하지 않고 P0의 k-anon 뷰(P2)만 읽는다.**

---

# 4. 퍼널

## F1. 「첫 문서」 — 입력 절벽 측정

| 단계 | 이벤트 | 목표 | 여기서 떨어지면 |
|---|---|---|---|
| 1 초대 열람 | `session_started(invite)` | — | |
| 2 시작 | `onboarding_started` | 70% | **동기 문제.** 도구가 아니라 공지 문안·명의를 고쳐야 함 |
| 3 칩 선택 | `onboarding_chip_selected` | 90% | 칩 카탈로그에 자기 업무가 없음 → 시드 부족 |
| 4 첫 입력 | `question_chain_answered(0)` OR `paste_attempted` | 85% | **첫 질문의 문안 문제** |
| 5 아웃라인 전환 | `outline_transition_shown` | 90% | 질문 연쇄 중도 이탈 — `last_question_index` 분포로 벽 확인 |
| 6 첫 다이어그램 | `first_diagram_rendered` | 95% | 파생/레이아웃 오류. **즉시 P0 버그** |
| 7 저장(5단계+) | `doc_saved(node_count>=5)` | **70%** | 그림을 봤는데 저장 안 함 = **결과물이 기대에 못 미침. 가장 나쁜 이탈** |
| 8 공유 링크 | `share_link_created` | **30%** | **"남에게 보여줄 만하다"에 실패. M1 가설 자체의 반증** |

누적 기대: 100 → 70 → 63 → 54 → 48 → 46 → **32(완료)** → **10(공유)**
**TTFD는 2→6 구간의 경과시간**으로 측정하고 단계별 워터폴을 함께 본다.

## F2. 「전파」 — 유일한 성장 루프

| 단계 | 목표 | 해석 |
|---|---|---|
| `share_link_created` → `share_invite_sent` | 80% | 링크만 만들고 안 보냄 = 공유 대상 불명확 |
| → `doc_viewed(≠owner)` | 70% | 보냈는데 안 봄 = **OG 카드가 클릭을 못 만듦** |
| → 2인 이상 열람 | 40% | 1인에 그치면 열람자/작성자 3:1 달성 불가 |
| → 열람자가 30일 내 `onboarding_started` | **15%** | **공유 페이지의 전환 장치 실패.** 문서가 부러워 보이지 않음 |
| → 열람자 `doc_saved` | 60% | 낮으면 F1 문제로 회귀 |

## F3. 「생존」 — 죽은 문서 생성기 판별

| 단계 | 목표 | 해석 |
|---|---|---|
| `doc_saved` → D14 `doc_reopened` | 45% | 안 열면 문서가 **읽히는 자리에 없다** |
| → `doc_edited_after_save` (D14) | **25%** | **핵심 지표. 5% 미만이면 제품 정체성 재검토** |
| → `freshness_answered` | 40~60% | 25% 미만이면 프롬프트 채널·길이 문제 |
| → `checklist_started` | 20% | 안 열면 "재사용=갱신" 루프 미작동 |
| → `checklist_step_corrected ≥ 1` | 50% | 0에 가까우면 문서가 이미 죽었거나 애초에 정확했거나 — **인터뷰로만 판별 가능** |

---

# 5. 대시보드

## 제품팀 (P1 + P0, 가명 기준)

| # | 위젯 |
|---|---|
| 1 | **NSM: 부서 커버리지 추이** (주간, 5인 미만은 `small_dept` 합산) |
| 2 | **TTFD 분포** — 중앙값/p75/p90 + 온보딩 구간 워터폴 |
| 3 | **F1 퍼널 + 이탈 히트맵** (부서 × 단계) |
| 4 | **파서 품질** — 성공률, `edit_distance_band` 분포, 폐기율 |
| 5 | **레이아웃 품질** — 세션당 드래그 시도 중앙값(<1), `jump_score` p90, `elk_ms` p95 |
| 6 | **메타 카드 이탈 매트릭스** (`field_key` × `card_index`, "모르겠어요" 별도) |
| 7 | **리텐션 코호트** — D1/D7/D14/D30 **재편집**(재방문과 분리) |
| 8 | **성장 루프** — 열람자/작성자 비율, F2 퍼널, 핸드오프 초대 전환 |
| 9 | 체크리스트 재사용·수정 발생률 |
| 10 | 신선도 응답률 (채널별, 경과일 버킷별) |
| 11 | **건강 지표** — `ime_composition_lost` 세션 비율, `editor_error_shown` TOP, 저장 p95, undo 중앙값 |
| 12 | 실험 현황판 (진행 중 1개 원칙) |

**제품팀도 실명을 볼 수 없다.** 재현이 필요하면 pid 기준으로 인앱 메시지를 자동 발송해 **본인이 자발적으로 연락하게** 한다.

## 고객사 관리자 (P2만)

| # | 위젯 | 단위 |
|---|---|---|
| 1 | 부서 커버리지 (5인 이상만, 5단위 반올림) | 부서 |
| 2 | 문서화된 프로세스 수 / 부서 간 핸드오프 수 | 프로세스 |
| 3 | **불일치 리포트** 건수와 목록 | 프로세스 |
| 4 | 자동화 후보 TOP N (기여자 5인 이상만) | 프로세스 |
| 5 | **제거 후보(ECRS)** | 단계 유형 |
| 6 | 문서 신선도 — 살아있는 비율, 자동 아카이브 예정 | 문서 |
| 7 | 자동화 착수·완료 건수, 절감 추정(**신뢰도 등급 병기**) | 건 |
| 8 | **"우리가 보지 않는 것" 상시 패널** — 아래 금지 목록을 UI에 그대로 인쇄 | — |

**절대 표시하지 않는 것**
개인 이름·pid·문서 목록·문서 링크 / 개인별 작성 수·소요시간 합계·짜증 플래그 / **미사용자 명단** / 부서 내 개인 순위 / 로그인·활동 시각 / 5인 미만 어떤 셀도 / 임의 기간·임의 필터 조합 / **모든 드릴다운**

> 두 대시보드의 차이는 **권한이 아니라 데이터 출처가 물리적으로 다르다**는 것이다.
> 관리자 화면 코드에는 PostHog 클라이언트도, `actor_pid` 컬럼을 가진 테이블에 대한 SELECT 권한도 존재하지 않는다.

---

# 6. 인사팀 파일럿 4주

**참가자** — 인사팀 전원 6~8명 + 경영지원 3~4명 = **9~12명**

**선정 기준**
(a) 반복 업무 1개 이상 보유
(b) IT 숙련도 상/중/하를 고루 — 특히 **하 그룹 최소 3명**(여기서 안 되면 전사에서도 안 됨)
(c) **회의적인 사람 최소 1명 의도적 포함**
(d) **인사팀장 포함** — 감시자 의심 부서의 장이 자기 것을 먼저 벗는 것이 이 파일럿의 전체 논리
(e) 3개월 내 인수인계 예정자 1명 (가장 강한 이기적 동기 보유자)

## W0 사전 준비 (킥오프 2주 전 — 안 끝나면 킥오프 연기)

- 시드 문서 **10개** 작성 완료 ([SEED-CONTENT.md](./SEED-CONTENT.md))
- 계측 QA: F1~F3 전 이벤트 E2E 통과, 금지 속성 drop 테스트 통과
- **k-anon 퍼즈 테스트 CI 통과** — **미통과 시 파일럿 자체 중단**
- **자동화 실행 예산·담당자 확약서 서면 확보.** 없으면 파일럿을 하지 않는다
- 공지 명의 = **인사팀장**(제품팀·경영진 명의 금지), 문안에 금지선 전문 포함
- 인터뷰 동의서, 녹취 보존 정책(30일) 고지
- 기준선 측정: "최근 인수인계 문서 하나 만드는 데 실제로 몇 시간 썼나" 자가보고

## 주차별

| 주 | 활동 | 담당 | 산출물 |
|---|---|---|---|
| **W1** | 킥오프 45분(약속 2개 + 금지선 낭독 5분) → **1인 1문서 워크숍 60분** (전원 동석, **제품팀은 관찰만·개입 금지**, 손 든 경우만 지원) | PM 진행 / 리서처 2인 관찰 | 참가자당 문서 1개, 관찰 노트, **개입 요청 횟수·사유 로그** |
| **W2** | **자연 사용 주** (공지 없음, 리마인드 없음). 병행: **1:1 사용성 테스트 45분 × 5명** | 리서처 | 사용성 이슈(심각도 3단), 두 번째 문서 작성률 |
| **W3** | **공유·전파 주.** 실제 채용 프로세스를 체크리스트 모드로 진행. 핸드오프 초대 실사용 | 인사팀 챔피언 / 제품팀 지원 | 공유 링크 수, 외부 열람 수, 체크리스트 수정 건수 |
| **W4** | 신선도 슬랙 프롬프트 발송 → 회고 90분 + **비사용자·저사용자 인터뷰 4건** | 리서처 / PM | 인터뷰 전사, 판정 리포트, 2단계 진행 여부 결정 |

## 게이트 (미달 시 다음 주로 안 넘어가고 그 주를 반복)

- **W1**: 세션 내 저장 완료 **≥80%**, 워크숍 보정 TTFD 중앙값 **≤12분**, 세션당 드래그 시도 중앙값 **<2**, 지원 개입 **≤1.5회/인**
- **W2**: **지원 없이 2번째 문서 작성 ≥50%**, 공유율 **≥30%**, 심각도 1(작업 완수 불가) 이슈 **0건**
- **W3**: 열람자/작성자 **≥2:1**, 체크리스트 실행 문서당 수정 **≥1건**
- **W4**: 신선도 응답률 **≥40%**, D14 재편집률 **≥25%**, "다른 부서에 추천하겠다" **≥7/10**

## 인터뷰 문항 10개 (실제 문안)

1. 이번 주에 이 도구로 만든 문서를 **실제로 누구에게 보여줬나요? 왜 그 사람이었나요?** (안 보여줬다면: 보여줄 뻔했다가 그만둔 순간이 있었나요?)
2. 문서를 다 만들고 나서 **처음 든 생각을 그대로** 말해주세요.
3. 이 문서가 **당신 일을 정확하게 설명하나요?** 틀린 부분을 지금 짚어주세요.
4. 만드는 도중에 **"아 귀찮다"고 느낀 순간**이 정확히 어디였나요?
5. 같은 내용을 **워드나 카톡으로 정리했다면** 몇 분 걸렸을 것 같나요? 지금은요?
6. 이 문서를 **회사가 볼 수 있다고 생각하시나요?** 그렇게 생각한 이유는요?
7. 소요시간이나 😤를 적을 때, **솔직하게 적었나요, 아니면 조금 조정했나요?** 조정했다면 어느 방향으로요?
8. 지난주에 **한 번도 안 열었다면**, 열 이유가 없었던 건가요, 여는 걸 잊은 건가요, 아니면 열기 싫었던 건가요?
9. 다음 달에 이 도구가 **사라진다면 무엇이 곤란해지나요?** (곤란한 게 없다면 그대로 말해주세요)
10. **동료에게 이걸 권한다면 첫 문장을 뭐라고** 하시겠어요? 반대로, 권하지 않겠다면 그 이유는요?

## 사용성 테스트 (45분, 1:1, 화면 공유)

**스크립트 요지**
> "제품을 테스트하는 게 아니라 **제품이 당신에게 맞는지**를 봅니다. 막히면 그건 당신 잘못이 아니라 우리 잘못이고, **그 지점이 오늘 얻으려는 정보입니다.** 생각을 소리 내어 말해주세요. 제가 15초 동안은 답을 안 드립니다."

| # | 과제 | 성공 기준 |
|---|---|---|
| T1 | 이미 갖고 있는 인수인계 워드 문서를 붙여넣어 흐름으로 만드세요 | 5분 내 5단계 이상 저장, 수정량 30% 미만 |
| T2 | (붙여넣을 게 없는 참가자) 준비 없이 반복 업무 하나를 기록하세요 | **8분 내 첫 다이어그램**, 무개입 |
| T3 | "승인 나면 A, 반려되면 B"인 부분을 표현하세요 | **힌트 없이** 3분 내 갈래 생성, **Tab 사용 없이도 성공** |
| T4 | 이 문서를 옆자리 동료가 볼 수 있게 하세요 | 90초 내 링크 생성 + **실제 전송까지** 도달 |
| T5 | 이 그림을 보고 "**어디가 제일 오래 걸리는지**" 말해보세요 | 시간 렌즈를 스스로 찾아 60초 내 정답 |

**관찰 항목** — 드래그 시도 횟수, 렌즈 발견 여부, **"이거 회사가 보나요?" 발화 유무**(신뢰 신호), 첫 3분 내 미소·한숨 등 정동 반응

## 실패 판정 — 언제 멈추는가

**즉시 중단 (재설계 전 확산 금지)**
- 개인 데이터 노출 사고 **1건이라도** → 파일럿 즉시 중단, 원인 제거 전 재개 없음
- W2 종료 시 지원 없이 두 번째 문서 작성 **<25%** → 입력 절벽 미해결. **제품 문제**
- W4 D14 재편집률 **<10%** → **"죽은 문서 생성기" 판정.** M4(체크리스트·핸드오프) 완료 전 확산 금지

**조건부 연장 (1회, 2주만)**
- TTFD 중앙값 8~12분 → 온보딩만 재설계 후 재측정
- 공유율 20~30% → 공유 CTA·OG 카드만 수정 후 재측정

**확산 자체를 금지하는 조직 조건**
- 파일럿 자동화 후보 중 **착수 0건** + 실행 예산 미확약 → **2단계(계기 확산) 진행 금지.**
  *직원이 적었는데 아무것도 안 바뀌면 그 부서는 영구 이탈한다.*

---

# 7. 정성 데이터

## 인앱 설문 — 3개 지점, 각 1~2문항, 연 4회 이하 노출

1. **첫 저장 직후**: "이 문서, 지금 누군가에게 보여줄 만한가요?" `예 / 아직 / 아니오` → `아니오`에만 자유 1문항
2. **공유 후 48시간**: "보낸 분이 이해하셨나요?" `이해함 / 추가 설명 필요 / 모르겠음`
3. **분기 1회, PMF 문항**: "이 도구를 더 못 쓰게 되면 어떠시겠어요?" `매우 아쉽다 / 조금 아쉽다 / 상관없다` — 40% 룰 추적.
   **NPS는 사내 도구에서 무의미하므로 쓰지 않는다.**

## 세션 리플레이 — 프로덕션 전면 금지

**화면에 뜨는 것이 곧 개인의 업무 내용이라, 리플레이는 정의상 프라이버시 원칙 위반이다.**

예외는 파일럿 기간에 한해 (a) 기본 꺼짐 + 명시적 opt-in (b) 모든 텍스트 노드 `data-ph-mask` **전면 마스킹** (c) 30일 자동 삭제 (d) 참가자 본인의 열람·삭제 권한.
이 상태의 리플레이는 "구조만 보이고 내용은 안 보이는" 자료라 정보량이 낮다.

> **실질 권고: 리플레이를 쓰지 말고 모더레이티드 화면 공유 세션(§6)으로 대체하라.** 같은 정보를 동의 하에, 훨씬 높은 해상도로 얻는다.

## "안 쓰는 사람"에게 접근하는 법 — 가장 어려운 부분

- **명단은 누구도 갖지 않는다.** 제품팀은 pid만 갖고 실명 매핑이 없으므로, 접근은 **시스템이 pid 기준으로 자동 발송**하는 방식으로만. **인사팀·관리자에게 미사용자 명단을 넘기는 순간 제품이 죽는다**
- **초대받은 전원 대상 무기명 설문**(사용 여부 무관, 5인 이상 부서만 집계). 1문항: "안 쓰신 이유에 가장 가까운 것은?"
- **동료 챔피언 명의** 1:1 요청. **인사팀 명의로 "왜 안 쓰세요"를 물으면 답은 전부 사회적으로 바람직한 거짓말이 된다**
- **오프라인 인터셉트** — 파일럿 부서 주간회의 끝 10분. 사용자·비사용자가 자연스럽게 섞여 있는 유일한 자리
- **보상 설계가 핵심**: 커피 쿠폰이 아니라 **"인터뷰해 주시면 당신 업무 문서를 저희가 대신 만들어 드립니다."**
  비사용자 인터뷰가 곧 시드 콘텐츠 생산이 되고, 인터뷰 끝에 완성된 자기 문서를 손에 쥔 사람은 **상당수가 사용자로 전환된다**
- **원칙**: 모든 인터뷰 대상의 **절반 이상을 비사용자로 강제 할당.** 안 그러면 표본이 팬으로만 채워진다

---

# 8. 실험 계획

**사내 소표본 원칙**
(1) 동시 진행 실험 **1개**
(2) **MDE 15%p 미만은 A/B로 판정하지 않는다** — 순차 릴리스 + 정성으로 결정
(3) 베이지안 정지 규칙 `P(B>A) > 0.95`, 최소 관측 2주
(4) **파일럿 4주(n≈10) 동안 A/B는 하지 않는다**

| # | 가설 | 1차 지표 | 표본·설계 | 기간 |
|---|---|---|---|---|
| **E1** 온보딩 진입 경로 | 붙여넣기를 첫 화면에 두면(A) 질문 연쇄 우선(B)보다 8분 내 첫 다이어그램 도달률이 높다 | `first_diagram_rendered ≤ 8min` (기준 45%) | 개인 무작위, 사용자당 1관측. MDE +20%p → **군당 97명** | 10~12주 |
| **E2** 완료 직후 CTA 프레이밍 | 개인 이득("인수인계 문서 만들기", A)이 조직 이득("3분 더 → 자동화 후보", B)보다 공유율을 높인다 | 공유율(기준 30%) | **문서 단위 반복 관측** + within-subject 교차. 클러스터 보정(GEE). 필요 **문서 ~300개** | 6~8주 |
| **E3** 신선도 프롬프트 | 슬랙 3단계 마이크로 확인(A)이 인앱 전체 리뷰 배너(B)보다 응답률이 높다 | `freshness_answered` (기대 50% vs 20%) | 효과가 크므로 **군당 45명**. **부서 단위 클러스터 배정**(오염 방지) + 2주 스위치백 | 4주 |

**E3을 가장 먼저 돌린다** — 표본이 가장 적게 들고, **D14 재편집률이라는 최대 리스크 지표에 직접 붙는다.**

---

# 9. 경보

| 분류 | 조건 | 심각도 | 담당 |
|---|---|---|---|
| **프라이버시** | 관리자 뷰 응답에 `contributor_n < 5` 셀 **1건** (매 배포 + 매일 검사) | **P0** | 즉시 호출, **관리자 대시보드 자동 차단** |
| **프라이버시** | 이벤트 스키마 검증 실패(금지 속성 유입) 1건 | **P0** | 수집기 drop + 즉시 알림 |
| **프라이버시** | base 테이블에 대한 `admin_reader` 접근 시도 1건 | **P0** | 즉시 호출 + 감사 |
| 채택 | 첫 저장률 7일 이동평균 **<40%** 또는 전주 대비 **-10%p** | P1 | 일간, PM |
| 채택 | TTFD 중앙값 **>12분** (일 20세션 이상) | P1 | 일간, PM |
| 품질 | 세션당 드래그 시도 중앙값 **≥2** | P1 | 일간, 디자인 |
| 품질 | `jump_score` p90 **>0.15** | P1 | 배포 직후 자동 비교 |
| 품질 | 파싱 실패율 **>25%** 또는 `edit_distance>60%` **>30%** | P1 | 주간, 엔지니어링 |
| 품질 | 특정 메타 카드 이탈률 **>40%** | P2 | 주간, PM |
| 품질 | `nl_branch_suggestion_dismissed / shown` **>50%** | P2 | 주간 |
| **생존** | D14 재편집률 4주 이동 **<15%** / **<10%** | P1 / **P0** | 주간 → **로드맵 재검토 트리거** |
| 성장 | 공유율 **<20%** 2주 연속 | P1 | 주간 |
| 성장 | 열람자/작성자 **<1.5:1** | P1 | 주간 |
| 생존 | 신선도 응답률 **<25%** | P1 | 주간 |
| 기술 | `ime_composition_lost` 세션 비율 **>0.5%** | **P0** | 즉시 (브라우저 회귀) |
| 기술 | `elk_ms` p95 **>800ms** / 저장 실패율 **>1%** / `editor_error_shown` **>2%** | P1 | 즉시 |
| 기술 | 세션당 `undo_performed` 중앙값 **>5** | P2 | 주간 |
| 조직 | 파일럿 부서 자동화 후보 착수 **0건 / 8주** | P1 | 월간, 경영진 보고 |

---

## 마지막 한 가지

이 계획에서 **되돌리기 가장 비싼 결정 두 개**:

1. **"이벤트에 값을 담지 않는다"**
2. **"P1→P2 파이프라인을 만들지 않는다"**

나중에 *"분석 편의상 `duration_band`만 이벤트에 넣자"*는 요청이 반드시 온다 — 6개월 안에.
그때 거절할 근거가 §1이고, **거절을 가능하게 만드는 것은 정책이 아니라 그 필드가 애초에 스키마에 존재하지 않는다는 사실이다.**

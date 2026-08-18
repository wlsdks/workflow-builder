/**
 * packages/analytics-schema/src/events.ts
 *
 * MEASUREMENT §2 이벤트 택소노미 **전량**의 zod 정본.
 *
 * ── 두 개의 계약 ────────────────────────────────────────────────────────────
 *  1. 모든 스키마는 `.strict()`다. unknown key = 이벤트 drop + 알림.
 *  2. **자유 텍스트 속성은 존재하지 않는다.** 문자열은 enum · `*_band` · 가명 ID뿐.
 *     그래서 `doc_title`은 "막히는" 것이 아니라 **적을 자리가 없다.**
 *
 * ── 여기 없는 것 ────────────────────────────────────────────────────────────
 *  소요시간 값 · 빈도 값 · 짜증 플래그 값 · 담당자 · 도구명.
 *  전부 P0(제품 DB)에만 있다. P1으로 복제하지 않는다 (MEASUREMENT §1, D-094).
 *  `meta_card_answered`에 **응답 값이 없는 것**이 이 설계의 핵심이다 — 어느 카드에
 *  얼마나 머물렀는지는 알지만 **뭐라고 답했는지는 분석 평면이 모른다.**
 */

import { z } from 'zod';

/* ── 공통 밴드·열거 ───────────────────────────────────────────────────────── */

/** 연차 원값 금지 (MEASUREMENT §2 공통 컨텍스트) */
export const TenureBand = z.enum(['<6m', '6-24m', '2-5y', '5y+']);

export const Surface = z.enum(['web', 'share_page', 'slack']);

export const EntryContext = z.enum([
  'invite',
  'direct',
  'share_link',
  'slack_freshness',
  'checklist',
  'handoff_invite',
]);

const CountBand = z.enum(['0', '1', '2-5', '6-20', '20+']);
const MsBand = z.enum(['<1s', '1-5s', '5-30s', '30s-5m', '5m+']);

/* ── 공통 컨텍스트 ────────────────────────────────────────────────────────── */

/**
 * 모든 이벤트에 붙는 봉투. 이벤트 속성과 **분리해서** 검증한다.
 * 섞으면 이벤트별 `.strict()`가 컨텍스트 키까지 알아야 해서 계약이 흐려진다.
 */
export const CommonContext = z
  .object({
    /** HMAC-SHA256(user_id, org_salt) 앞 16B base64url. 실명 매핑은 P0에만 */
    actor_pid: z.string().min(1),
    org_pid: z.string().min(1),
    /** ★ 5인 미만 부서는 **수집 시점에** 'small_dept'로 강제 치환된다 */
    dept_bucket: z.string().min(1),
    tenure_band: TenureBand,
    doc_pid: z.string().min(1).nullable().optional(),
    session_id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    entry_context: EntryContext,
    surface: Surface,
    app_version: z.string().min(1),
    client_ts: z.number().int(),
    server_ts: z.number().int(),
    /** { 실험키: 변형 } */
    flags: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export type CommonContext = z.infer<typeof CommonContext>;

/** 부서 익명화 상수 — 수집기가 5인 미만 부서를 이 값으로 치환한다 */
export const SMALL_DEPT_BUCKET = 'small_dept';

/* ── 온보딩 퍼널 ──────────────────────────────────────────────────────────── */

export const onboarding_started = z
  .object({ source: z.enum(['invite', 'direct', 'share_link', 'slack', 'seed_chip']) })
  .strict();

export const onboarding_dept_selected = z
  .object({
    dept_bucket: z.string().min(1),
    method: z.enum(['directory_default', 'manual']),
    ms_since_start: z.number().int().nonnegative(),
  })
  .strict();

export const onboarding_chip_selected = z
  .object({
    chip_id: z.string().min(1),
    chip_index: z.number().int().nonnegative(),
    chips_shown: z.number().int().nonnegative(),
    is_custom: z.boolean(),
  })
  .strict();

export const question_chain_prompted = z
  .object({
    question_index: z.number().int().nonnegative(),
    question_key: z.string().min(1),
  })
  .strict();

const questionChainAnswerShape = {
  question_index: z.number().int().nonnegative(),
  /** ★ 답 자체가 아니라 길이 밴드 */
  answer_len_band: z.enum(['empty', '<20', '20-80', '80-200', '200+']),
  ms_to_answer: z.number().int().nonnegative(),
  input_method: z.enum(['type', 'paste']),
} as const;

export const question_chain_answered = z.object(questionChainAnswerShape).strict();
export const question_chain_skipped = z.object(questionChainAnswerShape).strict();

export const question_chain_exited = z
  .object({
    last_question_index: z.number().int().nonnegative(),
    exit_reason: z.enum(['nav_away', 'close', 'switch_to_outline', 'idle_timeout']),
  })
  .strict();

export const outline_transition_shown = z
  .object({
    steps_derived: z.number().int().nonnegative(),
    source: z.enum(['paste', 'question_chain']),
    ms_since_start: z.number().int().nonnegative(),
  })
  .strict();

/** TTFD(≤8분)의 원천. ms_since_onboarding_start가 이 이벤트의 존재 이유다 */
export const first_diagram_rendered = z
  .object({
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    layout_ms: z.number().int().nonnegative(),
    ms_since_onboarding_start: z.number().int().nonnegative(),
  })
  .strict();

export const doc_saved = z
  .object({
    node_count: z.number().int().nonnegative(),
    max_depth: z.number().int().nonnegative(),
    branch_count: z.number().int().nonnegative(),
    hold_count: z.number().int().nonnegative(),
    is_first_save: z.boolean(),
    save_trigger: z.enum(['manual', 'auto', 'nav_away', 'shortcut']),
  })
  .strict();

/* ── 붙여넣기 파싱 ────────────────────────────────────────────────────────── */

export const paste_attempted = z
  .object({
    char_len_band: z.enum(['<100', '100-500', '500-2000', '2000-8000', '8000+']),
    line_count_band: z.enum(['1', '2-5', '6-20', '21-60', '60+']),
    source_hint: z.enum(['kakao', 'email', 'word', 'unknown']),
    has_numbering: z.boolean(),
  })
  .strict();

export const paste_parsed = z
  .object({
    parsed_step_count: z.number().int().nonnegative(),
    parse_ms: z.number().int().nonnegative(),
    rule_hits: z
      .object({
        newline: z.number().int().nonnegative(),
        numbering: z.number().int().nonnegative(),
        verb: z.number().int().nonnegative(),
      })
      .strict(),
    confidence_bucket: z.enum(['low', 'mid', 'high']),
  })
  .strict();

export const paste_parse_failed = z
  .object({
    reason: z.enum(['too_short', 'no_delimiter', 'single_block', 'over_limit']),
  })
  .strict();

const pasteResultShape = {
  step_count: z.number().int().nonnegative(),
  ms_before_action: z.number().int().nonnegative(),
} as const;

export const paste_result_accepted = z.object(pasteResultShape).strict();
export const paste_result_discarded = z.object(pasteResultShape).strict();

/** 파서 품질의 유일한 정량 지표. '>60%'가 30%를 넘으면 붙여넣기는 순비용이다 */
export const paste_result_edited = z
  .object({
    edit_distance_band: z.enum(['none', '<10%', '10-30%', '30-60%', '>60%']),
    edited_step_count: z.number().int().nonnegative(),
    added_step_count: z.number().int().nonnegative(),
    deleted_step_count: z.number().int().nonnegative(),
    measured_at: z.literal('first_save'),
  })
  .strict();

/* ── 에디터 ───────────────────────────────────────────────────────────────── */

export const step_added = z
  .object({
    method: z.enum(['button', 'enter', 'slash', 'paste', 'branch_case']),
    position: z.number().int().nonnegative(),
    depth: z.number().int().nonnegative(),
  })
  .strict();

export const step_deleted = z
  .object({
    had_children: z.boolean(),
    depth: z.number().int().nonnegative(),
    age_ms: z.number().int().nonnegative(),
  })
  .strict();

const NodeKindEnum = z.enum(['task', 'branch', 'hold']);

export const step_kind_changed = z
  .object({
    from_kind: NodeKindEnum,
    to_kind: NodeKindEnum,
    trigger: z.enum(['inline_suggestion', 'menu', 'shortcut']),
  })
  .strict();

export const branch_created = z
  .object({
    method: z.enum(['button', 'shortcut', 'nl_suggestion_accepted']),
    case_count: z.number().int().nonnegative(),
    mode: z.enum(['xor', 'and', 'skip']),
  })
  .strict();

/** D-006(기본값 합류) 검증 지점 */
export const branch_join_toggled = z
  .object({ to: z.enum(['continue', 'end']) })
  .strict();

const nlSuggestionShape = { trigger_phrase_key: z.string().min(1) } as const;

export const nl_branch_suggestion_shown = z.object(nlSuggestionShape).strict();
export const nl_branch_suggestion_accepted = z.object(nlSuggestionShape).strict();
export const nl_branch_suggestion_dismissed = z.object(nlSuggestionShape).strict();

export const hold_configured = z
  .object({
    wait_for: z.enum(['approval', 'reply', 'time', 'resource']),
    has_timeout: z.boolean(),
  })
  .strict();

export const undo_performed = z
  .object({
    op_type: z.string().min(1),
    undo_stack_depth: z.number().int().nonnegative(),
    ms_since_op: z.number().int().nonnegative(),
  })
  .strict();

export const editor_error_shown = z.object({ error_key: z.string().min(1) }).strict();

/** 한글 조합 유실 자동 감지 — 크롬 업데이트 회귀를 CI보다 먼저 잡는다 */
export const ime_composition_lost = z
  .object({ browser_key: z.string().min(1), os_key: z.string().min(1) })
  .strict();

/* ── 메타데이터 카드 ──────────────────────────────────────────────────────── */

export const meta_stack_entered = z
  .object({
    trigger: z.enum(['after_save', 'manual', 'prompt']),
    node_count: z.number().int().nonnegative(),
    cards_total: z.number().int().nonnegative(),
  })
  .strict();

export const meta_card_shown = z
  .object({
    field_key: z.string().min(1),
    card_index: z.number().int().nonnegative(),
    target_item_index: z.number().int().nonnegative(),
  })
  .strict();

/**
 * ★ **응답 값 없음.** 여기에 `duration_band`를 넣자는 요청이 반드시 온다
 *   ("어느 밴드가 많이 골라지는지 알면 UI를 고칠 수 있잖아요").
 *   그 순간 P1이 개인의 소요시간을 알게 된다. 그래서 자리가 없다.
 */
export const meta_card_answered = z
  .object({
    field_key: z.string().min(1),
    card_index: z.number().int().nonnegative(),
    ms_on_card: z.number().int().nonnegative(),
    input_method: z.enum(['chip', 'search', 'confirm_badge', 'default_accept']),
  })
  .strict();

export const meta_card_skipped = z
  .object({
    field_key: z.string().min(1),
    card_index: z.number().int().nonnegative(),
    skip_method: z.enum(['dont_know', 'skip_button', 'nav_away']),
  })
  .strict();

export const meta_stack_exited = z
  .object({
    last_card_index: z.number().int().nonnegative(),
    answered_count: z.number().int().nonnegative(),
    skipped_count: z.number().int().nonnegative(),
  })
  .strict();

/**
 * ★ 행위자 없는 이벤트. 짜증이 실명에 도달할 수 없어야 한다 (D-025 · D-062).
 *   `actor_pid` 미부착 스트림으로 나가므로 CommonContext를 쓰지 않는다.
 */
export const pain_flag_toggled = z
  .object({ context: z.enum(['editor', 'canvas', 'meta_card', 'checklist']) })
  .strict();

/** 짜증 이벤트 전용 봉투 — actor_pid가 **타입에 없다** */
export const AnonymousContext = z
  .object({
    org_pid: z.string().min(1),
    dept_bucket: z.string().min(1),
    surface: Surface,
    app_version: z.string().min(1),
    server_ts: z.number().int(),
  })
  .strict();

/** actor 없는 스트림으로 나가는 이벤트 이름 */
export const ANONYMOUS_EVENTS: readonly string[] = ['pain_flag_toggled'];

/* ── 캔버스 ───────────────────────────────────────────────────────────────── */

const ZoomBucket = z.enum(['<50%', '50-80%', '80-120%', '120-200%', '200%+']);
const Lens = z.enum(['plain', 'time', 'people', 'tools', 'pain']);

export const canvas_lens_changed = z
  .object({
    from_lens: Lens,
    to_lens: Lens,
    ms_on_previous_lens: z.number().int().nonnegative(),
  })
  .strict();

export const canvas_zoom_changed = z
  .object({
    zoom_bucket: ZoomBucket,
    method: z.enum(['wheel', 'button', 'pinch', 'fit']),
    node_count: z.number().int().nonnegative(),
  })
  .strict();

/** v1은 nodesDraggable=false — 드래그는 성공하지 않는다. "시도"가 순수한 불만 신호 */
export const canvas_node_drag_attempted = z
  .object({
    node_count: z.number().int().nonnegative(),
    zoom_bucket: ZoomBucket,
    lens: Lens,
    drag_distance_band: z.enum(['<10px', '10-50px', '50-200px', '200px+']),
    was_blocked: z.literal(true),
  })
  .strict();

/** jump_score = 직전 레이아웃 대비 노드 평균 이동거리 ÷ 캔버스 대각선 */
export const canvas_layout_computed = z
  .object({
    node_count: z.number().int().nonnegative(),
    elk_ms: z.number().int().nonnegative(),
    jump_score: z.number().min(0).max(1),
  })
  .strict();

export const canvas_edge_reason_hovered = z
  .object({ edge_kind: z.enum(['derived', 'explicit']) })
  .strict();

export const canvas_collapse_toggled = z
  .object({
    to: z.enum(['collapsed', 'expanded']),
    subtree_size: z.number().int().nonnegative(),
  })
  .strict();

/* ── 공유 · 열람 · 리텐션 ─────────────────────────────────────────────────── */

export const share_link_created = z
  .object({
    scope: z.enum(['view', 'comment', 'handoff']),
    expires_days: z.number().int().nonnegative(),
    node_count: z.number().int().nonnegative(),
    days_since_first_save: z.number().int().nonnegative(),
  })
  .strict();

/** ★ 수신자 식별자 금지 — 개수 밴드만 */
export const share_invite_sent = z
  .object({
    channel: z.enum(['slack', 'email', 'link_copy']),
    recipient_count_band: CountBand,
  })
  .strict();

const handoffInviteShape = { relation: z.enum(['next', 'prev']) } as const;

export const handoff_invite_shown = z.object(handoffInviteShape).strict();
export const handoff_invite_sent = z.object(handoffInviteShape).strict();

/** NSM의 "타인 1회 이상 열람" = viewer_relation != 'owner' */
export const doc_viewed = z
  .object({
    viewer_relation: z.enum(['owner', 'same_dept', 'other_dept', 'external']),
    via: z.enum(['link', 'slack', 'directory', 'search']),
    is_first_view_by_viewer: z.boolean(),
  })
  .strict();

export const doc_view_depth = z
  .object({
    scroll_depth_bucket: z.enum(['<25%', '25-50%', '50-75%', '75-100%']),
    dwell_ms_bucket: MsBand,
    lens_used: Lens,
  })
  .strict();

export const export_performed = z
  .object({
    format: z.enum(['handover_doc', 'vacation_guide', 'pdf', 'png', 'summary_card']),
  })
  .strict();

export const checklist_started = z
  .object({
    node_count: z.number().int().nonnegative(),
    occurrence_index: z.number().int().nonnegative(),
  })
  .strict();

/** "재사용이 곧 갱신" 가설의 직접 증거 */
export const checklist_step_corrected = z
  .object({
    correction_type: z.enum(['title', 'order', 'added', 'deleted', 'kind']),
  })
  .strict();

const checklistEndShape = {
  checked_ratio: z.number().min(0).max(1),
  correction_count: z.number().int().nonnegative(),
} as const;

export const checklist_completed = z.object(checklistEndShape).strict();
export const checklist_abandoned = z.object(checklistEndShape).strict();

const freshnessPromptShape = {
  channel: z.enum(['slack', 'email', 'in_app']),
  item_count: z.number().int().nonnegative(),
  staleness_days_bucket: z.enum(['<30', '30-90', '90-180', '180+']),
} as const;

export const freshness_prompt_sent = z.object(freshnessPromptShape).strict();
export const freshness_prompt_opened = z.object(freshnessPromptShape).strict();

export const freshness_answered = z
  .object({
    answer: z.enum(['ok', 'changed', 'no_longer']),
    item_index: z.number().int().nonnegative(),
    ms_to_answer: z.number().int().nonnegative(),
  })
  .strict();

export const doc_auto_archived = z
  .object({
    age_days: z.number().int().nonnegative(),
    last_confirmed_days_ago: z.number().int().nonnegative(),
  })
  .strict();

/** doc_edited_after_save와 doc_revisited_without_edit를 분리해야 D14 재편집률이 안 섞인다 */
export const doc_edited_after_save = z
  .object({
    days_since_first_save: z.number().int().nonnegative(),
    changed_item_count: z.number().int().nonnegative(),
    change_kinds: z.array(z.enum(['title', 'kind', 'order', 'meta', 'branch', 'hold'])),
  })
  .strict();

export const doc_revisited_without_edit = z
  .object({
    days_since_last_edit: z.number().int().nonnegative(),
    dwell_ms_bucket: MsBand,
  })
  .strict();

/* ── "했음" 카운터 (ANALYTICS-ENGINE §7.3 · D-094) ────────────────────────── */

/**
 * ★ `count` 값이 여기 없다. `ratio_band`조차 밴드다.
 *   빈도 값은 제품 DB(done_counter_events)에만 있고 P1에는 행위만 나간다.
 */
export const done_counter_started = z
  .object({ candidate_rank: z.number().int().min(1).max(5) })
  .strict();

export const done_counter_tapped = z
  .object({
    day_index: z.number().int().nonnegative(),
    source: z.enum(['tap', 'dm', 'backfill', 'zero']),
  })
  .strict();

export const done_counter_promoted = z
  .object({
    day_index: z.number().int().nonnegative(),
    ratio_band: z.enum(['under', 'match', 'over']),
  })
  .strict();

export const done_counter_abandoned = z
  .object({
    day_index: z.number().int().nonnegative(),
    answered_days: z.number().int().nonnegative(),
  })
  .strict();

/* ── 레지스트리 ───────────────────────────────────────────────────────────── */

/**
 * 수집 프록시가 쓰는 유일한 진입점.
 * 이름이 여기 없으면 이벤트는 존재하지 않는 것이다 — 알 수 없는 이벤트도 drop.
 */
export const EVENT_SCHEMAS = {
  onboarding_started,
  onboarding_dept_selected,
  onboarding_chip_selected,
  question_chain_prompted,
  question_chain_answered,
  question_chain_skipped,
  question_chain_exited,
  outline_transition_shown,
  first_diagram_rendered,
  doc_saved,

  paste_attempted,
  paste_parsed,
  paste_parse_failed,
  paste_result_accepted,
  paste_result_discarded,
  paste_result_edited,

  step_added,
  step_deleted,
  step_kind_changed,
  branch_created,
  branch_join_toggled,
  nl_branch_suggestion_shown,
  nl_branch_suggestion_accepted,
  nl_branch_suggestion_dismissed,
  hold_configured,
  undo_performed,
  editor_error_shown,
  ime_composition_lost,

  meta_stack_entered,
  meta_card_shown,
  meta_card_answered,
  meta_card_skipped,
  meta_stack_exited,
  pain_flag_toggled,

  canvas_lens_changed,
  canvas_zoom_changed,
  canvas_node_drag_attempted,
  canvas_layout_computed,
  canvas_edge_reason_hovered,
  canvas_collapse_toggled,

  share_link_created,
  share_invite_sent,
  handoff_invite_shown,
  handoff_invite_sent,
  doc_viewed,
  doc_view_depth,
  export_performed,
  checklist_started,
  checklist_step_corrected,
  checklist_completed,
  checklist_abandoned,
  freshness_prompt_sent,
  freshness_prompt_opened,
  freshness_answered,
  doc_auto_archived,
  doc_edited_after_save,
  doc_revisited_without_edit,

  done_counter_started,
  done_counter_tapped,
  done_counter_promoted,
  done_counter_abandoned,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;

export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

export type EventRejection =
  | { reason: 'unknown-event'; detail: string }
  | { reason: 'context-invalid'; detail: string }
  | { reason: 'props-invalid'; detail: string };

export type EventParseResult =
  | { ok: true; name: EventName; context: unknown; props: unknown }
  | { ok: false; rejection: EventRejection };

/**
 * 수집 프록시의 검증. 실패는 전부 **drop**이다 — 고쳐서 통과시키지 않는다.
 *
 * 짜증 이벤트(actor 없는 스트림)는 다른 봉투를 쓴다. 이름으로 갈린다.
 */
export function parseEvent(name: string, context: unknown, props: unknown): EventParseResult {
  if (!Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, name)) {
    return { ok: false, rejection: { reason: 'unknown-event', detail: name } };
  }
  const key = name as EventName;

  const envelope = ANONYMOUS_EVENTS.includes(key) ? AnonymousContext : CommonContext;
  const ctx = envelope.safeParse(context);
  if (!ctx.success) {
    return { ok: false, rejection: { reason: 'context-invalid', detail: issueSummary(ctx.error) } };
  }

  const parsed = EVENT_SCHEMAS[key].safeParse(props);
  if (!parsed.success) {
    return { ok: false, rejection: { reason: 'props-invalid', detail: issueSummary(parsed.error) } };
  }

  return { ok: true, name: key, context: ctx.data, props: parsed.data };
}

function issueSummary(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
    .sort()
    .join(', ');
}

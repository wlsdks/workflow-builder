/**
 * packages/analytics-schema/test/schema.test.ts
 *
 *   node --test packages/analytics-schema/test/
 *
 * 이 테스트가 증명해야 하는 것은 "금지 속성이 걸러진다"가 아니다.
 * **금지 속성이 스키마에 존재하지 않는다**는 것이다. 둘은 다르다:
 *
 *   걸러진다   → 어딘가에 필터가 있고, 그 필터는 언젠가 우회된다
 *   존재하지 않는다 → 적을 자리가 없다. 우회할 대상 자체가 없다
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import {
  ANONYMOUS_EVENTS,
  AnonymousContext,
  CommonContext,
  EVENT_NAMES,
  EVENT_SCHEMAS,
  parseEvent,
  onboarding_started,
  meta_card_answered,
  done_counter_tapped,
  share_invite_sent,
  pain_flag_toggled,
} from '../src/events.ts';
import {
  FORBIDDEN_PROPERTIES,
  FREEFORM_STRING_ALLOWLIST,
  findForbiddenProps,
  screenPayload,
} from '../src/forbidden.ts';

/* ── 도우미 ───────────────────────────────────────────────────────────────── */

const validContext = {
  actor_pid: 'p_AAAAAAAAAAAAAAAA',
  org_pid: 'o_AAAAAAAAAAAAAAAA',
  dept_bucket: 'dept_7',
  tenure_band: '6-24m' as const,
  doc_pid: 'd_AAAAAAAAAAAAAAAA',
  session_id: 's_1',
  seq: 3,
  entry_context: 'direct' as const,
  surface: 'web' as const,
  app_version: '0.1.0',
  client_ts: 1_770_000_000_000,
  server_ts: 1_770_000_000_100,
  flags: {},
};

const anonContext = {
  org_pid: 'o_AAAAAAAAAAAAAAAA',
  dept_bucket: 'dept_7',
  surface: 'web' as const,
  app_version: '0.1.0',
  server_ts: 1_770_000_000_100,
};

/** 이벤트별 최소 유효 페이로드. 새 이벤트를 추가하면 여기도 채워야 테스트가 산다 */
const VALID: Record<string, Record<string, unknown>> = {
  onboarding_started: { source: 'direct' },
  onboarding_dept_selected: { dept_bucket: 'dept_7', method: 'manual', ms_since_start: 100 },
  onboarding_chip_selected: { chip_id: 'fin-02', chip_index: 1, chips_shown: 6, is_custom: false },
  question_chain_prompted: { question_index: 0, question_key: 'who_asks' },
  question_chain_answered: {
    question_index: 0, answer_len_band: '20-80', ms_to_answer: 4000, input_method: 'type',
  },
  question_chain_skipped: {
    question_index: 1, answer_len_band: 'empty', ms_to_answer: 800, input_method: 'type',
  },
  question_chain_exited: { last_question_index: 2, exit_reason: 'nav_away' },
  outline_transition_shown: { steps_derived: 7, source: 'paste', ms_since_start: 120_000 },
  first_diagram_rendered: {
    node_count: 9, edge_count: 10, layout_ms: 120, ms_since_onboarding_start: 380_000,
  },
  doc_saved: {
    node_count: 9, max_depth: 2, branch_count: 1, hold_count: 2,
    is_first_save: true, save_trigger: 'manual',
  },

  paste_attempted: {
    char_len_band: '500-2000', line_count_band: '6-20', source_hint: 'kakao', has_numbering: true,
  },
  paste_parsed: {
    parsed_step_count: 8, parse_ms: 12,
    rule_hits: { newline: 8, numbering: 6, verb: 5 }, confidence_bucket: 'high',
  },
  paste_parse_failed: { reason: 'single_block' },
  paste_result_accepted: { step_count: 8, ms_before_action: 3000 },
  paste_result_discarded: { step_count: 8, ms_before_action: 1200 },
  paste_result_edited: {
    edit_distance_band: '10-30%', edited_step_count: 2, added_step_count: 1,
    deleted_step_count: 0, measured_at: 'first_save',
  },

  step_added: { method: 'enter', position: 3, depth: 0 },
  step_deleted: { had_children: false, depth: 1, age_ms: 9000 },
  step_kind_changed: { from_kind: 'task', to_kind: 'hold', trigger: 'menu' },
  branch_created: { method: 'button', case_count: 2, mode: 'xor' },
  branch_join_toggled: { to: 'continue' },
  nl_branch_suggestion_shown: { trigger_phrase_key: 'if_over_amount' },
  nl_branch_suggestion_accepted: { trigger_phrase_key: 'if_over_amount' },
  nl_branch_suggestion_dismissed: { trigger_phrase_key: 'if_over_amount' },
  hold_configured: { wait_for: 'approval', has_timeout: true },
  undo_performed: { op_type: 'set_title', undo_stack_depth: 2, ms_since_op: 700 },
  editor_error_shown: { error_key: 'cycle_without_rate' },
  ime_composition_lost: { browser_key: 'chrome_131', os_key: 'macos_15' },

  meta_stack_entered: { trigger: 'after_save', node_count: 9, cards_total: 12 },
  meta_card_shown: { field_key: 'duration', card_index: 0, target_item_index: 2 },
  meta_card_answered: {
    field_key: 'duration', card_index: 0, ms_on_card: 2200, input_method: 'chip',
  },
  meta_card_skipped: { field_key: 'tools', card_index: 4, skip_method: 'dont_know' },
  meta_stack_exited: { last_card_index: 6, answered_count: 5, skipped_count: 2 },
  pain_flag_toggled: { context: 'editor' },

  canvas_lens_changed: { from_lens: 'plain', to_lens: 'time', ms_on_previous_lens: 5000 },
  canvas_zoom_changed: { zoom_bucket: '80-120%', method: 'wheel', node_count: 9 },
  canvas_node_drag_attempted: {
    node_count: 9, zoom_bucket: '80-120%', lens: 'plain',
    drag_distance_band: '10-50px', was_blocked: true,
  },
  canvas_layout_computed: { node_count: 9, elk_ms: 88, jump_score: 0.12 },
  canvas_edge_reason_hovered: { edge_kind: 'derived' },
  canvas_collapse_toggled: { to: 'collapsed', subtree_size: 4 },

  share_link_created: {
    scope: 'view', expires_days: 30, node_count: 9, days_since_first_save: 2,
  },
  share_invite_sent: { channel: 'slack', recipient_count_band: '2-5' },
  handoff_invite_shown: { relation: 'next' },
  handoff_invite_sent: { relation: 'next' },
  doc_viewed: { viewer_relation: 'same_dept', via: 'slack', is_first_view_by_viewer: true },
  doc_view_depth: { scroll_depth_bucket: '50-75%', dwell_ms_bucket: '30s-5m', lens_used: 'time' },
  export_performed: { format: 'handover_doc' },
  checklist_started: { node_count: 9, occurrence_index: 3 },
  checklist_step_corrected: { correction_type: 'order' },
  checklist_completed: { checked_ratio: 1, correction_count: 2 },
  checklist_abandoned: { checked_ratio: 0.4, correction_count: 0 },
  freshness_prompt_sent: { channel: 'slack', item_count: 3, staleness_days_bucket: '90-180' },
  freshness_prompt_opened: { channel: 'slack', item_count: 3, staleness_days_bucket: '90-180' },
  freshness_answered: { answer: 'changed', item_index: 1, ms_to_answer: 5200 },
  doc_auto_archived: { age_days: 400, last_confirmed_days_ago: 220 },
  doc_edited_after_save: {
    days_since_first_save: 12, changed_item_count: 3, change_kinds: ['title', 'meta'],
  },
  doc_revisited_without_edit: { days_since_last_edit: 20, dwell_ms_bucket: '5-30s' },

  done_counter_started: { candidate_rank: 1 },
  done_counter_tapped: { day_index: 3, source: 'tap' },
  done_counter_promoted: { day_index: 10, ratio_band: 'match' },
  done_counter_abandoned: { day_index: 4, answered_days: 2 },
};

/** optional/nullable/default을 벗겨 실제 타입을 본다 */
function unwrap(schema: unknown): { type: string; inner: unknown } {
  let cur = schema as { def?: { type?: string; innerType?: unknown } };
  for (let i = 0; i < 8; i++) {
    const t = cur.def?.type;
    if (t === 'optional' || t === 'nullable' || t === 'default' || t === 'catch') {
      cur = cur.def!.innerType as typeof cur;
      continue;
    }
    return { type: t ?? 'unknown', inner: cur };
  }
  return { type: 'unknown', inner: cur };
}

function shapeOf(schema: unknown): Record<string, unknown> {
  return (schema as { shape: Record<string, unknown> }).shape;
}

/* ── 1. 금지 속성은 스키마에 존재하지 않는다 ──────────────────────────────── */

describe('금지 속성 — 존재하지 않음의 증명', () => {
  it('모든 이벤트 스키마의 속성 이름에 금지 속성이 하나도 없다', () => {
    const offenders: string[] = [];
    for (const name of EVENT_NAMES) {
      const hits = findForbiddenProps(Object.keys(shapeOf(EVENT_SCHEMAS[name])));
      for (const h of hits) offenders.push(`${name}.${h.property} — ${h.why}`);
    }
    deepStrictEqual(offenders, [], '금지 속성이 스키마에 선언되어 있다');
  });

  it('공통 컨텍스트에도 금지 속성이 없다', () => {
    deepStrictEqual(findForbiddenProps(Object.keys(shapeOf(CommonContext))), []);
    deepStrictEqual(findForbiddenProps(Object.keys(shapeOf(AnonymousContext))), []);
  });

  it('★ onboarding_started에 doc_title을 얹으면 실패한다', () => {
    const valid = { source: 'direct' as const };
    strictEqual(onboarding_started.safeParse(valid).success, true);
    strictEqual(onboarding_started.safeParse({ ...valid, doc_title: 'x' }).success, false);
  });

  it('★ meta_card_answered에 duration_band 값을 얹으면 실패한다 (D-094)', () => {
    const valid = VALID.meta_card_answered!;
    strictEqual(meta_card_answered.safeParse(valid).success, true);
    strictEqual(meta_card_answered.safeParse({ ...valid, duration_band: '15m' }).success, false);
  });

  it('★ done_counter_tapped에 count 값을 얹으면 실패한다 — 빈도 값은 P1에 없다', () => {
    const valid = VALID.done_counter_tapped!;
    strictEqual(done_counter_tapped.safeParse(valid).success, true);
    strictEqual(done_counter_tapped.safeParse({ ...valid, count: 3 }).success, false);
  });

  it('★ pain_flag_toggled에 actor_pid를 얹으면 실패한다 (D-025 · D-062)', () => {
    strictEqual(pain_flag_toggled.safeParse({ context: 'editor' }).success, true);
    strictEqual(
      pain_flag_toggled.safeParse({ context: 'editor', actor_pid: 'p_x' }).success,
      false,
    );
    // 봉투 자체에도 자리가 없다
    ok(!('actor_pid' in shapeOf(AnonymousContext)));
  });

  it('★ share_invite_sent에 수신자 이메일을 얹으면 실패한다', () => {
    const valid = VALID.share_invite_sent!;
    strictEqual(share_invite_sent.safeParse(valid).success, true);
    strictEqual(
      share_invite_sent.safeParse({ ...valid, recipient_emails: ['a@b.c'] }).success,
      false,
    );
  });

  it('모든 이벤트가 unknown key 하나에 죽는다 (.strict() 전수 검사)', () => {
    const survived: string[] = [];
    for (const name of EVENT_NAMES) {
      const valid = VALID[name];
      ok(valid, `${name}에 대한 유효 페이로드 픽스처가 없다`);
      strictEqual(EVENT_SCHEMAS[name].safeParse(valid).success, true, `${name} 유효 케이스`);
      if (EVENT_SCHEMAS[name].safeParse({ ...valid, doc_title: '세금계산서 끊기' }).success) {
        survived.push(name);
      }
    }
    deepStrictEqual(survived, [], '.strict()가 아닌 스키마가 있다');
  });

  it('금지 목록 자체가 살아 있다 — 목록의 모든 이름이 실제로 잡힌다 (D-100)', () => {
    for (const p of FORBIDDEN_PROPERTIES) {
      strictEqual(findForbiddenProps([p]).length, 1, `금지 목록의 ${p}가 안 잡힌다`);
    }
    // 오탐 확인 — 정상 속성은 통과해야 한다
    deepStrictEqual(
      findForbiddenProps([
        'node_count', 'ms_on_card', 'field_key', 'dept_bucket',
        'answer_len_band', 'recipient_count_band', 'edit_distance_band',
      ]),
      [],
    );
  });
});

/* ── 2. 자유 텍스트 속성은 존재하지 않는다 ────────────────────────────────── */

describe('문자열 규율 — enum · *_band · 가명 ID뿐', () => {
  it('z.string()을 쓰는 속성은 허용 목록 안에만 있다', () => {
    const offenders: string[] = [];
    const schemas: [string, unknown][] = [
      ['CommonContext', CommonContext],
      ['AnonymousContext', AnonymousContext],
      ...EVENT_NAMES.map((n) => [n, EVENT_SCHEMAS[n]] as [string, unknown]),
    ];
    for (const [name, schema] of schemas) {
      for (const [key, field] of Object.entries(shapeOf(schema))) {
        const { type } = unwrap(field);
        if (type !== 'string') continue;
        if (FREEFORM_STRING_ALLOWLIST.includes(key)) continue;
        offenders.push(`${name}.${key}`);
      }
    }
    deepStrictEqual(offenders, [], '자유 텍스트로 새는 문자열 속성이 있다');
  });

  it('밴드 이름을 가진 속성은 전부 enum이다 — 원값이 밴드 이름으로 위장하지 못한다', () => {
    const offenders: string[] = [];
    for (const name of EVENT_NAMES) {
      for (const [key, field] of Object.entries(shapeOf(EVENT_SCHEMAS[name]))) {
        if (!key.endsWith('_band') && !key.endsWith('_bucket')) continue;
        // dept_bucket은 우리가 발급한 부서 ID다(5인 미만은 small_dept로 치환).
        // 값의 밴드가 아니라 가명이므로 enum이 될 수 없다 — 허용 목록이 그 근거다.
        if (FREEFORM_STRING_ALLOWLIST.includes(key)) continue;
        const { type } = unwrap(field);
        if (type !== 'enum') offenders.push(`${name}.${key} = ${type}`);
      }
    }
    deepStrictEqual(offenders, []);
  });
});

/* ── 3. 봉투와 라우팅 ─────────────────────────────────────────────────────── */

describe('parseEvent', () => {
  it('알 수 없는 이벤트는 drop', () => {
    const r = parseEvent('doc_title_changed', validContext, {});
    strictEqual(r.ok, false);
    if (!r.ok) strictEqual(r.rejection.reason, 'unknown-event');
  });

  it('모든 이벤트가 정상 봉투 + 정상 페이로드로 통과한다', () => {
    for (const name of EVENT_NAMES) {
      const ctx = ANONYMOUS_EVENTS.includes(name) ? anonContext : validContext;
      const r = parseEvent(name, ctx, VALID[name]!);
      strictEqual(r.ok, true, `${name}: ${r.ok ? '' : JSON.stringify(r.rejection)}`);
    }
  });

  it('짜증 이벤트를 실명 봉투로 보내면 거절된다', () => {
    const r = parseEvent('pain_flag_toggled', validContext, { context: 'editor' });
    strictEqual(r.ok, false);
    if (!r.ok) strictEqual(r.rejection.reason, 'context-invalid');
  });

  it('봉투에 employee_no를 얹으면 거절된다', () => {
    const r = parseEvent(
      'doc_saved',
      { ...validContext, employee_no: '20240113' },
      VALID.doc_saved!,
    );
    strictEqual(r.ok, false);
    if (!r.ok) strictEqual(r.rejection.reason, 'context-invalid');
  });

  it('screenPayload는 .strict() 이전에 조기 차단한다 — 그리고 고쳐 보내지 않는다', () => {
    const s = screenPayload({ node_count: 3, item_title: '세금계산서 발행' });
    strictEqual(s.ok, false);
    strictEqual(s.hits.length, 1);
    strictEqual(s.hits[0]!.property, 'item_title');
  });
});

/* ── 4. 컨텍스트 계약 ─────────────────────────────────────────────────────── */

describe('공통 컨텍스트', () => {
  it('tenure_band는 연차 원값을 받지 않는다', () => {
    strictEqual(CommonContext.safeParse({ ...validContext, tenure_band: 3 }).success, false);
    strictEqual(CommonContext.safeParse({ ...validContext, tenure_band: '3y' }).success, false);
    strictEqual(CommonContext.safeParse({ ...validContext, tenure_band: '2-5y' }).success, true);
  });

  it('flags는 문자열 맵이다 — 값이 새어 들어올 수 없다', () => {
    strictEqual(
      CommonContext.safeParse({ ...validContext, flags: { exp_a: 'variant_b' } }).success,
      true,
    );
    strictEqual(
      CommonContext.safeParse({ ...validContext, flags: { exp_a: { note: '원문' } } }).success,
      false,
    );
  });

  it('zod가 우리가 기대하는 방식으로 strict를 구현한다 (의존성 회귀 감지)', () => {
    const probe = z.object({ a: z.string() }).strict();
    strictEqual(probe.safeParse({ a: 'x' }).success, true);
    strictEqual(probe.safeParse({ a: 'x', b: 1 }).success, false);
  });
});

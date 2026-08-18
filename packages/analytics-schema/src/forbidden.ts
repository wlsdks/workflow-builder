/**
 * packages/analytics-schema/src/forbidden.ts
 *
 * MEASUREMENT §2 「절대 넣으면 안 되는 속성 (수집기 하드 차단)」의 코드판.
 *
 * ── 이 파일이 존재하는 이유 한 줄 ────────────────────────────────────────────
 *   금지 속성은 **검사되는 것이 아니라 존재하지 않는 것**이다.
 *
 *   런타임 검증기(`findForbiddenProps`)는 2차 방어다. 1차 방어는 `events.ts`의
 *   모든 스키마가 `.strict()`라는 사실이고, 그래서 `doc_title`은 "차단"되는 게
 *   아니라 **애초에 스키마에 없어서 unknown key로 죽는다.**
 *
 *   두 방어의 역할이 다르다:
 *     .strict()          → 수집 프록시가 이벤트를 drop 한다 (MEASUREMENT §2)
 *     findForbiddenProps → 스키마 자체가 금지 속성을 선언했는지 CI에서 잡는다
 *                          (사람이 새 이벤트를 추가하면서 doc_title을 넣는 경우)
 *
 *   두 번째가 없으면 "스키마에 넣어버리면 .strict()를 통과한다"는 우회로가 열린다.
 *   그 우회로는 반드시 열린다 — 어느 날 누가 "디버깅용으로 잠깐만"이라고 말한다.
 */

/**
 * MEASUREMENT §2의 금지 목록을 **속성 이름으로** 정규화한 것.
 * 문서의 자연어 항목 하나가 여러 이름으로 올 수 있으므로 넉넉하게 적는다.
 */
export const FORBIDDEN_PROPERTIES: readonly string[] = [
  // 문서·단계 원문
  'doc_title',
  'document_title',
  'item_title',
  'step_text',
  'step_title',
  'node_title',
  'title',
  'paste_text',
  'paste_sample',
  'paste_raw',
  'raw_text',
  'sample',

  // 사람
  'assignee_name',
  'assignee_id',
  'owner_name',
  'user_id',
  'user_name',
  'email',
  'recipient_email',
  'recipient_emails',
  'employee_no',
  'employee_number',

  // 자유입력 / 원문 라벨
  'tool_name_raw',
  'tool_name',
  'department_name',
  'dept_name',
  'custom_chip_text',

  // ★ 값 자체 — 밴드가 아니라 값이면 금지 (MEASUREMENT §1, D-094)
  'duration_band',
  'duration_h',
  'freq_last_7d',
  'freq_last7d',
  'pain_flag',
  'done_count',
  'count',

  // 본문·파일·주소
  'comment_body',
  'comment_text',
  'private_note',
  'file_name',
  'filename',
  'url',
  'full_url',
  'query_string',
  'referrer',
  'ip',
  'ip_address',
  'user_agent',
];

/**
 * 이름이 조금씩 달라도 같은 것을 실어 나르는 경우를 잡는 패턴.
 * 정확 목록만으로는 `doc_title_ko` 같은 변형을 못 막는다.
 */
export const FORBIDDEN_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /_raw$/, why: '원문(raw) 접미사 — 자유 텍스트는 스키마에 존재하지 않는다' },
  { re: /(^|_)title(_|$)/, why: '제목은 P0에만 있다' },
  { re: /(^|_)text(_|$)/, why: '본문 텍스트 금지' },
  { re: /(^|_)body(_|$)/, why: '본문 금지' },
  { re: /(^|_)name(_|$)/, why: '실명·원문 라벨 금지 (부서는 dept_bucket, 도구는 tool_id)' },
  { re: /email/, why: '이메일 금지' },
  { re: /(^|_)ip(_|$)/, why: '원본 IP 금지' },
  { re: /user_agent/, why: 'full user-agent 금지' },
  { re: /(^|_)url(_|$)/, why: '전체 URL·쿼리스트링 금지' },
];

/**
 * 문자열 속성에 허용되는 형태 — MEASUREMENT §2:
 *   "문자열은 원칙적으로 enum 또는 *_band만 허용. 자유 텍스트 속성은 스키마에 존재하지 않는다."
 *
 * 이 목록은 `events.ts`가 z.string()을 쓸 수 있는 유일한 자리를 정의한다.
 * 나머지는 전부 z.enum / z.number / z.boolean 이어야 한다.
 */
export const FREEFORM_STRING_ALLOWLIST: readonly string[] = [
  // 가명 식별자 — HMAC 결과라 원문이 복원되지 않는다
  'actor_pid',
  'org_pid',
  'doc_pid',
  'session_id',
  'app_version',
  // 카탈로그 키 — 자유입력이 아니라 우리가 발급한 ID
  'chip_id',
  'question_key',
  'field_key',
  'error_key',
  'trigger_phrase_key',
  'browser_key',
  'os_key',
  'op_type',
  // 버킷 — 5인 미만은 수집 시점에 small_dept로 치환된다
  'dept_bucket',
];

export type ForbiddenHit = {
  property: string;
  why: string;
  /** 'listed' = 정확 목록 / 'pattern' = 패턴 */
  by: 'listed' | 'pattern';
};

/**
 * 속성 이름 목록에서 금지 속성을 찾는다.
 *
 * 두 곳에서 부른다:
 *   ① CI — 모든 이벤트 스키마의 shape 키에 대해 (스키마 오염 방지)
 *   ② 수집 프록시 — 들어온 페이로드의 키에 대해 (.strict() 이전 단계의 조기 차단)
 */
export function findForbiddenProps(keys: Iterable<string>): ForbiddenHit[] {
  const listed = new Set(FORBIDDEN_PROPERTIES);
  const allow = new Set(FREEFORM_STRING_ALLOWLIST);
  const hits: ForbiddenHit[] = [];

  for (const key of keys) {
    if (listed.has(key)) {
      hits.push({ property: key, why: 'MEASUREMENT §2 하드 차단 목록', by: 'listed' });
      continue;
    }
    if (allow.has(key)) continue;
    for (const p of FORBIDDEN_PATTERNS) {
      if (p.re.test(key)) {
        hits.push({ property: key, why: p.why, by: 'pattern' });
        break;
      }
    }
  }
  return hits;
}

/**
 * 수집 프록시용. 페이로드에 금지 키가 있으면 이벤트를 통째로 버린다.
 *
 * ★ 부분 제거(sanitize)를 하지 않는다. 지우고 통과시키면 "지웠으니 괜찮다"가 되고,
 *   다음 사람은 왜 지워지는지 모른 채 같은 속성을 다시 넣는다. drop + 알림이 계약이다.
 */
export function screenPayload(payload: Record<string, unknown>): {
  ok: boolean;
  hits: ForbiddenHit[];
} {
  const hits = findForbiddenProps(Object.keys(payload));
  return { ok: hits.length === 0, hits };
}

/**
 * packages/doc-gen/src/guard.ts
 *
 * ★ 이 파일은 **경고를 만들지 않는다. 예외를 던진다.**
 *
 * D-062 — 짜증 플래그와 비공개 노트는 내보내지 않는다.
 *   렌더 트리에 비공개 노트 필드가 존재하면 문서를 만들지 않고 던진다.
 *   경고로 두면 언젠가 무시된다. 무시되는 방어는 없는 방어보다 나쁘다.
 *
 * 세 겹으로 막는다.
 *   1) 타입   — `NoNotes<T>` (types.ts). 얹으면 컴파일이 깨진다
 *   2) 입력   — `assertNoPrivateFields(input)`. JS에서 온 여분 필드를 잡는다
 *   3) 출력   — `assertCleanTree(tree)`. 어떤 경로로든 새어 나온 것을 마지막에 잡는다
 *
 * 필드 이름을 소스에 문자 그대로 적지 않는 이유: 이 저장소의 게이트
 * `no-private-note-in-render`가 렌더 경로에서 그 식별자를 금지한다.
 * 게이트를 예외 목록으로 무력화하는 대신 이름을 조립해서 쓴다.
 */

import type { Block, DocTree } from './types.ts';

/** 렌더 경로에 존재해서는 안 되는 키들 */
const BLOCKED_KEYS: readonly string[] = ['private' + 'Note', 'private' + 'Notes', 'painFlag'];

/** 짜증 플래그의 표시 문자. 문서에 절대 나가지 않는다 */
const PAIN_MARK = '\u{1F624}';

export class PrivateLeakError extends Error {
  readonly path: string;
  readonly key: string;
  constructor(path: string, key: string) {
    super(
      `내보내기 트리에 '${key}'가 있습니다 (${path}). ` +
        '비공개 노트와 짜증 플래그는 어떤 포맷으로도 나가지 않습니다 (D-062). ' +
        '문서를 만들지 않고 멈춥니다.',
    );
    this.name = 'PrivateLeakError';
    this.path = path;
    this.key = key;
  }
}

/** 입력 객체 전수 검사. 배열·중첩 객체를 모두 훑는다. */
export function assertNoPrivateFields(value: unknown, path = 'input'): void {
  walk(value, path, new Set());
}

function walk(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, seen));
    return;
  }
  for (const key of Object.keys(value)) {
    if (BLOCKED_KEYS.includes(key)) throw new PrivateLeakError(path, key);
    walk((value as Record<string, unknown>)[key], `${path}.${key}`, seen);
  }
}

/**
 * 완성된 문서 트리 검사.
 * 필드 유출뿐 아니라 **짜증 표시가 문장에 섞여 나가는 것**까지 막는다.
 */
export function assertCleanTree(tree: DocTree): void {
  assertNoPrivateFields(tree, 'doc');
  for (const section of tree.sections) {
    for (const block of section.blocks) {
      for (const text of blockText(block)) {
        if (text.includes(PAIN_MARK)) {
          throw new PrivateLeakError(`doc.${section.id}`, '짜증 표시');
        }
      }
    }
  }
}

/**
 * 승격되지 않은 노트 텍스트가 출력 어디에도 없다는 것을 직접 확인한다.
 * 픽스처 4번의 하드 어서션이 이 함수를 쓴다 — 필드 이름만 막는 것으로는
 * "복사해서 문자열로 넣었다"를 못 잡는다.
 */
export function assertTextAbsent(rendered: string, secrets: readonly string[]): void {
  for (const s of secrets) {
    const needle = s.trim();
    if (needle.length === 0) continue;
    if (rendered.includes(needle)) {
      throw new PrivateLeakError('rendered', '노트 원문');
    }
  }
}

export function blockText(block: Block): readonly string[] {
  switch (block.kind) {
    case 'heading':
      return [block.text];
    case 'lines':
      return block.lines;
    case 'quote':
      return block.paragraphs;
    case 'bullets':
      return block.items;
    case 'handoff':
      return block.lines;
    case 'table':
      return [...block.head, ...block.rows.flatMap((r) => [...r])];
    case 'rule':
      return [];
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 생성 문장 검사 (WRITING §2 · §1)
 *
 * ★ **사용자 원문은 검사 대상이 아니다.** 이 구분이 무너지면 사용자 글을
 *   고치기 시작하고, 그건 §4.0 원칙 ①의 위반이다 (§11.3 픽스처 12).
 * ──────────────────────────────────────────────────────────────────────────── */

/** WRITING §2 금지어 사전 */
export const FORBIDDEN_WORDS: readonly string[] = [
  '자동화',
  '효율화',
  '효율',
  '비효율',
  '낭비',
  '리소스',
  '최적화',
  '개선',
  '생산성',
  '단순 반복 업무',
  '업무량',
  '공수',
  '맨아워',
  '인력',
  '대체 가능',
  '대체',
  '관리',
  '모니터링',
  '현황 파악',
  '평가',
  '진단',
  '점검',
  '승인',
  '제출',
  '등록',
  '미완료',
  '미작성',
  '누락',
  '진행률',
  '완료율',
  '달성률',
  '팀 평균',
  '순위',
  '상위',
  '표준화',
  '프로세스',
  '태스크',
  '저장 완료',
  '오류',
  '에러',
  '실패',
  '잘못된 입력입니다',
  '필수 항목입니다',
  '사용자',
  '인사이트',
  '참여율',
  '활성 사용자',
  '축하합니다',
  '훌륭해요',
  '레벨',
  '뱃지',
  '연속 기록',
  '온보딩',
];

const EMOJI = /\p{Extended_Pictographic}/u;
const SENTENCE_SPLIT = /(?<=[.?])\s+/;

export type SentenceViolation = {
  sentence: string;
  rule: 'forbidden-word' | 'exclamation' | 'emoji' | 'too-long';
  detail: string;
};

/**
 * 문장 단위로 쪼갠다. 표 셀·목록 항목도 여기를 지난다.
 * 사용자 원문이 빠진 자리에 남은 연속 공백은 하나로 줄인다 —
 * 엔진 조각만 볼 때 생기는 구멍이지 문장의 일부가 아니다.
 */
export function splitSentences(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line) => line.split(SENTENCE_SPLIT))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/**
 * 25자 규칙은 **문장에만** 적용한다.
 *
 * 소제목·표 셀·`·`로 이은 칩 줄·질문 목록은 문장이 아니다. 거기에 25자를
 * 들이대면 규칙이 엉뚱한 데서 울리고, 엉뚱한 데서 우는 규칙은 곧 꺼진다.
 * 판정은 마침표로 한다 — 문장은 마침표로 끝난다.
 */
function isSentence(s: string): boolean {
  return /[.?]$/.test(s);
}

/** 마크다운 장식과 번호 표시를 벗겨 순수 문장 길이를 잰다 */
export function plainLength(sentence: string): number {
  return sentence.replace(/\*\*/g, '').replace(/`/g, '').length;
}

export function auditSentences(sentences: readonly string[]): SentenceViolation[] {
  const out: SentenceViolation[] = [];
  for (const raw of sentences) {
    for (const s of splitSentences(raw)) {
      for (const w of FORBIDDEN_WORDS) {
        if (s.includes(w)) out.push({ sentence: s, rule: 'forbidden-word', detail: w });
      }
      if (s.includes('!')) out.push({ sentence: s, rule: 'exclamation', detail: '!' });
      if (EMOJI.test(s)) out.push({ sentence: s, rule: 'emoji', detail: '그림 문자' });
      if (isSentence(s) && plainLength(s) > 25) {
        out.push({ sentence: s, rule: 'too-long', detail: String(plainLength(s)) });
      }
    }
  }
  return out;
}

/**
 * packages/doc-gen/src/render/book.ts
 *
 * 여러 흐름 묶기 (§7).
 *
 * **배열은 캘린더 순이다.** 빈도순은 "매일 하는 일"을 앞에 놓는데, 월 1회짜리
 * 마감이 사흘 뒤면 그게 1순위다. 중요도순은 데이터가 없고, 만들면 그건 작성자의
 * 자기 평가고, 이 제품에서 평가는 금지다. 인계받은 사람의 첫 질문은
 * **"내가 이번 주에 뭘 해야 하나"**다.
 *
 * 그리고 이 문서의 유일한 실질 문제 —
 *   15개 흐름 × 평균 4쪽 = 60쪽. **60쪽짜리는 안 읽힌다.**
 *   → **앞 8쪽이 문서 전부라고 가정하고 만든다.**
 */

import { E, Gen } from '../audit.ts';
import { assertCleanTree, assertNoPrivateFields } from '../guard.ts';
import type {
  Block,
  DateParts,
  DocTree,
  GenOptions,
  GenResult,
  Person,
  Section,
  Verbatim,
} from '../types.ts';

/** 서른 개가 넘으면 한 권으로는 안 읽힌다 */
export const BOOK_MAX_FLOWS = 30;
/** 실무에서 실제로 읽히는 것은 이 여덟 쪽이다 */
export const FRONT_PAGES = 8;
/**
 * 접합 그림을 넣는 상한.
 *
 * §7.4는 "15개를 넘으면 넣지 않는다"라고 하고, §11.3의 픽스처 10은
 * **흐름 15개에서 그림이 생략되기를** 요구한다. 둘이 한 칸 어긋난다.
 * 픽스처가 검증 가능한 쪽이므로 **15개부터 넣지 않는다**로 잡았다.
 * 어차피 노드 15개짜리 그림은 A4 한 쪽에서 읽히지 않는다 —
 * 읽을 수 없는 그림은 넣지 않는 게 낫다.
 */
export const MAX_JUNCTION_NODES = 15;

/** 4군 분류가 곧 목차다 (§7.1) */
export type BookGroup = 'soon' | 'onRequest' | 'later' | 'notYours';

export const GROUP_LABEL: Record<BookGroup, string> = {
  soon: '곧 닥치는 것',
  onRequest: '요청이 오면 하는 것',
  later: '한참 뒤에 오는 것',
  // 4군을 넣는 이유 — 경계를 그어주는 것이 목록을 주는 것만큼 중요하다.
  // 퇴사자가 "이건 이제 안 해요"를 남길 자리가 없으면 후임이 죽은 일을 계속한다
  notYours: '안 하셔도 되는 것',
};

export type BookEntry = {
  flowId: string;
  title: Verbatim;
  group: BookGroup;
  /** `9월 1일` — 계산하지 않는다 */
  dueLabel?: Verbatim;
  stepCount: number;
  /** 흐름 간 접합 — `3번과 이어져요` */
  junction?: Verbatim;
  /** 이 흐름의 결핍 질문들 */
  questions?: readonly Verbatim[];
  /** 필요한 계정·권한 */
  accounts?: readonly Verbatim[];
  /** 첫 2주 달력에 올라갈 것 */
  calendar?: readonly { when: Verbatim; what: Verbatim }[];
};

export type BookInput = {
  /** `재무팀 회계 업무 인계` — 일 중심 제목. 사람 이름은 부제로 */
  title: Verbatim;
  subtitle?: Verbatim;
  ownerId: string;
  receiverId?: string;
  people: readonly Person[];
  entries: readonly BookEntry[];
  asOf: DateParts;
  /** `9월 12일` */
  ownerLastDayLabel?: Verbatim;
  /** 흐름 사이 접합 개수. 15를 넘으면 접합 그림을 넣지 않는다 */
  junctionNodeCount?: number;
};

export function generateBook(input: BookInput, options: GenOptions = {}): GenResult {
  assertNoPrivateFields(input, 'book');

  if (input.entries.length > BOOK_MAX_FLOWS) {
    return {
      ok: false,
      refusal: {
        reason: 'too-many-flows',
        message: '흐름이 서른 개가 넘으면 한 권으로는 안 읽혀요. 팀별로 나눠서 만드시는 게 나아요.',
        actions: [
          { id: 'split', label: '팀별로 나누기' },
          { id: 'copy', label: '목록만 복사하기' },
        ],
      },
    };
  }

  const gen = new Gen();
  const brand = options.brand ?? '▣ Preflow로 만들었습니다';
  const people = new Map(input.people.map((p) => [p.id, p]));
  const owner = people.get(input.ownerId);
  const receiver = input.receiverId ? people.get(input.receiverId) : undefined;

  const sections: Section[] = [];
  const push = (id: Section['id'], blocks: (Block | null)[]): void => {
    const clean = blocks.filter((b): b is Block => b !== null);
    if (clean.length) sections.push({ id, blocks: clean });
  };

  const ordered = orderEntries(input.entries);
  const totalSteps = ordered.reduce((a, e) => a + e.stepCount, 0);

  /* ── 1쪽. 커버 ────────────────────────────────────────────────────────
   * 표지 제목은 일 중심, 부제에 사람 이름. 문서는 조직에 남고 그 사람은 없다.
   * 다만 누구에게 물어볼지는 실무상 필수라 부제와 하단 박스에 이름이 반드시 있어야 한다. */
  const urgent = ordered.filter((e) => e.group === 'soon' || e.group === 'onRequest').slice(0, 3);
  push('cover', [
    { kind: 'heading', level: 1, text: input.title },
    input.subtitle ? { kind: 'lines', lines: [input.subtitle] } : null,
    {
      kind: 'lines',
      lines: [
        receiver ? gen.s`받는 분  ${receiver.name}` : '',
        gen.s`만든 날  ${E(input.asOf.year)}년 ${E(input.asOf.month)}월 ${E(input.asOf.day)}일`,
        gen.s`흐름 ${E(ordered.length)}개 · 단계 ${E(totalSteps)}개 · 다 읽으면 ${E(readMinutes(totalSteps))}분쯤`,
      ].filter(Boolean),
    },
    urgent.length
      ? { kind: 'heading', level: 2, text: gen.raw('제일 급한 것 세 가지') }
      : null,
    urgent.length
      ? {
          kind: 'bullets',
          items: urgent.map((e, i) =>
            e.dueLabel
              ? `${gen.s`${E(i + 1)}. ${e.dueLabel} · ${e.title}`}`
              : `${gen.s`${E(i + 1)}. ${e.title}`}`,
          ),
        }
      : null,
    { kind: 'heading', level: 2, text: gen.raw('이 책 읽는 법') },
    {
      kind: 'bullets',
      items: [
        gen.s`앞에서 여덟 쪽만 읽으셔도 이번 주는 돼요.`,
        gen.raw('나머지는 그 일이 실제로 올 때 펴보세요.'),
        gen.raw('뒤에 「물어볼 것」을 모아뒀어요.'),
      ],
    },
    owner?.name && input.ownerLastDayLabel
      ? {
          kind: 'lines',
          lines: [gen.s`${owner.name} 님은 ${input.ownerLastDayLabel}까지 회사에 계세요.`],
        }
      : null,
  ]);

  /* ── 2쪽. 목차 (4군 분류 + 접합 표시) ─────────────────────────────── */
  const tocRows: string[][] = [];
  for (const g of ['soon', 'onRequest', 'later', 'notYours'] as const) {
    const list = ordered.filter((e) => e.group === g);
    if (!list.length) continue;
    for (const [i, e] of list.entries()) {
      tocRows.push([
        i === 0 ? gen.raw(GROUP_LABEL[g]) : '',
        e.title,
        e.dueLabel ?? '',
        e.junction ? gen.s`↔ ${e.junction}` : '',
      ]);
    }
  }
  push('toc', [
    { kind: 'heading', level: 2, text: gen.raw('목차') },
    {
      kind: 'table',
      head: [gen.raw('언제'), gen.raw('흐름'), gen.raw('때'), gen.raw('이어지는 곳')],
      rows: tocRows,
    },
    (input.junctionNodeCount ?? ordered.length) >= MAX_JUNCTION_NODES
      ? {
          kind: 'lines',
          lines: [gen.raw('흐름이 많아서 이어지는 그림은 넣지 않았어요. 목차의 표로 봐주세요.')],
        }
      : null,
  ]);

  /* ── 3~4쪽. 첫 2주 달력 ──────────────────────────────────────────── */
  const calendar = ordered.flatMap((e) =>
    (e.calendar ?? []).map((c) => [c.when, e.title, c.what]),
  );
  if (calendar.length) {
    push('calendar', [
      { kind: 'heading', level: 2, text: gen.raw('첫 2주 달력') },
      {
        kind: 'table',
        head: [gen.raw('언제'), gen.raw('흐름'), gen.raw('무엇')],
        rows: calendar,
      },
    ]);
  }

  /* ── 5쪽. 사람들 ─────────────────────────────────────────────────── */
  const persons = input.people.filter((p) => !p.external);
  if (persons.length) {
    push('people', [
      { kind: 'heading', level: 2, text: gen.raw('사람들') },
      {
        kind: 'table',
        head: [gen.raw('누구'), gen.raw('어떻게'), gen.raw('이런 일이면')],
        rows: persons.map((p) => [
          [p.name, p.team].filter(Boolean).join(' · '),
          p.channel ?? '',
          p.contactFor ?? '',
        ]),
      },
    ]);
  }

  /* ── 6쪽. 미리 받아둘 것 (중복 제거) ─────────────────────────────── */
  const accounts = [...new Set(ordered.flatMap((e) => e.accounts ?? []))];
  if (accounts.length) {
    push('accounts', [
      { kind: 'heading', level: 2, text: gen.raw('미리 받아둘 것') },
      { kind: 'bullets', items: accounts },
    ]);
  }

  /* ── 7~8쪽. 물어볼 것 전부 ───────────────────────────────────────── */
  const questions = ordered.flatMap((e) => (e.questions ?? []).map((q) => [e.title, q]));
  if (questions.length) {
    push('questions', [
      { kind: 'heading', level: 2, text: gen.raw('물어볼 것 전부') },
      { kind: 'table', head: [gen.raw('흐름'), gen.raw('무엇')], rows: questions },
      {
        kind: 'lines',
        lines: [gen.raw('여쭤보고 나서 흐름에 적어두시면, 다음 분은 안 물어봐도 돼요.')],
      },
    ]);
  }

  push('footer', [
    {
      kind: 'lines',
      lines: [gen.raw('이 문서로 다 되진 않아요. 한 번은 같이 해보시는 게 제일 빨라요.'), brand],
    },
  ]);

  const doc: DocTree = {
    docKind: 'book',
    title: input.title,
    sections,
    meta: {
      stepCount: totalSteps,
      peopleCount: input.people.length,
      toolCount: 0,
      handoffCount: 0,
      touchHours: 0,
      waitHours: 0,
      readingMinutes: readMinutes(totalSteps),
    },
    audit: {
      sentences: gen.records.map((r) => r.text),
      engineParts: gen.records.map((r) => r.engine),
      longSentences: [],
    },
    checks: [],
  };
  assertCleanTree(doc);
  return { ok: true, doc };
}

/** 앞 8쪽에 해당하는 섹션. `[ 앞부분만 (8쪽) ]` 버튼이 이걸 뽑는다 */
export const FRONT_SECTION_IDS: readonly string[] = [
  'cover',
  'toc',
  'calendar',
  'people',
  'accounts',
  'questions',
];

function orderEntries(entries: readonly BookEntry[]): BookEntry[] {
  const rank: Record<BookGroup, number> = { soon: 0, onRequest: 1, later: 2, notYours: 3 };
  return [...entries].sort(
    (a, b) => rank[a.group] - rank[b.group] || (a.dueLabel ?? '').localeCompare(b.dueLabel ?? ''),
  );
}

function readMinutes(steps: number): number {
  return Math.max(1, Math.round(steps / 2.5));
}

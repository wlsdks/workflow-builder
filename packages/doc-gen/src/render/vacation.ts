/**
 * packages/doc-gen/src/render/vacation.ts
 *
 * 자리 비울 때 볼 안내 (§3).
 *
 * 인계 문서와 **같은 템플릿의 옵션이 아니다.** 다섯 가지가 근본적으로 다르다.
 *
 *   목표      이해              → **안 막히기**
 *   뼈대      순서 (1→14)       → **날짜 (월~금)**
 *   범위      전부              → **그 기간에 실제로 닥치는 것만**
 *   핵심 섹션 「순서대로」       → **「이건 안 하셔도 돼요」**
 *   유효기간  없음              → 문서에 있음. 지나면 자동 만료
 *
 * 「이건 안 하셔도 돼요」가 왜 제일 중요한가 — 대신 맡는 사람의 실제 불안은
 * "내가 뭘 해야 하나"가 아니라 **"어디까지가 내 책임인가"**다. 이 경계를 안
 * 그어주면 그 사람은 아무것도 안 하거나 전부 다 하려다 사고를 낸다.
 * 인계 문서에는 이 섹션이 존재할 수 없다 — 인계는 전부가 그 사람 일이 되니까.
 *
 * ★ 날짜를 계산하지 않는다 (D-063). 요일·기간 라벨은 전부 받은 것을 그대로 쓴다.
 *   잘못된 마감일 하나가 가산세를 만든다.
 */

import { E, Gen } from '../audit.ts';
import { assertCleanTree, assertNoPrivateFields } from '../guard.ts';
import { countWord } from '../lang.ts';
import type {
  Block,
  DocTree,
  GenOptions,
  GenResult,
  Person,
  Section,
  Verbatim,
} from '../types.ts';

/** 3주를 넘으면 인계 문서로 안내한다 */
export const VACATION_MAX_DAYS = 21;
/** 3일 이하는 「꼭 해야 하는 것」만 남기고 나머지는 한 줄씩 */
export const VACATION_SHORT_DAYS = 3;

export type VacationSpan = {
  /** `8월 24일 월요일` — 계산하지 않는다 */
  fromLabel: Verbatim;
  toLabel: Verbatim;
  /** 표지 첫 줄의 연도 */
  year: number;
  /** 부재 일수. 기간 필터의 유일한 근거 */
  days: number;
  /** `8월 31일 월요일` */
  returnLabel?: Verbatim;
  /** `8월 31일` — 이 날 링크가 닫힌다 */
  expiresLabel?: Verbatim;
};

export type VacationItem = {
  /** `8월 25일 화요일` 또는 `요청이 오면` */
  when: Verbatim;
  title: Verbatim;
  /** 무엇을 · 어디서 — 원문 그대로 */
  body?: Verbatim;
  /** `15분` / `2시간` — 자유 표기. 밴드로 강제하지 않는다 */
  durationLabel?: Verbatim;
  /** 안 하면 어떻게 되는지. 없으면 생략 */
  consequence?: Verbatim;
  /** 미뤄도 되는 부분 */
  deferNote?: Verbatim;
  /** 소유자가 승격한 한 줄 */
  note?: Verbatim;
};

export type VacationInput = {
  ownerId: string;
  /** 대신 맡는 사람 */
  standInId: string;
  people: readonly Person[];
  span: VacationSpan;
  mustDo: readonly VacationItem[];
  justReceive: readonly { title: Verbatim; body: Verbatim }[];
  skip: readonly { title: Verbatim; body: Verbatim }[];
  contacts: readonly { situation: Verbatim; personId: string }[];
  /** `저한테 연락해도 되는 경우` — 건너뛸 수 있고, 건너뛰면 섹션이 통째로 빠진다 */
  reachMe?: { lead: Verbatim; cases: readonly Verbatim[]; tail?: Verbatim };
  moreLinks?: readonly Verbatim[];
};

export function generateVacation(input: VacationInput, options: GenOptions = {}): GenResult {
  assertNoPrivateFields(input, 'vacation');

  /* 3주 초과 — 대신 하실 분이 흐름을 알아야 한다. 두 버튼은 같은 크기다 */
  if (input.span.days > VACATION_MAX_DAYS) {
    return {
      ok: false,
      refusal: {
        reason: 'absence-too-long',
        message: '한 달 가까이 비우시면, 대신 하실 분이 흐름을 알아야 해요. 인계 문서 쪽이 나아요.',
        actions: [
          { id: 'handover', label: '인계 문서로 만들기' },
          { id: 'short', label: '그래도 짧게 만들기' },
        ],
      },
    };
  }

  /* 「안 하셔도 돼요」가 비면 문서를 만들지 않고 되묻는다.
   * 전부 급한 일이면 그건 안내가 아니라 **휴가를 못 가는 상태**다.
   * 이 되물음이 「휴가를 왜 못 가는가」의 데이터가 된다. */
  if (input.skip.length === 0) {
    return {
      ok: false,
      refusal: {
        reason: 'nothing-to-skip',
        message: '이 기간에 미뤄도 되는 일이 하나도 없나요?',
        actions: [
          { id: 'add-steps', label: '미뤄도 되는 일 적기' },
          { id: 'short', label: '그대로 만들기' },
        ],
      },
    };
  }

  const gen = new Gen();
  const brand = options.brand ?? '▣ Preflow로 만들었습니다';
  const people = new Map(input.people.map((p) => [p.id, p]));
  const owner = people.get(input.ownerId);
  const standIn = people.get(input.standInId);
  const short = input.span.days <= VACATION_SHORT_DAYS;

  const sections: Section[] = [];
  const push = (id: Section['id'], blocks: (Block | null)[]): void => {
    const clean = blocks.filter((b): b is Block => b !== null);
    if (clean.length) sections.push({ id, blocks: clean });
  };

  /* ── 표지 ─────────────────────────────────────────────────────────── */
  const total = input.mustDo.length + input.justReceive.length + input.skip.length;
  const readingMinutes = Math.max(1, Math.round(total / 3));
  const s = input.span;

  push('title', [
    { kind: 'heading', level: 1, text: gen.s`${owner?.name ?? ''} 자리 비우는 동안` },
    {
      kind: 'lines',
      lines: [
        gen.s`${E(s.year)}년 ${s.fromLabel} ~ ${s.toLabel} · ${E(countDays(s.days))}`,
        [
          gen.s`받는 분: ${standIn?.name ?? ''} 님`,
          s.returnLabel ? gen.s`${s.returnLabel}에 돌아와요` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ],
    },
    {
      kind: 'lines',
      lines: [
        gen.s`읽는 데 ${E(readingMinutes)}분쯤 걸려요. ${E(countWord(input.mustDo.length, '가지'))}만 해주시면 돼요.`,
      ],
    },
  ]);

  /* ── 꼭 해야 하는 것 — **절대 자르지 않는다** ────────────────────── */
  const mustBlocks: (Block | null)[] = [
    { kind: 'heading', level: 2, text: gen.raw('꼭 해야 하는 것') },
  ];
  for (const item of input.mustDo) {
    mustBlocks.push({ kind: 'heading', level: 3, text: `${item.when} · ${item.title}` });
    const lines: string[] = [];
    if (item.body) lines.push(...item.body.split('\n'));
    if (item.durationLabel && owner) {
      lines.push(gen.s`${owner.name} 님이 보통 ${item.durationLabel}쯤 걸려서 해요.`);
    }
    if (lines.length) mustBlocks.push({ kind: 'lines', lines });
    if (item.consequence) mustBlocks.push({ kind: 'lines', lines: [item.consequence] });
    if (item.note) {
      mustBlocks.push({
        kind: 'quote',
        paragraphs: [item.note, gen.s`— ${owner?.name ?? ''} 님이 덧붙인 말이에요.`],
      });
    }
    if (item.deferNote) mustBlocks.push({ kind: 'lines', lines: [item.deferNote] });
  }
  push('mustDo', mustBlocks);

  /* ── 오면 받아만 두시면 되는 것 ──────────────────────────────────────
   * 부재 직전에 던져놓은 요청의 답이 부재 중에 오고, 아무도 안 받는다.
   * 실무에서 사고가 제일 자주 나는 곳이 여기다. */
  if (input.justReceive.length) {
    push('justReceive', [
      { kind: 'heading', level: 2, text: gen.raw('오면 받아만 두시면 되는 것') },
      {
        kind: 'bullets',
        items: input.justReceive.map((i) => `**${i.title}** — ${i.body}`),
      },
    ]);
  }

  /* ── 이건 안 하셔도 돼요 — 이 문서에서 제일 중요한 섹션 ──────────── */
  push('skip', [
    { kind: 'heading', level: 2, text: gen.raw('이건 안 하셔도 돼요') },
    {
      kind: 'bullets',
      items: input.skip.map((i) => (short ? `**${i.title}**` : `**${i.title}** — ${i.body}`)),
    },
  ]);

  /* ── 막히면 + 저한테 연락해도 되는 경우 (같은 장에 붙는다) ───────── */
  const reachBlocks: (Block | null)[] = [];
  if (input.contacts.length) {
    const decided = new Set<string>();
    reachBlocks.push({ kind: 'heading', level: 2, text: gen.raw('막히면') });
    reachBlocks.push({
      kind: 'table',
      head: [gen.raw('이런 일이면'), gen.raw('누구'), gen.raw('어떻게')],
      rows: input.contacts.map((c) => {
        const p = people.get(c.personId);
        const first = p?.decides && !decided.has(c.personId);
        if (p?.decides) decided.add(c.personId);
        return [
          first ? gen.s`${c.situation}, 그리고 결정이 필요한 일` : c.situation,
          [p?.name, p?.team].filter(Boolean).join(' · '),
          p?.channel ?? '',
        ];
      }),
    });
  }

  /* 이 섹션이 "연락하지 마세요"로 읽히면 안 되고 "이럴 땐 하세요"로 읽혀야 한다 */
  if (input.reachMe) {
    const paragraphs: string[] = [input.reachMe.lead];
    if (input.reachMe.cases.length) {
      paragraphs.push(input.reachMe.cases.map((c) => `- ${c}`).join('\n'));
    }
    if (input.reachMe.tail) paragraphs.push(input.reachMe.tail);
    paragraphs.push(gen.s`— ${owner?.name ?? ''} 님이 직접 적어주신 말이에요.`);
    reachBlocks.push({ kind: 'heading', level: 2, text: gen.raw('저한테 연락해도 되는 경우') });
    reachBlocks.push({ kind: 'quote', paragraphs });
  }
  push('reachMe', reachBlocks);

  /* ── 더 알고 싶으시면 + 만료 ─────────────────────────────────────── */
  const moreBlocks: (Block | null)[] = [];
  if (input.moreLinks?.length) {
    moreBlocks.push({ kind: 'heading', level: 2, text: gen.raw('더 알고 싶으시면') });
    moreBlocks.push({
      kind: 'bullets',
      items: input.moreLinks.map((t) => `${gen.s`「${t}」 전체 흐름 → `}${gen.raw('[흐름 보기]')}`),
    });
  }
  if (s.expiresLabel) {
    moreBlocks.push({
      kind: 'lines',
      lines: [gen.s`이 안내는 ${s.expiresLabel}에 자동으로 닫혀요.`],
    });
  }
  moreBlocks.push({ kind: 'lines', lines: [brand] });
  push('more', moreBlocks);

  const doc: DocTree = {
    docKind: 'vacation',
    title: `${owner?.name ?? ''} 자리 비우는 동안`,
    sections,
    meta: {
      stepCount: total,
      peopleCount: input.people.length,
      toolCount: 0,
      handoffCount: 0,
      touchHours: 0,
      waitHours: 0,
      readingMinutes,
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

function countDays(days: number): string {
  return `${days}일`;
}

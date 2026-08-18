/**
 * packages/doc-gen/src/render/handover.ts
 *
 * 인계 문서 — 문서 트리를 만든다 (§2).
 *
 * 이 파일은 **문장을 만들지 않는다.** 문장은 sentence/*에서만 만들어진다.
 * 여기가 정하는 것은 순서와 조건, 그리고 어떤 섹션이 아예 안 나오는가다.
 *
 * 섹션이 "안 나오는" 규칙이 이 문서의 절반이다 —
 *   · 「제일 조심할 곳」은 답이 없으면 **섹션 자체를 넣지 않는다.**
 *     빈 블록이나 "적혀 있지 않아요"를 쓰지 않는다
 *   · 「물어보셔야 해요」는 결핍 0개면 사라진다. 그 자체가 칭찬이 되므로
 *     축하 문구를 넣지 않는다
 */

import { E } from '../audit.ts';
import type { Ctx } from '../ctx.ts';
import { makeCtx } from '../ctx.ts';
import { collectGaps, handoffPoints, type Gap, type HandoffPoint } from '../gaps.ts';
import { assertCleanTree, assertNoPrivateFields } from '../guard.ts';
import {
  BAND_HOURS,
  BAND_LABEL,
  countWord,
  subjectParticle,
  waitCompact,
} from '../lang.ts';
import { branchBody, branchNote, caseLines, returnListItem } from '../sentence/branch.ts';
import { connective, returnTargetNote } from '../sentence/link.ts';
import type { NumberedStep } from '../sentence/number.ts';
import { holdBody, holdTimeoutCompact } from '../sentence/hold.ts';
import { taskBody } from '../sentence/task.ts';
import type {
  Block,
  Check,
  DocTree,
  FlowInput,
  GenOptions,
  GenResult,
  Refusal,
  Section,
  Step,
} from '../types.ts';

/* ────────────────────────────────────────────────────────────────────────────
 * 생성 거부 (§10.6)
 *
 * **막을 때는 실패 메시지가 아니라 대안이다.** 임계선은 일부러 낮게 잡았다 —
 * 높게 잡으면 데이터가 없는 사람은 영원히 이 기능의 가치를 못 보고,
 * 그러면 데이터를 채울 이유도 영원히 안 생긴다.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MIN_STEPS = 5;
export const MIN_AVG_TITLE = 8;

export function refusalFor(flow: FlowInput): Refusal | null {
  const steps = flow.steps;

  if (steps.length < MIN_STEPS) {
    return {
      reason: 'too-few-steps',
      message:
        `지금은 단계가 ${countWord(steps.length, '개')}라서, ` +
        '문서보다 그냥 복사해서 보내시는 게 나아요.',
      actions: [
        { id: 'copy', label: '복사하기' },
        { id: 'add-steps', label: '단계 더 적기' },
      ],
    };
  }

  const avg = steps.reduce((a, s) => a + s.title.trim().length, 0) / steps.length;
  if (avg < MIN_AVG_TITLE) {
    return {
      reason: 'titles-too-short',
      message:
        '단계 제목이 짧아서 제목만으로는 무슨 일인지 알기 어려워요. ' +
        '지금 만들면 문서가 아니라 목차가 나와요.',
      actions: [
        { id: 'copy', label: '복사하기' },
        { id: 'add-steps', label: '제목 더 적기' },
      ],
    };
  }

  const branches = steps.filter((s) => s.branch && s.branch.cases.length > 0);
  if (branches.length > 0) {
    const anyLabel = branches.some((s) =>
      (s.branch?.cases ?? []).some((c) => c.label || c.condition),
    );
    if (!anyLabel) {
      return {
        reason: 'no-branch-criteria',
        message:
          '갈래는 있는데 뭘 보고 갈리는지가 아직 없어요. ' +
          '지금 만들면 "여기서 갈려요"만 반복돼요.',
        actions: [
          { id: 'copy', label: '복사하기' },
          { id: 'add-labels', label: '갈래 기준 적기' },
        ],
      };
    }
  }

  return null;
}

/** 문서가 거짓말을 하게 되는 상태. 경고가 아니라 예외다 (§9.1 #6 #7) */
export class DocIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocIntegrityError';
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 본체
 * ──────────────────────────────────────────────────────────────────────────── */

export function generateHandover(flow: FlowInput, options: GenOptions = {}): GenResult {
  // ① 입력에 비공개 노트가 섞여 들어왔는지 먼저 본다. 만들다 말고 던지지 않는다
  assertNoPrivateFields(flow, 'flow');

  const refusal = refusalFor(flow);
  if (refusal) return { ok: false, refusal };

  const ctx = makeCtx(flow, options);
  const doc = build(ctx);

  // ② 다 만든 뒤 마지막으로 트리를 검사한다
  assertCleanTree(doc);
  return { ok: true, doc };
}

function build(ctx: Ctx): DocTree {
  const { gen, flow, n } = ctx;
  const handoffs = handoffPoints(ctx);
  const gaps = collectGaps(ctx);
  const checks: Check[] = [];

  assertNoOrphanReferences(ctx);

  const sections: Section[] = [];
  const push = (id: Section['id'], blocks: (Block | null)[]): void => {
    const clean = blocks.filter((b): b is Block => b !== null);
    if (clean.length) sections.push({ id, blocks: clean });
  };

  const totals = totalHours(ctx);
  const readingMinutes = Math.max(1, Math.round(flow.steps.length / 2));

  /* ── 0. 타이틀 블록 ───────────────────────────────────────────────── */
  push('title', [
    { kind: 'heading', level: 1, text: gen.user(flow.title) },
    { kind: 'lines', lines: titleChips(ctx, readingMinutes) },
    { kind: 'lines', lines: summaryLines(ctx, handoffs.length, totals) },
  ]);

  /* ── 1. 제일 조심할 곳 ────────────────────────────────────────────────
   * 소유자가 내보내기 직전 1문항에 답했을 때만. 없으면 **섹션 자체가 없다.**
   * §10.1 — 자동 생성 문서와 사람 문서의 격차 대부분이 이 한 칸에 있다.
   */
  if (flow.hardestPart) {
    push('hardest', [
      { kind: 'heading', level: 2, text: gen.raw('제일 조심할 곳') },
      { kind: 'quote', paragraphs: [gen.user(flow.hardestPart)] },
      {
        kind: 'lines',
        lines: [gen.s`— ${ctx.owner?.name ?? ''} 님이 직접 적어주신 말이에요.`],
      },
    ]);
  }

  /* ── 2. 막히면 이 사람들에게 ──────────────────────────────────────── */
  push('contacts', contactsSection(ctx));

  /* ── 3. 이 일은 이렇게 시작해서 이렇게 끝나요 ─────────────────────── */
  push('lifecycle', lifecycleSection(ctx));

  /* ── 4. 순서대로 ─────────────────────────────────────────────────── */
  push('steps', stepsSection(ctx, handoffs));

  /* ── 5. 이렇게 안 흘러갈 때 ──────────────────────────────────────── */
  push('exceptions', exceptionsSection(ctx));

  /* ── 6. 앞뒤로 이어지는 일 ───────────────────────────────────────── */
  push('neighbors', neighborsSection(ctx));

  /* ── 7. 이 문서에 나오는 말들 ────────────────────────────────────── */
  push('glossary', glossarySection(ctx));

  /* ── 8. 이건 물어보셔야 해요 ─────────────────────────────────────── */
  push('questions', questionsSection(ctx, gaps));

  /* ── 9. 단계별로 한눈에 ──────────────────────────────────────────── */
  push('stepTable', stepTableSection(ctx, handoffs));

  /* ── 9b. 부록 — 본문에서 뺀 갈래 ─────────────────────────────────── */
  push('appendix', appendixSection(ctx));

  /* ── 10. 푸터 ────────────────────────────────────────────────────── */
  push('footer', footerSection(ctx));

  const doc: DocTree = {
    docKind: 'handover',
    title: flow.title,
    sections,
    meta: {
      stepCount: flow.steps.length,
      peopleCount: peopleInFlow(ctx).length,
      toolCount: toolsInFlow(ctx).length,
      handoffCount: handoffs.length,
      touchHours: totals.touch,
      waitHours: totals.wait,
      readingMinutes,
    },
    audit: {
      sentences: gen.records.map((r) => r.text),
      engineParts: gen.records.map((r) => r.engine),
      longSentences: [],
    },
    checks,
  };

  // §9.1 #7 — 인계 블록 수와 요약 숫자가 어긋나면 문서가 거짓말을 한다
  const blockCount = countHandoffBlocks(doc);
  if (blockCount !== handoffs.length) {
    throw new DocIntegrityError(
      `인계 블록 ${blockCount}개인데 요약은 ${handoffs.length}번이라고 적혀 있습니다.`,
    );
  }

  collectChecks(ctx, gaps, checks, n.steps);
  return doc;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 섹션들
 * ──────────────────────────────────────────────────────────────────────────── */

function titleChips(ctx: Ctx, readingMinutes: number): string[] {
  const { gen, flow } = ctx;
  const chips: string[] = [];
  if (flow.deptLabel) chips.push(gen.user(flow.deptLabel));
  if (flow.cadence) chips.push(gen.user(flow.cadence.label));
  if (ctx.owner) chips.push(gen.s`${ctx.owner.name} 님이 하시던 일`);

  const d = flow.asOf;
  return [
    chips.join(' · '),
    gen.s`${E(d.year)}년 ${E(d.month)}월 ${E(d.day)}일 기준 · 읽는 데 ${E(readingMinutes)}분쯤`,
  ].filter((s) => s.length > 0);
}

type Totals = { touch: number; wait: number; touchCovered: boolean; waitCovered: boolean };

function totalHours(ctx: Ctx): Totals {
  let touch = 0;
  let wait = 0;
  let touchCovered = false;
  let waitCovered = false;
  for (const s of ctx.allSteps) {
    if (s.durationBand) {
      touch += BAND_HOURS[s.durationBand] ?? 0;
      touchCovered = true;
    }
    if (s.hold && typeof s.hold.avgWaitH === 'number') {
      wait += s.hold.avgWaitH;
      waitCovered = true;
    }
  }
  return { touch, wait, touchCovered, waitCovered };
}

/**
 * 요약 숫자.
 *
 * D-063 — **엔진은 숫자를 새로 만들지 않는다.** 유일한 예외가 시간 합계이고,
 * 그때도 `적힌 것만 합쳐서`라는 단서를 **절대 생략하지 않는다.**
 * 그리고 올림한다. 인계에서 시간을 적게 부르는 쪽이 훨씬 비싼 실수다.
 */
function summaryLines(ctx: Ctx, handoffCount: number, totals: Totals): string[] {
  const { gen, flow, opts } = ctx;
  const lines: string[] = [];

  /* `0명`·`0가지`는 **사람이 없다는 뜻이 아니라 안 적었다는 뜻**이라 거짓말이 된다.
   * 그래서 커버리지에 딸린 숫자는 0이면 칩을 뺀다.
   * 반대로 `담당이 바뀌는 곳 0번`은 구조적 사실이므로 0이어도 남긴다. */
  const people = peopleInFlow(ctx).length;
  const tools = toolsInFlow(ctx).length;
  const counts = [
    gen.s`단계 ${E(flow.steps.length)}개`,
    people > 0 ? gen.s`함께 하는 사람 ${E(people)}명` : '',
    tools > 0 ? gen.s`쓰는 것 ${E(tools)}가지` : '',
    gen.s`담당이 바뀌는 곳 ${E(handoffCount)}번`,
  ].filter(Boolean);
  lines.push(counts.join(' · '));

  const times: string[] = [];
  if (totals.touchCovered) {
    times.push(gen.s`손이 가는 시간은 적힌 것만 합쳐서 약 ${E(span(totals.touch, opts.touchHoursPerDay))}`);
  }
  if (totals.waitCovered) {
    times.push(gen.s`기다리는 시간은 약 ${E(span(totals.wait, opts.waitHoursPerDay))}`);
  }
  if (times.length) lines.push(times.join(' · '));

  return lines;
}

function span(hours: number, perDay: number): string {
  if (hours < perDay) return `${Math.max(1, Math.round(hours))}시간`;
  return `${Math.ceil(hours / perDay)}일`;
}

function peopleInFlow(ctx: Ctx): string[] {
  const ids = new Set<string>();
  for (const s of ctx.allSteps) if (s.assigneeId) ids.add(s.assigneeId);
  return [...ids];
}

function toolsInFlow(ctx: Ctx): string[] {
  const ids = new Set<string>();
  for (const s of ctx.allSteps) for (const t of s.toolIds ?? []) ids.add(t);
  return [...ids];
}

/**
 * 「막히면 이 사람들에게」 — 이름·전화번호 나열은 쓸모가 없다.
 * 받는 사람에게 필요한 건 **상황 → 사람**이다. 그래서 첫 열이 이름이 아니라 상황이다.
 *
 * 연락처 원문(휴대폰·개인 메일)은 어떤 포맷에도 넣지 않는다. 사내 채널 핸들만.
 * PDF는 메일 첨부로 굴러다니고, 개인 연락처가 붙은 파일이 회사 밖으로 나가는 경로가 된다.
 */
function contactsSection(ctx: Ctx): (Block | null)[] {
  const { gen, flow } = ctx;
  const rows: string[][] = [];

  const owner = ctx.owner;
  if (owner) {
    rows.push([
      gen.raw('이 일 전체에 대해'),
      who(ctx, owner.id),
      [
        owner.channel ? gen.user(owner.channel) : '',
        owner.lastDayLabel ? gen.s`${owner.lastDayLabel}까지 회사에 계세요` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ]);
  }

  const seen = new Set<string>([flow.ownerId]);
  for (const step of flow.steps) {
    const id = step.assigneeId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const p = ctx.person(id);
    if (!p || p.external) continue;
    rows.push([situation(ctx, p.id), who(ctx, id), howToReach(ctx, id)]);
  }

  const externals = flow.people.filter((p) => p.external);
  for (const p of externals) {
    rows.push([
      p.contactFor ? gen.user(p.contactFor) : gen.raw('회사 밖으로 나가는 일'),
      gen.raw('회사 밖 사람이에요'),
      p.relayThread
        ? gen.s`${ctx.owner?.name ?? ''} 님 메일함의 '${p.relayThread}' 스레드를 넘겨받으세요`
        : gen.raw('사내에서 이어받으셔야 해요'),
    ]);
  }

  if (!rows.length) {
    return [
      { kind: 'heading', level: 2, text: gen.raw('막히면 이 사람들에게') },
      { kind: 'lines', lines: [gen.raw('이 일에 누가 나오는지는 아직 안 적혀 있어요.')] },
    ];
  }

  return [
    { kind: 'heading', level: 2, text: gen.raw('막히면 이 사람들에게') },
    { kind: 'table', head: [gen.raw('이런 일이면'), gen.raw('누구'), gen.raw('어떻게')], rows },
    externals.length
      ? {
          kind: 'lines',
          lines: [gen.raw('회사 밖 사람 연락처는 이 문서에 적지 않았어요. 링크로 열면 보실 수 있어요.')],
        }
      : null,
  ];
}

/** 상황은 그 사람이 담당한 단계 번호에서 자동 생성. 조직이 적어둔 게 있으면 그쪽 */
function situation(ctx: Ctx, personId: string): string {
  const p = ctx.person(personId);
  let base = p?.contactFor;
  if (!base) {
    const step = ctx.flow.steps.find((s) => s.assigneeId === personId);
    if (step) base = `${ctx.n.noById.get(step.id)}번 ${step.title}`;
  }
  const text = base ?? '';
  if (p?.decides) return ctx.gen.s`${text}, 그리고 결정이 필요한 일`;
  return ctx.gen.user(text);
}

function who(ctx: Ctx, personId: string): string {
  const p = ctx.person(personId);
  if (!p) return '';
  return [p.name, p.team].filter(Boolean).join(' · ');
}

function howToReach(ctx: Ctx, personId: string): string {
  const p = ctx.person(personId);
  if (!p) return '';
  if (p.inactive) {
    return p.team
      ? ctx.gen.s`이 분은 지금 안 계세요. ${p.team}에 물어보세요.`
      : ctx.gen.raw('이 분은 지금 안 계세요.');
  }
  return p.channel ? ctx.gen.user(p.channel) : '';
}

function lifecycleSection(ctx: Ctx): (Block | null)[] {
  const { gen, flow, opts } = ctx;
  const blocks: (Block | null)[] = [];
  const lines: string[] = [];

  if (flow.startNote) lines.push(gen.user(flow.startNote));
  else if (!flow.cadence) lines.push(gen.raw('언제 시작되는지는 안 적혀 있어요.'));

  const tail = [flow.endNote, flow.spanNote].filter(Boolean) as string[];
  if (tail.length) lines.push(tail.map((t) => gen.user(t)).join(' '));

  if (!lines.length) return [];

  blocks.push({ kind: 'heading', level: 2, text: gen.raw('이 일은 이렇게 시작해서 이렇게 끝나요') });
  blocks.push({ kind: 'lines', lines });

  /* 「시작 전에 받아두실 것」 — `처음이에요` 옵션 + 도구 1개 이상.
   * 가장 실용적인 추가 섹션이다. 권한이 없으면 1번부터 못 하는데,
   * 사람이 쓴 인계 문서에 이게 들어 있는 경우는 거의 없다. */
  const used = new Set(toolsInFlow(ctx));
  const tools = flow.tools.filter((t) => used.has(t.id));
  if (opts.firstTime && tools.length) {
    const rows: string[][] = [];
    for (const t of tools.filter((x) => x.access)) {
      const granter = t.accessGrantedBy ? ctx.personName(t.accessGrantedBy) : undefined;
      rows.push([gen.user(t.name), gen.user(t.access!), granter ?? gen.raw('물어보셔야 해요')]);
    }
    const free = tools.filter((x) => !x.access);
    if (free.length) rows.push([free.map((t) => t.name).join(' · '), gen.raw('따로 없어요'), '']);

    if (rows.length) {
      blocks.push({ kind: 'heading', level: 3, text: gen.raw('시작 전에 받아두실 것') });
      blocks.push({
        kind: 'table',
        head: [gen.raw('쓰는 것'), gen.raw('필요한 것'), gen.raw('누가 열어주나요')],
        rows,
      });
      blocks.push({
        kind: 'lines',
        lines: [gen.raw('권한이 없으면 1번부터 막혀요. 첫날에 먼저 확인하시는 게 좋아요.')],
      });
    }
  }

  return blocks;
}

function stepsSection(ctx: Ctx, handoffs: readonly HandoffPoint[]): (Block | null)[] {
  const { gen, n } = ctx;
  const blocks: (Block | null)[] = [
    { kind: 'heading', level: 2, text: gen.raw('순서대로') },
  ];
  const handoffByStep = new Map(handoffs.map((h) => [h.step.id, h]));

  n.steps.forEach((numbered, i) => {
    const step = numbered.step;
    const prev = i > 0 ? n.steps[i - 1]!.step : undefined;
    const h = handoffByStep.get(step.id);

    if (h) blocks.push(handoffBlock(ctx, h));

    blocks.push({ kind: 'heading', level: 3, text: `${numbered.no}. ${gen.user(step.title)}` });

    const body: string[] = [];
    const link = connective(ctx, { prev, current: step, handoffBefore: Boolean(h) });
    const mark = returnTargetNote(ctx, step);
    if (mark) body.push(mark);

    let trailing: string[] = [];
    let caseBlocks: { heading: string | null; lines: string[] }[] = [];

    if (step.kind === 'hold') {
      const hb = holdBody(ctx, step);
      body.push(...hb.lines);
      trailing = hb.trailing;
      if (step.description) body.push(gen.user(step.description));
    } else if (step.branch) {
      const bb = branchBody(ctx, numbered);
      body.push(...bb.lines);
      caseBlocks = bb.cases;
    } else {
      body.push(...taskBody(ctx, step));
    }

    if (link && body.length) body[0] = `${link} ${body[0]}`;
    if (body.length) blocks.push({ kind: 'lines', lines: body });

    const notes = (step.footnotes ?? []).map((f) => f.text);
    if (notes.length) {
      const paragraphs = [...notes];
      const promoted = (step.footnotes ?? []).some((f) => f.promoted);
      if (promoted) paragraphs.push(gen.s`— ${ctx.owner?.name ?? ''} 님이 덧붙인 말이에요.`);
      blocks.push({ kind: 'quote', paragraphs });
    }

    if (trailing.length) blocks.push({ kind: 'lines', lines: [trailing.join(' ')] });

    for (const cb of caseBlocks) {
      const lines = cb.heading ? [cb.heading, ...cb.lines] : cb.lines;
      if (lines.length) blocks.push({ kind: 'lines', lines });
    }
  });

  return blocks;
}

/**
 * 담당이 바뀌는 지점 (§2.3 f).
 *
 * **문장 안에 섞지 않는다. 줄을 나눠 가로선 블록으로 낸다.**
 * 그리고 되돌아오는 지점도 같은 블록으로 표시한다 — 이게 없으면 받는 사람이
 * 9번 이후를 계속 남의 일로 읽는다.
 *
 * "인계"라는 단어는 본문에 쓰지 않는다. 제목에만 쓴다.
 */
function handoffBlock(ctx: Ctx, h: HandoffPoint): Block {
  const { gen } = ctx;
  const p = ctx.person(h.step.assigneeId);
  const name = p?.name ?? '';
  const lines: string[] = [];

  if (h.returning) {
    lines.push(gen.s`**${E(h.no)}번부터 다시 ${name} 님 일이에요.**`);
  } else if (p?.team) {
    lines.push(gen.s`**여기서부터 ${name} 님(${p.team})${E(subjectParticle(p.team))} 해요.**`);
  } else {
    lines.push(gen.s`**여기서부터 ${name} 님이 해요.**`);
  }

  if (!h.returning) {
    if (h.step.handoffPayload) {
      lines.push(gen.s`넘길 것: ${h.step.handoffPayload}`);
    } else if (h.crossDept) {
      // 부서를 넘는데 넘길 것이 없다 — 위험 결핍
      const owner = ctx.owner?.name;
      lines.push(
        owner
          ? gen.s`넘길 것이 뭔지는 아직 안 적혀 있어요. ${owner} 님께 물어보세요.`
          : gen.raw('넘길 것이 뭔지는 아직 안 적혀 있어요.'),
      );
    }
  }

  return { kind: 'handoff', lines, newPerson: !h.returning };
}

function exceptionsSection(ctx: Ctx): (Block | null)[] {
  const { gen, n } = ctx;
  const footnoteItems: string[] = [];
  for (const numbered of n.steps) {
    for (const f of numbered.step.footnotes ?? []) {
      // 승격된 노트는 예외가 아니라 **소유자가 덧붙인 말**이다.
      // 목록에 섞으면 "이 사람이 적어둔 예외"가 몇 개인지가 흐려진다
      if (f.promoted) continue;
      const summary = f.summary ?? f.text;
      const odds =
        typeof f.oddsOutOfTen === 'number' ? gen.s` (10번에 ${f.oddsOutOfTen}번쯤)` : '';
      footnoteItems.push(`${gen.s`**${E(numbered.no)}번** — `}${gen.user(summary)}${odds}`);
    }
  }

  const returns: string[] = [];
  for (const numbered of n.steps) {
    for (const nc of numbered.cases) {
      const item = returnListItem(ctx, nc);
      if (item) returns.push(item);
    }
  }

  if (!footnoteItems.length && !returns.length) {
    return [
      { kind: 'heading', level: 2, text: gen.raw('이렇게 안 흘러갈 때') },
      {
        kind: 'lines',
        lines: [
          gen.raw('적어둔 예외가 없어요. 없는 게 아니라 아직 안 적었을 가능성이 커요.'),
          gen.raw('하시면서 생기는 건 여기에 적어두세요.'),
        ],
      },
    ];
  }

  const blocks: (Block | null)[] = [
    { kind: 'heading', level: 2, text: gen.raw('이렇게 안 흘러갈 때') },
  ];
  if (footnoteItems.length) {
    blocks.push({
      kind: 'lines',
      lines: [gen.s`적어두신 게 ${E(countWord(footnoteItems.length, '가지'))} 있어요.`],
    });
    blocks.push({ kind: 'bullets', items: footnoteItems });
  }
  if (returns.length) {
    blocks.push({
      kind: 'lines',
      lines: [gen.s`되돌아가는 곳은 ${E(countWord(returns.length, '군데'))}예요.`],
    });
    blocks.push({ kind: 'bullets', items: returns });
  }
  blocks.push({
    kind: 'lines',
    lines: [gen.raw('하시다가 새로 겪는 게 있으면 여기에 적어두세요. 다음 분이 덜 헤매요.')],
  });
  return blocks;
}

function neighborsSection(ctx: Ctx): (Block | null)[] {
  const { gen, flow } = ctx;
  const c = flow.connections;
  if (!c) return [];
  const items: string[] = [];
  if (c.before) items.push(`${gen.raw('**앞** — ')}${gen.user(c.before)}`);
  if (c.after) items.push(`${gen.raw('**뒤** — ')}${gen.user(c.after)}`);
  if (c.middle) items.push(`${gen.raw('**중간** — ')}${gen.user(c.middle)}`);
  if (!items.length) return [];
  return [
    { kind: 'heading', level: 2, text: gen.raw('앞뒤로 이어지는 일') },
    { kind: 'bullets', items },
  ];
}

/**
 * 용어표 (§2.3 b).
 *
 * 못 푼 말은 **본문에서 건드리지 않는다.** 용어표에 `아직 안 풀렸어요`로 넣지 않고
 * 「물어보셔야 해요」로 보낸다. 풀이 대상이 1개 이하면 섹션 자체를 생략한다.
 */
function glossarySection(ctx: Ctx): (Block | null)[] {
  const { gen, flow } = ctx;
  const isAbbr = (t: string): boolean => /^[A-Z]{2,5}$/.test(t);
  const entries = flow.glossary ?? [];
  const terms = entries.filter((e) => !isAbbr(e.term));
  const abbrs = entries.filter((e) => isAbbr(e.term));

  const used = new Set(toolsInFlow(ctx));
  const toolRows = flow.tools
    .filter((t) => used.has(t.id) && t.description)
    .map((t) => [gen.user(t.name), gen.user(t.description!)]);

  const rows = [
    ...terms.map((e) => [gen.user(e.term), gen.user(e.meaning)]),
    ...toolRows,
    ...abbrs.map((e) => [gen.user(e.term), gen.user(e.meaning)]),
  ];
  if (rows.length < 2) return [];

  return [
    { kind: 'heading', level: 2, text: gen.raw('이 문서에 나오는 말들') },
    { kind: 'table', head: [gen.raw('말'), gen.raw('뜻')], rows },
  ];
}

function questionsSection(ctx: Ctx, gaps: readonly Gap[]): (Block | null)[] {
  const { gen } = ctx;
  if (!gaps.length) return []; // 결핍 0개면 섹션 생략. 축하 문구는 넣지 않는다
  return [
    { kind: 'heading', level: 2, text: gen.raw('이건 물어보셔야 해요') },
    {
      kind: 'lines',
      lines: [gen.s`이 문서에 안 적힌 것들이에요. ${E(countWord(gaps.length, '개'))}예요.`],
    },
    {
      kind: 'table',
      head: [gen.raw('무엇'), gen.raw('누구에게')],
      rows: gaps.map((g) => [g.question, g.askWho]),
    },
    {
      kind: 'lines',
      lines: [gen.raw('여쭤보고 나서 이 흐름에 적어두시면, 다음 분은 안 물어봐도 돼요.')],
    },
  ];
}

/**
 * 마지막 표는 본문의 요약이 아니라 **보완**이다 (§6.2).
 * 존재 이유가 "다이어그램에서 의도적으로 숨긴 정보의 회수"이므로
 * 본문에 없는 것(빈도·타임아웃·되돌아감 대상·결핍 표시)이 마지막 열에 들어간다.
 */
function stepTableSection(ctx: Ctx, handoffs: readonly HandoffPoint[]): (Block | null)[] {
  const { gen, flow, n } = ctx;
  const rows: string[][] = [];
  const handoffByStep = new Map(handoffs.map((h) => [h.step.id, h]));
  const NOT_WRITTEN = '안 적혀 있어요';

  const returnSources = new Map<string, string[]>();
  for (const numbered of n.steps) {
    for (const nc of numbered.cases) {
      const t = nc.spec.returnTo?.toStepId;
      if (!t) continue;
      const list = returnSources.get(t) ?? [];
      list.push(nc.no);
      returnSources.set(t, list);
    }
  }

  n.steps.forEach((numbered, i) => {
    const step = numbered.step;
    const last = i === n.steps.length - 1;
    rows.push([
      numbered.no,
      gen.user(step.title),
      assigneeCell(ctx, step, handoffByStep.get(step.id)?.returning === false),
      (step.toolIds ?? []).map((t) => ctx.toolName(t)).join(', '),
      durationCell(ctx, step, NOT_WRITTEN),
      otherCell(ctx, numbered, handoffByStep.get(step.id), returnSources.get(step.id), last, i === 0),
    ]);

    for (const nc of numbered.cases) {
      const inner = nc.steps[0]?.step;
      const label = inner ? inner.title : (nc.spec.label ?? '');
      rows.push([
        nc.no,
        gen.user(label),
        inner ? (ctx.personName(inner.assigneeId) ?? '') : '',
        inner ? (inner.toolIds ?? []).map((t) => ctx.toolName(t)).join(', ') : '',
        inner ? durationCell(ctx, inner, NOT_WRITTEN) : '',
        caseOtherCell(ctx, nc),
      ]);
    }
  });

  void flow;
  return [
    { kind: 'heading', level: 2, text: gen.raw('단계별로 한눈에') },
    {
      kind: 'table',
      head: [
        gen.raw('#'),
        gen.raw('단계'),
        gen.raw('누가'),
        gen.raw('뭘로'),
        gen.raw('한 번에'),
        gen.raw('그 밖에'),
      ],
      rows,
    },
    {
      kind: 'lines',
      lines: [
        gen.raw(
          '**표 보는 법** — `기다림`은 사람이 손을 대는 게 아니라 흐름이 멈춰 있는 구간이에요. ' +
            '굵게 된 이름은 담당이 바뀌는 곳이에요. `안 적혀 있어요`는 아직 안 쓴 곳이에요.',
        ),
      ],
    },
  ];
}

function assigneeCell(ctx: Ctx, step: Step, bold: boolean): string {
  if (step.kind === 'hold') return '—'; // 사람이 없는 게 맞는 자리다. 빈칸(모름)과 구분한다
  const name = ctx.personName(step.assigneeId);
  if (!name) return '';
  return bold ? `**${name}**` : name;
}

function durationCell(ctx: Ctx, step: Step, notWritten: string): string {
  if (step.kind === 'hold') {
    const h = step.hold?.avgWaitH;
    return typeof h === 'number'
      ? ctx.gen.s`기다림 ${E(waitCompact(h))}`
      : ctx.gen.s`기다림 · ${E(notWritten)}`;
  }
  if (step.durationBand) return BAND_LABEL[step.durationBand] ?? '';
  return ctx.gen.raw(notWritten);
}

function otherCell(
  ctx: Ctx,
  numbered: NumberedStep,
  handoff: HandoffPoint | undefined,
  returnFrom: string[] | undefined,
  last: boolean,
  first: boolean,
): string {
  const { gen, flow } = ctx;
  const step = numbered.step;

  if (handoff && !handoff.returning) return gen.raw('담당이 바뀌어요');
  if (first && flow.cadence?.tableLabel) return gen.user(flow.cadence.tableLabel);
  if (returnFrom?.length) return gen.s`${E(returnFrom.join('·'))}에서 여기로 돌아와요`;
  if (step.branch) return branchNote(ctx, step) ?? '';
  const timeout = holdTimeoutCompact(ctx, step);
  if (timeout) return gen.user(timeout);
  if (step.hold?.waitFor === 'approval' && !step.hold.rejectToStepId) {
    return gen.raw('다시 하라면 어디로 가는지 안 적혀 있어요');
  }
  if (last) return gen.raw('여기서 끝이에요');
  return '';
}

function caseOtherCell(ctx: Ctx, nc: { spec: import('../types.ts').CaseSpec }): string {
  const { gen } = ctx;
  const parts: string[] = [];
  const ret = nc.spec.returnTo?.toStepId;
  const join = nc.spec.joinToStepId;
  if (ret) {
    const no = ctx.n.noById.get(ret);
    if (no) parts.push(gen.s`${E(no)}번으로`);
  } else if (join) {
    const no = ctx.n.noById.get(join);
    if (no) parts.push(gen.s`${E(no)}번으로`);
  } else if (nc.spec.endsHere) {
    parts.push(gen.raw('여기서 끝이에요'));
  }
  if (nc.spec.perMonth) {
    parts.push(gen.s`월 ${nc.spec.perMonth.min}~${nc.spec.perMonth.max}건`);
  }
  return parts.join(' · ');
}

/**
 * 부록 (§2.3 c · §4.6).
 *
 * 갈래 안이 5단계 이상이거나 3단 중첩이면 **본문에서 뺀다.** 본문은 선형이어야
 * 하고, 3단을 넘어가는 번호는 소리 내어 부를 수 없다. 부를 수 없는 번호는
 * 만들지 않는다 — 인계는 문서만으로 안 끝나고 반드시 대화가 따라온다.
 */
function appendixSection(ctx: Ctx): (Block | null)[] {
  const { gen, n } = ctx;
  if (!n.appendix.length) return [];
  const blocks: (Block | null)[] = [];
  for (const nc of n.appendix) {
    const cond = nc.spec.condition ?? nc.spec.label ?? '';
    blocks.push({
      kind: 'heading',
      level: 2,
      text: cond ? gen.s`${E(nc.appendixNo ?? '부록')}. ${cond}` : gen.s`${E(nc.appendixNo ?? '부록')}`,
    });
    blocks.push({ kind: 'lines', lines: [gen.s`${E(nc.no)}에서 이어지는 경우예요.`] });
    const lines = caseLines(ctx, { ...nc, toAppendix: false });
    if (lines.length) blocks.push({ kind: 'lines', lines });
  }
  return blocks;
}

/**
 * 푸터.
 *
 * 첫 줄은 **옵션이 아니다. 항상 나간다** (§10.2 — 거짓 완결감).
 * 문서가 그럴듯하면 작성자가 "다 됐다"고 믿고 실제로 필요한 대화를 안 한다.
 * 그리고 전임자 재직 기한을 붙인다 — 시한이 보이면 사람은 약속을 잡는다.
 */
function footerSection(ctx: Ctx): (Block | null)[] {
  const { gen, flow, opts } = ctx;
  const lines: string[] = [gen.raw('이 문서로 다 되진 않아요. 한 번은 같이 해보시는 게 제일 빨라요.')];
  const owner = ctx.owner;
  if (owner?.lastDayLabel) {
    lines.push(gen.s`${owner.name} 님은 ${owner.lastDayLabel}까지 회사에 계세요.`);
  }
  const d = flow.asOf;
  return [
    { kind: 'lines', lines },
    {
      kind: 'lines',
      lines: [
        gen.s`${E(d.year)}년 ${E(d.month)}월 ${E(d.day)}일에 ${owner?.name ?? ''} 님이 정리한 흐름으로 만들었어요.`,
      ],
    },
    { kind: 'lines', lines: [opts.brand] },
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 검사
 * ──────────────────────────────────────────────────────────────────────────── */

function assertNoOrphanReferences(ctx: Ctx): void {
  const ids = new Set(ctx.allSteps.map((s) => s.id));
  const check = (target: string | undefined, from: string): void => {
    if (target && !ids.has(target)) {
      throw new DocIntegrityError(`${from}가 없는 단계 '${target}'을 가리킵니다.`);
    }
  };
  for (const s of ctx.flow.steps) {
    check(s.hold?.escalation?.toStepId, `${s.id}의 재촉 행선지`);
    check(s.hold?.rejectToStepId, `${s.id}의 반려 행선지`);
    for (const c of s.branch?.cases ?? []) {
      check(c.returnTo?.toStepId, `${c.id}의 되돌아감`);
      check(c.joinToStepId, `${c.id}의 합류`);
    }
  }
}

function countHandoffBlocks(doc: DocTree): number {
  let n = 0;
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === 'handoff') n++;
  return n;
}

function collectChecks(
  ctx: Ctx,
  gaps: readonly Gap[],
  out: Check[],
  steps: readonly NumberedStep[],
): void {
  for (const g of gaps) {
    const map: Partial<Record<Gap['kind'], Check['code']>> = {
      'handoff-payload': 'handoff-payload-missing',
      'hold-wait': 'hold-wait-missing',
      'branch-criterion': 'branch-criteria-missing',
      'approval-return': 'approval-return-missing',
      term: 'term-unresolved',
    };
    const code = map[g.kind];
    if (code) {
      out.push({
        code,
        severity: g.risky ? 'warn' : 'note',
        message: g.question,
        ...(g.stepNo ? { stepNo: g.stepNo } : {}),
      });
    }
  }
  for (const s of steps) {
    if (s.step.title.trim().length < 6) {
      out.push({
        code: 'short-title',
        severity: 'note',
        message: `${s.no}번 제목이 짧아요.`,
        stepNo: s.no,
      });
    }
  }
  void ctx;
}

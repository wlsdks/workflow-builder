/**
 * packages/doc-gen/src/render/onepager.ts
 *
 * 내 업무 한 장 요약 (§1.1).
 *
 * 독자가 **이 일을 하지 않는다**는 점이 인계 문서와의 결정적 차이다.
 * 팀장과의 1on1, 또는 나 자신. 목적은 실행이 아니라 **대화 재료**다.
 * 그래서 단계 상세가 없고, 대신 "어디가 멈춰 있는가"와 "누가 얽혀 있는가"만 남는다.
 *
 * ★ 숫자 밑에 고정 문구가 반드시 붙는다 (WRITING §9) —
 *   `이 숫자는 많고 적음을 뜻하지 않아요.`
 *   이 한 줄이 없으면 요약 카드는 그 순간 평가표가 된다.
 */

import { E } from '../audit.ts';
import { makeCtx } from '../ctx.ts';
import { handoffPoints } from '../gaps.ts';
import { assertCleanTree, assertNoPrivateFields } from '../guard.ts';
import { BAND_HOURS, waitPhrase } from '../lang.ts';
import type { Block, DocTree, FlowInput, GenOptions, Section } from '../types.ts';

export function generateOnepager(flow: FlowInput, options: GenOptions = {}): DocTree {
  assertNoPrivateFields(flow, 'flow');
  const ctx = makeCtx(flow, options);
  const { gen } = ctx;
  const handoffs = handoffPoints(ctx);

  const sections: Section[] = [];
  const push = (id: Section['id'], blocks: (Block | null)[]): void => {
    const clean = blocks.filter((b): b is Block => b !== null);
    if (clean.length) sections.push({ id, blocks: clean });
  };

  const people = new Set<string>();
  const tools = new Set<string>();
  let touch = 0;
  let wait = 0;
  for (const s of ctx.allSteps) {
    if (s.assigneeId) people.add(s.assigneeId);
    for (const t of s.toolIds ?? []) tools.add(t);
    if (s.durationBand) touch += BAND_HOURS[s.durationBand] ?? 0;
    if (typeof s.hold?.avgWaitH === 'number') wait += s.hold.avgWaitH;
  }

  push('title', [
    { kind: 'heading', level: 1, text: gen.s`'${flow.title}' — 지금 모습` },
    {
      kind: 'lines',
      lines: [
        [flow.deptLabel, flow.cadence?.label, ctx.owner ? `${ctx.owner.name} 님` : '']
          .filter(Boolean)
          .join(' · '),
      ],
    },
  ]);

  push('summary', [
    {
      kind: 'bullets',
      items: [
        gen.s`단계 ${E(flow.steps.length)}개`,
        gen.s`관여하는 사람 ${E(people.size)}명`,
        gen.s`쓰는 도구 ${E(tools.size)}개`,
        gen.s`담당이 바뀌는 곳 ${E(handoffs.length)}번`,
        gen.s`기다리는 시간 합쳐서 ${E(waitPhrase(wait))}`,
      ],
    },
    {
      kind: 'lines',
      lines: [
        gen.raw('이 숫자는 많고 적음을 뜻하지 않아요.'),
        gen.raw('같은 일을 하는 사람끼리 말을 맞출 때 쓰는 좌표예요.'),
      ],
    },
  ]);

  if (flow.hardestPart) {
    push('hardest', [
      { kind: 'heading', level: 2, text: gen.raw('제일 조심할 곳') },
      { kind: 'quote', paragraphs: [flow.hardestPart] },
    ]);
  }

  /* 멈춰 있는 구간 — 대화가 실제로 붙는 곳이다 */
  const holds = ctx.n.steps.filter((s) => s.step.kind === 'hold');
  if (holds.length) {
    push('exceptions', [
      { kind: 'heading', level: 2, text: gen.raw('흐름이 멈춰 있는 구간') },
      {
        kind: 'bullets',
        items: holds.map((h) => {
          const w = h.step.hold?.avgWaitH;
          return typeof w === 'number'
            ? `${gen.s`**${E(h.no)}번** ${h.step.title} — `}${gen.s`${E(waitPhrase(w))}`}`
            : `${gen.s`**${E(h.no)}번** ${h.step.title} — `}${gen.raw('얼마나 걸리는지는 아직 안 적혀 있어요')}`;
        }),
      },
    ]);
  }

  const returns = ctx.n.steps.flatMap((s) =>
    s.cases
      .filter((c) => c.spec.returnTo)
      .map((c) => {
        const to = ctx.n.noById.get(c.spec.returnTo!.toStepId);
        return gen.s`**${E(c.no)}**에서 **${E(to ?? '')}번으로**`;
      }),
  );
  if (returns.length) {
    push('neighbors', [
      { kind: 'heading', level: 2, text: gen.raw('되돌아가는 곳') },
      { kind: 'bullets', items: returns },
    ]);
  }

  push('footer', [
    {
      kind: 'lines',
      lines: [
        gen.s`${E(flow.asOf.year)}년 ${E(flow.asOf.month)}월 ${E(flow.asOf.day)}일 기준이에요.`,
        ctx.opts.brand,
      ],
    },
  ]);

  const doc: DocTree = {
    docKind: 'onepager',
    title: flow.title,
    sections,
    meta: {
      stepCount: flow.steps.length,
      peopleCount: people.size,
      toolCount: tools.size,
      handoffCount: handoffs.length,
      touchHours: touch,
      waitHours: wait,
      readingMinutes: 1,
    },
    audit: {
      sentences: gen.records.map((r) => r.text),
      engineParts: gen.records.map((r) => r.engine),
      longSentences: [],
    },
    checks: [],
  };
  assertCleanTree(doc);
  return doc;
}

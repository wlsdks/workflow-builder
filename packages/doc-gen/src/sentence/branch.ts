/**
 * packages/doc-gen/src/sentence/branch.ts
 *
 * 슬롯 문법 — `branch` (§4.3) 와 재작업 루프 (§2.3 e).
 *
 * **원칙: 문서는 선형이다.** 다이어그램은 위치를 보여주지만 문서는 "지금 뭘 해야 하나"에
 * 답한다. 트리 구조는 읽는 사람의 위치 감각을 파괴한다. 그래서 갈래는 소제목 + 들여쓴
 * 블록으로만 나오고, 5단계 이상이거나 3단 중첩이면 본문에서 빼서 부록으로 보낸다.
 *
 * 각주와 갈래는 문서에서 **다르게 생겼다.** 갈래는 "고르는 것"이라 소제목이 되고,
 * 각주는 "가끔 벌어지는 것"이라 인용문이 된다. 받는 사람이 이 둘을 헷갈리면 안 된다.
 */

import { E } from '../audit.ts';
import type { Ctx } from '../ctx.ts';
import { BAND_HOURS, countWord, objectParticle, toCondition } from '../lang.ts';
import type { CaseSpec, Step } from '../types.ts';
import type { NumberedCase, NumberedStep } from './number.ts';
import { metaSentences } from './task.ts';

/**
 * 갈래 안에서는 **시간이 적혀 있을 때만** 메타 문장을 붙인다.
 *
 * 갈래는 곁가지다. 거기에 "이수진 님이 슬랙으로 해요"만 덜렁 붙으면 본선의 리듬을
 * 끊는 값만 하고 정보는 없다. §2.1의 7-가(시간 있음)에는 붙고 10-나(시간 없음)에는
 * 안 붙는 것이 이 규칙에서 나온다.
 */
const CASE_META_NEEDS_TIME = true;

const SENTENCE_END = /[.?]\s*$/;

export type CaseBlock = { heading: string | null; lines: string[] };

export type BranchBody = {
  /** META + 갈래 도입 */
  lines: string[];
  cases: CaseBlock[];
};

export function branchBody(ctx: Ctx, numbered: NumberedStep): BranchBody {
  const { gen } = ctx;
  const step = numbered.step;
  const branch = step.branch;
  const lines: string[] = [];
  const cases: CaseBlock[] = [];
  if (!branch) return { lines, cases };

  const meta = metaSentences(ctx, step, { verb: '봐요' });
  if (meta.length) lines.push(meta.join(' '));

  /* ── 갈래 도입 ─────────────────────────────────────────────────────── */
  const desc = step.description;
  if (branch.mode === 'and') {
    lines.push(
      gen.s`이 ${E(branch.cases.length)}가지를 같이 해요. 하나라도 안 끝나면 다음으로 못 가요.`,
    );
  } else if (branch.mode === 'skip') {
    const first = branch.cases[0];
    const cond = first ? conditionOf(first) : null;
    const to = firstJoinNo(ctx, branch.cases);
    if (cond && to) lines.push(gen.s`${cond}이면 이 부분은 안 해도 돼요. ${E(to)}번으로 바로 가요.`);
    else if (cond) lines.push(gen.s`${cond}이면 이 부분은 안 해도 돼요.`);
  } else if (desc) {
    lines.push(gen.s`${desc}, 여기서 갈려요.`);
  } else {
    lines.push(gen.raw('여기서 갈려요.'));
  }

  // 판단 기준이 전부 비면 **위험 결핍** — 없으면 실행이 불가능하다
  const anyLabel = branch.cases.some((c) => c.label || c.condition);
  if (!anyLabel) lines.push(gen.raw('여기서 뭘 보고 갈리는지는 아직 안 적혀 있어요.'));

  /* ── 케이스 ────────────────────────────────────────────────────────── */
  for (const nc of numbered.cases) {
    if (nc.toAppendix) {
      cases.push({
        heading: caseHeading(ctx, nc),
        lines: [ctx.gen.s`이 경우는 뒤에 따로 적었어요 → ${E(nc.appendixNo ?? '부록')}`],
      });
      continue;
    }
    cases.push({ heading: caseHeading(ctx, nc), lines: caseLines(ctx, nc) });
  }

  return { lines, cases };
}

function conditionOf(spec: CaseSpec): string | null {
  if (spec.condition) return spec.condition;
  if (spec.label) return toCondition(spec.label);
  return null;
}

function caseHeading(ctx: Ctx, nc: NumberedCase): string {
  const cond = conditionOf(nc.spec);
  return cond ? ctx.gen.s`**${E(nc.no)}. ${cond}**` : ctx.gen.s`**${E(nc.no)}.**`;
}

function firstJoinNo(ctx: Ctx, cases: readonly CaseSpec[]): string | null {
  for (const c of cases) {
    const to = c.joinToStepId ? ctx.n.noById.get(c.joinToStepId) : undefined;
    if (to) return to;
  }
  return null;
}

/**
 * 되돌아가는 구간이 서로 겹치는가 (A→B→A).
 *
 * 겹치면 갈래 안에서 문장으로 쓰지 않고 「이렇게 안 흘러갈 때」의
 * **되돌아가는 곳 목록에서만** 다룬다. 문장으로 쓰면 반드시 헷갈린다 —
 * "4번으로 돌아가서" 다음에 "6번으로 돌아가서"가 나오면 독자는 지금 자기가
 * 어느 바퀴를 돌고 있는지 알 수 없다.
 */
export function overlappingReturnCases(ctx: Ctx): Set<string> {
  const steps = ctx.flow.steps;
  const idx = new Map(steps.map((s, i) => [s.id, i]));
  const ranges: { caseId: string; from: number; to: number }[] = [];
  steps.forEach((s, i) => {
    for (const c of s.branch?.cases ?? []) {
      const from = c.returnTo ? idx.get(c.returnTo.toStepId) : undefined;
      if (from === undefined) continue;
      ranges.push({ caseId: c.id, from, to: i });
    }
  });
  const out = new Set<string>();
  for (let a = 0; a < ranges.length; a++) {
    for (let b = a + 1; b < ranges.length; b++) {
      const x = ranges[a]!;
      const y = ranges[b]!;
      if (x.from <= y.to && y.from <= x.to) {
        out.add(x.caseId);
        out.add(y.caseId);
      }
    }
  }
  return out;
}

export function caseLines(ctx: Ctx, nc: NumberedCase): string[] {
  const { gen } = ctx;
  const out: string[] = [];
  const spec = nc.spec;
  const inner = nc.steps;

  if (inner.length === 1 && !inner[0]!.step.branch) {
    out.push(...singleStepCase(ctx, inner[0]!, spec));
  } else if (inner.length >= 1) {
    for (const sub of inner) {
      out.push(gen.s`**${E(sub.no)}. ${sub.step.title}**`);
      if (sub.step.branch) {
        const nested = branchBody(ctx, sub);
        out.push(...nested.lines);
        for (const cb of nested.cases) {
          if (cb.heading) out.push(cb.heading);
          out.push(...cb.lines);
        }
      } else {
        const meta = metaSentences(ctx, sub.step);
        if (meta.length) out.push(meta.join(' '));
        if (sub.step.description) out.push(...sub.step.description.split('\n'));
      }
    }
    const ret = returnLine(ctx, spec, false);
    if (ret) out.push(ret);
  } else {
    const to = spec.joinToStepId ? ctx.n.noById.get(spec.joinToStepId) : undefined;
    if (to) out.push(gen.s`${E(to)}번으로 가요.`);
    else if (spec.endsHere) out.push(gen.raw('여기서 끝이에요.'));
    const ret = returnLine(ctx, spec, false);
    if (ret) out.push(ret);
  }

  const tail = reworkTail(ctx, spec);
  if (tail) out.push(tail);
  return out;
}

/**
 * 갈래 안이 1단계일 때.
 *
 * 소유자 설명이 문장으로 끝나면(`…물어봐요.`) 되돌아감을 **다음 줄**로 내리고,
 * 연결어미로 끝나면(`…요청하고`) **같은 줄에 이어 붙이고** 짧은 형태를 쓴다.
 * 같은 신호가 줄바꿈과 문형을 동시에 정한다 — 규칙이 둘이면 어긋난다.
 */
function singleStepCase(ctx: Ctx, sub: NumberedStep, spec: CaseSpec): string[] {
  const { gen } = ctx;
  const step = sub.step;
  const out: string[] = [];

  const showMeta = !CASE_META_NEEDS_TIME || Boolean(step.durationBand);
  const meta = showMeta ? metaSentences(ctx, step) : [];
  const desc = step.description;
  const flowsOn = Boolean(desc) && !SENTENCE_END.test(desc!);

  const head: string[] = [];
  if (desc) head.push(gen.user(desc));
  if (meta.length) head.push(meta.join(' '));

  if (flowsOn) {
    const ret = returnLine(ctx, spec, true);
    out.push([...head, ret].filter(Boolean).join(' '));
    return out;
  }

  if (head.length) out.push(head.join(' '));
  const ret = returnLine(ctx, spec, false);
  if (ret) out.push(ret);
  return out;
}

/** `**4번으로 돌아가서** 다시 맞춰봐요.` / `**9번으로 돌아가요.**` */
function returnLine(ctx: Ctx, spec: CaseSpec, short: boolean): string {
  const { gen } = ctx;
  const ret = spec.returnTo;
  if (!ret) return '';
  if (overlappingReturnCases(ctx).has(spec.id)) return '';
  const no = ctx.n.noById.get(ret.toStepId);
  if (!no) return '';

  if (short) return gen.s`**${E(no)}번으로 돌아가요.**`;
  if (ret.tail) {
    return ret.lead
      ? gen.s`${ret.lead} **${E(no)}번으로 돌아가서** ${ret.tail}.`
      : gen.s`**${E(no)}번으로 돌아가서** ${ret.tail}.`;
  }
  const title = ctx.n.titleById.get(ret.toStepId);
  if (!title) return gen.s`**${E(no)}번으로 돌아가요.**`;
  return gen.s`**${E(no)}번으로 돌아가서** ${title}${E(objectParticle(title))} 다시 해요.`;
}

/** `한 달에 3~6건쯤 있어요. 이렇게 되면 하루쯤 더 걸려요.` */
function reworkTail(ctx: Ctx, spec: CaseSpec): string | null {
  const { gen } = ctx;
  const parts: string[] = [];
  if (spec.perMonth) {
    // 숫자는 사용자가 적은 것이다. 엔진이 만든 숫자가 아니다 (D-063)
    parts.push(gen.s`한 달에 ${spec.perMonth.min}~${spec.perMonth.max}건쯤 있어요.`);
  }
  /* 추가 기간 문장은 **빈도 문장에 업혀 간다.**
   * `이렇게 되면`이 가리키는 대상이 앞 문장이라서, 빈도가 없으면
   * 이 문장은 무엇에 대한 추가인지 알 수 없는 숫자만 남긴다. */
  const extra = spec.perMonth ? loopExtraHours(ctx, spec) : null;
  if (extra !== null) {
    parts.push(gen.s`이렇게 되면 ${E(extraSpanPhrase(extra, ctx.opts.touchHoursPerDay))}쯤 더 걸려요.`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** 되돌아가는 구간(대상 단계 ~ 갈래 단계)의 소요시간 합. 적힌 것이 없으면 null */
function loopExtraHours(ctx: Ctx, spec: CaseSpec): number | null {
  const ret = spec.returnTo;
  if (!ret) return null;
  const steps = ctx.flow.steps;
  const from = steps.findIndex((s) => s.id === ret.toStepId);
  const to = steps.findIndex((s) => (s.branch?.cases ?? []).some((c) => c.id === spec.id));
  if (from < 0 || to < 0 || to < from) return null;
  let sum = 0;
  let any = false;
  for (let i = from; i <= to; i++) {
    const band = steps[i]!.durationBand;
    if (band) {
      sum += BAND_HOURS[band] ?? 0;
      any = true;
    }
  }
  return any ? sum : null;
}

function extraSpanPhrase(hours: number, perDay: number): string {
  if (hours <= perDay / 2) return '반나절';
  if (hours <= perDay * 1.5) return '하루';
  return `${Math.round(hours / perDay)}일`;
}

/** 「이렇게 안 흘러갈 때」의 되돌아가는 곳 목록 한 줄 */
export function returnListItem(ctx: Ctx, nc: NumberedCase): string | null {
  const ret = nc.spec.returnTo;
  if (!ret) return null;
  const to = ctx.n.noById.get(ret.toStepId);
  if (!to) return null;
  const head = ctx.gen.s`**${E(nc.no)}**에서 **${E(to)}번으로**`;
  if (nc.spec.perMonth) {
    return ctx.gen.s`${E(head)} — 한 달에 ${nc.spec.perMonth.min}~${nc.spec.perMonth.max}건`;
  }
  return head;
}

/** 갈래가 몇 개짜리인지 — 「단계별로 한눈에」의 `둘 중 하나로 갈려요` */
export function branchNote(ctx: Ctx, step: Step): string | null {
  const n = step.branch?.cases.length ?? 0;
  if (n < 2) return null;
  if (n === 2) return ctx.gen.raw('둘 중 하나로 갈려요');
  return ctx.gen.s`${E(countWord(n, '가지'))} 중 하나로 갈려요`;
}

/**
 * packages/doc-gen/src/sentence/task.ts
 *
 * 슬롯 문법 — `task` (§4.1).
 *
 *     META = [WHO] [TOOL] [TIME] [FREQ]
 *
 * ★ 엔진은 **서술하지 않고 주석을 단다** (§4.0 ②).
 *   단계 제목은 원문 그대로 소제목이 되고, 그 아래에 메타데이터만으로 만든
 *   문장이 붙는다. "이 단계는 ~하는 일입니다"를 지어내지 않는다 — 지어내면 반드시 틀린다.
 *
 * 25자 규칙(WRITING §1)을 지키려고 **두 문장으로 나눈다.**
 * 그리고 이 "문장 개수가 데이터에 따라 달라지는 것"이 §4.5가 말한 리듬의 정체다.
 * 어미를 로테이션하지 않는다.
 */

import { E } from '../audit.ts';
import type { Ctx } from '../ctx.ts';
import { BAND_LABEL, instrumentParticle, objectParticle } from '../lang.ts';
import type { Step } from '../types.ts';

/** 도구 목록 문자열. 1~3개는 나열, 4개 이상은 접는다 */
export function toolPhrase(ctx: Ctx, step: Step): { text: string; tail: string } | null {
  const ids = step.toolIds ?? [];
  if (ids.length === 0) return null;
  const names = ids.map((id) => ctx.toolName(id));
  if (names.length <= 3) {
    const text = names.join('·');
    return { text, tail: names[names.length - 1]! };
  }
  const head = `${names[0]}·${names[1]}`;
  return { text: `${head} 등 ${names.length}가지`, tail: '가지' };
}

export type MetaOptions = {
  /** `task`는 해요, `branch`는 봐요. 문형이 타입마다 다른 것이 §4.5의 두 번째 장치다 */
  verb?: string;
};

/**
 * 결합표(§4.1)를 그대로 구현한다.
 * WHO·TOOL·TIME이 전부 없으면 **문장이 없다.** 제목만 남는다 —
 * 빈 자리를 "안 적혀 있어요"로 채우지 않는다. 그건 부끄러운 결핍이다 (§5.1).
 */
export function metaSentences(ctx: Ctx, step: Step, options: MetaOptions = {}): string[] {
  const { gen } = ctx;
  const verb = options.verb ?? '해요';
  const who = ctx.personName(step.assigneeId);
  const tools = toolPhrase(ctx, step);
  const band = step.durationBand ? BAND_LABEL[step.durationBand] : undefined;

  const out: string[] = [];

  if (who && tools) {
    out.push(gen.s`${who} 님이 ${tools.text}${E(instrumentParticle(tools.tail))} ${E(verb)}.`);
  } else if (who) {
    out.push(gen.s`${who} 님이 ${E(verb)}.`);
  } else if (tools) {
    out.push(gen.s`${tools.text}${E(objectParticle(tools.tail))} 써요.`);
  }

  if (band) out.push(gen.s`한 번에 ${E(band)}쯤 걸려요.`);

  // FREQ — 전 단계에 빈도를 쓰면 소음이 된다. 흐름 평균의 두 배를 넘을 때만.
  const freq = step.freqLast7d;
  if (typeof freq === 'number' && ctx.avgFreq > 0 && freq >= ctx.avgFreq * 2) {
    out.push(gen.s`이건 지난주에 ${E(freq)}번 했어요.`);
  }

  return out;
}

/**
 * 단계 본문 한 덩어리.
 *   1줄차: META (두 문장까지)
 *   2줄차: 소유자가 적어둔 설명 — **있을 때만.** 원문 그대로, 줄바꿈도 그대로
 */
export function taskBody(ctx: Ctx, step: Step, options: MetaOptions = {}): string[] {
  const lines: string[] = [];
  const meta = metaSentences(ctx, step, options);
  if (meta.length) lines.push(meta.join(' '));
  if (step.description) lines.push(...step.description.split('\n'));
  return lines;
}

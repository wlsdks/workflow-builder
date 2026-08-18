/**
 * packages/doc-gen/src/sentence/link.ts
 *
 * 접속 표현 선택 규칙 (§4.4).
 *
 * **기본값은 "쓰지 않는다".** 번호가 이미 순서를 말한다.
 *
 * 여기서 한 가지를 분명히 해둔다 — 14단계가 전부 `~해요`로 끝나는 문제는
 * **접속어로 풀지 않는다.** 어미를 로테이션하면(`~해요`/`~합니다`/`~하죠`)
 * 세 번째 문장에서 어색해지고, 어색함은 "기계가 쓴 티"로 정확히 읽힌다.
 * 사람이 지루해하는 것은 반복 자체가 아니라 **정보 없는 반복**이다 (§4.5).
 *
 * 그래서 이 파일이 하는 일은 "언제 접속어를 **안** 쓸지"를 정하는 쪽에 가깝다.
 * 아래 다섯 경우에만 붙는다.
 *
 *   그다음 — 번호가 이미 말한다. 14번 반복되면 소음이다
 *   이때   — 지시 대상이 모호하다. 앞 문장인지 앞 단계인지 알 수 없다
 *   만약   — 갈래 소제목이 이미 조건을 보여준다
 *
 * 이 셋은 **쓰지 않는다.**
 */

import { E } from '../audit.ts';
import type { Ctx } from '../ctx.ts';
import type { Step, WaitFor } from '../types.ts';

/** 앞이 `hold`일 때 다음 단계 첫 문장 앞에 붙는 말 */
const AFTER_HOLD: Record<WaitFor, string> = {
  reply: '답이 오면,',
  approval: '확인이 끝나면,',
  time: '시간이 되면,',
  resource: '도착하면,',
};

export type LinkContext = {
  prev: Step | undefined;
  current: Step;
  /** 이 단계 앞에 인계 블록이 들어갔는가 */
  handoffBefore: boolean;
};

/**
 * 갈래 합류 직후 `어느 쪽이든 여기서 다시 만나요.`를 붙일지.
 *
 * 갈래가 셋 이상이거나 한 갈래라도 2단계 이상이면 붙인다. 두 갈래에 각 1단계뿐이면
 * 독자가 길을 잃을 거리가 아니라서 안 붙인다 — §2.1의 7·10번이 그 경우다.
 */
function needsJoinNote(prev: Step): boolean {
  const cases = prev.branch?.cases ?? [];
  if (cases.length >= 3) return true;
  return cases.some((c) => (c.steps?.length ?? 0) >= 2);
}

export function connective(ctx: Ctx, link: LinkContext): string | null {
  const { prev, current, handoffBefore } = link;
  if (!prev) return null;

  // 담당자 변경 — 접속어를 쓰지 않는다. 인계 블록이 대신한다
  if (handoffBefore) return null;

  if (prev.kind === 'hold' && prev.hold) {
    // 이 단계가 타임아웃 행선지면 "답이 오면"은 거짓말이 된다
    if (prev.hold.escalation?.toStepId === current.id) return null;
    if (prev.hold.rejectToStepId === current.id) return null;
    return ctx.gen.raw(AFTER_HOLD[prev.hold.waitFor]);
  }

  if (prev.kind === 'branch') {
    if (prev.branch?.mode === 'skip') return ctx.gen.raw('건너뛰었으면 여기부터 이어져요.');
    if (needsJoinNote(prev)) return ctx.gen.raw('어느 쪽이든 여기서 다시 만나요.');
    return null;
  }

  return null;
}

/**
 * §4.4는 되돌아오는 **대상** 단계에도 표시를 붙이라고 한다.
 * 그런데 §2.3(e)와 §2.1 전문은 되돌아감을 갈래 안과 「이렇게 안 흘러갈 때」
 * **두 곳에만** 둔다. 전문이 정답지라 기본은 꺼짐이고, 옵션으로만 켠다.
 */
export function returnTargetNote(ctx: Ctx, target: Step): string | null {
  if (!ctx.opts.markReturnTargets) return null;
  const from: string[] = [];
  for (const s of ctx.flow.steps) {
    for (const c of s.branch?.cases ?? []) {
      if (c.returnTo?.toStepId === target.id) {
        const no = ctx.n.caseNoById.get(c.id);
        if (no) from.push(no);
      }
    }
  }
  if (!from.length) return null;
  return ctx.gen.s`여기로 되돌아오는 일이 있어요. ${E(from.join('·'))}에서요.`;
}

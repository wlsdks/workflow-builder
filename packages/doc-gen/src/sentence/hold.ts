/**
 * packages/doc-gen/src/sentence/hold.ts
 *
 * 슬롯 문법 — `hold` (§4.2 · §2.3 d).
 *
 *     여기서 멈춰요. {대기 절} 보통 {기간}쯤 걸려요.
 *     [기다리는 동안 {N}번 {제목}을 먼저 시작해도 돼요.]
 *     {타임아웃}이 지나도 {소식 없음}면 {행동}.
 *
 * 판단 두 개가 여기 박혀 있다.
 *
 *  ① **"기다립니다"가 아니라 "여기서 멈춰요".** 주체가 사람이 아니라 흐름이다.
 *     기다리는 시간은 아무도 잘못한 게 아니다 (WRITING §6).
 *  ② **판단 문구를 절대 붙이지 않는다.** `4일이나 걸려요`, `여기가 제일 오래 걸려요` 금지.
 *
 * 그리고 `avgWaitH`가 없으면 **본문에서 밝힌다.** 대기 길이를 모르면 받는 사람이
 * 일정을 못 짠다 — 부끄러운 결핍이 아니라 위험 결핍이다 (§5.1).
 */

import { E } from '../audit.ts';
import type { Ctx } from '../ctx.ts';
import { objectParticle, subjectParticle, timeoutPhrase, waitPhrase } from '../lang.ts';
import type { HoldSpec, Step, WaitFor } from '../types.ts';

/** waitFor별 "소식이 없으면" 기본 문형 (§4.2) */
const NO_REPLY: Record<WaitFor, string | null> = {
  reply: '소식이 없으면',
  approval: '아직 안 봤으면',
  resource: '안 왔으면',
  // time은 재촉이 성립하지 않는다 — 놓치면 다음 기회를 말한다
  time: null,
};

/** waitFor별 대기 절 기본 문형. 사용자가 적은 `waitClause`가 있으면 그쪽이 이긴다 */
function defaultWaitClause(hold: HoldSpec): string | null {
  const t = hold.waitTarget;
  if (!t) return null;
  switch (hold.waitFor) {
    case 'reply':
      return `${t}에서 답이 올 때까지`;
    case 'approval':
      return `${t}${subjectParticle(t)} 볼 때까지`;
    case 'time':
      return `${t}${subjectParticle(t)} 될 때까지`;
    case 'resource':
      return `${t}${subjectParticle(t)} 올 때까지`;
  }
}

/**
 * 병렬 가능 판정.
 *
 * **엔진이 만드는 것 중 가장 실용적인 문장**인데, 동시에 제일 위험하다 —
 * 없는 병렬을 지어내면 받는 사람이 순서를 어긴다. 그래서 근거는
 * `dependsOn`이 명시된 단계뿐이다. 의존 정보가 없는 단계는 "앞의 전부에
 * 의존한다"로 보수적으로 본다. 문장 하나를 잃는 쪽이 훨씬 싸다.
 */
export function parallelCandidate(ctx: Ctx, hold: Step): Step | null {
  const steps = ctx.flow.steps;
  const holdIndex = steps.findIndex((s) => s.id === hold.id);
  if (holdIndex < 0) return null;
  const indexOf = new Map(steps.map((s, i) => [s.id, i]));

  for (let i = holdIndex + 1; i < steps.length; i++) {
    const s = steps[i]!;
    if (!s.dependsOn) continue;
    const free = s.dependsOn.every((dep) => {
      const di = indexOf.get(dep);
      return di !== undefined && di < holdIndex;
    });
    if (free) return s;
  }
  return null;
}

export type HoldBody = {
  /** 본문 줄들 */
  lines: string[];
  /** 각주 뒤에 따로 붙는 위험 결핍 줄 (approval 반려 행선지) */
  trailing: string[];
};

export function holdBody(ctx: Ctx, step: Step): HoldBody {
  const { gen } = ctx;
  const hold = step.hold;
  const lines: string[] = [];
  const trailing: string[] = [];
  if (!hold) return { lines, trailing };

  /* ── 1줄: 멈춤 + 길이 ─────────────────────────────────────────────── */
  const clause = hold.waitClause ?? defaultWaitClause(hold);
  if (typeof hold.avgWaitH === 'number') {
    const span = waitPhrase(hold.avgWaitH);
    lines.push(
      clause
        ? gen.s`여기서 멈춰요. ${clause} 보통 ${E(span)}쯤 걸려요.`
        : gen.s`여기서 멈춰요. 보통 ${E(span)}쯤 걸려요.`,
    );
  } else {
    // 위험 결핍 — 본문에서 밝힌다
    lines.push(gen.raw('여기서 멈춰요. 얼마나 걸리는지는 아직 안 적혀 있어요.'));
  }

  /* ── 2줄: 기다리는 동안 먼저 해도 되는 것 ──────────────────────────── */
  const parallel = parallelCandidate(ctx, step);
  if (parallel) {
    const no = ctx.n.noById.get(parallel.id)!;
    lines.push(
      gen.s`기다리는 동안 ${E(no)}번 ${parallel.title}${E(objectParticle(parallel.title))} 먼저 시작해도 돼요.`,
    );
  }

  /* ── 3줄: 타임아웃 ─────────────────────────────────────────────────── */
  const label =
    hold.timeoutLabel ?? (typeof hold.timeoutH === 'number' ? timeoutPhrase(hold.timeoutH) : null);
  if (label) {
    const noReply = hold.noReplyClause ?? NO_REPLY[hold.waitFor];
    const act = escalation(ctx, hold);
    if (noReply && act) {
      // 사용자가 적은 조각은 그대로, 엔진이 만든 조각만 E()로 표시해서 감사에 남긴다
      const labelV = hold.timeoutLabel ? label : E(label);
      const noReplyV = hold.noReplyClause ? noReply : E(noReply);
      const actV = act.fromUser ? act.text : E(act.text);
      lines.push(gen.s`${labelV}${E(subjectParticle(label))} 지나도 ${noReplyV} ${actV}`);
    }
  }

  /* ── 반려 행선지 (approval) ─────────────────────────────────────────── */
  if (hold.waitFor === 'approval') {
    const to = hold.rejectToStepId ? ctx.n.noById.get(hold.rejectToStepId) : undefined;
    if (to) {
      trailing.push(gen.s`다시 하라는 얘기가 나오면 ${E(to)}번으로 가요.`);
    } else {
      const owner = ctx.owner?.name;
      trailing.push(gen.raw('다시 하라는 얘기가 나오면 어디부터 다시 하는지는 아직 안 적혀 있어요.'));
      if (owner) trailing.push(gen.s`${owner} 님께 물어보세요.`);
    }
  }

  return { lines, trailing };
}

function escalation(ctx: Ctx, hold: HoldSpec): { text: string; fromUser: boolean } | null {
  const esc = hold.escalation;
  if (!esc) return null;
  if (esc.action) return { text: esc.action, fromUser: true };
  const no = esc.toStepId ? ctx.n.noById.get(esc.toStepId) : undefined;
  if (no) return { text: `${no}번으로 가요.`, fromUser: false };
  return null;
}

/** 표의 `그 밖에` 열에 쓰는 짧은 형태 — `마감일 지나면 3번` */
export function holdTimeoutCompact(ctx: Ctx, step: Step): string | null {
  const hold = step.hold;
  if (!hold) return null;
  const label =
    hold.timeoutLabel ?? (typeof hold.timeoutH === 'number' ? timeoutCompactLabel(hold.timeoutH) : null);
  if (!label) return null;
  const esc = hold.escalation;
  const target = esc?.actionShort ?? (esc?.toStepId ? `${ctx.n.noById.get(esc.toStepId)}번` : null);
  if (!target) return null;
  return `${label} 지나면 ${target}`;
}

function timeoutCompactLabel(hours: number): string {
  return hours < 24 ? `${Math.round(hours)}시간` : `${Math.round(hours / 24)}일`;
}

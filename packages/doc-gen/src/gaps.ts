/**
 * packages/doc-gen/src/gaps.ts
 *
 * 결핍 판정 — **위험 결핍과 부끄러운 결핍** (D-064 · §5.1).
 *
 * 기준은 하나다.
 *
 *   > 이게 없으면 받는 사람이 실행하다 멈추는가?
 *
 *   위험 결핍   없으면 못 한다   → **본문에서 밝힌다** (`아직 안 적혀 있어요. {누구}께 물어보세요.`)
 *   부끄러운 결핍 없어도 할 수 있다 → **조용히 생략한다.** 문장 자체가 안 나온다
 *
 * 둘 다 뒤의 「이건 물어보셔야 해요」에 모인다. 이 구분이 §5 전체의 답이다.
 * 부끄러운 결핍을 본문에 흩뿌리면 문서가 구멍투성이로 보이고 **작성자가 다음부터
 * 안 만든다.** 위험 결핍을 숨기면 받는 사람이 3번 단계에서 멈추고 문서를 덮는다.
 *
 * 그리고 결핍 목록은 결핍 목록으로 쓰지 않는다. **질문 목록으로 뒤집는다** (§5.3 조건 ②).
 *
 *   `안 채워진 항목: 6개`          ✗
 *   `이건 물어보셔야 해요`          ○
 *   `13번 · 반려 행선지 없음`      ✗
 *   `13번 — 다시 하라고 하면 어디부터 다시 하나요`  ○
 *
 * 같은 데이터인데 주어가 "빠진 것"에서 "받는 사람이 할 일"로 바뀐다.
 */

import { E } from './audit.ts';
import type { Ctx } from './ctx.ts';
import { subjectParticle } from './lang.ts';
import type { Step } from './types.ts';

export type GapKind =
  | 'cadence'
  | 'hold-wait'
  | 'branch-criterion'
  | 'approval-return'
  | 'handoff-payload'
  | 'branch-weight'
  | 'duration'
  | 'tool'
  | 'assignee'
  | 'term'
  | 'permission';

/**
 * 「물어보셔야 해요」의 정렬 순서.
 *
 * 단계 번호 순이 아니라 **문서 가독성 기여도 순**이다 (§5.4).
 * 없으면 실행이 막히는 것부터 온다. §2.1에서 13번이 9번보다 위에 오는 이유가 이것이다.
 */
const RANK: Record<GapKind, number> = {
  cadence: 0,
  'hold-wait': 1,
  'branch-criterion': 2,
  'approval-return': 3,
  'handoff-payload': 4,
  'branch-weight': 5,
  duration: 6,
  tool: 7,
  assignee: 8,
  term: 9,
  permission: 10,
};

export type Gap = {
  kind: GapKind;
  /** 위험 결핍인가. 위험이면 본문에서도 밝힌다 */
  risky: boolean;
  stepNo?: string;
  /** 「무엇」 열 */
  question: string;
  /** 「누구에게」 열 */
  askWho: string;
  /** 정렬용 — 같은 종류 안에서는 단계 순 */
  order: number;
};

export function collectGaps(ctx: Ctx): Gap[] {
  const { gen, flow, n } = ctx;
  const gaps: Gap[] = [];
  const owner = ctx.owner?.name ?? '';
  const decider = flow.people.find((p) => p.decides)?.name ?? owner;

  const push = (g: Omit<Gap, 'order'>, order: number): void => {
    gaps.push({ ...g, order });
  };

  flow.steps.forEach((step, i) => {
    const no = n.noById.get(step.id)!;

    /* ── 위험 결핍 ────────────────────────────────────────────────── */

    if (step.kind === 'hold' && step.hold) {
      if (typeof step.hold.avgWaitH !== 'number') {
        push(
          {
            kind: 'hold-wait',
            risky: true,
            stepNo: no,
            question: gen.s`${E(no)}번 — 얼마나 기다리는 일인가요`,
            askWho: owner,
          },
          i,
        );
      }
      if (step.hold.waitFor === 'approval' && !step.hold.rejectToStepId) {
        push(
          {
            kind: 'approval-return',
            risky: true,
            stepNo: no,
            question: gen.s`${E(no)}번 — 다시 하라고 하면 어디부터 다시 하나요`,
            askWho: owner,
          },
          i,
        );
      }
    }

    if (step.branch) {
      const anyLabel = step.branch.cases.some((c) => c.label || c.condition);
      if (!anyLabel) {
        push(
          {
            kind: 'branch-criterion',
            risky: true,
            stepNo: no,
            question: gen.s`${E(no)}번 — 여기서 뭘 보고 갈리나요`,
            askWho: owner,
          },
          i,
        );
      } else if (!step.branch.weightKnown) {
        // 갈래 비중 — 본문에는 표시하지 않는다. 두 갈래를 대등하게 쓰고 넘어간다
        const prev = previousAssignedStep(ctx, i);
        const who = prev && prev.assigneeId !== step.assigneeId ? ctx.personName(prev.assigneeId) : undefined;
        push(
          {
            kind: 'branch-weight',
            risky: false,
            stepNo: no,
            question: step.askAbout
              ? gen.s`${E(no)}번 — ${step.askAbout} 일이 얼마나 자주 있나요`
              : gen.s`${E(no)}번 — 어느 쪽이 더 자주 있나요`,
            askWho: who ?? ctx.personName(step.assigneeId) ?? owner,
          },
          i,
        );
      }
    }

    /* ── 부끄러운 결핍 ────────────────────────────────────────────────
     *
     * 갈래 안 단계는 여기서 빼둔다. 곁가지의 빈칸까지 질문으로 만들면
     * 목록이 길어지고, 길어진 목록은 그 자체로 성적표가 된다.
     */
    if (step.kind !== 'hold' && !step.durationBand) {
      push(
        {
          kind: 'duration',
          risky: false,
          stepNo: no,
          question: step.askAbout
            ? gen.s`${E(no)}번 — ${step.askAbout} 얼마나 걸리나요`
            : gen.s`${E(no)}번 — 한 번에 얼마나 걸리나요`,
          askWho: ctx.personName(step.assigneeId) ?? owner,
        },
        i,
      );
    }
    if (step.kind !== 'hold' && (step.toolIds?.length ?? 0) === 0) {
      push(
        {
          kind: 'tool',
          risky: false,
          stepNo: no,
          question: gen.s`${E(no)}번 — 뭘로 하는 일인가요`,
          askWho: ctx.personName(step.assigneeId) ?? owner,
        },
        i,
      );
    }
    if (step.kind !== 'hold' && !step.assigneeId) {
      push(
        {
          kind: 'assignee',
          risky: false,
          stepNo: no,
          question: gen.s`${E(no)}번 — 이건 누가 하나요`,
          askWho: owner,
        },
        i,
      );
    }
  });

  /* ── 인계 시 넘길 것 (부서를 넘을 때만 위험 결핍) ─────────────────── */
  for (const h of handoffPoints(ctx)) {
    // 되돌아오는 지점은 넘길 것을 묻지 않는다 — 그 사람이 이미 다 갖고 있다
    if (h.returning || !h.crossDept || h.step.handoffPayload) continue;
    const to = ctx.personName(h.step.assigneeId) ?? '';
    const from = ctx.personName(h.fromAssigneeId) ?? owner;
    push(
      {
        kind: 'handoff-payload',
        risky: true,
        stepNo: h.no,
        question: ctx.gen.s`${E(h.no)}번 — ${to} 님께 넘길 때 뭘 같이 드리나요`,
        askWho: [from, to].filter(Boolean).join(' · '),
      },
      Number(h.no),
    );
  }

  /* ── 못 푼 업무 용어 ───────────────────────────────────────────────── */
  for (const [i, term] of (flow.unresolvedTerms ?? []).entries()) {
    push(
      {
        kind: 'term',
        risky: false,
        question: gen.s`'${term}'${E(subjectParticle(term))} 무슨 뜻인가요`,
        askWho: owner,
      },
      i,
    );
  }

  /* ── 계정·권한을 누가 열어주는지 ─────────────────────────────────────
   *
   * 순서는 도구 사전 순이 아니라 **흐름에서 처음 만나는 순서**다.
   * 받는 사람은 1번부터 순서대로 막히기 때문이다.
   */
  const firstSeen = new Map<string, number>();
  ctx.allSteps.forEach((s, i) => {
    for (const t of s.toolIds ?? []) if (!firstSeen.has(t)) firstSeen.set(t, i * 100 + (s.toolIds ?? []).indexOf(t));
  });
  const needAccess = flow.tools
    .filter((t) => t.access && !t.accessGrantedBy && t.accessCritical && firstSeen.has(t.id))
    .sort((a, b) => (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0));
  if (needAccess.length) {
    const names = needAccess.map((t) => t.shortName ?? t.name).join('·');
    push(
      {
        kind: 'permission',
        risky: false,
        question: gen.s`${names} 권한을 누가 열어주나요`,
        askWho: decider,
      },
      0,
    );
  }

  /* ── 흐름 주기 ─────────────────────────────────────────────────────── */
  if (!flow.cadence) {
    push(
      {
        kind: 'cadence',
        risky: true,
        question: gen.raw('언제 시작되는 일인가요'),
        askWho: owner,
      },
      0,
    );
  }

  return gaps.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.order - b.order);
}

function previousAssignedStep(ctx: Ctx, index: number): Step | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const s = ctx.flow.steps[i]!;
    if (s.assigneeId) return s;
  }
  return undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 담당이 바뀌는 지점 (§2.3 f)
 *
 * 인계 지점은 **사고가 나는 곳**이고, 인계 문서의 존재 이유 그 자체다.
 * 앞 단계 담당자를 승계해서 추측하지 않는다 — 승계가 틀리면 인계 지점을 지운다.
 * ──────────────────────────────────────────────────────────────────────────── */

export type HandoffPoint = {
  step: Step;
  no: string;
  fromAssigneeId: string;
  /** 이 담당자가 앞에서 이미 나온 적이 있는가 (되돌아오는 지점) */
  returning: boolean;
  crossDept: boolean;
};

export function handoffPoints(ctx: Ctx): HandoffPoint[] {
  const out: HandoffPoint[] = [];
  let current: string | undefined;
  const seen = new Set<string>();

  for (const step of ctx.flow.steps) {
    const a = step.assigneeId;
    if (!a) continue; // 담당이 없는 단계는 승계도 초기화도 하지 않는다
    if (current !== undefined && a !== current) {
      const fromDept = ctx.person(current)?.deptId;
      const toDept = ctx.person(a)?.deptId;
      out.push({
        step,
        no: ctx.n.noById.get(step.id)!,
        fromAssigneeId: current,
        returning: seen.has(a),
        crossDept: Boolean(fromDept && toDept && fromDept !== toDept),
      });
    }
    seen.add(a);
    current = a;
  }
  return out;
}

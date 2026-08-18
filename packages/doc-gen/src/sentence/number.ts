/**
 * packages/doc-gen/src/sentence/number.ts
 *
 * 번호 체계 (§4.6).
 *
 *   최상위 단계      1 ~ 14        `hold`도 번호를 받는다
 *   갈래 케이스      7-가, 7-나     **소수점(7.1)을 쓰지 않는다 — 소리 내어 못 부른다**
 *   갈래 안 단계     7-가-1, 7-가-2 3단까지
 *   3단 초과·5단계+  부록 가        부를 수 없는 번호는 만들지 않는다
 *
 * 번호는 **문서 생성 시점에 고정된다.** 흐름이 바뀌어도 이 문서에서는 안 바뀐다.
 * 종이에 인쇄된 문서와 대화가 어긋나면 안 되기 때문이다.
 */

import { CASE_LETTERS } from '../lang.ts';
import type { CaseSpec, Step } from '../types.ts';

/** 갈래 안 단계가 이 수를 넘으면 본문에서 빼서 부록으로 */
export const MAX_CASE_STEPS_INLINE = 4;

export type NumberedCase = {
  spec: CaseSpec;
  /** `7-가` */
  no: string;
  letter: string;
  /** 갈래 안 단계. `7-가-1` */
  steps: readonly NumberedStep[];
  /** 본문에서 빼서 부록으로 보냈는가 */
  toAppendix: boolean;
  /** `부록 가` */
  appendixNo?: string;
};

export type NumberedStep = {
  step: Step;
  /** `1` · `7-가-1` */
  no: string;
  /** 최상위 단계인가 */
  top: boolean;
  cases: readonly NumberedCase[];
};

export type Numbering = {
  steps: readonly NumberedStep[];
  /** stepId → 번호 */
  noById: ReadonlyMap<string, string>;
  /** stepId → 제목 원문 */
  titleById: ReadonlyMap<string, string>;
  /** stepId → 단계 객체 */
  stepById: ReadonlyMap<string, Step>;
  /** caseId → 번호 */
  caseNoById: ReadonlyMap<string, string>;
  appendix: readonly NumberedCase[];
};

export function number(steps: readonly Step[]): Numbering {
  const noById = new Map<string, string>();
  const titleById = new Map<string, string>();
  const stepById = new Map<string, Step>();
  const caseNoById = new Map<string, string>();
  const appendix: NumberedCase[] = [];

  /**
   * 재귀로 번호를 매긴다. 본문에는 3단까지만 나오고, 그보다 깊은 것은
   * 통째로 부록으로 빠지므로 깊은 번호가 본문 목차에 등장하지 않는다.
   */
  const numberStep = (step: Step, no: string, top: boolean): NumberedStep => {
    noById.set(step.id, no);
    titleById.set(step.id, step.title);
    stepById.set(step.id, step);

    const cases = (step.branch?.cases ?? []).map((spec, ci) => {
      const letter = CASE_LETTERS[ci] ?? String(ci + 1);
      const caseNo = `${no}-${letter}`;
      caseNoById.set(spec.id, caseNo);

      const inner = spec.steps ?? [];
      const nested = inner.some((s) => (s.branch?.cases?.length ?? 0) > 0);
      // 5단계 이상이거나 3단 중첩이면 본문에서 뺀다 (§2.3 c)
      const toAppendix = top && (inner.length > MAX_CASE_STEPS_INLINE || nested);

      const innerNumbered = inner.map((s, si) => numberStep(s, `${caseNo}-${si + 1}`, false));

      const nc: NumberedCase = {
        spec,
        no: caseNo,
        letter,
        steps: innerNumbered,
        toAppendix,
        ...(toAppendix
          ? { appendixNo: `부록 ${CASE_LETTERS[appendix.length] ?? String(appendix.length + 1)}` }
          : {}),
      };
      if (toAppendix) appendix.push(nc);
      return nc;
    });

    return { step, no, top, cases };
  };

  const numbered = steps.map((step, i) => numberStep(step, String(i + 1), true));

  return { steps: numbered, noById, titleById, stepById, caseNoById, appendix };
}

/** `4번` — 없는 단계를 가리키면 null (고아 참조. §9.1 #6 하드 실패) */
export function refNo(n: Numbering, stepId: string | undefined): string | null {
  if (!stepId) return null;
  return n.noById.get(stepId) ?? null;
}

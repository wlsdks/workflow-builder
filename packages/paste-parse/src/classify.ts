/**
 * packages/paste-parse/src/classify.ts  (PARSING §5)
 *
 * S6 타입 분류 — **게이트 우선 + 점수 보조 하이브리드.**
 *
 * 순수 점수제는 이 문제에 맞지 않는다. 세 클래스의 **오분류 비용이 비대칭**이기 때문이다.
 *   task → branch (거짓 분기)  = 빈 갈래 슬롯. 복구 비용 높음. *빈 화면 공포의 재발*
 *   branch → task (분기 놓침)  = 한 줄로 남는다. 배지 클릭 1회
 *   hold ↔ task                = 배지 색만 다르다. 클릭 1회
 * → **task가 기본값이고, branch 승격은 가장 엄격하게, hold 승격은 중간으로.**
 */

import type { BranchMode, ItemKind, Segment, WaitFor } from './types.ts';
import { BRANCH_MARKERS, matchCondition, nominalizeCondition, isReceivingCondition } from './lexicon/branch.ts';
import { EXCEPTION, TERMINAL } from './lexicon/flow.ts';
import { HOLD, pickWaitTarget } from './lexicon/hold.ts';
import { hasActionPredicate, mainPredicate } from './lexicon/verbs.ts';

export type Verdict = {
  kind: ItemKind;
  branchMode?: BranchMode;
  branchCondition?: string;
  waitFor?: WaitFor;
  /** 0..1 — §9와 §13(LLM 재판정 구간 선정)에 쓰인다 */
  confidence: number;
  /** 어떤 규칙이 발화했는가 (텔레메트리·디버깅) */
  rule: string;
  holdSuspect?: boolean;
  isTerminal?: boolean;
};

export type ClassifyCtx = {
  siblingsAhead: readonly Segment[];
  /** 이 세그먼트 뒤에 붙을 수 있는 자식 후보 수 (§5.2 G1.score) */
  childCandidates: number;
};

/**
 * 결재 상신 / 승인 요청 / 컨펌 받기 — §5.4가 hold/approval로 못 박은 세 가지.
 *
 * ★ 명세 본문의 정규식은 `"지출결의서를 상신합니다"`(상신 동사가 단독으로 주 서술어)와
 *   `"결재 올려요"`(올리→올려 활용), `"확인 한번 받아주세요"`를 놓친다. §11 F3-06·F2-07·F2-05가
 *   전부 그 형태라 셋을 명시적으로 등재한다.
 */
const RE_SUBMITTING =
  /(?:결재|기안|품의)(?:를)?\s*(?:올리|올려|상신|제출)|(?:상신|기안|품의)(?:합니다|해요|한다|하기|하고|할)|승인(?:을)?\s*(?:요청|받)|컨펌(?:을)?\s*받|확인(?:을)?\s*(?:한번\s*|한\s*번\s*)?받/;

export function classify(seg: Segment, ctx: ClassifyCtx): Verdict {
  const t = seg.text;
  const isTerminal = TERMINAL.word.test(t) || TERMINAL.phrase.test(t);

  // ══ G1. 분기 게이트 — 조건 + 구조적 증거를 동시에 요구한다 ═══════════════
  const cond = matchCondition(t);
  let holdScope = t;
  // ★ `"아니면 그냥 진행해요"`는 **갈래의 본문**이지 새 분기가 아니다.
  //   여기서 막지 않으면 갈래마다 또 분기가 생겨 그림이 계단이 된다.
  const isAltBody = /^(?:아니면|그렇지\s?않으면|그\s?외에는|해당\s?없으면|이외의\s?경우)/.test(t.trim());
  if (cond && !isAltBody) {
    // 수령형 조건은 분기가 아니다 (`"자료 받으면"`, `"결재 완료되면"`).
    // ★ 그리고 대기 판정에서도 빼야 한다 — 이음새를 대기로 읽으면 흐름이 멈춘 것처럼 그려진다.
    if (isReceivingCondition(cond.text)) {
      holdScope = t.slice(cond.end);
    } else {
      const hasAlt =
        BRANCH_MARKERS.alternative.test(t) ||
        BRANCH_MARKERS.approvalPair.test(t) ||
        ctx.siblingsAhead.slice(0, 3).some((s) => BRANCH_MARKERS.alternative.test(s.text));
      const hasParallel = BRANCH_MARKERS.parallel.test(t);
      const explicit = BRANCH_MARKERS.opener.test(t);
      const perAxis = BRANCH_MARKERS.perAxis.test(t);
      const condition = nominalizeCondition(cond.text);

      if (hasAlt) return { kind: 'branch', branchMode: 'xor', branchCondition: condition, confidence: 0.9, rule: 'G1.alt', isTerminal };
      if (hasParallel) return { kind: 'branch', branchMode: 'and', branchCondition: condition, confidence: 0.75, rule: 'G1.and', isTerminal };
      if (perAxis) return { kind: 'branch', branchMode: 'xor', branchCondition: condition, confidence: 0.65, rule: 'G1.axis', isTerminal };
      // ★ `"~인 경우"`·`"~할 때"`는 연결어미가 아니라 **조건 명사**다. `"만약"`과 같은 급의
      //   명시적 조건 표지로 취급한다 (§11 F1-06이 요구하는 판정).
      if (explicit || cond.via === 'caseNoun' || BRANCH_MARKERS.skipOnly.test(t) || EXCEPTION.negativeCase.test(t)) {
        return { kind: 'branch', branchMode: 'skip', branchCondition: condition, confidence: 0.7, rule: 'G1.skip', isTerminal };
      }
      // 조건은 있는데 증거가 약하다 → 점수로 마지막 판단
      const s = 0.35 + (cond.at === 0 ? 0.2 : 0) + (ctx.childCandidates >= 2 ? 0.25 : 0);
      if (s >= 0.6) return { kind: 'branch', branchMode: 'skip', branchCondition: condition, confidence: s, rule: 'G1.score', isTerminal };
    }
  }

  // ══ G2. 대기 게이트 — "손을 놓고 기다리는가"가 유일한 기준 ═════════════════
  const mainPred = mainPredicate(holdScope); // 종속절의 어휘에 속지 않는다 (§5.3)
  if (!HOLD.activeNotHold.test(mainPred)) {
    const waitVerb = HOLD.verb.test(mainPred) || HOLD.passive.test(holdScope);
    const target = pickWaitTarget(holdScope);
    const submitting = RE_SUBMITTING.test(holdScope);

    if (waitVerb && target) return { kind: 'hold', waitFor: target, confidence: 0.85, rule: 'G2.verb', isTerminal };
    if (submitting) return { kind: 'hold', waitFor: 'approval', confidence: 0.8, rule: 'G2.submit', isTerminal };
    if (target === 'approval' && /(?:승인|결재|컨펌|재가)(?:되|나|될|날)/.test(holdScope)) {
      return { kind: 'hold', waitFor: 'approval', confidence: 0.7, rule: 'G2.approvalPassive', isTerminal };
    }
    // 점수 보조: 대기 대상은 있는데 대기 동사가 없다
    if (target) {
      const s =
        0.3 +
        (target === 'approval' ? 0.25 : 0.1) +
        (/(?:까지|동안|간)\s*$/.test(mainPred) ? 0.15 : 0) +
        (hasActionPredicate(holdScope) ? -0.15 : 0.15); // 내가 하는 동작이면 감점
      if (s >= 0.55) return { kind: 'hold', waitFor: target, confidence: s, rule: 'G2.score', isTerminal };
      // 부속절에서만 대기 어휘가 발견되면 hold로 승격하지 않는다. 대신 질문 연쇄가 회수한다 (§5.3)
      return { kind: 'task', confidence: 0.8, rule: 'default', holdSuspect: true, isTerminal };
    }
  }

  return { kind: 'task', confidence: 0.8, rule: 'default', isTerminal };
}

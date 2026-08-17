/**
 * packages/graph-core/src/validate.ts
 *
 * §4 validate() 명세.
 *
 * ── 이 함수가 존재하지 않는 이유부터 ────────────────────────────────────────
 *
 * BPMN이 비개발자에게 실패한 이유 중 하나는 well-formedness 검증과 오류 표시였다.
 *
 *   "비개발자는 자기 그림이 문법 오류로 지적당하는 순간 손을 뗀다."
 *
 * 그래서 이 제품에는 **검증 실패라는 상태가 없다.** derive()는 어떤 입력에도
 * 그래프를 반환하고, 모든 이상은 컴파일 시점에 **복구**된다.
 *
 * validate()는 그 복구 내역을 **조회**하는 함수다. 새로 판정하지 않는다.
 * 소비자는 셋뿐이다.
 *
 *   1) 캔버스 엣지 호버 — `userMessage`가 null이 아닌 진단만. "왜 이렇게 이어졌나"
 *   2) CI 골든 픽스처 — 기대한 복구가 기대한 코드로 일어났는지
 *   3) AI 초안 검증기 — 생성된 아웃라인이 사람 손을 타기 전 서버에서 자기점검
 *
 * **UI로 나가는 경로는 1번뿐이고, 그것도 오류가 아니라 설명이다.**
 * 토스트·인라인 밑줄·저장 차단·빨간 배지로 가는 코드 경로를 만들지 않는다.
 *
 * ── 의도적으로 검증하지 않는 것 ────────────────────────────────────────────
 *
 * | 하지 않는 검사              | 왜 안 하는가                                   |
 * |----------------------------|-----------------------------------------------|
 * | soundness / 적정성          | Petri net 적정성은 사용자가 이해할 수 없고,     |
 * |                            | 위반해도 그림은 멀쩡히 읽힌다                   |
 * | 단일 진입·단일 출구 (SESE) | 자연어로 적은 업무는 원래 SESE가 아니다         |
 * | 교착·라이브락               | AND 갈래의 'end'는 이미 컴파일에서 무해화됨     |
 * | 사이클 금지                 | 사이클은 이 제품의 **핵심 기능**이다 (§5)       |
 * | 도달 불가 노드              | 복구로 없앤다. 남으면 사용자가 명시적으로       |
 * |                            | 억제한 결과이므로 의도로 존중한다               |
 * | 메타데이터 누락             | 카드 스택의 "모르겠어요"는 1급 선택지다.        |
 * |                            | 안 채운 것을 결함으로 부르면 그 사람은 안 돌아온다 |
 * | 제목 길이·명명 규칙         | 남의 업무 표현을 교정하지 않는다                |
 * | 단계 수 상한                | 500단계는 성능 문제이지 사용자 잘못이 아니다     |
 * | 분기 갈래 수 상한           | 레이아웃이 팬아웃 스택으로 대응한다             |
 * | 시간 총합의 현실성          | 총량 정산은 사용자가 스스로 재배분하는 장치이지  |
 * |                            | 검증기가 아니다 (PRD §4.7)                     |
 */

import type { Diagnostic, DiagnosticCode, DerivedGraph } from './types.ts';

export type ValidateOptions = {
  /** 캔버스 호버용만 원할 때 true. 기본 false */
  userFacingOnly?: boolean;
  include?: readonly DiagnosticCode[];
  exclude?: readonly DiagnosticCode[];
};

export type ValidationReport = {
  diagnostics: readonly Diagnostic[];
  /** 코드별 건수 — CI 스냅샷과 대시보드용 */
  counts: Readonly<Record<string, number>>;
  /** 자동 복구가 한 번이라도 일어났는가. **사용자에게 노출 금지** */
  repaired: boolean;
  /** 엣지 ID → 호버에 띄울 문장 */
  edgeExplanations: ReadonlyMap<string, string>;
  /** 노드 ID → 호버에 띄울 문장 */
  nodeExplanations: ReadonlyMap<string, string>;
};

export function validate(graph: DerivedGraph, options: ValidateOptions = {}): ValidationReport {
  let list = [...graph.diagnostics];

  if (options.userFacingOnly) list = list.filter((d) => d.userMessage !== null);
  if (options.include) {
    const inc = new Set(options.include);
    list = list.filter((d) => inc.has(d.code));
  }
  if (options.exclude) {
    const exc = new Set(options.exclude);
    list = list.filter((d) => !exc.has(d.code));
  }

  const counts: Record<string, number> = {};
  for (const d of list) counts[d.code] = (counts[d.code] ?? 0) + 1;

  const edgeExplanations = new Map<string, string>();
  const nodeExplanations = new Map<string, string>();
  for (const d of list) {
    if (d.userMessage === null) continue;
    for (const id of d.edgeIds ?? []) edgeExplanations.set(id, d.userMessage);
    for (const id of d.nodeIds ?? []) nodeExplanations.set(id, d.userMessage);
  }

  /* 파생 엣지의 기본 설명은 진단이 아니라 reason에서 나온다.
   * "이 연결은 왜 생겼나"에 **모든** 엣지가 답할 수 있어야 한다 (PRD §4.4). */
  for (const e of graph.edges) {
    if (edgeExplanations.has(e.id)) continue;
    const msg = EDGE_REASON_COPY[e.reason];
    if (msg) edgeExplanations.set(e.id, msg);
  }

  return {
    diagnostics: list,
    counts,
    repaired: list.some((d) => d.severity === 'repaired'),
    edgeExplanations,
    nodeExplanations,
  };
}

/**
 * 엣지 호버 문구의 단일 출처.
 *
 * 규칙: **모든 문장이 "왜"에 답한다.** "잘못됐다"고 말하는 문장은 하나도 없다.
 * (실제 문안은 WRITING.md 소관 — 여기 값은 기본값이고 앱에서 주입 가능)
 */
export const EDGE_REASON_COPY: Record<string, string | null> = {
  start: '여기서 시작해요.',
  end: '여기서 끝나요.',
  sequence: '아래에 적으신 순서대로 이어져요.',
  subtree: '이 단계 안에 적으신 하위 단계예요.',
  'branch-case': '이 조건일 때 가는 길이에요.',
  'case-join': '갈래가 끝나면 다시 여기로 모여요.',
  'and-fork': '동시에 시작해요.',
  'and-join': '이 갈래가 끝나기를 기다려요.',
  'join-out': '갈래가 모두 끝나면 이어져요.',
  'skip-else': '해당하지 않으면 이 단계를 건너뛰어요.',
  fallthrough: '갈래를 타지 않는 경우의 길이에요.',
  explicit: '직접 이으신 연결이에요.',
};

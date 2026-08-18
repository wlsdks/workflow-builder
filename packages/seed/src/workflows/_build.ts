/**
 * packages/seed/src/workflows/_build.ts
 *
 * 시드 흐름을 쓰기 위한 최소 빌더.
 *
 * 왜 있는가: 14개 흐름 × 평균 13단계를 `Item` 리터럴로 직접 쓰면 sortKey와
 * parentId 배선 실수가 반드시 난다. 그 실수는 `derive()`가 조용히 복구해 버려서
 * **테스트가 초록인 채로 그림만 틀린다.** 배선을 한 곳에 모아 놓는다.
 *
 * 번호(`n`)는 SEED-CONTENT.md 표의 행 번호 그대로다 — `'7'`, `'7a'`.
 * 문서를 읽으며 데이터와 대조할 수 있어야 하고, 접합 지도가 "GA-01 13번"을
 * 가리킬 때 그 13번이 어느 항목인지 기계가 답할 수 있어야 한다.
 */

import type { DurationBand, Edge, Item, ItemAttrs, NodeKind } from '@workflow/graph-core';

/** 시드 투입 시점. `lastConfirmedAt`은 "회사가 만든 문서"가 아님을 보이는 장치다 */
export const SEED_CONFIRMED_AT = new Date('2026-08-17T00:00:00.000Z');

export type StepSpec = {
  /** SEED-CONTENT.md 표의 행 번호. '1' / '7a' */
  n: string;
  kind?: NodeKind;
  /** 직원이 실제로 쓰는 말투 */
  title: string;
  /** 역할 계정 ID. 생략하면 "앞 단계와 같음" */
  who?: string;
  band?: DurationBand;
  tools?: readonly string[];
  /** "지난 7일 N건"이 문서에 있을 때만 */
  freq?: number;
  /** 😤 */
  pain?: boolean;
  attrs?: ItemAttrs;
  children?: readonly StepSpec[];
};

/** base62 형태의 형제 정렬 키. 바이트 순서 비교와 일치해야 한다 */
const sortKeyAt = (i: number): string =>
  String.fromCharCode(97 + Math.floor(i / 10)) + String(i % 10);

const prefix = (wfId: string): string => wfId.toLowerCase();

/** 'FIN-01' + '7a' → 'fin-01-s7a'. 접합 지도가 이 형태로 단계를 가리킨다 */
export const itemId = (wfId: string, n: string): string => `${prefix(wfId)}-s${n}`;

export function buildItems(wfId: string, specs: readonly StepSpec[]): Item[] {
  const out: Item[] = [];
  const walk = (list: readonly StepSpec[], parentId: string | null): void => {
    list.forEach((s, i) => {
      const id = itemId(wfId, s.n);
      out.push({
        id,
        parentId,
        sortKey: sortKeyAt(i),
        kind: s.kind ?? 'task',
        title: s.title,
        attrs: s.attrs ?? {},
        assigneeId: s.who ?? null,
        durationBand: s.band ?? null,
        toolIds: s.tools ?? [],
        freqLast7d: s.freq ?? null,
        painFlag: s.pain ?? false,
        lastConfirmedAt: SEED_CONFIRMED_AT,
        deletedAt: null,
      });
      if (s.children) walk(s.children, id);
    });
  };
  walk(specs, null);
  return out;
}

/** 갈래. `kind:'branch'`는 관례이고 역할은 위치가 정한다 (preprocess 교대 규칙) */
export const kase = (
  n: string,
  label: string,
  children: readonly StepSpec[] = [],
  attrs: ItemAttrs = {},
): StepSpec => ({
  n,
  kind: 'branch',
  title: label,
  attrs: { caseLabel: label, ...attrs },
  children,
});

/** 여기서 끝나는 갈래 */
export const kaseEnd = (
  n: string,
  label: string,
  children: readonly StepSpec[] = [],
): StepSpec => kase(n, label, children, { joinBehavior: 'end' });

/**
 * 명시적 엣지 — "N번으로 회귀" / "N번으로 건너뜀".
 * 되돌아가는 것이면 `attrs.returnToItemId`도 같이 적어야 인스펙터가 설명할 수 있다.
 */
export const link = (wfId: string, from: string, to: string, label?: string): Edge => ({
  id: `${prefix(wfId)}-e-${from}-to-${to}`,
  sourceId: itemId(wfId, from),
  targetId: itemId(wfId, to),
  kind: 'explicit',
  label,
});

/**
 * 파생 엣지 억제 — "이 갈래는 다음 형제로 가지 않는다".
 * 억제하지 않으면 갈래가 8번으로 건너뛰면서 동시에 4번으로도 이어진 그림이 된다.
 */
export const drop = (wfId: string, from: string, to: string): Edge => ({
  id: `${prefix(wfId)}-x-${from}-to-${to}`,
  sourceId: itemId(wfId, from),
  targetId: itemId(wfId, to),
  kind: 'suppressed',
});

/** 되돌아가는 단계의 attrs 한 벌 */
export const returnsTo = (wfId: string, n: string, rate: number): ItemAttrs => ({
  reworkRate: rate,
  returnToItemId: itemId(wfId, n),
});

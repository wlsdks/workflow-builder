/**
 * 골든 픽스처용 아웃라인 빌더.
 *
 * 실제 ID는 UUID지만 픽스처에서는 읽을 수 있는 짧은 문자열을 쓴다.
 * derive()는 ID의 형태에 의존하지 않는다 (예약 접두어만 피하면 된다).
 */

import type { DurationBand, Edge, Item, ItemAttrs, NodeKind } from '../types.ts';

export type Spec = {
  id: string;
  kind?: NodeKind;
  title?: string;
  attrs?: ItemAttrs;
  /** 생략하면 형제 인덱스로 자동 생성 */
  sortKey?: string;
  /** 고아·부모사이클 픽스처용 강제 지정 */
  parentIdOverride?: string | null;
  assigneeId?: string;
  durationBand?: DurationBand;
  toolIds?: string[];
  deleted?: boolean;
  children?: Spec[];
};

const key = (i: number): string =>
  String.fromCharCode(97 + Math.floor(i / 10)) + String(i % 10);

export function build(specs: readonly Spec[]): Item[] {
  const out: Item[] = [];
  const walk = (list: readonly Spec[], parentId: string | null): void => {
    list.forEach((s, i) => {
      out.push({
        id: s.id,
        parentId: s.parentIdOverride !== undefined ? s.parentIdOverride : parentId,
        sortKey: s.sortKey ?? key(i),
        kind: s.kind ?? 'task',
        title: s.title ?? s.id,
        attrs: s.attrs ?? {},
        assigneeId: s.assigneeId ?? null,
        durationBand: s.durationBand ?? null,
        toolIds: s.toolIds ?? [],
        deletedAt: s.deleted ? new Date(0) : null,
      });
      if (s.children) walk(s.children, s.id);
    });
  };
  walk(specs, null);
  return out;
}

/** 갈래 컨테이너. kind는 관례상 'branch'지만 derive()는 위치로만 역할을 정한다 */
export function kase(label: string, children: Spec[] = [], attrs: ItemAttrs = {}): Spec {
  return {
    id: `case-${label}`,
    kind: 'branch',
    title: label,
    attrs: { caseLabel: label, ...attrs },
    children,
  };
}

export const explicit = (id: string, sourceId: string, targetId: string, label?: string): Edge => ({
  id,
  sourceId,
  targetId,
  kind: 'explicit',
  label,
});

export const suppress = (id: string, sourceId: string, targetId: string): Edge => ({
  id,
  sourceId,
  targetId,
  kind: 'suppressed',
});

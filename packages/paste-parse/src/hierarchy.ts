/**
 * packages/paste-parse/src/hierarchy.ts  (PARSING §6)
 *
 * **전제: 계층도 §0.2 편향을 따른다. 증거가 없으면 평면(depth 0)이다.**
 * 잘못 중첩된 항목은 그래프에서 갈래로 그려지고, 되돌리려면 드래그 + 부모 재지정 op가
 * 필요하다. 평평한 리스트를 들여쓰는 건 `Tab` 한 번이다.
 */

import type { BranchMode, ItemKind, Line, MarkerClass, Segment } from './types.ts';
import { BRANCH_MARKERS, RE_ALT_HEAD } from './lexicon/branch.ts';
import { TERMINAL } from './lexicon/flow.ts';
import { liveMarker } from './lines.ts';

export const MAX_DEPTH = 2; // 0,1,2 — 3단을 넘으면 그림이 읽히지 않는다 (DESIGN.md §6)
export const MAX_BRANCH_CHILDREN = 4;

/**
 * 들여쓰기 폭을 나누기(`width / unit`) 하면 안 된다. 워드는 2·4·5·7열을 섞고, 한글은
 * 전각 공백을 쓰며, 탭과 공백이 한 문서에 공존한다. → **관측된 폭들을 정렬해 순위를 매긴다.**
 */
export function buildIndentLadder(lines: readonly Line[]): number[] {
  const widths = [...new Set(lines.filter((l) => l.text.trim()).map((l) => l.indentWidth))].sort((a, b) => a - b);
  const ladder: number[] = [];
  for (const w of widths) {
    if (!ladder.length || w - ladder[ladder.length - 1]! > 1) ladder.push(w);
  }
  return ladder; // ladder.indexOf(가장 가까운 값) = depth
}

export function depthFromIndent(w: number, ladder: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < ladder.length; i++) if (w >= ladder[i]! - 1) best = i;
  return Math.min(best, MAX_DEPTH);
}

/**
 * 마커 클래스의 서열을 **하드코딩하지 않는다.** 문서마다 다르다
 * (`1. → 가. → ①`인 문서도, `1. → 1) → -`인 문서도 있다). → **등장 순서로 학습한다.**
 */
export function assignDepthByMarkerClass(lines: readonly Line[]): Map<MarkerClass, number> {
  const stack: MarkerClass[] = [];
  const depth = new Map<MarkerClass, number>();
  for (const l of lines) {
    const c = liveMarker(l)?.cls;
    if (!c) continue;
    if (depth.has(c)) {
      stack.length = depth.get(c)!;
      stack.push(c);
      continue;
    }
    depth.set(c, Math.min(stack.length, MAX_DEPTH));
    stack.push(c);
  }
  return depth;
}

export type Draft = {
  id: string;
  seg: Segment;
  kind: ItemKind;
  branchMode?: BranchMode;
  depth: number;
  parentId?: string;
};

/**
 * 들여쓰기 사다리가 깊이 4 이상을 만들면 사다리를 의심한다 (§6.1) — 워드 자동 번호가
 * 붕괴한 흔적일 확률이 높다. 이때는 사다리를 버리고 마커 클래스로 폴백한다.
 *
 * 두 신호가 모두 있으면 **들여쓰기가 이긴다.**
 */
export function assignDepth(drafts: readonly Draft[], lines: readonly Line[]): void {
  const ladder = buildIndentLadder(lines);
  const byMarker = assignDepthByMarkerClass(lines);
  const useLadder = ladder.length <= 3 && ladder.length > 1;
  for (const d of drafts) {
    const cls = liveMarker(d.seg.line)?.cls;
    const mDepth = cls ? byMarker.get(cls) : undefined;
    const iDepth = useLadder ? depthFromIndent(d.seg.indentWidth, ladder) : undefined;
    d.depth = Math.min(iDepth ?? mDepth ?? 0, MAX_DEPTH);
  }
}

const isAlt = (d: Draft): boolean => BRANCH_MARKERS.alternative.test(d.seg.text) || RE_ALT_HEAD.test(d.seg.text);

/**
 * §6.3 — `branch` 항목 뒤에 오는 항목들을 무조건 자식으로 삼으면 흐름 전체가 분기 밑으로
 * 빨려 들어간다. **닫는 조건이 규칙의 본체다.**
 *
 * 마지막 두 줄이 중요하다 — **자식이 0~1개인 `xor`는 존재할 수 없다.** 갈래가 하나뿐인
 * 분기는 정의상 `skip`(조건부 수행)이다. 이 강등이 없으면 사용자는 빈칸을 받는다.
 */
export function nestBranchScope(items: Draft[]): void {
  for (let i = 0; i < items.length; i++) {
    const b = items[i]!;
    if (b.kind !== 'branch') continue;

    const parentIndent = b.seg.indentWidth;
    const parentDepth = b.depth;
    let taken = 0;

    for (let j = i + 1; j < items.length && taken < MAX_BRANCH_CHILDREN; j++) {
      const c = items[j]!;

      // ── 닫는 조건 (하나라도 걸리면 스코프 종료) ──────────────────────────
      if (c.seg.indentWidth < parentIndent) break; // 들여쓰기가 되돌아옴
      if (c.seg.blankBefore >= 2) break; // 빈 줄 블록 경계
      if (c.seg.marker && c.seg.marker.cls === b.seg.marker?.cls) break; // 같은 서열 마커 = 형제
      if (c.seg.speaker && b.seg.speaker && c.seg.speaker !== b.seg.speaker && !isAlt(c)) break; // 화자 전환
      if (TERMINAL.word.test(c.seg.text) && !isAlt(c)) break; // 종결 어휘
      if (c.kind === 'branch' && !isAlt(c)) break; // 다음 분기 시작

      // ── 자식으로 인정하는 조건 (셋 중 하나) ──────────────────────────────
      const sameSentence = c.seg.originLine === b.seg.originLine && c.seg.originSentence === b.seg.originSentence;
      const altMarker = isAlt(c);
      const deeperIndent = c.seg.indentWidth > parentIndent;
      if (!(sameSentence || altMarker || deeperIndent)) break;

      c.depth = Math.min(parentDepth + 1, MAX_DEPTH);
      c.parentId = b.id;
      taken++;
    }

    if (taken <= 1 && b.branchMode === 'xor') b.branchMode = 'skip';
  }
}

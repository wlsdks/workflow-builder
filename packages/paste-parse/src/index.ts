/**
 * packages/paste-parse/src/index.ts  (PARSING §1 · §9 · §10)
 *
 * 공개 API. 파이프라인 S0..S9를 순서대로 엮는다 — **각 단계는 앞 단계의 출력만 읽는다.**
 *
 *   S0 가드 → S1 전처리 → S2 소스 감지 → S3 라인 분할 → S4 노이즈 표시
 *   → S5 경계 판정 → S6 타입 분류 → S7 계층 추정 → S8 메타 힌트 → S9 후처리
 *
 * 그리고 전 파이프라인을 `assertLossless`가 감싼다. **어떤 예외도 사용자에게
 * "붙여넣기가 안 됐다"로 보이지 않는다.** 최악의 결과는 "안 나뉜 원문 한 덩어리"이고,
 * 그건 실패가 아니라 §0.1이 정의한 성공의 하한이다.
 */

import type { Confidence, Dropped, Line, ParsedItem, ParseResult, RuleHits, Segment, Span } from './types.ts';
import { TextMap, applyNoise, chatPrefixes, markNoise, textNoiseReason } from './preprocess.ts';
import { rejoinWrapped, splitLines, validateMarkerRuns, liveMarker } from './lines.ts';
import { detect } from './detect.ts';
import { buildSegments, trimSpan } from './boundary.ts';
import { classify, type Verdict } from './classify.ts';
import { assignDepth, nestBranchScope, type Draft } from './hierarchy.ts';
import { extractDuration, extractFreq, pickAssignee, scanDocument, within } from './hints.ts';
import { assertLossless } from './lossless.ts';
import { dominantStyle, hasActionPredicate } from './lexicon/verbs.ts';
import { fixEnding } from './lexicon/endings.ts';

export * from './types.ts';
export { assertLossless, LossError, titleDrift } from './lossless.ts';
export { CLAUSE_THRESHOLD, MIN_CLAUSE, MAX_SPLIT_PER_SENTENCE } from './clause.ts';
export { MAX_DEPTH } from './hierarchy.ts';
export { detect } from './detect.ts';
export { TextMap } from './preprocess.ts';

export const RULE_VERSION = 'rules@1';
export const PIPELINE_ID = 'rules@1';

/** §10.3 크기 가드 */
export const LIMITS = {
  /** 이하 & 200줄 이하 → 메인 스레드 동기 (STATES.md §성능: 300ms 예산) */
  SYNC_CHARS: 8_000,
  SYNC_LINES: 200,
  /** 이 지점까지만 규칙을 돌린다 */
  PARSE_CHARS: 20_000,
  PARSE_LINES: 2_000,
  /** 초과 시 파싱 자체를 시도하지 않는다 */
  HARD_CHARS: 200_000,
  /** 워커 내부 예산 */
  TIME_BUDGET_MS: 800,
  /** 비공백 이 미만이면 파싱하지 않고 그대로 1항목 */
  MIN_CHARS: 20,
} as const;

const countLines = (t: string): number => {
  let n = 1;
  for (let i = 0; i < t.length; i++) if (t[i] === '\n') n++;
  return n;
};

export function route(text: string): 'sync' | 'worker' | 'raw' {
  if (text.length > LIMITS.HARD_CHARS) return 'raw';
  if (text.length <= LIMITS.SYNC_CHARS && countLines(text) <= LIMITS.SYNC_LINES) return 'sync';
  return 'worker';
}

const emptyHits = (): RuleHits => ({ newline: 0, numbering: 0, verb: 0, detail: {} });

/* ────────────────────────────────────────────────────────────────────────────
 * 공개 진입점
 * ──────────────────────────────────────────────────────────────────────────── */

export type ParseOptions = {
  /** 실패를 삼키지 않고 던진다 — 테스트·개발용 */
  strict?: boolean;
};

export function parse(orig: string, opts: ParseOptions = {}): ParseResult {
  try {
    const r = parseInner(orig);
    assertLossless(orig, r); // 실패하면 아래 catch로
    return r;
  } catch (e) {
    if (opts.strict) throw e;
    // 텔레메트리 (파싱 실패는 조용히 넘어가면 안 된다). 순수 패키지라 던지는 대신 결과에 남긴다
    return singleBlock(orig, 'single_block', [`fallback:${(e as Error).message}`]);
  }
}

/** 항목 1개 = 원문 전체. §0.1이 정의한 **성공의 하한** */
function singleBlock(orig: string, reason: ParseResult['failure'] extends undefined ? never : NonNullable<ParseResult['failure']>['reason'], reasons: string[] = []): ParseResult {
  const span = trimSpan(orig, [0, orig.length]) ?? [0, 0];
  const title = orig.slice(span[0], span[1]);
  return {
    items: title
      ? [{
          id: 'it-1',
          title,
          kind: 'task',
          depth: 0,
          toolHints: [],
          sourceRange: span,
          boundaryConfidence: 0.2,
          boundaryBy: 'R0.raw',
          classifyRule: 'default',
        }]
      : [],
    dropped: [],
    confidence: 'low',
    ruleHits: emptyHits(),
    failure: { reason },
    sourceHint: 'unknown',
    traits: [],
    ruleVersion: RULE_VERSION,
    pipelineId: PIPELINE_ID,
    confidenceReasons: ['single_block', ...reasons],
    confidenceScore: 0,
    unmatchedToolCandidates: [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 파이프라인 본체
 * ──────────────────────────────────────────────────────────────────────────── */

function parseInner(orig: string): ParseResult {
  // ── S0 가드 ────────────────────────────────────────────────────────────
  if (orig.replace(/\s/g, '').length < LIMITS.MIN_CHARS) return singleBlock(orig, 'too_short');
  if (orig.length > LIMITS.HARD_CHARS) return singleBlock(orig, 'over_limit');

  // 상한 초과분은 **자르지 않는다.** 줄 경계로 스냅해 꼬리로 남긴다 (§10.2)
  let head = orig;
  let tailRange: Span | null = null;
  if (orig.length > LIMITS.PARSE_CHARS) {
    let cut = orig.lastIndexOf('\n', LIMITS.PARSE_CHARS);
    if (cut < 0) cut = LIMITS.PARSE_CHARS;
    head = orig.slice(0, cut);
    tailRange = trimSpan(orig, [cut, orig.length]);
  }

  // ── S1 전처리 ──────────────────────────────────────────────────────────
  const map = TextMap.of(head);
  const work = map.work;
  const hits = emptyHits();

  // ── S3 라인 분할 (S2가 Line[]을 필요로 하므로 먼저 돈다) ─────────────────
  const rawLines = splitLines(work);
  // ── S2 소스 유형 감지 ───────────────────────────────────────────────────
  const detection = detect(rawLines, work);
  const { lines, rejoined } = rejoinWrapped(rawLines, detection, work);
  if (rejoined) hits.detail['R5.rejoined'] = rejoined;
  const demoted = validateMarkerRuns(lines);
  if (demoted) hits.detail['R1.demoted'] = demoted;

  // ── S8(선행) 문서 1회 스캔 — §12.1 병목 1을 여기서 끝낸다 ────────────────
  const scan = scanDocument(work);

  // ── S4 노이즈 표시 ──────────────────────────────────────────────────────
  const prefixes = detection.traits.has('timestamped') ? chatPrefixes(lines) : [];
  const content = new Map<number, Span>();
  for (const l of lines) content.set(l.i, [l.span[0], l.span[1]]);
  for (const p of prefixes) content.set(p.line, [p.span[1], lines.find((l) => l.i === p.line)!.span[1]]);

  const noise = markNoise({ lines, work, detection, prefixes, content });
  const { kept } = applyNoise(noise.dropped, work);
  let dropped: Dropped[] = kept.filter((d) => d.range[1] > d.range[0]).sort((a, b) => a.range[0] - b.range[0]);
  for (const d of dropped) hits.detail[`N.${d.reason}`] = (hits.detail[`N.${d.reason}`] ?? 0) + 1;

  // ── S5 경계 판정 ────────────────────────────────────────────────────────
  let segments = buildSegments({
    work, lines, detection, dropped, prefixes, tools: scan.tools, people: scan.people, hits,
  });

  // 세그먼트 단위 노이즈 (§11 F6 — 한 줄 안의 세 번째 문장만 메타 통계인 경우) ─
  const keptSegs: Segment[] = [];
  for (const s of segments) {
    const reason = s.marker ? null : textNoiseReason(s.text);
    if (reason) dropped.push({ range: s.span, reason, tier: 'demote' });
    else keptSegs.push(s);
  }
  segments = coalesceFragments(keptSegs, work);
  dropped.sort((a, b) => a.range[0] - b.range[0]);

  // ── G-a. 노이즈 제거 후 단계 후보가 0개 → 제거 전량 롤백 (§8.6) ───────────
  if (segments.length === 0 && dropped.length > 0) {
    dropped = [];
    segments = buildSegments({
      work, lines, detection, dropped, prefixes, tools: scan.tools, people: scan.people, hits: emptyHits(),
    });
  }

  // ── S6 분류 + S7 계층 ───────────────────────────────────────────────────
  const bodies = segments.map((seg) => ({ ...seg, text: baseTitle(seg) }));
  const verdicts: Verdict[] = bodies.map((seg, i) => {
    const siblingsAhead = bodies.slice(i + 1, i + 4);
    const childCandidates = siblingsAhead.filter(
      (s) => s.originLine === seg.originLine && s.originSentence === seg.originSentence,
    ).length;
    return classify(seg, { siblingsAhead, childCandidates });
  });

  const drafts: Draft[] = segments.map((seg, i) => ({
    id: `it-${i + 1}`,
    seg,
    kind: verdicts[i]!.kind,
    branchMode: verdicts[i]!.branchMode,
    depth: 0,
  }));
  assignDepth(drafts, lines);
  nestBranchScope(drafts);

  // ── S8 메타 힌트 + S9 후처리 ────────────────────────────────────────────
  const mentionByLine = new Map<number, string>();
  for (const p of scan.people) {
    if (p.kind !== 'person') continue;
    const line = lines.find((l) => l.span[0] <= p.span[0] && p.span[1] <= l.span[1]);
    if (!line) continue;
    const startsLine = work.slice(line.span[0], p.span[0]).trim().replace(/^[-*+•]\s*/, '') === '';
    if (startsLine && !mentionByLine.has(line.i)) mentionByLine.set(line.i, p.name);
  }

  const rawTitles = segments.map((s) => baseTitle(s));
  const style = dominantStyle(rawTitles);

  let items: ParsedItem[] = drafts.map((d, i) => {
    const seg = d.seg;
    const v = verdicts[i]!;
    let title = rawTitles[i]!;
    if (seg.fromClause) title = fixEnding(title, style); // P2 — 절 분할로 생긴 항목에만
    title = title.replace(/[,·\s]+$/, '');

    const tools = scan.tools.filter((t) => within(seg.span, t.span));
    const people = scan.people.filter((p) => within(seg.span, p.span));
    const dur = extractDuration(seg.text);
    const freq = extractFreq(seg.text);
    const assignee = seg.cells?.assigneeHint ?? pickAssignee(people) ?? mentionByLine.get(seg.originLine);

    const item: ParsedItem = {
      id: d.id,
      title,
      kind: d.kind,
      depth: d.depth,
      toolHints: dedupeDisplay(tools.map((t) => t.display)),
      sourceRange: seg.span,
      boundaryConfidence: seg.boundaryConfidence,
      boundaryBy: seg.boundaryBy,
      classifyRule: v.rule,
    };
    if (d.parentId) item.parentId = d.parentId;
    if (d.branchMode) item.branchMode = d.branchMode;
    if (v.branchCondition) item.branchCondition = seg.cells?.branchCondition ?? v.branchCondition;
    if (v.waitFor) item.waitFor = v.waitFor;
    if (assignee) item.assigneeHint = assignee;
    if (dur) {
      item.durationHint = dur.hint;
      item.durationBand = dur.band;
    } else if (seg.cells?.durationHint) {
      item.durationHint = seg.cells.durationHint;
    }
    if (freq) item.freqHint = freq;
    if (v.holdSuspect) item.holdSuspect = true;
    if (v.isTerminal) item.isTerminal = true;
    return item;
  });

  items = postprocess(items, dropped, hits, work);

  // ── 좌표를 원문으로 되돌린다 ────────────────────────────────────────────
  for (const it of items) it.sourceRange = map.toOrig(it.sourceRange);
  for (const d of dropped) d.range = map.toOrig(d.range);

  // ── 문서 전체에 걸린 메타 (§11 F6 docHints) ─────────────────────────────
  const docHints: { durationHint?: string; freqHint?: string } = {};
  for (const d of dropped) {
    if (d.reason !== 'meta_stat') continue;
    const t = orig.slice(d.range[0], d.range[1]);
    const dur = extractDuration(t);
    if (dur && !docHints.durationHint) docHints.durationHint = dur.hint;
    const f = extractFreq(t);
    if (f && !docHints.freqHint) docHints.freqHint = f;
  }

  // ── §10.1 아예 못 나눌 때 ────────────────────────────────────────────────
  if (items.length <= 1 && work.trim().length >= 200) {
    return singleBlock(orig, 'single_block');
  }

  const conf = computeConfidence({
    items, segments, dropped, detection, work,
    tailLen: tailRange ? tailRange[1] - tailRange[0] : 0,
  });

  const result: ParseResult = {
    items,
    dropped,
    confidence: conf.level,
    ruleHits: hits,
    sourceHint: detection.hint,
    traits: [...detection.traits],
    ruleVersion: RULE_VERSION,
    pipelineId: PIPELINE_ID,
    confidenceReasons: conf.reasons,
    confidenceScore: conf.score,
    unmatchedToolCandidates: scan.unmatched.slice(0, 20),
  };
  if (noise.docTitleHint) result.docTitleHint = noise.docTitleHint;
  if (docHints.durationHint || docHints.freqHint) result.docHints = docHints;
  if (tailRange) {
    result.unparsedTailRange = tailRange;
    result.unparsedTail = orig.slice(tailRange[0], tailRange[1]);
    result.failure = { reason: 'over_limit', at: tailRange[0] };
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * S9 후처리 (§1.2 P1..P8)
 * ──────────────────────────────────────────────────────────────────────────── */

/** 제목 후행 괄호 힌트 — 소요시간·담당·기한 메모는 배지로 가고 제목에서는 빠진다 */
const RE_TRAILING_PAREN = /\s*[(（][^()（）]{1,24}[)）]\s*$/;
/** `"사원증 발급 신청 → 총무팀"` 처럼 꼬리에 붙은 인계 화살표 */
const RE_TRAILING_HANDOFF = /\s*[→⇒]\s*\S{1,12}\s*$/;

/**
 * 조각 흡수 — 괄호 힌트만 남은 세그먼트는 **직전 세그먼트의 구간에 합친다.**
 *
 * `"… 조회한다. (약 10분)"`은 R6가 문장으로 두 조각을 만들지만 두 번째 조각은 단계가
 * 아니다. 여기서 합쳐두지 않으면 P3가 빈 항목으로 버리면서 `sourceRange`가
 * 소요시간을 잃는다 (§11 F1-05가 요구하는 `[109,139]`).
 */
function coalesceFragments(segs: readonly Segment[], work: string): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    const isParenOnly = /^[(（][^()（）]{1,24}[)）][.\s]*$/.test(s.text);
    if (prev && isParenOnly && prev.originLine === s.originLine) {
      const span: Span = [prev.span[0], s.span[1]];
      out[out.length - 1] = { ...prev, span, text: work.slice(span[0], span[1]) };
      continue;
    }
    out.push(s);
  }
  return out;
}

/** P1 제목 트리밍 — sourceRange는 마커를 포함한 채 유지한다 */
function baseTitle(seg: Segment): string {
  if (seg.cells) return seg.cells.title;
  let t = seg.text;
  const marker = liveMarker(seg.line);
  if (marker && seg.text.startsWith(seg.line.text.slice(seg.line.rawIndent.length, seg.line.rawIndent.length + marker.consumed))) {
    t = t.slice(marker.consumed);
  }
  t = t.replace(/^@[가-힣A-Za-z][가-힣A-Za-z0-9._-]{0,20}\s*[:：]?\s*/, '');
  t = t.replace(RE_TRAILING_PAREN, '');
  t = t.replace(RE_TRAILING_HANDOFF, '');
  t = t.replace(/[.\s]+$/, '');
  return t.trim();
}

/**
 * 흡수·병합은 **구간을 잇는** 연산이다. 두 항목 사이에 버림 구간이 있으면 이으면 안 된다 —
 * 버림 구간을 통째로 삼켜 무손실 파티션이 겹친다. (속성 테스트가 이걸 잡았다)
 */
const adjacent = (work: string, a: ParsedItem, b: ParsedItem): boolean =>
  work.slice(a.sourceRange[1], b.sourceRange[0]).trim() === '';

function postprocess(items: ParsedItem[], dropped: Dropped[], hits: RuleHits, work: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const it of items) {
    // P3 빈 항목 제거 → dropped('empty')로 강등
    if (!it.title.trim()) {
      dropped.push({ range: it.sourceRange, reason: 'empty', tier: 'demote' });
      continue;
    }
    const prev = out[out.length - 1];
    // P4 초단문 흡수 — title 길이 < 4 이고 동사 없음 → 직전 항목에 흡수 (구간 합침)
    if (prev && it.title.length < 4 && !hasActionPredicate(it.title) && prev.depth === it.depth && adjacent(work, prev, it)) {
      prev.sourceRange = [prev.sourceRange[0], it.sourceRange[1]];
      prev.title = `${prev.title} ${it.title}`.trim();
      hits.detail['P4.absorbed'] = (hits.detail['P4.absorbed'] ?? 0) + 1;
      continue;
    }
    // P5 중복 인접 병합 — 정규화 후 동일한 연속 항목 → 1개로
    if (prev && norm(prev.title) === norm(it.title) && adjacent(work, prev, it)) {
      prev.sourceRange = [prev.sourceRange[0], it.sourceRange[1]];
      hits.detail['P5.merged'] = (hits.detail['P5.merged'] ?? 0) + 1;
      continue;
    }
    out.push(it);
  }

  // P6 고아 자식 승격 — 부모가 사라진 자식은 한 단 올린다
  const ids = new Set(out.map((i) => i.id));
  for (const it of out) {
    if (it.parentId && !ids.has(it.parentId)) {
      delete it.parentId;
      it.depth = Math.max(0, it.depth - 1);
    }
    // P7 깊이 클램프
    if (it.depth > 2) {
      it.depth = 2;
      hits.detail['P7.clamped'] = (hits.detail['P7.clamped'] ?? 0) + 1;
    }
  }
  return out;
}

const norm = (s: string): string => s.replace(/[\s.,·]+/g, '');
const dedupeDisplay = (xs: readonly string[]): string[] => [...new Set(xs)];

/* ────────────────────────────────────────────────────────────────────────────
 * §9 신뢰도 산출
 * ──────────────────────────────────────────────────────────────────────────── */

export type Signals = {
  items: readonly ParsedItem[];
  segments: readonly Segment[];
  dropped: readonly Dropped[];
  detection: { certainty: number; hint: string };
  work: string;
  tailLen: number;
};

const rank = (c: Confidence): number => (c === 'high' ? 2 : c === 'mid' ? 1 : 0);

export function computeConfidence(s: Signals): { level: Confidence; score: number; reasons: string[] } {
  const n = Math.max(1, s.items.length);
  const markerCoverage = s.items.filter((i) => i.boundaryBy.startsWith('R1.') || i.boundaryBy.startsWith('R2.')).length / n;
  const predicateRatio = s.items.filter((i) => hasActionPredicate(i.title)).length / n;
  const lens = s.items.map((i) => i.title.length).sort((a, b) => a - b);
  const medLen = lens.length ? lens[lens.length >> 1]! : 0;
  const lengthSanity = medLen >= 6 && medLen <= 60 ? 1 : Math.max(0, 1 - Math.abs(medLen < 6 ? 6 - medLen : medLen - 60) / 20);
  const clauseRatio = s.items.filter((i) => i.boundaryBy.startsWith('R7.')).length / n;
  const total = Math.max(1, s.work.length + s.tailLen);
  const tailRatio = s.tailLen / total;
  const demotedRatio = s.dropped.filter((d) => d.tier === 'demote').reduce((a, d) => a + (d.range[1] - d.range[0]), 0) / total;
  const avgItemLen = s.items.reduce((a, i) => a + i.title.length, 0) / n;

  const score =
    0.3 * markerCoverage +
    0.2 * predicateRatio +
    0.15 * lengthSanity +
    0.15 * (1 - clauseRatio) +
    0.1 * s.detection.certainty +
    0.1 * (1 - tailRatio);

  const reasons: string[] = [];
  let level: Confidence = score >= 0.72 ? 'high' : score >= 0.45 ? 'mid' : 'low';
  const demote = (to: Confidence, why: string) => {
    if (rank(to) < rank(level)) {
      level = to;
      reasons.push(why);
    }
  };

  if (s.items.length < 2) demote('low', 'single_block');
  if (s.items.length > 60) demote('mid', 'too_many_items');
  if (tailRatio > 0.3) demote('mid', 'large_tail');
  if (demotedRatio > 0.5) demote('low', 'over_demoted');
  if (clauseRatio > 0.6) demote('mid', 'clause_heavy');
  if (avgItemLen < 5) demote('mid', 'fragments');
  if (s.detection.hint === 'unknown' && markerCoverage < 0.2) demote('mid', 'unknown_source');

  return { level, score, reasons };
}

/** 테스트·디버깅용 — 파이프라인 중간 산출물 */
export function debugLines(text: string): Line[] {
  return splitLines(TextMap.of(text).work);
}

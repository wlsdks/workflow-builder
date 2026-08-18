/**
 * packages/paste-parse/src/boundary.ts  (PARSING §3.4 · §3.5)
 *
 * S5 단계 경계 판정. 한 줄(또는 발화)은 **가장 높은 순위의 규칙 하나로만** 나뉘고,
 * 상위 규칙이 적중하면 하위 규칙은 그 단위 **안에서만** 다시 시도된다.
 *
 *   R1 명시 마커 (0.99) → R2 표 행 (0.95) → R3 대화 발화 (0.85)
 *   → R4 빈 줄 블록 (0.80) → R5 줄 (0.70) → R6 문장 (0.60) → R7 절 (가변)
 *
 * R7만 임계값을 갖는다. 나머지는 전부 **관측된 구조**이고, R7만 **추론**이기 때문이다 (§0.2).
 */

import type { Detection, Dropped, Line, RuleHits, Segment, Span, ToolHit, PersonHit, Trait } from './types.ts';
import { HitIndex, scoreClauseSplits, type SegCtx } from './clause.ts';
import { liveMarker } from './lines.ts';
import type { ChatPrefix } from './preprocess.ts';

/** R6 문장 경계 — 한국어 종결은 마침표 없이도 온다 */
export const RE_SENTENCE_END =
  /(?<=[가-힣])(?:다|요|죠|네요|습니다|ㅂ니다|십시오|세요|해요|어요|아요|군요|는군요|음|함|임|것|기)[.!?…]+(?=\s|$)|[.!?…]{1,3}(?=\s|$)/gu;

/** 잘못 끊으면 안 되는 것들 (마침표가 종결이 아닌 경우) */
export const RE_NOT_SENTENCE_END =
  /(?:\d\.\d|[A-Za-z]\.[A-Za-z]|(?:주식회사|㈜)\s?[가-힣]+\.|등\.|예\.|참고\.|vs\.|No\.|\.\w{2,4}$)/;

/** §3.5 — 엑셀·워드 표 복사는 **열이 곧 스키마**다 */
const COLUMN_ALIASES: Record<string, 'title' | 'assigneeHint' | 'toolHint' | 'durationHint' | 'branchCondition' | 'skip'> = {
  순번: 'skip', no: 'skip', NO: 'skip', 번호: 'skip',
  단계: 'title', 업무: 'title', 작업: 'title', 내용: 'title', 절차: 'title', 활동: 'title',
  담당: 'assigneeHint', 담당자: 'assigneeHint', 수행자: 'assigneeHint', 부서: 'assigneeHint',
  도구: 'toolHint', 시스템: 'toolHint', 사용도구: 'toolHint', 프로그램: 'toolHint',
  소요시간: 'durationHint', 소요: 'durationHint', 시간: 'durationHint',
  조건: 'branchCondition', 분기: 'branchCondition', 비고: 'skip', 비고사항: 'skip',
};

export type SegmentInput = {
  work: string;
  lines: readonly Line[];
  detection: Detection;
  /** 확정된 노이즈 구간 (정렬됨) */
  dropped: readonly Dropped[];
  prefixes: readonly ChatPrefix[];
  tools: readonly ToolHit[];
  people: readonly PersonHit[];
  hits: RuleHits;
};

const bump = (h: RuleHits, id: string, n = 1) => {
  h.detail[id] = (h.detail[id] ?? 0) + n;
};

/** 구간에서 앞뒤 공백을 잘라낸다. **문자열이 아니라 인덱스를 움직인다** */
export function trimSpan(work: string, span: Span): Span | null {
  let [s, e] = span;
  while (s < e && /\s/.test(work[s]!)) s++;
  while (e > s && /\s/.test(work[e - 1]!)) e--;
  return e > s ? [s, e] : null;
}

/** 한 줄에서 노이즈 구간을 뺀 나머지(=본문) 구간들 */
export function freeIntervals(lineSpan: Span, dropped: readonly Dropped[]): Span[] {
  const out: Span[] = [];
  let pos = lineSpan[0];
  for (const d of dropped) {
    if (d.range[1] <= lineSpan[0] || d.range[0] >= lineSpan[1]) continue;
    const s = Math.max(lineSpan[0], d.range[0]);
    const e = Math.min(lineSpan[1], d.range[1]);
    if (s > pos) out.push([pos, s]);
    pos = Math.max(pos, e);
  }
  if (pos < lineSpan[1]) out.push([pos, lineSpan[1]]);
  return out;
}

/** R6 — 한 줄에 2문장 이상일 때만 문장으로 나눈다 */
export function sentenceSplits(text: string, skipBefore = 0): number[] {
  const out: number[] = [];
  const re = new RegExp(RE_SENTENCE_END.source, RE_SENTENCE_END.flags);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= text.trimEnd().length) continue; // 마지막 종결은 경계가 아니다
    if (end <= skipBefore) continue; // ★ 마커의 마침표(`1.`)는 문장 종결이 아니다
    // 종결 어미 없이 구두점만 있는 경우, 앞 글자가 한글/닫는 괄호일 때만 문장 끝으로 본다.
    // 이 가드가 없으면 `1.`·`8/20.`·`Ver 2.` 이 전부 문장 경계가 된다
    const prev = text[m.index - 1] ?? '';
    if (/^[.!?…]/.test(m[0]) && !/[가-힣)\]」』"']/.test(prev)) continue;
    const around = text.slice(Math.max(0, m.index - 6), Math.min(text.length, end + 2));
    if (RE_NOT_SENTENCE_END.test(around)) continue;
    out.push(end);
  }
  return out;
}

export function buildSegments(input: SegmentInput): Segment[] {
  const { work, lines, detection, dropped, prefixes, tools, people, hits } = input;
  const traits = detection.traits;
  const segments: Segment[] = [];
  const speakerOf = new Map<number, string>(prefixes.map((p) => [p.line, p.speaker]));

  // PPT 도형: 쪼갤 문장 자체가 없다 → R5만 쓰고 R6·R7을 끈다 (§2.4)
  const flatLines = traits.has('noun_ended') && traits.has('short_lines');
  const tableCols = traits.has('tabbed') ? detection.meta.tabCols : null;
  const header = tableCols != null ? tableHeader(lines, tableCols) : null;
  /** 부록 B `R7.gated.*` — 단위마다 새로 만들지 않고 한 문서에 하나만 둔다 */
  const gated: Record<string, number> = {};

  for (const line of lines) {
    for (const raw of freeIntervals(line.span, dropped)) {
      const span = trimSpan(work, raw);
      if (!span) continue;
      const text = work.slice(span[0], span[1]);

      // ── 단위의 경계 규칙을 정한다 (가장 높은 순위 하나만) ────────────────
      const marker = liveMarker(line);
      let by = 'R5.line';
      let conf = 0.7;
      if (marker && span[0] === trimSpan(work, line.span)?.[0]) {
        by = `R1.${marker.cls}`;
        conf = 0.99;
        hits.numbering++;
      } else if (tableCols != null && text.includes('\t')) {
        by = 'R2.tableRow';
        conf = 0.95;
        hits.numbering++;
      } else if (speakerOf.has(line.i)) {
        by = 'R3.utterance';
        conf = 0.85;
        hits.newline++;
      } else if (line.blankBefore >= 2) {
        by = 'R4.blankBlock';
        conf = 0.8;
        hits.newline++;
      } else {
        hits.newline++;
      }
      bump(hits, by);

      const base: Omit<Segment, 'span' | 'text' | 'boundaryBy' | 'boundaryConfidence' | 'originSentence' | 'fromClause'> = {
        line,
        originLine: line.i,
        marker,
        indentWidth: line.indentWidth,
        blankBefore: line.blankBefore,
        speaker: speakerOf.get(line.i) ?? null,
      };

      // ── R2: 표 행은 열이 스키마다. 문장·절로 다시 쪼개지 않는다 ───────────
      if (by === 'R2.tableRow') {
        segments.push({
          ...base,
          span,
          text,
          originSentence: 0,
          boundaryBy: by,
          boundaryConfidence: conf,
          fromClause: false,
          cells: mapColumns(text, header),
        });
        continue;
      }

      // ── R6 문장 → R7 절 ────────────────────────────────────────────────
      // 강등된 가짜 마커(`"가. 첨부 확인한다"`)의 마침표도 문장 종결이 아니다.
      // 여기서 막지 않으면 R6가 `"가."`라는 2자짜리 항목을 만든다
      const markerLen = line.marker && line.span[0] === span[0] - line.rawIndent.length ? line.marker.consumed : 0;
      const sentBounds = flatLines ? [] : sentenceSplits(text, markerLen);
      let sentStart = 0;
      let sentIdx = 0;
      const cuts = [...sentBounds, text.length];
      for (const cut of cuts) {
        const sText = text.slice(sentStart, cut);
        const sOff = span[0] + sentStart;
        const first = sentIdx === 0;
        if (sText.trim()) {
          // ★ 히트는 **이 단위 안의 것만** 넘긴다. 문서 전체 히트를 그대로 주면
          //   `firstAfter`가 다음 줄의 도구를 집어 "도구 전환"을 조작해낸다.
          const sEnd = sOff + sText.length;
          const clauseCuts = flatLines
            ? []
            : scoreClauseSplits(
                sText,
                clauseCtx(
                  sOff,
                  tools.filter((t) => t.span[0] >= sOff && t.span[1] <= sEnd),
                  people.filter((p) => p.span[0] >= sOff && p.span[1] <= sEnd),
                  traits,
                  gated,
                ),
              );
          let cStart = 0;
          let ci = 0;
          for (const cc of [...clauseCuts.map((c) => c.at), sText.length]) {
            const piece = trimSpan(work, [sOff + cStart, sOff + cc]);
            cStart = cc;
            if (!piece) {
              ci++;
              continue;
            }
            const isFirstPiece = ci === 0;
            const cut0 = clauseCuts[ci - 1];
            const segBy = isFirstPiece ? (first ? by : 'R6.sentence') : `R7.${cut0?.kind ?? 'go'}`;
            const segConf = isFirstPiece ? (first ? conf : 0.6) : Math.min(1, cut0?.score ?? 0.75);
            if (!isFirstPiece) {
              hits.verb++;
              bump(hits, segBy);
            } else if (!first) {
              hits.verb++;
              bump(hits, 'R6.sentence');
            }
            segments.push({
              ...base,
              span: piece,
              text: work.slice(piece[0], piece[1]),
              originSentence: sentIdx,
              boundaryBy: segBy,
              boundaryConfidence: segConf,
              fromClause: clauseCuts.length > 0,
            });
            ci++;
          }
        }
        sentStart = cut;
        sentIdx++;
      }
    }
  }
  for (const [k, v] of Object.entries(gated)) bump(hits, `R7.gated.${k}`, v);
  return segments;
}

function clauseCtx(
  offset: number,
  tools: readonly ToolHit[],
  people: readonly PersonHit[],
  traits: ReadonlySet<Trait>,
  gated: Record<string, number>,
): SegCtx {
  // 단위 좌표로 옮긴 히트만 넘긴다 — §12.1대로 스캔은 이미 문서 1회로 끝났다
  const local = <T extends { span: Span }>(xs: readonly T[]): T[] =>
    xs.map((x) => ({ ...x, span: [x.span[0] - offset, x.span[1] - offset] as Span }));
  return {
    toolIdx: new HitIndex(local(tools)),
    peopleIdx: new HitIndex(local(people)),
    traits,
    gated,
  };
}

function tableHeader(lines: readonly Line[], cols: number): (keyof NonNullable<Segment['cells']> | 'skip')[] | null {
  const first = lines.find((l) => l.text.includes('\t'));
  if (!first) return null;
  const cells = first.text.split('\t').map((c) => c.trim());
  if (cells.length !== cols) return null;
  const mapped = cells.map((c) => COLUMN_ALIASES[c] ?? null);
  // 헤더로 인정하려면 절반 이상이 알려진 열 이름이어야 한다
  return mapped.filter((x) => x != null).length * 2 >= cells.length
    ? mapped.map((x) => x ?? 'skip')
    : null;
}

/**
 * 헤더가 없으면 **열 개수로 추정**한다. 실패하면 **행 전체를 title로** 쓴다 —
 * 무손실 우선 (§3.5).
 */
function mapColumns(text: string, header: readonly (string | null)[] | null): NonNullable<Segment['cells']> {
  const cells = text.split('\t').map((c) => c.trim());
  const out: NonNullable<Segment['cells']> = { title: text.trim() };
  if (header && header.length === cells.length) {
    const parts: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const role = header[i];
      const v = cells[i]!;
      if (!v || role === 'skip' || role == null) continue;
      if (role === 'title') parts.push(v);
      else if (role === 'assigneeHint') out.assigneeHint = v;
      else if (role === 'toolHint') out.toolHint = v;
      else if (role === 'durationHint') out.durationHint = v;
      else if (role === 'branchCondition') out.branchCondition = v;
    }
    if (parts.length) out.title = parts.join(' ');
    return out;
  }
  const nonEmpty = cells.filter((c) => c.length > 0);
  if (nonEmpty.length >= 2) {
    const numericFirst = /^\d{1,3}$/.test(nonEmpty[0]!);
    const body = numericFirst ? nonEmpty.slice(1) : nonEmpty;
    out.title = body[0] ?? text.trim();
    if (body[1]) out.assigneeHint = body[1];
    if (body[2]) out.toolHint = body[2];
  }
  return out;
}

/**
 * packages/scoring/src/ecrs.ts — 제거 후보 자동 검출 12종.
 *
 * ── 순서가 규칙이다 (D-007) ────────────────────────────────────────────────
 *  **ECRS가 랭킹보다 먼저 돈다.** 제거 후보로 판정된 단계는 자동화 후보 스코프에서
 *  빠진다. 제거 가능한 단계를 자동화 후보 1위로 올리는 것은 틀린 답이 아니라
 *  **해로운 답**이다 — 없앨 수 있는 일에 예산과 개발 리소스를 붙이게 만든다.
 *
 * ── 검출은 단계 단위, 노출은 유형 단위 ────────────────────────────────────
 *  개별 단계를 그대로 관리자에게 올리면 문서 1개 = 사람 1명인 조직에서 개인이
 *  식별된다. `rollupForAdmin()`이 그 경계다 (D-002, 예외 없음).
 *
 * ── 입력에 대하여 ──────────────────────────────────────────────────────────
 *  이 패키지는 그래프를 파생하지 않는다. graph-core가 이미 계산한 값
 *  (reachProbability · expectedPasses · touchH · waitH · 사이클)을 **숫자로** 받는다.
 *  여기서 그래프 의미론을 다시 해석하면 두 벌의 정의가 생기고 반드시 어긋난다.
 */

import { annualEvents } from './volume.ts';
import { fmtDays, fmtHours } from './value.ts';
import {
  answerOf,
  type DurationBand,
  type PromptAnswers,
  type ToolCatalog,
  type ToolEntry,
  type Volume,
} from './types.ts';

/* ── 입력 모델 ────────────────────────────────────────────────────────────── */

export type WaitFor = 'approval' | 'reply' | 'time' | 'resource';

export type EcrsStep = {
  id: string;
  itemId: string;
  kind: 'task' | 'branch' | 'hold';
  title: string;
  waitFor?: WaitFor;
  band: DurationBand | null;
  toolIds: readonly string[];
  assigneeId: string | null;
  /** graph-core `perNode` */
  reachProbability: number;
  expectedPasses: number;
  touchH: number;
  waitH: number;
  /** ASSEMBLY의 산출물 정규화 결과. 새 사전을 만들지 않는다 */
  artifactNouns: readonly string[];
  volume: Volume;
  /** 지난 7일 건수 원값 — E7만 쓴다 */
  freqLast7d?: number | null;
  /** 반려 시 돌아갈 경로(back edge 또는 returnToItemId)가 있는가 */
  hasReturnPath?: boolean;
  /** 이 노드가 속한 사이클의 반려율 중 최대 */
  cycleReworkRate?: number | null;
  /** 분기 노드의 갈래들. 서브트리는 graph-core가 계산해서 준다 */
  cases?: readonly { label: string; share: number | null; nodeIds: readonly string[] }[];
  /** 결재자가 실제로 손대는 시간 (E1). 기본 0.05h */
  approverTouchH?: number;
};

export type EcrsDoc = {
  docId: string;
  orgId: string;
  ownerId: string;
  deptId: string;
  steps: readonly EcrsStep[];
  /** [source, target] — 합성 노드는 이미 접혀 있다 */
  edges: readonly (readonly [string, string])[];
  answers: PromptAnswers;
};

/** ASSEMBLY의 확정 링크. status IN ('confirmed','auto')인 것만 들어온다 (D-043) */
export type OverlapLink = {
  linkType: 'overlap' | 'handoff';
  outboundDocId: string;
  nodeIds: readonly string[];
  objectName: string;
  deptA: string;
  deptB: string;
  /** 같은 산출물을 두 곳에서 각각 요구하는가 */
  sameArtifactRequestedTwice: boolean;
};

export type EcrsContext = {
  docs: readonly EcrsDoc[];
  catalog: ToolCatalog;
  /** 조직 커버리지 — E3의 정밀도가 여기에 달려 있다 */
  orgCoverage: number;
  /** 조직 코퍼스에서 inbound로 등장하는 정규화 라벨 (원문은 테넌트 밖으로 안 나간다) */
  orgInboundLabels: readonly string[];
  /** 접합 소켓으로 밖에 나가는 산출물 라벨 */
  outboundSocketLabels?: readonly string[];
  confirmedLinks?: readonly OverlapLink[];
};

/* ── 출력 모델 ────────────────────────────────────────────────────────────── */

export type EcrsAction = 'eliminate' | 'combine' | 'rearrange' | 'simplify';

export type ExecCopy = {
  /** 한 줄. 부서를 주어로 쓰지 않는다 (POLICY §5.2) */
  headline: string;
  evidence: string;
  proposal: string;
  effect: string;
};

export type EliminationSaving = {
  /** 회수되는 사람 시간 (연간, 시간). null = 이 패턴의 가치는 사람 시간이 아니다 */
  laborHPerYear: number | null;
  leadDaysSaved: number | null;
  /** 개발이 필요한가 — 이게 제거 후보가 잘 팔리는 이유다 */
  devEffort: 'none' | 'config' | 'small' | 'project';
};

export type EliminationHit = {
  patternId: string;
  action: EcrsAction;
  label: string;
  docId: string;
  nodeIds: readonly string[];
  /** 검출 근거 — 숫자 그대로. 사람이 검증할 수 있어야 한다 */
  evidence: Record<string, string | number>;
  execCopy: ExecCopy;
  saving: EliminationSaving;
  /** 0..1 — 이 검출이 오탐일 가능성의 역수 */
  precision: number;
};

export type EliminationPattern = {
  id: string;
  action: EcrsAction;
  label: string;
  detect: (ctx: EcrsContext) => EliminationHit[];
};

/* ── 어휘 사전 ────────────────────────────────────────────────────────────── */

const TRANSFER_VERBS = ['입력', '기입', '적어', '옮겨', '옮기', '전기', '등록', '올리', '정리', '복사'];
const PRODUCE_VERBS = ['작성', '만들', '정리', '취합', '집계', '보고서', '대장', '리포트', '내역서', '현황'];
const CHECK_VERBS = ['확인', '검토', '점검', '체크', '대조', '검수', '크로스체크', '재확인', '이중'];
const URGE_VERBS = ['독촉', '재촉', '리마인드', '다시 요청', '재요청', '확인 요청', '언제 되', '푸시'];

/* ── 그래프 도우미 (graph-core를 물지 않고 인접만 본다) ───────────────────── */

function adjacency(doc: EcrsDoc): {
  next: Map<string, string[]>;
  prev: Map<string, string[]>;
  byId: Map<string, EcrsStep>;
} {
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  for (const [a, b] of doc.edges) {
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (prev.get(b) ?? prev.set(b, []).get(b)!).push(a);
  }
  return { next, prev, byId: new Map(doc.steps.map((s) => [s.id, s])) };
}

function reach(from: string, edges: Map<string, string[]>, stopAt?: (id: string) => boolean): Set<string> {
  const seen = new Set<string>();
  const stack = [...(edges.get(from) ?? [])];
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    if (stopAt?.(v)) continue;
    stack.push(...(edges.get(v) ?? []));
  }
  return seen;
}

function hopsWithin(doc: EcrsDoc, maxHops: number): [EcrsStep, EcrsStep][] {
  const { next, byId } = adjacency(doc);
  const out: [EcrsStep, EcrsStep][] = [];
  const seen = new Set<string>();
  for (const a of doc.steps) {
    let frontier = [a.id];
    for (let h = 0; h < maxHops; h++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        for (const t of next.get(id) ?? []) {
          nextFrontier.push(t);
          const b = byId.get(t);
          if (!b || b.id === a.id) continue;
          const key = `${a.id}>${b.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([a, b]);
        }
      }
      frontier = nextFrontier;
    }
  }
  return out;
}

/** 같은 담당자가 연속으로 붙어 있는 구간 (단일 후속 체인만 본다) */
function assigneeRuns(doc: EcrsDoc, minLen: number): { nodeIds: string[]; itemIds: string[]; leadH: number }[] {
  const { next, byId } = adjacency(doc);
  const runs: { nodeIds: string[]; itemIds: string[]; leadH: number }[] = [];
  const consumed = new Set<string>();

  for (const s of doc.steps) {
    if (consumed.has(s.id) || s.assigneeId == null) continue;
    const chain = [s];
    let cur = s;
    for (;;) {
      const outs = next.get(cur.id) ?? [];
      if (outs.length !== 1) break;
      const n = byId.get(outs[0]!);
      if (!n || n.assigneeId !== s.assigneeId) break;
      chain.push(n);
      cur = n;
    }
    if (chain.length >= minLen) {
      for (const c of chain) consumed.add(c.id);
      runs.push({
        nodeIds: chain.map((c) => c.id),
        itemIds: chain.map((c) => c.itemId),
        leadH: chain.reduce((a, c) => a + (c.touchH + c.waitH) * c.expectedPasses, 0),
      });
    }
  }
  return runs;
}

/* ── 한국어 유사도 — 문자 바이그램 Jaccard ───────────────────────────────── */

const PARTICLES = /(을|를|이|가|은|는|의|에|에서|으로|로|와|과|도|만|까지|부터)$/;

export function normalizeKo(s: string): string {
  return s
    .replace(/[\s()[\]{}·,./\\-]/g, '')
    .split(/(?=[가-힣]{2,})/)
    .map((t) => t.replace(PARTICLES, ''))
    .join('');
}

function bigrams(s: string): Set<string> {
  const t = normalizeKo(s);
  if (t.length <= 1) return new Set(t ? [t] : []);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function simKo(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function maxPairwiseSim(as: readonly string[], bs: readonly string[]): number {
  let best = 0;
  for (const a of as) for (const b of bs) best = Math.max(best, simKo(a, b));
  return best;
}

const has = (title: string, dict: readonly string[]) => dict.some((w) => title.includes(w));
const perYearOf = (s: EcrsStep) => annualEvents(s.volume);
const weighted = (s: EcrsStep) => s.reachProbability * s.expectedPasses * s.touchH;

/* ── E1 반려율 0%인 승인 단계 ────────────────────────────────────────────── */

export const E1: EliminationPattern = {
  id: 'E1',
  action: 'eliminate',
  label: '반려된 적 없는 승인',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.steps) {
        if (n.kind !== 'hold' || n.waitFor !== 'approval') continue;

        // ① "최근 6개월에 실제로 반려된 적 있나요?" 에 '없다'
        const neverRejected = answerOf(doc.answers, 'rejection-6m', n.itemId)?.choice === 'none';
        // ② 반려 시 돌아갈 경로가 아예 없다
        const hasReturnPath = n.hasReturnPath === true;
        // ③ 사이클이 있어도 반려율이 0으로 응답됐다
        const cycleRate = n.cycleReworkRate ?? 0;

        if (!(neverRejected || (!hasReturnPath && cycleRate === 0))) continue;
        const rate = neverRejected ? 0 : cycleRate;
        if (rate > 0) continue;

        const waitH = n.waitH * n.reachProbability;
        // ④ 대기가 짧으면 없앨 가치가 없다. 8시간(하루의 근무) 미만은 무시
        if (waitH < 8) continue;

        const perYear = perYearOf(n);
        hits.push({
          patternId: 'E1',
          action: 'eliminate',
          label: E1.label,
          docId: doc.docId,
          nodeIds: [n.id],
          evidence: {
            '평균 대기': fmtHours(waitH),
            '6개월 반려 건수': 0,
            '월 발생': Math.round(perYear / 12),
            '돌아갈 경로': hasReturnPath ? '있음' : '없음',
          },
          execCopy: {
            headline: `반려된 적 없는 승인 단계가 흐름을 ${fmtDays(waitH / 24)} 붙잡고 있어요`,
            evidence: `최근 6개월 반려 0건 · 평균 대기 ${fmtHours(waitH)} · 월 ${Math.round(perYear / 12)}건`,
            // ★ "없애세요"가 아니다. 승인이 있어서 사람들이 조심하는 경우와 구분할 수 없기 때문이다
            proposal: '결재 기준선을 올리고, 사후 월간 리포트로 대체',
            effect: `건당 ${fmtDays(waitH / 24)} 단축 · 연 ${fmtHours((n.approverTouchH ?? 0.05) * perYear)} 회수`,
          },
          saving: {
            // 승인 단계 자체의 사람 시간(결재자 클릭)은 작다. 가치는 리드타임에 있다
            laborHPerYear: (n.approverTouchH ?? 0.05) * perYear,
            leadDaysSaved: waitH / 24,
            devEffort: 'none',
          },
          precision: neverRejected ? 0.9 : 0.6,
        });
      }
    }
    return hits;
  },
};

/* ── E2 같은 내용을 두 번 적기 ───────────────────────────────────────────── */

export const E2: EliminationPattern = {
  id: 'E2',
  action: 'combine',
  label: '같은 내용을 두 번 적기',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const steps = doc.steps.filter((s) => s.kind === 'task');
      for (let i = 0; i < steps.length; i++) {
        for (let j = i + 1; j < steps.length; j++) {
          const a = steps[i]!;
          const b = steps[j]!;

          if (!has(a.title, TRANSFER_VERBS) || !has(b.title, TRANSFER_VERBS)) continue;
          // ② 도구가 다르다 (같은 도구면 두 번 적는 게 아니라 두 가지 일이다)
          if (a.toolIds.length === 0 || b.toolIds.length === 0) continue;
          if (a.toolIds.some((t) => b.toolIds.includes(t))) continue;
          // ③ 대상 명사가 같다 — 이게 "같은 정보"의 유일한 증거다
          const sim = maxPairwiseSim(a.artifactNouns, b.artifactNouns);
          if (sim < 0.7) continue;
          // ④ 같은 사람이 한다 (다른 사람이면 인계지 재입력이 아니다)
          if (a.assigneeId && b.assigneeId && a.assigneeId !== b.assigneeId) continue;

          // 절감은 **뒤쪽 단계 전부**다. 앞 단계는 원본 입력이라 남는다
          const savedH = weighted(b);
          const perYear = perYearOf(b);
          const toolA = ctx.catalog[a.toolIds[0]!]?.name ?? '한 곳';
          const toolB = ctx.catalog[b.toolIds[0]!]?.name ?? '다른 곳';
          const bothConnectable = [a, b].every((s) =>
            s.toolIds.every((t) => ctx.catalog[t]?.grade === 'high'),
          );

          hits.push({
            patternId: 'E2',
            action: 'combine',
            label: E2.label,
            docId: doc.docId,
            nodeIds: [a.id, b.id],
            evidence: {
              '앞 단계': a.title,
              '뒤 단계': b.title,
              도구: `${toolA} → ${toolB}`,
              '내용 유사도': sim.toFixed(2),
            },
            execCopy: {
              headline: `같은 내용을 ${toolA}와 ${toolB}에 각각 적고 있어요`,
              evidence: `"${a.title}" 뒤에 "${b.title}" — 연 ${Math.round(perYear)}회`,
              proposal: `${toolA} 저장 시 ${toolB}로 자동 전달 (또는 한쪽을 없애기)`,
              effect: `연 ${fmtHours(savedH * perYear)} 회수`,
            },
            saving: {
              laborHPerYear: savedH * perYear,
              leadDaysSaved: null,
              devEffort: bothConnectable ? 'small' : 'project',
            },
            precision: sim >= 0.85 ? 0.85 : 0.65,
          });
        }
      }
    }
    return dedupeByNodes(hits);
  },
};

/* ── E3 아무도 안 보는 산출물 ────────────────────────────────────────────── */

export const E3: EliminationPattern = {
  id: 'E3',
  action: 'eliminate',
  label: '아무도 안 보는 산출물',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const { next, byId } = adjacency(doc);
      for (const n of doc.steps) {
        if (n.kind !== 'task') continue;
        if (!has(n.title, PRODUCE_VERBS)) continue;
        if (n.artifactNouns.length === 0) continue;

        // ① 같은 문서의 하류 단계가 이 산출물을 언급하는가
        const downstream = reach(n.id, next);
        const usedDownstream = [...downstream].some((d) => {
          const t = byId.get(d);
          return t != null && n.artifactNouns.some((w) => simKo(w, t.title) >= 0.75);
        });
        if (usedDownstream) continue;

        // ② 접합 소켓으로 밖에 나가는가
        const goesOut = (ctx.outboundSocketLabels ?? []).some((l) =>
          n.artifactNouns.some((w) => simKo(w, l) >= 0.8),
        );
        if (goesOut) continue;

        // ③ 조직 코퍼스 어디에서도 inbound로 등장하지 않는가 (정규화 라벨만 본다)
        const usedElsewhere = ctx.orgInboundLabels.some((l) =>
          n.artifactNouns.some((w) => simKo(w, l) >= 0.8),
        );
        if (usedElsewhere) continue;

        // ④ "이 결과물, 나중에 누가 찾나요" 응답 — 있으면 그게 답이다
        const reader = answerOf(doc.answers, 'output-reader', n.itemId);
        if (reader?.text && reader.text.trim().length > 0 && reader.choice !== 'nobody') continue;

        const savedH = weighted(n);
        const perYear = perYearOf(n);

        hits.push({
          patternId: 'E3',
          action: 'eliminate',
          label: E3.label,
          docId: doc.docId,
          nodeIds: [n.id],
          evidence: {
            산출물: n.artifactNouns.join(', '),
            '하류 참조': '없음',
            '조직 내 사용처': '없음',
            '누가 찾나요 응답': reader?.text ?? '(답 없음)',
          },
          execCopy: {
            headline: '만들고 나서 아무 데서도 쓰이지 않는 자료가 있어요',
            evidence: `"${n.artifactNouns[0]}" — 이 흐름 뒤쪽에서도, 다른 흐름에서도 나오지 않아요`,
            proposal: '정말 보는 사람이 없다면 만들기를 멈추거나, 분기 1회로 줄이기',
            effect: `연 ${fmtHours(savedH * perYear)} 회수`,
          },
          saving: { laborHPerYear: savedH * perYear, leadDaysSaved: null, devEffort: 'none' },
          // ★ 가장 오탐이 많은 검출기다. 커버리지가 낮으면 "안 읽는다"가 아니라 "아직 안 적혔다"
          precision: ctx.orgCoverage < 0.3 ? 0.35 : reader?.choice === 'nobody' ? 0.85 : 0.55,
        });
      }
    }
    return hits;
  },
};

/* ── E4 대기가 실접촉의 8배를 넘는 구간 ──────────────────────────────────── */

const WAIT_MULTIPLE = 8;
const MIN_WAIT_H = 8;

export const E4: EliminationPattern = {
  id: 'E4',
  action: 'rearrange',
  label: '기다리는 시간이 일하는 시간보다 훨씬 긴 구간',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const { next, prev, byId } = adjacency(doc);
      for (const hold of doc.steps) {
        if (hold.kind !== 'hold') continue;
        const waitH = hold.waitH * hold.reachProbability * hold.expectedPasses;
        if (waitH < MIN_WAIT_H) continue;

        // 구간 = hold 하나와 그 앞뒤 task. "구간"이지 단일 노드가 아니다
        const around = [...(prev.get(hold.id) ?? []), ...(next.get(hold.id) ?? [])]
          .map((id) => byId.get(id))
          .filter((s): s is EcrsStep => s != null && s.kind === 'task');
        const touchH = around.reduce((a, s) => a + weighted(s), 0) + weighted(hold);

        if (touchH > 0 && waitH < touchH * WAIT_MULTIPLE) continue;

        const perYear = perYearOf(hold);
        const proposal =
          hold.waitFor === 'approval'
            ? '결재 기준선 상향 또는 자동 승인 규칙'
            : hold.waitFor === 'reply'
              ? '재촉을 사람이 아니라 알림이 하게 하기 + 기한 후 자동 처리'
              : hold.waitFor === 'resource'
                ? '오기를 기다리지 말고 도착 알림을 받기'
                : '마감에 맞춰 몰지 말고 발생 시점에 처리';

        hits.push({
          patternId: 'E4',
          action: 'rearrange',
          label: E4.label,
          docId: doc.docId,
          nodeIds: [hold.id],
          evidence: {
            '실제로 손대는 시간': fmtHours(touchH),
            '기다리는 시간': fmtHours(waitH),
            배수: touchH > 0 ? `${Math.round(waitH / touchH)}배` : '접촉시간 0',
          },
          execCopy: {
            headline: `${fmtHours(touchH)}짜리 일이 ${fmtDays(waitH / 24)}를 붙잡고 있어요`,
            evidence: `${hold.title} — 기다림이 실제 작업의 ${Math.round(waitH / Math.max(touchH, 0.01))}배`,
            proposal,
            effect: `건당 최대 ${fmtDays(waitH / 24)} 단축 가능 · 연 ${Math.round(perYear)}건`,
          },
          // ★ E4의 절감은 사람 시간이 아니라 리드타임이다. laborHPerYear = null이 그 선언이다.
          //   이걸 인시로 세면 조직 전체 절감 시간이 3~5배 부푼다.
          saving: {
            laborHPerYear: null,
            leadDaysSaved: waitH / 24,
            devEffort: hold.waitFor === 'approval' ? 'none' : 'small',
          },
          precision: 0.8,
        });
      }
    }
    return hits;
  },
};

/* ── E5 중복 확인 단계 ───────────────────────────────────────────────────── */

export const E5: EliminationPattern = {
  id: 'E5',
  action: 'eliminate',
  label: '두 번 확인하는 단계',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const [a, b] of hopsWithin(doc, 2)) {
        if (a.kind !== 'task' || b.kind !== 'task') continue;
        if (!has(a.title, CHECK_VERBS) || !has(b.title, CHECK_VERBS)) continue;

        const sim = simKo(a.title, b.title);
        const objSim = maxPairwiseSim(a.artifactNouns, b.artifactNouns);
        if (Math.max(sim, objSim) < 0.6) continue;

        // 담당자가 다르면 "이중 확인"(의도된 통제)일 수 있다 → 정밀도만 낮춘다. 버리지는 않는다
        const differentPeople = a.assigneeId !== b.assigneeId;
        const savedH = weighted(b);
        const perYear = perYearOf(b);
        const impact = answerOf(doc.answers, 'removal-impact', b.itemId);

        hits.push({
          patternId: 'E5',
          action: 'eliminate',
          label: E5.label,
          docId: doc.docId,
          nodeIds: [a.id, b.id],
          evidence: {
            앞: a.title,
            뒤: b.title,
            담당: differentPeople ? '서로 다름' : '같은 사람',
            '없애면?': impact?.text ?? '(답 없음)',
          },
          execCopy: {
            headline: differentPeople
              ? '같은 것을 두 사람이 각각 확인하고 있어요'
              : '같은 것을 한 사람이 두 번 확인하고 있어요',
            evidence: `"${a.title}" 다음에 "${b.title}"`,
            proposal: differentPeople
              ? '확인 책임을 한쪽으로 모으고, 다른 쪽은 표본 점검으로'
              : '뒤쪽 확인을 없애고 앞 단계의 체크 항목을 늘리기',
            effect: `연 ${fmtHours(savedH * perYear)} 회수`,
          },
          saving: { laborHPerYear: savedH * perYear, leadDaysSaved: null, devEffort: 'none' },
          precision: differentPeople ? 0.5 : 0.75,
        });
      }
    }
    return dedupeByNodes(hits);
  },
};

/* ── E6 단일 담당 병목 ───────────────────────────────────────────────────── */

export const E6: EliminationPattern = {
  id: 'E6',
  action: 'rearrange',
  label: '한 사람에게 몰린 구간',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const run of assigneeRuns(doc, 3)) {
        const del = answerOf(doc.answers, 'delegable', run.itemIds[0]!);
        if (del?.choice !== 'nobody') continue; // 대체자가 있으면 병목이 아니다
        hits.push({
          patternId: 'E6',
          action: 'rearrange',
          label: E6.label,
          docId: doc.docId,
          nodeIds: run.nodeIds,
          evidence: {
            '연속 단계 수': run.nodeIds.length,
            '구간 리드타임': fmtHours(run.leadH),
            '대체 가능': '없다고 답함',
          },
          execCopy: {
            headline: `${run.nodeIds.length}단계가 한 사람만 할 수 있는 상태예요`,
            evidence: `이 구간이 멈추면 흐름 전체가 ${fmtDays(run.leadH / 24)} 멈춰요`,
            proposal: '전결 위임 또는 대체자 1명 지정 + 인수인계 문서 생성',
            effect: '휴가·퇴사 시 정지 위험 제거 (금액 미산정)',
          },
          saving: { laborHPerYear: null, leadDaysSaved: null, devEffort: 'none' },
          precision: 0.7,
        });
      }
    }
    return hits;
  },
};

/* ── E7 건건이 하는 짧은 반복 ────────────────────────────────────────────── */

export const E7: EliminationPattern = {
  id: 'E7',
  action: 'combine',
  label: '건건이 하는 짧은 반복',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.steps) {
        if (n.kind !== 'task') continue;
        const f7 = n.freqLast7d ?? 0;
        if (f7 < 10) continue;
        if (n.band !== '1m' && n.band !== '5m') continue;
        if (answerOf(doc.answers, 'batch-or-each', n.itemId)?.choice !== 'each') continue;

        const perYear = perYearOf(n);
        // 묶으면 건당 고정비(도구 열기·로그인·문맥 전환)가 사라진다. 보수적으로 40%
        const savedH = n.touchH * 0.4 * perYear;

        hits.push({
          patternId: 'E7',
          action: 'combine',
          label: E7.label,
          docId: doc.docId,
          nodeIds: [n.id],
          evidence: { '주당 횟수': f7, '1회 소요': n.band, '처리 방식': '건건이' },
          execCopy: {
            headline: `짧은 일을 하루에 ${Math.round(f7 / 5)}번씩 끊어서 하고 있어요`,
            evidence: `1회 ${n.band} · 주 ${f7}회 · 건건이 처리`,
            proposal: '하루 1~2회로 묶어서 처리 (또는 도착 알림만 받고 정해진 시각에)',
            effect: `연 ${fmtHours(savedH)} 회수 — 문맥 전환 비용 제거분`,
          },
          saving: { laborHPerYear: savedH, leadDaysSaved: null, devEffort: 'none' },
          precision: 0.6,
        });
      }
    }
    return hits;
  },
};

/* ── E8 직접 들여다보는 대기 ─────────────────────────────────────────────── */

export const E8: EliminationPattern = {
  id: 'E8',
  action: 'simplify',
  label: '직접 들여다보는 대기',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      for (const n of doc.steps) {
        if (n.kind !== 'hold') continue;
        if (n.waitFor !== 'resource' && n.waitFor !== 'reply') continue;
        if (answerOf(doc.answers, 'push-or-poll', n.itemId)?.choice !== 'poll') continue;

        const perYear = perYearOf(n);
        // 확인 행위 자체의 시간 — 대기 중 평균 3회 확인, 1회 2분으로 고정 가정
        const pollH = 3 * (2 / 60);
        const tools = n.toolIds.map((t) => ctx.catalog[t]).filter((t): t is ToolEntry => Boolean(t));
        const connectable = tools.length > 0 && tools.every((t) => t.grade === 'high');

        hits.push({
          patternId: 'E8',
          action: 'simplify',
          label: E8.label,
          docId: doc.docId,
          nodeIds: [n.id],
          evidence: {
            '대기 유형': n.waitFor,
            '확인 방식': '직접 들어가서 봄',
            '평균 대기': fmtHours(n.waitH),
          },
          execCopy: {
            headline: '오는지 안 오는지를 사람이 계속 들여다보고 있어요',
            evidence: `${n.title} — 평균 ${fmtHours(n.waitH)} 대기하며 수시 확인`,
            proposal: connectable ? '도착하면 알림이 오게 연결하기' : '확인 시각을 하루 2회로 고정하기',
            effect: `연 ${fmtHours(pollH * perYear)} 회수 + 놓침 방지`,
          },
          saving: {
            laborHPerYear: pollH * perYear,
            leadDaysSaved: null,
            devEffort: connectable ? 'small' : 'none',
          },
          precision: 0.75,
        });
      }
    }
    return hits;
  },
};

/* ── E9 거의 안 일어나는 갈래 ────────────────────────────────────────────── */

export const E9: EliminationPattern = {
  id: 'E9',
  action: 'eliminate',
  label: '거의 안 일어나는 갈래',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const byId = new Map(doc.steps.map((s) => [s.id, s]));
      for (const b of doc.steps) {
        if (b.kind !== 'branch' || !b.cases || b.cases.length < 2) continue;
        for (const c of b.cases) {
          if (c.share === null || c.share > 0.05) continue;
          hits.push({
            patternId: 'E9',
            action: 'eliminate',
            label: E9.label,
            docId: doc.docId,
            nodeIds: c.nodeIds,
            evidence: {
              갈래: c.label,
              발생률: `10번 중 ${Math.round(c.share * 10)}번 미만`,
              '이 갈래의 단계 수': c.nodeIds.length,
            },
            execCopy: {
              headline: `거의 일어나지 않는 경우를 위해 ${c.nodeIds.length}단계를 유지하고 있어요`,
              evidence: `"${c.label}" — 발생률 5% 미만`,
              proposal: '이 갈래를 정규 흐름에서 빼고 예외 처리로 옮기기',
              effect: '흐름 이해 비용 감소 · 자동화 난이도 하락 (금액 미산정)',
            },
            saving: {
              laborHPerYear: null,
              leadDaysSaved: null,
              devEffort: 'none',
            },
            precision: 0.55,
          });
          void byId;
        }
      }
    }
    return hits;
  },
};

/* ── E10 마감 직전 몰림 ──────────────────────────────────────────────────── */

export const E10: EliminationPattern = {
  id: 'E10',
  action: 'rearrange',
  label: '마감 직전에 몰리는 일',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const { next, byId } = adjacency(doc);
      for (const n of doc.steps) {
        if (n.kind !== 'hold' || n.waitFor !== 'time') continue;
        if (answerOf(doc.answers, 'deadline-crunch', n.itemId)?.choice !== 'yes') continue;

        const after = [...reach(n.id, next, (id) => byId.get(id)?.kind === 'hold')].filter(
          (id) => byId.get(id)?.kind === 'task',
        );
        const crunchH = after.reduce((s, id) => s + weighted(byId.get(id)!), 0);
        if (crunchH < 2) continue; // 2시간 미만이면 몰려도 문제가 아니다

        hits.push({
          patternId: 'E10',
          action: 'rearrange',
          label: E10.label,
          docId: doc.docId,
          nodeIds: [n.id, ...after],
          evidence: {
            마감: n.title,
            '마감 뒤 작업량': fmtHours(crunchH),
            '연 발생': Math.round(perYearOf(n)),
            '몰림 여부': '그렇다고 답함',
          },
          execCopy: {
            headline: `${fmtHours(crunchH)}짜리 일이 마감 직전 며칠에 몰려 있어요`,
            evidence: `"${n.title}" 이후 ${after.length}단계가 같은 기간에 처리돼요`,
            proposal: '발생 시점에 바로 처리하도록 옮기고, 마감일에는 확인만 남기기',
            effect: '잔업과 마감일 실수 감소 (시간 절감으로는 세지 않음)',
          },
          // 평준화의 효과는 시간이 아니라 잔업과 실수다. 시간 절감으로 세지 않는다
          saving: { laborHPerYear: null, leadDaysSaved: null, devEffort: 'none' },
          precision: 0.7,
        });
      }
    }
    return hits;
  },
};

/* ── E11 재촉 단계 ───────────────────────────────────────────────────────── */

export const E11: EliminationPattern = {
  id: 'E11',
  action: 'eliminate',
  label: '재촉하는 단계',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const doc of ctx.docs) {
      const { prev, byId } = adjacency(doc);
      for (const n of doc.steps) {
        if (n.kind !== 'task' || !has(n.title, URGE_VERBS)) continue;
        // 상류에 응답/승인 대기가 있어야 "재촉"이다. 없으면 다른 일이다
        const upstream = [...reach(n.id, prev)]
          .map((id) => byId.get(id))
          .find((v) => v != null && v.kind === 'hold' && (v.waitFor === 'reply' || v.waitFor === 'approval'));
        if (!upstream) continue;

        const perYear = perYearOf(n);
        hits.push({
          patternId: 'E11',
          action: 'eliminate',
          label: E11.label,
          docId: doc.docId,
          nodeIds: [n.id],
          evidence: {
            '재촉 단계': n.title,
            '원인 대기': upstream.title,
            '대기 시간': fmtHours(upstream.waitH),
          },
          execCopy: {
            headline: '기다리다 못해 다시 연락하는 단계가 흐름 안에 들어와 있어요',
            evidence: `"${upstream.title}" 때문에 "${n.title}"가 생겼어요`,
            proposal: '재촉을 사람이 아니라 자동 알림이 하게 하고, 기한 경과 시 기본값으로 진행',
            effect: `연 ${fmtHours(weighted(n) * perYear)} 회수 + 감정 소모 제거`,
          },
          saving: {
            laborHPerYear: weighted(n) * perYear,
            leadDaysSaved: null,
            devEffort: 'small',
          },
          precision: 0.8,
        });
      }
    }
    return hits;
  },
};

/* ── E12 같은 증빙을 두 곳에서 각각 요구 ─────────────────────────────────── */

export const E12: EliminationPattern = {
  id: 'E12',
  action: 'eliminate',
  label: '같은 증빙을 두 곳에서 각각 요구',
  detect(ctx) {
    const hits: EliminationHit[] = [];
    for (const link of ctx.confirmedLinks ?? []) {
      if (!(link.linkType === 'overlap' || link.sameArtifactRequestedTwice)) continue;
      hits.push({
        patternId: 'E12',
        action: 'eliminate',
        label: E12.label,
        docId: link.outboundDocId,
        nodeIds: link.nodeIds,
        evidence: { 산출물: link.objectName, '요구하는 곳': `${link.deptA} / ${link.deptB}` },
        execCopy: {
          // ★ POLICY §5.2 — 주어를 부서로 두지 않는다. "요구한다"가 아니라 "각각 적혀 있다"
          headline: '같은 증빙이 두 흐름에서 각각 요구되는 것으로 적혀 있어요',
          evidence: `${link.deptA} ↔ ${link.deptB} 접합 · 산출물 "${link.objectName}"`,
          proposal: '어느 한쪽에서 받은 것을 참조하도록 기준을 맞추기',
          effect: '제출 1회 감소 · 왕복 1회 제거 (금액 미산정)',
        },
        saving: { laborHPerYear: null, leadDaysSaved: null, devEffort: 'none' },
        precision: link.linkType === 'overlap' ? 0.8 : 0.6,
      });
    }
    return hits;
  },
};

/* ── 전량 ─────────────────────────────────────────────────────────────────── */

export const PATTERNS: readonly EliminationPattern[] = [
  E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12,
];

export const PATTERN_BY_ID: Readonly<Record<string, EliminationPattern>> = Object.fromEntries(
  PATTERNS.map((p) => [p.id, p]),
);

function dedupeByNodes(hits: readonly EliminationHit[]): EliminationHit[] {
  const seen = new Set<string>();
  const out: EliminationHit[] = [];
  for (const h of hits) {
    const key = `${h.patternId}:${h.docId}:${[...h.nodeIds].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * 전 패턴 실행.
 *
 * E2와 E12가 같은 쌍을 잡으면 **E12가 이긴다** — 조직 단위가 더 큰 이야기이고,
 * 문서 안의 재입력이 아니라 두 흐름 사이의 이중 요구이기 때문이다.
 */
export function detectElimination(ctx: EcrsContext): EliminationHit[] {
  const all = PATTERNS.flatMap((p) => p.detect(ctx));
  const e12Nodes = new Set(all.filter((h) => h.patternId === 'E12').flatMap((h) => h.nodeIds));
  return dedupeByNodes(
    all.filter((h) => h.patternId !== 'E2' || !h.nodeIds.some((n) => e12Nodes.has(n))),
  );
}

/** 랭킹 파이프라인이 제외해야 하는 노드 — ECRS가 먼저 도는 것의 기계적 표현 */
export function eliminatedNodeIds(hits: readonly EliminationHit[]): Set<string> {
  const out = new Set<string>();
  for (const h of hits) {
    if (h.action !== 'eliminate') continue;
    for (const n of h.nodeIds) out.add(n);
  }
  return out;
}

/* ── 5.2 오탐 관리 ───────────────────────────────────────────────────────── */

export type PrecisionTier = 'report' | 'report-with-badge' | 'owner-only';

export function precisionTier(precision: number): PrecisionTier {
  if (precision >= 0.8) return 'report';
  if (precision >= 0.5) return 'report-with-badge';
  return 'owner-only';
}

/* ── 5.3 관리자 노출 — 단계 유형 단위 롤업 ───────────────────────────────── */

export type EliminationRollup = {
  patternId: string;
  label: string;
  /** 5단위 반올림 */
  stepCountRounded: number;
  contributorCount: number;
  /** 부서 단위까지만 */
  deptIds: readonly string[];
  medianSavingH: number | null;
  execCopy: ExecCopy;
};

/**
 * ★ D-002. 예외 없음.
 *
 * 5인 미만이면 그 후보는 소유자 본인과 그 부서장에게도 가지 않는다.
 * 대신 **소유자 본인의 개인 화면에만** 나타난다 — 개인에게 자기 데이터를 보여주는
 * 것은 k-익명성의 대상이 아니다. 이 경로가 있어서 5인 차단이 제품 가치를 죽이지 않는다.
 */
export function rollupForAdmin(
  hits: readonly EliminationHit[],
  ownerOf: (docId: string) => string,
  deptOf: (docId: string) => string,
): EliminationRollup[] {
  const byPattern = new Map<string, EliminationHit[]>();
  for (const h of hits) {
    const arr = byPattern.get(h.patternId) ?? [];
    arr.push(h);
    byPattern.set(h.patternId, arr);
  }

  const out: EliminationRollup[] = [];
  for (const [pid, hs] of byPattern) {
    const contributors = new Set(hs.map((h) => ownerOf(h.docId)));
    if (contributors.size < 5) continue;
    const savings = hs
      .map((h) => h.saving.laborHPerYear)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const best = [...hs].sort((a, b) => b.precision - a.precision)[0]!;
    out.push({
      patternId: pid,
      label: PATTERN_BY_ID[pid]?.label ?? pid,
      stepCountRounded: Math.round(hs.length / 5) * 5,
      contributorCount: contributors.size,
      deptIds: [...new Set(hs.map((h) => deptOf(h.docId)))],
      medianSavingH:
        savings.length === 0
          ? null
          : savings.length % 2 === 1
            ? savings[savings.length >> 1]!
            : (savings[(savings.length >> 1) - 1]! + savings[savings.length >> 1]!) / 2,
      execCopy: best.execCopy,
    });
  }
  return out;
}

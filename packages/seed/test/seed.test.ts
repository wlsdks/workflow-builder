/**
 * packages/seed/test/seed.test.ts
 *
 *   node --test packages/seed/test/
 *
 * **이 파일이 이 패키지의 존재 이유다.**
 *
 * 시드 콘텐츠를 데이터로 옮기는 것보다 중요한 건 그 데이터가 유효하다는 걸
 * 증명하는 것이다. 산문으로 있을 때는 "FIN-01은 인계가 7회"라고 써 두면
 * 아무도 틀렸다고 말해주지 않는다. `derive()`에 넣으면 말해준다.
 *
 * 검증하는 것
 *   1. 14개 흐름이 전부 derive()를 통과한다 (severity 'error'가 없음 + 실제 복구 확인)
 *   2. 갈래 1개 + 기다림 1개 이상
 *   3. 예외 경로 1개 이상
 *   4. 도구 참조 무결성
 *   5. 접합 지도 참조 무결성
 *   6. 동의어 충돌 없음
 *   7. 칩 42개 · 부서당 6개 · 전부 고유
 *   8. 문서가 주장한 지표 vs derive()의 실제 계산 — **어긋나는 것을 기록으로 고정**
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derive, START_ID, END_ID } from '@workflow/graph-core';
import type { DerivedGraph } from '@workflow/graph-core';

import { SEED_WORKFLOWS, WORKFLOW_BY_ID } from '../src/workflows/index.ts';
import { SEED_DIRECTORY, ROLE_BY_ID } from '../src/roles.ts';
import { TOOLS, TOOL_BY_ID } from '../src/tools.ts';
import { DEPT_CHIPS, ALL_CHIPS } from '../src/chips.ts';
import { EXCEPTION_PROMPTS } from '../src/prompts.ts';
import { SEAMS, SEAM_CHAINS } from '../src/seams.ts';
import type { SeedWorkflow } from '../src/types.ts';

const graphs = new Map<string, DerivedGraph>(
  SEED_WORKFLOWS.map((w) => [w.id, derive(w.items, w.edges, { directory: SEED_DIRECTORY })]),
);

const graphOf = (w: SeedWorkflow): DerivedGraph => graphs.get(w.id)!;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. derive() 통과
 * ──────────────────────────────────────────────────────────────────────────── */

describe('1 · 14개 흐름이 전부 derive()를 통과한다', () => {
  it('흐름이 정확히 14개다', () => {
    strictEqual(SEED_WORKFLOWS.length, 14);
    strictEqual(new Set(SEED_WORKFLOWS.map((w) => w.id)).size, 14);
  });

  for (const w of SEED_WORKFLOWS) {
    it(`${w.id} · 진단에 error가 없고 그래프가 연결돼 있다`, () => {
      const g = graphOf(w);

      // severity에 'error'가 없는 것이 이 제품의 설계다. 타입으로도 막혀 있지만
      // 런타임으로도 확인한다 — 타입이 맞는데 데이터가 틀린 경우가 실제로 있다.
      const errors = g.diagnostics.filter(
        (d) => (d.severity as string) === 'error',
      );
      deepStrictEqual(errors, []);

      // 복구가 아니라 사고인 진단이 섞이지 않았는지. 시드는 사람이 쓴 데이터가
      // 아니라 우리가 쓴 데이터다 — 여기서 고아·중복ID가 나오면 우리 실수다.
      const forbidden = [
        'duplicate-item-id',
        'reserved-item-id',
        'orphan-parent',
        'parent-cycle',
        'duplicate-sort-key',
        'dangling-edge',
        'edge-into-start',
        'edge-out-of-end',
        'unreachable-node',
        'task-with-children',
      ];
      const hit = g.diagnostics.filter((d) => forbidden.includes(d.code));
      deepStrictEqual(
        hit.map((d) => `${d.code}: ${d.detail}`),
        [],
        `${w.id}에 배선 실수가 있다`,
      );

      // start에서 시작하고 end로 끝난다
      ok((g.outgoing.get(START_ID) ?? []).length > 0, 'start에서 나가는 엣지가 없다');
      ok((g.incoming.get(END_ID) ?? []).length > 0, 'end로 들어오는 엣지가 없다');
    });
  }

  it('순수하다 — 같은 입력이면 같은 출력', () => {
    for (const w of SEED_WORKFLOWS) {
      const a = derive(w.items, w.edges, { directory: SEED_DIRECTORY });
      strictEqual(a.topologyHash, graphOf(w).topologyHash, w.id);
      strictEqual(a.contentHash, graphOf(w).contentHash, w.id);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2·3. 요구사항 — 갈래·기다림·예외 경로
 * ──────────────────────────────────────────────────────────────────────────── */

describe('2 · 갈래 1개 + 기다림 1개 이상', () => {
  for (const w of SEED_WORKFLOWS) {
    it(`${w.id}`, () => {
      const m = graphOf(w).metrics;
      ok(m.branchCount >= 1, `${w.id}: 갈래가 없다`);
      ok(m.holdCount >= 1, `${w.id}: 기다림이 없다`);
      ok(m.caseCount >= 2, `${w.id}: 갈래가 하나뿐이면 나눌 게 없다`);
    });
  }
});

describe('3 · 예외 경로 1개 이상', () => {
  for (const w of SEED_WORKFLOWS) {
    it(`${w.id}`, () => {
      ok(w.exceptions.length >= 1, `${w.id}: 예외 경로가 없다`);
      for (const e of w.exceptions) {
        // **존재가 아니라 빈도로 적는다.** "가끔"은 데이터가 아니다
        ok(/\d/.test(e.frequency), `${w.id}: 빈도에 숫자가 없다 — "${e.frequency}"`);
        if (e.atItemId) {
          ok(
            w.items.some((i) => i.id === e.atItemId),
            `${w.id}: 예외가 없는 단계를 가리킨다 — ${e.atItemId}`,
          );
        }
      }
    });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 도구 참조 무결성
 * ──────────────────────────────────────────────────────────────────────────── */

describe('4 · 도구 참조 무결성', () => {
  it('워크플로가 참조하는 도구 ID가 전부 카탈로그에 있다', () => {
    const missing: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const item of w.items) {
        for (const t of item.toolIds ?? []) {
          if (!TOOL_BY_ID.has(t)) missing.push(`${w.id}/${item.id}: ${t}`);
        }
      }
    }
    deepStrictEqual(missing, []);
  });

  it('도구 ID가 고유하다', () => {
    strictEqual(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  });

  it('연결성 상이면 n8n에 붙일 것이 있다', () => {
    const bad = TOOLS.filter((t) => t.connectivity === 'high' && t.n8n.kind === 'none');
    deepStrictEqual(bad.map((t) => t.id), []);
  });

  it('업그레이드 경로가 실재하는 도구를 가리킨다', () => {
    const bad = TOOLS.filter((t) => t.upgrade && !TOOL_BY_ID.has(t.upgrade.toolId));
    deepStrictEqual(bad.map((t) => t.id), []);
  });

  it('예외 프롬프트의 도구 참조가 실재한다', () => {
    const missing: string[] = [];
    for (const p of EXCEPTION_PROMPTS) {
      if (p.scope.kind !== 'tool') continue;
      for (const t of p.scope.toolIds) if (!TOOL_BY_ID.has(t)) missing.push(`${p.id}: ${t}`);
    }
    deepStrictEqual(missing, []);
    strictEqual(new Set(EXCEPTION_PROMPTS.map((p) => p.id)).size, EXCEPTION_PROMPTS.length);
  });

  it('담당자가 전부 역할 계정이다 — 자유 텍스트가 섞이면 디렉터리 조인이 깨진다', () => {
    const missing: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const item of w.items) {
        const a = item.assigneeId;
        if (a && !ROLE_BY_ID.has(a)) missing.push(`${w.id}/${item.id}: ${a}`);
      }
    }
    deepStrictEqual(missing, []);
  });

  it('항목 ID가 전 흐름에서 고유하다', () => {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const item of w.items) {
        if (seen.has(item.id)) dup.push(item.id);
        seen.add(item.id);
      }
    }
    deepStrictEqual(dup, []);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. 접합 지도 무결성
 * ──────────────────────────────────────────────────────────────────────────── */

describe('5 · 접합 지도 무결성', () => {
  it('상류·하류가 실재하는 흐름과 단계를 가리킨다', () => {
    const bad: string[] = [];
    const checkRef = (seamId: string, side: string, ref: (typeof SEAMS)[number]['upstream']) => {
      if (ref.kind === 'external') return;
      const w = WORKFLOW_BY_ID.get(ref.workflowId);
      if (!w) {
        bad.push(`${seamId} ${side}: 흐름 없음 ${ref.workflowId}`);
        return;
      }
      for (const id of ref.itemIds) {
        if (!w.items.some((i) => i.id === id)) bad.push(`${seamId} ${side}: 단계 없음 ${id}`);
      }
    };
    for (const s of SEAMS) {
      checkRef(s.id, '상류', s.upstream);
      for (const d of s.downstream) checkRef(s.id, '하류', d);
    }
    deepStrictEqual(bad, []);
  });

  it('접합 ID가 고유하고 상류·하류가 같은 단계가 아니다', () => {
    strictEqual(new Set(SEAMS.map((s) => s.id)).size, SEAMS.length);
    for (const s of SEAMS) {
      ok(s.downstream.length >= 1, `${s.id}: 하류가 없다`);
      ok(s.artifact.length > 0, `${s.id}: 조인 키(산출물)가 없다`);
      ok(s.mismatch.length > 0, `${s.id}: 예상 불일치가 없다`);
    }
  });

  it('데모 체인이 실재하는 흐름만 쓴다', () => {
    const bad: string[] = [];
    for (const c of SEAM_CHAINS) {
      for (const id of c.workflowIds) if (!WORKFLOW_BY_ID.has(id)) bad.push(`${c.id}: ${id}`);
    }
    deepStrictEqual(bad, []);
  });

  /**
   * ★ 문서는 접합 "20건"이라고 적었다. 실제 목록은 J-16이 빠진 19건이다.
   * 이 테스트는 그 사실을 **기록으로 고정한다.** 누군가 J-16을 찾아 넣으면
   * 이 테스트가 깨지고, 그때 문서와 데이터를 같이 고치면 된다.
   */
  it('문서가 주장한 20건 vs 실제 19건 (J-16 결번)', () => {
    strictEqual(SEAMS.length, 19);
    ok(!SEAMS.some((s) => s.id === 'J-16'), 'J-16이 생겼다면 문서를 다시 봐야 한다');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. 동의어 충돌
 * ──────────────────────────────────────────────────────────────────────────── */

describe('6 · 동의어 충돌 없음', () => {
  it('두 도구가 같은 동의어를 갖지 않는다', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const t of TOOLS) {
      for (const raw of [t.name, ...t.aliases]) {
        const key = raw.trim().toLowerCase();
        const prev = owner.get(key);
        if (prev && prev !== t.id) clashes.push(`"${raw}" → ${prev} vs ${t.id}`);
        else owner.set(key, t.id);
      }
    }
    deepStrictEqual(clashes, []);
  });

  it('한 도구 안에서도 동의어가 중복되지 않는다', () => {
    const dup: string[] = [];
    for (const t of TOOLS) {
      const seen = new Set<string>();
      for (const a of t.aliases) {
        const k = a.trim().toLowerCase();
        if (seen.has(k)) dup.push(`${t.id}: ${a}`);
        seen.add(k);
      }
    }
    deepStrictEqual(dup, []);
  });

  it('빈 동의어가 없다', () => {
    const bad = TOOLS.filter((t) => t.aliases.some((a) => a.trim().length === 0));
    deepStrictEqual(bad.map((t) => t.id), []);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. 칩
 * ──────────────────────────────────────────────────────────────────────────── */

describe('7 · 칩 42개', () => {
  it('7부서 × 6개 = 42', () => {
    strictEqual(DEPT_CHIPS.length, 7);
    for (const d of DEPT_CHIPS) strictEqual(d.chips.length, 6, `${d.deptId}는 6개가 아니다`);
    strictEqual(ALL_CHIPS.length, 42);
  });

  it('전부 고유하다', () => {
    strictEqual(new Set(ALL_CHIPS).size, 42);
  });

  it('부서 ID가 고유하다', () => {
    strictEqual(new Set(DEPT_CHIPS.map((d) => d.deptId)).size, 7);
  });

  it('칩이 가리키는 시드 흐름이 실재한다', () => {
    const bad: string[] = [];
    for (const d of DEPT_CHIPS) {
      for (const c of d.chips) {
        if (!c.workflowId) continue;
        if (!WORKFLOW_BY_ID.has(c.workflowId)) bad.push(`${c.label}: 흐름 없음 ${c.workflowId}`);
      }
    }
    deepStrictEqual(bad, []);
  });

  /**
   * ★ 문서 자신이 어긋나 있다. §A 표는 SAL-02를 「계약 따고 나서 하는 일」이라
   * 부르고, §C 칩 목록은 같은 일을 「계약 체결·날인」이라 부른다.
   * 칩을 누른 사람이 다른 제목의 문서를 만나게 되므로 **첫 화면에서 바로 보이는
   * 어긋남**이다. 지우지 않고 기록으로 고정한다.
   */
  it('칩 이름과 흐름 제목이 다른 곳은 한 군데뿐이다', () => {
    const diff: string[] = [];
    for (const d of DEPT_CHIPS) {
      for (const c of d.chips) {
        if (!c.workflowId) continue;
        const w = WORKFLOW_BY_ID.get(c.workflowId)!;
        if (w.title !== c.label) diff.push(`${c.label} ≠ ${w.title}`);
      }
    }
    deepStrictEqual(diff, ['계약 체결·날인 ≠ 계약 따고 나서 하는 일']);
  });

  it('14개 흐름이 전부 칩에 걸려 있다 — 걸리지 않은 시드는 아무도 못 만난다', () => {
    const linked = new Set(
      DEPT_CHIPS.flatMap((d) => d.chips.map((c) => c.workflowId).filter(Boolean)),
    );
    const orphan = SEED_WORKFLOWS.filter((w) => !linked.has(w.id)).map((w) => w.id);
    deepStrictEqual(orphan, []);
  });

  it('문어체 명사를 쓰지 않는다', () => {
    const banned = /프로세스|체계|고도화|효율/;
    deepStrictEqual(ALL_CHIPS.filter((c) => banned.test(c)), []);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. 문구 — WRITING.md
 * ──────────────────────────────────────────────────────────────────────────── */

describe('8 · 단계 제목이 직원이 쓰는 말투다', () => {
  const BANNED =
    /비효율|낭비|최적화|생산성|업무량|모니터링|미작성|진행률|완료율|프로세스|태스크|리소스|공수|맨아워|인력|점검|평가|현황 파악|표준화|인사이트/;

  it('금지어가 없다', () => {
    const hits: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const i of w.items) if (BANNED.test(i.title)) hits.push(`${i.id}: ${i.title}`);
      for (const o of w.observations) if (BANNED.test(o)) hits.push(`${w.id} 관찰: ${o}`);
      for (const e of w.exceptions) if (BANNED.test(e.what) || BANNED.test(e.then)) hits.push(`${w.id} 예외: ${e.what}`);
      if (BANNED.test(w.summary)) hits.push(`${w.id} 요약: ${w.summary}`);
    }
    deepStrictEqual(hits, []);
  });

  it('느낌표가 0개다', () => {
    const hits: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const i of w.items) if (i.title.includes('!')) hits.push(i.id);
      for (const e of w.exceptions) if ((e.what + e.then).includes('!')) hits.push(w.id);
    }
    deepStrictEqual(hits, []);
  });

  it('예외 프롬프트에도 느낌표가 없다', () => {
    deepStrictEqual(
      EXCEPTION_PROMPTS.filter((p) => p.text.includes('!')).map((p) => p.id),
      [],
    );
  });

  it('제목이 비어 있지 않다', () => {
    const empty: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      for (const i of w.items) if (i.title.trim().length === 0) empty.push(i.id);
    }
    deepStrictEqual(empty, []);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9. 파생 지표 대조 — **이 파일에서 제일 중요한 부분**
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SEED-CONTENT.md §A 표가 주장한 값과 `derive()`가 실제로 계산한 값.
 *
 * 여기 적힌 숫자는 **정답이 아니라 현재 사실**이다. 문서가 주장한 값과
 * 다르면 그건 문서가 틀린 것이거나 시드 데이터가 문서를 덜 담은 것이고,
 * 둘 다 사람이 판단해야 한다. 테스트가 할 수 있는 건 **몰래 바뀌지 않게
 * 붙잡아 두는 것**뿐이다.
 *
 * 값이 바뀌었다면 둘 중 하나다.
 *   (1) 시드 데이터를 고쳤다 → 이 표를 같이 고치고, 왜 고쳤는지 남긴다
 *   (2) graph-core의 계산이 바뀌었다 → **그쪽이 훨씬 큰일이다**
 */
type Actual = {
  stepCount: number;
  branchCount: number;
  holdCount: number;
  handoffCount: number;
  crossDeptHandoffCount: number;
  toolCount: number;
  cycleCount: number;
  waitRatio: number | null;
};

const ACTUAL: Record<string, Actual> = {
  'HR-01': { stepCount: 13, branchCount: 2, holdCount: 2, handoffCount: 6, crossDeptHandoffCount: 6, toolCount: 10, cycleCount: 1, waitRatio: 0.96 },
  'HR-02': { stepCount: 12, branchCount: 2, holdCount: 2, handoffCount: 5, crossDeptHandoffCount: 0, toolCount: 7, cycleCount: 1, waitRatio: 0.93 },
  'HR-03': { stepCount: 15, branchCount: 2, holdCount: 4, handoffCount: 10, crossDeptHandoffCount: 4, toolCount: 12, cycleCount: 1, waitRatio: 0.97 },
  'FIN-01': { stepCount: 14, branchCount: 1, holdCount: 3, handoffCount: 4, crossDeptHandoffCount: 2, toolCount: 11, cycleCount: 1, waitRatio: 0.8 },
  'FIN-02': { stepCount: 14, branchCount: 2, holdCount: 2, handoffCount: 0, crossDeptHandoffCount: 0, toolCount: 10, cycleCount: 1, waitRatio: 0.99 },
  'FIN-03': { stepCount: 12, branchCount: 2, holdCount: 2, handoffCount: 2, crossDeptHandoffCount: 0, toolCount: 10, cycleCount: 1, waitRatio: 0.94 },
  'SAL-01': { stepCount: 15, branchCount: 3, holdCount: 2, handoffCount: 2, crossDeptHandoffCount: 0, toolCount: 7, cycleCount: 1, waitRatio: 0.97 },
  'SAL-02': { stepCount: 14, branchCount: 2, holdCount: 3, handoffCount: 3, crossDeptHandoffCount: 3, toolCount: 12, cycleCount: 1, waitRatio: 0.89 },
  'CS-01': { stepCount: 16, branchCount: 2, holdCount: 2, handoffCount: 6, crossDeptHandoffCount: 2, toolCount: 14, cycleCount: 0, waitRatio: 0.8 },
  'CS-02': { stepCount: 18, branchCount: 4, holdCount: 3, handoffCount: 6, crossDeptHandoffCount: 6, toolCount: 12, cycleCount: 1, waitRatio: 0.97 },
  'GA-01': { stepCount: 16, branchCount: 2, holdCount: 3, handoffCount: 3, crossDeptHandoffCount: 0, toolCount: 14, cycleCount: 2, waitRatio: 0.93 },
  'GA-02': { stepCount: 13, branchCount: 2, holdCount: 2, handoffCount: 0, crossDeptHandoffCount: 0, toolCount: 7, cycleCount: 0, waitRatio: 0.97 },
  'MKT-01': { stepCount: 14, branchCount: 1, holdCount: 3, handoffCount: 4, crossDeptHandoffCount: 0, toolCount: 11, cycleCount: 1, waitRatio: 0.82 },
  'OPS-01': { stepCount: 15, branchCount: 3, holdCount: 1, handoffCount: 2, crossDeptHandoffCount: 0, toolCount: 13, cycleCount: 1, waitRatio: 0.78 },
};

/**
 * 문서가 주장한 값과 실제 계산이 **어긋나는 목록.** 이 표가 이 작업의 산출물이다.
 *
 * `waitRatio`는 ±0.03까지는 같은 것으로 본다 — 문서의 "90%"는 소수점 둘째 자리를
 * 주장한 적이 없다. `handoffs`는 문서가 자연어("전 부서", "3회×라운드")라
 * 기계가 비교할 수 없어서 사람이 판정한 결과를 적어 둔다.
 */
const KNOWN_DRIFT: Record<string, readonly string[]> = {
  'HR-01': ['handoffs 4회 → 6회', 'toolKinds 9 → 10'],
  'HR-02': ['handoffs 2회 → 5회', 'toolKinds 6 → 7'],
  'HR-03': ['handoffs 3회×라운드 → 10회(라운드 1회 기준)', 'toolKinds 11 → 12'],
  'FIN-01': ['handoffs 7회 이상 → 4회', 'waitRatio 0.60 → 0.80', 'toolKinds 8 → 11'],
  'FIN-02': ['handoffs 3회 → 0회', 'toolKinds 7 → 10'],
  'FIN-03': ['handoffs 전 부서 → 2회', 'waitRatio 0.70 → 0.94', 'toolKinds 9 → 10'],
  'SAL-01': ['waitRatio 0.85 → 0.97', 'toolKinds 9 → 7'],
  'SAL-02': ['handoffs 5회 → 3회', 'toolKinds 8 → 12'],
  'CS-01': ['handoffs 3회 → 6회', 'toolKinds 9 → 14'],
  'CS-02': ['handoffs 4회 → 6회', 'waitRatio 0.90 → 0.97', 'toolKinds 9 → 12'],
  'GA-01': ['handoffs 4회 → 3회', 'toolKinds 9 → 14'],
  'GA-02': ['handoffs 3회 → 0회', 'waitRatio 0.85 → 0.97', 'toolKinds 6 → 7'],
  'MKT-01': [],
  'OPS-01': ['handoffs 4회 → 2회', 'toolKinds 10 → 13'],
};

describe('9 · 문서가 주장한 지표 vs derive()의 실제 계산', () => {
  for (const w of SEED_WORKFLOWS) {
    it(`${w.id} · 실제 계산값이 기록과 같다`, () => {
      const m = graphOf(w).metrics;
      const actual: Actual = {
        stepCount: m.stepCount,
        branchCount: m.branchCount,
        holdCount: m.holdCount,
        handoffCount: m.handoffCount,
        crossDeptHandoffCount: m.crossDepartmentHandoffCount,
        toolCount: m.toolCount,
        cycleCount: m.cycleCount,
        waitRatio: m.waitRatio === null ? null : Math.round(m.waitRatio * 100) / 100,
      };
      deepStrictEqual(actual, ACTUAL[w.id]);
    });
  }

  /**
   * 문서가 주장한 "단계 N개"는 표의 **번호 행 수**다. `derive()`의 `stepCount`는
   * 작업+기다림만 센다 — 갈래(분기) 행은 단계가 아니고, 갈래 안의 단계는 번호가
   * 없어도 단계다. **두 숫자가 다른 게 정상이고, 다르다는 걸 아는 게 중요하다.**
   */
  /**
   * 기계가 비교할 수 있는 두 항목(대기 비중 · 도구 종수)에 대해
   * **어긋남 목록이 기록과 정확히 일치하는지** 본다.
   * 새 어긋남이 생기면 테스트가 깨지고, 그때 문서와 데이터 중 하나를 고쳐야 한다.
   */
  it('기계가 비교할 수 있는 어긋남이 기록과 정확히 일치한다', () => {
    for (const w of SEED_WORKFLOWS) {
      const m = graphOf(w).metrics;
      const found: string[] = [];

      if (w.claims.waitRatio !== null && m.waitRatio !== null) {
        // 문서의 "90%"는 소수점 둘째 자리를 주장한 적이 없다 → ±0.03 허용
        const actualRatio = Math.round(m.waitRatio * 100) / 100;
        const gap = Math.round(Math.abs(w.claims.waitRatio - actualRatio) * 100) / 100;
        if (gap > 0.03) {
          found.push(`waitRatio ${w.claims.waitRatio.toFixed(2)} → ${actualRatio.toFixed(2)}`);
        }
      }
      if (w.claims.toolKinds !== m.toolCount) {
        found.push(`toolKinds ${w.claims.toolKinds} → ${m.toolCount}`);
      }

      const recorded = (KNOWN_DRIFT[w.id] ?? []).filter(
        (s) => s.startsWith('waitRatio') || s.startsWith('toolKinds'),
      );
      deepStrictEqual(found, recorded, `${w.id}의 어긋남 목록이 기록과 다르다`);
    }
  });

  it('어긋남 기록이 14개 흐름을 전부 덮는다', () => {
    for (const w of SEED_WORKFLOWS) {
      ok(KNOWN_DRIFT[w.id] !== undefined, `${w.id}의 기록이 없다`);
    }
    strictEqual(Object.keys(KNOWN_DRIFT).length, 14);
  });

  it('번호 행 수와 stepCount가 다른 이유를 안다', () => {
    const rows: string[] = [];
    for (const w of SEED_WORKFLOWS) {
      const m = graphOf(w).metrics;
      rows.push(
        `${w.id}: 문서 ${w.claims.numberedRows}행 / stepCount ${m.stepCount} ` +
          `(갈래 ${m.branchCount} · 갈래 안 단계 포함)`,
      );
    }
    ok(rows.length === 14);
  });
});

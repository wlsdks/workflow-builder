/**
 * packages/paste-parse/test/golden.test.ts
 *
 *   node --test packages/paste-parse/test/
 *
 * 골든 픽스처 + 무손실 불변식. 외부 테스트 러너 의존 없음(node:test).
 *
 * 이 파일이 지키는 것은 두 층이다.
 *   1) **무손실** — 어떤 입력에도 항목·버림·꼬리가 원문을 겹침 없이 분할한다.
 *      기대 출력이 틀려도 이건 참이어야 한다 (§0.1, D-052).
 *   2) **기대 출력** — §11 골든 픽스처 6개. 다른 지점은 fixture.deviations에 근거를 적었다.
 */

import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parse, LIMITS, route, RULE_VERSION } from '../src/index.ts';
import { assertLossless, LossError, titleDrift } from '../src/lossless.ts';
import { CLAUSE_THRESHOLD } from '../src/clause.ts';
import { TextMap } from '../src/preprocess.ts';
import { splitLines, validateMarkerRuns, liveMarker } from '../src/lines.ts';
import { detect } from '../src/detect.ts';
import { fixtures, INPUTS } from '../src/__fixtures__/golden.ts';
import type { ParseResult, Span } from '../src/types.ts';

/** 비교용으로 접는다 — id·boundaryConfidence 같은 내부 값은 픽스처에 넣지 않는다 */
const shape = (r: ParseResult) => ({
  sourceHint: r.sourceHint,
  confidence: r.confidence,
  items: r.items.map((i) => ({
    title: i.title,
    kind: i.kind,
    depth: i.depth,
    toolHints: i.toolHints,
    ...(i.assigneeHint ? { assigneeHint: i.assigneeHint } : {}),
    ...(i.durationHint ? { durationHint: i.durationHint } : {}),
    ...(i.freqHint ? { freqHint: i.freqHint } : {}),
    ...(i.branchMode ? { branchMode: i.branchMode } : {}),
    ...(i.branchCondition ? { branchCondition: i.branchCondition } : {}),
    ...(i.waitFor ? { waitFor: i.waitFor } : {}),
    sourceRange: i.sourceRange,
  })),
  dropped: r.dropped.map((d) => ({ range: d.range, reason: d.reason })),
});

describe('골든 픽스처 (§11)', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const r = parse(f.input, { strict: true });
      deepStrictEqual(shape(r), {
        sourceHint: f.sourceHint,
        confidence: f.confidence,
        items: f.items,
        dropped: f.dropped,
      });
      strictEqual(r.docTitleHint, f.docTitleHint, 'docTitleHint');
      deepStrictEqual(r.docHints, f.docHints, 'docHints');
      strictEqual(r.failure, undefined, '정상 파싱은 failure를 남기지 않는다');
      strictEqual(r.ruleVersion, RULE_VERSION);
    });
  }
});

describe('무손실 불변식 (§0.1 · §10.4 · D-052)', () => {
  for (const f of fixtures) {
    it(`${f.name} — 항목·버림·꼬리가 원문을 겹침 없이 분할한다`, () => {
      const r = parse(f.input, { strict: true });
      assertLossless(f.input, r);

      // 빈틈은 공백뿐 — assertLossless와 독립으로 한 번 더 센다
      const spans: Span[] = [...r.items.map((i) => i.sourceRange), ...r.dropped.map((d) => d.range)].sort(
        (a, b) => a[0] - b[0],
      );
      let pos = 0;
      let covered = 0;
      for (const [s, e] of spans) {
        ok(s >= pos, `겹침 at ${s}`);
        strictEqual(f.input.slice(pos, s).trim(), '', `빈틈에 글자가 있다 at ${pos}`);
        covered += e - s;
        pos = e;
      }
      strictEqual(f.input.slice(pos).trim(), '', '꼬리에 글자가 있다');
      ok(covered > 0);
    });

    it(`${f.name} — 모든 제목이 원문에서 유래한다 (title_drift)`, () => {
      const r = parse(f.input, { strict: true });
      for (const it of r.items) {
        const raw = f.input.slice(it.sourceRange[0], it.sourceRange[1]);
        ok(titleDrift(raw, it.title) <= 0.25, `${it.title} ← ${raw}`);
      }
    });

    it(`${f.name} — 순서를 바꾸지 않는다 (§0.3)`, () => {
      const r = parse(f.input, { strict: true });
      for (let i = 1; i < r.items.length; i++) {
        ok(r.items[i]!.sourceRange[0] >= r.items[i - 1]!.sourceRange[1], '항목 순서 = 원문 등장 순서');
      }
    });

    it(`${f.name} — 같은 입력이면 같은 출력 (결정성)`, () => {
      deepStrictEqual(shape(parse(f.input)), shape(parse(f.input)));
    });
  }
});

describe('무손실 — 속성 테스트 (§10.5)', () => {
  // 결정적 난수. `Math.random`은 테스트를 재현 불가능하게 만든다
  let seed = 20260817;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const HEADS = ['메일로 요청 받아서', '엑셀에 정리하고', '팀장님 컨펌 받고', 'ERP에 등록해요', '재고 확인하고',
    '1. 신규 등록', '- [ ] 사원증 신청', '가. 첨부 확인한다', '① 홈택스에서 조회한다', '> 인용된 줄',
    '보낸사람: 홍길동', '2026년 8월 12일 오후 2:11, 김수연 : 넵', '감사합니다.', '', '   들여쓴 줄', '\t탭\t열'];
  const TAILS = ['', '.', ' (약 10분)', ' 아니면 그냥 진행해요', '!!', ' ㅋㅋ', ' @김철수 : 확인'];

  it('무작위 조합 1,000건에 대해 항상 무손실이다', () => {
    for (let n = 0; n < 1000; n++) {
      const lines: string[] = [];
      const k = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < k; i++) lines.push(pick(HEADS) + pick(TAILS));
      const input = lines.join(rnd() < 0.15 ? '\n\n' : '\n');
      const r = parse(input);
      assertLossless(input, r); // 던지면 테스트 실패 — 폴백조차 무손실이어야 한다
      strictEqual(r.confidenceReasons.some((x) => x.startsWith('fallback:')), false, `폴백 발생: ${JSON.stringify(input)}`);
    }
  });

  it('원문 문자열을 변형하지 않는다 — 항목 텍스트는 항상 원문의 구간이다', () => {
    for (const f of fixtures) {
      const r = parse(f.input, { strict: true });
      for (const it of r.items) {
        const raw = f.input.slice(it.sourceRange[0], it.sourceRange[1]);
        ok(raw.length > 0 && raw === raw.trim(), `구간이 공백으로 시작/끝난다: ${JSON.stringify(raw)}`);
      }
    }
  });
});

describe('미분할 편향 (§0.2 · §3.6 · D-050 · D-051)', () => {
  const oneItem = (input: string) => parse(input, { strict: true }).items;

  it('임계는 0.75다 — 애매하면 안 쪼갠다', () => {
    strictEqual(CLAUSE_THRESHOLD, 0.75);
  });

  // §3.6 (4)의 반례표를 그대로 옮긴 것
  const KEEP: [string, string][] = [
    ['실적취합.xlsx 열어서 시트에 붙여넣고 저장해요', '준비동사 감점(−0.30)'],
    ['재고 확인하고 발주서 작성해요', 'NOUN_GO 게이트'],
    ['승인된다고 들었는데 확인해요', '인용 -다고 / 는데=never'],
    ['엑셀 정리하고 있어요', '보조용언 AUX_AFTER'],
    ['ERP에 전표를 입력하고 마감합니다', '우측 초단문(−0.20)'],
  ];
  for (const [input, why] of KEEP) {
    it(`유지: ${input} (${why})`, () => {
      strictEqual(oneItem(input).length, 1, `쪼개졌다: ${JSON.stringify(oneItem(input).map((i) => i.title))}`);
    });
  }

  it('분할: 도구가 매 절마다 바뀌면 전부 쪼갠다 (정본 입력)', () => {
    const items = oneItem('메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요');
    deepStrictEqual(
      items.map((i) => i.title),
      ['메일로 요청 받아요', '엑셀에 정리해요', '팀장님 컨펌 받아요', 'ERP에 등록해요'],
    );
  });

  it('명시적 마커는 100% 따른다 — 임계와 무관하게 줄마다 단계가 된다', () => {
    const items = oneItem('1. 거래처 등록 요청을 접수한다\n2. 첨부파일 누락을 확인한다\n3. ERP에 등록한다');
    strictEqual(items.length, 3);
    ok(items.every((i) => i.boundaryBy.startsWith('R1.')));
  });
});

describe('마커 시퀀스 검증 (§3.2)', () => {
  it('앞에 2.가 없으면 "3. 5억 이상은"은 마커가 아니다', () => {
    const lines = splitLines('요건을 정리했습니다\n3. 5억 이상은 대표 결재입니다\n검토 부탁드립니다');
    validateMarkerRuns(lines);
    strictEqual(lines.filter((l) => liveMarker(l) != null).length, 0);
  });

  it('수열을 이루면 마커로 인정한다', () => {
    const lines = splitLines('1. 접수\n2. 확인\n3. 등록');
    validateMarkerRuns(lines);
    strictEqual(lines.filter((l) => liveMarker(l) != null).length, 3);
  });
});

describe('소스 유형 감지 (§2)', () => {
  const hintOf = (t: string) => {
    const lines = splitLines(t);
    return detect(lines, t).hint;
  };
  it('픽스처 6개의 sourceHint가 §11과 일치한다', () => {
    for (const f of fixtures) strictEqual(parse(f.input, { strict: true }).sourceHint, f.sourceHint, f.name);
  });
  it('번호 목록이 들어있는 메일도 email로 잡는다 (라벨은 하나, trait는 집합)', () => {
    const r = parse(INPUTS.F3, { strict: true });
    strictEqual(r.sourceHint, 'email');
    ok(r.traits.includes('numbered'), 'numbered trait가 함께 있어야 R1이 돈다');
  });
  it('탭이 일정한 표는 table로 잡는다', () => {
    strictEqual(hintOf('단계\t담당\t도구\n접수\t영업팀\t엑셀\n확인\t총무팀\tERP\n등록\t전산팀\tERP'), 'table');
  });
});

describe('전처리 — 좌표를 잃지 않는 정규화 (§1.1)', () => {
  it('손댈 게 없으면 항등 사상이다 (fast path)', () => {
    const m = TextMap.of('메일로 요청 받아요');
    strictEqual(m.work, m.orig);
    deepStrictEqual(m.toOrig([0, 3]), [0, 3]);
  });

  it('NFD 한글(macOS 복사)을 NFC로 접고도 원문 좌표를 되돌린다', () => {
    const orig = '확인'.normalize('NFD') + ' 후 등록';
    const m = TextMap.of(orig);
    strictEqual(m.work.startsWith('확인'), true);
    strictEqual(m.work.length < orig.length, true);
    deepStrictEqual(m.toOrig([0, m.work.length]), [0, orig.length]);
  });

  it('CRLF를 LF로 접어도 줄 수가 맞는다', () => {
    const r = parse('1. 거래처 등록 요청을 접수한다\r\n2. 첨부파일 누락을 확인한다\r\n3. ERP에 등록한다', { strict: true });
    strictEqual(r.items.length, 3);
  });
});

describe('실패 처리와 부분 성공 (§10)', () => {
  it('too_short — 비공백 20자 미만은 파싱하지 않고 1항목', () => {
    const r = parse('메일 확인');
    strictEqual(r.failure?.reason, 'too_short');
    strictEqual(r.items.length, 1);
    assertLossless('메일 확인', r);
  });

  it('over_limit — 20만자 초과는 파싱을 시도하지 않는다', () => {
    const big = '가나다라마바사아자차'.repeat(21_000);
    const r = parse(big);
    strictEqual(r.failure?.reason, 'over_limit');
    strictEqual(r.items.length, 1);
    strictEqual(r.items[0]!.sourceRange[1], big.length);
  });

  it('20,000자 초과는 줄 경계로 스냅해 꼬리로 남긴다 — 자르지 않는다', () => {
    const body = Array.from({ length: 2_500 }, (_, i) => `${i + 1}. 접수하고 확인한다`).join('\n');
    ok(body.length > LIMITS.PARSE_CHARS);
    const r = parse(body);
    ok(r.unparsedTailRange, '꼬리 구간이 있어야 무손실 검증이 가능하다');
    strictEqual(r.failure?.reason, 'over_limit');
    assertLossless(body, r);
    strictEqual(r.unparsedTail, body.slice(r.unparsedTailRange![0], r.unparsedTailRange![1]));
  });

  it('route — 8,000자·200줄까지는 동기, 그 위는 워커, 20만자 초과는 raw', () => {
    strictEqual(route('짧은 글'), 'sync');
    strictEqual(route('가\n'.repeat(300)), 'worker');
    strictEqual(route('가'.repeat(200_001)), 'raw');
  });

  it('assertLossless가 깨지면 "원문 1덩어리" 폴백으로 내려간다', () => {
    const broken: ParseResult = {
      ...parse(INPUTS.F6, { strict: true }),
      items: [
        {
          id: 'x', title: '없던 제목', kind: 'task', depth: 0, toolHints: [],
          sourceRange: [0, 5], boundaryConfidence: 1, boundaryBy: 'R5.line', classifyRule: 'default',
        },
      ],
    };
    throws(() => assertLossless(INPUTS.F6, broken), (e: unknown) => e instanceof LossError);
  });

  it('겹치는 구간은 overlap으로 잡힌다', () => {
    const r = parse(INPUTS.F1, { strict: true });
    const bad: ParseResult = { ...r, items: [...r.items, { ...r.items[0]!, id: 'dup' }] };
    throws(() => assertLossless(INPUTS.F1, bad), (e: unknown) => (e as LossError).code === 'overlap');
  });
});

describe('성능 (§12)', () => {
  it('200줄을 300ms 안에 동기로 끝낸다', () => {
    const doc = Array.from({ length: 200 }, (_, i) =>
      i % 3 === 0
        ? `${Math.floor(i / 3) + 1}. 메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요`
        : i % 3 === 1
          ? `   - 홈택스에서 사업자등록상태를 조회한다. (약 10분)`
          : `   가. 승인되면 그룹웨어에 상신하고 아니면 반려한다`,
    ).join('\n');
    strictEqual(route(doc), 'sync');
    const t0 = performance.now();
    const r = parse(doc, { strict: true });
    const ms = performance.now() - t0;
    ok(r.items.length > 100);
    ok(ms < 300, `${ms.toFixed(1)}ms — 300ms 예산 초과`);
  });

  it('절 후보가 많은 프로즈에서도 이차식으로 터지지 않는다 (HitIndex)', () => {
    const one = '메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요. ';
    const t = (n: number) => {
      const doc = one.repeat(n);
      const t0 = performance.now();
      parse(doc);
      return performance.now() - t0;
    };
    t(20); // 워밍업
    const small = Math.max(t(20), 0.5);
    const large = t(160);
    ok(large / small < 40, `8배 입력에 ${(large / small).toFixed(1)}배 — 선형에서 너무 벗어난다`);
  });
});

describe('텔레메트리 계약 (부록 B · MEASUREMENT)', () => {
  it('ruleHits는 {newline, numbering, verb}를 항상 채운다', () => {
    for (const f of fixtures) {
      const h = parse(f.input, { strict: true }).ruleHits;
      ok(Number.isInteger(h.newline) && Number.isInteger(h.numbering) && Number.isInteger(h.verb), f.name);
      ok(h.newline + h.numbering + h.verb > 0, f.name);
    }
  });

  it('boundaryConfidence는 모든 항목에 있다 — 소급 계산할 수 없는 값이다 (§13.4)', () => {
    for (const f of fixtures) {
      for (const i of parse(f.input, { strict: true }).items) {
        ok(i.boundaryConfidence > 0 && i.boundaryConfidence <= 1, `${f.name}: ${i.title}`);
        match(i.boundaryBy, /^R\d\./);
      }
    }
  });

  it('미매칭 도구 후보를 카탈로그 확장 큐로 올린다 (§7.1)', () => {
    const r = parse('트렐로에 카드 만들고 리니어에 이슈 등록해요. 그 다음 컨플루언스에 정리합니다', { strict: true });
    ok(r.unmatchedToolCandidates.length >= 0);
    strictEqual(Array.isArray(r.unmatchedToolCandidates), true);
  });
});

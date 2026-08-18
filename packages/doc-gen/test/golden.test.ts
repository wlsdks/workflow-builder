/**
 * packages/doc-gen/test/golden.test.ts
 *
 *   node --test packages/doc-gen/test/
 *
 * §11.3의 골든 픽스처 12건. 외부 러너 의존 없음(node:test).
 *
 * 1번은 **스냅샷 일치**이고, 그 스냅샷의 출처는 docs/HANDOVER.md §2.1 전문이다.
 * 로컬 사본(test/__golden__)과 스펙 원문이 어긋나면 그것도 실패로 만든다 —
 * 사본이 조용히 갈라지면 "스펙과 같다"는 이 테스트의 주장이 거짓이 된다.
 */

import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { FIN01, FIN01_NOTES } from '../src/__fixtures__/fin01.ts';
import { VAC01 } from '../src/__fixtures__/vac01.ts';
import {
  EIGHT_ASSIGNEES,
  FULLY_FILLED,
  NESTED_BRANCH,
  NO_CASE_LABELS,
  OVERLAPPING_LOOPS,
  SHORT_TITLES,
  SINGLE_ASSIGNEE,
  TITLES_ONLY,
  TOO_FEW,
  vacationOf,
} from '../src/__fixtures__/cases.ts';
import { generateHandover } from '../src/render/handover.ts';
import { generateVacation } from '../src/render/vacation.ts';
import { generateOnepager } from '../src/render/onepager.ts';
import { generateBook, FRONT_SECTION_IDS } from '../src/render/book.ts';
import { toMarkdown } from '../src/format/markdown.ts';
import { toPlainText } from '../src/format/text.ts';
import { assertTextAbsent, auditSentences, PrivateLeakError } from '../src/guard.ts';
import type { BookEntry, BookInput } from '../src/render/book.ts';
import type { DocTree, FlowInput, Section } from '../src/types.ts';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../../', import.meta.url).pathname;

function docOf(flow: FlowInput, opts = {}): DocTree {
  const res = generateHandover(flow, opts);
  ok(res.ok, '문서가 만들어져야 한다');
  return res.doc;
}

const sectionOf = (doc: DocTree, id: Section['id']): Section | undefined =>
  doc.sections.find((s) => s.id === id);

/** docs/HANDOVER.md 안의 ````markdown 블록을 뽑는다 */
function extractSpecBlock(marker: string): string {
  const lines = readFileSync(`${REPO}docs/HANDOVER.md`, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(marker));
  ok(start >= 0, `${marker}를 찾지 못했다`);
  const open = lines.findIndex((l, i) => i >= start && l.trim() === '````markdown');
  const close = lines.findIndex((l, i) => i > open && l.trim() === '````');
  return lines.slice(open + 1, close).join('\n') + '\n';
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. §2.1 「월 마감 정산」 전문 — 스냅샷 일치
 * ──────────────────────────────────────────────────────────────────────────── */

describe('1. §2.1 전문', () => {
  const golden = readFileSync(`${HERE}__golden__/handover-fin01.md`, 'utf8');

  it('마크다운 출력이 스펙 전문과 바이트 단위로 같다', () => {
    strictEqual(toMarkdown(docOf(FIN01, { firstTime: true })), golden);
  });

  it('로컬 골든 사본이 docs/HANDOVER.md §2.1과 같다', () => {
    strictEqual(golden, extractSpecBlock('### 2.1 생성된 문서 전문'));
  });

  it('같은 입력이면 같은 출력이다 (순수하다)', () => {
    const a = toMarkdown(docOf(FIN01, { firstTime: true }));
    const b = toMarkdown(docOf(FIN01, { firstTime: true }));
    strictEqual(a, b);
  });

  it('요약 숫자가 문서 안의 실제 개수와 맞다', () => {
    const doc = docOf(FIN01, { firstTime: true });
    const blocks = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'handoff');
    strictEqual(blocks.length, doc.meta.handoffCount);
    strictEqual(doc.meta.handoffCount, 4);
    strictEqual(doc.meta.stepCount, 14);
    strictEqual(doc.meta.peopleCount, 3);
    strictEqual(doc.meta.toolCount, 8);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 메타데이터 0%
 * ──────────────────────────────────────────────────────────────────────────── */

describe('2. 메타데이터 0% (제목만 14개)', () => {
  const doc = docOf(TITLES_ONLY);
  const md = toMarkdown(doc);

  it('문서가 나온다', () => {
    ok(md.includes('## 순서대로'));
    ok(md.includes('### 14. '));
  });

  it('문장이 하나도 안 깨진다 — 빈 슬롯이 남지 않는다', () => {
    ok(!md.includes(' 님이 해요'), '없는 담당자로 문장을 만들지 않는다');
    ok(!/\s로 해요/.test(md), '없는 도구로 문장을 만들지 않는다');
    ok(!md.includes('undefined'));
    ok(!md.includes('null'));
    ok(!/\|\s*\|\s*\|\s*\|\s*\|\s*\|\s*\|/.test(md.split('## 단계별로')[0] ?? ''));
  });

  it('제목만 남는다 — 메타 문장이 아예 없다', () => {
    const steps = sectionOf(doc, 'steps')!;
    const bodies = steps.blocks.filter((b) => b.kind === 'lines');
    strictEqual(bodies.length, 0, '메타가 0개면 문장이 0개다 (§4.1 결합표)');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 메타데이터 100%
 * ──────────────────────────────────────────────────────────────────────────── */

describe('3. 메타데이터 100%', () => {
  const doc = docOf(FULLY_FILLED);

  it('결핍 섹션이 생략된다', () => {
    strictEqual(sectionOf(doc, 'questions'), undefined);
  });

  it('축하 문구를 넣지 않는다', () => {
    const md = toMarkdown(doc);
    ok(!md.includes('축하'));
    ok(!md.includes('훌륭'));
    ok(!md.includes('완성'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 비공개 노트 — 출력에 노트 텍스트가 0회 (하드 어서션)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('4. 비공개 노트 3개', () => {
  const doc = docOf(FIN01, { firstTime: true });
  const md = toMarkdown(doc);
  const txt = toPlainText(doc);

  it('노트 원문이 마크다운·텍스트 어디에도 없다', () => {
    for (const note of FIN01_NOTES) {
      strictEqual(md.includes(note), false, note);
      strictEqual(txt.includes(note), false, note);
    }
    assertTextAbsent(md, FIN01_NOTES);
    assertTextAbsent(txt, FIN01_NOTES);
  });

  it('노트를 특정하는 조각도 없다', () => {
    // 승격된 각주는 소유자가 **다시 적은** 문장이다. 원문 조각이 새면 안 된다
    for (const fragment of ['매출대장', 'CFO님은', '○○팀은 매달']) {
      strictEqual(md.includes(fragment), false, fragment);
    }
  });

  it('입력에 노트 필드가 있으면 예외를 던진다 — 경고가 아니다', () => {
    const key = 'private' + 'Note';
    const leaky = {
      ...FIN01,
      steps: FIN01.steps.map((s, i) => (i === 3 ? { ...s, [key]: FIN01_NOTES[0] } : s)),
    } as FlowInput;
    throws(() => generateHandover(leaky), PrivateLeakError);
  });

  it('짜증 플래그도 같은 문으로 막힌다', () => {
    const leaky = {
      ...FIN01,
      steps: FIN01.steps.map((s, i) => (i === 3 ? { ...s, painFlag: true } : s)),
    } as FlowInput;
    throws(() => generateHandover(leaky), PrivateLeakError);
  });

  it('짜증 표시 문자가 출력에 없다', () => {
    strictEqual(md.includes('\u{1F624}'), false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5 · 6. 갈래 중첩과 루프
 * ──────────────────────────────────────────────────────────────────────────── */

describe('5. 3단 중첩 갈래', () => {
  const doc = docOf(NESTED_BRANCH);
  const md = toMarkdown(doc);

  it('본문에서 빠지고 부록으로 간다', () => {
    ok(md.includes('이 경우는 뒤에 따로 적었어요 → 부록 가'));
    ok(sectionOf(doc, 'appendix') !== undefined);
    ok(md.includes('## 부록 가.'));
  });

  it('소수점 번호를 만들지 않는다 — 소리 내어 부를 수 있어야 한다', () => {
    ok(!/\*\*\d+\.\d+\./.test(md));
    ok(md.includes('3-가'));
  });
});

describe('6. 루프 2개 겹침', () => {
  const doc = docOf(OVERLAPPING_LOOPS);
  const steps = toMarkdown({ ...doc, sections: [sectionOf(doc, 'steps')!] });
  const exceptions = toMarkdown({ ...doc, sections: [sectionOf(doc, 'exceptions')!] });

  it('본문에서 문장으로 쓰지 않는다', () => {
    ok(!steps.includes('돌아가서'));
    ok(!steps.includes('돌아가요'));
  });

  it('되돌아가는 곳 목록에서만 다룬다', () => {
    ok(exceptions.includes('되돌아가는 곳은 두 군데예요.'));
    ok(exceptions.includes('**4-나**에서 **2번으로**'));
    ok(exceptions.includes('**5-나**에서 **3번으로**'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7 · 8. 인계 블록
 * ──────────────────────────────────────────────────────────────────────────── */

describe('7. 담당자 전원 동일', () => {
  const doc = docOf(SINGLE_ASSIGNEE);
  it('인계 블록 0개, 요약도 0번', () => {
    const blocks = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'handoff');
    strictEqual(blocks.length, 0);
    strictEqual(doc.meta.handoffCount, 0);
    ok(toMarkdown(doc).includes('담당이 바뀌는 곳 0번'));
  });
});

describe('8. 담당자 8명', () => {
  const doc = docOf(EIGHT_ASSIGNEES);
  it('인계 블록 수 = 요약 숫자', () => {
    const blocks = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'handoff');
    strictEqual(blocks.length, 7);
    strictEqual(doc.meta.handoffCount, 7);
    ok(toMarkdown(doc).includes('담당이 바뀌는 곳 7번'));
  });

  it('"인계"라는 말이 본문에 나오지 않는다', () => {
    ok(!toMarkdown(doc).includes('인계'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9. 생성 거부
 * ──────────────────────────────────────────────────────────────────────────── */

describe('9. 생성 거부 3종', () => {
  it('단계 4개 — 거부하고 복사를 권한다', () => {
    const res = generateHandover(TOO_FEW);
    strictEqual(res.ok, false);
    if (res.ok) return;
    strictEqual(res.refusal.reason, 'too-few-steps');
    strictEqual(
      res.refusal.message,
      '지금은 단계가 네 개라서, 문서보다 그냥 복사해서 보내시는 게 나아요.',
    );
    deepStrictEqual(
      res.refusal.actions.map((a) => a.id),
      ['copy', 'add-steps'],
    );
    strictEqual(res.refusal.actions[0]?.label, '복사하기');
  });

  it('제목 평균 8자 미만 — 거부', () => {
    const res = generateHandover(SHORT_TITLES);
    strictEqual(res.ok, false);
    if (!res.ok) strictEqual(res.refusal.reason, 'titles-too-short');
  });

  it('갈래 판단 기준이 전부 빔 — 거부', () => {
    const res = generateHandover(NO_CASE_LABELS);
    strictEqual(res.ok, false);
    if (!res.ok) strictEqual(res.refusal.reason, 'no-branch-criteria');
  });

  it('거부는 에러가 아니라 대안이다 — 두 버튼이 같은 위계', () => {
    for (const flow of [TOO_FEW, SHORT_TITLES, NO_CASE_LABELS]) {
      const res = generateHandover(flow);
      if (res.ok) continue;
      strictEqual(res.refusal.actions.length, 2);
      ok(!res.refusal.message.includes('안 됐'));
      ok(!res.refusal.message.includes('할 수 없'));
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 10. 흐름 15개 묶음
 * ──────────────────────────────────────────────────────────────────────────── */

describe('10. 흐름 15개 묶음', () => {
  const entries: BookEntry[] = Array.from({ length: 15 }, (_, i) => ({
    flowId: `f${i}`,
    title: `${i + 1}번째 흐름`,
    group: i < 4 ? 'soon' : i < 9 ? 'onRequest' : i < 13 ? 'later' : 'notYours',
    dueLabel: i < 4 ? `9월 ${i + 1}일` : undefined,
    stepCount: 7,
    questions: [`${i + 1}번째 흐름에서 물어볼 것`],
    accounts: ['더존 ERP 계정'],
    calendar: i < 4 ? [{ when: `9월 ${i + 1}일`, what: '시작해요' }] : undefined,
  }));
  const input: BookInput = {
    title: '재무팀 회계 업무 인계',
    subtitle: '이수진 님이 2026년 9월까지 하시던 일',
    ownerId: 'a',
    receiverId: 'b',
    people: [
      { id: 'a', name: '이수진', team: '재무팀', channel: '슬랙 @sujin' },
      { id: 'b', name: '조은비', team: '재무팀', channel: '슬랙 @eunbi' },
    ],
    entries,
    asOf: { year: 2026, month: 8, day: 17 },
    ownerLastDayLabel: '9월 12일',
  };
  const res = generateBook(input);
  ok(res.ok);
  const doc = res.ok ? res.doc : ({} as DocTree);

  it('앞 8쪽 구조가 성립한다', () => {
    const ids = doc.sections.map((s) => s.id);
    for (const want of FRONT_SECTION_IDS) ok(ids.includes(want as Section['id']), want);
    strictEqual(ids[0], 'cover');
    strictEqual(ids[1], 'toc');
  });

  it('4군 분류가 곧 목차다', () => {
    const md = toMarkdown(doc);
    for (const g of ['곧 닥치는 것', '요청이 오면 하는 것', '한참 뒤에 오는 것', '안 하셔도 되는 것']) {
      ok(md.includes(g), g);
    }
  });

  it('접합 그림을 넣지 않는다 — 15개를 넘으면 읽을 수 없다', () => {
    ok(toMarkdown(doc).includes('이어지는 그림은 넣지 않았어요'));
  });

  it('서른 개를 넘으면 만들지 않는다', () => {
    const many = { ...input, entries: [...entries, ...entries, ...entries] };
    const r = generateBook(many);
    strictEqual(r.ok, false);
    if (!r.ok) strictEqual(r.refusal.reason, 'too-many-flows');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 11. 부재 기간 3종
 * ──────────────────────────────────────────────────────────────────────────── */

describe('11. 자리 비울 때 볼 안내', () => {
  it('§3.3 전문과 바이트 단위로 같다', () => {
    const res = generateVacation(VAC01);
    ok(res.ok);
    if (!res.ok) return;
    strictEqual(toMarkdown(res.doc), extractSpecBlock('### 3.3 생성된 문서 전문'));
  });

  it('3일 — 「꼭 해야 하는 것」만 남고 나머지는 한 줄씩', () => {
    const res = generateVacation(vacationOf(3));
    ok(res.ok);
    if (!res.ok) return;
    const md = toMarkdown(res.doc);
    ok(md.includes('## 꼭 해야 하는 것'));
    ok(md.includes('- **주간 리스트**'));
    ok(!md.includes('- **주간 리스트** —'), '3일 이하는 사유를 붙이지 않는다');
  });

  it('2주 — 네 섹션 전부', () => {
    const res = generateVacation(vacationOf(14));
    ok(res.ok);
    if (!res.ok) return;
    const md = toMarkdown(res.doc);
    ok(md.includes('## 오면 받아만 두시면 되는 것'));
    ok(md.includes('- **주간 리스트** — 한 주 건너뛰어도 괜찮아요.'));
  });

  it('5주 — 인계 문서로 안내한다', () => {
    const res = generateVacation(vacationOf(35));
    strictEqual(res.ok, false);
    if (res.ok) return;
    strictEqual(res.refusal.reason, 'absence-too-long');
    deepStrictEqual(
      res.refusal.actions.map((a) => a.id),
      ['handover', 'short'],
    );
  });

  it('「안 하셔도 돼요」가 비면 만들지 않고 되묻는다', () => {
    const res = generateVacation({ ...vacationOf(5), skip: [] });
    strictEqual(res.ok, false);
    if (!res.ok) strictEqual(res.refusal.message, '이 기간에 미뤄도 되는 일이 하나도 없나요?');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 12. 생성 문장 전수 검사
 *
 * ★ **사용자 원문은 검사 대상이 아니다.** 여기서 검사하는 것은 엔진이 쓴 조각뿐이고,
 *   길이는 조립된 생성 문장 전체를 잰다. 이 구분이 무너지면 사용자 원문을
 *   고치기 시작하고, 그건 §4.0 원칙 ①의 위반이다.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('12. 생성 문장 전수', () => {
  const docs: DocTree[] = [
    docOf(FIN01, { firstTime: true }),
    docOf(TITLES_ONLY),
    docOf(FULLY_FILLED),
    docOf(NESTED_BRANCH),
    docOf(OVERLAPPING_LOOPS),
    docOf(SINGLE_ASSIGNEE),
    docOf(EIGHT_ASSIGNEES),
    generateOnepager(FIN01),
  ];
  {
    const v = generateVacation(VAC01);
    if (v.ok) docs.push(v.doc);
  }

  const engineParts = docs.flatMap((d) => d.audit.engineParts);
  const sentences = docs.flatMap((d) => d.audit.sentences);

  it('엔진이 만든 조각에 금지어 0개', () => {
    const bad = auditSentences(engineParts).filter((v) => v.rule === 'forbidden-word');
    deepStrictEqual(bad, []);
  });

  it('느낌표 0개 · 이모지 0개', () => {
    const bad = auditSentences(engineParts).filter(
      (v) => v.rule === 'exclamation' || v.rule === 'emoji',
    );
    deepStrictEqual(bad, []);
    for (const d of docs) {
      const md = toMarkdown(d);
      strictEqual(/[가-힣][^\n]*!/.test(md), false);
      strictEqual(/\p{Extended_Pictographic}/u.test(md), false);
    }
  });

  it('사용자 원문은 검사하지 않는다 — 원문에 금지어가 있어도 통과한다', () => {
    const withBanned: FlowInput = {
      ...FULLY_FILLED,
      steps: FULLY_FILLED.steps.map((s, i) =>
        i === 0 ? { ...s, title: '비효율 구간 모니터링 결과를 정리해요' } : s,
      ),
    };
    const doc = docOf(withBanned);
    ok(toMarkdown(doc).includes('비효율 구간 모니터링'), '원문은 그대로 나간다');
    deepStrictEqual(
      auditSentences(doc.audit.engineParts).filter((v) => v.rule === 'forbidden-word'),
      [],
    );
  });

  /**
   * 25자 규칙 (WRITING §1 · §9.1 #13).
   *
   * **엔진이 쓴 글자만 잰다.** 사용자가 40자짜리 대기 절을 적었다면 그 문장은
   * 길어지지만, 그걸 줄이는 유일한 방법은 남의 글을 고치는 것이고 그건 §4.0
   * 원칙 ①의 위반이다. 엔진은 **자기가 쓴 것의 길이에만** 책임진다.
   *
   * 그리고 스펙이 문면을 못박은 문장 몇 개는 그래도 25자를 넘는다. 조용히
   * 통과시키면 규칙이 죽으므로 **넘는 문장의 목록 자체를 고정한다.**
   */
  it('25자를 넘는 생성 문장은 스펙이 문면을 못박은 것뿐이다', () => {
    const long = [...new Set(auditSentences(engineParts).filter((v) => v.rule === 'too-long').map((v) => v.sentence))].sort();
    if (process.env.SHOW_LONG) console.log(JSON.stringify(long, null, 2));
    deepStrictEqual(long, [
      // §6.2 표 보는 법 3줄
      '**표 보는 법** — `기다림`은 사람이 손을 대는 게 아니라 흐름이 멈춰 있는 구간이에요.',
      // §2.1 푸터 (이름은 사용자 원문이라 여기서는 빠져 보인다)
      '2026년 8월 17일에 님이 정리한 흐름으로 만들었어요.',
      // WRITING §9 요약 카드 하단 고정 문구
      '같은 일을 하는 사람끼리 말을 맞출 때 쓰는 좌표예요.',
      // §4.2 approval 반려 행선지 결핍
      '다시 하라는 얘기가 나오면 어디부터 다시 하는지는 아직 안 적혀 있어요.',
      // WRITING §12 예외 없음 빈 상태
      '없는 게 아니라 아직 안 적었을 가능성이 커요.',
      // §5.3 조건 ②의 마지막 한 줄
      '여쭤보고 나서 이 흐름에 적어두시면, 다음 분은 안 물어봐도 돼요.',
      // §2.1 「이렇게 안 흘러갈 때」 맺음
      '하시다가 새로 겪는 게 있으면 여기에 적어두세요.',
      // §2.3 (g) 연락처를 안 넣는 이유
      '회사 밖 사람 연락처는 이 문서에 적지 않았어요.',
    ]);
  });

  it('엔진이 날짜·금액을 새로 만들지 않는다 (D-063)', () => {
    // 생성 문장에 나오는 숫자는 단계 번호·개수·시간 합계뿐이다
    const md = toMarkdown(docs[0]!);
    ok(md.includes('적힌 것만 합쳐서'), '시간 합계에는 단서가 반드시 붙는다');
    ok(!/\d+원/.test(docs[0]!.audit.engineParts.join('\n')), '금액을 만들지 않는다');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 불변식
 * ──────────────────────────────────────────────────────────────────────────── */

describe('불변식', () => {
  it('입력을 변형하지 않는다', () => {
    const before = JSON.stringify(FIN01);
    docOf(FIN01, { firstTime: true });
    strictEqual(JSON.stringify(FIN01), before);
  });

  it('고아 참조는 하드 실패다 — 문서가 거짓말을 하면 안 된다', () => {
    const broken: FlowInput = {
      ...FIN01,
      steps: FIN01.steps.map((s) =>
        s.id === 's11' ? { ...s, hold: { ...s.hold!, escalation: { toStepId: 'nope' } } } : s,
      ),
    };
    throws(() => generateHandover(broken), /없는 단계/);
  });

  it('처음이에요 옵션은 섹션을 더할 뿐 문장을 다시 쓰지 않는다', () => {
    const plain = toMarkdown(docOf(FIN01));
    const first = toMarkdown(docOf(FIN01, { firstTime: true }));
    ok(!plain.includes('### 시작 전에 받아두실 것'));
    ok(first.includes('### 시작 전에 받아두실 것'));
    ok(first.includes('이수진 님이 홈택스·더존 ERP·엑셀로 해요.'));
    ok(plain.includes('이수진 님이 홈택스·더존 ERP·엑셀로 해요.'));
  });

  it('마크다운은 ASCII 안전 문자만 쓴다', () => {
    const md = toMarkdown(docOf(FIN01, { firstTime: true }));
    for (const ch of ['◇', '⏸', '↩', '▸', '（', '）']) {
      strictEqual(md.includes(ch), false, ch);
    }
  });

  it('plain text에서 마크다운 장식이 벗겨진다', () => {
    const txt = toPlainText(docOf(FIN01, { firstTime: true }));
    strictEqual(txt.includes('**'), false);
  });

  it('한 장 요약에는 평가로 읽힐 숫자 해설이 반드시 붙는다', () => {
    const md = toMarkdown(generateOnepager(FIN01));
    ok(md.includes('이 숫자는 많고 적음을 뜻하지 않아요.'));
  });

  it('접속 표현은 기본이 "쓰지 않는다"', () => {
    const md = toMarkdown(docOf(FIN01, { firstTime: true }));
    for (const w of ['그다음', '이때 ', '만약 ']) {
      strictEqual(md.includes(w), false, w);
    }
  });

  it('앞이 기다림이고 인계도 재촉 행선지도 아니면 접속 표현이 붙는다', () => {
    const flow: FlowInput = {
      ...FULLY_FILLED,
      steps: [
        FULLY_FILLED.steps[0]!,
        {
          id: 'h',
          kind: 'hold',
          title: '팀장님 확인을 기다려요',
          hold: { waitFor: 'reply', avgWaitH: 24, waitTarget: '팀장님' },
        },
        ...FULLY_FILLED.steps.slice(1),
      ],
    };
    const md = toMarkdown(docOf(flow));
    ok(md.includes('팀장님에서 답이 올 때까지 보통 하루쯤 걸려요.'));
    ok(md.includes('답이 오면, '));
  });
});

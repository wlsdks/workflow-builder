#!/usr/bin/env node
/**
 * 문서가 주장하는 숫자를 실제와 대조한다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 이게 필요한가
 *
 * 이 저장소는 코드에 D-100(게이트가 살아 있는지 검증)을 적용했지만
 * **문서 자체의 최신성에는 아무 장치가 없었다.** 외부 감사에서 이렇게 나왔다:
 *
 *   "README가 스스로의 git history보다 낡았다. 이 프로젝트가 가장 자랑하는
 *    '문서가 거짓말하면 잡는다'는 장치가 가장 상위 문서에는 적용 안 됐다."
 *
 * 실제로 한 번에 발견된 것:
 *   - graph-core 테스트 "57건"  → 실제 378건 (ops/ 추가 후 갱신 안 됨)
 *   - SYNC.md "393건"           → 실제 397건
 *   - "문서 25개"                → 실제 26개
 *   - "graph-core만 선행 구현"   → 실제 8패키지
 *
 * 전부 README가 "npm test 돌려보라"고 지시하는 바로 그 명령으로 반증된다.
 * 그래서 **문서를 읽는 사람이 반증하기 전에 CI가 반증하게** 만든다.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// ── 실제 값을 측정한다 ──────────────────────────────────────────────────

const PKGS = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const testCount = (pkg) => {
  const out = execSync('npm test 2>&1 || true', {
    cwd: join(ROOT, 'packages', pkg),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const m = out.match(/^ℹ pass (\d+)$/m);
  if (!m) throw new Error(`${pkg}: 테스트 결과를 읽지 못했다`);
  return Number(m[1]);
};

const perPkg = Object.fromEntries(PKGS.map((p) => [p, testCount(p)]));
const decisions = read('docs/DECISIONS.md');

const ACTUAL = {
  docCount: readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).length,
  pkgCount: PKGS.length,
  totalTests: Object.values(perPkg).reduce((a, b) => a + b, 0),
  decisions: (decisions.match(/^## D-/gm) ?? []).length,
  rejected: (decisions.match(/^\| ❌/gm) ?? []).length,
  ...perPkg,
};

// ── 문서가 주장하는 값 ──────────────────────────────────────────────────
//
// 각 항목은 "이 문서의 이 정규식이 뽑는 숫자는 이 실제값과 같아야 한다"이다.
// 새 주장을 문서에 쓰면 여기에도 한 줄 추가한다. 추가하지 않으면 그 숫자는
// 아무도 지키지 않는다 — 그게 지금까지 벌어진 일이다.

const CLAIMS = [
  { file: 'README.md',        re: /문서가 (\d+)개/,                    actual: 'docCount',   what: '문서 개수' },
  { file: 'README.md',        re: /순수 함수 패키지 (\d+)개/,           actual: 'pkgCount',   what: '패키지 개수' },
  { file: 'README.md',        re: /테스트 ([\d,]+)건\./,                actual: 'totalTests', what: '총 테스트' },
  { file: 'README.md',        re: /npm test\s+# ([\d,]+)건/,           actual: 'totalTests', what: '총 테스트(명령 주석)' },
  { file: 'README.md',        re: /\*\*결정 (\d+)건\*\*|결정 (\d+)건 \+ 기각/, actual: 'decisions', what: '결정 건수' },
  { file: 'README.md',        re: /기각 (\d+)건/,                      actual: 'rejected',   what: '기각 건수' },

  { file: 'docs/OVERVIEW.md', re: /문서 (\d+)개 37,000줄/,             actual: 'docCount',   what: '문서 개수' },
  { file: 'docs/OVERVIEW.md', re: /(\d+)패키지 ·/,                     actual: 'pkgCount',   what: '패키지 개수' },
  { file: 'docs/OVERVIEW.md', re: /테스트 ([\d,]+)건 통과\*\*/,         actual: 'totalTests', what: '총 테스트' },

  { file: 'packages/README.md', re: /테스트 ([\d,]+)건/,               actual: 'totalTests', what: '총 테스트' },
  { file: 'packages/README.md', re: /npm test\s+# ([\d,]+)건/,         actual: 'totalTests', what: '총 테스트(명령 주석)' },

  // 배포용 기획서(report/기획서.pdf)의 원본. PDF는 `npm run verify`가 열어보지
  // 못하므로 **원본 HTML을 대신 잡는다.** 숫자가 어긋난 채로 PDF가 재생성되면
  // 그건 저장소 밖으로 나가는 문서라 되돌릴 수 없다 — 나가기 전에 여기서 막는다.
  { file: 'report/plan.html', re: /상세 문서 (\d+)편<\/td>/,              actual: 'docCount',   what: '문서 편수' },
  { file: 'report/plan.html', re: /상세 문서 (\d+)편과 코드는/,            actual: 'docCount',   what: '문서 편수(맺음말)' },
  { file: 'report/plan.html', re: /자동 점검 ([\d,]+)가지/,               actual: 'totalTests', what: '자동 점검 수' },
  { file: 'report/plan.html', re: /결정 기록 (\d+)건/,                   actual: 'decisions',  what: '결정 건수' },
];

// 패키지 README는 자기 테스트 수를 스스로 주장한다 — 전부 대조
for (const p of PKGS) {
  CLAIMS.push({
    file: `packages/${p}/README.md`,
    re: /\| 테스트 \| (\d+)건 \|/,
    actual: p,
    what: `${p} 테스트`,
  });
}

// ── 대조 ────────────────────────────────────────────────────────────────

const num = (s) => Number(String(s).replace(/,/g, ''));
let bad = 0;
let checked = 0;

for (const c of CLAIMS) {
  let src;
  try {
    src = read(c.file);
  } catch {
    console.log(`  ✗ ${c.file} — 파일이 없다`);
    bad++;
    continue;
  }

  const m = src.match(c.re);
  if (!m) {
    // 주장이 사라진 것도 문제다 — 문서를 고치면서 여기를 안 고쳤다는 뜻
    console.log(`  ✗ ${c.file} — "${c.what}" 주장을 못 찾았다 (문서가 바뀌었으면 이 파일도 고쳐라)`);
    bad++;
    continue;
  }

  const claimed = num(m.slice(1).find((g) => g != null));
  const actual = ACTUAL[c.actual];
  checked++;

  if (claimed !== actual) {
    console.log(`  ✗ ${c.file} — ${c.what}: 문서 ${claimed} vs 실제 ${actual}`);
    bad++;
  }
}

console.log('');
if (bad) {
  console.log(`  문서 숫자 ${bad}건이 실제와 다르다.`);
  console.log('  이 숫자들은 README가 시키는 `npm test` 한 번으로 반증된다.');
  console.log('  읽는 사람이 반증하기 전에 여기서 잡는다.\n');
  process.exit(1);
}

console.log(`  ✓ 문서 숫자 ${checked}건 전부 실제와 일치`);
console.log(`    문서 ${ACTUAL.docCount}개 · 패키지 ${ACTUAL.pkgCount}개 · 테스트 ${ACTUAL.totalTests}건 · 결정 ${ACTUAL.decisions}건\n`);

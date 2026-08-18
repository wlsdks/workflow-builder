#!/usr/bin/env node
/**
 * 배포 차단 게이트.
 *
 * D-100 — 게이트를 만들 때는 게이트가 살아 있는지 검증하는 테스트를 함께 넣는다.
 *   이 파일 하단의 SELF_TEST가 그 역할을 한다. 각 규칙마다 "반드시 잡혀야 하는
 *   위반 예시"를 두고, 규칙이 그걸 못 잡으면 게이트 자체를 실패시킨다.
 *
 *   이 장치가 없어서 세 번 뚫렸다:
 *     1. n-400 Stylelint  — Tailwind는 paper-400으로 컴파일. 0건 검출, 항상 초록
 *     2. k-익명 퍼즈       — round(4/5)*5 = 5. 라운딩된 값을 보면 4명 셀이 통과
 *     3. elk.position     — forceNodeModelOrder가 지배해 아무 효과 없음
 *
 * 사용: node scripts/gates.mjs [--only=id1,id2]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '__fixtures__']);

// ────────────────────────────────────────────────────────────────
// 규칙 정의
//
//  id        고유 식별자
//  why       왜 막는가 (실패 메시지에 그대로 나간다)
//  ext       검사할 확장자
//  pattern   위반 정규식
//  allow     예외 (파일 경로 정규식). 최소한으로 유지할 것
//  mustCatch 이 문자열은 반드시 잡혀야 한다 — 게이트 생존 확인용
//  mustPass  이 문자열은 잡히면 안 된다 — 오탐 확인용
// ────────────────────────────────────────────────────────────────

const RULES = [
  // ── A. 디자인 토큰 (DESIGN §4 · ACCESSIBILITY §5) ──
  {
    id: 'contrast-text',
    why: 'paper-200/300/400은 텍스트 대비 미달(2.43:1). 텍스트는 paper-550 이상',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /\btext-paper-(200|300|400)\b/g,
    mustCatch: ['className="text-paper-400"'],
    mustPass: ['className="text-paper-550"'],
  },
  {
    id: 'contrast-placeholder',
    why: 'placeholder는 이 제품의 주 안내문이다. 2.43:1이면 40~50대에게 안 보인다',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /placeholder:text-paper-(200|300|400)\b/g,
    mustCatch: ['placeholder:text-paper-400'],
    mustPass: ['placeholder:text-paper-550'],
  },
  {
    id: 'contrast-border',
    why: '인터랙티브 경계선은 비텍스트 3:1 필요. paper-450 사용 (paper-200은 1.26:1)',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /\bborder-paper-(200|300)\b/g,
    allow: /decorative|ghost/,
    mustCatch: ['border-paper-200'],
    mustPass: ['border-paper-450'],
  },
  {
    id: 'no-blue',
    why: '파랑은 팔레트에 없다 (D-020). "회사 시스템" 인상을 만든다',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /\b(bg|text|border|ring|from|to)-(blue|indigo|violet|sky|cyan)-\d/g,
    mustCatch: ['bg-blue-500'],
    mustPass: ['bg-brand-500'],
  },
  {
    id: 'branch-color',
    why: '#A56A12는 4.50:1로 임계에 정확히 걸린다. #9E6511 사용 (4.86:1)',
    ext: ['.ts', '.tsx', '.css', '.md'],
    pattern: /#A56A12\b/gi,
    // 정정 이력을 서술하는 문서는 옛 값을 인용해야 한다.
    // 코드(.ts/.tsx/.css)에는 예외가 없다 — 거기 남아 있으면 그건 이력이 아니라 버그다.
    allow: /^docs\/.*\.md$/,
    mustCatch: ['color: #A56A12'],
    mustPass: ['color: #9E6511'],
  },

  // ── B. 모션·로딩 (DESIGN §9 · STATES §8) ──
  {
    id: 'no-spinner',
    why: '스피너·shimmer 금지. 로딩은 정적 회색 블록 + 텍스트 상태로',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /\banimate-(spin|pulse|bounce|ping)\b/g,
    mustCatch: ['<div className="animate-spin" />'],
    mustPass: ['<div className="animate-none" />'],
  },
  {
    id: 'no-overshoot',
    why: '오버슈트가 있는 순간 도구는 장난감이 된다. easing은 감쇠형만',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /cubic-bezier\(\s*[\d.]+\s*,\s*-[\d.]+/g,   // 두 번째 항이 음수 = 언더슈트/오버슈트
    mustCatch: ['transition: transform 200ms cubic-bezier(.68,-.55,.27,1.55)'],
    mustPass: ['transition: transform 200ms cubic-bezier(.2,.8,.2,1)'],
  },
  {
    id: 'no-shadow-default',
    why: '기본 그림자 금지. --edge-* 또는 --shadow-float (DESIGN §3)',
    ext: ['.tsx', '.css'],
    pattern: /\bshadow-(sm|md|lg|xl|2xl)\b/g,
    mustCatch: ['className="shadow-sm"'],
    mustPass: ['className="shadow-float"'],
  },
  {
    id: 'no-ring-offset',
    why: 'ring-offset 이중 링 폐기. 이중 링은 box-shadow 2단으로 (DESIGN §4)',
    ext: ['.ts', '.tsx', '.css'],
    pattern: /\bring-offset-\d/g,
    mustCatch: ['focus:ring-2 ring-offset-2'],
    mustPass: ['focus-visible:shadow-focus'],
  },

  // ── C. 프라이버시 (TRUST · SECURITY · MEASUREMENT) ──
  {
    id: 'no-private-note-in-render',
    why: '비공개 노트는 소유자만 본다. 렌더 트리에 있으면 빌드 실패 (D-062)',
    ext: ['.ts', '.tsx'],
    allow: /private-notes?\/|__tests__|\.test\./,
    pattern: /\bprivateNote\b/g,
    mustCatch: ['const x = item.privateNote'],
    mustPass: ['const x = item.title'],
  },
  {
    id: 'no-org-members-in-doc-access',
    why: '"관리자니까 볼 수 있게"가 코드 변경 없이 수용 불가능해야 한다 (D-081)',
    ext: ['.ts'],
    pattern: /function resolveDocumentAccess\s*\([^)]*org_?[Mm]embers/g,
    mustCatch: ['function resolveDocumentAccess(docId, orgMembers) {'],
    mustPass: ['function resolveDocumentAccess(docId) {'],
  },
  {
    id: 'no-headcount-output',
    why: '"인력 N명 감축"은 산출 금지 출력 (D-116). 계산이 아니라 출력을 막는다',
    ext: ['.ts', '.tsx'],
    pattern: /(인력|인원)\s*\d*\s*명?\s*(감축|절감|축소)|headcountReduction/g,
    allow: /gates\.mjs|\.test\./,
    mustCatch: ['const msg = "인력 3명 감축 가능"'],
    mustPass: ['const msg = "손이 덜 가게 만들 수 있어요"'],
  },

  // ── D. 문구 (WRITING §2) ──
  {
    id: 'forbidden-words',
    why: '직원 화면 금지어 (WRITING §2). 이 단어들이 신뢰를 깎는다',
    // .tsx만 읽으면 문장을 만드는 .ts(doc-gen/sentence, seed)를 통째로 놓친다.
    ext: ['.ts', '.tsx'],
    allow: /admin\/|\.test\.|__fixtures__|__golden__|\/lexicon\/|forbidden\.ts|guard\.ts|audit\.ts/,
    pattern: /["'`][^"'`]*(비효율|낭비|최적화|생산성|업무량|모니터링|미작성|진행률|완료율)[^"'`]*["'`]/g,
    mustCatch: ['const label = "비효율 구간"'],
    mustPass: ['const label = "여러 번 오가는 구간"'],
  },
  {
    id: 'no-exclamation',
    why: '느낌표는 제품 전체에 0개 (WRITING §1)',
    ext: ['.ts', '.tsx'],
    allow: /\.test\.|__fixtures__|__golden__|\/lexicon\/|guard\.ts|audit\.ts/,
    // ! 앞이 한글이거나 공백일 때만. `row[i]!` 같은 TS non-null 단언은
    // ! 앞이 ] ) 또는 식별자 문자라서 걸리지 않는다.
    pattern: /["'`][^"'`]*[가-힣][^"'`]*(?<=[가-힣\s])![^"'`]*["'`]/g,
    mustCatch: ['const t = "저장했어요!"', 'const t = `다 됐어요 !`'],
    mustPass: [
      'const t = "저장했어요."',
      'detail: `층 ${row[i]!.layer}: ${a.id}가 왼쪽에 있다`',   // TS non-null 단언
    ],
  },

  // ── E. 아키텍처 (D-101 · D-119) ──
  {
    id: 'no-elk-position',
    why: 'forceNodeModelOrder가 지배해 효과가 없다. 효과 없이 "뭔가 한다"는 착각만 만든다 (D-101)',
    ext: ['.ts'],
    pattern: /['"]elk\.position['"]/g,
    mustCatch: ["node['elk.position'] = { x, y }"],
    mustPass: ["node['elk.algorithm'] = 'layered'"],
  },
  {
    id: 'graph-core-purity',
    // 순수 패키지 목록: graph-core(D-119) · paste-parse(PARSING §12.4 — 그대로 워커에 올라간다).
    // 둘 다 런타임 의존성 0이 영구 계약이다.
    why: '순수 패키지(graph-core · paste-parse)는 런타임 의존성 0이 영구 계약 (D-119)',
    ext: ['.ts'],
    only: /packages\/(graph-core|paste-parse)\//,
    pattern: /from\s+['"](react|zod|drizzle-orm|elkjs|@xyflow)/g,
    mustCatch: ["import { z } from 'zod'"],
    mustPass: ["import { foo } from './util.ts'"],
  },
  {
    id: 'layout-core-no-elkjs',
    why: 'layout-core는 elkjs를 런타임 의존성으로 갖지 않는다. OG 라우트에 500KB가 들어오면 안 된다',
    ext: ['.ts'],
    only: /packages\/layout-core\/src\//,
    allow: /\/(build|read)\.ts$/,
    pattern: /from\s+['"]elkjs/g,
    mustCatch: ["import ELK from 'elkjs'"],
    mustPass: ["import type { ElkNode } from './types.ts'"],
  },
];

// ────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function check(rule, files) {
  const hits = [];
  for (const file of files) {
    if (!rule.ext.includes(extname(file))) continue;
    const rel = relative(ROOT, file);
    if (rule.only && !rule.only.test(rel)) continue;
    if (rule.allow && rule.allow.test(rel)) continue;

    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      const m = re.exec(lines[i]);
      if (m) hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 96), match: m[0] });
    }
  }
  return hits;
}

/** D-100 — 규칙이 실제로 뭔가를 잡는지 확인한다. 못 잡으면 그 규칙은 죽은 것이다. */
function selfTest(rule) {
  const problems = [];
  const test = (s) => new RegExp(rule.pattern.source, rule.pattern.flags).test(s);

  for (const s of rule.mustCatch ?? []) {
    if (!test(s)) problems.push(`규칙이 위반을 못 잡음: ${JSON.stringify(s)}`);
  }
  for (const s of rule.mustPass ?? []) {
    if (test(s)) problems.push(`규칙이 정상 코드를 잡음(오탐): ${JSON.stringify(s)}`);
  }
  if (!rule.mustCatch?.length) problems.push('mustCatch 예시가 없다 — 게이트 생존을 확인할 수 없다');
  return problems;
}

// ────────────────────────────────────────────────────────────────

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.split(',');
const rules = only ? RULES.filter((r) => only.includes(r.id)) : RULES;
const files = walk(ROOT);

let dead = 0;
let violations = 0;

console.log(`\n  게이트 ${rules.length}종 · 파일 ${files.length}개\n`);

// 1단계: 게이트가 살아 있는가
for (const rule of rules) {
  const problems = selfTest(rule);
  if (problems.length) {
    dead++;
    console.log(`  ✗ [${rule.id}] 게이트가 죽었다`);
    for (const p of problems) console.log(`      ${p}`);
  }
}

if (dead) {
  console.log(`\n  ${dead}개 규칙이 아무것도 막지 못한다.`);
  console.log('  방어하는 척하면서 아무것도 안 막는 것이 방어가 없는 것보다 나쁘다 (D-100).\n');
  process.exit(1);
}

// 2단계: 실제 위반이 있는가
for (const rule of rules) {
  const hits = check(rule, files);
  if (!hits.length) continue;
  violations += hits.length;
  console.log(`  ✗ [${rule.id}] ${hits.length}건`);
  console.log(`      ${rule.why}`);
  for (const h of hits.slice(0, 5)) {
    console.log(`      ${h.file}:${h.line}  ${h.text}`);
  }
  if (hits.length > 5) console.log(`      … 외 ${hits.length - 5}건`);
  console.log('');
}

if (violations) {
  console.log(`  총 ${violations}건. 배포 차단.\n`);
  process.exit(1);
}

console.log(`  ✓ 게이트 ${rules.length}종 전부 살아 있고, 위반 0건\n`);

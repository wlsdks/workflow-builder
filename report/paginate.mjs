// 목차 쪽번호는 추측할 수 없다 — 한 번 뽑아서 실제 쪽을 읽고, 그 값을 되써서 다시 뽑는다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HTML = process.argv[2], PDF = process.argv[3];
const SECTIONS = [
  ['s1', '한 문장'], ['s2', '비어 있는 자리'], ['s3', '어떻게 동작하는가'],
  ['s4', '설계 결정 여덟'], ['s5', '이 제품이 죽는 방법'], ['s6', '시장과 경쟁'],
  ['s7', '무엇을 어떤 순서로 만드나'], ['s8', '지금 상태 — 정직하게'],
];

const pageCount = Number(
  execFileSync('pdfinfo', [PDF], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)$/m)[1],
);

// 각 쪽의 첫 줄들. 절 제목은 page-break-before로 항상 쪽 머리에 온다.
const heads = [];
for (let p = 1; p <= pageCount; p++) {
  const t = execFileSync('pdftotext', ['-f', `${p}`, '-l', `${p}`, PDF, '-'], { encoding: 'utf8' });
  heads.push(t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | '));
}

let html = readFileSync(HTML, 'utf8');
const found = [];
for (const [id, title] of SECTIONS) {
  const idx = heads.findIndex((h, i) => i >= 2 && h.includes(title)); // 0-based, 목차 이후
  if (idx < 0) throw new Error(`"${title}" 절이 어느 쪽에서 시작하는지 못 찾았다`);
  const page = idx + 1;
  found.push([title, page]);
  const re = new RegExp(`(<span class="pg" data-sec="${id}">)[^<]*(</span>)`);
  if (!re.test(html)) throw new Error(`목차에 ${id} 슬롯이 없다`);
  html = html.replace(re, `$1${page}$2`);
}
writeFileSync(HTML, html);
console.log(found.map(([t, p]) => `  ${String(p).padStart(2)}  ${t}`).join('\n'));

// 목차 쪽번호는 조판 전에 알 수 없다 — 한 번 뽑아서 실제 쪽을 읽고, 되써서 다시 뽑는다.
//
// 절 목록은 **HTML에서 직접 읽는다.** 여기에 제목을 적어 두면 문서를 고칠 때마다
// 같이 고쳐야 하고, 안 고치면 이 파일이 문서보다 낡는다 — 이 저장소가 계속 잡아 온
// 바로 그 종류의 거짓말이다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HTML = process.argv[2], PDF = process.argv[3];
let html = readFileSync(HTML, 'utf8');

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const sections = [...html.matchAll(/<section (?:class="brief" )?id="(\w+)">\s*<h2>([\s\S]*?)<\/h2>/g)]
  .map((m) => [m[1], strip(m[2])]);
if (!sections.length) throw new Error('절을 하나도 못 찾았다 — 문서 구조가 바뀌었나');

const pages = Number(execFileSync('pdfinfo', [PDF], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)$/m)[1]);

// 각 쪽의 첫 줄들. 절 제목은 항상 쪽 머리에 온다(page-break-before).
const heads = [];
for (let p = 1; p <= pages; p++) {
  const t = execFileSync('pdftotext', ['-f', `${p}`, '-l', `${p}`, PDF, '-'], { encoding: 'utf8' });
  heads.push(t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | '));
}

const out = [];
for (const [id, title] of sections) {
  const idx = heads.findIndex((h, i) => i >= 2 && h.includes(title)); // 표지·목차 이후
  if (idx < 0) throw new Error(`"${title}" 절이 어느 쪽에서 시작하는지 못 찾았다`);
  const re = new RegExp(`(<span class="pg" data-sec="${id}">)[^<]*(</span>)`);
  if (!re.test(html)) throw new Error(`목차에 ${id} 칸이 없다`);
  html = html.replace(re, `$1${idx + 1}$2`);
  out.push(`  ${String(idx + 1).padStart(2)}  ${title}`);
}

const left = [...html.matchAll(/<span class="pg" data-sec="(\w+)">—<\/span>/g)].map((m) => m[1]);
if (left.length) throw new Error(`목차에 남은 빈칸: ${left.join(', ')}`);

writeFileSync(HTML, html);
console.log(out.join('\n'));

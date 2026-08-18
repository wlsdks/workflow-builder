// Chrome CDP로 PDF를 뽑는다. CLI의 --print-to-pdf는 머리말/꼬리말 템플릿을
// 받지 못해서 쪽번호를 넣을 수 없다. 15쪽짜리 문서에는 쪽번호가 필요하다.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [src, out] = process.argv.slice(2);
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/cdp-print-${process.pid}`,
  'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function version() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch { await wait(200); }
  }
  throw new Error('Chrome이 뜨지 않았다');
}

const { webSocketDebuggerUrl } = await version();
const target = await (await fetch(
  `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`file://${src}`)}`,
  { method: 'PUT' },
)).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await wait(1200); // 폰트·레이아웃 안정화

const style = `font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;
  font-size:8px;color:#948F87;width:100%;padding:0 18mm;`;

const { data } = await send('Page.printToPDF', {
  printBackground: true,
  paperWidth: 8.27, paperHeight: 11.69,          // A4
  marginTop: 0.75, marginBottom: 0.79, marginLeft: 0.71, marginRight: 0.71,
  displayHeaderFooter: true,
  headerTemplate: `<div style="${style}text-align:right;">
      <span class="pageNumber" style="visibility:hidden"></span></div>`,
  footerTemplate: `<div style="${style}display:flex;justify-content:space-between;">
      <span>내 일이 뭔지 아무도 모른다 · 제품 기획서</span>
      <span class="pageNumber"></span></div>`,
});

writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`${out} — ${(Buffer.from(data, 'base64').length / 1024 / 1024).toFixed(2)}MB`);
ws.close();
chrome.kill();
process.exit(0);

// Run a self-test page in headless Chrome in real time (no --virtual-time-budget), for tests that
// need browser storage: IndexedDB never completes under virtual time. Polls the page until
// <html data-uitest="done …"> appears, then prints <pre id="uitest"> and that line.
//
//   node shared/run_live.mjs <page.html> [timeout seconds]
//
// Exit code 0 when the result line has fail=0. SHOT=file.png also saves a screenshot of the
// page as it is at the end. Needs Node 22+ (built-in WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const page = process.argv[2];
const limit = (Number(process.argv[3]) || 240) * 1000;
if (!page) { console.error('usage: node run_live.mjs <page.html> [timeout s]'); process.exit(2); }
const chrome = process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'bm-live-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  '--window-size=1440,900', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result && r.result.value;
}
function finish(code) {
  try { proc.kill(); } catch (_) { /* gone */ }
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* locked */ } process.exit(code); }, 500);
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page'); } catch (_) { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  await send('Page.navigate', { url: pathToFileURL(resolve(page)).href });
  const t0 = Date.now();
  let status = null;
  while (Date.now() - t0 < limit) {
    await sleep(500);
    status = await evaluate("document.documentElement && document.documentElement.getAttribute('data-uitest')").catch(() => null);
    if (status) break;
  }
  if (process.env.SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'));
  }
  const log = await evaluate("(document.getElementById('uitest') || {}).textContent || '(no log)'").catch(() => '(no log)');
  const errs = await evaluate("document.documentElement.getAttribute('data-errors')").catch(() => null);
  console.log(log);
  if (errs) console.log('UNCAUGHT: ' + errs);
  console.log(status || 'NOT FINISHED');
  finish(status && /fail=0/.test(status) ? 0 : 1);
} catch (e) {
  console.log('RUNNER ERROR: ' + e.message);
  finish(1);
}

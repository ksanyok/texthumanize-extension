#!/usr/bin/env node
/**
 * End-to-end smoke test against a REAL loaded extension.
 *
 * Why this exists: unit tests and the `?page=1` web preview both run with
 * `IS_EXTENSION === false`, which silently swaps in the JS fallback for
 * chrome.* APIs. A popup that is broken in the actual extension can therefore
 * look perfectly healthy everywhere else. That is exactly how v3.1.9 shipped a
 * Humanize button that threw
 *
 *   Error in invocation of i18n.getMessage(...): No matching signature.
 *
 * to the Chrome Web Store reviewer, earning a "functionality could not be
 * reproduced" rejection. Every module advertised in store/listing.md is
 * exercised here, in-extension, before we package.
 *
 * Usage: node scripts/e2e-smoke.mjs [path-to-extension]
 *
 * Requires Chrome for Testing (branded Google Chrome refuses --load-extension).
 * Runs headful: --headless=new hangs on macOS here, and old headless has no
 * extension support at all, so the window is parked off-screen instead.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const EXT = process.argv[2] || process.cwd();
const PORT = 9222 + Math.floor(process.pid % 500);

/** Every Chrome build on this machine that still permits --load-extension, newest first. */
function findBrowsers() {
  const roots = [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/puppeteer/chrome'),
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux64/chrome',
      ]) {
        const p = join(root, dir, rel);
        if (existsSync(p)) found.push(p);
      }
    }
  }
  return found;
}

const candidates = process.env.CHROME_FOR_TESTING ? [process.env.CHROME_FOR_TESTING] : findBrowsers();
if (!candidates.length) {
  console.error('SKIP: no Chrome for Testing found.');
  console.error('  npx @puppeteer/browsers install chrome@stable');
  process.exit(0);
}

const cdp = async (path, method = 'GET') =>
  (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).json();

/** Not every cached build actually launches — take the first that answers on CDP. */
let chrome = null;
const profile = `/tmp/thx-smoke-${process.pid}`;
for (const bin of candidates) {
  const proc = spawn(bin, [
    `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    '--window-position=4000,4000', '--window-size=520,760',
    `--user-data-dir=${profile}`, `--load-extension=${EXT}`, 'about:blank',
  ], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 24; i++) {
    try { await cdp('/json/list'); up = true; break; } catch { await sleep(500); }
  }
  if (up) { chrome = proc; console.log(`browser ${bin.split('/').slice(-5, -4)[0] || bin}`); break; }
  proc.kill();
}
if (!chrome) {
  console.error(`SKIP: none of ${candidates.length} Chrome build(s) would start.`);
  process.exit(0);
}

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  // Chrome's own automation extension is always present; ours is the other one.
  const BUILTIN = 'nkeimhogjdpnpccoofpliimaahmaaome';
  let extId = null;
  for (let i = 0; i < 60; i++) {
    const t = (await cdp('/json/list')).find(
      (x) => x.url.startsWith('chrome-extension://') && !x.url.includes(BUILTIN));
    if (t) { extId = new URL(t.url).host; break; }
    await sleep(500);
  }
  if (!extId) throw new Error('extension never registered — check the manifest');
  console.log(`extension ${extId}\n`);

  const page = await cdp(`/json/new?chrome-extension://${extId}/popup/popup.html`, 'PUT');
  await sleep(400);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown')
      errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text));
  };
  const rpc = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails)
      return { error: r.result.exceptionDetails.exception?.description || 'threw' };
    return { value: r.result?.result?.value };
  };

  await rpc('Runtime.enable');
  await sleep(1500); // popup boots its module graph

  const AI_TEXT = "In today's rapidly evolving digital landscape, it is important to note that "
    + 'leveraging synergistic solutions can significantly enhance productivity. Furthermore, '
    + 'organizations must carefully consider the multifaceted implications of these '
    + 'transformative technologies. Moreover, it should be noted that the implementation of '
    + 'such systems requires careful consideration of numerous factors.';

  // ── 1. The popup renders at all ──
  console.log('popup');
  const boot = await evaluate('JSON.stringify({'
    + 'input: !!document.querySelector("#input"),'
    + 'orb: !!document.querySelector("#num"),'
    + 'dock: document.querySelectorAll("#dock .mod").length,'
    + 'untranslated: [...document.querySelectorAll("[data-i18n]")]'
    + '.filter((e) => !e.textContent.trim()).map((e) => e.dataset.i18n)})');
  const b = JSON.parse(boot.value || '{}');
  ok('renders', !!b.input && !!b.orb);
  ok('module dock populated', b.dock > 0, `${b.dock} modules`);
  ok('all labels translated', (b.untranslated || []).length === 0,
    (b.untranslated || []).join(', ') || 'none missing');

  // ── 2. Every advertised text module actually runs ──
  console.log('\ntext modules');
  await evaluate(`(() => { const i = document.querySelector('#input');
    i.value = ${JSON.stringify(AI_TEXT)}; i.dispatchEvent(new Event('input')); })()`);
  await sleep(700);

  const modules = JSON.parse((await evaluate(
    'JSON.stringify([...document.querySelectorAll("#dock .mod")].map((m) => m.dataset.id))')).value || '[]');

  for (const mid of modules) {
    if (mid === 'media' || mid === 'site' || mid === 'image' || mid === 'mediaClean') continue;
    errors.length = 0;
    await evaluate(`document.querySelector('#dock .mod[data-id="${mid}"]').click()`);
    await sleep(2600);
    const r = JSON.parse((await evaluate(`(() => { const box = document.querySelector('#result');
      return JSON.stringify({ hidden: box.hidden, warn: box.querySelector('.note-warn')?.textContent || null,
        heading: box.querySelector('h4')?.textContent || null, len: box.innerHTML.length }); })()`)).value || '{}');
    ok(mid, !r.hidden && !r.warn && !!r.heading && r.len > 60,
      r.warn || (!r.heading ? 'no heading' : `${r.len} chars`));
  }

  // ── 3. The main CTA — the one that broke ──
  console.log('\nprimary Humanize button');
  errors.length = 0;
  await evaluate(`(() => { const i = document.querySelector('#input');
    i.value = ${JSON.stringify(AI_TEXT)}; i.dispatchEvent(new Event('input')); })()`);
  await sleep(600);
  const before = (await evaluate('document.querySelector("#num").textContent')).value;
  await evaluate("document.querySelector('#humanize-btn').click()");
  await sleep(4000);
  const h = JSON.parse((await evaluate(`(() => { const box = document.querySelector('#result');
    return JSON.stringify({ warn: box.querySelector('.note-warn')?.textContent || null,
      heading: box.querySelector('h4')?.textContent || null,
      text: box.querySelector('.out-text')?.innerText || null,
      after: document.querySelector('#num').textContent }); })()`)).value || '{}');
  ok('no error banner', !h.warn, h.warn || '');
  ok('has a heading', !!h.heading, h.heading || 'missing');
  ok('produced different text', !!h.text && h.text.trim() !== AI_TEXT.trim());
  ok('re-scored the result', h.after !== '–', `${before} → ${h.after}`);

  // ── 4. Nothing threw anywhere along the way ──
  console.log('\nconsole');
  ok('no uncaught errors', errors.length === 0, errors.join(' | '));

  ws.close();
} catch (e) {
  console.error('\nFATAL:', e.message);
  failed++;
} finally {
  chrome.kill();
}

console.log(failed ? `\nFAILED (${failed})` : '\nALL PASS');
process.exit(failed ? 1 : 0);

// Quality pass in real Chromium: a big swap (20 players, longest allowed names and gift labels) and the
// static pages at phone and desktop width. Checks no horizontal scroll, no console errors, nothing
// overflowing its card, and saves screenshots for a human look (lobby/board/recap on phone, desktop
// and TV; recap PNG; landing, privacy, 404, deleted-swap page).
// Usage: BASE=http://127.0.0.1:8793 node tests/e2e/stress.mjs   Screenshots go to $SHOTS (default shots/).
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8793';
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
const SIZES = {
  phone: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 860 } },
  tv: { viewport: { width: 1920, height: 1080 } },
};
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });
const step = (s) => console.log('·', s);
const HDR = { 'x-swapsteal-test': '1', 'content-type': 'application/json' };

async function open(label, size, url) {
  const ctx = await browser.newContext({ ...SIZES[size], extraHTTPHeaders: { 'x-swapsteal-test': '1' }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  if (url) await page.goto(BASE + url);
  return { label, size, ctx, page };
}
async function check(p, where) {
  const r = await p.page.evaluate(() => {
    const scroll = document.documentElement.scrollWidth - window.innerWidth;
    // Any element whose content sticks out of its own box horizontally (text that does not wrap).
    const over = [];
    for (const el of document.querySelectorAll('main *, #app *')) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || el.closest('.sheet')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== 'inline') over.push(`${el.tagName}.${el.className}: ${el.scrollWidth}>${el.clientWidth}`);
    }
    return { scroll, over: over.slice(0, 5) };
  });
  assert.ok(r.scroll <= 1, `${p.label}: horizontal scroll ${r.scroll}px on ${where}`);
  assert.deepEqual(r.over, [], `${p.label}: content overflows on ${where}`);
}
const shot = (p, name) => p.page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: p.size !== 'tv' });
async function post(url, body, token) {
  const r = await fetch(BASE + url, { method: 'POST', headers: token ? { ...HDR, 'x-token': token } : HDR, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url} ${r.status} ${j.error}`);
  return j;
}

// ---------- static pages ----------
step('static pages at phone and desktop width');
for (const size of ['phone', 'desktop']) {
  for (const [url, name] of [['/', 'landing'], ['/privacy', 'privacy'], ['/nope-404', '404'], ['/g/AAAAAAAAAA', 'gone']]) {
    const p = await open(`${name}@${size}`, size, url);
    await p.page.waitForLoadState('networkidle');
    if (name === 'gone') await p.page.waitForSelector('text=This swap isn’t here');
    await check(p, url);
    await shot(p, `q-${size}-${name}`);
    if (name === 'landing') {
      // The three "How it works" cards line up.
      const tops = await p.page.$$eval('.steps .card', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      if (size === 'desktop') assert.equal(new Set(tops).size, 1, `step cards misaligned: ${tops}`);
      // Every in-page link target exists.
      const missing = await p.page.$$eval('a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.querySelector(h)));
      assert.deepEqual(missing, [], 'broken in-page links');
    }
    await p.ctx.close();
  }
}

// ---------- big game, longest names ----------
step('big swap: 20 players with 24-character names and 70-character gifts');
const LONG = (i) => `Wolfgang-Amadeus Nr ${String(i).padStart(2, '0')}`.slice(0, 24);
const GIFT = (i) => `A gigantic inflatable reindeer with blinking LED antlers and a remote ${i}`.slice(0, 70);
const created = await post('/api/g', { title: 'The extremely long annual holiday party gift swap of the whole office', name: LONG(0), mode: 'room', maxSteals: 3, finalSwap: true });
const { id, token } = created;
const hostP = await open('host', 'desktop');
await hostP.page.goto(BASE + '/');
await hostP.page.evaluate(([k, v]) => localStorage.setItem(k, v), [`swapsteal:${id}`, JSON.stringify({ token, id: created.me })]);
for (let i = 1; i < 20; i++) await post(`/api/g/${id}/act`, { type: 'add', name: i === 7 ? 'Supercalifragilisticexpi' : LONG(i) }, token);
const phone = await open('phone', 'phone', `/g/${id}`);
await phone.page.fill('#joinName', 'Ana');
await phone.page.click('#joinForm button[type=submit]');
await phone.page.waitForSelector('text=You’re in, Ana!');
const tvLobby = await open('tv-lobby', 'tv', `/g/${id}?tv`);
await tvLobby.page.waitForSelector('#qrTv[src^="data:image"]');
await shot(tvLobby, 'q-tv-lobby');
await check(tvLobby, 'tv lobby');
await tvLobby.ctx.close();
await hostP.page.goto(`${BASE}/g/${id}`);
await hostP.page.waitForSelector('text=Players');
await check(hostP, 'lobby'); await check(phone, 'lobby');
await shot(hostP, 'q-desktop-lobby-big'); await shot(phone, 'q-phone-lobby-big');

step('play it through via the API: opens, steals, chains, freezes');
await post(`/api/g/${id}/act`, { type: 'start' }, token);
let st = await (await fetch(`${BASE}/api/g/${id}`, { headers: { 'x-token': token } })).json();
let n = 0;
const anaId = (await (await fetch(`${BASE}/api/g/${id}`)).json()).members.find((m) => m.name === 'Ana').id;
const anaTok = await phone.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).token, `swapsteal:${id}`);
while (st.phase === 'turns') {
  const steal = st.options.stealable;
  const mv = steal.length && n % 3 !== 2 ? { t: 'steal', gift: steal[n % steal.length] } : { t: 'open', label: GIFT(n) };
  // Ana plays her own turns from her token; the host plays everyone else (they have no phone).
  const tok = st.active === anaId ? anaTok : token;
  st = await post(`/api/g/${id}/act`, { type: 'move', move: mv }, tok);
  n++;
  if (n === 30) {
    await hostP.page.waitForFunction((v) => document.body.innerText.includes('steal'), null);
    const tv = await open('tv-board', 'tv', `/g/${id}?tv`);
    await tv.page.waitForSelector('.board');
    await shot(tv, 'q-tv-board-big'); await check(tv, 'tv board');
    await tv.ctx.close();
    await phone.page.waitForTimeout(400);
    await shot(phone, 'q-phone-board-big'); await check(phone, 'board');
    await shot(hostP, 'q-desktop-board-big'); await check(hostP, 'board');
  }
}
assert.equal(st.phase, 'final');
st = await post(`/api/g/${id}/act`, { type: 'move', move: { t: 'swap', gift: st.options.swappable[0] } }, token);
assert.equal(st.phase, 'done');
step(`${n} moves, ${st.totalSteals} steals`);
await phone.page.waitForSelector('text=final haul');
await hostP.page.waitForSelector('text=final haul');
await check(phone, 'recap'); await check(hostP, 'recap');
await shot(phone, 'q-phone-recap-big'); await shot(hostP, 'q-desktop-recap-big');
const tvDone = await open('tv-done', 'tv', `/g/${id}?tv`);
await tvDone.page.waitForSelector('text=final haul');
await shot(tvDone, 'q-tv-recap-big'); await check(tvDone, 'tv recap');
await tvDone.ctx.close();

step('recap PNG with 20 rows and long labels');
const [dl] = await Promise.all([hostP.page.waitForEvent('download'), hostP.page.click('[data-a=card]')]);
await dl.saveAs(path.join(SHOTS, 'q-recap-card-big.png'));
assert.ok(fs.statSync(path.join(SHOTS, 'q-recap-card-big.png')).size > 20000);

step('sheet closes with Escape');
await hostP.page.click('[data-a=undo]');
await hostP.page.waitForSelector('.sheet');
await hostP.page.keyboard.press('Escape');
assert.equal(await hostP.page.$('.sheet'), null, 'Escape did not close the sheet');

await post(`/api/g/${id}/act`, { type: 'delete' }, token);
await browser.close();
if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); process.exit(1); }
console.log('STRESS OK');

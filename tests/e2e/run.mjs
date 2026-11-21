// End-to-end test in real Chromium, one browser context per person (host on desktop, players on phones).
// Room game: create from the landing form, 4 phone joins + a duplicate name, host adds a player with no
// phone, rule change, start, live "your turn" without reload (WebSocket), open, steal, steal chain,
// no steal-back, freeze, host plays for the phone-less player, undo, final swap, recap on every phone,
// recap card PNG, TV board, link previews at each stage.
// Online game: 3 players register hidden gifts, contents never leak to other players before opening,
// open wrapped gifts, finish, "send your gift to" line. Then delete.
// Usage: BASE=http://127.0.0.1:8793 node tests/e2e/run.mjs   Screenshots go to shots/.
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
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 }, acceptDownloads: true };
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });
const step = (s) => console.log('·', s);

async function person(label, opts) {
  const ctx = await browser.newContext({ ...opts, extraHTTPHeaders: { 'x-swapsteal-test': '1' } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/status of 409/.test(m.text())) return; // duplicate name and stale moves are tested on purpose
    errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  return { label, ctx, page };
}
const shot = (p, name) => p.page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const api = async (id, token) => (await fetch(`${BASE}/api/g/${id}`, { headers: token ? { 'x-token': token } : {} })).json();
async function og(id) {
  const html = await (await fetch(`${BASE}/g/${id}`)).text();
  return html.match(/property="og:title" content="([^"]*)"/)[1];
}
const tokenOf = (p, id) => p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).token, `swapsteal:${id}`);
async function noHorizontalScroll(p, where) {
  const w = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(w <= 1, `${p.label} has horizontal scroll (${w}px) on ${where}`);
}

// ---------------- room game ----------------
const host = await person('Host', DESKTOP);
await host.page.goto(BASE + '/');
await shot(host, 'desktop-landing');
step('create from landing form');
await host.page.click('button[type=submit]');
assert.match(await host.page.textContent('#createErr'), /name/);
await host.page.fill('#title', 'Office swap');
await host.page.fill('#name', 'Hana');
await host.page.selectOption('#steals', '2');
await host.page.click('button[type=submit]');
await host.page.waitForURL(/\/g\/[A-Za-z0-9]+/);
const id = host.page.url().match(/\/g\/([A-Za-z0-9]+)/)[1];
await host.page.waitForSelector('text=Your swap is ready');
await host.page.waitForSelector('#qr[src^="data:image"]');
assert.equal(await og(id), 'Join “Office swap” · 1 player so far');

step('phones join');
const names = ['Ana', 'Bo', 'Cy', 'Di'];
const ppl = { Hana: host };
for (const n of names) {
  const p = await person(n, PHONE);
  await p.page.goto(`${BASE}/g/${id}`);
  await p.page.waitForSelector('#joinName');
  if (n === 'Ana') await shot(p, 'phone-join');
  await p.page.fill('#joinName', n);
  await p.page.click('#joinForm button[type=submit]');
  await p.page.waitForSelector(`text=You’re in, ${n}!`);
  ppl[n] = p;
}
// duplicate name
const dup = await person('Dup', PHONE);
await dup.page.goto(`${BASE}/g/${id}`);
await dup.page.fill('#joinName', 'ana');
await dup.page.click('#joinForm button[type=submit]');
await dup.page.waitForSelector('.toast:has-text("already joined")');
await dup.ctx.close();
// host sees joins live (no reload)
await host.page.waitForSelector('.people li:has-text("Di")');
step('host adds a player with no phone, changes rules');
await host.page.fill('#addName', 'Grandma');
await host.page.click('#addForm button[type=submit]');
await host.page.waitForSelector('.people li:has-text("Grandma")');
await host.page.selectOption('#setSteals', '2');
await host.page.uncheck('#setFinal');
await host.page.waitForSelector('.toast:has-text("Rules updated")');
await host.page.check('#setFinal');
await ppl.Ana.page.waitForSelector('text=final swap for player 1');
assert.equal(await og(id), 'Join “Office swap” · 6 players so far');
await shot(host, 'desktop-lobby');
await shot(ppl.Bo, 'phone-lobby');
await noHorizontalScroll(ppl.Bo, 'lobby');

step('start');
await host.page.click('[data-a=start]');
await host.page.click('.sheet [data-ok]');
await host.page.waitForSelector('#turn');
for (const n of names) await ppl[n].page.waitForSelector('#turn'); // live, no reload
const hostToken = await tokenOf(host, id);
let st = await api(id, hostToken);
assert.equal(st.order.length, 6);
const nameOf = (mid) => st.members.find((m) => m.id === mid).name;
const offline = st.members.find((m) => m.name === 'Grandma').id;

// Act as the active player through their own phone (or the host for Grandma).
async function actor() {
  st = await api(id, hostToken);
  const n = nameOf(st.active);
  if (st.active === offline) return { p: host, n };
  if (n === 'Hana') return { p: host, n };
  return { p: ppl[n], n };
}
async function waitVersion(v) {
  for (let i = 0; i < 50; i++) { st = await api(id, hostToken); if (st.version > v) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('state did not advance');
}
let giftNo = 0;
async function openGift() {
  const { p, n } = await actor();
  const v = st.version;
  await p.page.waitForSelector('#openLabel');
  const label = `Gift ${++giftNo}`;
  await p.page.fill('#openLabel', label);
  await p.page.click('#openForm button[type=submit]');
  await waitVersion(v);
  return { n, label };
}
async function stealFirst() {
  const { p, n } = await actor();
  const v = st.version;
  const target = st.gifts.find((g) => st.options.stealable.includes(g.id));
  await p.page.click(`.gift.can[data-id="${target.id}"]`);
  await p.page.waitForSelector('.sheet');
  await p.page.click('.sheet [data-ok]');
  await waitVersion(v);
  return { n, gift: target };
}

step('turn 1: open');
let a = await actor();
// The active player's phone says "Your turn" without reload; another phone says whose turn it is.
if (a.p !== host) await a.p.page.waitForSelector('.turn.mine:has-text("Your turn")');
const watcher = names.map((n) => ppl[n]).find((p) => p !== a.p);
await watcher.page.waitForSelector(`#turn:has-text("${a.n}")`);
if (a.p !== host) await shot(a.p, 'phone-your-turn');
await openGift();
step('turn 2: steal, chain, no steal-back');
const s1 = await stealFirst();
st = await api(id, hostToken);
assert.equal(st.chain, 1);
assert.ok(!st.options.stealable.includes(s1.gift.id), 'stolen gift cannot be stolen straight back');
// victim's phone shows the steal message live
const victim = await actor();
if (victim.p !== host) await victim.p.page.waitForSelector(`.turn.mine:has-text("stole your gift")`);
if (victim.p !== host) await shot(victim.p, 'phone-stolen');
await openGift();
assert.match(await og(id), /^Office swap · Turn 3 of 6 · 1 steal so far$/);
step('turn 3: steal the same gift again, it freezes at 2');
a = await actor();
const v3 = st.version;
await a.p.page.click(`.gift.can[data-id="${s1.gift.id}"]`);
await a.p.page.waitForSelector('.sheet:has-text("last steal")');
await a.p.page.click('.sheet [data-ok]');
await waitVersion(v3);
assert.equal(st.gifts.find((g) => g.id === s1.gift.id).frozen, true);
await host.page.waitForSelector('.gift.frozen');
await openGift();
step('undo by host');
let v = st.version;
const before = st.events.length;
await host.page.click('[data-a=undo]');
await host.page.click('.sheet [data-ok]');
await waitVersion(v);
assert.equal(st.events.length, before - 1);
await openGift();
step('remaining turns, host takes a turn for a phone player');
v = st.version;
a = await actor();
if (a.p !== host) {
  await host.page.click('[data-a=hostAct]');
  await host.page.waitForSelector('text=You’re playing for');
  await host.page.fill('#openLabel', `Gift ${++giftNo}`);
  await host.page.click('#openForm button[type=submit]');
  await waitVersion(v);
  st = await api(id, hostToken);
  assert.equal(st.events.at(-1).by, a.p === host ? st.events.at(-1).by : st.members.find((m) => m.name === a.n).id);
} else await openGift();
await shot(host, 'desktop-board');
await shot(ppl.Cy, 'phone-board');
await noHorizontalScroll(ppl.Cy, 'board');
const tv = await person('TV', { viewport: { width: 1920, height: 1080 } });
await tv.page.goto(`${BASE}/g/${id}?tv`);
await tv.page.waitForSelector('.board');
await tv.page.screenshot({ path: path.join(SHOTS, 'tv-board.png') });
while (st.phase === 'turns') await openGift();
step('final swap');
assert.equal(st.phase, 'final');
a = await actor();
v = st.version;
await a.p.page.waitForSelector('.gift.can');
await a.p.page.click('.gift.can');
await a.p.page.click('.sheet [data-ok]');
await waitVersion(v);
assert.equal(st.phase, 'done');
for (const n of names) await ppl[n].page.waitForSelector('text=final haul');
await tv.page.waitForSelector('text=final haul');
await shot(ppl.Ana, 'phone-recap');
await shot(host, 'desktop-recap');
await noHorizontalScroll(ppl.Ana, 'recap');
assert.match(await og(id), /^Office swap · Final haul$/);
const ogHtml = await (await fetch(`${BASE}/g/${id}`)).text();
assert.match(ogHtml, /stolen 2 times/);
step('recap card');
const [dl] = await Promise.all([host.page.waitForEvent('download'), host.page.click('[data-a=card]')]);
const cardPath = path.join(SHOTS, 'recap-card.png');
await dl.saveAs(cardPath);
assert.ok(fs.statSync(cardPath).size > 20000, 'recap card PNG too small');
assert.equal(st.recap.haul.length, 6);
assert.equal(new Set(st.recap.haul.map((h) => h.gift)).size, 6);
await tv.ctx.close();
// remove the room game so test runs do not count as real swaps
assert.equal((await fetch(`${BASE}/api/g/${id}/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': hostToken, 'x-swapsteal-test': '1' }, body: JSON.stringify({ type: 'delete' }) })).status, 200);

// ---------------- online game ----------------
step('online game: hidden gifts');
await host.page.goto(BASE + '/');
await host.page.fill('#title', 'Remote team swap');
await host.page.fill('#name', 'Hana');
await host.page.click('label:has(input[value=online]) span');
await host.page.click('button[type=submit]');
assert.match(await host.page.textContent('#createErr'), /gift/);
await host.page.fill('#gLabel', 'Secret Lamp');
await host.page.fill('#gHint', 'Bright idea');
await host.page.fill('#gLink', 'example.com/lamp');
await host.page.click('button[type=submit]');
await host.page.waitForURL(/\/g\//);
const id2 = host.page.url().match(/\/g\/([A-Za-z0-9]+)/)[1];
for (const [n, gift] of [['Ana', 'Secret Mug'], ['Bo', 'Secret Socks']]) {
  const p = ppl[n];
  await p.page.goto(`${BASE}/g/${id2}`);
  await p.page.fill('#joinName', n);
  await p.page.click('#joinForm button[type=submit]');
  await p.page.waitForSelector('.toast:has-text("Describe")');
  await p.page.fill('#joinLabel', gift);
  await p.page.click('#joinForm button[type=submit]');
  await p.page.waitForSelector(`text=You’re in, ${n}!`);
}
await host.page.waitForSelector('.people li:has-text("Bo")');
const hostToken2 = await tokenOf(host, id2);
await host.page.click('[data-a=start]');
await host.page.click('.sheet [data-ok]');
await host.page.waitForSelector('.board');
const anaToken2 = await tokenOf(ppl.Ana, id2);
const anaView = JSON.stringify(await api(id2, anaToken2));
assert.ok(!anaView.includes('Secret Lamp') && !anaView.includes('Secret Socks'), 'wrapped gift contents leaked to another player');
assert.ok(anaView.includes('Bright idea'), 'hint should be visible');
assert.ok(!JSON.stringify(await api(id2)).includes('Secret'), 'wrapped gift contents leaked to a spectator');
await shot(ppl.Ana, 'phone-online-board');
let st2 = await api(id2, hostToken2);
const who2 = (mid) => ({ Hana: host, Ana: ppl.Ana, Bo: ppl.Bo })[st2.members.find((m) => m.id === mid).name];
while (st2.phase === 'turns') {
  const p = who2(st2.active);
  const vv = st2.version;
  await p.page.waitForSelector('.gift.can.openable');
  await p.page.click('.gift.can.openable');
  await p.page.click('.sheet [data-ok]');
  for (let i = 0; i < 50 && (st2 = await api(id2, hostToken2)).version === vv; i++) await new Promise((r) => setTimeout(r, 100));
}
const p0 = who2(st2.active);
await p0.page.click('[data-a=keep]');
await p0.page.click('.sheet [data-ok]');
await ppl.Bo.page.waitForSelector('text=final haul');
await ppl.Bo.page.waitForSelector('text=Send your gift to');
await shot(ppl.Bo, 'phone-online-recap');
st2 = await api(id2, hostToken2);
assert.ok(st2.recap.haul.some((h) => h.gift === 'Secret Lamp' && h.link === 'https://example.com/lamp'));

step('delete');
await host.page.click('[data-a=delete]');
await host.page.click('.sheet [data-ok]');
await host.page.waitForURL(BASE + '/');
assert.equal((await fetch(`${BASE}/api/g/${id2}`)).status, 404);
await ppl.Bo.page.waitForSelector('text=This swap isn’t here');

for (const p of [host, ...names.map((n) => ppl[n])]) await p.ctx.close();
await browser.close();
if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); process.exit(1); }
console.log('E2E OK');

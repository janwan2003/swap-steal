// Swapsteal Worker: serves the static site and the API. Each game is one SQLite-backed Durable
// Object holding the game as a single JSON value; live state is rebuilt by replaying the move list
// (public/engine.js). Phones get updates over hibernating WebSockets, so a 40-minute party costs a
// few dozen requests instead of thousands of polls. A small Limiter object counts creates and joins per IP.
import { DurableObject } from 'cloudflare:workers';
import {
  replay, check, stealable, openable, swappable, recap, shuffle, clean, cleanLink, describeEvent,
  players, LIMITS, MAX_PLAYERS, STEAL_LIMITS,
} from '../public/engine.js';

const KEEP_DAYS = 60;
const IP_LIMITS = { create: 20, join: 80 }; // per IP per hour
const ACT_PER_MIN = 240; // per game

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss: ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function withHeaders(res) {
  if (res.status === 101) return res;
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);
const ID_RE = /^[A-Za-z0-9]{8,16}$/;
const stub = (env, id) => env.GAMES.get(env.GAMES.idFromName(id));

function rid(len = 10) {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
function token() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
const cryptoRand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

async function limited(env, request, bucket) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${bucket}:${(await sha('ss:' + ip)).slice(0, 24)}`;
  return !(await env.LIMITER.get(env.LIMITER.idFromName(key)).hit(IP_LIMITS[bucket], 3600_000));
}

// Aggregate daily counts only (no ids, names or IPs), read with GET /api/stats.
// Requests from the e2e test send x-swapsteal-test: 1 and are not counted.
async function bump(env, key, n = 1) {
  if (env.isTest) return;
  try { await env.STATS.get(env.STATS.idFromName('all')).bump(key, n); } catch (e) { console.error('stats', e); }
}

async function body(request) {
  if ((request.headers.get('content-length') | 0) > 8000) return null;
  try { return await request.json(); } catch { return null; }
}

function readGift(b) {
  const label = clean(b && b.label, LIMITS.label);
  if (!label) return null;
  return { label, hint: clean(b.hint, LIMITS.hint), link: cleanLink(b.link) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/g' && request.method === 'POST') {
      if (await limited(env, request, 'create')) return withHeaders(fail(429, 'Too many new games from this network. Try again in an hour.'));
      const id = rid(10);
      const fwd = new Request(request, { headers: new Headers(request.headers) });
      fwd.headers.set('x-new-id', id);
      return withHeaders(await stub(env, id).fetch(fwd));
    }
    let m = p.match(/^\/api\/g\/([^/]+)(\/[a-z]+)?$/);
    if (m) {
      if (!ID_RE.test(m[1])) return withHeaders(fail(404, 'Game not found.'));
      if (m[2] === '/join' && (await limited(env, request, 'join'))) return withHeaders(fail(429, 'Too many joins from this network. Try again later.'));
      return withHeaders(await stub(env, m[1]).fetch(request));
    }
    if (p === '/api/stats' && request.method === 'GET') return withHeaders(json(await env.STATS.get(env.STATS.idFromName('all')).read()));
    if (p.startsWith('/api/')) return withHeaders(fail(404, 'Not found.'));
    m = p.match(/^\/g\/([^/]+)\/?$/);
    if (m) {
      let info = null;
      if (ID_RE.test(m[1])) { try { info = await stub(env, m[1]).describe(); } catch (e) { console.error(e); } }
      return withHeaders(await gamePage(env, request, info));
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function gamePage(env, request, info) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/g', url.origin));
  let html = await page.text();
  info = info || { title: 'Join this gift swap · Swapsteal', desc: 'White elephant on everyone’s phone: open a gift or steal one. No sign-up, no app.' };
  const meta = `<title>${esc(info.title)}</title>
<meta name="description" content="${esc(info.desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Swapsteal">
<meta property="og:title" content="${esc(info.title)}">
<meta property="og:description" content="${esc(info.desc)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function describeGame(g) {
  if (!g) return null;
  const n = players(g).length;
  if (g.status === 'lobby') {
    return { title: `Join “${g.title}” · ${plural(n, 'player', 'players')} so far`, desc: 'A white elephant gift swap on everyone’s phone. Tap to join with a nickname. No sign-up, no app.' };
  }
  const s = replay(g);
  if (s.phase === 'done') {
    const r = recap(g, s);
    const hl = r.mostStolen ? `“${r.mostStolen.gift}” was stolen ${plural(r.mostStolen.steals, 'time', 'times')}.` : `${plural(n, 'gift', 'gifts')} opened.`;
    return { title: `${g.title} · Final haul`, desc: `${hl} ${plural(r.totalSteals, 'steal', 'steals')} in total. See who ended up with what, then run your own swap.` };
  }
  const last = s.events.at(-1);
  const turn = s.phase === 'final' ? 'Final swap' : `Turn ${s.turn + 1} of ${s.turns}`;
  return {
    title: `${g.title} · ${turn} · ${plural(s.totalSteals, 'steal', 'steals')} so far`,
    desc: `${last ? describeEvent(g, last, s) + '. ' : ''}Watch the gift board live. No sign-up.`,
  };
}

// The state one viewer sees. Wrapped gifts hide their contents and giver.
function view(g, mid, online) {
  const me = g.members.find((m) => m.id === mid) || null;
  const s = replay(g);
  const gifts = Object.values(s.gifts).map((x) => ({
    id: x.id,
    opened: x.opened,
    label: x.opened ? x.label : null,
    hint: x.hint || '',
    link: x.opened ? x.link : '',
    giver: x.opened ? x.giver : null,
    mine: !!me && x.giver === me.id,
    holder: x.holder,
    steals: x.steals,
    frozen: x.frozen,
    owners: x.owners,
  }));
  const out = {
    id: g.id,
    title: g.title,
    mode: g.mode,
    maxSteals: g.maxSteals,
    finalSwap: g.finalSwap,
    status: g.status,
    members: g.members.map((m) => ({ id: m.id, name: m.name, host: !!m.host, plays: m.plays, offline: !m.tokenHash, hasGift: g.gifts.some((x) => x.giver === m.id) })),
    order: g.order,
    online: online || [],
    me: me ? { id: me.id, name: me.name, host: !!me.host, plays: me.plays } : null,
    myGift: me ? g.gifts.find((x) => x.giver === me.id) || null : null,
    phase: s.phase,
    turn: s.turn,
    turns: s.turns,
    active: s.active,
    stolenThisTurn: s.stolenThisTurn,
    chain: s.chain,
    totalSteals: s.totalSteals,
    gifts,
    events: s.events,
    options: s.active ? { stealable: stealable(g, s), openable: openable(g, s), swappable: swappable(g, s) } : null,
    canUndo: g.moves.length > 0,
    version: g.version,
  };
  if (s.phase === 'done') out.recap = recap(g, s);
  return out;
}

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = undefined;
    this.acts = { start: 0, n: 0 };
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async load() {
    if (this.game === undefined) this.game = (await this.ctx.storage.get('game')) || null;
    return this.game;
  }

  async save() {
    this.game.version += 1;
    await this.ctx.storage.put('game', this.game);
    this.broadcast();
  }

  connected() {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.mid) ids.add(a.mid); }
    return [...ids];
  }

  broadcast() {
    const g = this.game;
    if (!g) return;
    const online = this.connected();
    const cache = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const mid = (ws.deserializeAttachment() || {}).mid || '';
      if (!cache.has(mid)) cache.set(mid, JSON.stringify({ type: 'state', state: view(g, mid, online) }));
      try { ws.send(cache.get(mid)); } catch { /* closed */ }
    }
  }

  async describe() {
    return describeGame(await this.load());
  }

  async member(request) {
    const t = request.headers.get('x-token') || new URL(request.url).searchParams.get('t');
    if (!t || t.length > 100 || !this.game) return null;
    const h = await sha(t);
    return this.game.members.find((m) => m.tokenHash === h) || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.statsEnv = { STATS: this.env.STATS, isTest: request.headers.get('x-swapsteal-test') === '1' };
    const newId = request.headers.get('x-new-id');
    if (newId) return this.create(request, newId);
    const g = await this.load();
    if (!g) return fail(404, 'This swap does not exist or has been deleted.');
    const action = (url.pathname.match(/\/(join|act|ws)$/) || [])[1];
    if (action === 'ws') {
      if (request.headers.get('upgrade') !== 'websocket') return fail(426, 'Expected a WebSocket.');
      if (this.ctx.getWebSockets().length >= 300) return fail(429, 'Too many viewers.');
      const me = await this.member(request);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ mid: me ? me.id : '' });
      this.broadcast(); // presence changed; also sends this socket its first state
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === 'GET' && !action) {
      const me = await this.member(request);
      return json(view(g, me && me.id, this.connected()));
    }
    if (request.method !== 'POST') return fail(405, 'Method not allowed.');
    const b = await body(request);
    if (!b) return fail(400, 'Bad request.');
    if (action === 'join') return this.join(request, b);
    if (action === 'act') return this.act(request, b);
    return fail(404, 'Not found.');
  }

  async create(request, id) {
    if (await this.load()) return fail(409, 'Try again.');
    const b = await body(request);
    if (!b) return fail(400, 'Bad request.');
    const title = clean(b.title, LIMITS.title);
    const name = clean(b.name, LIMITS.name);
    if (!title) return fail(400, 'Give your swap a name.');
    if (!name) return fail(400, 'Type your name.');
    const mode = b.mode === 'online' ? 'online' : 'room';
    const maxSteals = STEAL_LIMITS.includes(Number(b.maxSteals)) ? Number(b.maxSteals) : 3;
    const plays = b.plays !== false;
    const t = token();
    const host = { id: rid(6), name, host: true, plays, tokenHash: await sha(t), joinedAt: Date.now() };
    const gifts = [];
    if (mode === 'online' && plays) {
      const gift = readGift(b.gift);
      if (!gift) return fail(400, 'Describe the gift you are bringing.');
      gifts.push({ id: rid(6), giver: host.id, ...gift });
    }
    this.game = { v: 1, id, title, mode, maxSteals, finalSwap: b.finalSwap !== false, status: 'lobby', createdAt: Date.now(), members: [host], gifts, order: [], moves: [], version: 0 };
    await this.ctx.storage.setAlarm(Date.now() + KEEP_DAYS * 86400_000);
    await this.save();
    await bump(this.statsEnv, 'created');
    return json({ id, token: t, me: host.id }, 201);
  }

  async join(request, b) {
    const g = this.game;
    const existing = await this.member(request);
    if (existing) return json({ me: existing.id, state: view(g, existing.id, this.connected()) });
    if (g.status !== 'lobby') return fail(409, 'This swap has already started. You can still watch the board.');
    const name = clean(b.name, LIMITS.name);
    if (!name) return fail(400, 'Type your name.');
    if (g.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return fail(409, `Someone called ${name} has already joined. Add an initial?`);
    if (players(g).length >= MAX_PLAYERS) return fail(409, `This swap is full (${MAX_PLAYERS} players).`);
    let gift = null;
    if (g.mode === 'online') {
      gift = readGift(b.gift);
      if (!gift) return fail(400, 'Describe the gift you are bringing.');
    }
    const t = token();
    const m = { id: rid(6), name, host: false, plays: true, tokenHash: await sha(t), joinedAt: Date.now() };
    g.members.push(m);
    if (gift) g.gifts.push({ id: rid(6), giver: m.id, ...gift });
    await this.save();
    await bump(this.statsEnv, 'joined');
    return json({ token: t, me: m.id, state: view(g, m.id, this.connected()) }, 201);
  }

  async act(request, b) {
    const now = Date.now();
    if (now - this.acts.start > 60_000) this.acts = { start: now, n: 0 };
    if (++this.acts.n > ACT_PER_MIN) return fail(429, 'Slow down a little.');
    const g = this.game;
    const me = await this.member(request);
    if (!me) return fail(403, 'Join the swap first.');
    const host = !!me.host;
    const ok = async () => { await this.save(); return json(view(g, me.id, this.connected())); };
    const lobbyOnly = () => (g.status !== 'lobby' ? fail(409, 'The swap has already started.') : null);
    switch (b.type) {
      case 'move': {
        const s = replay(g);
        if (!s.active) return fail(409, s.phase === 'done' ? 'The swap is over.' : 'The swap has not started.');
        if (s.active !== me.id && !host) return fail(403, 'It is not your turn.');
        if (b.turnVersion != null && b.turnVersion !== g.version) return fail(409, 'The board changed. Look again and choose.');
        const mv = { t: String(b.move && b.move.t) };
        if (mv.t === 'open' || mv.t === 'steal' || mv.t === 'swap') mv.gift = clean(b.move.gift, 20);
        if (mv.t === 'open' && g.mode === 'room') { mv.label = clean(b.move.label, LIMITS.label); mv.gift = rid(6); }
        const err = check(g, s, mv);
        if (err) return fail(409, err);
        mv.by = s.active;
        if (me.id !== s.active) mv.actor = me.id;
        mv.at = now;
        g.moves.push(mv);
        if (replay(g).phase === 'done' && !g.finishedAt) { g.finishedAt = now; await bump(this.statsEnv, 'finished'); }
        return ok();
      }
      case 'undo': {
        if (!host) return fail(403, 'Only the host can undo.');
        if (!g.moves.length) return fail(409, 'Nothing to undo.');
        g.moves.pop();
        return ok();
      }
      case 'start': {
        if (!host) return fail(403, 'Only the host can start.');
        const l = lobbyOnly(); if (l) return l;
        const ps = players(g);
        if (ps.length < 2) return fail(409, 'You need at least 2 players.');
        if (g.mode === 'online') {
          const missing = ps.filter((p) => !g.gifts.some((x) => x.giver === p.id));
          if (missing.length) return fail(409, `Waiting for a gift from ${missing.map((p) => p.name).join(', ')}.`);
        }
        g.order = shuffle(ps.map((p) => p.id), cryptoRand);
        g.status = 'started';
        g.startedAt = now;
        await bump(this.statsEnv, 'started');
        await bump(this.statsEnv, 'players', ps.length);
        return ok();
      }
      case 'settings': {
        if (!host) return fail(403, 'Only the host can change the rules.');
        const l = lobbyOnly(); if (l) return l;
        if (b.maxSteals != null && STEAL_LIMITS.includes(Number(b.maxSteals))) g.maxSteals = Number(b.maxSteals);
        if (b.finalSwap != null) g.finalSwap = !!b.finalSwap;
        if (b.title != null && clean(b.title, LIMITS.title)) g.title = clean(b.title, LIMITS.title);
        return ok();
      }
      case 'add': {
        if (!host) return fail(403, 'Only the host can add players.');
        const l = lobbyOnly(); if (l) return l;
        const name = clean(b.name, LIMITS.name);
        if (!name) return fail(400, 'Type a name.');
        if (g.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return fail(409, `${name} is already in the swap.`);
        if (players(g).length >= MAX_PLAYERS) return fail(409, 'This swap is full.');
        let gift = null;
        if (g.mode === 'online') { gift = readGift(b.gift); if (!gift) return fail(400, `Describe ${name}’s gift.`); }
        const m = { id: rid(6), name, host: false, plays: true, tokenHash: null, joinedAt: now };
        g.members.push(m);
        if (gift) g.gifts.push({ id: rid(6), giver: m.id, ...gift });
        return ok();
      }
      case 'remove': {
        const l = lobbyOnly(); if (l) return l;
        const target = g.members.find((m) => m.id === b.member);
        if (!target) return fail(404, 'Player not found.');
        if (!host && target.id !== me.id) return fail(403, 'Only the host can remove players.');
        if (target.host) return fail(409, 'The host cannot leave. Create a new swap instead.');
        g.members = g.members.filter((m) => m.id !== target.id);
        g.gifts = g.gifts.filter((x) => x.giver !== target.id);
        return ok();
      }
      case 'gift': {
        const l = lobbyOnly(); if (l) return l;
        if (g.mode !== 'online' || !me.plays) return fail(409, 'No gift to edit in this swap.');
        const gift = readGift(b.gift);
        if (!gift) return fail(400, 'Describe the gift you are bringing.');
        const cur = g.gifts.find((x) => x.giver === me.id);
        if (cur) Object.assign(cur, gift); else g.gifts.push({ id: rid(6), giver: me.id, ...gift });
        return ok();
      }
      case 'delete': {
        if (!host) return fail(403, 'Only the host can delete the swap.');
        for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify({ type: 'deleted' })); ws.close(1000, 'deleted'); } catch { /* */ } }
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.game = null;
        return json({ ok: true });
      }
      default:
        return fail(400, 'Unknown action.');
    }
  }

  async webSocketMessage(ws, msg) {
    if (msg === 'state' && this.game !== null) {
      await this.load();
      const mid = (ws.deserializeAttachment() || {}).mid || '';
      ws.send(JSON.stringify({ type: 'state', state: view(this.game, mid, this.connected()) }));
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* */ }
    await this.load();
    this.broadcast();
  }

  async webSocketError() {
    await this.load();
    this.broadcast();
  }

  // Games are deleted KEEP_DAYS after creation.
  async alarm() {
    await this.ctx.storage.deleteAll();
    this.game = null;
  }
}

export class Limiter extends DurableObject {
  async hit(limit, windowMs) {
    const now = Date.now();
    let w = (await this.ctx.storage.get('w')) || { start: now, n: 0 };
    if (now - w.start > windowMs) w = { start: now, n: 0 };
    w.n += 1;
    await this.ctx.storage.put('w', w);
    await this.ctx.storage.setAlarm(w.start + windowMs + 1000);
    return w.n <= limit;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export class Stats extends DurableObject {
  async bump(key, n = 1) {
    const day = new Date().toISOString().slice(0, 10);
    const k = `d:${day}`;
    const d = (await this.ctx.storage.get(k)) || {};
    d[key] = (d[key] || 0) + n;
    await this.ctx.storage.put(k, d);
  }
  async read() {
    const all = await this.ctx.storage.list({ prefix: 'd:' });
    const days = {};
    const total = {};
    for (const [k, v] of all) {
      days[k.slice(2)] = v;
      for (const [x, n] of Object.entries(v)) total[x] = (total[x] || 0) + n;
    }
    return { total, days };
  }
}

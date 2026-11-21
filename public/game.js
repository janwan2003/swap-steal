// Swapsteal game page: lobby, live turns, final swap and recap. State arrives over a WebSocket
// (with polling as a fallback) and the page re-renders from it; typed input survives re-renders.
import { $, esc, api, getMe, setMe, toast, color, initial } from './common.js';
import { drawCard } from './card.js';

const id = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const TV = params.has('tv');
if (TV) document.body.classList.add('tv');
const app = $('#app');
let me = getMe(id);
let S = null; // latest state
let busy = false;
const ui = { hostAct: null, lastActive: null, flash: null, seenEvents: null };
const shareUrl = `${location.origin}/g/${id}`;

// ---------- connection ----------
let ws = null, wsTries = 0, pollTimer = null, pingTimer = null;
function setState(st) {
  if (!st) return;
  if (S && st.version < S.version) return;
  const prev = S;
  S = st;
  if (prev && st.me == null && me) { /* token no longer valid */ }
  react(prev, st);
  render();
}
async function poll() {
  if (dead) return;
  try { setState(await api(`/api/g/${id}`, { token: me && me.token })); } catch (e) { if (e.status === 404) gone(); }
}
function connect() {
  if (dead) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/g/${id}/ws${me ? `?t=${encodeURIComponent(me.token)}` : ''}`);
  } catch { schedulePoll(); return; }
  ws.onopen = () => { wsTries = 0; clearInterval(pollTimer); pollTimer = null; clearInterval(pingTimer); pingTimer = setInterval(() => { try { ws.send('ping'); } catch { /* */ } }, 25000); };
  ws.onmessage = (ev) => {
    if (ev.data === 'pong') return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'state') setState(m.state);
    if (m.type === 'deleted') gone();
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    ws = null;
    if (dead) return;
    schedulePoll();
    const wait = Math.min(30000, 1000 * 2 ** wsTries++);
    setTimeout(() => { if (!ws && document.visibilityState === 'visible') connect(); }, wait);
  };
}
function schedulePoll() { if (!pollTimer) pollTimer = setInterval(poll, 8000); }
function reconnect() { try { ws && ws.close(); } catch { /* */ } ws = null; connect(); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!ws || ws.readyState > 1) { wsTries = 0; connect(); poll(); }
  else if (ws.readyState === 1) ws.send('state');
});
let deleting = false, dead = false;
function gone() {
  if (deleting) return;
  dead = true;
  S = null;
  app.innerHTML = `<div class="card narrow center"><h2>This swap isn’t here</h2><p class="muted">It was deleted by the host, expired after 60 days, or the link is wrong.</p><a class="btn" href="/">Start a new swap</a></div>`;
  try { ws && ws.close(); } catch { /* */ }
  clearInterval(pollTimer);
}

async function act(body, okMsg) {
  if (busy) return null;
  busy = true;
  try {
    const st = await api(`/api/g/${id}/act`, { method: 'POST', body, token: me.token });
    ui.hostAct = null;
    if (body.type !== 'delete') setState(st);
    if (okMsg) toast(okMsg);
    return st;
  } catch (e) {
    toast(e.message);
    if (e.status === 409) poll();
    return null;
  } finally { busy = false; }
}

// ---------- helpers ----------
const nameOf = (mid) => (S.members.find((m) => m.id === mid) || {}).name || '?';
const giftOf = (gid) => S.gifts.find((g) => g.id === gid);
const isMe = (mid) => !!(S.me && S.me.id === mid);
const heldBy = (mid) => S.gifts.find((g) => g.opened && g.holder === mid);
const players = () => S.members.filter((m) => m.plays);
const av = (m) => `<span class="avatar" style="background:${color(m.id)}">${esc(initial(m.name))}</span>`;
const stealText = (g) => {
  if (g.frozen) return `<span class="tag">🔒 Frozen</span>`;
  if (S.maxSteals) return `<span class="dots" title="Stolen ${g.steals} of ${S.maxSteals}">${Array.from({ length: S.maxSteals }, (_, i) => `<i class="dot${i < g.steals ? ' on' : ''}"></i>`).join('')}<span>${g.steals ? `stolen ${g.steals}×` : 'not stolen yet'}</span></span>`;
  return `<span class="dots">${g.steals ? `stolen ${g.steals}×` : 'not stolen yet'}</span>`;
};
function rulesText() {
  const r = [S.maxSteals ? `a gift freezes after ${S.maxSteals} steal${S.maxSteals > 1 ? 's' : ''}` : 'no steal limit', 'no stealing straight back'];
  if (S.finalSwap) r.push('final swap for player 1');
  return r.join(' · ');
}
function eventHtml(e) {
  const g = giftOf(e.gift);
  const gl = `<b class="g">${esc(g && g.label ? g.label : 'a gift')}</b>`;
  if (e.t === 'open') return `<b>${esc(nameOf(e.by))}</b> opened ${gl}`;
  if (e.t === 'steal') return `<b>${esc(nameOf(e.by))}</b> stole ${gl} from <b>${esc(nameOf(e.from))}</b>${e.frozen ? ' 🔒' : ''}`;
  if (e.t === 'swap') return `<b>${esc(nameOf(e.by))}</b> swapped for ${gl} with <b>${esc(nameOf(e.from))}</b>`;
  if (e.t === 'keep') return `<b>${esc(nameOf(e.by))}</b> kept ${gl}`;
  return '';
}

// Buzz when it becomes my turn; flash the gift that just moved.
function react(prev, st) {
  const last = st.events && st.events.at(-1);
  if (prev && last && prev.events.length < st.events.length) ui.flash = last.gift;
  else ui.flash = null;
  const mineNow = st.me && st.active === st.me.id;
  if (mineNow && ui.lastActive !== st.me.id && prev) {
    try { navigator.vibrate && navigator.vibrate([180, 90, 180]); } catch { /* */ }
  }
  ui.lastActive = st.active;
  document.title = (mineNow ? '🎁 Your turn · ' : '') + `${st.title} · Swapsteal`;
}

// Keep typed text and focus across re-renders.
function preserve(fn) {
  const vals = {};
  app.querySelectorAll('input[id], select[id]').forEach((el) => { vals[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  const a = document.activeElement;
  const focus = a && a.id && app.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  fn();
  for (const [k, v] of Object.entries(vals)) {
    const el = document.getElementById(k);
    if (!el || el.dataset.fresh) continue;
    if (el.type === 'checkbox') { if (!el.dataset.server) el.checked = v; } else if (!el.dataset.server) el.value = v;
  }
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus(); try { el.setSelectionRange(focus.s, focus.e); } catch { /* */ } } }
}

function render() {
  if (!S) return;
  preserve(() => {
    if (S.status === 'lobby') app.innerHTML = lobby();
    else if (S.phase === 'done') app.innerHTML = done();
    else app.innerHTML = play();
  });
  if (S.status === 'lobby') { drawQr(); if (TV) drawQr('#qrTv', 8); }
  else if (TV && S.phase !== 'done') drawQr('#qrTv', 5);
}

function drawQr(sel = '#qr', cell = 4) {
  const img = $(sel);
  if (!img || !window.qrcode) return;
  const q = window.qrcode(0, 'M');
  q.addData(shareUrl);
  q.make();
  img.src = q.createDataURL(cell, 2);
}

// ---------- lobby ----------
function shareCard() {
  return `<section class="card hide-tv">
    <h2>${S.me && S.me.host && params.has('new') ? 'Your swap is ready. Invite everyone' : 'Invite people'}</h2>
    <div class="share"><div>
      <p class="muted" style="margin:0">Send this link to the group chat, or let people scan the code.</p>
      <div class="linkbox" id="link">${esc(shareUrl)}</div>
      <div class="row"><button class="btn" data-a="share">Share link</button><button class="btn ghost" data-a="copy">Copy</button><a class="btn ghost" href="/g/${id}?tv" target="_blank" rel="noopener">Show on TV</a></div>
    </div><img id="qr" class="qr" alt="QR code for the swap link" width="132" height="132"></div>
  </section>`;
}

function giftInputs(prefix, g = null) {
  return `<label for="${prefix}Label">${prefix === 'add' ? 'Their gift' : 'Your gift'} <span class="opt">(hidden until opened)</span></label>
    <input id="${prefix}Label" type="text" maxlength="70" placeholder="Heated blanket"${g ? ` value="${esc(g.label)}" data-server="1"` : ''}>
    <label for="${prefix}Hint">Hint on the wrapping <span class="opt">(optional)</span></label>
    <input id="${prefix}Hint" type="text" maxlength="60" placeholder="Soft and big"${g ? ` value="${esc(g.hint)}" data-server="1"` : ''}>
    <label for="${prefix}Link">Link <span class="opt">(optional, shown after opening)</span></label>
    <input id="${prefix}Link" type="url" maxlength="300" placeholder="https://…"${g ? ` value="${esc(g.link)}" data-server="1"` : ''}>`;
}

function lobby() {
  const ps = players();
  const host = S.members.find((m) => m.host);
  const amHost = S.me && S.me.host;
  const joined = !!S.me;
  const missing = S.mode === 'online' ? ps.filter((p) => !p.hasGift) : [];
  const canStart = ps.length >= 2 && !missing.length;
  const people = `<section class="card"><h2>Players <span class="badge">${ps.length}</span></h2>
    <ul class="people">${ps.map((m) => `<li>${av(m)}<span class="grow"><b>${esc(m.name)}</b>${m.host ? ' <span class="badge">host</span>' : ''}${isMe(m.id) ? ' <span class="muted">(you)</span>' : ''}${m.offline ? ' <span class="muted small">· no phone</span>' : ''}${S.mode === 'online' ? (m.hasGift ? ' <span class="muted small">· gift ready 🎁</span>' : ' <span class="badge red">no gift yet</span>') : ''}</span>
      ${S.online.includes(m.id) ? '<span class="live" title="Online now"></span>' : ''}
      ${(amHost && !m.host) || (isMe(m.id) && !m.host) ? `<button class="btn ghost small hide-tv" data-a="remove" data-id="${m.id}">${isMe(m.id) ? 'Leave' : 'Remove'}</button>` : ''}</li>`).join('') || '<li class="muted">Nobody yet.</li>'}</ul>
    ${host && !host.plays ? `<p class="muted small" style="margin:10px 0 0">${esc(host.name)} is hosting without playing.</p>` : ''}
  </section>`;

  let main = '';
  if (TV) {
    main = `<section class="card center"><h2 style="font-size:2.4vw">Scan to join</h2><img id="qrTv" class="qr" alt="QR code" style="width:22vw;height:22vw"><p class="muted" style="font-size:1.4vw">${esc(shareUrl.replace(/^https?:\/\//, ''))}</p><p style="font-size:1.4vw">Rules: ${rulesText()}</p></section>`;
  } else if (!joined) {
    main = `<form class="card" id="joinForm" autocomplete="off"><h2>Join ${esc(S.title)}</h2>
      <p class="muted">${esc(host ? host.name : 'Someone')} invited you to a white elephant gift swap. Type the name everyone knows you by.</p>
      <label for="joinName">Your name</label><input id="joinName" type="text" maxlength="24" placeholder="Your name" autocomplete="nickname">
      ${S.mode === 'online' ? giftInputs('join') : ''}
      <button class="btn block big" type="submit" style="margin-top:16px">Join the swap</button>
      <p class="muted small" style="margin:10px 0 0">No sign-up. Your phone remembers you for this swap.</p></form>`;
  } else {
    main = `<section class="card"><h2>${amHost ? 'Waiting for players' : `You’re in, ${esc(S.me.name)}!`}</h2>
      <p class="muted">${amHost ? 'When everyone has joined, tap Start. Swapsteal draws a random order and each phone shows whose turn it is.' : `Waiting for ${esc(host ? host.name : 'the host')} to start the swap. Keep this page open, or come back with the same link.`}</p>
      ${S.mode === 'room' && S.me.plays ? '<p class="muted small" style="margin:0">Bring your wrapped gift to the pile.</p>' : ''}
      ${amHost ? `<button class="btn block big" data-a="start" ${canStart ? '' : 'disabled'}>Draw the order &amp; start</button>
        <p class="muted small" style="margin:8px 0 0">${ps.length < 2 ? 'You need at least 2 players.' : missing.length ? `Waiting for a gift from ${esc(missing.map((p) => p.name).join(', '))}.` : `${ps.length} players. Late arrivals can’t join after you start.`}</p>` : ''}
    </section>`;
    if (S.mode === 'online' && S.me.plays) {
      main += `<form class="card" id="giftForm" autocomplete="off"><h2>Your gift</h2>
        <p class="muted small">Nobody sees this until the gift is opened. The hint is shown on the wrapping.</p>
        ${giftInputs('my', S.myGift)}<button class="btn ghost block" type="submit" style="margin-top:14px">${S.myGift ? 'Save changes' : 'Save my gift'}</button></form>`;
    }
    if (amHost) {
      main += `<form class="card" id="addForm" autocomplete="off"><h2>Add someone without a phone</h2>
        <p class="muted small">You’ll take their turns for them on your phone.</p>
        <label for="addName">Name</label><input id="addName" type="text" maxlength="24" placeholder="Grandma">
        ${S.mode === 'online' ? giftInputs('add') : ''}
        <button class="btn ghost block" type="submit" style="margin-top:14px">Add player</button></form>
        <section class="card"><h2>Rules</h2>
        <label for="setSteals">A gift freezes after</label>
        <select id="setSteals" data-server="1">${[1, 2, 3, 4, 5, 0].map((n) => `<option value="${n}"${n === S.maxSteals ? ' selected' : ''}>${n ? `${n} steal${n > 1 ? 's' : ''}` : 'Never (no limit)'}</option>`).join('')}</select>
        <label class="check"><input id="setFinal" type="checkbox" data-server="1"${S.finalSwap ? ' checked' : ''}><span>Final swap for the first player</span></label>
        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
        <button class="linkbtn small" data-a="delete">Delete this swap</button></section>`;
    }
  }
  const rules = !amHost && !TV ? `<section class="card"><h3>Rules for this swap</h3><p class="muted small" style="margin:0">${S.mode === 'online' ? 'Online gifts' : 'Gifts in the room'} · ${rulesText()}.</p></section>` : '';
  return `<div class="gtitle"><h1>${esc(S.title)}</h1><span class="badge">${S.mode === 'online' ? 'Online swap' : 'In the room'}</span></div>
    <div class="layout"><div>${main}${rules}</div><div>${TV ? '' : shareCard()}${people}</div></div>`;
}

// ---------- play ----------
function turnPanel() {
  const active = S.active;
  const owner = S.order[S.turn];
  const activeM = S.members.find((m) => m.id === active) || { name: '?' };
  const mine = isMe(active);
  const amHost = S.me && S.me.host;
  const acting = mine || (amHost && (activeM.offline || ui.hostAct === S.version));
  const last = S.events.at(-1);
  const final = S.phase === 'final';
  const nStealable = S.options ? S.options.stealable.length : 0;
  const wasStolen = last && last.t === 'steal' && last.from === active ? last : null;
  let kicker = final ? 'Final swap' : `Turn ${S.turn + 1} of ${S.turns}`;
  if (wasStolen && !final) kicker += ` · steal chain ${S.chain}`;
  let title, sub = '';
  const who = mine ? 'you' : esc(activeM.name);
  if (final) {
    const mg = heldBy(active);
    title = mine ? 'Your final swap' : `${esc(activeM.name)}’s final swap`;
    sub = `${mine ? 'You' : esc(activeM.name)} went first, so ${mine ? 'you' : 'they'} may swap ${mine ? 'your' : 'their'} <b>${esc(mg ? mg.label : 'gift')}</b> for any gift that isn’t frozen, or keep it.`;
  } else if (wasStolen) {
    const g = giftOf(wasStolen.gift);
    title = mine ? `${esc(nameOf(wasStolen.by))} stole your gift!` : `${esc(nameOf(wasStolen.by))} stole ${esc(activeM.name)}’s gift`;
    sub = `${mine ? 'You lost' : `${esc(activeM.name)} lost`} <b>${esc(g ? g.label : 'it')}</b>. ${mine ? 'Open a new gift or steal another one' : `Now ${who} opens a new gift or steals another one`}${S.stolenThisTurn.length ? ' (not one already stolen this turn)' : ''}.`;
  } else {
    title = mine ? `Your turn, ${esc(activeM.name)}!` : `${esc(activeM.name)}’s turn`;
    sub = mine ? 'Open a new gift, or steal one from the board.' : `Waiting for ${esc(activeM.name)} to open a gift or steal one.`;
  }
  if (!mine && S.me && S.me.plays && !final) {
    const myIdx = S.order.indexOf(S.me.id);
    if (myIdx > S.turn) { const k = myIdx - S.turn; sub += ` <br><span class="small">You’re up ${k === 1 ? 'next' : `in ${k} turns`} (#${myIdx + 1}).</span>`; }
  }
  if (owner !== active && !final && !wasStolen) sub += ` <span class="small">(${esc(nameOf(owner))}’s turn)</span>`;

  let actions = '';
  if (acting && !TV) {
    const forWho = mine ? '' : `<p class="small" style="margin:0 0 4px"><b>You’re playing for ${esc(activeM.name)}.</b></p>`;
    if (final) {
      actions = `${forWho}<p class="small" style="margin:0">Tap a gift on the board to swap for it.</p><button class="btn light big" data-a="keep">Keep ${esc((heldBy(active) || {}).label || 'my gift')}</button>`;
    } else if (S.mode === 'room') {
      actions = `${forWho}<form id="openForm" class="actions" autocomplete="off" style="margin-top:6px">
        <label for="openLabel" style="margin:0">Unwrapped a gift? What was inside?</label>
        <input id="openLabel" type="text" maxlength="70" placeholder="Singing fish">
        <button class="btn light big" type="submit">I opened it</button></form>
        ${nStealable ? `<p class="small" style="margin:10px 0 0">Or steal: tap one of the ${nStealable} highlighted gift${nStealable > 1 ? 's' : ''} below.</p>` : '<p class="small" style="margin:10px 0 0">No gifts can be stolen right now. Open a new one.</p>'}`;
    } else {
      actions = `${forWho}<p class="small" style="margin:6px 0 0">Tap a <b>wrapped gift</b> to open it${nStealable ? `, or one of the ${nStealable} highlighted gifts to steal it` : ''}.</p>`;
    }
  } else if (amHost && !TV && !mine) {
    actions = `<button class="btn ghost small" data-a="hostAct">Take this turn for ${esc(activeM.name)}</button>`;
  }
  return `<section class="turn${mine && !TV ? ' mine' : ''}" id="turn"><div class="kicker">${kicker}</div><h2>${title}</h2><p class="muted" style="margin:0">${sub}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</section>`;
}

function boardHtml(clickable) {
  const opts = S.options || { stealable: [], openable: [], swappable: [] };
  const opened = S.gifts.filter((g) => g.opened);
  const wrapped = S.gifts.filter((g) => !g.opened);
  const cards = opened.map((g) => {
    const can = clickable && (S.phase === 'final' ? opts.swappable : opts.stealable).includes(g.id);
    const tag = can ? 'button' : 'div';
    const thisTurn = S.stolenThisTurn.includes(g.id) && !g.frozen;
    return `<${tag} class="gift${g.frozen ? ' frozen' : ''}${can ? ' can' : ''}${S.me && g.holder === S.me.id ? ' mine-now' : ''}${ui.flash === g.id ? ' flash' : ''}"${can ? ` data-a="${S.phase === 'final' ? 'swap' : 'steal'}" data-id="${g.id}"` : ''}>
      ${thisTurn ? '<span class="tag">Stolen this turn</span>' : ''}
      <span class="gname">${esc(g.label)}</span>
      ${g.link ? `<a class="glink" href="${esc(g.link)}" target="_blank" rel="noopener nofollow">View gift ↗</a>` : ''}
      ${stealText(g)}
      <span class="holder">${S.me && g.holder === S.me.id ? '<b>You</b> have it' : `with <b>${esc(nameOf(g.holder))}</b>`}${g.giver ? ` · from ${esc(nameOf(g.giver))}` : ''}</span>
    </${tag}>`;
  });
  const wcards = S.mode === 'online' ? wrapped.map((g) => {
    const i = S.gifts.indexOf(g);
    const can = clickable && opts.openable.includes(g.id);
    const tag = can ? 'button' : 'div';
    return `<${tag} class="gift wrapped${can ? ' can openable' : ''}"${can ? ` data-a="open" data-id="${g.id}"` : ''}>
      <span class="tag">🎁 Wrapped</span><span class="gname">${g.hint ? `“${esc(g.hint)}”` : `Gift ${i + 1}`}</span>
      <span class="holder">${g.mine ? 'Your gift' : 'Not opened yet'}</span></${tag}>`;
  }) : [];
  const pile = S.mode === 'room' && S.phase === 'turns' ? `<p class="muted small" style="margin:10px 0 0">${S.turns - opened.length} wrapped gift${S.turns - opened.length === 1 ? '' : 's'} still in the pile.</p>` : '';
  return `<section class="card"><h2>Gift board</h2>${cards.length + wcards.length ? `<div class="board">${cards.join('')}${wcards.join('')}</div>` : '<p class="muted" style="margin:0">No gifts opened yet. The first player opens one from the pile.</p>'}${pile}</section>`;
}

function orderHtml() {
  return `<section class="card"><h3>Turn order</h3><ol class="order">${S.order.map((mid, i) => {
    const cls = [i < S.turn || S.phase !== 'turns' ? 'done' : '', mid === S.active ? 'now' : '', isMe(mid) ? 'me' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}"><span class="n">${i + 1}</span><span class="who">${esc(nameOf(mid))}</span>${S.online.includes(mid) && !TV ? '<span class="live"></span>' : ''}</li>`;
  }).join('')}</ol></section>`;
}

function feedHtml(limit = 30) {
  const ev = S.events.slice().reverse().slice(0, limit);
  return `<section class="card"><h3>What happened</h3>${ev.length ? `<ul class="feed">${ev.map((e) => `<li class="${e.t}"><span class="t">T${e.turn + 1}</span>${eventHtml(e)}</li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">Nothing yet.</p>'}</section>`;
}

function hostTools() {
  if (!S.me || !S.me.host || TV) return '';
  return `<section class="card host-only"><h3>Host tools</h3><div class="row">
    <button class="btn ghost small" data-a="undo" ${S.canUndo ? '' : 'disabled'}>Undo last move</button>
    <a class="btn ghost small" href="/g/${id}?tv" target="_blank" rel="noopener">Show on TV</a>
    <button class="btn ghost small" data-a="share">Share link</button></div></section>`;
}

function play() {
  const mine = isMe(S.active);
  const activeM = S.members.find((m) => m.id === S.active) || {};
  const clickable = !TV && (mine || (S.me && S.me.host && (activeM.offline || ui.hostAct === S.version)));
  const side = TV
    ? `${orderHtml()}${feedHtml(8)}<section class="card center"><img id="qrTv" class="qr" alt="QR code" style="width:11vw;height:11vw"><p class="muted small" style="margin:6px 0 0">Scan to watch on your phone</p></section>`
    : `${orderHtml()}${feedHtml()}${hostTools()}${!S.me ? '<section class="card"><p class="muted small" style="margin:0">You’re watching. The swap started before you joined.</p></section>' : ''}`;
  return `<div class="gtitle"><h1>${esc(S.title)}</h1><span class="badge ${S.totalSteals ? 'red' : ''}">${S.totalSteals} steal${S.totalSteals === 1 ? '' : 's'}</span></div>
    <div class="layout"><div>${turnPanel()}<div style="height:14px"></div>${boardHtml(clickable)}</div><div>${side}</div></div>`;
}

// ---------- done ----------
function done() {
  const r = S.recap;
  const stats = [];
  if (r.mostStolen) stats.push(`<div class="stat"><span>Most stolen</span><b>${esc(r.mostStolen.gift)}</b><span>${r.mostStolen.steals}× · ended with ${esc(r.mostStolen.holder)}</span></div>`);
  if (r.longestChain) stats.push(`<div class="stat"><span>Longest steal chain</span><b>${r.longestChain.n} steals in a row</b><span>turn ${r.longestChain.turn}, started by ${esc(r.longestChain.starter)}</span></div>`);
  if (r.unlucky) stats.push(`<div class="stat"><span>Robbed most</span><b>${esc(r.unlucky.name)}</b><span>lost a gift ${r.unlucky.n} times</span></div>`);
  stats.push(`<div class="stat"><span>Total steals</span><b>${r.totalSteals}</b><span>${r.untouched} gift${r.untouched === 1 ? '' : 's'} never stolen</span></div>`);
  const haul = r.haul.map((h) => `<li${isMe(h.id) ? ' style="font-weight:700"' : ''}><span class="who">${esc(h.name)}${isMe(h.id) ? ' (you)' : ''}</span><span class="what">${esc(h.gift || '—')}${h.giver ? `<br><span class="muted small">from ${esc(h.giver)}${h.link ? ` · <a href="${esc(h.link)}" target="_blank" rel="noopener nofollow">link ↗</a>` : ''}</span>` : ''}</span></li>`).join('');
  const send = S.mode === 'online' && S.me && S.me.plays ? (() => {
    const h = r.haul.find((x) => x.giver === S.me.name);
    return h ? `<p><b>Send your gift to ${esc(h.name)}.</b> ${isMe(h.id) ? '(You kept your own!)' : ''}</p>` : '';
  })() : '';
  const myGift = S.me ? r.haul.find((h) => h.id === S.me.id) : null;
  return `<div class="gtitle"><h1>${esc(S.title)}: final haul</h1><span class="badge gold">Finished</span></div>
    <div class="layout"><div>
      <section class="card">${myGift ? `<h2>You ended up with ${esc(myGift.gift)} 🎉</h2>` : '<h2>The swap is over 🎉</h2>'}${send}
        <div class="stats">${stats.join('')}</div>
        <ul class="haul">${haul}</ul>
        <div class="row hide-tv" style="margin-top:16px"><button class="btn" data-a="card">Share recap card</button><button class="btn ghost" data-a="copy">Copy link</button></div>
      </section>
    </div><div>
      <section class="cta hide-tv"><h2>Going to another party?</h2><p>Run your own swap in 30 seconds. Free, no sign-up.</p><a class="btn" href="/">Start a swap</a></section>
      <div style="height:14px"></div>${feedHtml(100)}
      ${S.me && S.me.host && !TV ? `<section class="card host-only"><div class="row"><button class="btn ghost small" data-a="undo">Undo last move</button><button class="linkbtn small" data-a="delete">Delete this swap</button></div></section>` : ''}
    </div></div>`;
}

// ---------- events ----------
function sheet(html, onOk) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}<div class="row" style="margin-top:16px"><button class="btn red grow" data-ok>Yes</button><button class="btn ghost grow" data-cancel>Cancel</button></div></div>`;
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-cancel]')) close(); });
  const ok = bg.querySelector('[data-ok]');
  ok.textContent = onOk.label || 'Yes';
  if (onOk.green) ok.classList.remove('red');
  ok.addEventListener('click', () => { close(); onOk(); });
  ok.focus();
}

async function share(text) {
  if (navigator.share) { try { await navigator.share({ title: S.title, text, url: shareUrl }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copy();
}
async function copy() {
  try { await navigator.clipboard.writeText(shareUrl); toast('Link copied'); } catch { toast(shareUrl); }
}

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b || !S) return;
  const a = b.dataset.a;
  const v = S.version;
  if (a === 'share') return share(`Join our gift swap “${S.title}” on Swapsteal`);
  if (a === 'copy') return copy();
  if (a === 'hostAct') { ui.hostAct = S.version; render(); return; }
  if (a === 'start') return sheet(`<h2>Start the swap?</h2><p class="muted">${players().length} players. Nobody can join after this. Swapsteal will draw a random turn order.</p>`, Object.assign(() => act({ type: 'start' }), { label: 'Draw the order', green: true }));
  if (a === 'undo') return sheet('<h2>Undo the last move?</h2><p class="muted">The board goes back one step for everyone.</p>', Object.assign(() => act({ type: 'undo' }, 'Undone'), { label: 'Undo' }));
  if (a === 'delete') return sheet('<h2>Delete this swap?</h2><p class="muted">Everything is erased for everyone. This cannot be undone.</p>', Object.assign(async () => { deleting = true; if (await act({ type: 'delete' })) { setMe(id, null); location.href = '/'; } else deleting = false; }, { label: 'Delete' }));
  if (a === 'remove') {
    const m = S.members.find((x) => x.id === b.dataset.id);
    const self = isMe(b.dataset.id);
    return sheet(`<h2>${self ? 'Leave this swap?' : `Remove ${esc(m ? m.name : '')}?`}</h2>`, Object.assign(async () => { if (await act({ type: 'remove', member: b.dataset.id })) { if (self) { setMe(id, null); me = null; reconnect(); poll(); } } }, { label: self ? 'Leave' : 'Remove' }));
  }
  if (a === 'steal' || a === 'swap') {
    const g = giftOf(b.dataset.id);
    const who = nameOf(g.holder);
    const left = S.maxSteals ? S.maxSteals - g.steals - 1 : null;
    const note = a === 'steal' && left === 0 ? '<p class="muted">This will be its last steal: it freezes with you.</p>' : '';
    return sheet(`<h2>${a === 'steal' ? `Steal ${esc(g.label)} from ${esc(who)}?` : `Swap for ${esc(g.label)}?`}</h2>${a === 'swap' ? `<p class="muted">${esc(who)} gets ${esc((heldBy(S.active) || {}).label || 'your gift')} and the swap ends.</p>` : note}`,
      Object.assign(() => act({ type: 'move', move: { t: a, gift: g.id }, turnVersion: v }), { label: a === 'steal' ? 'Steal it' : 'Swap' }));
  }
  if (a === 'open') {
    const g = giftOf(b.dataset.id);
    return sheet(`<h2>Open this gift?</h2>${g.hint ? `<p class="muted">“${esc(g.hint)}”</p>` : ''}`, Object.assign(() => act({ type: 'move', move: { t: 'open', gift: g.id }, turnVersion: v }), { label: 'Open it', green: true }));
  }
  if (a === 'keep') return sheet('<h2>Keep your gift and finish?</h2>', Object.assign(() => act({ type: 'move', move: { t: 'keep' }, turnVersion: v }), { label: 'Keep & finish', green: true }));
  if (a === 'card') {
    b.disabled = true;
    try { await drawCard(S, shareUrl); } catch { toast('Could not make the card on this device.'); }
    b.disabled = false;
  }
});

app.addEventListener('change', (e) => {
  if (!S || !S.me || !S.me.host || S.status !== 'lobby') return;
  if (e.target.id === 'setSteals') act({ type: 'settings', maxSteals: Number(e.target.value) }, 'Rules updated');
  if (e.target.id === 'setFinal') act({ type: 'settings', finalSwap: e.target.checked }, 'Rules updated');
});

const giftFrom = (p) => ({ label: $(`#${p}Label`).value, hint: $(`#${p}Hint`).value, link: $(`#${p}Link`).value });
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'joinForm') {
    const name = $('#joinName').value.trim();
    if (!name) { toast('Type your name.'); $('#joinName').focus(); return; }
    const body = { name };
    if (S.mode === 'online') { body.gift = giftFrom('join'); if (!body.gift.label.trim()) { toast('Describe the gift you are bringing.'); $('#joinLabel').focus(); return; } }
    if (busy) return;
    busy = true;
    try {
      const r = await api(`/api/g/${id}/join`, { method: 'POST', body });
      me = { token: r.token, id: r.me };
      setMe(id, me);
      setState(r.state);
      reconnect();
      toast(`You’re in, ${name}!`);
    } catch (x) { toast(x.message); } finally { busy = false; }
  }
  if (f.id === 'giftForm') {
    const gift = giftFrom('my');
    if (!gift.label.trim()) { toast('Describe the gift you are bringing.'); return; }
    await act({ type: 'gift', gift }, 'Gift saved');
  }
  if (f.id === 'addForm') {
    const name = $('#addName').value.trim();
    if (!name) { toast('Type a name.'); return; }
    const body = { type: 'add', name };
    if (S.mode === 'online') { body.gift = giftFrom('add'); if (!body.gift.label.trim()) { toast(`Describe ${name}’s gift.`); return; } }
    if (await act(body, `${name} added`)) { f.reset(); f.querySelectorAll('input').forEach((i) => { i.value = ''; }); }
  }
  if (f.id === 'openForm') {
    const label = $('#openLabel').value.trim();
    if (!label) { toast('Type what was inside the gift.'); $('#openLabel').focus(); return; }
    if (await act({ type: 'move', move: { t: 'open', label }, turnVersion: S.version })) { const i = $('#openLabel'); if (i) i.value = ''; }
  }
});

// ---------- boot ----------
(async () => {
  if (!/^[A-Za-z0-9]{8,16}$/.test(id || '')) return gone();
  try { setState(await api(`/api/g/${id}`, { token: me && me.token })); } catch (e) { if (e.status === 404) return gone(); app.innerHTML = `<div class="card narrow"><p>${esc(e.message)}</p></div>`; }
  if (S && me && !S.me) { setMe(id, null); me = null; }
  connect();
  if (TV && navigator.wakeLock) { try { await navigator.wakeLock.request('screen'); } catch { /* */ } }
})();

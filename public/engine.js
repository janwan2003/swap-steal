// Swapsteal game engine: pure functions shared by the browser and the Worker.
//
// A stored game is { mode, maxSteals, finalSwap, members, gifts, order, moves }.
// The live state is never stored: replay(game) rebuilds it from the move list, which
// makes "undo" a matter of dropping the last move.
//
// Rules (white elephant / Yankee swap):
// - Players take turns in a random order. On your turn you open a new gift or steal an
//   opened one. If yours is stolen, you open or steal next ("steal chain"); the turn ends
//   when someone opens a new gift.
// - A gift can be stolen only once per turn, so nobody can steal straight back.
// - With maxSteals = N, a gift freezes after its Nth steal and stays with that owner.
// - With finalSwap, the first player may swap once at the end (they never got to steal).
// - mode 'room': gifts are physical; the opener types what was inside.
//   mode 'online': every player registers a gift (hidden) with an optional hint and link.

export const MAX_PLAYERS = 100;
export const MAX_MOVES = 3000;
export const STEAL_LIMITS = [0, 1, 2, 3, 4, 5]; // 0 = no limit
export const LIMITS = { title: 60, name: 24, label: 70, hint: 60, link: 300 };

export const clean = (s, max) =>
  String(s ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export function cleanLink(s) {
  const v = clean(s, LIMITS.link);
  if (!v) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.toString();
  } catch { return ''; }
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const players = (game) => game.members.filter((m) => m.plays);

// Rebuild the live state from the move list.
export function replay(game) {
  const s = {
    phase: game.order && game.order.length ? 'turns' : 'lobby',
    turn: 0,
    turns: game.order ? game.order.length : 0,
    active: null,
    stolenThisTurn: [],
    chain: 0,
    gifts: {},
    holding: {},
    events: [],
    totalSteals: 0,
  };
  for (const g of game.gifts || []) {
    s.gifts[g.id] = { id: g.id, giver: g.giver ?? null, label: g.label, hint: g.hint || '', link: g.link || '', opened: false, holder: null, steals: 0, frozen: false, openedBy: null, owners: [] };
  }
  if (s.phase === 'lobby') return s;
  s.active = game.order[0];
  for (const mv of game.moves || []) step(game, s, mv);
  return s;
}

function endTurn(game, s) {
  s.turn += 1;
  s.stolenThisTurn = [];
  s.chain = 0;
  if (s.turn < s.turns) { s.active = game.order[s.turn]; return; }
  const first = game.order[0];
  if (game.finalSwap && s.turns >= 2 && swapTargets(game, s, first).length) {
    s.phase = 'final';
    s.active = first;
  } else {
    s.phase = 'done';
    s.active = null;
  }
}

function take(s, gift, who) {
  gift.holder = who;
  gift.owners.push(who);
  s.holding[who] = gift.id;
}

function step(game, s, mv) {
  const by = s.active;
  if (mv.t === 'open') {
    let gift;
    if (game.mode === 'room') {
      gift = s.gifts[mv.gift] = { id: mv.gift, giver: null, label: mv.label, hint: '', link: '', opened: false, holder: null, steals: 0, frozen: false, openedBy: null, owners: [] };
    } else gift = s.gifts[mv.gift];
    gift.opened = true;
    gift.openedBy = by;
    gift.openedTurn = s.turn;
    take(s, gift, by);
    s.events.push({ t: 'open', by, gift: gift.id, turn: s.turn });
    endTurn(game, s);
  } else if (mv.t === 'steal') {
    const gift = s.gifts[mv.gift];
    const from = gift.holder;
    delete s.holding[from];
    take(s, gift, by);
    gift.steals += 1;
    if (game.maxSteals && gift.steals >= game.maxSteals) gift.frozen = true;
    s.stolenThisTurn.push(gift.id);
    s.chain += 1;
    s.totalSteals += 1;
    s.events.push({ t: 'steal', by, from, gift: gift.id, turn: s.turn, frozen: gift.frozen, chain: s.chain });
    s.active = from;
  } else if (mv.t === 'swap') {
    const gift = s.gifts[mv.gift];
    const mine = s.gifts[s.holding[by]];
    const from = gift.holder;
    take(s, gift, by);
    take(s, mine, from);
    gift.steals += 1;
    if (game.maxSteals && gift.steals >= game.maxSteals) gift.frozen = true;
    s.totalSteals += 1;
    s.events.push({ t: 'swap', by, from, gift: gift.id, gave: mine.id, turn: s.turn });
    s.phase = 'done';
    s.active = null;
  } else if (mv.t === 'keep') {
    s.events.push({ t: 'keep', by, gift: s.holding[by], turn: s.turn });
    s.phase = 'done';
    s.active = null;
  }
}

// Gifts the active player may steal right now.
export function stealable(game, s, who = s.active) {
  if (s.phase !== 'turns' || !who) return [];
  return Object.values(s.gifts)
    .filter((g) => g.opened && !g.frozen && g.holder !== who && !s.stolenThisTurn.includes(g.id))
    .map((g) => g.id);
}

function swapTargets(game, s, who) {
  const mine = s.holding[who];
  return Object.values(s.gifts).filter((g) => g.opened && !g.frozen && g.holder && g.holder !== who && g.id !== mine).map((g) => g.id);
}
export const swappable = (game, s) => (s.phase === 'final' ? swapTargets(game, s, s.active) : []);

// Wrapped gifts the active player may open (online mode). Your own gift only if it is the last one.
export function openable(game, s, who = s.active) {
  if (s.phase !== 'turns' || game.mode !== 'online') return [];
  const wrapped = Object.values(s.gifts).filter((g) => !g.opened);
  const notMine = wrapped.filter((g) => g.giver !== who);
  return (notMine.length ? notMine : wrapped).map((g) => g.id);
}

// Validate a move for the current state. Returns an error string, or null if legal.
export function check(game, s, mv) {
  if (!mv || typeof mv !== 'object') return 'Unknown move.';
  if (s.phase === 'lobby') return 'The game has not started yet.';
  if (s.phase === 'done') return 'The game is over.';
  if ((game.moves || []).length >= MAX_MOVES) return 'This game has too many moves.';
  if (mv.t === 'open') {
    if (s.phase !== 'turns') return 'Only a swap or keep is possible now.';
    if (game.mode === 'room') {
      if (!clean(mv.label, LIMITS.label)) return 'Type what was inside the gift.';
      return null;
    }
    if (!openable(game, s).includes(mv.gift)) return 'That gift cannot be opened.';
    return null;
  }
  if (mv.t === 'steal') {
    if (s.phase !== 'turns') return 'Only a swap or keep is possible now.';
    const g = s.gifts[mv.gift];
    if (!g || !g.opened) return 'That gift is not open yet.';
    if (g.holder === s.active) return 'You already have that gift.';
    if (g.frozen) return 'That gift is frozen and cannot be stolen.';
    if (s.stolenThisTurn.includes(g.id)) return 'That gift was already stolen this turn.';
    return null;
  }
  if (mv.t === 'swap') {
    if (s.phase !== 'final') return 'Swaps happen only in the final round.';
    if (!swappable(game, s).includes(mv.gift)) return 'That gift cannot be swapped.';
    return null;
  }
  if (mv.t === 'keep') {
    if (s.phase !== 'final') return 'Keeping is only for the final round.';
    return null;
  }
  return 'Unknown move.';
}

// Highlights for the recap card.
export function recap(game, s) {
  const gifts = Object.values(s.gifts).filter((g) => g.opened);
  const name = Object.fromEntries(game.members.map((m) => [m.id, m.name]));
  let most = null;
  for (const g of gifts) if (g.steals > 0 && (!most || g.steals > most.steals)) most = g;
  let chain = null;
  for (const e of s.events) if (e.t === 'steal' && (!chain || e.chain > chain.n)) chain = { n: e.chain, turn: e.turn, starter: game.order[e.turn] };
  const robbed = {};
  for (const e of s.events) if (e.t === 'steal' || e.t === 'swap') robbed[e.from] = (robbed[e.from] || 0) + 1;
  let unlucky = null;
  for (const [id, n] of Object.entries(robbed)) if (!unlucky || n > unlucky.n) unlucky = { id, n };
  const untouched = gifts.filter((g) => g.steals === 0).length;
  const haul = (game.order || []).map((id) => {
    const g = s.gifts[s.holding[id]];
    return { id, name: name[id] || '?', gift: g ? g.label : null, giftId: g ? g.id : null, link: g ? g.link : '', giver: g && g.giver ? name[g.giver] || null : null };
  });
  return {
    haul,
    totalSteals: s.totalSteals,
    mostStolen: most ? { gift: most.label, steals: most.steals, holder: name[most.holder] || '?', owners: most.owners.length } : null,
    longestChain: chain && chain.n >= 2 ? { n: chain.n, turn: chain.turn + 1, starter: name[chain.starter] || '?' } : null,
    unlucky: unlucky && unlucky.n >= 2 ? { name: name[unlucky.id] || '?', n: unlucky.n } : null,
    untouched,
  };
}

// Short text for link previews and the TV ticker.
export function describeEvent(game, e, s) {
  const name = Object.fromEntries(game.members.map((m) => [m.id, m.name]));
  const label = (id) => (s.gifts[id] ? s.gifts[id].label : 'a gift');
  if (e.t === 'open') return `${name[e.by]} opened ${label(e.gift)}`;
  if (e.t === 'steal') return `${name[e.by]} stole ${label(e.gift)} from ${name[e.from]}${e.frozen ? ' (now frozen)' : ''}`;
  if (e.t === 'swap') return `${name[e.by]} swapped for ${label(e.gift)} with ${name[e.from]}`;
  if (e.t === 'keep') return `${name[e.by]} kept ${label(e.gift)}`;
  return '';
}

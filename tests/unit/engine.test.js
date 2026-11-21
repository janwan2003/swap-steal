import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, check, stealable, openable, swappable, recap, shuffle, cleanLink, clean } from '../../public/engine.js';

const mem = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, plays: true }));
function room(n, opts = {}) {
  const members = mem(n);
  return { mode: 'room', maxSteals: 3, finalSwap: true, members, gifts: [], order: members.map((m) => m.id), moves: [], ...opts };
}
function online(n, opts = {}) {
  const members = mem(n);
  const gifts = members.map((m, i) => ({ id: 'g' + i, giver: m.id, label: 'Gift' + i, hint: 'h' + i }));
  return { mode: 'online', maxSteals: 3, finalSwap: true, members, gifts, order: members.map((m) => m.id), moves: [], ...opts };
}
// Apply a move, asserting it is legal.
function play(game, mv) {
  const s = replay(game);
  const err = check(game, s, mv);
  assert.equal(err, null, `move ${JSON.stringify(mv)} rejected: ${err}`);
  game.moves.push(mv);
  return replay(game);
}
let rid = 0;
const open = (game, label) => play(game, { t: 'open', gift: 'r' + rid++, label });

test('lobby state before order is drawn', () => {
  const s = replay({ mode: 'room', members: mem(3), gifts: [], order: [], moves: [] });
  assert.equal(s.phase, 'lobby');
  assert.match(check({ members: [] }, s, { t: 'open', label: 'x' }), /not started/);
});

test('simple game: everyone opens, final swap, done', () => {
  const g = room(3);
  let s = replay(g);
  assert.equal(s.phase, 'turns');
  assert.equal(s.active, 'p0');
  s = open(g, 'Mug');
  assert.equal(s.active, 'p1');
  s = open(g, 'Socks');
  s = open(g, 'Candle');
  assert.equal(s.phase, 'final');
  assert.equal(s.active, 'p0');
  const target = Object.values(s.gifts).find((x) => x.label === 'Candle').id;
  assert.ok(swappable(g, s).includes(target));
  s = play(g, { t: 'swap', gift: target });
  assert.equal(s.phase, 'done');
  const r = recap(g, s);
  assert.deepEqual(r.haul.map((h) => h.gift), ['Candle', 'Socks', 'Mug']);
  assert.equal(r.totalSteals, 1);
});

test('steal chain, once per turn, no steal-back', () => {
  const g = room(4);
  let s = open(g, 'Mug'); // p0 has Mug
  s = open(g, 'Socks'); // p1 has Socks
  const mug = Object.values(s.gifts).find((x) => x.label === 'Mug').id;
  const socks = Object.values(s.gifts).find((x) => x.label === 'Socks').id;
  assert.equal(s.active, 'p2');
  s = play(g, { t: 'steal', gift: mug }); // p2 steals Mug from p0
  assert.equal(s.active, 'p0');
  assert.equal(s.gifts[mug].holder, 'p2');
  // p0 cannot steal Mug straight back
  assert.match(check(g, s, { t: 'steal', gift: mug }), /already stolen this turn/);
  assert.deepEqual(stealable(g, s), [socks]);
  s = play(g, { t: 'steal', gift: socks }); // p0 steals Socks from p1
  assert.equal(s.active, 'p1');
  assert.deepEqual(stealable(g, s), []); // both gifts stolen this turn
  s = open(g, 'Book'); // p1 opens; turn ends, next is p3
  assert.equal(s.active, 'p3');
  assert.equal(s.turn, 3);
  assert.equal(stealable(g, s).length, 3); // new turn resets the once-per-turn rule
  const r = recap(g, s);
  assert.equal(r.longestChain.n, 2);
  assert.equal(r.longestChain.starter, 'P2');
});

test('gift freezes after maxSteals', () => {
  const g = room(5, { maxSteals: 2 });
  let s = open(g, 'Blanket'); // p0
  const b = Object.keys(s.gifts)[0];
  s = play(g, { t: 'steal', gift: b }); // p1 steals from p0 (1)
  s = open(g, 'Fish'); // p0 opens
  s = play(g, { t: 'steal', gift: b }); // p2 steals from p1 (2) -> frozen
  assert.equal(s.gifts[b].frozen, true);
  s = open(g, 'Lamp'); // p1 opens
  assert.equal(s.active, 'p3');
  assert.match(check(g, s, { t: 'steal', gift: b }), /frozen/);
  assert.ok(!stealable(g, s).includes(b));
  const r = recap(g, s);
  assert.equal(r.mostStolen.gift, 'Blanket');
  assert.equal(r.mostStolen.steals, 2);
});

test('no limit when maxSteals is 0', () => {
  const g = room(3, { maxSteals: 0 });
  let s = open(g, 'A');
  const a = Object.keys(s.gifts)[0];
  for (let i = 0; i < 6; i++) {
    s = play(g, { t: 'steal', gift: a });
    s = open(g, 'X' + i);
    if (s.phase !== 'turns') break;
  }
  assert.equal(Object.values(s.gifts).some((x) => x.frozen), false);
});

test('final swap is skipped when nothing is swappable', () => {
  const g = room(2, { maxSteals: 1 });
  let s = open(g, 'A'); // p0
  const a = Object.keys(s.gifts)[0];
  s = play(g, { t: 'steal', gift: a }); // p1 steals A, now frozen
  assert.equal(s.active, 'p0');
  s = open(g, 'B'); // p0 opens B; last turn done, only frozen A to swap for
  assert.equal(s.phase, 'done');
});

test('final round keep ends the game', () => {
  const g = room(2, { maxSteals: 0 });
  open(g, 'A');
  let s = open(g, 'B');
  assert.equal(s.phase, 'final');
  assert.match(check(g, s, { t: 'open', label: 'C' }), /swap or keep/);
  s = play(g, { t: 'keep' });
  assert.equal(s.phase, 'done');
  assert.match(check(g, s, { t: 'keep' }), /over/);
});

test('finalSwap off ends after last turn', () => {
  const g = room(2, { finalSwap: false });
  open(g, 'A');
  const s = open(g, 'B');
  assert.equal(s.phase, 'done');
});

test('online mode: pick wrapped gifts, never your own unless it is the last', () => {
  const g = online(3);
  let s = replay(g);
  assert.deepEqual(openable(g, s).sort(), ['g1', 'g2']);
  assert.match(check(g, s, { t: 'open', gift: 'g0' }), /cannot be opened/);
  s = play(g, { t: 'open', gift: 'g2' }); // p0
  s = play(g, { t: 'open', gift: 'g0' }); // p1
  assert.deepEqual(openable(g, s), ['g1']); // p2's own gift is the only one left
  s = play(g, { t: 'open', gift: 'g1' });
  assert.equal(s.phase, 'final');
  const r = recap(g, s);
  assert.equal(r.haul[0].giver, 'P2');
});

test('online mode: steal then reopen keeps gift accounting consistent', () => {
  const g = online(4);
  let s = play(g, { t: 'open', gift: 'g1' }); // p0
  s = play(g, { t: 'steal', gift: 'g1' }); // p1 steals from p0
  s = play(g, { t: 'open', gift: 'g2' }); // p0
  s = play(g, { t: 'open', gift: 'g3' }); // p2
  s = play(g, { t: 'steal', gift: 'g2' }); // p3 steals from p0
  s = play(g, { t: 'open', gift: 'g0' }); // p0 opens last (own gift, only one left)
  assert.equal(s.phase, 'final');
  const holders = Object.values(s.gifts).map((x) => x.holder).sort();
  assert.deepEqual(holders, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(Object.keys(s.holding).length, 4);
});

test('random games never deadlock and always end with one gift each', () => {
  for (let seed = 1; seed <= 300; seed++) {
    let x = seed;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const n = 2 + (seed % 12);
    const g = (seed % 2 ? online : room)(n, { maxSteals: seed % 5, finalSwap: seed % 3 !== 0 });
    let s = replay(g);
    let guard = 0;
    while (s.phase !== 'done') {
      assert.ok(guard++ < 2000, 'game did not end');
      let mv;
      if (s.phase === 'final') {
        const t = swappable(g, s);
        mv = t.length && rand() < 0.7 ? { t: 'swap', gift: t[Math.floor(rand() * t.length)] } : { t: 'keep' };
      } else {
        const st = stealable(g, s);
        if (st.length && rand() < 0.5) mv = { t: 'steal', gift: st[Math.floor(rand() * st.length)] };
        else if (g.mode === 'online') {
          const o = openable(g, s);
          assert.ok(o.length, 'nothing to open in online mode');
          mv = { t: 'open', gift: o[Math.floor(rand() * o.length)] };
        } else mv = { t: 'open', gift: 'r' + rid++, label: 'G' };
      }
      s = play(g, mv);
    }
    const holders = Object.values(s.gifts).filter((q) => q.opened).map((q) => q.holder);
    assert.equal(new Set(holders).size, n);
    assert.equal(Object.keys(s.holding).length, n);
    recap(g, s);
  }
});

test('helpers', () => {
  assert.equal(shuffle([1, 2, 3, 4]).length, 4);
  assert.equal(cleanLink('example.com/x'), 'https://example.com/x');
  assert.equal(cleanLink('javascript:alert(1)'), '');
  assert.equal(cleanLink('localhost'), '');
  assert.equal(clean('  a\n\tb  ', 10), 'a b');
});

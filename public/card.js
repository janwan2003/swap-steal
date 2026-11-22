// Recap card: a 1080x1350 PNG of the final haul, shared through the share sheet or downloaded.
function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function renderCard(S) {
  const W = 1080, H = 1350, P = 72;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const F = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillStyle = '#17603f'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fbf7f0';
  x.beginPath(); x.roundRect(40, 40, W - 80, H - 80, 36); x.fill();
  const r = S.recap;
  x.fillStyle = '#c8323c'; x.font = `800 30px ${F}`; x.fillText('FINAL HAUL', P, 130);
  // Title: one line at 64 px, or two lines at 54 px when it is long.
  x.fillStyle = '#1d2a24'; x.font = `800 64px ${F}`;
  let y = 290;
  if (x.measureText(S.title).width <= W - 2 * P) x.fillText(S.title, P, 210);
  else {
    x.font = `800 54px ${F}`;
    const words = S.title.split(' ');
    let first = '';
    while (words.length && x.measureText(first ? first + ' ' + words[0] : words[0]).width <= W - 2 * P) first = first ? first + ' ' + words.shift() : words.shift();
    if (!first) first = fit(x, words.shift(), W - 2 * P);
    x.fillText(first, P, 200);
    x.fillText(fit(x, words.join(' '), W - 2 * P), P, 264);
    y = 350;
  }
  const hl = [];
  x.font = `700 32px ${F}`;
  const hlW = W - 2 * P - 44;
  if (r.mostStolen) {
    // Shorten the gift name, never the "was stolen N×" part.
    const tail = `” was stolen ${r.mostStolen.steals}×`;
    hl.push(`“${fit(x, r.mostStolen.gift, hlW - x.measureText('“' + tail).width)}${tail}`);
  }
  if (r.longestChain) hl.push(`Longest chain: ${r.longestChain.n} steals in a row`);
  if (r.unlucky) hl.push(`${r.unlucky.name} was robbed ${r.unlucky.n} times`);
  hl.push(`${r.totalSteals} steal${r.totalSteals === 1 ? '' : 's'} · ${r.haul.length} players`);
  for (const h of hl.slice(0, 3)) {
    x.fillStyle = '#fdf3dc'; x.beginPath(); x.roundRect(P, y - 46, W - 2 * P, 66, 16); x.fill();
    x.fillStyle = '#6f5418'; x.font = `700 32px ${F}`; x.fillText(fit(x, h, hlW), P + 22, y);
    y += 84;
  }
  // The haul: fill the space down to the footer. Rows shrink to fit everyone; below 38 px a row,
  // the rest is summarised as "+ N more".
  y += 10;
  const bottom = H - 170;
  const MIN = 38, MAX = 74;
  let rows = r.haul;
  let step = Math.min(MAX, (bottom - y) / rows.length);
  if (step < MIN) { step = MIN; rows = r.haul.slice(0, Math.floor((bottom - y) / MIN) - 1); }
  const size = Math.round(Math.min(36, step * 0.58));
  const nameW = 300;
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i];
    const base = y + step * i + step / 2 + size * 0.35;
    if (i > 0) { x.fillStyle = '#ece4d6'; x.fillRect(P, y + step * i, W - 2 * P, 2); }
    x.fillStyle = '#1d2a24'; x.font = `700 ${size}px ${F}`;
    x.fillText(fit(x, h.name, nameW), P, base);
    x.fillStyle = '#3b4a42'; x.font = `400 ${size}px ${F}`;
    x.fillText(fit(x, h.gift || '—', W - 2 * P - nameW - 30), P + nameW + 30, base);
  }
  if (r.haul.length > rows.length) {
    x.fillStyle = '#6b756f'; x.font = `400 28px ${F}`;
    x.fillText(`+ ${r.haul.length - rows.length} more`, P, y + step * rows.length + step / 2 + 10);
  }
  x.fillStyle = '#17603f'; x.font = `800 36px ${F}`; x.fillText('Swapsteal', P, H - 100);
  x.fillStyle = '#6b756f'; x.font = `400 26px ${F}`; const host = typeof location !== 'undefined' ? location.host : ''; if (host) { const w = x.measureText(host).width; x.fillText(host, W - P - w, H - 100); }
  x.fillStyle = '#6b756f'; x.font = `400 28px ${F}`; x.fillText('White elephant on everyone’s phone · free, no sign-up', P, H - 62);
  return c;
}

export async function drawCard(S, url) {
  const c = renderCard(S);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'swapsteal-recap.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: S.title, text: `Our gift swap “${S.title}”: ${url}` }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'swapsteal-recap.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

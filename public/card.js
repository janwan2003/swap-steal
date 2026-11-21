// Recap card: a 1080x1350 PNG of the final haul, shared through the share sheet or downloaded.
function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) return line + '…';
    line = t;
  }
  return line;
}
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
  x.fillStyle = '#1d2a24'; x.font = `800 64px ${F}`; x.fillText(fit(x, S.title, W - 2 * P), P, 210);
  let y = 290;
  const hl = [];
  if (r.mostStolen) hl.push(`“${r.mostStolen.gift}” was stolen ${r.mostStolen.steals}×`);
  if (r.longestChain) hl.push(`Longest chain: ${r.longestChain.n} steals in a row`);
  if (r.unlucky) hl.push(`${r.unlucky.name} was robbed ${r.unlucky.n} times`);
  hl.push(`${r.totalSteals} steal${r.totalSteals === 1 ? '' : 's'} · ${r.haul.length} players`);
  for (const h of hl.slice(0, 3)) {
    x.fillStyle = '#fdf3dc'; x.beginPath(); x.roundRect(P, y - 46, W - 2 * P, 66, 16); x.fill();
    x.fillStyle = '#6f5418'; x.font = `700 32px ${F}`; x.fillText(fit(x, h, W - 2 * P - 40), P + 22, y);
    y += 84;
  }
  y += 20;
  const rows = r.haul.slice(0, Math.max(4, Math.floor((H - 200 - y) / 56)));
  const size = rows.length > 12 ? 28 : 34;
  const step = rows.length > 12 ? 46 : 56;
  for (const h of rows) {
    x.fillStyle = '#1d2a24'; x.font = `700 ${size}px ${F}`;
    x.fillText(fit(x, h.name, 330), P, y);
    x.fillStyle = '#3b4a42'; x.font = `400 ${size}px ${F}`;
    const g = wrap(x, h.gift || '—', W - 2 * P - 360);
    x.fillText(fit(x, g, W - 2 * P - 360), P + 360, y);
    y += step;
    if (y > H - 190) break;
  }
  if (r.haul.length > rows.length) { x.fillStyle = '#6b756f'; x.font = `400 28px ${F}`; x.fillText(`+ ${r.haul.length - rows.length} more`, P, y); }
  x.fillStyle = '#17603f'; x.font = `800 36px ${F}`; x.fillText('Swapsteal', P, H - 100);
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

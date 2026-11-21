import { chromium } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const root = path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()[0];
const b = await chromium.launch({ executablePath: path.join(root, dir, 'chrome-linux64/chrome') });
const errs = [];
for (const [w, n] of [[390, 'phone'], [1280, 'desktop']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
  await p.goto('https://janwan2003.github.io/swap-steal/', { waitUntil: 'networkidle' });
  await p.screenshot({ path: `shots-prod/pages-${n}.png`, fullPage: false });
  const links = await p.$$eval('a[href]', (as) => as.map((a) => a.href));
  for (const l of [...new Set(links)].filter((l) => l.startsWith('http') && !l.includes('#'))) {
    const r = await fetch(l); if (r.status >= 400) errs.push(`link ${l} -> ${r.status}`);
  }
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();

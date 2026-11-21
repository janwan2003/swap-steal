// Renders public/og.png (1200x630) from tools/og.html and public/icon-180.png, public/icon-512.png from public/icon.svg.
// Usage: node tools/render-images.mjs   (playwright-core from local node_modules, or via NODE_PATH=/path/to/node_modules)
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import url from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core'); // require() honours NODE_PATH, ESM import does not
const root = path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()[0];
const b = await chromium.launch({ executablePath: path.join(root, dir, 'chrome-linux64/chrome') });
const here = path.dirname(url.fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + path.join(here, 'og.html'));
await p.screenshot({ path: path.join(pub, 'og.png') });
for (const s of [180, 512]) {
  const q = await b.newPage({ viewport: { width: s, height: s } });
  const svg = fs.readFileSync(path.join(pub, 'icon.svg'), 'utf8').replace('<svg ', `<svg width="${s}" height="${s}" `);
  // 180 is the apple-touch-icon: iOS rounds it itself and turns transparency black, so fill the corners.
  const bg = s === 180 ? 'background:#17603f' : '';
  await q.setContent(`<body style="margin:0;${bg}">${svg}</body>`);
  await q.screenshot({ path: path.join(pub, `icon-${s}.png`), omitBackground: s !== 180 });
}
await b.close();
console.log('wrote public/og.png, public/icon-180.png, public/icon-512.png');

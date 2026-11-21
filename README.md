# Swapsteal

White elephant (Yankee swap) gift exchange on everyone's phone: the host shares one link, guests join with a nickname, the app draws the order, enforces steal limits and shows a live gift board. No account.
Live: https://pb-swap-steal.jan-bef.workers.dev · Product page: https://janwan2003.github.io/swap-steal/

- `public/`: static site, vanilla JS, no build step. `engine.js` is the pure game engine (shared with the Worker); `game.js` is the game page; `card.js` draws the recap PNG.
- `src/worker.js`: Cloudflare Worker. Each swap is one SQLite-backed Durable Object (`Game`) storing the game as one JSON value; live state is replayed from the move list, so undo drops the last move. Phones get updates over hibernating WebSockets (polling every 8 s as fallback). `Limiter` rate-limits creates/joins per IP. Swaps are deleted 60 days after creation.
- `docs/`: GitHub Pages product page and privacy policy. `tools/render-images.mjs` renders `og.png` and icons.
- Tests: `node --test tests/unit/*.test.js` (engine, incl. 300 random full games). End-to-end: `npx wrangler dev --port 8793 --ip 127.0.0.1`, then `BASE=http://127.0.0.1:8793 node tests/e2e/run.mjs` (real Chromium: desktop host + 4 phones, room and online games). Against production: `BASE=https://pb-swap-steal.jan-bef.workers.dev SHOTS=shots-prod node tests/e2e/run.mjs` (deletes its swaps at the end).
- Deploy: `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from the studio `.env`.

Third-party: `public/vendor/qrcode.js` (MIT, see `public/vendor/README.md`).

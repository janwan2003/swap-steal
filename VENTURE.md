---
slug: swap-steal
stage: launched
priority: 4
url: https://pb-swap-steal.jan-bef.workers.dev
repo: https://github.com/janwan2003/swap-steal
updated: 2026-11-22
---

# swap-steal

## Thesis

**Who:** Offices, remote teams, families and friend groups running a white elephant gift exchange
(also called Yankee swap, Dirty Santa, or *Schrottwichteln* in German). In this game everyone brings
one wrapped gift, players draw numbers, and on your turn you either open a new gift or steal one
already opened.

**What:** A no-login white-elephant game that runs on everyone's own phone. The host makes a game
and shares a link or QR code. Players join with a nickname. In-person mode: each player types a
one-line description of the gift they brought, which stays hidden until it is opened. The app draws
the turn order and buzzes "your turn", shows a live gift board of who holds what, and enforces the
rules (steal limits per gift, no immediate steal-back, a final round where the first player can
swap). Remote mode: each giver enters a gift and its link or a short description. The game runs on
a video call with the board on screen, and givers send gifts to whoever ends up with them. The game
ends with a recap card: who got what, the most-stolen gift, the longest steal chain.

**Needs others:** yes. The game is a group exchange; a gift swap with one person does not exist.

**Viral moment:** the recap card ("The heated blanket was stolen 3 times · Ola ended up with the
singing fish") posted in the office or family chat, and the drama of the live board on a TV. The
link preview shows "Round 7 of 14 · 5 steals so far". Every guest sees it working and gets "run your
own swap" at the end. That matters because people go to several parties each December (work,
friends, family).

**How often:** seasonal. December is the peak, with several parties per person in a few weeks.
There are smaller peaks at birthdays, New Year and office parties. That is weaker than weekly, which
is why this is priority 3.

**Why now:** People keep looking for a way to run it digitally. White Elephant Online reported
11,000 games and 146,000 gifts in its 2020 season and charges $99 per corporate game. The free tools
are single-host controllers: an iOS app last updated in 2022 and a browser page that one screen
runs. Neither puts the game on each guest's phone. Remote teams fall back to Miro templates and
Notion pages.

## Market evidence

Searches run 2026-11-20. Sources are search-result summaries, not opened pages.

- **Paid incumbent:** White Elephant Online reported "over 11,000 games" and "146,000 gifts" in the
  2020 holiday season ([PRWeb trend report](https://www.prweb.com/releases/white-elephant-online-presents-its-tis-the-season-gift-exchange-trend-report-802242556.html)).
  Personal use is free, corporate is $99 per game (2020 figures,
  [PR Newswire](https://www.prnewswire.com/news-releases/white-elephant-online-takes-the-popular-holiday-gift-swap-game-virtual-with-launch-of-new-platform-301172240.html)).
- **Free tools run from one screen:** [White Elephant Gift Exchange (iOS)](https://apps.apple.com/us/app/id1060318916)
  (up to 150 players, steal limits, player-order randomiser; last updated Dec 2022, and one reviewer
  says it "needs lots of work"); [VISU's browser tool](https://visu.network/tools/white-elephant-game/)
  (free, no sign-up, run from one screen by the host). No search result showed a tool where each
  guest plays on their own phone.
- **Remote fallbacks:** a [Miro gift-exchange template](https://miro.com/templates/virtual-gift-exchange/),
  a Notion template and a 2020 [Product Hunt launch](https://www.producthunt.com/products/virtual-white-elephant).
  Guides from [teambuilding.com](https://teambuilding.com/blog/virtual-white-elephant) and
  [BizBash](https://www.bizbash.com/virtual-events/how-to-organize-a-virtual-gift-exchange-for-remote-teams)
  explain how to run it by hand on a call.
- **Mainstream interest:** Google reported "white elephant gifts everyone will fight for" grew 75%+
  ([Think with Google](https://thinkwithgoogle.com/consumer-insights/consumer-trends/gift-searches)).
  Partiful publishes a hosting guide ([Partiful](https://partiful.com/blog/post/host-white-elephant-gift-exchange)),
  and Elfster has a [white elephant page](https://www.elfster.com/white-elephant/) (not checked
  whether it runs the steal game).
- **Not found:** absolute search volume for "white elephant" (searches returned no keyword data).

## Our edge

- **Loop: needs others.**
- **K estimate ≈ 1.3** = 14 players per game (an office or family party) × 85% who join (they are in
  the room, it is a QR scan) × 11% who run their own within the season (most people attend 2–3
  December parties, and one guest per party organising the next is enough). Reason: everyone sees it
  working, and the recap card spreads in office chats. The limit is the short season.
- **The game is on every guest's phone,** with live turn order and steal limits enforced. Today it is
  one host screen or one person with a notepad.
- **Free, no account, no per-game fee,** unlike the $99 corporate tier.
- **Works in the room and remotely,** with the same link.
- **Honest risks:** (1) Timing: December parties start in ~2 weeks, so it is only worth building if
  live by ~2026-12-08; otherwise park until autumn 2027. (2) Boundary with `secret-santa-draw`. That
  is a draw; this is a live steal game. It could ship as a mode of that venture, which the operator
  should decide. (3) Never handle money or gift purchasing (rule 4); gifts are descriptions only.

## Status

**Launched 2026-11-22 as "Swapsteal"** at https://pb-swap-steal.jan-bef.workers.dev (product page
https://janwan2003.github.io/swap-steal/, repo https://github.com/janwan2003/swap-steal). Built as a separate
venture: the operator has not answered the "mode of `secret-santa-draw`?" question, and the season window would not wait.

What exists (read from code):
- **Engine** `public/engine.js`: pure functions, replay of a move list (open / steal / swap / keep). Random turn
  order, steal chains, once-per-turn steal (no steal-back), freeze after N steals (1–5 or no limit), optional final
  swap for player 1, online mode never opens your own gift unless it is the last, recap stats (most stolen, longest
  chain, robbed most).
- **Backend** `src/worker.js`: Worker `pb-swap-steal` + SQLite Durable Objects (`Game` per swap, `Limiter` per IP:
  20 creates and 80 joins per hour, `Stats` daily aggregate counts). No D1, because the account is at its 10-database
  limit. Live updates use hibernating WebSockets (a 40-minute party costs a few dozen requests, not thousands of polls),
  with 8 s polling as fallback. Wrapped gifts' contents and givers are never sent to other players. Swaps are deleted
  60 days after creation, or at once by the host.
- **UI**: landing page with create form and SEO copy (rules, FAQ); game page with lobby (link, QR, share, players
  live, host adds people without a phone, rules), turn panel ("Your turn" + vibration, "X stole your gift"), gift board
  with steal dots and frozen gifts, turn order, feed, host undo / play for anyone, TV board (`?tv`, QR to watch, wake
  lock), recap with highlights, PNG recap card (share sheet or download), "Start a swap" CTA for guests.
  Link preview shows live state: "Join “Office swap” · 6 players so far" → "Office swap · Turn 3 of 6 · 1 steal so far"
  → "Office swap · Final haul" with the most-stolen gift.
- **Search Console**: site verified (META), sitemap submitted 2026-11-22 (`scripts/gsc.py`).

Verified (2026-11-22):
- `node --test tests/unit/*.test.js`: 12/12 pass, including 300 random full games that always end with one gift per player.
- `tests/e2e/run.mjs` in real Chromium (desktop host + 4 phones at 390 px + a 1920 px TV), green locally and in
  **2 consecutive runs against production**, with zero console errors. It covers create, join, duplicate name, an
  offline player, rule change, start, live turn updates without reload, open, steal, chain, no steal-back, freeze,
  undo, host playing for someone, final swap, recap on every phone, recap PNG, link preview text at each stage, an
  online game where hidden gifts don't leak to other players or spectators, delete, and no horizontal scroll on phone.
  Screenshots in `shots/`, `shots-prod/` (not committed).
- `tools/pages-check.mjs`: product page at 390/1280 px, no console errors, no broken links.
- Not verified: a real iPhone/Android, WhatsApp/iMessage in-app browsers, real chat-app link previews, vibration
  (it does not work on iOS Safari at all), and games above 7 players in a browser (the engine is tested to 13).

## Metrics

- 2026-11-22 (from `GET /api/stats`, aggregate daily counts; e2e traffic excluded by header): 0 swaps created,
  0 joins, 0 started. Launched today. Search Console: no data yet.

## Next steps

1. Operator check on a real phone (inbox entry 2026-11-22): WhatsApp preview, join and play in the in-app browser.
2. Distribution before ~8 December: an honest listing on AlternativeTo and Product Hunt (needs the operator's
   accounts, so it goes to the inbox), and check Search Console impressions for "white elephant game online" or
   "yankee swap app" in a week.
3. Quality: lobby on TV at 1080p screenshot; a German page (*Schrottwichteln*) for the DACH audience; a
   "who brought it?" picker for in-room gifts so the recap can show givers.
4. After the season (January): read `/api/stats`, decide whether to park until October 2027.

## Monetization plan

None until the operator enables it (charter rule 4). Later: company edition (branding, large games,
remote gift-shipping coordination), seasonal themes. Never paywall joining or playing.

## Log

- 2026-11-20 scout: created idea. Evidence from web searches (White Elephant Online press releases,
  iOS app listing, VISU tool, Miro/Product Hunt/teambuilding guides, Think with Google, Partiful).
  No absolute search volume found.
- 2026-11-21 review: raised p3→p4. White-elephant parties run through mid-December; ship within ~1 week or wait a year.
- 2026-11-22 builder: built and launched Swapsteal (engine + 12 unit tests, Worker/Durable Objects with WebSockets, landing, game, TV board, recap card, product page, Search Console verified + sitemap). Verified: unit tests green; Playwright e2e green locally and twice on production with 0 console errors; production run caught and fixed a reconnect-after-delete bug. Stats endpoint reads 0 real swaps.

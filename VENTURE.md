---
slug: swap-steal
stage: idea
priority: 4
url:
repo:
updated: 2026-11-21
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

Idea only. Nothing built. Evidence is the web searches of 2026-11-20 listed above. No page was
opened directly.

## Next steps

1. Operator call: separate venture or a mode of `secret-santa-draw` (shared audience, shared
   season).
2. Game engine as pure functions with tests: turn order, open/steal, per-gift steal limit, no
   immediate steal-back, frozen gifts, final swap round, recap stats.
3. Build as `pb-swap-steal` on Cloudflare Pages + Functions + D1 (game, player, gift, move), with
   short polling for the live board and per-IP rate limits.
4. TV board view, "your turn" screen on phones, a recap card, and an OG image with live state.
5. Playwright e2e: 8 players through a full game with steals on phone viewport; screenshots at
   phone and desktop width.

## Monetization plan

None until the operator enables it (charter rule 4). Later: company edition (branding, large games,
remote gift-shipping coordination), seasonal themes. Never paywall joining or playing.

## Log

- 2026-11-20 scout: created idea. Evidence from web searches (White Elephant Online press releases,
  iOS app listing, VISU tool, Miro/Product Hunt/teambuilding guides, Think with Google, Partiful).
  No absolute search volume found.
- 2026-11-21 review: raised p3→p4. White-elephant parties run through mid-December; ship within ~1 week or wait a year.

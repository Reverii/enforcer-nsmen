# Enforcer NSMEN: project summary

Telegram Mini App for planning NSmen flying duties and tracking SAF100s across five departments
(Pilot, Loadmaster, Tacco, Sup1, Sup2). Built 24–25 Nov 2026. Sibling of BDO Picker.

## Where everything lives

| What | Where |
|---|---|
| Mini App link to share | `t.me/Enforcer_NSMEN_bot/plan` |
| Bot | @Enforcer_NSMEN_bot (owned in @BotFather) |
| Page (GitHub Pages) | https://reverii.github.io/enforcer-nsmen/ |
| Demo with sample data | https://reverii.github.io/enforcer-nsmen/demo/ |
| Code | https://github.com/Reverii/enforcer-nsmen (public; no names, dates or secrets) |
| Server | Cloudflare Worker `enforcer-nsmen`: https://enforcer-nsmen.enforcer-nsmen.workers.dev |
| Database | Cloudflare D1 `enforcer-nsmen` (migrations 0001_init, 0002_admin applied) |
| Secrets (Cloudflare only) | `BOT_TOKEN`, `HIGHEST_ADMIN_TG_ID` |
| Settings in `worker/wrangler.toml` | `ALLOWED_ORIGIN`, `APP_URL`, D1 `database_id` |
| Design doc | `docs/superpowers/specs/2026-11-24-enforcer-nsmen-design.md` |
| Day-marker design (chosen: B + red Cancelled/Withdrawn) | `design/day-markers.html` |
| BotFather banner | `assets/enforcer-nsmen-banner.png` (640×360) |

## What it does

- **NSmen** join themselves (rank/name + one department), tap the days they can fly on **My days**
  (tap again to undo; "Mark all flight days" shortcut), confirm SAF100 received, and can cancel a
  SAF100 up to the day before.
- **Planners** (per department, added by Telegram ID, no need to join) post flight days with optional
  type/time, see Free / On the plan counts, open a day to plan several people at once, mark SAF100
  sent, withdraw it, manage NSmen and export a CSV.
- **Highest Admin** (one person, currently the owner) plans for every department, adds or removes any
  planner, sets their own rank and name, and can pass the role on in the Admin tab.
- **40-day cap:** at most 40 SAF100 days per NSman per work year (1 Apr – 31 Mar, by duty date);
  enforced in one database step so two planners can't exceed it.
- **Day markers:** Free (green), Planned (amber), Sent / Got it (blue), Cancelled / Withdrawn (red);
  plane = flight day; filled circle = today.
- **Bot messages** for planned, SAF100 sent/withdrawn, cancellations, new joiners and new planners.

## Updating it

1. Change the code, then run `npm test` (rules, Worker with local D1, page with Playwright).
2. Bump the `?v=` numbers in `index.html` and `demo/index.html` so phones load the new files.
3. `git push` (GitHub Pages updates the page in about a minute).
4. If anything in `worker/` changed: `npm run deploy`. If a new migration was added:
   `npx wrangler d1 migrations apply enforcer-nsmen --remote --config worker/wrangler.toml`.

Handover steps are in `HANDOVER.md`; setup from scratch is in `README.md`.

## Open items

- "Join as an NSman too" for planners or the Highest Admin who also fly is not built (they get no
  My days tab today).
- Changes since the deploy have been checked in tests and in iPhone/Android browser emulation, not
  yet on a real phone inside Telegram.
- Cloudflare and GitHub are on personal accounts; `HANDOVER.md` recommends moving to a unit account.

# Enforcer NSMEN: design

Status: agreed in conversation on 2026-11-24, not yet built. Marked **(builder's call)** where the
owner did not decide and the designer picked a default.

## Why

The unit plans flying duties for NSmen across several departments. Today availability, planning and
SAF100 tracking happen by back-and-forth messages. The goal is one Telegram Mini App where:

- each department's planner marks the flight days,
- each NSman marks the days they can fly,
- the planner picks who flies when,
- both sides can see the SAF100 status of every duty day,
- and the 40-day yearly SAF100 cap is enforced, so nobody is over-issued.

It is a sibling of **BDO Picker** (github.com/Reverii/BDO-Picker) and should feel the same to use. It
runs on Cloudflare instead of Google Sheets because Apps Script was too slow (1 to 3 s per tap).

## Departments

Fixed list: **Pilot, Loadmaster, Tacco, Sup1, Sup2.** Keep it in one config list so it's easy to change
later. (builder's call: a constant plus a `departments` table seeded by migration.)

- An NSman belongs to **exactly one** department.
- A planner plans for **one or more** departments. **(builder's call:** usually one.)
- **All five departments work the same way** (owner: standardise, no special department). Departments
  differ only in habit: some planners post next month's flights first (e.g. Loadmaster, Tacco, Sup1,
  Sup2), others let NSmen mark free days first and plan from that (e.g. Pilot). The same features cover
  both habits.

## What it does (owner's requirements)

1. **NSmen onboard themselves.** On first open they enter their display name (e.g. `3SG TAN K.L.`) and
   pick their one department. They join straight away. **(builder's call:** no approval step. That
   department's planners get a bot message, "New NSman joined Loadmaster: 3SG TAN K.L.", and can edit,
   move or remove them.)
2. **Department planners post flights** on their department's calendar (optional; a department may
   skip this). On a flight day the planner can optionally add **flight info: Type** and **Time**, both
   free text (e.g. `C-130`, `0800-1400`). Each department has its own flight days.
3. **NSmen mark availability, on any date** (owner: "can be both"). Their department's flight days are
   highlighted on their calendar with the flight info, so they can see which days are on offer.
   They may still mark other dates.
4. **The planner sees everyone's availability** in their department, flight days highlighted. They
   choose which NSman is **planned** on which date, but only on a date that NSman marked available.
   Planning on a date that isn't a flight day is allowed. **(builder's call)**
5. **SAF100 sent:** on a planned date, the planner marks the cell **SAF100 sent**.
6. **SAF100 received:** the NSman marks it **received**.
7. **One SAF100 = one day.** At most **40 SAF100 days per NSman per work year** (1 April to 31 March),
   per person.
8. **The planner can withdraw** a SAF100 (sent or received).
9. **The NSman can cancel** their SAF100 (sent or received).

## Cell states (one cell = one NSman x one date)

```
(none) -> available -> planned -> sent -> received
                                          |        |
                                          +-- withdrawn (by planner) --+
                                          +-- cancelled (by NSman) ----+--> day returned to the 40
```

- `available`: the NSman marked the date.
- `planned`: a planner of the NSman's department chose them. Only that department's planners can un-plan,
  send, or withdraw on that cell.
- `sent` / `received`: **count toward the 40.**
- `withdrawn` / `cancelled`: no longer count. The label stays visible, with the reason, so planners see
  the gap. Cancelling also clears the NSman's availability for that date. To be planned again, they
  re-mark it. **(builder's call)**

## Rules

- **The 40-day cap:** count the NSman's cells in `sent` or `received` whose **duty date** falls in the
  work year. The work year is set by the duty date, not by when the SAF100 was sent. If the count is
  already 40, the server refuses "sent" with a clear message. Planning past 40 is allowed, so the
  planner can see the clash. **(builder's call)**
- **Past dates are locked** for everyone, in Singapore time. **(builder's call:** cancel and withdraw are
  allowed up to the day before the duty.)
- **Un-marking availability:**
  - allowed on `available`;
  - on `planned`, it also un-plans the cell, and the department's planners are told;
  - on `sent` / `received`, the NSman must use Cancel instead. **(builder's call)**
- **Removing a flight day** that has planned or sent cells for that department asks the planner to
  confirm first. It does not touch the cells; it only removes the flight-day marking and its info.
  **(builder's call)**
- **Cancel reason:** optional, max 200 characters. It goes to the Log and into the planners' message.
- **Marking window:** NSmen can mark from today up to the end of the next work year.
- **Race safety:** every state change is a single conditional write (`UPDATE ... WHERE state = ?`) or a
  D1 batch:
  - two planners acting on the same cell at once can't both succeed;
  - the 40-cap check and the `sent` write happen in one statement or batch, so two planners can't both
    issue the 40th day.

## Roles

- **NSman:** anyone who has onboarded. Identified by Telegram user ID.
- **Highest Admin** (owner, 2026-11-24): exactly one person, set at setup by the Worker var
  `HIGHEST_ADMIN_TG_ID` (replaces `FIRST_PLANNER_TG_ID`) and stored in the database on first use, so
  later changes happen in the app. The Highest Admin:
  - has an **Admin** tab listing every department's planners;
  - **assigns planners by Telegram ID**: Telegram ID + display name + department(s). The person does
    NOT need to have joined as an NSman (a planner who never flies never appears in the NSmen grid);
  - removes any planner from any department (no "last planner" lock for the Highest Admin);
  - can plan in every department (acts as planner for all departments);
  - can **pass the Highest Admin role** to another Telegram ID, with an in-app confirm step; the new
    admin gets a bot message and the old one loses the role. The env var only seeds the first admin
    while no admin is stored.
- **Planner:** assigned per department. Any planner can add a planner **for the department(s) they
  plan, by Telegram ID + display name** (same form as the admin's, no NSman join needed), and can remove
  only themselves; the last planner of a department can't remove themselves (the Highest Admin can).
  Owner: SAF100 in the app is only a status, so planners adding planners is fine.
- **Telegram ID shown to everyone:** the joining screen and an "About me" line show
  "Your Telegram ID: 123456789" with a Copy button, so people can send it to the admin or a planner.
- A planner may also be an NSman, or not. A planner who is not an NSman sees only the Planner tab
  (plus Admin for the Highest Admin), never the joining screen.

## Screens

Mobile-first, inside Telegram, light and dark from Telegram's theme params. **Match BDO Picker's look and
structure** (its `index.html`, `app.css` and `app.js` are the reference).

- **Onboarding:** name field, one department (pick list), then Join.
- **My calendar (NSman):**
  - Month view, with arrows or swipe to change month.
  - My department's flight days are highlighted, with their flight info.
  - Each date shows my state: available (outlined), planned (solid, with the department), SAF100 sent
    (badge and a **Mark received** button), received (tick), withdrawn or cancelled (struck label).
  - Header: `SAF100 this work year: 23 of 40`.
  - Tapping a date opens a sheet with that day's flight info and the valid actions: Mark available,
    Remove, Mark received, Cancel SAF100.
- **Planner tab (planners only):**
  - Department switcher at the top, for planners of more than one department.
  - **Day counts:** under each date in the grid, two count rows: **Free** (marked available) and **On the
    plan** (planned, sent or received). No crew-size target per flight (owner dropped it).
  - **Who's-free sheet:** tapping a date header opens that day: its flight info, the people on the plan
    (with their state), the people available sorted by **fewest SAF100 days used first** (each with
    `n/40`, "new" for recent joiners, and "at 40, can't get SAF100" where it applies) with tick boxes
    and one **Plan selected** button that plans them all (one bot message each), anyone who cancelled or
    was withdrawn with the reason, and how many haven't marked the day. From the same sheet the planner
    posts the day as a flight day or edits its Type and Time.
  - **Grid:**
    - Rows are the department's NSmen and columns are the dates of the shown month.
    - The first column is sticky, with horizontal scroll on phones.
    - Flight-day columns are highlighted, with the flight info under the date.
    - Each row shows the person's `n/40` counter (amber from 35, red at 40).
  - Tap a cell to open a sheet with only the valid actions: Plan, Un-plan, SAF100 sent, Withdraw SAF100.
  - **NSmen** section: list, edit name, move to another department, remove.
  - **Planners** section: add yourself as a planner, or remove yourself.
  - **Export CSV** for a chosen work year: name, department, date, state, flight
    type and time, sent at, received at, ended at, ended by, reason.
- **Log:** stored and included in the export. An in-app Log view is optional. **(builder's call)**

## Bot messages (Telegram DMs)

- **To the NSman:**
  - planned (department, date, flight info), and un-planned;
  - SAF100 sent, with an "Open" button to the Mini App;
  - SAF100 withdrawn.
- **To that department's planners:**
  - a new NSman joined the department;
  - an NSman cancelled a SAF100 (with the reason);
  - an NSman removed availability on a planned date.
- **To a new planner:** "You're now a planner for Pilot".
- **To a new Highest Admin:** "You're now the Highest Admin of Enforcer NSMEN."
- **CSV export inside Telegram:** use `Telegram.WebApp.downloadFile` with a short-lived signed download
  URL from the Worker (blob downloads don't work in the phone WebView), and prefix any cell starting
  with `= + - @` with `'` so spreadsheets don't run it as a formula.
- **Failed messages:** if a DM fails (the user never pressed Start), write
  `message to X not delivered` to the Log. Sending must not block or fail the user's action
  (`ctx.waitUntil`).

## How it's built (decided)

- **Page:** static HTML/CSS/JS on **GitHub Pages**, no build step. A new public repo that holds no names
  or dates. `config.js` holds the Worker URL.
- **Backend:** one **Cloudflare Worker** (JavaScript or TypeScript) with a **D1** database, on the free
  tier.
- **Identity:** the Telegram Mini App `initData`, verified by the Worker on every request:
  - HMAC-SHA256 with the "WebAppData" key derived from the bot token;
  - reject it if `auth_date` is older than 24 h;
  - port the logic from BDO Picker's `apps-script/Auth.gs` to Web Crypto.
- **Secrets:** `BOT_TOKEN` is a Worker secret (`wrangler secret put`), never in the repo or the page.
- **CORS:** only the GitHub Pages origin is allowed (Worker var `ALLOWED_ORIGIN`).
- **Feels instant:**
  - one combined load call on open;
  - optimistic updates on every tap: if the server refuses, the cell reverts and a short error shows.
- **Data (suggested D1 tables):**
  - `nsmen` (id, name, dept, tg_id unique, tg_username, active, joined_at);
  - `planners` (tg_id, dept);
  - `flight_days` (dept, date, type, time; unique on dept + date);
  - `cells` (nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason;
    unique on nsman_id + date);
  - `log` (at, actor, action, detail).
  - Migrations run with `wrangler d1 migrations`.
- **Privacy:** store only the display name the NSman types, Telegram ID and username, department,
  dates, states and flight info.

## Not doing

- No Google Sheet.
- No group posting.
- No reminders or scheduled messages.
- No link to LODESTAR or SharePoint.
- No approval step for joining or for NSman cancellations.

## Deliverables

1. **The repo:** page, Worker, D1 migrations, and a `wrangler.toml` with placeholders (no real IDs or
   secrets).
2. **Tests:**
   - Rules: the state machine, the 40-cap, the work-year boundary (31 Mar / 1 Apr),
     the past-date lock, and planner rights per department.
   - Auth: valid, invalid and expired initData.
   - Worker endpoints against a local D1 (vitest with `@cloudflare/vitest-pool-workers`, or Miniflare).
   - The page, with Playwright against a fake API, like BDO Picker's `tests/`.
3. **`README.md`:** plain-language setup for a non-developer:
   1. BotFather bot and `/newapp`.
   2. Cloudflare account and `wrangler` login.
   3. Create D1 and run the migrations.
   4. Set the secrets and vars.
   5. Deploy.
   6. GitHub Pages.
   7. First planner.
4. **`HANDOVER.md`:** how to pass the app to the next person:
   - GitHub repo transfer;
   - add a member to the Cloudflare account;
   - transfer bot ownership in BotFather;
   - add a planner in the app;
   - and use a unit account rather than a personal one.

## Owner will do

Create the Cloudflare account and the bot, run the deploy steps from the README, and post the Mini App
link to the NSmen.

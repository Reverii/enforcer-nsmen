# Enforcer NSMEN

A Telegram Mini App for planning NSmen flying duties and tracking SAF100s across five departments
(**Pilot, Loadmaster, Tacco, Sup1, Sup2**).

Each department's planner can post flight days, see who is free, pick who flies, send and withdraw
SAF100s, and export a work-year CSV. Each NSman marks the days they can fly, confirms when they
receive their SAF100, and sees how many of their **40 SAF100 days per work year (1 April – 31 March)**
they have used.

**New to the app?** See [`QUICK-GUIDE.md`](QUICK-GUIDE.md) for a short guide for NSmen, planners and the
Highest Admin.

## How it works

- **First open (NSmen):** enter your rank and name and pick your one department. You join straight away
  and your department's planners get a Telegram message.
- **Marking availability (tap-to-mark):** tap any free date from today up to the end of the next work
  year to mark it available immediately (no pop-up), or tap it again to undo; changes save together in a
  batch after a short pause. Use **Mark all `<Dept>` flight days** to mark every remaining future flight
  day in the shown month at once. Your department's flight days have a plane icon in the top-right corner of
  the date and are listed below the calendar with their flight type and time (tapping a free flight row
  toggles it too). Planned, sent, and received dates open a details sheet to confirm receipt, come off the
  plan, or cancel an SAF100.
- **Broadcasting a month's flights (planners and Highest Admin):** after posting a month's flight days,
  tap **Planner > Flights > Broadcast `<Month>` flights**. The bot messages every NSman in that
  department with the month's upcoming flight days (date, type and time). Sending again is allowed; the
  app shows when it was last sent and by whom first.
- **Planning (planners and Highest Admin):** open the **Planner** tab. Tap any date header in the grid
  to see everyone who is free (sorted by fewest SAF100 days used first) and plan several people at once,
  or post/edit that day's flight details.
- **SAF100 tracking and the 40-day cap:**
  - `Available -> Planned -> SAF100 sent -> SAF100 received`
  - Only `SAF100 sent` and `SAF100 received` count toward the 40-day cap for that duty date's work year.
  - At 40 of 40, the server refuses to mark another SAF100 as sent.
  - **Withdraw** (by planner) or **Cancel** (by NSman) is allowed up to the day before the duty, records
    an optional reason, and returns the day to the 40-day cap.
- **Past dates** are locked for everyone (Singapore time).
- **Highest Admin (exactly one person):** acts as planner for all five departments, has an **Admin** tab
  to add or remove any department's planners (including removing the last planner of a department), and
  can pass on the Highest Admin role in-app during a handover.
- **Planners (assigned by Telegram ID, no NSman join needed):** any planner can add planners for the
  department(s) they plan by Telegram ID and rank/name, and can step down themselves (the last planner
  of a department cannot step down, though the Highest Admin can remove them). A planner or admin who
  does not fly as an NSman never sees the joining screen and goes straight to the **Planner** tab (and
  **Admin** tab for the Highest Admin).
- **Department isolation:** a regular planner can only plan, send, withdraw, edit flight days, manage
  NSmen, add planners, and export CSV for the department(s) they plan.

Where things live:

| Part | Where |
|---|---|
| The page people see | GitHub Pages (this repo: `index.html`, `app.css`, `app.js`, `config.js`) |
| The server | Cloudflare Workers (`worker/src/`) on the free tier |
| The database | Cloudflare D1 (`worker/migrations/`) on the free tier |
| Who's who | Telegram: the Mini App link signs your Telegram ID on every request |

This repo is public and holds **no names, no dates, and no secrets**. All people, duties, and the bot
token stay inside your Cloudflare account.

## Setting it up (about 30 minutes, once)

> **Tip:** use a **unit account** (shared email for GitHub and Cloudflare) rather than a personal
> account so handing over later is painless. See [`HANDOVER.md`](HANDOVER.md).

You need [Node.js 22+](https://nodejs.org/) installed on your computer to run the Cloudflare setup
commands once.

### 1. Make the Telegram bot

1. In Telegram, open **@BotFather** (blue tick) and send `/newbot`.
2. Give it a display name (e.g. `Enforcer NSMEN`) and a username ending in `bot`
   (e.g. `sqn_nsmen_bot`).
3. BotFather sends you a **bot token** like `123456:ABC-...`. Keep it secret — never paste it into
   GitHub or any chat. You will enter it privately into Cloudflare in step 4.
4. Find your own Telegram numeric user ID (for the Highest Admin): message **@userinfobot** (or
   **@raw_data_bot**) and note the digits next to `Id` (e.g. `123456789`).

### 2. Create a Cloudflare account and log in

1. Sign up for a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Download or clone this repo to your computer, open a terminal in the repo folder, and run:

   ```bash
   npm install
   npx wrangler login
   ```

3. Your browser opens — approve Wrangler to connect to your Cloudflare account.

### 3. Create the D1 database and run migrations

1. Create the database:

   ```bash
   npx wrangler d1 create enforcer-nsmen
   ```

2. Copy the `database_id` printed in the terminal.
3. Open [`worker/wrangler.toml`](worker/wrangler.toml) and replace
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that ID.
4. Create the tables in the remote database (runs both `0001_init.sql` and `0002_admin.sql`):

   ```bash
   npx wrangler d1 migrations apply enforcer-nsmen --remote --config worker/wrangler.toml
   ```

### 4. Set the secret and Worker variables

1. Store your Telegram bot token as a Cloudflare secret (paste it when prompted):

   ```bash
   npx wrangler secret put BOT_TOKEN --config worker/wrangler.toml
   ```

2. Store the Highest Admin's Telegram user ID (from step 1.4) as a secret too, so it stays out of
   this public repo:

   ```bash
   npx wrangler secret put HIGHEST_ADMIN_TG_ID --config worker/wrangler.toml
   ```

   The first time that Telegram ID opens the app (while no admin is stored in D1), it is saved in the
   database as the Highest Admin. After that, the database is the source of truth: later handovers
   happen inside the **Admin** tab.
3. Open [`worker/wrangler.toml`](worker/wrangler.toml) and fill in the two values under `[vars]`:
   - `ALLOWED_ORIGIN`: your GitHub Pages origin **without a trailing slash**, e.g.
     `https://yourunit.github.io`
   - `APP_URL`: your full Mini App page URL, e.g.
     `https://yourunit.github.io/enforcer-nsmen/`

### 5. Deploy the Worker

```bash
npm run deploy
```

Wrangler prints your live Worker URL, e.g. `https://enforcer-nsmen.youraccount.workers.dev`.
Open it in a browser — you should see `{"ok":true,"service":"enforcer-nsmen"}`.

### 6. Put the Worker URL in `config.js` and turn on GitHub Pages

1. Open [`config.js`](config.js), replace `https://REPLACE_WITH_YOUR_WORKER_URL.workers.dev` with your
   Worker URL from step 5 (no trailing slash, keep the quotes), and commit + push to `main` on GitHub.
   *(Do **not** commit any secrets — `BOT_TOKEN` lives only in Cloudflare.)*
2. On GitHub, go to **Settings > Pages**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`, folder **/ (root)**
   - Press **Save**.
3. Wait a minute or two, then visit your GitHub Pages URL (e.g.
   `https://yourunit.github.io/enforcer-nsmen/`). In a normal browser it should say
   `Open Enforcer NSMEN from the Telegram link.` That is expected.

### 7. Connect the Mini App in BotFather

1. In **@BotFather**, send `/newapp` and pick your bot.
2. Enter a title (e.g. `Enforcer NSMEN`), a short description, and a 640×360 banner image. Send `/empty`
   when asked for a GIF.
3. For the **Web App URL**, paste your GitHub Pages URL from step 6
   (e.g. `https://yourunit.github.io/enforcer-nsmen/`).
4. Choose a short name, e.g. `plan`. BotFather gives you the shareable link:
   `t.me/<your_bot_username>/plan`.
5. Optional: send `/setmenubutton` to BotFather, choose your bot, paste the same URL, and name the
   button `Open Enforcer NSMEN` so it also appears inside the bot chat.

### 8. Open as Highest Admin, add department planners, and share the link

1. Open your bot chat in Telegram and press **Start** so the bot is allowed to DM you.
2. Tap your `t.me/.../plan` link. Because your Telegram ID matches `HIGHEST_ADMIN_TG_ID`, you are stored
   as the **Highest Admin** and go straight to the **Planner** and **Admin** tabs (no joining screen).
3. Share the `t.me/.../plan` link with your department planners and NSmen. Remind everyone to press
   **Start** in the bot chat so they receive Telegram DMs.

#### Adding a planner who doesn't fly (no NSman join needed)

1. The planner opens the `t.me/.../plan` link once (they do **not** fill in the Join form).
2. At the bottom of the joining screen under **Your Telegram ID**, they tap **Copy** and send that
   number to the Highest Admin or an existing planner for their department.
3. The Highest Admin opens **Admin > Add a planner** (or a department planner opens
   **Planner > NSmen > Add a `<Dept>` planner**), enters their Telegram ID, rank/name, and department,
   and taps **Add planner**.
4. The new planner gets a bot message (`You're now a planner for <Dept>.`). Next time they open the app,
   they go straight to the **Planner** tab and never appear in the NSmen roster.

*(Anyone who already joined as an NSman can also find and copy their Telegram ID from the **About me**
line at the bottom of **My days** or the **Planner** tab.)*

## Looking after it

- **Someone didn't get a bot message:** the exported CSV log shows `message to <name> not delivered`.
  Ask them to open the bot chat once and press **Start**.
- **Changing an NSman's name or department, or removing them:** open **Planner > NSmen** and tap their
  name.
- **Exporting records:** open **Planner > NSmen > Export CSV**, choose the work year, and tap
  **Export CSV**. Inside Telegram this downloads via a short-lived signed link (5-minute expiry); the
  file includes all duties for that work year plus the audit log, with spreadsheet formula protection.
- **Updating the page after code changes:** bump the `?v=` number on `app.css`, `app.js` and `config.js` in
  `index.html` (and in `demo/index.html`) so phones load the new files instead of an old saved copy.
- **Updating the Worker after code changes:** run `npm run deploy` (and if new migrations were added,
  run `npx wrangler d1 migrations apply enforcer-nsmen --remote --config worker/wrangler.toml`).

## For developers

No frontend build step. Requires Node 24+ (or Node 22+):

```bash
npm run test:rules   # Rules + Telegram initData & export token auth tests (node --test)
npm run test:worker  # Worker + local D1 tests (node --test + Miniflare)
npm run test:page    # Static page UI tests (Playwright against fake API)
npm test             # Run all suites
npm run dev          # Local Cloudflare Worker dev server
```

- `index.html`, `app.css`, `app.js`, `config.js`: static Telegram Mini App client.
- `worker/src/rules.js`: pure domain rules (state machine, 40-day cap, work year, locks, admin/planner rules, CSV builder).
- `worker/src/auth.js`: Web Crypto HMAC-SHA256 verification of Telegram `initData` and short-lived CSV export tokens.
- `worker/src/db.js`: D1 queries and atomic conditional SQL writes.
- `worker/src/telegram.js`: background Telegram DM delivery (`ctx.waitUntil`) with failure logging.
- `worker/src/index.js`: Worker router, CORS, and JSON/CSV endpoints.
- `worker/migrations/0001_init.sql`, `worker/migrations/0002_admin.sql`: D1 schema, department seed, Highest Admin table, and planner names.

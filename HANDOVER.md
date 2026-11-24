# Handing Over Enforcer NSMEN

Use this checklist when passing Enforcer NSMEN to the next IC / Highest Admin so nothing breaks
when you post out.

> **Use a unit account, not a personal one.**
> If possible, keep the GitHub repository (e.g. a unit GitHub Organisation) and the Cloudflare account
> under a shared unit email address rather than a personal Gmail/GitHub login. That way, future
> handovers only require updating passwords/2FA and passing on Highest Admin in the app instead of
> transferring ownership of every service.

## 1. Pass on Highest Admin inside the app

Do this **first**, while you still have the **Admin** tab.

1. Ask the incoming Highest Admin to open the bot chat and press **Start** (so the bot can DM them),
   then open the Mini App link (`t.me/<your_bot>/<app>`).
   - They do **not** need to join as an NSman.
   - They can tap **Copy** next to **Your Telegram ID** on the joining screen (or in the **About me**
     line if they already joined) and send you their numeric Telegram ID.
2. In the app, open the **Admin** tab and scroll to **Pass on Highest Admin**.
3. Enter the incoming person's **Telegram ID** and **Rank and name**, tap **Pass on Highest Admin**,
   review the confirmation warning, and tap **Pass on Highest Admin** a second time to confirm.
4. The incoming person receives a bot DM (`You're now the Highest Admin of Enforcer NSMEN.`) and now
   controls the **Admin** tab and planning for all five departments. You immediately lose the Highest
   Admin role (even if your old Telegram ID is still in `HIGHEST_ADMIN_TG_ID` in `worker/wrangler.toml`,
   the stored database value wins).
5. *(Optional)* If you are also stepping down as a department planner, the new Highest Admin can remove
   you from any department in the **Admin** tab, or you can tap **Step down** in
   **Planner > NSmen > `<Dept>` planners** once another planner is assigned.

## 2. Hand over the GitHub repository (the Mini App page)

Choose whichever matches your setup:

- **Transfer ownership (personal account -> next person or unit org):**
  1. On GitHub, open the repo's **Settings > General**, scroll to **Danger Zone**, and click
     **Transfer**.
  2. Enter the repo name and the incoming owner's GitHub username (or your unit's GitHub Organisation).
  3. The incoming owner accepts the transfer email.
  4. **Important:** if the GitHub username/org in the GitHub Pages URL changed (e.g. from
     `https://olduser.github.io/enforcer-nsmen/` to `https://neworg.github.io/enforcer-nsmen/`):
     - Re-enable **Settings > Pages** on the new repo if needed.
     - Update `ALLOWED_ORIGIN` and `APP_URL` in [`worker/wrangler.toml`](worker/wrangler.toml) and run
       `npm run deploy`.
     - Update the Web App URL in **@BotFather** (`/mybots` > pick bot > **Bot Settings > Menu Button**
       and `/myapps` > pick app > **Edit Web App URL**).
- **Or keep it in a unit GitHub Organisation:** add the incoming person as an Owner/Maintainer under
  **Settings > Collaborators and teams** and remove your own account when done. No URLs change.

## 3. Add the incoming person to the Cloudflare account (Worker + D1 database)

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Manage Account > Members > Invite**.
3. Enter the incoming person's email address (or unit email) and assign the **Administrator** (or
   **Super Administrator**) role so they can view D1 data, rotate `BOT_TOKEN`, and deploy Worker
   updates.
4. Have them accept the invite, log in to Cloudflare, and test running `npx wrangler login` and
   `npx wrangler d1 info enforcer-nsmen` from their machine.
5. Note: `BOT_TOKEN` is stored as an encrypted Cloudflare secret and does not need to be re-entered
   unless you rotate the bot token. `HIGHEST_ADMIN_TG_ID` in `worker/wrangler.toml` is only a first-run
   seed and does not need to be changed after handover (though updating it to match the new admin is
   harmless).

## 4. Transfer the Telegram bot in @BotFather

Telegram allows transferring bot ownership directly without changing the bot's username, link, or
existing user chats:

1. Prerequisite: you must have **Two-Step Verification (2FA)** enabled in Telegram for at least 7 days,
   and the recipient must have opened the bot chat and sent `/start` at least once.
2. In Telegram, open **@BotFather** and send `/mybots`.
3. Select your bot > **Transfer Ownership** > **Choose recipient**.
4. Pick the incoming owner and confirm with your Telegram 2FA password.
5. After transfer, the Mini App link (`t.me/<bot>/<app>`) and `BOT_TOKEN` keep working without
   interruption. *(If the new owner ever revokes/regenerates the token in BotFather, they must run
   `npx wrangler secret put BOT_TOKEN --config worker/wrangler.toml` to update Cloudflare.)*

## 5. Final handover check

Ask the incoming owner to verify all four items before you step off Cloudflare/GitHub:

- [ ] They can open the Mini App from Telegram and see both the **Admin** tab and the **Planner** tab
      for all five departments.
- [ ] They can download a CSV export (**Planner > NSmen > Export CSV**) for the current work year.
- [ ] They can see the `enforcer-nsmen` Worker and D1 database in Cloudflare Dashboard.
- [ ] They own the bot under `/mybots` in **@BotFather** and have admin access to the GitHub repo.

# Enforcer NSMEN: quick guide

Open the app from the Telegram link: **`t.me/Enforcer_NSMEN_bot/plan`**.

First, open the bot chat (**@Enforcer_NSMEN_bot**) and press **Start**. If you skip this, the bot can't
message you when you're planned or your SAF100 is sent.

## How it works

1. **The planner posts flight days**, then broadcasts the month. You get a bot message listing the
   dates, and they show a plane icon on your calendar.
2. **You pick the days you can fly.** Tap a flight day to pick it, or tap any other day you're free.
3. **The planner plans people** from those who picked the day.
4. **The planner sends your SAF100.** You confirm when you've received it.

Each NSman can get **at most 40 SAF100 days per work year (1 Apr – 31 Mar)**. Past dates are locked for
everyone.

## Colours on the calendar

| Looks like | Word | Means |
|---|---|---|
| Solid green, plane icon | **Select** | You picked this flight day |
| Pale green | **Free** | You're free on this day (no flight posted) |
| Amber | **Planned** | The planner has put you on the plan |
| Solid blue | **Sent** / **Got it** | SAF100 sent to you / you confirmed you received it |
| Red | **Cancelled** / **Withdrawn** | You cancelled the SAF100 / the planner withdrew it |
| Plane icon, no colour | – | Your department is flying; you haven't picked it yet |
| Filled black circle | – | Today |

## For NSmen

**Joining (once):** enter your rank and name, pick your department, and tap **Join**.

**My days:**

- **Tap a day** to mark it. Tap again to undo. Changes save on their own after a moment.
- **Mark all `<Dept>` flight days** picks every remaining flight day in the month on screen.
- The list under the calendar shows this month's flights with their type and time. Tapping a row works
  the same as tapping the day.
- The bar at the top shows how many of your 40 SAF100 days you've used this work year.

**When you're planned or sent a SAF100**, tap the day to open its details:

- **I've received my SAF100**: confirm once the SAF100 reaches you. A reminder also appears at the top
  of My days.
- **Cancel SAF100**: allowed up to the day before. You can add a reason. The day goes back to your 40.
- **Remove and come off the plan**: if you're planned but can no longer make it. Your planner is told.

## For planners

You're added by Telegram ID, so you don't need to join as an NSman. To get added, open the app once,
tap **Copy** next to **Your Telegram ID**, and send the number to the Highest Admin or a planner in your
department.

The **Planner** tab has three views:

- **Plan**: a grid of your NSmen against the month's dates.
  - **Tap a date at the top** to see everyone free that day (fewest SAF100 days used first). Tick
    several, then tap **Plan selected**. Here you can also **Post as flight day** or
    **Edit flight details**.
  - **Tap a person's cell** to plan, **Un-plan**, mark **SAF100 sent**, or **Withdraw SAF100** (up to
    the day before, with an optional reason).
- **Flights**: your flight days for the month. Tap **Post a flight day** to add one; type and time are
  optional.
  - Once the month's flights are in, tap **Broadcast `<Month>` flights**. The bot messages every NSman
    in your department with the list of upcoming flight days and a button to open the app.
  - You can broadcast again after changes. The app warns you first and shows when it was last sent
    and by whom.
- **NSmen**: your department's roster.
  - Tap a name to edit their rank, name or department, or remove them.
  - **Add a `<Dept>` planner**: add another planner by Telegram ID and rank/name.
  - **Step down**: stop being a planner (not if you're the last one).
  - **Export CSV**: pick a work year to download every duty and the change log.

At 40 of 40, the app won't let you mark another SAF100 as sent for that NSman until 1 April.

## For the Highest Admin

You plan for all five departments and also have the **Admin** tab:

- **Your rank and name**: shown on the Planner tab.
- **Add a planner** / **Remove**: manage planners for any department.
- **Pass on Highest Admin**: hand the role to someone else by Telegram ID (see `HANDOVER.md`).

## If something's wrong

- **Didn't get a bot message?** Open the bot chat and press **Start**.
- **Can't tap a day?** It's in the past, or already on the plan (tap it for details).
- **App looks out of date?** Close it fully and reopen it from the Telegram link.
- **Want to try it without real data?** Use the demo: https://reverii.github.io/enforcer-nsmen/demo/

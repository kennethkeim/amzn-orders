# What is this?

- Node app to scrape (your own) Amazon order data and sync to DB (is automated and should be run on cron schedule)
- ~~Next.js app to view order data.~~

# Why would anyone use this?

If you want easier correlation for bank/credit card transactions > the item you purchased.

Problem: When looking at Amazon charges in my budgeting app, it's hard to find which order and item the charge is related to.

- Amazon mobile app does not show prices in list view, so I have to view each order detail
- Desktop web app shows prices in list BUT sometimes there are multiple charges for a single order and then I have to click the invoice on all recent orders to find the list of credit card transactions for the order
- I can't view my wife's and my own orders at the same time since we have separate accounts

If you just want a year end report and don't need automation, look for a browser extension or check out [this reddit thread](https://www.reddit.com/r/amazonprime/comments/18xpnk9/amazon_order_history_report_csv_export/).

# How to use it

Clone and self host.

# Getting started

1. Clone it
2. Copy `.env.example` -> `.env` and add your credentials
3. Run `pnpm dbpush` to push your schema to tursodb
4. Set up a cron job to run at your desired schedule (see below)
5. Deploy the Next.js app

# Running the cron job

There's may be a better way, but I'm not sure what it is. Here's what I did on my old mac that I no longer use. I needed it to run in the foreground because Amazon seems to detect a bot if it runs in headless mode.

Download and purchase [Lingon X 9](https://www.peterborgapps.com/lingon/)

Set up a new Lingon job with the desired schedule and put the following in the run command input in Lingon.\
This uses the built-in macOs Automator to tell terminal to run your command.

```bash
/usr/bin/osascript -e 'tell application "Terminal" to do script "cd /Users/{USER}/path/to/repo && pnpm run download" in window 1'
```

Now the job should run in the existing terminal window each time, and the browser should open and go through the steps. If the terminal window doesn't appear in the foreground just open a window manually and then re-run and it should use that window.

# Displaying the orders

Displaying orders is up to you, but it should be easy to do in your favorite framework once the orders are in the DB. I integrated it into an existing app I built for myself.

# Design

Using [codebase first DB management](https://orm.drizzle.team/docs/migrations) via Drizzle ORM

# Will Amazon block my account for using a bot login?

Hope not. YOLO.

Also, this uses persistent browser context, so you only have to login once in a blue moon. Occasionally you might need to enter MFA.

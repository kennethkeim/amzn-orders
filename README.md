# What is this?

- Node app to scrape (your own) Amazon order data and sync to DB (is mostly automated and should be run on cron schedule)
- Next.js app to view order data

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
4. Set up a cron job to run at your desired schedule (I'm using an old linux box instead of paying for a container)
5. Deploy the Next.js app

# Design

Using [codebase first DB management](https://orm.drizzle.team/docs/migrations) via Drizzle ORM

# Will Amazon block my account for using a bot login?

Hope not. YOLO.

Also, this uses persistent browser context, so you only have to login once in a blue moon. Occasionally you might need to enter MFA.

# @jaredartt — growth tracker

A self-hosted replacement for Instagram analytics subscriptions. It reads your own
account through Meta's official API, stores every reading in plain CSV files in this
repository, and draws a dashboard from them.

**Setup instructions: [SETUP.md](SETUP.md)**

## Why it exists

Instagram keeps roughly 90 days of insights and then deletes them. Paid analytics
tools are, at heart, charging a monthly fee to write those numbers down before they
vanish. This writes them down instead — into files you own — and adds one thing the
paid tools don't have: an hourly follower reading, which is the only way to see
*what time of day* you actually grow.

## Layout

```
index.html          the dashboard — open it, that's all it is
scripts/
  snapshot.mjs      hourly: live follower / following / post counts
  insights.mjs      daily: reach, views, profile views, follows, unfollows
  media.mjs         daily: post history and per-post performance
  backfill.mjs      one-off: pull the 90 days Meta still remembers
  refresh-token.mjs weekly: renew the access token before it expires
  lib.mjs           API client and CSV helpers
data/
  followers.csv     one row per hour, forever
  insights.csv      one row per day
  media.json        every post, with its numbers
.github/workflows/  the three scheduled jobs
```

No dependencies, no build step, no framework. Node 20+ and a browser.

## Running it by hand

```bash
export IG_TOKEN="your-token"
node scripts/snapshot.mjs      # one follower reading
node scripts/insights.mjs      # yesterday's insights
node scripts/backfill.mjs 89   # the last 89 days
node scripts/media.mjs         # posts
npx serve                      # then open the printed address
```

## What it can't do

No tool can show you **who** unfollowed you. Meta doesn't expose that to anyone, at
any price. Anything advertising it is scraping Instagram with your password, which
is both against the terms of use and a good way to lose the account.

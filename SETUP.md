# How this runs

Setup is done. This is the reference for when something needs attention.

**Dashboard:** https://jaredartt.github.io/jaredartt-tracker/
**Baseline:** 6,128 followers on 31 August 2026, when tracking began.

---

## The three jobs

| Job | When | What it does |
|---|---|---|
| `hourly.yml` | every hour | Records the live follower count. This is what powers the hour-of-day panel — Instagram itself only reports followers once a day, so this hourly reading is data that exists nowhere else. |
| `daily.yml` | 03:30 UTC | Yesterday's reach, views, profile views, follows, unfollows, and post performance. |
| `token.yml` | Mondays | Renews the Instagram access token and writes it back into the `IG_TOKEN` secret. |

All three appear under the repo's **Actions** tab, and any of them can be run by hand from there.

## The two secrets

- **`IG_TOKEN`** — the Instagram access token. Lasts 60 days; `token.yml` renews it weekly, so it should never expire on its own.
- **`GH_PAT`** — a fine-grained GitHub token whose only power is writing secrets on this one repository. It exists solely so `token.yml` can save the renewed Instagram token. Set it to never expire; if you ever regenerate it, update the secret.

## The data

| File | What's in it |
|---|---|
| `data/followers.csv` | One row per hour: followers, following, post count. |
| `data/insights.csv` | One row per day: reach, views, profile views, follows, unfollows, engagement. |
| `data/media.json` | Every post with its reach, likes, comments, saves and shares. |
| `data/metrics.json` | Which metric names this account's API accepts. Learned automatically. |

Plain text, one row per reading. They'll open in Excel or Numbers and still open in ten years. That's the point — the history is yours, in files you control, not inside a subscription that stops when you stop paying.

Instagram deletes insights after about 90 days. Everything past that window exists only because this wrote it down.

---

## Reading the dashboard honestly

- **The dashed part of the growth curve is reconstructed**, not measured. It works today's follower count backwards through Instagram's daily follow and unfollow figures. It's good, but it's arithmetic, not observation. Everything from 31 August onward is measured hourly.
- **"When you gain followers" needs about two weeks** of hourly readings before the pattern means anything. It'll look empty until then. That's expected, not broken.
- **Nothing can tell you *who* unfollowed you.** Meta doesn't expose that to anyone at any price. Any tool claiming it is scraping Instagram with your password, which breaks the terms of use and risks the account.

## When something breaks

Failures show up as a red run in the **Actions** tab. Open it and read the log — the scripts are written to explain themselves in plain English.

- **`Instagram API 190`** — the token expired or was revoked. Check whether `token.yml` has been failing; that's the usual root cause. Regenerating the token means redoing the Meta console steps and updating the `IG_TOKEN` secret.
- **`Rate limit reached`** in a backfill — Instagram allows 200 calls an hour. The job stops cleanly and loses nothing; run it again an hour later and it resumes exactly where it stopped.
- **A metric logs "unavailable"** — Meta retired or renamed it. That column goes blank; everything else keeps recording. The name is remembered in `data/metrics.json` so it isn't asked for again.
- **Nothing runs at all** — GitHub pauses scheduled workflows on repositories with no activity for 60 days. Any commit wakes them up. Since this commits data hourly, it shouldn't happen.
- **An hour is missing** — GitHub's scheduler is best-effort under load. The dashboard skips gaps; nothing is corrupted.

## Re-fetching history after a fix

If a metric was being collected wrongly and you want to correct the historical record: run **Daily insights** by hand, tick **backfill**, and set **refill_column** to a column name that doesn't exist (e.g. `refetch`). That marks every day as incomplete and re-pulls all 89 days. Set it to a specific column like `follows` to refill only days missing that one.

## Privacy

The repository is public, so the follower history, reach and profile-view numbers are visible to anyone with the URL. The tokens are not — GitHub secrets are never exposed, including to pull requests from strangers.

To make it private, the dashboard needs different hosting (GitHub Pages requires a public repo on the free tier). Cloudflare Pages will build from a private repo for free and can be locked to your email; the data and workflows wouldn't change.

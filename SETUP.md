# Setting this up

About 25 minutes, once. After that it runs on its own and you never touch it again.

Nothing here costs money. There is no server to maintain — GitHub runs the hourly
job for free on public repositories and on private ones within a generous monthly
allowance that this uses a small fraction of.

---

## Part 1 — Get a token from Meta (~15 min)

The token is what lets the tracker read your own account's numbers. It belongs to
you, it only works for @jaredartt, and it lives in an encrypted GitHub secret.

**1. Confirm the account is professional.**
Instagram app → your profile → hamburger menu → *Settings and privacy* → *Account
type and tools*. It should say Creator or Business. If it offers "Switch to
professional account", do that first — pick Creator.

**2. Create a Meta app.**
Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and log
in with the Facebook account tied to you (if you've never used this, it'll ask you
to register as a developer — accept, it's free and instant).

Click **Create app**. When asked what you're building, the path you want leads to a
**Business** app type. Name it anything — `jaredartt tracker` is fine. Meta reshuffles
this wizard often; the thing to steer toward is a Business app with the **Instagram**
product available.

**3. Add the Instagram product.**
In the app dashboard's left sidebar, find **Instagram** and open it. Choose the
setup path called **API setup with Instagram business login** (wording varies —
it's the option that does *not* require a Facebook Page).

**4. Connect the account and generate the token.**
In that panel there's a step to add your Instagram account and then a
**Generate token** button. Click it, log in as @jaredartt, and approve the
permissions it asks for — they should include `instagram_business_basic` and
`instagram_business_manage_insights`.

**5. Copy the token.** It's a long string starting with `IG`. Copy it somewhere
safe for the next ten minutes. It's valid for 60 days; the tracker renews it
automatically from then on.

> **If the console has been redesigned and the steps don't match** — that happens
> roughly once a year — tell me what you're looking at and I'll navigate it with you
> rather than guessing.

---

## Part 2 — Set up the repository (~10 min)

**6. Create the repo.**
On GitHub: **New repository** → name it `jaredartt-tracker` → **Public** →
Create. Then upload the contents of this folder (drag the whole set of files onto
the "uploading an existing file" link), or if you use the command line:

```bash
git init && git add . && git commit -m "tracker"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/jaredartt-tracker.git
git push -u origin main
```

**7. Add the token as a secret.**
Repo → **Settings** → *Secrets and variables* → **Actions** → **New repository
secret**.
Name: `IG_TOKEN` · Value: the token from step 5. Save.

**8. Turn on Actions and give them write access.**
Repo → **Actions** tab → enable workflows if prompted.
Then **Settings** → *Actions* → *General* → scroll to **Workflow permissions** →
select **Read and write permissions** → Save. Without this the jobs can fetch your
data but can't commit it.

**9. Add the token-renewal secret.** *(Skip and the tracker dies in 60 days.)*
Create a fine-grained personal access token:
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
→ repository access: **only** `jaredartt-tracker` → under *Repository permissions*
set **Secrets: Read and write** → generate → copy it.
Back in the repo, add it as a second secret named `GH_PAT`.

**10. First run.**
Actions tab → **Daily insights** → *Run workflow* → tick **backfill** → run.
This pulls the last 90 days that Instagram still remembers. Then run
**Hourly snapshot** once by hand so there's an immediate follower reading.

Check `data/` in the repo — you should see `followers.csv`, `insights.csv` and
`media.json` filling up.

---

## Part 3 — Put it on the web (~2 min)

**11. Turn on Pages.**
Repo → **Settings** → **Pages** → under *Build and deployment*, set Source to
**Deploy from a branch**, branch **main**, folder **/ (root)** → Save.

Give it a minute or two, then your dashboard is live at:

```
https://YOUR-USERNAME.github.io/jaredartt-tracker/
```

Open that on your phone and add it to the home screen — it behaves like an app, and
it follows your phone's light/dark setting automatically.

### What "public" means here, precisely

The repository is public, so anyone who finds the URL can see your follower history,
reach and profile views. Your follower count is already public on your profile; reach
and profile views are not, so this is a real (if small) disclosure. Worth knowing:

- **Your access token is safe.** It lives in an encrypted GitHub secret, never in the
  repository. Public repos don't expose secrets, and pull requests from strangers
  can't read them either.
- **Nobody can post as you.** The token is read-only for insights.
- **The URL is not indexed** unless something links to it, but treat it as findable
  rather than hidden.

If you later want it private, tell me — moving to Cloudflare Pages with access
control takes about five minutes and doesn't disturb any of the collected data.

---

## What runs, and when

| Job | Schedule | What it does |
|---|---|---|
| `hourly.yml` | every hour | Records the live follower count. This is what powers the hour-of-day panel. |
| `daily.yml` | 03:30 UTC | Yesterday's reach, views, profile views, follows and unfollows, plus post performance. |
| `token.yml` | Mondays | Renews the Instagram token and writes it back to the secret. |

## When something breaks

Almost everything shows up in the **Actions** tab as a red run. Click it, read the
log — the scripts are written to say what went wrong in plain English.

- **`Instagram API 190`** — the token expired or was revoked. Redo steps 4–7. If
  this happened, check whether `token.yml` has been failing.
- **A metric logs "unavailable"** — Meta retired or renamed it, or your account
  doesn't qualify (a few need 100+ followers). Everything else keeps recording; that
  one column just goes blank.
- **Nothing runs at all** — GitHub pauses scheduled workflows on repositories with
  no activity for 60 days. Any commit wakes them up.
- **Hourly job occasionally late** — GitHub's scheduler is best-effort under load.
  A missed hour leaves a gap the dashboard skips over; it doesn't corrupt anything.

## Your data

`data/followers.csv` and `data/insights.csv` are plain text with one row per
reading. They'll open in Excel or Numbers, and they'll still open in ten years.
That's the whole point: the history is yours, sitting in a file you control, not
inside a subscription that stops when you stop paying.

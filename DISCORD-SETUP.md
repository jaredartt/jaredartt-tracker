# Connecting Artist Academy

About 15 minutes, once. Easier than the Instagram side — no review, no verification.

You need to be the server **owner** or have **Manage Server**.

---

## Part 1 — Create the bot (~8 min)

**1.** Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
Name it `Artist Academy Tracker`. Accept the terms, **Create**.

**2.** Left sidebar → **Bot**.

**3.** Scroll to **Privileged Gateway Intents** and turn ON:

- ✅ **SERVER MEMBERS INTENT**

That one is what lets the bot read join dates, which is what draws your growth
curve back to the server's founding. Leave *Message Content* and *Presence* OFF —
we count messages, we don't read them, and the tracker never needs their text.

Save.

**4.** Still on the Bot page → **Reset Token** → **Yes, do it** → **Copy**.
You get one look at it. Keep it for the next five minutes.

> This token can act as a bot in your server. Treat it like a password — it goes
> into a GitHub secret and nowhere else.

**5.** Under *Authorization Flow*, turn **Public Bot** OFF. Nobody else should be
able to add your bot to their server.

---

## Part 2 — Invite it (~2 min)

**6.** Left sidebar → **OAuth2** → **URL Generator**.

**Scopes:** ✅ `bot`

**Bot Permissions:** ✅ **View Channels** · ✅ **Read Message History**

That is the complete list. It cannot post, delete, kick, ban, or manage anything —
by design. If it's ever compromised, the worst it can do is read.

**7.** Copy the generated URL at the bottom, open it, pick **Artist Academy**, authorise.

**8.** Check any **private channels** you want counted: the bot needs to be added
to each one individually (channel settings → Permissions). Channels it can't see
are skipped and reported in the run log — they aren't silently dropped.

---

## Part 3 — Wire it up (~4 min)

**9. Get the server ID.** In Discord: User Settings → Advanced → turn on
**Developer Mode**. Then right-click the Artist Academy server icon → **Copy Server ID**.

**10.** In the repo: **Settings** → *Secrets and variables* → **Actions** →
**New repository secret**, twice:

| Name | Value |
|---|---|
| `DISCORD_TOKEN` | the bot token from step 4 |
| `DISCORD_GUILD_ID` | the server ID from step 9 |

**11. First run.** Actions tab → **Discord daily** → *Run workflow* → set
**backfill_days** to `90` → Run. Then run **Discord hourly** once by hand.

The backfill walks 90 days of history channel by channel. On a busy server that
can take a while; it respects Discord's rate limits rather than racing them, so
let it run.

---

## About your members' names

The repository is public, so anything committed here is readable by anyone with
the URL. Your members did not sign up to have their activity published.

So by default the top-contributors table shows **stable pseudonyms** — the same
person is always "Member 4C0", and the shape of the leaderboard is intact, but no
names leave Discord.

If you decide real names are appropriate, add a repository **variable** (not a
secret): Settings → *Secrets and variables* → **Actions** → **Variables** tab →
`DISCORD_SHOW_NAMES` = `true`. The next daily run picks it up.

If you'd rather have names *and* privacy, the answer is to make the repo private
and serve the dashboard from Cloudflare Pages instead — about five minutes, and
none of the collected data changes.

## What the jobs do

| Job | When | What |
|---|---|---|
| `discord-hourly.yml` | every hour at :10 | Member count and how many are online. |
| `discord-daily.yml` | 04:00 UTC | Yesterday's messages per day, per channel, per person; refreshes join dates. |

Staggered ten minutes after the Instagram jobs so the two never fight over a commit.

## Honest limits

- **Only channels the bot can see** are counted.
- **Deleted messages are gone** from history, so counts read slightly below what was actually sent.
- **Archived threads aren't counted** — active ones are.
- **Voice activity isn't available** through the API at all.
- **The reconstructed member curve can't see people who left**, so it understates the past and never dips. From the day hourly tracking starts, the numbers are exact.
- **Discord's own Server Insights** panel is UI-only with no API, so these numbers won't match it exactly.

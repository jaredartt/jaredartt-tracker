// Daily account insights.
//
// Two constraints shape this file:
//
//  1. Instagram allows 200 API calls per hour. So all the metrics for one day go
//     out in a SINGLE request rather than one request each — the difference
//     between ~2 calls a day and ~11, which matters enormously when backfilling
//     90 days at once.
//
//  2. Meta renames and retires metrics roughly once a year (`impressions` died
//     in April 2025, replaced by `views`). So when the batch request fails, it
//     falls back to asking one metric at a time, learns which name is dead, and
//     remembers that in data/metrics.json. A retired metric costs one blank
//     column, never the whole run.

import { api, upsertCsv, readCsv, readJson, writeJson, isoDate, log } from './lib.mjs';

export const METRICS = [
  'reach',              // unique accounts that saw your work
  'views',              // total views (replaced "impressions")
  'profile_views',      // people who tapped through to the profile
  'accounts_engaged',
  'total_interactions',
  'likes',
  'saves',
  'shares',
  'comments',
  'profile_links_taps',
];

// Metrics that only return anything useful when you ask for the split.
// follows_and_unfollows without `breakdown` hands back a single number that
// doesn't say which direction it went — useless — so it gets its own request.
export const BREAKDOWN_METRICS = [
  { name: 'follows_and_unfollows', breakdown: 'follow_type' },
];

export const HEADER = [
  'date', 'reach', 'views', 'profile_views', 'accounts_engaged',
  'total_interactions', 'likes', 'saves', 'shares', 'comments',
  'profile_links_taps', 'follows', 'unfollows',
];

const DAY = 86400;
const unix = (dateStr, offsetDays = 0) =>
  Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000) + offsetDays * DAY;

/** Meta's rate-limit signals. Worth stopping for rather than hammering through. */
export function isRateLimited(err) {
  return err?.status === 429 || [4, 17, 32, 613].includes(Number(err?.code));
}

// --- metric capability cache ------------------------------------------------
// { bad: [...], legacy: [...] } — learned once, reused forever.
const loadCache = () => {
  const c = readJson('metrics.json', {});
  return { bad: c.bad || [], legacy: c.legacy || [] };
};
const saveCache = (c) => writeJson('metrics.json', c);

/** Pull every value out of whichever response shape Meta used for one entry. */
function readEntry(entry) {
  const tv = entry.total_value;
  if (tv) {
    if (typeof tv.value === 'number') return { value: tv.value };
    const breakdown = tv.breakdowns?.[0];
    if (breakdown) {
      // Meta omits `results` entirely on a day with no activity. That is an
      // answer — zero — not a malformed response.
      const parts = {};
      for (const r of breakdown.results || []) {
        parts[String(r.dimension_values?.[0] ?? '').toLowerCase()] = r.value;
      }
      return { parts };
    }
  }
  if (Array.isArray(entry.values) && entry.values.length) {
    return { value: entry.values.reduce((s, v) => s + (Number(v.value) || 0), 0) };
  }
  return null;
}

/** Fold one metric's parsed result into the CSV row. */
function assign(row, name, parsed) {
  if (!parsed) return;
  if (name === 'follows_and_unfollows') {
    if (!parsed.parts) return;
    // Absent rows mean zero, so start there and let any rows override.
    let follows = 0, unfollows = 0;
    // Meta labels these FOLLOWER / NON_FOLLOWER — "became a follower" and
    // "became a non-follower". Match NON_ and UNFOLLOW first: both contain the
    // substring "follow", so a loose test would file unfollows as follows.
    for (const [k, v] of Object.entries(parsed.parts)) {
      if (k.includes('unfollow') || k.startsWith('non')) unfollows = v;
      else if (k.includes('follow')) follows = v;
    }
    row.follows = follows;
    row.unfollows = unfollows;
  } else if (parsed.value !== undefined) {
    row[name] = parsed.value;
  }
}

async function request(metrics, date, { legacy = false, breakdown } = {}) {
  const params = {
    metric: metrics.join(','),
    period: 'day',
    since: unix(date),
    until: unix(date, 1),
  };
  if (!legacy) params.metric_type = 'total_value';
  if (breakdown) params.breakdown = breakdown;
  return api('/me/insights', params);
}

/**
 * Every metric for one day. One request when all is well; a handful when a
 * metric name has gone stale and needs isolating.
 */
export async function collectDay(date) {
  const cache = loadCache();
  const row = { date };
  let cacheDirty = false;

  const batch = METRICS.filter((m) => !cache.bad.includes(m) && !cache.legacy.includes(m));

  // --- the happy path: one request for everything -------------------------
  if (batch.length) {
    try {
      const res = await request(batch, date);
      for (const entry of res.data || []) assign(row, entry.name, readEntry(entry));
    } catch (err) {
      if (isRateLimited(err)) throw err;

      // Something in the batch is stale. Isolate it, once, and remember.
      log('  batch request rejected — probing metrics individually');
      for (const metric of batch) {
        try {
          const res = await request([metric], date);
          assign(row, metric, readEntry(res.data?.[0]));
        } catch (e1) {
          if (isRateLimited(e1)) throw e1;
          try {
            const res = await request([metric], date, { legacy: true });
            assign(row, metric, readEntry(res.data?.[0]));
            cache.legacy.push(metric);
            cacheDirty = true;
            log(`  · ${metric}: needs the legacy request shape — noted`);
          } catch (e2) {
            if (isRateLimited(e2)) throw e2;
            cache.bad.push(metric);
            cacheDirty = true;
            log(`  · ${metric}: unavailable, will stop asking (${e1.message})`);
          }
        }
      }
    }
  }

  // --- metrics known to need the older request shape ----------------------
  for (const metric of cache.legacy) {
    try {
      const res = await request([metric], date, { legacy: true });
      assign(row, metric, readEntry(res.data?.[0]));
    } catch (err) {
      if (isRateLimited(err)) throw err;
    }
  }

  // --- metrics that need an explicit breakdown ----------------------------
  for (const { name, breakdown } of BREAKDOWN_METRICS) {
    if (cache.bad.includes(name)) continue;
    try {
      const res = await request([name], date, { breakdown });
      const parsed = readEntry(res.data?.[0]);
      if (parsed?.parts) {
        assign(row, name, parsed);
      } else {
        // A bare number can't be split into follows vs unfollows, and a wrong
        // number is worse than a blank one. Leave it empty, but keep asking —
        // this shape varies by day, not permanently.
        log(`  · ${name}: no breakdown returned for ${date}`);
      }
    } catch (err) {
      if (isRateLimited(err)) throw err;
      cache.bad.push(name);
      cacheDirty = true;
      log(`  · ${name}: unavailable (${err.message})`);
    }
  }

  if (cacheDirty) saveCache(cache);
  return row;
}

// --- run -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  // Yesterday, because today is still in progress and would record a partial day.
  const target = process.argv[2] || isoDate(new Date(Date.now() - 86400_000));

  log(`Collecting insights for ${target}`);
  const row = await collectDay(target);
  const filled = Object.keys(row).filter((k) => k !== 'date').length;

  if (!filled) {
    log('No metrics returned. Check the token and that the account is a professional account.');
    process.exit(1);
  }

  const count = upsertCsv('insights.csv', HEADER, row, 'date');
  log(`Stored ${filled} metrics for ${target} · ${count} days on file`);
  log(`  reach ${row.reach ?? '—'} · views ${row.views ?? '—'} · profile views ${row.profile_views ?? '—'}`);

  if (readCsv('insights.csv').rows.length === 1) {
    log('First day recorded. Run the backfill to pull the last 90 days.');
  }
}

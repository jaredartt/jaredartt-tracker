// Daily account insights.
//
// Meta renames and retires metrics roughly once a year (`impressions` died in
// April 2025, replaced by `views`). So this asks for each metric on its own and
// records whatever answers, instead of sending one big request that fails
// entirely because a single name went stale. A metric that disappears leaves a
// gap in one column; everything else keeps recording.

import { api, upsertCsv, readCsv, isoDate, log } from './lib.mjs';

// Order here is the order of columns in the CSV.
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
  'follows_and_unfollows',
];

const HEADER = [
  'date', 'reach', 'views', 'profile_views', 'accounts_engaged',
  'total_interactions', 'likes', 'saves', 'shares', 'comments',
  'profile_links_taps', 'follows', 'unfollows',
];

const DAY = 86400;
const unix = (dateStr, offsetDays = 0) =>
  Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000) + offsetDays * DAY;

/** Pull every value out of whichever response shape Meta used. */
function parse(metric, payload) {
  const d = payload?.data?.[0];
  if (!d) return null;

  const tv = d.total_value;
  if (tv) {
    if (typeof tv.value === 'number') return { [metric]: tv.value };
    const breakdown = tv.breakdowns?.[0];
    if (breakdown?.results) {
      const out = {};
      for (const r of breakdown.results) {
        const key = String(r.dimension_values?.[0] ?? '').toLowerCase();
        out[key] = r.value;
      }
      return out;
    }
  }
  // Legacy time-series shape.
  if (Array.isArray(d.values) && d.values.length) {
    const total = d.values.reduce((s, v) => s + (Number(v.value) || 0), 0);
    return { [metric]: total };
  }
  return null;
}

/** One metric, one day. Returns null if the account or API won't serve it. */
async function fetchMetric(metric, date) {
  const base = {
    metric,
    period: 'day',
    since: unix(date),
    until: unix(date, 1),
  };
  try {
    return parse(metric, await api('/me/insights', { ...base, metric_type: 'total_value' }));
  } catch (err) {
    // Some legacy metrics reject metric_type; a few need a plain request.
    try {
      return parse(metric, await api('/me/insights', base));
    } catch {
      log(`  · ${metric}: unavailable (${err.message.split(':').slice(1).join(':').trim()})`);
      return null;
    }
  }
}

export async function collectDay(date) {
  const row = { date };
  for (const metric of METRICS) {
    const got = await fetchMetric(metric, date);
    if (!got) continue;
    if (metric === 'follows_and_unfollows') {
      // Breakdown keys have shifted names across versions; match loosely.
      for (const [k, v] of Object.entries(got)) {
        if (k.includes('unfollow')) row.unfollows = v;
        else if (k.includes('follow')) row.follows = v;
      }
    } else {
      Object.assign(row, got);
    }
  }
  return row;
}

// --- run -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  // Yesterday, because today is still in progress and would record a partial day.
  const target = process.argv[2] ||
    isoDate(new Date(Date.now() - 86400_000));

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

  const total = readCsv('insights.csv').rows.length;
  if (total === 1) log('First day recorded. Run `node scripts/backfill.mjs` to pull the last 90 days.');
}

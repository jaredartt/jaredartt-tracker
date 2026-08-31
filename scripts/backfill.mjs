// One-time backfill: pull everything Meta still remembers.
//
// Instagram keeps ~90 days of insights and then deletes them permanently.
// Running this on day one means the dashboard opens with three months of
// history instead of a blank page — and from then on the daily job keeps
// history that Instagram itself will have thrown away.

import { collectDay } from './insights.mjs';
import { upsertCsv, readCsv, isoDate, log } from './lib.mjs';

const HEADER = [
  'date', 'reach', 'views', 'profile_views', 'accounts_engaged',
  'total_interactions', 'likes', 'saves', 'shares', 'comments',
  'profile_links_taps', 'follows', 'unfollows',
];

const days = Number(process.argv[2] || 89);
const have = new Set(readCsv('insights.csv').rows.map((r) => r.date));

log(`Backfilling up to ${days} days (skipping ${have.size} already on file)`);

let stored = 0;
for (let i = days; i >= 1; i--) {
  const date = isoDate(new Date(Date.now() - i * 86400_000));
  if (have.has(date)) continue;

  const row = await collectDay(date);
  const filled = Object.keys(row).filter((k) => k !== 'date').length;
  if (!filled) { log(`${date}: nothing returned (likely beyond Meta's retention)`); continue; }

  upsertCsv('insights.csv', HEADER, row, 'date');
  stored++;
  log(`${date}: reach ${row.reach ?? '—'} · views ${row.views ?? '—'}`);
  await new Promise((r) => setTimeout(r, 250)); // stay well inside the rate limit
}

log(`Backfill complete — ${stored} new days stored.`);

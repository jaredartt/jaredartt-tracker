// One-time backfill: pull everything Meta still remembers.
//
// Instagram keeps ~90 days of insights and then deletes them permanently.
// Running this on day one means the dashboard opens with three months of
// history instead of a blank page — and from then on the daily job keeps
// history that Instagram itself will have thrown away.
//
// Instagram allows 200 API calls an hour and this needs roughly one per day of
// history, so a full 90-day backfill sits close to the ceiling. It therefore
// works newest-first (the days you care most about land first), stops the
// moment it is rate-limited rather than burning through, and is safe to run
// again — it picks up exactly where it left off.

import { collectDay, isRateLimited, HEADER } from './insights.mjs';
import { upsertCsv, readCsv, isoDate, log } from './lib.mjs';

const days = Number(process.argv[2] || 89);

// A day counts as done only if it actually has a reach figure. A row that was
// written during a rate-limited run is half-empty and worth retrying.
const complete = new Set(
  readCsv('insights.csv').rows.filter((r) => r.reach !== '' && r.reach != null).map((r) => r.date)
);

log(`Backfilling up to ${days} days · ${complete.size} already complete`);

let stored = 0, skipped = 0, limited = false;

for (let i = 1; i <= days; i++) {          // newest first
  const date = isoDate(new Date(Date.now() - i * 86400_000));
  if (complete.has(date)) { skipped++; continue; }

  let row;
  try {
    row = await collectDay(date);
  } catch (err) {
    if (isRateLimited(err)) { limited = true; break; }
    log(`${date}: ${err.message}`);
    continue;
  }

  if (row.reach === undefined && Object.keys(row).length <= 1) {
    log(`${date}: nothing returned (likely beyond Meta's 90-day retention)`);
    continue;
  }

  upsertCsv('insights.csv', HEADER, row, 'date');
  stored++;
  log(`${date}: reach ${row.reach ?? '—'} · views ${row.views ?? '—'} · profile views ${row.profile_views ?? '—'}`);
  await new Promise((r) => setTimeout(r, 200));
}

const total = readCsv('insights.csv').rows.length;

if (limited) {
  log('');
  log(`Rate limit reached — stopped cleanly with ${stored} new days stored (${total} total).`);
  log('Instagram allows 200 calls an hour. Run this workflow again in an hour and');
  log('it will resume from exactly here. Nothing was lost or corrupted.');
} else {
  log(`Backfill complete — ${stored} new days stored, ${skipped} already had data (${total} total).`);
}

// Diagnostic: work out how this account will hand over follows vs unfollows.
// Meta documents `follows_and_unfollows` but not consistently across versions,
// so this tries each plausible request shape and records exactly what came
// back. Results land in data/probe.json.

import { api, writeJson, log } from './lib.mjs';

const DAY = 86400;
const since = Math.floor(Date.parse((process.argv[2] || '2026-06-04') + 'T00:00:00Z') / 1000);
const until = since + DAY;

const attempts = [
  ['total_value + breakdown=follow_type',   { metric_type: 'total_value', breakdown: 'follow_type' }],
  ['total_value, no breakdown',             { metric_type: 'total_value' }],
  ['total_value + breakdown=followed_or_unfollowed', { metric_type: 'total_value', breakdown: 'followed_or_unfollowed' }],
  ['no metric_type + breakdown=follow_type',{ breakdown: 'follow_type' }],
  ['no metric_type at all',                 {}],
  ['time_series',                           { metric_type: 'time_series' }],
];

const results = {};
for (const [label, extra] of attempts) {
  try {
    const res = await api('/me/insights', {
      metric: 'follows_and_unfollows', period: 'day', since, until, ...extra,
    });
    results[label] = { ok: true, body: res };
    log(`OK   ${label}`);
  } catch (err) {
    results[label] = { ok: false, error: err.message };
    log(`FAIL ${label} — ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
writeJson('probe.json', results);
log('Wrote data/probe.json');

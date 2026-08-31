// Hourly snapshot: the live profile counters.
//
// This is the piece that makes hour-of-day analysis possible. Instagram's own
// insights only report followers once a day, so the only way to know that you
// gain followers at 9pm and not at 9am is to look every hour and keep the
// difference. Nobody else stores this for you.

import { api, readCsv, upsertCsv, isoHour, log } from './lib.mjs';

const HEADER = ['ts_utc', 'followers', 'following', 'posts'];

const me = await api('/me', {
  fields: 'username,followers_count,follows_count,media_count',
});

const row = {
  ts_utc: isoHour(),
  followers: me.followers_count ?? '',
  following: me.follows_count ?? '',
  posts: me.media_count ?? '',
};

const before = readCsv('followers.csv').rows;
const last = before[before.length - 1];
const count = upsertCsv('followers.csv', HEADER, row, 'ts_utc');

const delta = last ? Number(row.followers) - Number(last.followers) : 0;
log(
  `@${me.username}: ${row.followers} followers` +
  (last ? ` (${delta >= 0 ? '+' : ''}${delta} since ${last.ts_utc})` : ' — first snapshot') +
  ` · ${count} hourly points stored`
);

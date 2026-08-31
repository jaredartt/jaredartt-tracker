// Hourly snapshot of the server's live counters.
//
// Same idea as the Instagram hourly job: Discord will tell you how many members
// you have right now, but nobody keeps the history for you. An hourly reading
// is also the only way to see what time of day people actually join.

import { guild, log } from './discord-lib.mjs';
import { readCsv, upsertCsv, isoHour } from './lib.mjs';

const HEADER = ['ts_utc', 'members', 'online'];

const g = await guild();

const row = {
  ts_utc: isoHour(),
  members: g.approximate_member_count ?? '',
  online: g.approximate_presence_count ?? '',
};

const before = readCsv('discord-members.csv').rows;
const last = before[before.length - 1];
const count = upsertCsv('discord-members.csv', HEADER, row, 'ts_utc');

const delta = last ? Number(row.members) - Number(last.members) : 0;
log(
  `${g.name}: ${row.members} members, ${row.online} online` +
  (last ? ` (${delta >= 0 ? '+' : ''}${delta} since ${last.ts_utc})` : ' — first snapshot') +
  ` · ${count} hourly points stored`
);

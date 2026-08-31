// Join dates for every current member.
//
// Each member record carries the day they joined, which lets the dashboard draw
// a growth curve going back to the server's founding — no waiting three months
// for history to accumulate.
//
// The honest caveat, which the page states too: this only knows about people
// who are STILL in the server. Someone who joined in March and left in July is
// invisible here, so the reconstructed line understates the past and can never
// show a dip. The hourly snapshots are the exact record from today onward.

import { allMembers, log } from './discord-lib.mjs';
import { writeCsv } from './lib.mjs';

const members = await allMembers();
log(`${members.length} members listed`);

const byDate = new Map();
let bots = 0;

for (const m of members) {
  if (m.user?.bot) { bots++; continue; }
  const date = (m.joined_at || '').slice(0, 10);
  if (!date) continue;
  byDate.set(date, (byDate.get(date) || 0) + 1);
}

const rows = [...byDate.entries()].sort().map(([date, joins]) => ({ date, joins }));
writeCsv('discord-joins.csv', ['date', 'joins'], rows);

const first = rows[0]?.date, last = rows[rows.length - 1]?.date;
const humans = members.length - bots;
log(`${humans} human members (${bots} bots) joining across ${rows.length} distinct days`);
if (first) log(`  earliest surviving member joined ${first}, most recent ${last}`);
